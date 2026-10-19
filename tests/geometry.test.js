import test from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, screenToTile, tileLine, traceRailPath } from '../src/render/geometry.js';

test('tile picking matches projection across panning, zoom, and negative coordinates', () => {
  for (const zoom of [0.28, 0.78, 2.4]) for (const [x, y] of [[0, 0], [50, 50], [99, 31], [-3, 17]]) {
    const view = { x: 413.4, y: -820.7, zoom };
    const point = project(x, y);
    assert.deepEqual(unproject(point.x, point.y), { x, y });
    assert.deepEqual(screenToTile(point.x * zoom + view.x, point.y * zoom + view.y, view), { x, y });
  }
});

test('painting interpolates fast pointer moves in every octant without missing a tile', () => {
  for (const end of [{ x: 8, y: 2 }, { x: 2, y: 8 }, { x: -8, y: 2 }, { x: 2, y: -8 }, { x: -8, y: -3 }]) {
    const line = tileLine({ x: 0, y: 0 }, end);
    assert.deepEqual(line[0], { x: 0, y: 0 });
    assert.deepEqual(line.at(-1), end);
    for (let i = 1; i < line.length; i++) {
      const dx = Math.abs(line[i].x - line[i - 1].x), dy = Math.abs(line[i].y - line[i - 1].y);
      assert.equal(dx + dy, 1);
    }
    assert.equal(new Set(line.map(p => `${p.x},${p.y}`)).size, line.length);
  }
});

test('trains follow only adjacent real rail tiles around corners and stop at missing connections', () => {
  const size = 10, tiles = Array.from({ length: size * size }, () => ({ rail: false }));
  const expected = [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }];
  for (const p of [...expected, { x: 6, y: 3 }]) tiles[p.y * size + p.x].rail = true;
  const path = traceRailPath(tiles, size, expected[0]);
  assert.deepEqual(path, expected);
  assert.deepEqual(traceRailPath(tiles, size, { x: 0, y: 0 }), []);
});

test('closed rail loops terminate without repeating tiles', () => {
  const size = 4, tiles = Array.from({ length: 16 }, () => ({ rail: false }));
  for (const [x, y] of [[1, 1], [1, 2], [2, 2], [2, 1]]) tiles[y * size + x].rail = true;
  const path = traceRailPath(tiles, size, { x: 1, y: 1 });
  assert.equal(path.length, 4);
  assert.equal(new Set(path.map(p => `${p.x},${p.y}`)).size, 4);
});

test('a route requires two stations joined by rail and follows the shortest connected branch', async () => {
  const { connectRailStations } = await import('../src/render/geometry.js');
  const size = 9, tiles = Array.from({ length: size * size }, () => ({ rail: false }));
  const line = [[2,1],[2,2],[2,3],[2,4],[2,5],[3,3],[4,3],[5,3],[6,3]];
  for (const [x,y] of line) tiles[y * size + x].rail = true;
  const stations = [{ id: 'a', cells: [{ x: 2, y: 1 }] }, { id: 'b', cells: [{ x: 6, y: 3 }] }];
  assert.deepEqual(connectRailStations(tiles, size, stations.slice(0, 1)), []);
  let routes = connectRailStations(tiles, size, stations);
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0].path, [{x:2,y:1},{x:2,y:2},{x:2,y:3},{x:3,y:3},{x:4,y:3},{x:5,y:3},{x:6,y:3}]);
  tiles[3 * size + 4].rail = false;
  assert.deepEqual(connectRailStations(tiles, size, stations), []);
});
