"""Optional Chromium stress fixture; timings describe only this machine/browser run.
Run a local server, then: python tests/browser_performance.py --url http://127.0.0.1:3000
Requires Python Playwright and /usr/bin/chromium, not application dependencies.
The fixture funds the treasury/stocks and uses real game actions for valid construction.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright


async def run(url, output):
    output.mkdir(parents=True, exist_ok=True)
    errors, checks = [], []
    def passed(name):
        checks.append(name)
        print('PASS', name, flush=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1365, 'height': 900}, device_scale_factor=1)
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(url)
        await page.wait_for_selector('#start-game')
        await page.click('[data-new-year="1900"]')
        await page.click('#start-game')
        await page.click('[data-speed="0"]')
        fixture = await page.evaluate('''()=>{
          const start=performance.now(),s=century.state,a=century.actions,c=a.getCity(s),initial=c.buildings.length;
          s.money=5_000_000;for(const key of Object.keys(c.stock))c.stock[key]=100_000;
          let roads=0,homes=0;
          for(let y=18;y<=70;y++)for(let x=18;x<=70;x++)if((x-18)%4===0||(y-18)%4===0){if(a.place(s,'road',x,y).ok)roads++}
          const candidates=[];for(let y=19;y<70;y++)for(let x=19;x<70;x++)candidates.push({x,y,d:Math.abs(x-50)+Math.abs(y-50)});
          candidates.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
          for(const p of candidates){if(c.buildings.length>=600)break;const roadNeighbor=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>c.tiles[(p.y+dy)*c.size+p.x+dx]?.road);if(roadNeighbor&&a.place(s,'house',p.x,p.y).ok)homes++}
          a.refreshStats(s);a.update();
          const houses=c.buildings.filter(b=>b.type==='house');
          return {initialBuildings:initial,buildings:c.buildings.length,roadsAdded:roads,housesAdded:homes,connectedHouses:houses.filter(b=>b.connected).length,totalHouses:houses.length,constructionMs:performance.now()-start,fixture:'Treasury=5000000 and active-city resource stocks=100000; all roads/houses placed through validated game.place.'};
        }''')
        assert fixture['buildings'] >= 500, fixture
        assert fixture['connectedHouses'] / fixture['totalHouses'] >= 0.98, fixture
        passed(f"Validated construction creates {fixture['buildings']} buildings with connected residential roads")

        tick_result = await page.evaluate('''()=>{
          const start=performance.now(),s=century.state,before={...s.date};
          for(let i=0;i<24;i++)century.actions.tick(s);
          century.actions.update();
          const finite=()=>s.cities.every(c=>['population','happiness','education','health','unemployment','gdp','pollution','income','expenses'].every(k=>Number.isFinite(c[k]))&&Object.values(c.stock).every(Number.isFinite)&&c.buildings.every(b=>['employees','production','utilization','profit'].every(k=>Number.isFinite(b[k]))))&&Number.isFinite(s.money);
          return {before,after:{...s.date},tick24Ms:performance.now()-start,finite:finite(),history:s.history.length,population:century.actions.metrics(s).population};
        }''')
        assert tick_result['after']['year'] == tick_result['before']['year'] + 2
        assert tick_result['after']['month'] == tick_result['before']['month']
        assert tick_result['finite'] and tick_result['history'] >= 25, tick_result
        passed('24 monthly ticks retain finite resources, employment, production, population and treasury')

        # Observe only frames actually painted by the renderer, excluding intentional skipped rAF callbacks.
        await page.evaluate('''()=>{
          window.__paint={durations:[],timestamps:[],visibleTypes:[]};const r=century.renderer,original=r._render;
          r._render=function(...args){const old=this.time,start=performance.now();const result=original.apply(this,args);if(this.time!==old){__paint.durations.push(performance.now()-start);__paint.timestamps.push(performance.now())}return result};
          const draw=r._drawBuilding;r._drawBuilding=function(b,...args){if(b.type==='textile')__paint.aiVisible=true;return draw.call(this,b,...args)};
        }''')
        async def measure(label):
            await page.evaluate('__paint.durations=[];__paint.timestamps=[]')
            await page.wait_for_timeout(1600)
            result = await page.evaluate('''()=>{const d=__paint.durations,t=__paint.timestamps,sorted=[...d].sort((a,b)=>a-b),r=century.renderer;
              return {frames:d.length,paintMeanMs:d.reduce((a,b)=>a+b,0)/Math.max(d.length,1),paintP95Ms:sorted[Math.max(0,Math.floor(sorted.length*.95)-1)]||0,measuredPaintFps:t.length>1?(t.length-1)*1000/(t.at(-1)-t[0]):0,visibleTiles:r.stats.tiles,visibleBuildings:r.stats.buildings,totalBuildings:century.actions.getCity(century.state).buildings.length,zoom:r.view.zoom,terrainCacheEntries:r.stats.terrainCacheEntries,terrainCacheBytes:r.stats.terrainCacheBytes,terrainCacheHits:r.stats.terrainCacheHits,terrainCacheBudgetBytes:r._terrainCacheBudget};}''')
            assert result['frames'] >= 10, result
            result['scenario'] = label
            return result

        for _ in range(5):
            await page.click('#zoom-out')
        wide = await measure('600 buildings, wide view, paused simulation')
        assert wide['visibleBuildings'] >= 500, wide
        assert 0 < wide['terrainCacheBytes'] <= 8 * 1024 * 1024, wide
        assert wide['terrainCacheEntries'] > 0 and wide['terrainCacheHits'] >= wide['visibleTiles'], wide
        await page.screenshot(path=str(output / '600-buildings-wide.png'))
        passed('Wide view visibly renders at least 500 city buildings and continues painting')

        before_date = await page.evaluate('({...century.state.date})')
        await page.click('[data-speed="8"]')
        for _ in range(7):
            await page.click('#zoom-in')
        view_before = await page.evaluate('({...century.renderer.view})')
        rect = await page.locator('#city-canvas').bounding_box()
        await page.mouse.move(rect['x'] + 420, rect['y'] + 270)
        await page.mouse.down(button='middle')
        await page.mouse.move(rect['x'] + 505, rect['y'] + 315, steps=10)
        await page.mouse.up(button='middle')
        view_after = await page.evaluate('({...century.renderer.view})')
        assert view_after['x'] > view_before['x'] and view_after['y'] > view_before['y']
        moving = await measure('600 buildings, zoom/pan and 8× simulation')
        after_date = await page.evaluate('({...century.state.date})')
        months = (after_date['year'] - before_date['year']) * 12 + after_date['month'] - before_date['month']
        assert months >= 3, {'before': before_date, 'after': after_date}
        assert moving['visibleTiles'] < wide['visibleTiles']
        assert moving['visibleBuildings'] < moving['totalBuildings']
        await page.click('[data-speed="0"]')
        finite_after = await page.evaluate('''()=>{const s=century.state;return Number.isFinite(s.money)&&s.cities.every(c=>Number.isFinite(c.population)&&Number.isFinite(c.gdp)&&Object.values(c.stock).every(Number.isFinite))}''')
        assert finite_after
        await page.screenshot(path=str(output / '600-buildings-8x.png'))
        passed(f"Real zoom/pan remains usable at 8×; {months} months pass with viewport culling")

        async def new_game_year(year):
            await page.click('#save-menu')
            await page.click('[data-action="new-game-confirm"]')
            await page.click('#confirm-action')
            await page.wait_for_selector('#start-game')
            await page.click(f'[data-new-year="{year}"]')
            await page.click('#start-game')
            await page.click('[data-speed="0"]')
            await page.wait_for_timeout(120)
            snapshot = await page.evaluate('''async()=>{const s=century.state,c=century.actions.getCity(s),r=century.renderer,{getSprite}=await import('/src/render/sprites.js');
              const sprite=getSprite('textile',1,0),visible=r._buildingHits.map(h=>h.building);
              return {year:s.date.year,month:s.date.month,uiDate:document.querySelector('#date').textContent,country:s.countryLabel,maxLevel:Math.max(...c.buildings.map(b=>b.level)),visibleMaxLevel:Math.max(...visible.map(b=>b.level)),research:s.research.completed.length,visibleTextile:visible.some(b=>b.type==='textile'),aiImage:typeof sprite.image.src==='string'&&sprite.image.src.includes('ai-textile.png')};}''')
            await page.screenshot(path=str(output / f'initial-{year}.png'))
            assert snapshot['year'] == year and f'{year}년' in snapshot['uiDate'], snapshot
            assert snapshot['visibleTextile'] and snapshot['aiImage'], snapshot
            return snapshot

        early = await new_game_year(1850)
        later = await new_game_year(1936)
        assert early['maxLevel'] == 1 and early['visibleMaxLevel'] == 1, early
        assert later['maxLevel'] == 4 and later['visibleMaxLevel'] == 4, later
        assert later['research'] > early['research']
        passed('Actual 1850/1936 new-game UI produces distinct dates, visible historical levels and research')
        passed('AI textile PNG is loaded and its seeded building is visible in both historical starting views')
        assert not errors, errors
        passed('No browser JavaScript exceptions during construction, ticks, speed, camera or resets')
        report = {
            'ok': True, 'checks': checks, 'fixture': fixture, 'tick24': tick_result,
            'renderMeasurements': [wide, moving], 'eightSpeedMonthsObserved': months,
            'historicalStarts': [early, later], 'browserErrors': errors,
            'measurementScope': 'One headless /usr/bin/chromium run at 1365×900, device scale 1, in this cloud execution environment. Synthetic funded save, 600 buildings in the active city. Paint timings include renderer work only; results are not a cross-hardware performance guarantee.'
        }
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps({'buildings': fixture['buildings'], 'tick24Ms': round(tick_result['tick24Ms'], 1), 'wideFps': round(wide['measuredPaintFps'], 1), 'eightSpeedFps': round(moving['measuredPaintFps'], 1), 'wideMeanMs': round(wide['paintMeanMs'], 2), 'eightSpeedMeanMs': round(moving['paintMeanMs'], 2), 'visibleTileCounts': [wide['visibleTiles'], moving['visibleTiles']]}), flush=True)
        await browser.close()
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:3000')
    parser.add_argument('--output', default='/tmp/century-performance')
    args = parser.parse_args()
    asyncio.run(run(args.url, Path(args.output)))
