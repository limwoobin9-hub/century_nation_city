#!/usr/bin/env python3
"""Optional real-browser persistence test; no Python dependencies for the game.

Start `npm run dev`, then run:
  python3 -m pip install playwright
  python3 -m playwright install chromium
  python3 tests/browser_storage.py

CENTURY_URL overrides http://127.0.0.1:3000. BROWSER_EXECUTABLE_PATH can select
an installed Chromium. The test uses a new isolated browser context and leaves
existing browser profiles, app files, and developer save slots untouched.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
URL = os.environ.get("CENTURY_URL", "http://127.0.0.1:3000")
PNG = ROOT / "assets/sprites/house-1-0.png"

# Execute the actual registered autosave timer without a minute of wall time.
# Capturing, rather than replacing, its callback retains production conditions,
# slot selection, serialization, and IndexedDB transaction behavior.
CAPTURE_TIMER = """(() => {
  const nativeInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => {
    if (delay === 250) window.__storageTestTimer = () => callback(...args);
    return nativeInterval(callback, delay, ...args);
  };
})();"""

SNAPSHOT = """(state = century.state) => ({
  country: state.country, date: {...state.date}, money: state.money,
  activeCity: state.activeCity,
  cityName: state.cities.find(c => c.id === state.activeCity).name,
  cities: state.cities.map(c => ({id:c.id, population:c.population, buildings:c.buildings.length})),
  customAssets: (state.customAssets || []).map(a => ({...a}))
})"""


def snapshot(page):
    return page.evaluate(f"({SNAPSHOT})()")


def close_modal(page):
    page.locator('#modal-root [data-action="close-modal"]').first.click()
    expect(page.locator(".modal-backdrop")).to_have_count(0)


def open_saves(page):
    page.click("#save-menu")
    expect(page.locator('[data-save-slot="0"]')).to_be_visible()


def pause(page):
    page.click('[data-speed="0"]')
    assert page.evaluate("century.speed") == 0


def save_slot(page, slot):
    page.click(f'[data-save-slot="{slot}"]')
    # The refreshed card is inserted after the IndexedDB write completes.
    expect(page.locator(f'[data-load-slot="{slot}"]')).to_be_enabled()
    page.wait_for_function(
        "async slot => JSON.stringify(await century.storage.loadGame(slot)) === JSON.stringify(century.state)", arg=slot
    )


def load_slot(page, slot):
    page.click(f'[data-load-slot="{slot}"]')
    expect(page.locator(".modal-backdrop")).to_have_count(0)
    pause(page)


def setup_time_and_city(page, months, city):
    page.evaluate("""({months,city}) => {
      for (let i=0; i<months; i++) century.actions.tick(century.state);
      century.state.activeCity=city;
      century.renderer.setState(century.state);
      century.renderer.center();
      century.actions.update();
    }""", {"months": months, "city": city})


def run(url=URL, output=None):
    assert PNG.is_file(), f"Missing test sprite: {PNG}"
    errors = []
    checks = []
    executable = os.environ.get("BROWSER_EXECUTABLE_PATH") or shutil.which("chromium")
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="century-save-test-") as temporary:
        options = {"headless": True, "args": ["--no-sandbox"]}
        if executable:
            options["executable_path"] = executable
        browser = playwright.chromium.launch(**options)
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        context.add_init_script(CAPTURE_TIMER)

        def new_page():
            current = context.new_page()
            current.on("pageerror", lambda error: errors.append(str(error)))
            current.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            current.goto(url, wait_until="networkidle")
            current.wait_for_function("Boolean(window.century)")
            return current

        page = new_page()
        page.click("#start-game")
        pause(page)
        assert page.evaluate("Boolean(window.indexedDB)")
        expected = {}
        # Distinct dates, treasuries, and active cities prove each slot is isolated.
        for slot, (months, city) in enumerate([(2, "harbor"), (3, "frontier"), (4, "capital")]):
            setup_time_and_city(page, months, city)
            expected[slot] = snapshot(page)
            open_saves(page)
            save_slot(page, slot)
            card = page.locator(".slot-card").nth(slot)
            expect(card).to_contain_text(expected[slot]["cityName"])
            expect(card).to_contain_text(f'{expected[slot]["date"]["year"]}년 {expected[slot]["date"]["month"]}월')
            close_modal(page)
        assert page.evaluate("async () => (await century.storage.listSlots()).map(s=>s.id)") == [0, 1, 2]
        # IndexedDB really holds the records; this is not a localStorage-only pass.
        indexed_keys = page.evaluate("""() => new Promise((resolve,reject) => {
          const request=indexedDB.open('century-nation-city',1);
          request.onsuccess=()=>{
            const db=request.result, tx=db.transaction('saves','readonly');
            const keys=tx.objectStore('saves').getAllKeys();
            keys.onsuccess=()=>resolve(keys.result);
            keys.onerror=()=>reject(keys.error);
            tx.oncomplete=()=>db.close();
          };
          request.onerror=()=>reject(request.error);
        })""")
        assert indexed_keys == [0, 1, 2]
        checks.append("three real IndexedDB manual slots and visible metadata")

        # The unmodified production timer callback requires playing (speed>0).
        # 240 callbacks × 250ms represents the documented 60 seconds.
        page.click('[data-speed="1"]')
        page.evaluate("() => { for(let i=0;i<240;i++) window.__storageTestTimer(); }")
        page.wait_for_function("async () => (await century.storage.loadGame('auto')) !== null")
        pause(page)
        expected["auto"] = page.evaluate(f"async () => ({SNAPSHOT})(await century.storage.loadGame('auto'))")
        assert page.evaluate("async () => (await century.storage.listSlots()).map(s=>s.id)") == [0, 1, 2, "auto"]
        checks.append("actual autosave timer writes the separate auto slot")

        page.close()
        page = new_page()
        # Loading from the initial welcome screen proves survival across page close.
        page.click('[data-action="open-saves"]')
        load_slot(page, 0)
        assert snapshot(page) == expected[0]
        for slot in [1, 2, "auto"]:
            open_saves(page)
            load_slot(page, slot)
            assert snapshot(page) == expected[slot]
        page.reload(wait_until="networkidle")
        page.wait_for_function("Boolean(window.century)")
        page.click('[data-action="open-saves"]')
        load_slot(page, 0)
        assert snapshot(page) == expected[0]
        checks.append("all four slots restore city, date, treasury after page close and reload")

        # Use only the visible upload form and a real repository alpha PNG.
        page.click('[data-category="custom"]')
        page.click('[data-action="upload-sprite"]')
        page.set_input_files("#sprite-file", str(PNG))
        expect(page.locator("#register-sprite")).to_be_enabled()
        page.fill("#sprite-name", "저장 검증 픽셀 주택")
        page.select_option("#sprite-base", "house")
        page.click("#register-sprite")
        page.wait_for_function("century.state.customAssets.length===1")
        custom_id = page.evaluate("century.state.customAssets[0].id")
        expect(page.locator(f'[data-tool="{custom_id}"]')).to_be_visible()
        site = page.evaluate("""type => {
          const canvas=document.querySelector('#city-canvas'), rect=canvas.getBoundingClientRect();
          for(let y=33;y<65;y++) for(let x=33;x<65;x++) {
            if(!century.actions.canPlace(century.state,type,x,y).ok) continue;
            const p=century.renderer.tileToScreen(x,y), sx=p.x+rect.left, sy=p.y+rect.top;
            if(sx<rect.left+20||sx>rect.right-20||sy<rect.top+120||sy>rect.bottom-240) continue;
            if(document.elementFromPoint(sx,sy)===canvas) return {x,y,sx,sy};
          }
          throw new Error('No visible build site');
        }""", custom_id)
        page.mouse.click(site["sx"], site["sy"])
        page.wait_for_function(
            "id => century.actions.getCity(century.state).buildings.some(b=>b.type===id)", arg=custom_id
        )
        page.keyboard.press("Escape")
        expected_custom = snapshot(page)
        open_saves(page)
        save_slot(page, 0)
        with page.expect_download() as download_event:
            page.click('[data-action="export-json"]')
        exported_file = Path(temporary) / "exported-century.json"
        download_event.value.save_as(str(exported_file))
        document = json.loads(exported_file.read_text(encoding="utf-8"))
        assert document["format"] == "century-nation-city"
        assert document["formatVersion"] == 1
        assert document["state"]["customAssets"][0]["id"] == custom_id
        close_modal(page)
        page.reload(wait_until="networkidle")
        page.wait_for_function("Boolean(window.century)")
        page.click('[data-action="open-saves"]')
        load_slot(page, 0)
        assert snapshot(page) == expected_custom
        assert page.evaluate("""async id => {
          const {getSprite}=await import('/src/render/sprites.js');
          const sprite=getSprite(id);
          return Boolean(sprite?.image && sprite.image.width>0);
        }""", custom_id)
        checks.append("transparent PNG upload, actual map construction, saved custom bytes and sprite restore")

        # Import must replace the changed game only after full validation.
        setup_time_and_city(page, 5, "frontier")
        assert snapshot(page) != expected_custom
        open_saves(page)
        page.set_input_files("#import-file", str(exported_file))
        expect(page.locator(".modal-backdrop")).to_have_count(0)
        pause(page)
        assert snapshot(page) == expected_custom
        assert page.evaluate("expected => JSON.stringify(century.state)===JSON.stringify(expected)", document["state"])
        checks.append("visible JSON export/download/import restores the complete game and uploaded image")

        corrupt = json.loads(json.dumps(document))
        corrupt["state"]["money"] += 1000  # Existing checksum must reject this.
        open_saves(page)
        page.set_input_files("#import-file", {"name": "damaged.json", "mimeType": "application/json", "buffer": json.dumps(corrupt).encode()})
        expect(page.locator(".toast.error").last).to_contain_text("가져오기 실패")
        assert page.evaluate("expected => JSON.stringify(century.state)===JSON.stringify(expected)", document["state"])
        assert snapshot(page) == expected_custom
        checks.append("corrupted checksum import shows an error and preserves the entire live game")
        # Even a recomputed checksum cannot make a truncated raster image valid.
        damaged_image = page.evaluate("""async () => {
          const document=JSON.parse(await century.storage.exportGame(century.state).text());
          document.state.customAssets[0].dataUrl='data:image/png;base64,iVBORw0KGgo=';
          const serialized=JSON.stringify(document.state);
          let hash=0x811c9dc5;
          for(let i=0;i<serialized.length;i++) {
            hash^=serialized.charCodeAt(i);
            hash=Math.imul(hash,0x01000193)>>>0;
          }
          document.checksum=`fnv1a32:${hash.toString(16).padStart(8,'0')}`;
          return JSON.stringify(document);
        }""")
        page.set_input_files("#import-file", {"name": "damaged-image.json", "mimeType": "application/json", "buffer": damaged_image.encode()})
        expect(page.locator(".toast.error").last).to_contain_text("사용자 이미지")
        assert page.evaluate("expected => JSON.stringify(century.state)===JSON.stringify(expected)", document["state"])
        checks.append("truncated PNG with a recomputed checksum cannot replace the live game")

        # Deleting one slot through its visible button leaves every other slot.
        page.click('[data-delete-slot="2"]')
        expect(page.locator('[data-load-slot="2"]')).to_be_disabled()
        assert page.evaluate("async () => (await century.storage.listSlots()).map(s=>s.id)") == [0, 1, "auto"]
        checks.append("visible slot deletion isolates the selected record")
        assert not errors, "Browser errors: " + " | ".join(errors)
        context.close()
        browser.close()
    for item in checks:
        print("PASS", item)
    print(f"PASS {len(checks)} browser persistence checks; no page or console errors")
    if output:
        output = Path(output)
        output.mkdir(parents=True, exist_ok=True)
        (output / "report.json").write_text(json.dumps({"status": "passed", "checks": checks, "browserErrors": errors}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify real browser saves, images, and JSON import/export.")
    parser.add_argument("--url", default=URL, help="Running CENTURY URL (defaults to CENTURY_URL or localhost:3000)")
    parser.add_argument("--output", type=Path, help="Optional directory for report.json")
    arguments = parser.parse_args()
    run(arguments.url, arguments.output)
