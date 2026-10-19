#!/usr/bin/env python3
"""Export CENTURY's original browser Canvas artwork as transparent PNGs.

Requires Python Playwright and Chromium; has no npm or runtime dependency.
Does not modify or postprocess the separately generated AI factory artwork.
"""
import base64
import functools
import json
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'sprites'

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('chromium-browser'), args=['--no-sandbox'])
            page = browser.new_page()
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            manifest = page.evaluate("""async () => {
              window.__CENTURY_EXPORT_ASSETS__ = true;
              window.art = await import('/src/render/sprites.js');
              return art.SPRITE_MANIFEST;
            }""")
            count = 0
            for kind in manifest['buildings']:
                images = page.evaluate("""kind => {
                  const out = [];
                  for(let level=1;level<=4;level++)for(let variant=0;variant<4;variant++) {
                    const sprite=art.createSprite(kind,level,variant);
                    out.push({name:`${kind}-${level}-${variant}.png`,data:sprite.image.toDataURL('image/png').split(',')[1],width:sprite.width,height:sprite.height,anchor:[sprite.anchorX,sprite.anchorY]});
                  }
                  return out;
                }""", kind)
                for record in images:
                    (OUT / record['name']).write_bytes(base64.b64decode(record['data']))
                    count += 1
            for variant in range(4):
                data = page.evaluate("v => art.getTreeSprite(v).image.toDataURL('image/png').split(',')[1]", variant)
                (OUT / f'tree-{variant}.png').write_bytes(base64.b64decode(data))
            manifest['pngCount'] = count + 4
            (ROOT / 'assets' / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            browser.close()
        print(f'Exported {count} building sprites + 4 trees to {OUT}')
    finally:
        server.shutdown()

if __name__ == '__main__':
    main()
