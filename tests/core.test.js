import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../data/buildings.js';
import { COUNTRIES, countryName, countryCapital } from '../data/countries.js';
import { TECHNOLOGIES } from '../data/technologies.js';
import { createGame, getCity, place, canPlace, demolish, undo, tick, startResearch, setPolicy, connectCities, upgradeBuilding, getBuildingAt, metrics, refreshStats, housingCapacity, tileAt, runElection, reformGovernment, makeTradeAgreement } from '../src/core/game.js';
import { STOCK_KEYS, footprint } from '../src/world/map.js';
import { railwayReady } from '../src/systems/network.js';
const copy = value => JSON.parse(JSON.stringify(value));

test('building/technology/country data uses valid footprints, resources, references and historical years', () => {
  assert.ok(COUNTRIES.length >= 11);
  for (const def of Object.values(BUILDINGS)) {
    assert.ok(def.width >= 1 && def.width <= 4 && def.height >= 1 && def.height <= 4);
    assert.ok(def.cost > 0 && def.upkeep >= 0);
    for (const key of [...Object.keys(def.inputs || {}), ...Object.keys(def.production || {})]) assert.ok(STOCK_KEYS.includes(key), `${def.id}:${key}`);
    for (const id of def.requires || []) assert.ok(TECHNOLOGIES[id], id);
  }
  for (const tech of Object.values(TECHNOLOGIES)) {
    assert.ok(tech.year >= 1850 && tech.year <= 1950);
    for (const id of tech.requires) assert.ok(TECHNOLOGIES[id]);
  }
  assert.equal(countryName('korea', 1850), '조선');
  assert.equal(countryName('korea', 1900), '대한제국');
  assert.equal(countryName('korea', 1948), '대한민국');
  assert.equal(countryCapital('japan', 1850), '에도');
  assert.equal(countryCapital('japan', 1900), '도쿄');
  assert.equal(countryCapital('italy', 1867), '피렌체');
  assert.equal(countryCapital('russia', 1936), '모스크바');
});

test('three dense seeded cities have valid nonoverlapping lots, two connected rail stations and actual town roads', () => {
  const state = createGame();
  assert.equal(state.version, 1);
  assert.equal(state.cities.length, 3);
  assert.equal(metrics(state).population, 8600);
  for (const city of state.cities) {
    assert.equal(city.tiles.length, 10000);
    assert.ok(city.buildings.length >= 100);
    assert.ok(railwayReady(city));
    assert.equal(city.buildings.filter(b => b.type === 'station').length, 2);
    const occupied = new Set();
    for (const b of city.buildings) for (const p of footprint(b.type, b.x, b.y)) {
      const index = p.y * city.size + p.x;
      assert.ok(!occupied.has(index), `overlapping ${b.type}`);
      assert.ok(!city.tiles[index].road && !city.tiles[index].rail);
      occupied.add(index);
    }
    assert.ok(city.buildings.every(b => b.connected));
    assert.ok(city.buildings.some(b => b.type === 'textile' && b.variant === 0 && b.x < 52 && b.y < 52));
  }
});

test('start year changes names, government, unlocked facilities and visible development levels', () => {
  const early = createGame({ year: 1850 });
  const later = createGame({ year: 1936 });
  assert.equal(early.countryLabel, '조선');
  assert.equal(early.government, 'monarchy');
  assert.equal(createGame({country:'britain',year:1900}).government,'constitutional');
  assert.equal(createGame({country:'italy',year:1850}).government,'constitutional');
  assert.equal(createGame({country:'germany',year:1850}).government,'constitutional');
  assert.equal(createGame({country:'france',year:1850}).government,'republic');
  assert.ok(early.cities[0].buildings.every(b => b.level === 1));
  assert.ok(!early.cities[0].buildings.some(b => b.type === 'power' || b.type === 'steel'));
  assert.ok(later.cities[0].buildings.some(b => b.level >= 3));
  assert.ok(later.research.completed.includes('assembly_line'));
  assert.equal(createGame({ year: 1800 }).date.year, 1850);
  assert.equal(createGame({ year: 2100 }).date.year, 1950);
});

test('custom nation options persist real national population and industry/regime parameters', () => {
  const state = createGame({ country: 'custom', name: '새벽연방', capital: '청람', population: 24000, industry: 1.5, government: '의원내각제 공화국', color: '#123abc', year: 1870 });
  assert.equal(state.countryLabel, '새벽연방');
  assert.equal(state.cities[0].name, '청람');
  assert.equal(state.government, 'parliamentary');
  assert.equal(state.industryLevel, 1.5);
  assert.equal(state.flagColor, '#123abc');
  assert.equal(metrics(state).population, 24000);
  tick(state);
  assert.equal(state.countryLabel, '새벽연방');
});

test('construction spends actual money/materials, occupies footprint, and undo restores both', () => {
  const state = createGame(), city = getCity(state), before = state.money, wood = city.stock.wood;
  const preview = canPlace(state, 'house', 30, 50);
  assert.equal(preview.ok, true);
  const result = place(state, 'house', 30, 50);
  assert.equal(result.ok, true);
  assert.equal(state.money, before - preview.cost);
  assert.equal(city.stock.wood, wood - preview.materials.wood);
  assert.equal(getBuildingAt(city, 30, 50).id, result.building.id);
  assert.equal(canPlace(state, 'house', 30, 50).ok, false);
  assert.equal(undo(state).ok, true);
  assert.equal(state.money, before);
  assert.equal(city.stock.wood, wood);
  assert.equal(getBuildingAt(city, 30, 50), null);
});

test('invalid placements and insufficient treasury/materials are atomic', () => {
  const state = createGame(), city = getCity(state);
  state.money = 0;
  const snapshot = JSON.stringify(state);
  assert.equal(place(state, 'house', 30, 50).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
  state.money = 100000;
  city.stock.wood = 0;
  assert.equal(place(state, 'house', 30, 50).ok, false);
  assert.equal(place(state, 'farm', 99, 99).ok, false);
  const water = city.tiles.findIndex(t => t.terrain === 'water');
  assert.equal(place(state, 'house', water % 100, Math.floor(water / 100)).ok, false);
  assert.equal(place(state, 'unknown', 30, 50).ok, false);
  assert.equal(place(state, 'house', -1, 0).ok, false);
});

test('demolition refund, restored buildings, preserved buildings and level expansion stay consistent', () => {
  const state = createGame(), city = getCity(state);
  const home = city.buildings.find(b => b.type === 'house' && b.level === 1);
  const initialMoney = state.money, initialLevel = home.level;
  assert.equal(upgradeBuilding(state, home.id).ok, true);
  assert.equal(home.level, initialLevel + 1);
  assert.equal(undo(state).ok, true);
  assert.equal(home.level, initialLevel);
  assert.equal(state.money, initialMoney);
  home.preserved = true;
  assert.equal(demolish(state, home.x, home.y).ok, false);
  assert.equal(upgradeBuilding(state, home.id).ok, false);
  home.preserved = false;
  assert.equal(demolish(state, home.x, home.y).ok, true);
  assert.equal(getBuildingAt(city, home.x, home.y), null);
  assert.equal(undo(state).ok, true);
  assert.equal(getBuildingAt(city, home.x, home.y).id, home.id);
  assert.equal(state.money, initialMoney);
});

test('roads and rails cross, cost different resources, and undo restores terrain and steel', () => {
  const state = createGame(), city = getCity(state);
  const before = copy(tileAt(city, 30, 50)), steel = city.stock.steel, money = state.money;
  assert.equal(place(state, 'road', 30, 50).ok, true);
  assert.equal(place(state, 'rail', 30, 50).ok, true);
  assert.equal(tileAt(city, 30, 50).road && tileAt(city, 30, 50).rail, true);
  assert.equal(city.stock.steel, steel - 1);
  assert.equal(undo(state).ok, true);
  assert.equal(tileAt(city, 30, 50).rail, false);
  assert.equal(undo(state).ok, true);
  assert.deepEqual(tileAt(city, 30, 50), before);
  assert.equal(city.stock.steel, steel);
  assert.equal(state.money, money);
});

test('a road cut stops a disconnected factory and reconnecting restores real output', () => {
  const state = createGame(), city = getCity(state);
  city.buildings = [];
  for (const t of city.tiles) { t.road = false; t.rail = false; }
  for (let x = 50; x <= 52; x++) assert.equal(place(state, 'road', x, 50).ok, true);
  const { building } = place(state, 'industrial', 52, 51);
  tick(state);
  assert.ok(building.production > 0);
  assert.equal(demolish(state, 51, 50).ok, true);
  tick(state);
  assert.equal(building.connected, false);
  assert.equal(building.production, 0);
  assert.equal(place(state, 'road', 51, 50).ok, true);
  tick(state);
  assert.equal(building.connected, true);
  assert.ok(building.production > 0);
});

test('factory production is constrained by input inventories and reduces real input stocks', () => {
  const state = createGame(), city = getCity(state);
  const factory = city.buildings.find(b => b.type === 'industrial');
  for (const b of city.buildings) if (BUILDINGS[b.type].production && b !== factory) b.active = false;
  city.stock.wood = 0; city.stock.coal = 0;
  tick(state);
  assert.equal(factory.production, 0);
  assert.equal(factory.utilization, 0);
  city.stock.wood = 100; city.stock.coal = 100;
  tick(state);
  assert.ok(factory.production > 0);
  assert.ok(city.stock.wood < 100 && city.stock.coal < 100);
  assert.ok(factory.employees > 0);
  assert.ok(city.gdp > 0);
});

test('additional industrial jobs reduce unemployment when labor is available', () => {
  const state = createGame(), city = getCity(state);
  city.population = 20000;
  refreshStats(state);
  const before = city.unemployment;
  for (let x = 30; x <= 34; x++) if (!tileAt(city, x, 49).road) place(state, 'road', x, 49);
  const result = place(state, 'industrial', 30, 47);
  assert.equal(result.ok, true);
  refreshStats(state);
  assert.ok(result.building.employees > 0);
  assert.ok(city.unemployment < before);
});

test('monthly national budget balances exactly with recorded tax, upkeep and debt interest', () => {
  const state = createGame();
  state.debt = 10000;
  const money = state.money;
  tick(state);
  const m = metrics(state);
  assert.equal(state.money, money + m.income - m.expenses);
  assert.equal(m.balance, m.income - m.expenses);
  const taxBefore = m.income;
  assert.equal(setPolicy(state, 'incomeTax', 25).ok, true);
  assert.ok(metrics(state).income > taxBefore);
  assert.equal(setPolicy(state, 'incomeTax', 999).ok, true);
  assert.equal(state.policies.incomeTax, 50);
  assert.equal(setPolicy(state, 'missing', 5).ok, false);
});

test('housing/roads and funded services support population growth with accounted demographics', () => {
  const state = createGame(), city = getCity(state), population = metrics(state).population;
  for (let x = 31; x <= 33; x++) place(state, 'road', x, 50);
  assert.equal(place(state, 'house', 30, 50).ok, true);
  for (let i = 0; i < 12; i++) tick(state);
  assert.ok(metrics(state).population > population);
  const last = city.demographics;
  assert.ok(last.births >= 0 && last.deaths >= 0 && last.immigration >= 0 && last.emigration >= 0);
  assert.ok(last.employed <= last.laborForce);
  assert.equal(Object.keys(city.classes).length, 6);
});

test('public facilities have spatial coverage and reducing budget reduces cost and service', () => {
  const state = createGame(), city = getCity(state);
  refreshStats(state);
  const coverage = city.services.hospital, cost = city.expenses;
  assert.ok(coverage > 0 && coverage < 100);
  city.buildings.find(b => b.type === 'hospital').budget = 0;
  refreshStats(state);
  assert.equal(city.services.hospital, 0);
  assert.ok(city.expenses < cost);
});

test('zoned private development follows housing demand and existing houses grow visibly in level', () => {
  const state = createGame(), city = getCity(state);
  city.population = Math.round(housingCapacity(city) * 0.91);
  city.happiness = 95; city.education = 80; city.health = 80;
  for (const b of city.buildings) b.age = 24;
  for (let x = 32; x <= 33; x++) place(state, 'road', x, 50);
  assert.equal(place(state, 'zone-residential', 31, 50).ok, true);
  const levels = Object.fromEntries(city.buildings.map(b => [b.id, b.level]));
  tick(state);
  assert.equal(getBuildingAt(city, 31, 50)?.type, 'house');
  assert.ok(city.buildings.some(b => levels[b.id] && b.level > levels[b.id]));
});

test('research deducts once, requires prerequisites, takes months and unlocks power placement', () => {
  const state = createGame(), before = state.money;
  assert.equal(canPlace(state, 'power', 30, 46).ok, false);
  assert.equal(startResearch(state, 'electricity').ok, true);
  assert.equal(state.money, before - TECHNOLOGIES.electricity.cost);
  assert.equal(startResearch(state, 'mass_education').ok, false);
  for (let i = 0; i < TECHNOLOGIES.electricity.months; i++) tick(state);
  assert.ok(state.research.completed.includes('electricity'));
  assert.equal(state.research.active, null);
  assert.equal(canPlace(state, 'power', 30, 46).ok, true);
  const early = createGame({ year: 1850 });
  assert.equal(startResearch(early, 'electricity').ok, false);
});

test('city rail routes pay cost, transfer only available surplus and suspend without stations', () => {
  const state = createGame(), [a, b] = state.cities;
  a.stock.food = 10000; b.stock.food = 0;
  const disconnected = copy(state), money = state.money;
  assert.equal(connectCities(state, a.id, b.id).ok, true);
  assert.equal(state.money, money - 12000);
  assert.equal(connectCities(state, b.id, a.id).ok, false);
  tick(state); tick(disconnected);
  assert.ok(b.stock.food > disconnected.cities[1].stock.food);
  assert.ok(state.connections[0].lastTrade > 0 && state.connections[0].lastTrade <= 180);
  for (const station of b.buildings.filter(building => building.type === 'station')) station.active = false;
  tick(state);
  assert.equal(state.connections[0].active, false);
  assert.equal(state.connections[0].lastTrade, 0);
});

test('elections/reforms/trade agreements use money and produce persisted material outcomes', () => {
  const state = createGame({ country: 'usa' }), money = state.money;
  assert.equal(runElection(state).ok, true);
  assert.equal(state.money, money - 1500);
  assert.equal(runElection(state).ok, false);
  assert.ok(state.politics.lastElection.turnout >= 45);
  assert.equal(reformGovernment(state, 'parliamentary').ok, true);
  assert.equal(state.government, 'parliamentary');
  assert.equal(makeTradeAgreement(state, 'china').ok, true);
  assert.equal(makeTradeAgreement(state, 'china').ok, false);
  tick(state);
  assert.ok(state.diplomacy.agreements[0].lastExports.length > 0);
  assert.ok(state.diplomacy.agreements[0].lastExports.every(e => e.amount > 0 && e.value > 0));
  assert.equal(runElection(createGame({ country: 'korea', year: 1850 })).ok, false);
});

test('foreign resource ledgers record counterpart imports/exports against finite evolving markets', () => {
  const state = createGame({ country: 'usa' });
  assert.equal(makeTradeAgreement(state, 'china').ok, true);
  const baseline = copy(state);
  baseline.diplomacy.agreements = [];
  state.cities[0].stock.food = 0;
  baseline.cities[0].stock.food = 0;
  tick(state); tick(baseline);
  const agreement = state.diplomacy.agreements[0], market = state.diplomacy.markets.china, control = baseline.diplomacy.markets.china;
  assert.ok(market.development > 1);
  assert.ok(agreement.lastExports.length && agreement.lastImports.length);
  for (const resource of STOCK_KEYS) {
    const sold = agreement.lastExports.filter(x => x.resource === resource).reduce((sum, x) => sum + x.amount, 0);
    const bought = agreement.lastImports.filter(x => x.resource === resource).reduce((sum, x) => sum + x.amount, 0);
    assert.ok(Math.abs(market.stock[resource] - control.stock[resource] - sold + bought) < 0.001);
    assert.equal(market.imports[resource] || 0, sold);
    assert.equal(market.exports[resource] || 0, bought);
    assert.ok(market.stock[resource] >= 0);
  }
});

test('deterministic monthly outcomes are identical after serialization and do not use Math.random', () => {
  const first = createGame(), second = copy(first), originalRandom = Math.random;
  Math.random = () => { throw new Error('Simulation must be deterministic'); };
  try {
    for (let i = 0; i < 36; i++) { tick(first); tick(second); }
    assert.deepEqual(first, second);
  } finally { Math.random = originalRandom; }
});

test('calendar transitions update country labels and stop after the historical 1950 endpoint', () => {
  const state = createGame({ year: 1896 });
  state.date.month = 12;
  tick(state);
  assert.equal(state.countryLabel, '대한제국');
  assert.deepEqual(state.date, { year: 1897, month: 1 });
  state.date = { year: 1950, month: 12 };
  const before = JSON.stringify(state);
  assert.equal(tick(state).ok, false);
  assert.equal(JSON.stringify(state), before);
});
