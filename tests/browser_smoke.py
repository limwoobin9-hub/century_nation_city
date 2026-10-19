"""Real Chromium UI smoke checks. Run against npm run dev with Python Playwright installed.
Usage: python tests/browser_smoke.py --url http://127.0.0.1:3000 --output /tmp/century-browser
No application packages, credentials, or external services are required.
"""
import argparse
import asyncio
import json
import struct
import zlib
from pathlib import Path
from playwright.async_api import async_playwright


def transparent_sprite(path):
    width = height = 64
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            visible = 18 < y < 54 and abs(x - 32) < (18 if y > 30 else max(0, y - 14))
            row.extend((159, 94, 70, 255) if visible else (0, 0, 0, 0))
        rows.append(b'\0' + row)
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))


async def run(url, output):
    output.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    def passed(name, detail=None):
        checks.append({'name': name, 'ok': True, **({'detail': detail} if detail else {})})
        print('PASS', name, flush=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1365, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(url)
        await page.wait_for_selector('#start-game')
        await page.click('[data-new-country="korea"]')
        await page.click('[data-new-year="1900"]')
        await page.click('#start-game')
        await page.click('[data-speed="0"]')
        await page.wait_for_timeout(600)
        assert await page.evaluate('century.state.cities.length') == 3
        assert await page.evaluate('century.state.cities.every(c=>c.size===100 && c.tiles.length===10000)')
        assert await page.evaluate('century.state.date.year') == 1900
        passed('New game starts from country/year UI with three 100×100 cities')
        await page.screenshot(path=str(output / 'desktop.png'))

        async def find_build_site(kind, count=1):
            return await page.evaluate('''({kind,count})=>{const c=century.actions.getCity(century.state),r=century.renderer,rect=r.canvas.getBoundingClientRect();
              for(let y=29;y<73;y++)for(let x=29;x<74-count;x++){let points=[];for(let i=0;i<count;i++)points.push({x:x+i,y});
                if(!points.every(p=>century.actions.canPlace(century.state,kind,p.x,p.y).ok))continue;
                const screen=points.map(p=>{let s=r.tileToScreen(p.x,p.y);return {x:s.x+rect.left,y:s.y+rect.top}});
                if(!screen.every(p=>p.x>rect.left+40&&p.x<rect.right-260&&p.y>rect.top+145&&p.y<rect.bottom-350&&document.elementFromPoint(p.x,p.y)===r.canvas))continue;
                return {points,screen};}return null;}''', {'kind': kind, 'count': count})

        # Select by an actual roof pixel, exercising sprite alpha hit detection.
        selected = await page.evaluate('''()=>{const c=century.actions.getCity(century.state),r=century.renderer,rect=r.canvas.getBoundingClientRect();
          for(const b of c.buildings.filter(b=>b.type==='house'&&b.level===1)){const p=r.tileToScreen(b.x,b.y);const x=rect.left+p.x,y=rect.top+p.y-15*r.view.zoom;
            if(x>rect.left+100&&x<rect.right-280&&y>rect.top+180&&y<rect.bottom-300&&document.elementFromPoint(x,y)===r.canvas)return {id:b.id,x,y};}return null;}''')
        assert selected
        await page.mouse.click(selected['x'], selected['y'])
        assert await page.evaluate('century.renderer.selected') == selected['id']
        await page.click('[data-action="rename-building"]')
        await page.fill('#building-name', '검증용 벽돌 주택')
        await page.click('#rename-confirm')
        assert '검증용 벽돌 주택' in await page.locator('#detail-card').inner_text()
        await page.click('[data-action="preserve"]')
        assert await page.evaluate('(id)=>century.actions.getCity(century.state).buildings.find(b=>b.id===id).preserved', selected['id'])
        await page.click('[data-action="upgrade-building"]')
        assert await page.evaluate('(id)=>century.actions.getCity(century.state).buildings.find(b=>b.id===id).level', selected['id']) == 1
        await page.click('[data-action="preserve"]')
        await page.click('[data-action="upgrade-building"]')
        assert await page.evaluate('(id)=>century.actions.getCity(century.state).buildings.find(b=>b.id===id).level', selected['id']) == 2
        passed('Roof selection opens detail; rename, preservation and upgrade change real building')
        await page.keyboard.press('Escape')

        await page.click('[data-category="residential"]')
        await page.click('[data-tool="house"]')
        site = await find_build_site('house')
        assert site, 'No visible supported construction site'
        before = await page.evaluate('({n:century.actions.getCity(century.state).buildings.length,money:century.state.money})')
        await page.mouse.move(site['screen'][0]['x'], site['screen'][0]['y'])
        await page.mouse.click(site['screen'][0]['x'], site['screen'][0]['y'])
        after = await page.evaluate('({n:century.actions.getCity(century.state).buildings.length,money:century.state.money})')
        assert after['n'] == before['n'] + 1 and after['money'] < before['money']
        await page.click('#undo-button')
        assert await page.evaluate('century.actions.getCity(century.state).buildings.length') == before['n']
        assert await page.evaluate('century.state.money') == before['money']
        passed('Actual construction tool/canvas click builds house, charges money and undo restores both')
        await page.keyboard.press('Escape')

        await page.click('[data-category="road"]')
        road = await find_build_site('road', 3)
        assert road, 'No visible road stroke site'
        await page.mouse.move(road['screen'][0]['x'], road['screen'][0]['y'])
        await page.mouse.down()
        await page.mouse.move(road['screen'][-1]['x'], road['screen'][-1]['y'], steps=12)
        await page.mouse.up()
        assert await page.evaluate('(points)=>points.every(p=>century.actions.getCity(century.state).tiles[p.y*100+p.x].road)', road['points'])
        passed('Pointer drag lays a connected three-tile road')
        await page.keyboard.press('Escape')

        await page.evaluate('''()=>{window.__train=[];const r=century.renderer,original=r._drawTrainCar;r._drawTrainCar=function(...args){if(this.time!==window.__trainTime){window.__train=[];window.__trainTime=this.time}window.__train.push(args.slice(0,4));return original.apply(this,args)}}''')
        await page.wait_for_timeout(100)
        train1 = await page.evaluate('__train')
        state1 = await page.evaluate('JSON.stringify(century.state)')
        await page.wait_for_timeout(400)
        train2 = await page.evaluate('__train')
        assert train1 and train2 and train1 != train2
        assert state1 == await page.evaluate('JSON.stringify(century.state)')
        assert await page.evaluate('''()=>__train.every(([x,y])=>{const c=century.actions.getCity(century.state);return [Math.floor(y),Math.ceil(y)].some(yy=>c.tiles[yy*c.size+Math.round(x)]?.rail)})''')
        passed('Train animation advances while simulation is paused and stays on actual rail tiles')

        old_zoom = await page.evaluate('century.renderer.view.zoom')
        await page.click('#zoom-in')
        assert await page.evaluate('century.renderer.view.zoom') > old_zoom
        rect = await page.locator('#city-canvas').bounding_box()
        before_pan = await page.evaluate('({...century.renderer.view})')
        await page.mouse.move(rect['x'] + 400, rect['y'] + 250)
        await page.mouse.down(button='middle')
        await page.mouse.move(rect['x'] + 460, rect['y'] + 285, steps=8)
        await page.mouse.up(button='middle')
        after_pan = await page.evaluate('({...century.renderer.view})')
        assert after_pan['x'] > before_pan['x'] and after_pan['y'] > before_pan['y']
        await page.select_option('#overlay-select', 'education')
        assert await page.evaluate('century.renderer.overlay') == 'education'
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(output / 'education-overlay.png'))
        await page.select_option('#overlay-select', 'normal')
        await page.click('#night-toggle')
        assert await page.evaluate('century.renderer.daylight') < 0.5
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(output / 'night.png'))
        await page.click('#night-toggle')
        await page.click('#center-map')
        passed('Zoom, middle-button pan, service overlay and lit night view respond to real controls')

        for panel in ['overview', 'nation', 'economy', 'population', 'industry', 'politics', 'diplomacy', 'research', 'chronicle']:
            await page.click(f'[data-panel="{panel}"]')
            assert await page.locator('#panel-content').inner_text()
        await page.click('[data-panel="economy"]')
        await page.locator('[data-policy="incomeTax"]').evaluate('(el)=>{el.value=22;el.dispatchEvent(new Event("input",{bubbles:true}))}')
        assert await page.evaluate('century.state.policies.incomeTax') == 22
        passed('All nine panels render and tax slider updates the economic model')
        await page.click('[data-panel="research"]')
        research = page.locator('[data-action="research"]:not([disabled])').first
        research_id = await research.get_attribute('data-id')
        await research.click()
        assert await page.evaluate('century.state.research.active') == research_id
        await page.click('#close-panel')
        original_date = await page.evaluate('({...century.state.date})')
        await page.evaluate('''()=>{for(let i=0;i<12;i++)century.actions.tick(century.state);century.actions.update()}''')
        date = await page.evaluate('({...century.state.date})')
        assert date['year'] == original_date['year'] + 1 and date['month'] == original_date['month']
        assert await page.evaluate('century.state.history.length') >= 13
        passed('Research starts through UI; twelve real simulation ticks advance a year and history')

        await page.click('[data-panel="nation"]')
        await page.locator('[data-action="switch-city"][data-id="harbor"]').first.click()
        assert await page.evaluate('century.state.activeCity') == 'harbor'
        connect = page.locator('[data-action="connect"]').first
        await connect.click()
        assert await page.evaluate('century.state.connections.length') == 1
        await page.locator('[data-action="switch-city"][data-id="capital"]').first.click()
        await page.click('#close-panel')
        passed('Nation map switches city and builds a persistent intercity railway connection')

        # Save through the real slot UI, change state, then restore the old time.
        await page.click('#save-menu')
        await page.click('[data-save-slot="0"]')
        await page.wait_for_function("!document.querySelector('[data-load-slot=\"0\"]').disabled")
        saved = await page.evaluate('({date:{...century.state.date},money:century.state.money})')
        await page.click('[data-action="close-modal"]')
        await page.evaluate('century.actions.tick(century.state);century.actions.update()')
        await page.click('#save-menu')
        await page.click('[data-load-slot="0"]')
        await page.wait_for_function('document.querySelector("#modal-root").children.length===0')
        restored = await page.evaluate('({date:{...century.state.date},money:century.state.money})')
        assert restored == saved
        await page.reload()
        await page.wait_for_selector('#start-game')
        await page.click('[data-action="open-saves"]')
        await page.click('[data-load-slot="0"]')
        await page.wait_for_function('document.querySelector("#modal-root").children.length===0')
        await page.click('[data-speed="0"]')
        assert await page.evaluate('({date:{...century.state.date},money:century.state.money})') == saved
        passed('Slot save/load restores time and treasury; IndexedDB survives full browser reload')

        await page.click('[data-category="custom"]')
        await page.click('[data-action="upload-sprite"]')
        sprite_file = output / 'custom-building.png'
        transparent_sprite(sprite_file)
        await page.set_input_files('#sprite-file', str(sprite_file))
        await page.fill('#sprite-name', '검증용 픽셀 공방')
        await page.click('#register-sprite')
        await page.wait_for_function('century.state.customAssets.length===1')
        custom_id = await page.evaluate('century.state.customAssets[0].id')
        site = await find_build_site(custom_id)
        assert site
        await page.mouse.click(site['screen'][0]['x'], site['screen'][0]['y'])
        assert await page.evaluate('(type)=>century.actions.getCity(century.state).buildings.some(b=>b.type===type)', custom_id)
        await page.keyboard.press('Escape')
        passed('User transparent PNG uploads, registers a building type and is constructed on the map')

        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(300)
        assert await page.evaluate('document.documentElement.scrollWidth') == 390
        await page.screenshot(path=str(output / 'mobile.png'))
        await page.click('[data-panel="economy"]')
        assert await page.locator('#side-panel').is_visible()
        await page.click('#close-panel')
        await page.click('[data-category="residential"]')
        assert await page.locator('[data-tool="house"]').is_visible()
        await page.keyboard.press('Escape')
        passed('390px mobile layout has no horizontal overflow; panels and building palette remain usable')
        assert not errors, errors
        passed('No browser JavaScript exceptions throughout all scenarios')
        report = {'ok': True, 'checks': checks, 'browserErrors': errors, 'rendererStats': await page.evaluate('century.renderer.stats')}
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        await browser.close()
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:3000')
    parser.add_argument('--output', default='/tmp/century-browser')
    args = parser.parse_args()
    asyncio.run(run(args.url, Path(args.output)))
