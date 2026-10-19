/** Pure geometry shared by rendering and pointer interaction. */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export function project(x, y) {
  return { x: (x - y) * TILE_WIDTH / 2, y: (x + y) * TILE_HEIGHT / 2 };
}
export function unproject(x, y) {
  return { x: x / TILE_WIDTH + y / TILE_HEIGHT, y: y / TILE_HEIGHT - x / TILE_WIDTH };
}
export function screenToTile(x, y, view) {
  const p = unproject((x - view.x) / view.zoom, (y - view.y) / view.zoom);
  return { x: Math.floor(p.x + 0.5), y: Math.floor(p.y + 0.5) };
}
export function tileLine(from, to) {
  const points = [];
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), sx = x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - y), sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const double = 2 * error;
    const oldY = y;
    const moveX = double >= dy, moveY = double <= dx;
    if (moveX) { error += dy; x += sx; }
    if (moveY) { error += dx; y += sy; }
    // Orthogonal bridge tiles keep diagonal road/rail strokes connected.
    if (moveX && moveY) points.push({ x, y: oldY });
  }
  return points;
}
/** Follow adjacent rail tiles, preferring the current heading at junctions. */
export function traceRailPath(tiles, size, start, maxLength = 2000) {
  if (!start || !tiles[start.y * size + start.x]?.rail) return [];
  const path = [{ x: start.x, y: start.y }];
  const used = new Set([`${start.x},${start.y}`]);
  let direction = null;
  while (path.length < maxLength) {
    const p = path[path.length - 1];
    const directions = direction
      ? [direction, ...[[0, 1], [1, 0], [0, -1], [-1, 0]].filter(d => d[0] !== direction[0] || d[1] !== direction[1])]
      : [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const next = directions.map(d => ({ x: p.x + d[0], y: p.y + d[1], direction: d }))
      .find(n => n.x >= 0 && n.y >= 0 && n.x < size && n.y < size && tiles[n.y * size + n.x]?.rail && !used.has(`${n.x},${n.y}`));
    if (!next) break;
    direction = next.direction;
    path.push({ x: next.x, y: next.y });
    used.add(`${next.x},${next.y}`);
  }
  return path;
}

/** Shortest real-rail routes between prequalified, road-connected station platforms. */
export function connectRailStations(tiles, size, stations) {
  const routes = [];
  const onRail = p => p.x >= 0 && p.y >= 0 && p.x < size && p.y < size && tiles[p.y * size + p.x]?.rail;
  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
    const station = stations[stationIndex], starts = station.cells.filter(onRail);
    if (!starts.length) continue;
    const parents = new Int32Array(size * size).fill(-2), queue = [];
    for (const p of starts) {
      const index = p.y * size + p.x;
      if (parents[index] === -2) { parents[index] = -1; queue.push(index); }
    }
    const targets = new Map(), found = new Set();
    for (let targetIndex = stationIndex + 1; targetIndex < stations.length; targetIndex++) for (const p of stations[targetIndex].cells.filter(onRail)) {
      const index = p.y * size + p.x;
      if (!targets.has(index)) targets.set(index, []);
      targets.get(index).push(targetIndex);
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % size, y = Math.floor(index / size);
      for (const target of targets.get(index) || []) if (!found.has(target)) {
        found.add(target);
        const path = [];
        for (let current = index; current !== -1; current = parents[current]) path.push({ x: current % size, y: Math.floor(current / size) });
        path.reverse();
        if (path.length >= 4) routes.push({ from: station.id, to: stations[target].id, path });
      }
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, next = ny * size + nx;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || parents[next] !== -2 || !tiles[next]?.rail) continue;
        parents[next] = index; queue.push(next);
      }
    }
  }
  return routes;
}
