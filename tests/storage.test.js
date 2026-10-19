import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SaveError, validateState, exportGame, importGame, saveGame, loadGame, listSlots, deleteSave, MAX_SAVE_BYTES } from '../src/save/storage.js';

const originalStorage = globalThis.localStorage;
const originalIndexedDB = globalThis.indexedDB;
const records = new Map();
let quotaExceeded = false;

beforeEach(() => {
  records.clear();
  quotaExceeded = false;
  globalThis.indexedDB = undefined;
  globalThis.localStorage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => {
      if (quotaExceeded) throw new DOMException('Full', 'QuotaExceededError');
      records.set(key, String(value));
    },
    removeItem: (key) => records.delete(key),
  };
});
after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
});

function state() {
  return {
    version: 1, seed: 42, nextId: 1, country: 'korea', countryLabel: '대한제국', government: 'constitutional', flagColor: '#547766',
    date: { year: 1900, month: 1 }, money: 100000, debt: 0,
    policies: { incomeTax: 15, corporateTax: 18, education: 100, healthcare: 100, industry: 0, tariff: 10 },
    cities: [{
      id: 'capital', name: '한성', mapX: 20, mapY: 30, size: 16,
      tiles: Array.from({ length: 16 * 16 }, () => ({ terrain: 'grass', road: false, rail: false, zone: null })),
      buildings: [{ id: 'b1', type: 'house', x: 5, y: 5, level: 1, variant: 0, name: '벽돌 주택', active: true, preserved: false, budget: 100, age: 0, employees: 0, production: 0, utilization: 0, profit: 0 }],
      population: 100, happiness: 75, education: 50, health: 65, unemployment: 10, gdp: 2000, pollution: 5,
      stock: { food: 100, wood: 50, coal: 50, iron: 50, steel: 0, goods: 50, oil: 0, fuel: 0 }, income: 100, expenses: 50,
    }],
    activeCity: 'capital', research: { completed: [], active: null, progress: 0 },
    history: [{ year: 1900, month: 1, population: 100, gdp: 2000, happiness: 75, money: 100000, unemployment: 10 }],
    events: [{ year: 1900, month: 1, title: '새로운 세기', text: '한성을 경영하세요.' }], connections: [], undo: [], customAssets: [],
  };
}
async function changedDocument(change) {
  const document = JSON.parse(await exportGame(state()).text());
  change(document);
  return new Blob([JSON.stringify(document)]);
}

test('JSON export/import preserves complete game state and is independent of the live state', async () => {
  const original = state();
  const blob = exportGame(original);
  original.money = 1;
  const restored = await importGame(blob);
  assert.equal(blob.type, 'application/json');
  assert.equal(restored.money, 100000);
  assert.deepEqual(restored.cities[0].tiles, original.cities[0].tiles);
  assert.notEqual(restored.cities[0], original.cities[0]);
});

test('localStorage fallback saves manual and auto slots, metadata, replacement and deletion', async () => {
  assert.equal(await loadGame(0), null);
  const original = state();
  const metadata = await saveGame(original, 2);
  assert.equal(metadata.id, 2);
  assert.equal(metadata.population, 100);
  assert.equal(metadata.country, 'korea');
  assert.ok(Date.parse(metadata.savedAt));
  await saveGame(original, 'auto');
  original.money = 45000;
  await saveGame(original, 2);
  assert.equal((await loadGame(2)).money, 45000);
  assert.deepEqual((await listSlots()).map((entry) => entry.id), [2, 'auto']);
  await deleteSave(2);
  assert.equal(await loadGame(2), null);
  assert.equal((await listSlots()).length, 1);
});

test('custom image bytes and custom building references survive export and save', async () => {
  const original = state();
  original.customAssets = [{ id: 'custom-house', name: '내 픽셀 주택', baseType: 'house', cost: 1000, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=' }];
  original.cities[0].buildings[0].type = 'custom-house';
  const imported = await importGame(exportGame(original));
  assert.deepEqual(imported.customAssets, original.customAssets);
  await saveGame(imported);
  assert.equal((await loadGame()).customAssets[0].dataUrl, original.customAssets[0].dataUrl);
});

test('checksum rejects valid-looking edited state without overwriting the previous save', async () => {
  await saveGame(state());
  await assert.rejects(importGame(await changedDocument((document) => { document.state.money = 999999; })), { code: 'CHECKSUM_MISMATCH' });
  assert.equal((await loadGame()).money, 100000);
});

test('rejects invalid versions, malformed JSON, and unwrapped state', async () => {
  await assert.rejects(importGame(await changedDocument((document) => { document.formatVersion = 2; })), { code: 'INCOMPATIBLE_VERSION' });
  await assert.rejects(importGame(new Blob(['{oops'])), { code: 'INVALID_SAVE' });
  await assert.rejects(importGame(new Blob([JSON.stringify(state())])), { code: 'INCOMPATIBLE_VERSION' });
  const original = state();
  original.version = 999;
  assert.throws(() => exportGame(original), { code: 'INCOMPATIBLE_VERSION' });
});

test('rejects structural corruption, invalid coordinates, broken references and duplicate identities', () => {
  const mutations = [
    (s) => s.cities[0].tiles.pop(),
    (s) => { s.cities[0].buildings[0].x = 16; },
    (s) => { s.cities[0].buildings[0].type = 'farm'; s.cities[0].buildings[0].x = 15; },
    (s) => { s.cities[0].buildings[0].type = 'unknown-building'; },
    (s) => { s.cities[0].buildings[0].type = 'toString'; },
    (s) => { s.activeCity = 'missing'; },
    (s) => { s.date.month = 0; },
    (s) => { s.cities[0].tiles[0].terrain = 'lava'; },
    (s) => { s.cities[0].tiles[0].road = 'true'; },
    (s) => s.cities[0].buildings.push({ ...s.cities[0].buildings[0] }),
    (s) => s.cities[0].buildings.push({ ...s.cities[0].buildings[0], id: 'b2' }),
    (s) => s.connections.push({ a: 'capital', b: 'missing' }),
    (s) => { s.cities[0].buildings[0].type = 'custom-missing'; },
    (s) => { s.research.active = 'teleportation'; },
    (s) => { s.country = 'unknown'; },
    (s) => { s.nextId = undefined; },
    (s) => s.undo.push({ kind: 'tile', cityId: 'capital', cost: 0, materials: {}, tiles: [{ index: 999999, tile: s.cities[0].tiles[0] }] }),
    (s) => { s.politics = { stability: 55, support: 'fifty' }; },
    (s) => { s.diplomacy = { agreements: [{ countryId: 'missing' }], relations: {} }; },
    (s) => { s.diplomacy = { agreements: [], relations: {}, markets: [] }; },
    (s) => { s.diplomacy = { agreements: [], relations: {}, markets: { japan: { development: 1, stock: [], imports: {}, exports: {} } } }; },
    (s) => { s.cities[0].demographics = []; },
    (s) => { s.cities[0].classes = { workers: { population: -5, averageIncome: 10 } }; },
  ];
  for (const mutate of mutations) {
    const original = state();
    mutate(original);
    assert.throws(() => validateState(original), SaveError);
  }
});

test('rejects non-JSON numbers, getters, cycles, and prototype-pollution keys', () => {
  const nonFinite = state();
  nonFinite.money = Infinity;
  assert.throws(() => exportGame(nonFinite), SaveError);
  const cyclic = state();
  cyclic.self = cyclic;
  assert.throws(() => validateState(cyclic), SaveError);
  const accessor = state();
  Object.defineProperty(accessor, 'trap', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => validateState(accessor), SaveError);
  const polluted = state();
  polluted.extra = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateState(polluted), SaveError);
  assert.equal({}.polluted, undefined);
});

test('rejects executable, remote, disguised and oversized custom assets', () => {
  for (const dataUrl of ['https://example.org/image.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,SGVsbG8h', `data:image/png;base64,${'A'.repeat(1_500_000)}`]) {
    const original = state();
    original.customAssets = [{ id: 'custom-bad', name: '이미지', dataUrl, baseType: 'house', cost: 1000 }];
    assert.throws(() => validateState(original), SaveError);
  }
});

test('rejects oversized input before reading its content', async () => {
  await assert.rejects(importGame({ size: MAX_SAVE_BYTES + 5000, text() { throw new Error('must not read'); } }), { code: 'SAVE_TOO_LARGE' });
});

test('invalid slots fail explicitly and cannot write arbitrary keys', async () => {
  for (const slot of [-1, 3, '0', '__proto__', undefined]) {
    // undefined selects the default argument by design.
    if (slot === undefined) continue;
    await assert.rejects(saveGame(state(), slot), { code: 'INVALID_SLOT' });
    await assert.rejects(loadGame(slot), { code: 'INVALID_SLOT' });
    await assert.rejects(deleteSave(slot), { code: 'INVALID_SLOT' });
  }
  assert.equal(records.size, 0);
});

test('quota errors are explicit and preserve the last good save', async () => {
  await saveGame(state());
  quotaExceeded = true;
  const changed = state();
  changed.money = 4;
  await assert.rejects(saveGame(changed), { code: 'QUOTA_EXCEEDED' });
  assert.equal((await loadGame()).money, 100000);
});

test('unavailable storage and corrupt slot data produce useful errors', async () => {
  records.set('century-nation-city:save:0', 'broken JSON');
  await assert.rejects(loadGame(), { code: 'INVALID_SAVE' });
  await assert.rejects(listSlots(), { code: 'INVALID_SAVE' });
  globalThis.localStorage = undefined;
  await assert.rejects(saveGame(state()), { code: 'STORAGE_UNAVAILABLE' });
});

test('real simulation actions, undo records, research, trade and elections survive a save roundtrip', async () => {
  const { createGame, place, demolish, upgradeBuilding, connectCities, startResearch, runElection, makeTradeAgreement, tick } = await import('../src/core/game.js');
  // The United States starts as a republic; an election is valid without reform.
  const game = createGame({ country: 'usa', year: 1900 });
  for (const [offset, type] of ['road', 'rail', 'zone-residential', 'house'].entries()) {
    assert.equal(place(game, type, 30 + offset, 30).ok, true);
  }
  const building = game.cities[0].buildings.at(-1);
  assert.equal(upgradeBuilding(game, building.id).ok, true);
  assert.equal(demolish(game, building.x, building.y).ok, true);
  assert.equal(connectCities(game, 'capital', 'harbor').ok, true);
  assert.equal(startResearch(game, 'electricity').ok, true);
  assert.equal(runElection(game).ok, true);
  assert.equal(makeTradeAgreement(game, 'japan').ok, true);
  for (let i = 0; i < 6; i++) tick(game);
  const restored = await importGame(exportGame(game));
  assert.deepEqual(restored, game);
  assert.equal(restored.undo.length, 6);
  assert.ok(restored.diplomacy.agreements[0].lastExports.length > 0);
});
