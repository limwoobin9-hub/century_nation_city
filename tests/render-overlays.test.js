import test from 'node:test';
import assert from 'node:assert/strict';
import { CityRenderer } from '../src/render/renderer.js';
import { createGame, getCity, refreshStats, setPolicy } from '../src/core/game.js';
import { adjacentCells } from '../src/systems/network.js';

function fixture(year = 1900) {
  const state = createGame({ year });
  const city = getCity(state);
  const renderer = Object.create(CityRenderer.prototype);
  Object.assign(renderer, { state, city });
  return { state, city, renderer };
}
const at = (renderer, building) => renderer._overlayValue(building.x, building.y, renderer.city.tiles[building.y * renderer.city.size + building.x]);

test('education overlay responds to provider budget, public policy, activity and actual road access', () => {
  const { state, city, renderer } = fixture();
  renderer.overlay = 'education';
  const school = city.buildings.find(b => b.type === 'school');
  const baseline = at(renderer, school);
  assert.ok(baseline > 0);
  school.budget = 25; refreshStats(state);
  assert.ok(at(renderer, school) < baseline);
  setPolicy(state, 'education', 0); refreshStats(state);
  assert.equal(at(renderer, school), 0);
  setPolicy(state, 'education', 100); school.budget = 100; refreshStats(state);
  school.active = false; refreshStats(state);
  assert.equal(at(renderer, school), 0);
  school.active = true;
  for (const [x,y] of adjacentCells(school)) city.tiles[y * city.size + x].road = false;
  refreshStats(state);
  assert.equal(school.connected, false);
  assert.equal(at(renderer, school), 0);
});

test('medical overlay responds to actual healthcare policy and operating utilization', () => {
  const { state, city, renderer } = fixture();
  renderer.overlay = 'health';
  const hospital = city.buildings.find(b => b.type === 'hospital');
  assert.ok(at(renderer, hospital) > 0);
  setPolicy(state, 'healthcare', 0); refreshStats(state);
  assert.equal(at(renderer, hospital), 0);
  setPolicy(state, 'healthcare', 100); refreshStats(state);
  hospital.utilization = 0; hospital.operatingScale = 0;
  assert.equal(at(renderer, hospital), 0);
});

test('service map and selection rings use simulation radii with actual level expansion', () => {
  const { renderer } = fixture();
  for (const [type,radius] of Object.entries({ school:10, university:18, hospital:11, power:26, police:12, fire:12, park:8, museum:10, theatre:10 })) {
    assert.equal(renderer._serviceRadius({ type, level:1 }), radius);
    assert.equal(renderer._serviceRadius({ type, level:4 }), radius * 1.45);
  }
});

test('power overlay disappears when its current fuel supply is empty', () => {
  const { state, city, renderer } = fixture(1936);
  renderer.overlay = 'power';
  const plant = city.buildings.find(b => b.type === 'power');
  assert.ok(plant && at(renderer, plant) > 0);
  city.stock.coal = 0;
  assert.equal(at(renderer, plant), 0);
  city.stock.coal = 600; refreshStats(state);
  assert.ok(at(renderer, plant) > 0);
});

test('pollution map weights actual emitting output and gives farms zero industrial pollution', () => {
  const { city, renderer } = fixture();
  renderer.overlay = 'pollution';
  const farm = city.buildings.find(b => b.type === 'farm');
  const coal = city.buildings.find(b => b.type === 'coal');
  city.buildings = [farm];
  assert.equal(at(renderer, farm), 0);
  city.buildings = [coal];
  Object.assign(coal, { active:true, connected:true, budget:100, utilization:1, operatingScale:1 });
  const baseline = at(renderer, coal);
  assert.ok(baseline > 0);
  coal.operatingScale = 0.5;
  assert.equal(at(renderer, coal), baseline * 0.5);
  coal.operatingScale = 0;
  assert.equal(at(renderer, coal), 0);
  coal.operatingScale = 1; coal.active = false;
  assert.equal(at(renderer, coal), 0);
});

test('population density follows real city occupancy and the selected home development level', () => {
  const { city, renderer } = fixture();
  renderer.overlay = 'population';
  const home = city.buildings.find(b => b.type === 'house' && b.level === 1);
  const baseline = at(renderer, home);
  assert.ok(baseline > 0);
  city.population /= 2;
  assert.equal(at(renderer, home), baseline * 0.5);
  const lowPopulation = at(renderer, home);
  home.level = 2;
  assert.ok(at(renderer, home) > lowPopulation);
  home.active = false;
  assert.equal(at(renderer, home), 0);
});
