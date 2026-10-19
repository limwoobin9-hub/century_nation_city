import { BUILDINGS } from '../../data/buildings.js';
import { tileAt } from '../world/map.js';

const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function adjacentCells(building) {
  const def = BUILDINGS[building.type] || { width: 1, height: 1 };
  const cells = [];
  for (let dx = 0; dx < def.width; dx++) cells.push([building.x + dx, building.y - 1], [building.x + dx, building.y + def.height]);
  for (let dy = 0; dy < def.height; dy++) cells.push([building.x - 1, building.y + dy], [building.x + def.width, building.y + dy]);
  return cells;
}
export function traceNetwork(city, kind, starts) {
  const visited = new Set();
  const queue = [];
  for (const [x, y] of starts) if (tileAt(city, x, y)?.[kind]) { const i = y * city.size + x; if (!visited.has(i)) { visited.add(i); queue.push([x, y]); } }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [x, y] = queue[cursor];
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, index = ny * city.size + nx;
      if (!visited.has(index) && tileAt(city, nx, ny)?.[kind]) { visited.add(index); queue.push([nx, ny]); }
    }
  }
  return visited;
}
export function roadNetwork(city) {
  const halls = city.buildings.filter(b => b.type === 'townhall' && b.active);
  const starts = halls.length ? halls.flatMap(adjacentCells) : [[50, 50]];
  return traceNetwork(city, 'road', starts);
}
export function touchesNetwork(city, building, network) {
  return adjacentCells(building).some(([x, y]) => tileAt(city, x, y) && network.has(y * city.size + x));
}
export function updateConnectivity(city) {
  const roads = roadNetwork(city);
  for (const b of city.buildings) b.connected = touchesNetwork(city, b, roads);
  return roads;
}
export function railwayReady(city) {
  updateConnectivity(city);
  for (const station of city.buildings.filter(b => b.type === 'station' && b.active && b.connected)) {
    if (traceNetwork(city, 'rail', adjacentCells(station)).size >= 8) return true;
  }
  return false;
}
