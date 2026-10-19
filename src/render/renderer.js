import { BUILDINGS } from '../../data/buildings.js';
import { canPlace, getCity, getBuildingAt } from '../core/game.js';
import * as sprites from './sprites.js';
import { project, unproject, screenToTile, tileLine, connectRailStations } from './geometry.js';
import { roadNetwork, touchesNetwork, adjacentCells } from '../systems/network.js';
import { levelScale, housingCapacity } from '../systems/economy.js';

const TAU = Math.PI * 2;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const PAINT_TOOLS = new Set(['road', 'rail', 'zone-residential', 'zone-commercial', 'zone-industrial']);
const INDUSTRY = new Set(['coal', 'iron', 'textile', 'steel', 'power', 'machine', 'auto', 'chemical', 'refinery', 'industrial', 'shipyard', 'lumber']);
const SERVICE = { education: ['school', 'university'], health: ['hospital'], power: ['power'] };
const SERVICE_RANGES = { school: 10, university: 18, hospital: 11, police: 12, fire: 12, park: 8, museum: 10, theatre: 10, power: 26 };
const hash = (x, y, seed = 0) => {
  let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** A dependency-free, interactive isometric city renderer. State is always read-only. */
export class CityRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.callbacks = callbacks;
    this.state = null;
    this.city = null;
    this.view = { x: 0, y: 0, zoom: 0.78 };
    this.overlay = 'normal';
    this.grid = false;
    this.tool = null;
    this.hover = null;
    this.selected = null;
    this.daylight = 1;
    this.pointer = null;
    this.space = false;
    this.stroke = [];
    this.strokeKeys = new Set();
    this.railPaths = [];
    this.roadTiles = [];
    this.stats = { tiles: 0, buildings: 0, fps: 60 };
    this._bound = [];
    this._buildingHits = [];
    this._hitMasks = new WeakMap();
    this._terrainTextures = new Map();
    this._terrainTextureBytes = 0;
    this._terrainCacheBudget = 8 * 1024 * 1024;
    this._lastTime = 0;
    this._destroyed = false;
    this._didCenter = false;
    this._bindEvents();
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas);
    this._resize();
    Promise.resolve(sprites.loadSprites?.()).catch(error => console.warn('Sprite fallback enabled:', error.message));
    this._frame = requestAnimationFrame(time => this._render(time));
  }

  setState(state) {
    const previous = this.city?.id;
    this.state = state;
    this.city = state ? getCity(state) : null;
    if (!this.city) return;
    this._refreshTransport();
    if (!this._didCenter || previous !== this.city.id) this.center();
  }

  setTool(tool) {
    this.tool = typeof tool === 'object' && tool ? tool.id || tool.type : tool;
    this.stroke = [];
    this.strokeKeys.clear();
    this.canvas.style.cursor = this.tool && this.tool !== 'select' ? 'crosshair' : 'grab';
  }

  setOverlay(id) { this.overlay = id || 'normal'; }
  setGrid(value) { this.grid = Boolean(value); }
  setSelection(building) { this.selected = building?.id || building || null; }
  setSelected(building) { this.setSelection(building); }
  setNight(value) { this.daylight = value ? 0.28 : 1; }
  tileToScreen(x, y) { const p = project(x, y); return { x: p.x * this.view.zoom + this.view.x, y: p.y * this.view.zoom + this.view.y }; }
  setDaylight(value) { this.daylight = clamp(Number(value), 0.2, 1); }

  center() {
    if (!this.city || !this.width || !this.height) return;
    const center = project(this.city.size / 2, this.city.size / 2);
    this.view.x = this.width / 2 - center.x * this.view.zoom;
    this.view.y = this.height * 0.57 - center.y * this.view.zoom;
    this._didCenter = true;
    this.callbacks.onViewChange?.({ ...this.view });
  }

  zoomBy(factor, anchor = { x: this.width / 2, y: this.height / 2 }) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = { x: (anchor.x - this.view.x) / this.view.zoom, y: (anchor.y - this.view.y) / this.view.zoom };
    this.view.zoom = clamp(this.view.zoom * factor, 0.28, 2.4);
    this.view.x = anchor.x - before.x * this.view.zoom;
    this.view.y = anchor.y - before.y * this.view.zoom;
    this.callbacks.onViewChange?.({ ...this.view });
  }

  capture() { return this.canvas.toDataURL('image/png'); }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._frame);
    this._resizeObserver.disconnect();
    for (const [target, name, fn, options] of this._bound) target.removeEventListener(name, fn, options);
    this._bound = [];
    this._terrainTextures.clear();
    this._terrainTextureBytes = 0;
  }

  _bindEvents() {
    const bind = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      this._bound.push([target, name, fn, options]);
    };
    const local = event => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const tileAt = event => {
      const p = local(event);
      return this._pickTile(p);
    };
    bind(this.canvas, 'contextmenu', event => event.preventDefault());
    bind(this.canvas, 'pointerdown', event => {
      if (!this.city) return;
      const tile = tileAt(event);
      if (event.button === 2) {
        event.preventDefault();
        this.callbacks.onTileClick?.({ ...tile, button: 2 });
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(event.pointerId);
      const point = local(event);
      const pan = event.button === 1 || this.space || event.altKey;
      this.pointer = { id: event.pointerId, ...point, lastX: point.x, lastY: point.y, tile, pan, moved: false };
      if (pan) this.canvas.style.cursor = 'grabbing';
      else if (PAINT_TOOLS.has(this.tool)) this._appendStroke(tile);
    });
    bind(this.canvas, 'pointermove', event => {
      const point = local(event);
      const tile = tileAt(event);
      if (this.pointer && this.pointer.id === event.pointerId) {
        const pointer = this.pointer;
        if (Math.hypot(point.x - pointer.x, point.y - pointer.y) > 4) pointer.moved = true;
        if (pointer.pan || (pointer.moved && (!this.tool || this.tool === 'select'))) {
          this.view.x += point.x - pointer.lastX;
          this.view.y += point.y - pointer.lastY;
          this.canvas.style.cursor = 'grabbing';
          this.callbacks.onViewChange?.({ ...this.view });
        } else if (PAINT_TOOLS.has(this.tool)) {
          for (const p of tileLine(pointer.tile, tile)) this._appendStroke(p);
        }
        pointer.tile = tile;
        pointer.lastX = point.x;
        pointer.lastY = point.y;
      }
      this.hover = this._validTile(tile) ? tile : null;
      this.callbacks.onTileHover?.({ ...tile, clientX: event.clientX, clientY: event.clientY });
    });
    const release = event => {
      const pointer = this.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      const tile = tileAt(event);
      if (!pointer.pan) {
        if (PAINT_TOOLS.has(this.tool) && this.stroke.length) {
          if (this.callbacks.onStroke) this.callbacks.onStroke(this.stroke.map(p => ({ ...p })));
          else for (const p of this.stroke) this.callbacks.onTileClick?.({ ...p, button: 0 });
        } else if (!pointer.moved && this._validTile(tile)) {
          if (!this.tool || this.tool === 'select') this.selected = getBuildingAt(this.city, tile.x, tile.y)?.id || null;
          this.callbacks.onTileClick?.({ ...tile, button: 0 });
        }
      }
      this.pointer = null;
      this.stroke = [];
      this.strokeKeys.clear();
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.canvas.style.cursor = this.space ? 'grab' : this.tool && this.tool !== 'select' ? 'crosshair' : 'grab';
    };
    bind(this.canvas, 'pointerup', release);
    bind(this.canvas, 'pointercancel', event => {
      this.pointer = null;
      this.stroke = [];
      this.strokeKeys.clear();
    });
    bind(this.canvas, 'pointerleave', () => { if (!this.pointer) { this.hover = null; this.callbacks.onTileHover?.({ x: -1, y: -1 }); } });
    bind(this.canvas, 'wheel', event => {
      event.preventDefault();
      this.zoomBy(Math.exp(-event.deltaY * 0.0012), local(event));
    }, { passive: false });
    bind(window, 'keydown', event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
      if (event.code === 'Space') { this.space = true; this.canvas.style.cursor = 'grab'; event.preventDefault(); }
    });
    bind(window, 'keyup', event => { if (event.code === 'Space') { this.space = false; this.canvas.style.cursor = this.tool && this.tool !== 'select' ? 'crosshair' : 'grab'; } });
    bind(window, 'blur', () => { this.space = false; this.pointer = null; this.stroke = []; this.strokeKeys.clear(); });
  }

  _pickTile(point) {
    const tile = screenToTile(point.x, point.y, this.view);
    if (this.tool && !['select', 'demolish', 'bulldoze'].includes(this.tool)) return tile;
    const worldX = (point.x - this.view.x) / this.view.zoom;
    const worldY = (point.y - this.view.y) / this.view.zoom;
    for (const hit of this._buildingHits) {
      const { building, def, p } = hit;
      const sprite = this.customSprites?.get(building.type) || sprites.getSprite?.(building.type, building.level || 1, building.variant || 0);
      if (!sprite?.image) continue;
      const left = Math.round(p.x - sprite.anchorX);
      const top = Math.round(p.y + ((def.width || 1) + (def.height || 1)) * 8 - sprite.anchorY);
      const u = Math.floor(worldX - left), v = Math.floor(worldY - top);
      if (u < 0 || v < 0 || u >= sprite.width || v >= sprite.height) continue;
      let mask = this._hitMasks.get(sprite.image);
      if (!mask) {
        try {
          let context = sprite.image.getContext?.('2d', { willReadFrequently: true });
          if (!context) {
            const offscreen = document.createElement('canvas');
            offscreen.width = sprite.width; offscreen.height = sprite.height;
            context = offscreen.getContext('2d', { willReadFrequently: true });
            context.drawImage(sprite.image, 0, 0, sprite.width, sprite.height);
          }
          mask = context.getImageData(0, 0, sprite.width, sprite.height).data;
          this._hitMasks.set(sprite.image, mask);
        } catch { return { x: building.x, y: building.y }; }
      }
      if (mask[(v * sprite.width + u) * 4 + 3] > 64) return { x: building.x, y: building.y };
    }
    return tile;
  }

  _appendStroke(tile) {
    if (!this._validTile(tile)) return;
    const key = `${tile.x},${tile.y}`;
    if (!this.strokeKeys.has(key)) { this.stroke.push(tile); this.strokeKeys.add(key); }
  }

  _validTile(tile) { return Boolean(this.city && tile.x >= 0 && tile.y >= 0 && tile.x < this.city.size && tile.y < this.city.size); }
  _tile(x, y) { return this._validTile({ x, y }) ? this.city.tiles[y * this.city.size + x] : null; }

  _resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (width === this.width && height === this.height && this.dpr === window.devicePixelRatio) return;
    const oldWidth = this.width || width, oldHeight = this.height || height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
    if (this._didCenter) { this.view.x += (width - oldWidth) / 2; this.view.y += (height - oldHeight) / 2; }
    else if (this.city) this.center();
  }

  _refreshTransport() {
    const size = this.city.size;
    this.roadTiles = [];
    for (let i = 0; i < this.city.tiles.length; i++) {
      const tile = this.city.tiles[i];
      const p = { x: i % size, y: Math.floor(i / size) };
      if (tile.road) this.roadTiles.push(p);
    }
    const roads = roadNetwork(this.city);
    const stations = this.city.buildings.filter(building => building.type === 'station' && building.active !== false && touchesNetwork(this.city, building, roads))
      .map(building => ({ id: building.id, cells: adjacentCells(building).map(([x, y]) => ({ x, y })) }));
    this.railPaths = connectRailStations(this.city.tiles, size, stations).slice(0, 8).map(route => route.path);
    this._housingCapacity = housingCapacity(this.city);
    this._occupancy = new Set();
    for (const building of this.city.buildings) {
      const def = BUILDINGS[building.type];
      if (!def) continue;
      for (let y = building.y; y < building.y + (def.height || 1); y++) for (let x = building.x; x < building.x + (def.width || 1); x++) this._occupancy.add(`${x},${y}`);
    }
  }

  _render(time) {
    if (this._destroyed) return;
    this._frame = requestAnimationFrame(next => this._render(next));
    if (!this.ctx || !this.width || !this.height) return;
    if (time - this._lastTime < 26) return;
    const elapsed = time - this._lastTime;
    this.stats.fps = Math.round(1000 / Math.max(elapsed, 1));
    this._lastTime = time;
    this.time = time / 1000;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#b7c3a7';
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.city) return;
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.zoom, this.view.zoom);
    ctx.imageSmoothingEnabled = false;
    const corners = [[0, 0], [this.width, 0], [0, this.height], [this.width, this.height]].map(([x, y]) => unproject((x - this.view.x) / this.view.zoom, (y - this.view.y) / this.view.zoom));
    const x0 = clamp(Math.floor(Math.min(...corners.map(p => p.x))) - 5, 0, this.city.size - 1);
    const y0 = clamp(Math.floor(Math.min(...corners.map(p => p.y))) - 5, 0, this.city.size - 1);
    const x1 = clamp(Math.ceil(Math.max(...corners.map(p => p.x))) + 8, 0, this.city.size - 1);
    const y1 = clamp(Math.ceil(Math.max(...corners.map(p => p.y))) + 8, 0, this.city.size - 1);
    this.stats.tiles = 0;
    this.stats.terrainCacheHits = 0;
    for (let depth = x0 + y0; depth <= x1 + y1; depth++) {
      for (let x = Math.max(x0, depth - y1); x <= Math.min(x1, depth - y0); x++) {
        const y = depth - x;
        const tile = this._tile(x, y);
        if (tile) {
          const p = project(x, y), sx = this.view.x + p.x * this.view.zoom, sy = this.view.y + p.y * this.view.zoom;
          if (sx < -33 * this.view.zoom || sx > this.width + 33 * this.view.zoom || sy < -17 * this.view.zoom || sy > this.height + 17 * this.view.zoom) continue;
          this._drawTerrain(x, y, tile); this.stats.tiles++;
        }
      }
    }
    const entities = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const tile = this._tile(x, y);
      if (tile.terrain === 'forest' && !tile.road && !tile.rail && !this._occupancy.has(`${x},${y}`)) {
        const random = hash(x, y);
        const p = project(x, y), sx = this.view.x + p.x * this.view.zoom, sy = this.view.y + p.y * this.view.zoom;
        if (random > 0.21 && sx > -40 * this.view.zoom && sx < this.width + 40 * this.view.zoom && sy > -10 && sy < this.height + 65 * this.view.zoom) entities.push({ depth: x + y + 0.04, draw: () => this._drawTree(x, y, random) });
      }
    }
    this.stats.buildings = 0;
    this._buildingHits = [];
    for (const building of this.city.buildings) {
      const def = BUILDINGS[building.type] || { width: 1, height: 1 };
      const x = building.x + ((def.width || 1) - 1) / 2;
      const y = building.y + ((def.height || 1) - 1) / 2;
      const p = project(x, y);
      const sx = this.view.x + p.x * this.view.zoom, sy = this.view.y + p.y * this.view.zoom;
      if (sx < -220 * this.view.zoom || sx > this.width + 220 * this.view.zoom || sy < -30 || sy > this.height + 280 * this.view.zoom) continue;
      const depth = building.x + building.y + (def.width || 1) + (def.height || 1) - 2;
      this._buildingHits.push({ building, def, p, depth });
      entities.push({ depth, draw: () => this._drawBuilding(building, def, x, y) });
      this.stats.buildings++;
    }
    this._buildingHits.sort((a, b) => b.depth - a.depth);
    this._addStreetFurniture(entities, x0, y0, x1, y1);
    this._addTraffic(entities, x0, y0, x1, y1);
    this._addTrains(entities);
    entities.sort((a, b) => a.depth - b.depth);
    for (const entity of entities) entity.draw();
    this._drawHighlight();
    this._drawGhost();
    this.stats.terrainCacheEntries = this._terrainTextures.size;
    this.stats.terrainCacheBytes = this._terrainTextureBytes;
    if (this.daylight < 1) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = `rgba(20, 32, 68, ${(1 - this.daylight) * 0.62})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this._drawNightLights();
    }
  }

  _diamond(x, y, fill, stroke, inset = 0) {
    const p = project(x, y), ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 16 + inset);
    ctx.lineTo(p.x + 32 - inset * 2, p.y);
    ctx.lineTo(p.x, p.y + 16 - inset);
    ctx.lineTo(p.x - 32 + inset * 2, p.y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  /** Cache immutable texture geometry, not tile state. Keys contain every visual input. */
  _terrainTexture(key, width, height, paint) {
    let texture = this._terrainTextures.get(key);
    if (texture) {
      this._terrainTextures.delete(key);
      this._terrainTextures.set(key, texture);
      this.stats.terrainCacheHits++;
      return texture;
    }
    const image = document.createElement('canvas');
    image.width = width; image.height = height;
    const context = image.getContext('2d');
    context.imageSmoothingEnabled = false;
    paint(context);
    texture = { image, bytes: width * height * 4 };
    this._terrainTextures.set(key, texture);
    this._terrainTextureBytes += texture.bytes;
    while (this._terrainTextureBytes > this._terrainCacheBudget && this._terrainTextures.size > 1) {
      const oldest = this._terrainTextures.keys().next().value;
      this._terrainTextureBytes -= this._terrainTextures.get(oldest).bytes;
      this._terrainTextures.delete(oldest);
    }
    return texture;
  }

  _groundTexture(point, color, detail = 0) {
    const texture = this._terrainTexture(`ground:${color}:${detail}`, 64, 32, context => {
      context.beginPath(); context.moveTo(32, 0); context.lineTo(64, 16); context.lineTo(32, 32); context.lineTo(0, 16); context.closePath();
      context.fillStyle = color; context.fill();
      if (detail) {
        const seed = detail / 8;
        context.fillStyle = detail > 6 ? '#c1c494' : '#8fa471';
        context.fillRect(23 + Math.floor(seed * 20), 13, 2, 1);
        context.fillRect(41 - Math.floor(seed * 12), 21, 3, 1);
      }
    });
    this.ctx.drawImage(texture.image, point.x - 32, point.y - 16);
  }

  _transportTexture(kind, x, y, tile) {
    const point = project(x, y);
    const connections = DIRECTIONS.reduce((mask, [dx, dy], index) => mask | (this._tile(x + dx, y + dy)?.[kind] ? 1 << index : 0), 0);
    const texture = this._terrainTexture(`${kind}:${connections}:${kind === 'road' && tile?.terrain === 'water' ? 1 : 0}`, 96, 64, context => {
      context.translate(48 - point.x, 32 - point.y);
      const previous = this.ctx;
      this.ctx = context;
      try {
        if (kind === 'road') this._paintRoad(x, y, tile);
        else this._paintRail(x, y);
      } finally { this.ctx = previous; }
    });
    this.ctx.drawImage(texture.image, point.x - 48, point.y - 32);
  }

  _drawTerrain(x, y, tile) {
    const ctx = this.ctx, p = project(x, y), r = hash(x, y);
    if (tile.terrain === 'water') {
      this._groundTexture(p, ['#669fa1', '#6da7a7', '#72aaaa', '#6ba3a5'][Math.floor(r * 4)]);
      const phase = (this.time * 0.4 + r * 7) % 1;
      ctx.strokeStyle = `rgba(196, 224, 208, ${0.18 + Math.sin(phase * Math.PI) * 0.23})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 11 + r * 10, p.y - 2);
      ctx.lineTo(p.x - 3 + r * 12, p.y - 2);
      ctx.moveTo(p.x + 4, p.y + 4);
      ctx.lineTo(p.x + 12, p.y + 4);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const [dx, dy] = DIRECTIONS[i];
        if (this._tile(x + dx, y + dy)?.terrain === 'water') continue;
        const edge = [[[32, 0], [0, 16]], [[0, 16], [-32, 0]], [[-32, 0], [0, -16]], [[0, -16], [32, 0]]][i];
        ctx.beginPath(); ctx.moveTo(p.x + edge[0][0], p.y + edge[0][1]); ctx.lineTo(p.x + edge[1][0], p.y + edge[1][1]);
        ctx.strokeStyle = '#c6c7a2'; ctx.lineWidth = 3; ctx.stroke();
      }
    } else {
      const colors = tile.terrain === 'forest' ? ['#829667', '#85986a', '#899c6c', '#8c9d6e', '#829568'] : ['#a4b383', '#a7b686', '#aab888', '#a4b183', '#a8b589', '#acb98b'];
      const detail = r > 0.56 && !tile.road && !tile.rail && !this._occupancy.has(`${x},${y}`) ? 1 + Math.floor(r * 7) : 0;
      this._groundTexture(p, colors[Math.floor(r * colors.length)], detail);
      if (tile.zone && !this._occupancy.has(`${x},${y}`)) this._diamond(x, y, { residential: '#7eae8c55', commercial: '#779daa55', industrial: '#c4ae6c55' }[tile.zone], { residential: '#82a684', commercial: '#849fa9', industrial: '#b4a46e' }[tile.zone], 1);
    }
    if (tile.road) this._transportTexture('road', x, y, tile);
    if (tile.rail) this._transportTexture('rail', x, y, tile);
    if (this.grid) this._diamond(x, y, null, 'rgba(59, 73, 52, 0.19)');
    if (this.overlay !== 'normal') {
      const value = this._overlayValue(x, y, tile);
      if (value !== null) {
        const hue = this.overlay === 'pollution' || this.overlay === 'unemployment' || this.overlay === 'traffic' ? 115 - value * 115 : 8 + value * 142;
        this._diamond(x, y, `hsla(${hue}, 63%, 52%, 0.46)`);
      }
    }
  }

  _paintRoad(x, y, tile) {
    const ctx = this.ctx, p = project(x, y);
    const adjacent = DIRECTIONS.filter(([dx, dy]) => this._tile(x + dx, y + dy)?.road);
    if (tile.terrain === 'water') {
      this._diamond(x, y, '#a89d85', '#887d68', 1);
      ctx.fillStyle = '#675f54'; ctx.fillRect(p.x - 2, p.y + 10, 3, 8);
    }
    ctx.lineCap = 'butt';
    const road = (color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      for (const [dx, dy] of adjacent) { const q = project(dx / 2, dy / 2); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + q.x, p.y + q.y); }
      ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(p.x, p.y, width / 1.6, width / 3.2, 0, 0, TAU); ctx.fill();
    };
    road('#b7af93', 22);
    road('#d0c6a9', 17);
    ctx.strokeStyle = '#a69e87'; ctx.lineWidth = 0.6;
    for (const [dx, dy] of adjacent) {
      const q = project(dx / 2, dy / 2);
      ctx.beginPath(); ctx.moveTo(p.x + q.x * 0.5 - 2, p.y + q.y * 0.5); ctx.lineTo(p.x + q.x * 0.5 + 1, p.y + q.y * 0.5 + 1.5); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  _paintRail(x, y) {
    const ctx = this.ctx, p = project(x, y);
    let adjacent = DIRECTIONS.filter(([dx, dy]) => this._tile(x + dx, y + dy)?.rail);
    if (!adjacent.length) adjacent = [[0, -1], [0, 1]];
    for (const [dx, dy] of adjacent) {
      const q = project(dx / 2, dy / 2), length = Math.hypot(q.x, q.y), nx = -q.y / length, ny = q.x / length;
      ctx.lineWidth = 15; ctx.strokeStyle = '#9b9b86';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + q.x, p.y + q.y); ctx.stroke();
      for (let i = 0; i <= 4; i++) {
        const a = i / 4;
        ctx.strokeStyle = '#786e57'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x + q.x * a - nx * 6, p.y + q.y * a - ny * 6); ctx.lineTo(p.x + q.x * a + nx * 6, p.y + q.y * a + ny * 6); ctx.stroke();
      }
      for (const offset of [-3.5, 3.5]) {
        ctx.strokeStyle = '#59615b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x + nx * offset, p.y + ny * offset); ctx.lineTo(p.x + q.x + nx * offset, p.y + q.y + ny * offset); ctx.stroke();
        ctx.strokeStyle = '#ced0ba'; ctx.lineWidth = 0.65;
        ctx.beginPath(); ctx.moveTo(p.x + nx * offset - 0.5, p.y + ny * offset - 0.5); ctx.lineTo(p.x + q.x + nx * offset - 0.5, p.y + q.y + ny * offset - 0.5); ctx.stroke();
      }
    }
  }

  _drawTree(x, y, variant) {
    const p = project(x, y), ctx = this.ctx;
    const sprite = sprites.getTreeSprite?.(Math.floor(variant * 4));
    if (sprite?.image) { ctx.drawImage(sprite.image, p.x - sprite.anchorX, p.y - sprite.anchorY, sprite.width, sprite.height); return; }
    ctx.fillStyle = '#66765330'; ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 3, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#77694b'; ctx.fillRect(p.x - 1, p.y - 13, 3, 16);
    const height = 22 + Math.floor(variant * 10);
    ctx.fillStyle = '#567b50'; ctx.fillRect(p.x - 10, p.y - height, 20, 17); ctx.fillRect(p.x - 6, p.y - height - 6, 12, 26);
    ctx.fillStyle = '#72935b'; ctx.fillRect(p.x - 9, p.y - height, 12, 12); ctx.fillRect(p.x - 5, p.y - height - 5, 8, 8);
    ctx.fillStyle = '#829e62'; ctx.fillRect(p.x - 4, p.y - height - 4, 5, 4);
  }

  _drawBuilding(building, def, x, y) {
    const ctx = this.ctx, p = project(x, y);
    const selected = this.selected === building.id;
    if (selected) this._footprint(building.x, building.y, def.width || 1, def.height || 1, '#f5d48860', '#f6e5a3');
    ctx.fillStyle = '#34492f24'; ctx.beginPath(); ctx.ellipse(p.x + 9, p.y + 4, (def.width + def.height) * 12, (def.width + def.height) * 5, 0, 0, TAU); ctx.fill();
    const custom = this.customSprites?.get(building.type);
    const sprite = custom || sprites.getSprite?.(building.type, building.level || 1, building.variant || 0);
    if (sprite?.image) {
      const opacity = this.overlay === 'normal' ? 1 : 0.82;
      ctx.globalAlpha = building.active === false ? 0.66 : opacity;
      ctx.drawImage(sprite.image, Math.round(p.x - sprite.anchorX), Math.round(p.y + ((def.width || 1) + (def.height || 1)) * 8 - sprite.anchorY), sprite.width, sprite.height);
      ctx.globalAlpha = 1;
    } else this._fallbackBuilding(p, building, def);
    if (INDUSTRY.has(building.type) && building.active !== false) this._drawSmoke(p.x + 4, p.y - 44 - (building.level || 1) * 10, hash(building.x, building.y), 0.7);
    if (building.type === 'house' && hash(building.x, building.y) > 0.75) this._drawSmoke(p.x + 5, p.y - 31, hash(building.x, building.y), 0.3);
    if (building.active === false && this.view.zoom > 0.5) {
      ctx.fillStyle = '#d4b46f'; ctx.fillRect(p.x - 4, p.y - 42, 9, 9); ctx.fillStyle = '#66583c'; ctx.fillRect(p.x, p.y - 40, 1, 3); ctx.fillRect(p.x, p.y - 36, 1, 1);
    }
  }

  _fallbackBuilding(p, building, def) {
    const ctx = this.ctx, width = Math.min(56, (def.width || 1) * 23), h = 20 + (building.level || 1) * 7;
    ctx.fillStyle = def.color || '#bbac8f';
    ctx.beginPath(); ctx.moveTo(p.x - width, p.y - 11); ctx.lineTo(p.x, p.y + 11); ctx.lineTo(p.x, p.y + 11 - h); ctx.lineTo(p.x - width, p.y - 11 - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9a927e'; ctx.beginPath(); ctx.moveTo(p.x, p.y + 11); ctx.lineTo(p.x + width, p.y - 11); ctx.lineTo(p.x + width, p.y - 11 - h); ctx.lineTo(p.x, p.y + 11 - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#756e65'; ctx.beginPath(); ctx.moveTo(p.x - width - 2, p.y - 11 - h); ctx.lineTo(p.x, p.y - 27 - h); ctx.lineTo(p.x + width + 2, p.y - 11 - h); ctx.lineTo(p.x, p.y + 5 - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ece1ac'; for (let i = 0; i < 3; i++) ctx.fillRect(p.x - width + 7 + i * 9, p.y - h + i * 4, 3, 5);
  }

  _drawSmoke(x, y, seed, density = 1) {
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) {
      const age = (this.time * 0.2 + seed + i / 4) % 1;
      const radius = 2 + age * 7 * density;
      ctx.fillStyle = `rgba(211, 207, 187, ${(1 - age) * 0.26 * density})`;
      ctx.beginPath(); ctx.ellipse(x + age * 19 + Math.sin(age * 6 + seed * 10) * 2, y - age * 47, radius, radius * 0.75, 0, 0, TAU); ctx.fill();
    }
  }

  _addStreetFurniture(entities, x0, y0, x1, y1) {
    this._lamps = [];
    for (const tile of this.roadTiles) {
      if (tile.x < x0 || tile.y < y0 || tile.x > x1 || tile.y > y1 || hash(tile.x, tile.y) < 0.46) continue;
      const neighbors = DIRECTIONS.filter(([dx, dy]) => this._tile(tile.x + dx, tile.y + dy)?.road).length;
      if (neighbors < 3) continue;
      const p = project(tile.x, tile.y);
      this._lamps.push({ x: p.x + 9, y: p.y - 14 });
      entities.push({ depth: tile.x + tile.y + 0.2, draw: () => {
        const ctx = this.ctx;
        ctx.fillStyle = '#6b715a'; ctx.fillRect(p.x + 8, p.y - 12, 1, 13);
        ctx.fillStyle = '#4d5b4b'; ctx.fillRect(p.x + 6, p.y - 16, 5, 1); ctx.fillRect(p.x + 7, p.y - 17, 3, 1);
        ctx.fillStyle = this.daylight < 0.7 ? '#f6d682' : '#d8d3a9'; ctx.fillRect(p.x + 7, p.y - 15, 3, 3);
        ctx.fillStyle = '#4d5b4b'; ctx.fillRect(p.x + 6, p.y - 12, 5, 1);
      } });
    }
  }

  _drawNightLights() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const p of this._lamps || []) {
      const x = p.x * this.view.zoom + this.view.x, y = p.y * this.view.zoom + this.view.y;
      const radius = 15 * this.view.zoom;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, '#edb75790'); glow.addColorStop(0.25, '#c38f3840'); glow.addColorStop(1, '#bd893000');
      ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillStyle = '#ffe7a7'; ctx.fillRect(x - this.view.zoom, y - this.view.zoom, 2 * this.view.zoom, 2 * this.view.zoom);
    }
    ctx.restore();
  }

  _addTraffic(entities, x0, y0, x1, y1) {
    if (!this.roadTiles.length) return;
    const count = Math.min(65, Math.max(8, Math.floor(this.roadTiles.length * 0.24)));
    for (let index = 0; index < count; index++) {
      const seed = hash(index, 173, this.state.seed || 0);
      const startIndex = Math.floor(seed * this.roadTiles.length);
      const tile = this.roadTiles[startIndex];
      if (tile.x < x0 || tile.y < y0 || tile.x > x1 || tile.y > y1) continue;
      const directions = DIRECTIONS.filter(([dx, dy]) => this._tile(tile.x + dx, tile.y + dy)?.road);
      if (!directions.length) continue;
      const [dx, dy] = directions[index % directions.length];
      const progress = (this.time * (index % 3 === 0 ? 0.19 : 0.09) + seed) % 1;
      const x = tile.x + dx * progress, y = tile.y + dy * progress;
      entities.push({ depth: x + y + 0.02, draw: () => {
        const p = project(x, y), ctx = this.ctx;
        if (index % 3) {
          const sidewalk = index % 2 ? 5 : -5;
          ctx.fillStyle = '#394a453d'; ctx.fillRect(p.x + sidewalk - 1, p.y + 1, 3, 2);
          ctx.fillStyle = ['#7d5647', '#4c686d', '#525750', '#9a875f'][index % 4]; ctx.fillRect(p.x + sidewalk - 1, p.y - 5, 3, 5);
          ctx.fillStyle = '#dbc2a0'; ctx.fillRect(p.x + sidewalk, p.y - 7, 2, 2);
          ctx.fillStyle = '#4a4c40'; const step = Math.sin(this.time * 6 + index) > 0 ? 1 : 0; ctx.fillRect(p.x + sidewalk - 1, p.y, 1, 2 + step); ctx.fillRect(p.x + sidewalk + 1, p.y, 1, 3 - step);
        } else this._drawVehicle(x, y, dx, dy, ['#586b66', '#8b5242', '#b69b65', '#565c67'][index % 4]);
      } });
    }
  }

  _drawVehicle(x, y, dx, dy, color) {
    const p = project(x, y), ctx = this.ctx;
    const angle = Math.atan2(project(dx, dy).y, project(dx, dy).x);
    ctx.save(); ctx.translate(p.x, p.y - 2); ctx.rotate(angle);
    ctx.fillStyle = '#535449'; ctx.fillRect(-6, -2, 13, 5);
    ctx.fillStyle = color; ctx.fillRect(-6, -5, 12, 6);
    ctx.fillStyle = '#b8c3b4'; ctx.fillRect(-1, -5, 4, 4);
    ctx.fillStyle = '#333f3b'; ctx.fillRect(-4, 1, 3, 2); ctx.fillRect(3, 1, 3, 2);
    ctx.fillStyle = '#e6dbaa'; ctx.fillRect(6, -3, 1, 2);
    ctx.restore();
  }

  _addTrains(entities) {
    for (let index = 0; index < this.railPaths.length; index++) {
      const path = this.railPaths[index], length = path.length - 1;
      const tail = Math.min(2.16, length - 0.1);
      const run = length - tail;
      const speed = 0.75, dwell = 2, duration = run / speed;
      const travel = (this.time + index * 17) % (2 * (duration + dwell));
      const reverse = travel >= duration + dwell;
      const head = travel < duration ? tail + travel * speed : travel < duration + dwell ? length : travel < duration * 2 + dwell ? length - (travel - duration - dwell) * speed : tail;
      for (let car = 0; car < 4; car++) {
        const distance = clamp(head - car * 0.72, 0, length - 0.001);
        const segment = Math.floor(distance), fraction = distance - segment;
        const a = path[segment], b = path[segment + 1];
        const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
        entities.push({ depth: x + y + 0.05, draw: () => this._drawTrainCar(x, y, b.x - a.x, b.y - a.y, car === 0, reverse) });
      }
    }
  }

  _drawTrainCar(x, y, dx, dy, locomotive, reverse) {
    const p = project(x, y), ctx = this.ctx;
    const center = project(dx * 0.3, dy * 0.3);
    const perpendicular = project(dy * 0.1, -dx * 0.1);
    const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: p.x + center.x * a + perpendicular.x * b, y: p.y + center.y * a + perpendicular.y * b }));
    const height = locomotive ? 10 : 9;
    ctx.fillStyle = '#303f3a'; ctx.beginPath(); points.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.fill();
    ctx.fillStyle = locomotive ? '#405b53' : '#805b47';
    ctx.beginPath(); ctx.moveTo(points[1].x, points[1].y); ctx.lineTo(points[2].x, points[2].y); ctx.lineTo(points[2].x, points[2].y - height); ctx.lineTo(points[1].x, points[1].y - height); ctx.closePath(); ctx.fill();
    ctx.fillStyle = locomotive ? '#4c685a' : '#a17756';
    ctx.beginPath(); ctx.moveTo(points[2].x, points[2].y); ctx.lineTo(points[3].x, points[3].y); ctx.lineTo(points[3].x, points[3].y - height); ctx.lineTo(points[2].x, points[2].y - height); ctx.closePath(); ctx.fill();
    ctx.fillStyle = locomotive ? '#31473f' : '#c3ac7b';
    ctx.beginPath(); points.forEach((q, i) => { if (i) ctx.lineTo(q.x, q.y - height); else ctx.moveTo(q.x, q.y - height); }); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2e3c37'; ctx.fillRect(p.x - 4, p.y - 2, 3, 3); ctx.fillRect(p.x + 4, p.y - 2, 3, 3);
    if (locomotive) {
      const end = reverse ? -1 : 1;
      ctx.fillStyle = '#333e37'; ctx.fillRect(p.x + center.x * end * 0.5 - 2, p.y + center.y * end * 0.5 - 16, 4, 7);
      this._drawSmoke(p.x + center.x * end * 0.5, p.y + center.y * end * 0.5 - 16, 0.33, 0.8);
    }
  }

  _footprint(x, y, w, h, fill, stroke) {
    const ctx = this.ctx;
    const corners = [project(x - 0.5, y - 0.5), project(x + w - 0.5, y - 0.5), project(x + w - 0.5, y + h - 0.5), project(x - 0.5, y + h - 0.5)];
    ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  _drawHighlight() {
    const selectedBuilding = this.city.buildings.find(building => building.id === this.selected);
    if (selectedBuilding) {
      const def = BUILDINGS[selectedBuilding.type] || {};
      this._footprint(selectedBuilding.x, selectedBuilding.y, def.width || 1, def.height || 1, null, '#f8dfa0');
    }
    if (selectedBuilding && SERVICE_RANGES[selectedBuilding.type]) this._drawServiceRadius(selectedBuilding.x, selectedBuilding.y, this._serviceRadius(selectedBuilding));
    if (!this.hover || (this.tool && this.tool !== 'select')) return;
    const building = getBuildingAt(this.city, this.hover.x, this.hover.y);
    if (building) {
      const def = BUILDINGS[building.type] || {};
      this._footprint(building.x, building.y, def.width || 1, def.height || 1, 'rgba(255, 235, 164, .12)', '#fff0b1');
    } else this._diamond(this.hover.x, this.hover.y, '#fff1b221', '#f2e9bc', 1);
  }

  _drawGhost() {
    if (!this.hover || !this.tool || this.tool === 'select') return;
    const ctx = this.ctx;
    const tiles = this.stroke.length ? this.stroke : [this.hover];
    const definition = BUILDINGS[this.tool];
    if (this.tool === 'demolish' || this.tool === 'bulldoze') {
      const target = getBuildingAt(this.city, this.hover.x, this.hover.y);
      const def = BUILDINGS[target?.type] || {};
      this._footprint(target?.x ?? this.hover.x, target?.y ?? this.hover.y, def.width || 1, def.height || 1, '#b84c3c66', '#ffd0ad');
      return;
    }
    for (const tile of tiles) {
      const result = canPlace(this.state, this.tool, tile.x, tile.y);
      const valid = result === true || result?.ok;
      const fill = valid ? '#eff2c265' : '#bd594c70';
      const line = valid ? '#f7e9ad' : '#efac8d';
      this._footprint(tile.x, tile.y, definition?.width || 1, definition?.height || 1, fill, line);
    }
    if (definition) {
      const sprite = sprites.getSprite?.(this.tool, 1, 0);
      if (sprite?.image) {
        const p = project(this.hover.x + ((definition.width || 1) - 1) / 2, this.hover.y + ((definition.height || 1) - 1) / 2);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(sprite.image, p.x - sprite.anchorX, p.y + ((definition.width || 1) + (definition.height || 1)) * 8 - sprite.anchorY, sprite.width, sprite.height);
        ctx.globalAlpha = 1;
      }
    }
    if (definition && SERVICE_RANGES[this.tool]) this._drawServiceRadius(this.hover.x, this.hover.y, this._serviceRadius({ type: this.tool, level: 1 }));
  }

  _drawServiceRadius(x, y, radius) {
    for (let ty = Math.max(0, y - radius); ty <= Math.min(this.city.size - 1, y + radius); ty++) for (let tx = Math.max(0, x - radius); tx <= Math.min(this.city.size - 1, x + radius); tx++) {
      const distance = Math.hypot(tx - x, ty - y);
      if (distance <= radius && distance > radius - 1) this._diamond(tx, ty, '#f6e8a733');
    }
  }

  _serviceRadius(building) {
    return (SERVICE_RANGES[building.type] || 0) * (1 + ((building.level || 1) - 1) * 0.15);
  }

  _operatingStrength(building) {
    if (!building.active || !building.connected || building.budget <= 0) return 0;
    const utilization = Math.max(0, Number(building.utilization) || 0);
    const operation = Number.isFinite(building.operatingScale) ? Math.max(0, building.operatingScale) / levelScale(building) : utilization;
    return Math.min(utilization, operation);
  }

  _serviceStrength(building) {
    let strength = this._operatingStrength(building) * Math.min(1, building.budget / 100);
    if (['school', 'university'].includes(building.type)) strength *= Math.max(0, this.state.policies.education / 100);
    if (building.type === 'hospital') strength *= Math.max(0, this.state.policies.healthcare / 100);
    if (building.type === 'power') {
      const inputs = BUILDINGS[building.type]?.inputs || {};
      if (Object.entries(inputs).some(([resource, amount]) => amount > 0 && (this.city.stock[resource] || 0) <= 0)) return 0;
    }
    return clamp(strength, 0, 1);
  }

  _localPollution(x, y) {
    const pollution = this.city.buildings.reduce((sum, building) => {
      const weight = BUILDINGS[building.type]?.pollution || 0;
      if (!weight || !this._operatingStrength(building)) return sum;
      const attenuation = clamp(1 - Math.hypot(building.x - x, building.y - y) / 12, 0, 1);
      const output = Number.isFinite(building.operatingScale) ? Math.max(0, building.operatingScale) : this._operatingStrength(building) * levelScale(building);
      return sum + weight * output * attenuation;
    }, 0);
    return clamp(pollution / 30, 0, 1);
  }

  _overlayValue(x, y, tile) {
    if (tile.terrain === 'water') return null;
    const building = getBuildingAt(this.city, x, y);
    const def = BUILDINGS[building?.type];
    const nearby = (types, radius = 12) => this.city.buildings.reduce((value, provider) => {
      if (!types.includes(provider.type)) return value;
      return Math.max(value, clamp(1 - Math.hypot(provider.x - x, provider.y - y) / radius, 0, 1) * this._operatingStrength(provider));
    }, 0);
    if (SERVICE[this.overlay]) {
      return this.city.buildings.reduce((value, provider) => {
        if (!SERVICE[this.overlay].includes(provider.type)) return value;
        const radius = this._serviceRadius(provider), distance = Math.hypot(provider.x - x, provider.y - y);
        if (distance > radius) return value;
        return Math.max(value, this._serviceStrength(provider) * (1 - distance / Math.max(1, radius) * 0.5));
      }, 0);
    }
    if (this.overlay === 'pollution') return this._localPollution(x, y);
    if (this.overlay === 'industry') {
      const productive = this.city.buildings.filter(provider => BUILDINGS[provider.type]?.category === 'industrial');
      return clamp(productive.reduce((value, provider) => Math.max(value, this._operatingStrength(provider) * clamp(1 - Math.hypot(provider.x - x, provider.y - y) / 6, 0, 1)), 0), 0, 1);
    }
    if (this.overlay === 'population') {
      if (!building?.active || def?.category !== 'residential') return 0;
      const occupancy = clamp(this.city.population / Math.max(1, this._housingCapacity ?? housingCapacity(this.city)), 0, 1);
      return clamp((def.capacity || 0) * levelScale(building) * occupancy / Math.max(1, def.width * def.height) / 260, 0, 1);
    }
    if (this.overlay === 'traffic') return tile.road ? clamp(0.2 + nearby(['shop', 'station', 'textile', 'townhall'], 9) * 0.75, 0, 1) : 0;
    if (this.overlay === 'unemployment') return clamp((this.city.unemployment || 0) / 30 + (def?.category === 'residential' ? 0.2 : 0), 0, 1);
    if (this.overlay === 'happiness') return clamp((building?.happiness ?? this.city.happiness ?? 50) / 100, 0, 1);
    if (this.overlay === 'landvalue') return building && def?.category === 'residential' ? clamp((building.landValue || 0) / 100, 0, 1) : clamp(0.35 + nearby(['park', 'bank', 'townhall', 'museum'], 14) * 0.5 - this._localPollution(x, y) * 0.4, 0, 1);
    return null;
  }
}
