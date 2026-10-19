# CENTURY artwork

All game art in this directory was created for this project. No proprietary game assets, screenshots, stock sprites or external sprite packs are used.

- `sprites/*.png`: 560 original transparent building sprites, covering all 35 historical building definitions (1850–1950), four construction levels and four palette/layout variants, plus four original transparent tree sprites. The source is `src/render/sprites.js`. Canvas geometry uses 64 × 32 tiles, 2:1 isometric projection, a warm restrained palette and light from the upper left. Details include brick courses, mullioned windows, doors, tiled roofs, chimneys, shop awnings, station platforms, mine headframes, port cranes, civic towers, farm rows, park fountains and foliage. Different levels increase floors, towers or industrial capacity; palette variants change brickwork, glazing and roofs.
- `ai-textile.png`: a separately generated original historical red-brick textile factory, produced by the available image generation tool for this project. The original 1536 × 1024 RGBA output is preserved without postprocessing. The factory is integrated in the playable city as the textile building's variant 0. Other textile variants use the original Canvas sprites. Its building silhouette includes arched factory windows, sawtooth roofs, stone foundations and a tall brick smokestack.
- `manifest.json`: machine-readable inventory and projection metadata.

The game initially loads the exported PNGs. Its synchronous procedural fallback draws the same original geometry if an image is unavailable, so missing network assets do not prevent play. A user can replace each building type through the local sprite import interface; image data is kept in local saves, never uploaded to a service.

To regenerate the procedural PNGs, run `python scripts/generate-assets.py` with Python Playwright and a Chromium binary available. Regeneration leaves the separately generated AI factory untouched. This export helper is optional; the browser game has no runtime dependencies.

Sprites report a bottom-centre anchor. A building's footprint midpoint is `(width + height) * 8` pixels above that anchor, where width and height are the building definition's tile dimensions. The renderer applies this ground-plane correction. Trees report their trunk's ground position directly.
