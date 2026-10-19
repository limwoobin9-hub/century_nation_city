import { BUILDINGS } from '../../data/buildings.js';
import { COUNTRIES, countryName, countryCapital } from '../../data/countries.js';
import { TECHNOLOGIES } from '../../data/technologies.js';
import { createCity, tileAt, footprint, buildingAt, makeBuilding } from '../world/map.js';
import { updateConnectivity, roadNetwork, touchesNetwork, railwayReady } from '../systems/network.js';
import { updateEconomy, exchangeGoods, housingCapacity, levelScale, clamp } from '../systems/economy.js';
import { advanceGovernance, advanceForeignTrade, createDiplomacy, election, reform, tradeAgreement } from '../systems/governance.js';

const clone = value => JSON.parse(JSON.stringify(value));
const fail = reason => ({ ok: false, reason });
const cleanName = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
const REGIONS = {
  korea: ['부산', '평양'], japan: ['오사카', '교토'], britain: ['맨체스터', '리버풀'], france: ['리옹', '마르세유'], germany: ['함부르크', '뮌헨'], usa: ['뉴욕', '시카고'], russia: ['모스크바', '카잔'], china: ['상하이', '광저우'], italy: ['밀라노', '나폴리'], austria: ['그라츠', '잘츠부르크'], custom: ['신항', '강원'],
};
export function getCity(state) { return state.cities.find(city => city.id === state.activeCity) || state.cities[0]; }
export const getBuildingAt = buildingAt;
export { tileAt, housingCapacity };
export function logEvent(state, title, text = '') {
  state.events.unshift({ year: state.date.year, month: state.date.month, title, text });
  state.events.length = Math.min(state.events.length, 200);
}
export function metrics(state) {
  const population = state.cities.reduce((sum, city) => sum + city.population, 0);
  const weighted = key => population ? state.cities.reduce((sum, city) => sum + city[key] * city.population, 0) / population : 0;
  const income = state.cities.reduce((sum, city) => sum + city.income, 0);
  const expenses = state.cities.reduce((sum, city) => sum + city.expenses, 0) + Math.round(state.debt * 0.003);
  return { population, gdp: state.cities.reduce((sum, city) => sum + city.gdp, 0), happiness: weighted('happiness'), unemployment: weighted('unemployment'), income, expenses, balance: income - expenses };
}
export function refreshStats(state) { for (const city of state.cities) updateEconomy(state, city, false); return metrics(state); }
function historicalGovernment(id, year, fallback) {
  if (id === 'britain') return 'constitutional';
  if (id === 'korea') return year < 1948 ? 'monarchy' : 'republic';
  if (id === 'japan') return year < 1889 ? 'monarchy' : 'constitutional';
  if (id === 'china') return year < 1912 ? 'monarchy' : 'republic';
  if (id === 'russia') return year < 1917 ? 'monarchy' : 'republic';
  if (id === 'italy') return year < 1946 ? 'constitutional' : 'parliamentary';
  if (id === 'germany') return year < 1919 ? 'constitutional' : 'parliamentary';
  if (id === 'austria') return year < 1867 ? 'monarchy' : year < 1918 ? 'constitutional' : 'parliamentary';
  if (id === 'france') return year < 1852 ? 'republic' : year < 1870 ? 'monarchy' : 'parliamentary';
  return fallback;
}
export function createGame(options = {}) {
  const country = COUNTRIES.find(item => item.id === options.country) || COUNTRIES[0];
  const year = Math.round(clamp(Number(options.year) || 1900, 1850, 1950));
  const population = Math.round(clamp(Number(options.population) || 8600, 1000, 1000000));
  const custom = country.id === 'custom';
  const governmentMap = { '전제군주제': 'monarchy', '입헌군주제': 'constitutional', '대통령제 공화국': 'republic', '의원내각제 공화국': 'parliamentary' };
  const suppliedGovernment = governmentMap[options.government] || options.government;
  const initialGovernment = (['monarchy', 'constitutional', 'republic', 'parliamentary'].includes(suppliedGovernment) ? suppliedGovernment : null) || historicalGovernment(country.id, year, country.government);
  const industryMultipliers = { agriculture: 0.8, balanced: 1, manufacturing: 1.15, heavy: 1.18, resources: 1.08, trade: 1.12 };
  const industryLevel = Number.isFinite(Number(options.industry)) && Number(options.industry) > 0 ? clamp(Number(options.industry), 0.5, 1.5) : industryMultipliers[options.industry || country.industry] || 1;
  const initialResearch = ['mechanization', 'railways'];
  if (year >= 1870) initialResearch.push('steelmaking');
  if (year >= 1900) initialResearch.push('telegraph', 'sanitation');
  if (year >= 1920) initialResearch.push('electricity', 'petroleum', 'mass_education', 'urban_planning');
  if (year >= 1936) initialResearch.push('assembly_line', 'radio', 'medicine');
  const label = custom ? cleanName(options.name, '새로운 공화국') : countryName(country.id, year);
  const state = {
    version: 1, seed: 190031, nextId: 1, country: country.id, countryLabel: label,
    government: initialGovernment, industry: options.industry || country.industry, industryLevel,
    flagColor: /^#[0-9a-f]{6}$/i.test(options.color || '') ? options.color : country.color,
    customCountry: custom ? { name: label, capital: cleanName(options.capital, country.capital), industry: options.industry || country.industry, government: initialGovernment } : null,
    date: { year, month: 1 }, money: 260000, debt: 0,
    policies: { incomeTax: 15, corporateTax: 18, education: 100, healthcare: 100, industry: 0, tariff: 10 },
    cities: [], activeCity: 'capital', research: { completed: initialResearch.filter(id => TECHNOLOGIES[id]), active: null, progress: 0 },
    history: [], events: [], connections: [], undo: [], customAssets: [],
    politics: { stability: 68, support: 57, governingParty: '시민연합', lastElection: null, nextElection: year + 4 },
    diplomacy: createDiplomacy(country.id),
  };
  const capitalName = cleanName(options.capital, countryCapital(country.id, year));
  const names = REGIONS[country.id] || REGIONS.custom;
  state.cities = [
    createCity({ id: 'capital', name: capitalName, mapX: 43, mapY: 36, population: Math.round(population * 0.6), seed: state.seed, year, research: state.research.completed, industryLevel }),
    createCity({ id: 'harbor', name: names[0], mapX: 65, mapY: 68, population: Math.round(population * 0.25), seed: state.seed + 7, year, research: state.research.completed, industryLevel }),
    createCity({ id: 'frontier', name: names[1], mapX: 29, mapY: 58, population: population - Math.round(population * 0.6) - Math.round(population * 0.25), seed: state.seed + 13, year, research: state.research.completed, industryLevel }),
  ];
  refreshStats(state);
  const m = metrics(state);
  state.history.push({ ...state.date, population: m.population, gdp: m.gdp, happiness: m.happiness, money: state.money, unemployment: m.unemployment });
  logEvent(state, '새로운 세기의 시작', `${label}의 세 도시를 연결하고 시민의 삶을 가꾸어 나갑니다.`);
  return state;
}
function requirements(state, def) {
  const missing = (Array.isArray(def.requires) ? def.requires : def.requires ? [def.requires] : []).filter(id => !state.research.completed.includes(id));
  return missing.length ? `먼저 ${missing.map(id => TECHNOLOGIES[id]?.name || id).join(', ')} 연구가 필요합니다.` : null;
}
function buildMaterials(def) {
  return def.materials || { wood: Math.max(1, Math.ceil(def.cost / 2000)), ...(def.category === 'industrial' ? { iron: Math.ceil(def.cost / 5000) } : {}) };
}
function affordable(state, city, cost, materials = {}) {
  if (state.money < cost) return '국고가 부족합니다.';
  for (const [key, amount] of Object.entries(materials)) if ((city.stock[key] || 0) < amount) return `${key === 'wood' ? '목재' : key === 'iron' ? '철광석' : key === 'steel' ? '철강' : key} 자원이 부족합니다.`;
  return null;
}
export function canPlace(state, type, x, y) {
  const city = getCity(state);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !tileAt(city, x, y)) return fail('지도 범위를 벗어났습니다.');
  const special = type === 'road' || type === 'rail' || type?.startsWith('zone-');
  const def = BUILDINGS[type];
  if (!special && !def) return fail('알 수 없는 건물입니다.');
  if (type?.startsWith('zone-') && !['zone-residential', 'zone-commercial', 'zone-industrial'].includes(type)) return fail('알 수 없는 구역입니다.');
  if (def) { const reason = requirements(state, def); if (reason) return fail(reason); }
  const cells = special ? [{ x, y }] : footprint(type, x, y);
  for (const p of cells) {
    const tile = tileAt(city, p.x, p.y);
    if (!tile) return fail('건물이 지도 범위를 벗어납니다.');
    if (tile.terrain === 'water') return fail('물 위에는 건설할 수 없습니다.');
    if (buildingAt(city, p.x, p.y)) return fail('다른 건물이 있는 자리입니다.');
    if (!special && (tile.road || tile.rail)) return fail('도로 또는 철도가 있는 자리입니다.');
    if (type.startsWith('zone-') && (tile.road || tile.rail)) return fail('교통 시설 위에는 구역을 지정할 수 없습니다.');
  }
  const tile = tileAt(city, x, y);
  if (type === 'road' && tile.road || type === 'rail' && tile.rail || type.startsWith('zone-') && tile.zone === type.slice(5)) return fail('이미 설치되어 있습니다.');
  if (type === 'port' || type === 'shipyard') {
    const d = def;
    let waterfront = false;
    for (let yy = y - 1; yy <= y + d.height; yy++) for (let xx = x - 1; xx <= x + d.width; xx++) if (tileAt(city, xx, yy)?.terrain === 'water') waterfront = true;
    if (!waterfront) return fail('항만 시설은 물가에 건설해야 합니다.');
  }
  const clearing = cells.filter(p => tileAt(city, p.x, p.y).terrain === 'forest').length * 5;
  const cost = (type === 'road' ? 12 : type === 'rail' ? 60 : type.startsWith('zone-') ? 2 : def.cost) + clearing;
  const materials = type === 'rail' ? { steel: 1 } : special ? {} : buildMaterials(def);
  const reason = affordable(state, city, cost, materials);
  return reason ? fail(reason) : { ok: true, cost, materials };
}
function pay(state, city, cost, materials) {
  state.money -= cost;
  for (const [key, amount] of Object.entries(materials || {})) city.stock[key] -= amount;
}
function remember(state, record) { state.undo.push(record); if (state.undo.length > 80) state.undo.shift(); }
export function place(state, type, x, y) {
  const check = canPlace(state, type, x, y);
  if (!check.ok) return check;
  const city = getCity(state), special = type === 'road' || type === 'rail' || type.startsWith('zone-');
  const cells = special ? [{ x, y }] : footprint(type, x, y);
  const tiles = cells.map(p => ({ index: p.y * city.size + p.x, tile: { ...tileAt(city, p.x, p.y) } }));
  pay(state, city, check.cost, check.materials);
  let building = null;
  for (const p of cells) { const tile = tileAt(city, p.x, p.y); tile.terrain = 'grass'; if (!special) tile.zone = null; }
  if (type === 'road' || type === 'rail') tileAt(city, x, y)[type] = true;
  else if (type.startsWith('zone-')) tileAt(city, x, y).zone = type.slice(5);
  else {
    building = makeBuilding(`${city.id}-build-${state.nextId++}`, type, x, y, (x * 7 + y * 3 + state.nextId) % 4);
    city.buildings.push(building);
  }
  remember(state, { kind: building ? 'place' : 'tile', cityId: city.id, buildingId: building?.id ?? null, tiles, cost: check.cost, materials: check.materials });
  updateConnectivity(city);
  return { ok: true, building, cost: check.cost };
}
export function demolish(state, x, y) {
  const city = getCity(state), tile = tileAt(city, x, y);
  if (!tile) return fail('지도 범위를 벗어났습니다.');
  const building = buildingAt(city, x, y);
  if (building) {
    if (building.preserved) return fail('역사 보존 중인 건물입니다. 보존을 해제한 뒤 철거하세요.');
    const refund = Math.round(BUILDINGS[building.type].cost * 0.15 * levelScale(building));
    city.buildings.splice(city.buildings.indexOf(building), 1);
    state.money += refund;
    remember(state, { kind: 'demolish', cityId: city.id, building: clone(building), refund });
    updateConnectivity(city);
    return { ok: true, building, refund };
  }
  if (!tile.road && !tile.rail && !tile.zone && tile.terrain !== 'forest') return fail('철거할 시설이 없습니다.');
  const previous = { ...tile };
  tile.road = false; tile.rail = false; tile.zone = null;
  if (tile.terrain === 'forest') tile.terrain = 'grass';
  remember(state, { kind: 'tile', cityId: city.id, tiles: [{ index: y * city.size + x, tile: previous }], cost: 0, materials: {} });
  updateConnectivity(city);
  return { ok: true };
}
export function undo(state) {
  const record = state.undo.at(-1);
  if (!record) return fail('되돌릴 건설 작업이 없습니다.');
  const city = state.cities.find(c => c.id === record.cityId);
  if (!city) return fail('해당 도시를 찾을 수 없습니다.');
  if (record.kind === 'place') {
    const index = city.buildings.findIndex(b => b.id === record.buildingId);
    if (index < 0) return fail('이후 변경으로 건설을 되돌릴 수 없습니다.');
    city.buildings.splice(index, 1);
  } else if (record.kind === 'demolish') {
    if (footprint(record.building.type, record.building.x, record.building.y).some(p => buildingAt(city, p.x, p.y) || tileAt(city, p.x, p.y)?.road || tileAt(city, p.x, p.y)?.rail)) return fail('철거한 자리에 다른 시설이 생겼습니다.');
    if (state.money < record.refund) return fail('철거 환급금을 반환할 국고가 부족합니다.');
    city.buildings.push(record.building);
    state.money -= record.refund;
  } else if (record.kind === 'upgrade') {
    const building = city.buildings.find(b => b.id === record.buildingId);
    if (!building) return fail('해당 건물이 없습니다.');
    building.level = record.oldLevel;
  } else if (record.kind === 'tile') {
    if (record.tiles.some(p => buildingAt(city, p.index % city.size, Math.floor(p.index / city.size)))) return fail('이후 건설된 건물 때문에 되돌릴 수 없습니다.');
  }
  for (const saved of record.tiles || []) city.tiles[saved.index] = saved.tile;
  if (record.kind !== 'demolish') {
    state.money += record.cost || 0;
    for (const [key, amount] of Object.entries(record.materials || {})) city.stock[key] += amount;
  }
  state.undo.pop();
  updateConnectivity(city);
  return { ok: true };
}
export function upgradeBuilding(state, id) {
  const city = getCity(state), b = city.buildings.find(building => building.id === id);
  if (!b) return fail('해당 건물을 찾을 수 없습니다.');
  if (b.preserved) return fail('역사 보존 건물은 증축할 수 없습니다.');
  if (b.level >= 4) return fail('이미 최고 단계입니다.');
  if (b.level === 2 && state.date.year < 1900 && !state.research.completed.includes('urban_planning')) return fail('3단계 증축에는 도시계획 연구 또는 1900년 이후가 필요합니다.');
  if (b.level === 3 && state.date.year < 1920 && !state.research.completed.includes('assembly_line')) return fail('4단계 증축에는 대량 생산 연구 또는 1920년 이후가 필요합니다.');
  const def = BUILDINGS[b.type], cost = Math.round(def.cost * 0.65 * b.level), materials = { wood: b.level * 3, ...(b.level >= 2 ? { steel: b.level * 2 } : {}) };
  const reason = affordable(state, city, cost, materials);
  if (reason) return fail(reason);
  pay(state, city, cost, materials);
  remember(state, { kind: 'upgrade', cityId: city.id, buildingId: b.id, oldLevel: b.level, cost, materials });
  b.level++;
  return { ok: true, building: b };
}
export function startResearch(state, id) {
  const tech = TECHNOLOGIES[id];
  if (!tech) return fail('알 수 없는 기술입니다.');
  if (state.research.active) return fail('이미 진행 중인 연구가 있습니다.');
  if (state.research.completed.includes(id)) return fail('이미 완료한 연구입니다.');
  if (state.date.year < (tech.year || 1900)) return fail(`${tech.year}년 이후 연구할 수 있습니다.`);
  if (tech.requires.some(required => !state.research.completed.includes(required))) return fail('선행 연구가 필요합니다.');
  if (state.money < tech.cost) return fail('연구비가 부족합니다.');
  state.money -= tech.cost;
  state.research.active = id; state.research.progress = 0;
  logEvent(state, '연구 시작', `${tech.name} 연구에 착수했습니다.`);
  return { ok: true };
}
export function setPolicy(state, key, value) {
  const ranges = { incomeTax: [0, 50], corporateTax: [0, 50], education: [0, 200], healthcare: [0, 200], industry: [0, 100], tariff: [0, 40] };
  if (!ranges[key] || !Number.isFinite(Number(value))) return fail('유효하지 않은 정책입니다.');
  state.policies[key] = clamp(Number(value), ...ranges[key]);
  refreshStats(state);
  return { ok: true };
}
export function connectCities(state, a, b) {
  const first = state.cities.find(c => c.id === a), second = state.cities.find(c => c.id === b);
  if (!first || !second || a === b) return fail('서로 다른 두 도시를 선택하세요.');
  if (state.connections.some(c => c.a === a && c.b === b || c.a === b && c.b === a)) return fail('이미 연결된 도시입니다.');
  if (!railwayReady(first) || !railwayReady(second)) return fail('두 도시 모두 도로와 8칸 이상 철도에 접한 철도역이 필요합니다.');
  const cost = 12000;
  if (state.money < cost) return fail('철도 연결 예산이 부족합니다.');
  state.money -= cost;
  const connection = { id: [a, b].sort().join('-'), a, b, type: 'rail', capacity: state.research.completed.includes('advanced_rail') ? 360 : 180, lastTrade: 0, active: true };
  state.connections.push(connection);
  logEvent(state, '도시 간 철도 개통', `${first.name}–${second.name}의 식량과 산업 자원 교환이 시작됩니다.`);
  return { ok: true, connection };
}
function growZones(state, city) {
  const choices = { residential: 'house', commercial: 'shop', industrial: 'industrial' };
  const roads = roadNetwork(city);
  for (const [zone, type] of Object.entries(choices)) {
    if (city.demand[zone] < 25 || city.lastFoodSatisfaction < 0.6 && zone === 'residential') continue;
    for (let index = 0; index < city.tiles.length; index++) {
      if (city.tiles[index].zone !== zone) continue;
      const x = index % city.size, y = Math.floor(index / city.size);
      const cells = footprint(type, x, y);
      if (!cells.every(p => { const t = tileAt(city, p.x, p.y); return t && t.zone === zone && t.terrain !== 'water' && !t.road && !t.rail && !buildingAt(city, p.x, p.y); })) continue;
      const materials = buildMaterials(BUILDINGS[type]);
      if (Object.entries(materials).some(([resource, amount]) => city.stock[resource] < amount)) continue;
      const building = makeBuilding(`${city.id}-zone-${state.nextId++}`, type, x, y, (index + state.date.month) % 4);
      if (!touchesNetwork(city, building, roads)) continue;
      city.buildings.push(building);
      for (const [resource, amount] of Object.entries(materials)) city.stock[resource] -= amount;
      for (const p of cells) tileAt(city, p.x, p.y).zone = null;
      logEvent(state, '구역 개발', `${city.name}의 지정 구역에 민간 ${BUILDINGS[type].name}이 들어섰습니다.`);
      break;
    }
  }
}
function evolveBuildings(state, city) {
  const capacity = housingCapacity(city);
  const eraLimit = state.date.year < 1870 ? 1 : state.date.year < 1900 ? 2 : state.date.year < 1920 ? 3 : 4;
  if (city.happiness < 62 || city.health < 42 || city.education < 30 || city.stock.wood < 2) return;
  const candidate = city.buildings.find(b => b.active && b.connected && !b.preserved && b.age >= 18 && b.level < eraLimit && (BUILDINGS[b.type]?.category === 'residential' && city.population / Math.max(1, capacity) > 0.82 || BUILDINGS[b.type]?.category === 'commercial' && city.demand.commercial > 65));
  if (!candidate) return;
  candidate.level++;
  candidate.age = 0;
  city.stock.wood -= 2;
  logEvent(state, '건물의 성장', `${city.name}의 ${candidate.name}이 ${candidate.level}단계로 발전했습니다.`);
}
export function tick(state) {
  if (state.date.year >= 1950 && state.date.month >= 12) return fail('1950년의 마지막 달에 도달했습니다. 도시를 계속 둘러보거나 새 국가를 시작하세요.');
  state.date.month++;
  if (state.date.month > 12) { state.date.month = 1; state.date.year++; }
  const oldLabel = state.countryLabel;
  state.countryLabel = state.country === 'custom' ? state.customCountry?.name || state.countryLabel : countryName(state.country, state.date.year);
  if (oldLabel !== state.countryLabel) logEvent(state, '시대의 전환', `역사 표기가 ${state.countryLabel}(으)로 바뀌었습니다. 국가 운영은 플레이어의 선택으로 이어집니다.`);
  for (const route of state.connections) {
    route.active = railwayReady(state.cities.find(c => c.id === route.a)) && railwayReady(state.cities.find(c => c.id === route.b));
    route.capacity = state.research.completed.includes('advanced_rail') ? 360 : 180;
  }
  for (const city of state.cities) updateEconomy(state, city, true);
  exchangeGoods(state);
  advanceForeignTrade(state);
  const m = metrics(state);
  state.money = Math.round((state.money + m.balance) * 100) / 100;
  if (state.money < 0) {
    const loan = Math.ceil((-state.money + 5000) / 1000) * 1000;
    state.money += loan; state.debt += loan;
    logEvent(state, '긴급 국채 발행', `운영비 충당을 위해 ${loan.toLocaleString('ko-KR')}의 국채를 발행했습니다. 매월 이자가 지출됩니다.`);
  }
  if (state.research.active) {
    const tech = TECHNOLOGIES[state.research.active];
    const universities = state.cities.flatMap(c => c.buildings).filter(b => b.type === 'university' && b.active && b.connected).length;
    state.research.progress += 1 + Math.min(1, universities * 0.15);
    if (state.research.progress >= tech.months) {
      state.research.completed.push(tech.id); state.research.active = null; state.research.progress = 0;
      logEvent(state, '연구 완료', `${tech.name} 연구가 완료되었습니다.`);
    }
  }
  advanceGovernance(state);
  for (const city of state.cities) { growZones(state, city); evolveBuildings(state, city); }
  const after = metrics(state);
  state.history.push({ ...state.date, population: after.population, gdp: after.gdp, happiness: after.happiness, money: state.money, unemployment: after.unemployment });
  if (state.history.length > 1213) state.history.shift();
  if (state.date.month === 1) logEvent(state, `${state.date.year}년 국정 보고`, `인구 ${after.population.toLocaleString('ko-KR')}명 · 행복도 ${Math.round(after.happiness)} · 월 수지 ${Math.round(after.balance).toLocaleString('ko-KR')}`);
  for (const city of state.cities) if (city.lastFoodSatisfaction < 0.6 && !state.events.some(e => e.year === state.date.year && e.month === state.date.month && e.title === `${city.name} 식량 부족`)) logEvent(state, `${city.name} 식량 부족`, '농장을 확충하거나 철도·무역으로 식량을 확보하세요.');
  return { ok: true, metrics: after };
}
export function runElection(state) { const result = election(state); if (result.ok) logEvent(state, '총선 결과', `${state.politics.governingParty} 집권 · 투표율 ${state.politics.lastElection.turnout}%`); return result; }
export function reformGovernment(state, government) { const result = reform(state, government); if (result.ok) logEvent(state, '정치 제도 개혁', `새 정치 체제: ${government === 'republic' ? '공화정' : government === 'constitutional' ? '입헌군주정' : government === 'parliamentary' ? '의원내각제 공화국' : '전제군주제'}`); return result; }
export function makeTradeAgreement(state, countryId) { const result = tradeAgreement(state, countryId); if (result.ok) logEvent(state, '통상 협정 체결', `${COUNTRIES.find(c => c.id === countryId)?.name}와 실제 잉여 자원 수출·부족 자원 수입이 시작됩니다.`); return result; }
