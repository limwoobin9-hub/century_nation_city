import { BUILDINGS } from '../../data/buildings.js';

export const MAP_SIZE = 100;
export const STOCK_KEYS = ['food', 'wood', 'coal', 'iron', 'steel', 'goods', 'oil', 'fuel'];
export function tileAt(city, x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < city.size && y < city.size ? city.tiles[y * city.size + x] : null;
}
export function footprint(type, x, y) {
  const def = BUILDINGS[type] || { width: 1, height: 1 };
  const cells = [];
  for (let dy = 0; dy < def.height; dy++) for (let dx = 0; dx < def.width; dx++) cells.push({ x: x + dx, y: y + dy });
  return cells;
}
export function buildingAt(city, x, y) {
  return city.buildings.find(b => {
    const d = BUILDINGS[b.type] || { width: 1, height: 1 };
    return x >= b.x && y >= b.y && x < b.x + d.width && y < b.y + d.height;
  }) || null;
}
export function makeBuilding(id, type, x, y, variant = 0) {
  return { id, type, x, y, level: 1, variant: variant % 4, name: BUILDINGS[type]?.name || type, active: true, budget: 100, age: 0, employees: 0, production: 0, utilization: 0, profit: 0, preserved: false, connected: true, happiness: 65, landValue: 50 };
}
function hash(x, y, seed) {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return (n ^ n >>> 16) >>> 0;
}
export function createCity({ id, name, mapX, mapY, population, seed = 1, year = 1900, research = [], industryLevel = 1 }) {
  const size = MAP_SIZE;
  const city = { id, name, mapX, mapY, size, tiles: [], buildings: [], population, happiness: 67, education: 48, health: 65, unemployment: 8, gdp: 0, pollution: 12, stock: { food: 2800, wood: 1600, coal: 600, iron: 400, steel: 260, goods: 900, oil: 200, fuel: 100 }, income: 0, expenses: 0, demand: { residential: 50, commercial: 50, industrial: 50 }, services: {}, lastFoodSatisfaction: 1, lastGoodsSatisfaction: 1 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const river = 76 + Math.round(Math.sin((y + seed % 11) / 12) * 2);
    const terrain = x >= river && x <= river + 3 ? 'water' : (x < 29 || y < 25 || y > 77 || x >= 73) && hash(x, y, seed) % 100 < 43 ? 'forest' : 'grass';
    city.tiles.push({ terrain, road: false, rail: false, zone: null });
  }
  for (let y = 34; y <= 66; y++) for (let x = 34; x <= 66; x++) {
    const t = tileAt(city, x, y);
    t.terrain = 'grass';
    if ((x - 34) % 4 === 0 || (y - 34) % 4 === 0) t.road = true;
  }
  // A real uninterrupted railway runs beside the town, with a road crossing at the station.
  for (let y = 25; y <= 75; y++) { const t = tileAt(city, 68, y); t.terrain = 'grass'; t.rail = true; }
  for (let x = 66; x <= 73; x++) { const t = tileAt(city, x, 48); t.terrain = 'grass'; t.road = true; }
  for (let y = 48; y <= 51; y++) tileAt(city, 68, y).road = true;
  const lots = [
    ['farm', 'farm', 'lumber', 'coal', 'iron', 'steel', 'bank', 'power'],
    ['warehouse', 'house', 'house', 'house', 'shop', 'house', 'house', 'house'],
    ['house', 'house', 'school', 'house', 'park', 'house', 'hospital', 'house'],
    ['house', 'shop', 'house', 'textile', 'townhall', 'house', 'shop', 'house'],
    ['house', 'house', 'police', 'house', 'park', 'house', 'fire', 'house'],
    ['house', 'house', 'house', 'house', 'shop', 'house', 'house', 'house'],
    ['farm', 'house', 'house', 'house', 'industrial', 'house', 'house', 'house'],
    ['house', 'house', 'shop', 'house', 'house', 'house', 'house', 'house'],
  ];
  let next = 0;
  lots.forEach((row, rowIndex) => row.forEach((baseType, colIndex) => {
    let type = baseType;
    if (type === 'power' && !research.includes('electricity')) type = 'warehouse';
    if (type === 'steel' && !research.includes('steelmaking')) type = 'industrial';
    if (!BUILDINGS[type]) return;
    const x = 35 + colIndex * 4, y = 35 + rowIndex * 4;
    const building = makeBuilding(`${id}-seed-${next++}`, type, x, y, type === 'textile' ? 0 : (rowIndex + colIndex + seed) % 4);
    if (year >= 1870 && ['house', 'shop'].includes(type) && (rowIndex + colIndex) % 2 === 0) building.level = year >= 1920 ? 3 : 2;
    if (year >= 1936 && ['house', 'shop'].includes(type) && rowIndex >= 2 && rowIndex <= 5 && colIndex >= 2 && colIndex <= 5) building.level = 4;
    if (industryLevel > 1.1 && BUILDINGS[type].category === 'industrial' && year >= 1870) building.level = 2;
    city.buildings.push(building);
    if (type === 'house') {
      city.buildings.push(makeBuilding(`${id}-seed-${next++}`, 'house', x + 2, y, (rowIndex + colIndex + seed + 1) % 4));
      if ((rowIndex + colIndex) % 3 === 0) city.buildings.push(makeBuilding(`${id}-seed-${next++}`, 'house', x, y + 2, (rowIndex + seed + 2) % 4));
    }
  }));
  city.buildings.push(makeBuilding(`${id}-seed-${next++}`, 'station', 69, 49, seed % 4));
  for (let y = 66; y <= 68; y++) { const t = tileAt(city, 66, y); t.terrain = 'grass'; t.road = true; }
  for (let x = 66; x <= 73; x++) { const t = tileAt(city, x, 68); t.terrain = 'grass'; t.road = true; }
  for (let y = 68; y <= 70; y++) { const t = tileAt(city, 68, y); t.road = true; }
  city.buildings.push(makeBuilding(`${id}-seed-${next++}`, 'station', 69, 69, (seed + 1) % 4));
  return city;
}
