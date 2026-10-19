import { BUILDINGS } from '../../data/buildings.js';
import { updateConnectivity } from './network.js';

export const PRICES = { food: 4, wood: 6, coal: 8, iron: 12, steel: 25, goods: 18, oil: 16, fuel: 22 };
export const clamp = (number, min = 0, max = 100) => Math.max(min, Math.min(max, number));
export const levelScale = b => 1 + (b.level - 1) * 0.65;
export const housingCapacity = city => city.buildings.reduce((sum, b) => sum + (b.active && BUILDINGS[b.type]?.category === 'residential' ? BUILDINGS[b.type].capacity * levelScale(b) : 0), 0);
const ranges = { school: 10, university: 18, hospital: 11, police: 12, fire: 12, park: 8, museum: 10, theatre: 10, power: 26 };
const order = ['farm', 'lumber', 'coal', 'iron', 'oilwell', 'steel', 'refinery', 'textile', 'industrial', 'machine', 'chemical', 'auto', 'shipyard'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function serviceCoverage(city, type, homes, populationCapacity) {
  const providers = city.buildings.filter(b => b.type === type && b.active && b.connected && b.budget > 0 && (type !== 'power' || b.operatingScale > 0));
  if (!providers.length || !populationCapacity) return 0;
  let served = 0;
  for (const home of homes) {
    const nearest = providers.reduce((best, provider) => Math.max(best, distance(home, provider) <= ranges[type] * (1 + (provider.level - 1) * 0.15) ? Math.min(1, provider.budget / 100) * Math.max(0, provider.utilization) : 0), 0);
    served += BUILDINGS[home.type].capacity * levelScale(home) * nearest;
  }
  const availableCapacity = providers.reduce((sum, b) => sum + BUILDINGS[b.type].capacity * levelScale(b) * b.budget / 100, 0);
  return clamp(Math.min(served / populationCapacity, availableCapacity / Math.max(1, city.population)) * 100);
}
export function updateEconomy(state, city, advance = true) {
  updateConnectivity(city);
  const population = city.population;
  const workforce = Math.floor(population * 0.55);
  const jobs = city.buildings.filter(b => b.active && b.connected && BUILDINGS[b.type]?.jobs > 0);
  const demand = jobs.reduce((sum, b) => sum + BUILDINGS[b.type].jobs * levelScale(b) * (b.budget / 100), 0);
  const employmentFactor = Math.min(1, workforce / Math.max(1, demand));
  let employed = 0;
  for (const b of city.buildings) {
    const def = BUILDINGS[b.type];
    b.employees = b.active && b.connected ? Math.floor((def?.jobs || 0) * levelScale(b) * employmentFactor * b.budget / 100) : 0;
    employed += b.employees;
    b.utilization = def?.jobs ? b.employees / Math.max(1, def.jobs * levelScale(b)) : Number(b.active && b.connected);
    b.production = 0;
    b.profit = 0;
    if (advance) b.age++;
  }
  city.unemployment = workforce ? clamp((1 - employed / workforce) * 100) : 0;
  const powerProviders = city.buildings.filter(b => b.type === 'power' && b.active && b.connected && b.employees > 0 && (city.stock.coal >= (BUILDINGS[b.type].inputs?.coal || 0) * b.utilization));
  for (const b of city.buildings) b.powered = powerProviders.some(p => distance(b, p) <= ranges[p.type]);
  const stock = advance ? city.stock : { ...city.stock };
  const productive = city.buildings.filter(b => b.active && b.connected).sort((a, b) => {
    const ai = order.indexOf(a.type), bi = order.indexOf(b.type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.id.localeCompare(b.id);
  });
  let outputValue = 0, profits = 0, upkeep = 0, wages = 0, pollution = 0;
  const researchBonus = (state.research.completed.includes('mechanization') ? 0.04 : 0) + (state.research.completed.includes('agricultural_science') ? 0.04 : 0);
  for (const b of productive) {
    const def = BUILDINGS[b.type];
    if (!def) continue;
    const industryBoost = def.category === 'industrial' ? (1 + state.policies.industry / 300) * (state.industryLevel || 1) : 1;
    const electricalBonus = state.research.completed.includes('electricity') && b.powered ? 0.08 : 0;
    let scale = b.utilization * levelScale(b) * industryBoost * (1 + researchBonus + electricalBonus);
    if (['auto', 'machine', 'chemical', 'refinery'].includes(b.type) && !b.powered) scale = 0;
    // Fuel and raw materials constrain throughput; employment alone cannot create goods.
    for (const [resource, amount] of Object.entries(def.inputs || {})) scale = Math.min(scale, stock[resource] / Math.max(0.001, amount));
    scale = Math.max(0, scale);
    b.utilization = Math.min(b.utilization, scale / Math.max(1, levelScale(b)));
    b.operatingScale = scale;
    let inputValue = 0, revenue = 0;
    for (const [resource, amount] of Object.entries(def.inputs || {})) {
      const used = amount * scale;
      stock[resource] = Math.max(0, stock[resource] - used);
      inputValue += used * (PRICES[resource] || 1);
    }
    for (const [resource, amount] of Object.entries(def.production || {})) {
      const made = amount * scale;
      stock[resource] = Math.min(1000000, (stock[resource] || 0) + made);
      b.production += made;
      revenue += made * (PRICES[resource] || 1);
    }
    if (def.category === 'commercial') revenue += b.employees * 19;
    if (def.category === 'transport') revenue += b.employees * 9;
    const payroll = b.employees * 12;
    // Civic wages are included in their monthly upkeep abstraction, not charged twice.
    wages += payroll;
    b.profit = Math.round(revenue - inputValue - payroll * 0.15 - def.upkeep * b.budget / 100);
    profits += Math.max(0, b.profit);
    outputValue += revenue + payroll;
    pollution += Math.max(0, def.pollution || 0) * Math.max(0.15, b.utilization) * levelScale(b);
  }
  for (const b of city.buildings.filter(b => b.active)) {
    const def = BUILDINGS[b.type];
    if (!def) continue;
    const policyScale = ['school', 'university'].includes(b.type) ? state.policies.education / 100 : b.type === 'hospital' ? state.policies.healthcare / 100 : 1;
    upkeep += def.upkeep * levelScale(b) * b.budget / 100 * policyScale;
  }
  upkeep += city.tiles.reduce((sum, tile) => sum + (tile.road ? 0.04 : 0) + (tile.rail ? 0.16 : 0), 0);
  const foodNeed = population * 0.055, goodsNeed = population * 0.012;
  city.lastFoodSatisfaction = foodNeed ? Math.min(1, stock.food / foodNeed) : 1;
  city.lastGoodsSatisfaction = goodsNeed ? Math.min(1, stock.goods / goodsNeed) : 1;
  stock.food = Math.max(0, stock.food - foodNeed);
  stock.goods = Math.max(0, stock.goods - goodsNeed);
  if (advance) for (const resource of Object.keys(stock)) city.stock[resource] = Math.round(stock[resource] * 100) / 100;
  const homes = city.buildings.filter(b => b.active && BUILDINGS[b.type]?.category === 'residential');
  const capacity = housingCapacity(city);
  for (const type of Object.keys(ranges)) city.services[type] = serviceCoverage(city, type, homes, capacity);
  const educationTarget = clamp(22 + (city.services.school * 0.55 + city.services.university * 0.28) * state.policies.education / 100 + (state.research.completed.includes('mass_education') ? 10 : 0));
  const healthTarget = clamp(38 + city.services.hospital * 0.5 * state.policies.healthcare / 100 + (state.research.completed.includes('sanitation') ? 10 : 0) + (state.research.completed.includes('medicine') ? 12 : 0));
  if (advance) {
    city.education = clamp(city.education * 0.92 + educationTarget * 0.08);
    city.health = clamp(city.health * 0.9 + healthTarget * 0.1);
  }
  city.pollution = clamp(pollution / 3 - city.services.park * 0.16);
  const targetHappiness = clamp(42 + city.lastFoodSatisfaction * 18 + city.lastGoodsSatisfaction * 7 + city.services.park * 0.1 + city.health * 0.13 + city.education * 0.06 + city.services.police * 0.035 - city.unemployment * 0.3 - city.pollution * 0.25 - state.policies.incomeTax * 0.45 - state.policies.corporateTax * 0.08);
  if (advance) city.happiness = clamp(city.happiness * 0.65 + targetHappiness * 0.35);
  for (const home of homes) {
    const localPollution = productive.reduce((sum, b) => sum + Math.max(0, BUILDINGS[b.type]?.pollution || 0) / (2 + distance(home, b)), 0);
    home.happiness = clamp(city.happiness + (home.connected ? 3 : -18) - localPollution * 0.65);
    home.landValue = clamp(30 + home.happiness * 0.5 + city.services.park * 0.15 - localPollution);
  }
  city.gdp = Math.round(outputValue * 12);
  const subsidy = productive.filter(b => BUILDINGS[b.type]?.category === 'industrial').reduce((sum, b) => sum + b.employees * state.policies.industry / 100, 0);
  city.income = Math.round(wages * state.policies.incomeTax / 100 + profits * state.policies.corporateTax / 100);
  city.expenses = Math.round(upkeep + subsidy + Math.max(0, workforce - employed) * 0.18);
  city.demand = {
    residential: Math.round(clamp((population / Math.max(1, capacity) - 0.65) * 220 + (city.happiness - 50))),
    commercial: Math.round(clamp(population / Math.max(1, productive.filter(b => BUILDINGS[b.type]?.category === 'commercial').reduce((s, b) => s + BUILDINGS[b.type].jobs * levelScale(b), 0)) * 12 - 20)),
    industrial: Math.round(clamp(city.unemployment * 5 + 20)),
  };
  if (advance) {
    const births = Math.round(population * (0.0018 + city.health * 0.000008));
    const deaths = Math.round(population * (0.0012 + (1 - city.health / 100) * 0.0007 + (1 - city.lastFoodSatisfaction) * 0.01 + city.pollution * 0.000004));
    const connectedCapacity = homes.reduce((sum, b) => sum + BUILDINGS[b.type].capacity * levelScale(b) * (b.connected ? 1 : 0.3), 0);
    const attraction = population * ((city.happiness - 50) / 20000 + (10 - city.unemployment) / 50000);
    const immigration = Math.round(Math.min(Math.max(0, attraction), Math.max(0, connectedCapacity - population)));
    const emigration = Math.round(Math.max(0, -attraction) + Math.max(0, population - connectedCapacity) * 0.018);
    city.demographics = { births, deaths, immigration, emigration, employed, laborForce: workforce, averageIncome: Math.round(wages / Math.max(1, employed) * 100) / 100, costOfLiving: Math.round(100 + (1 - city.lastFoodSatisfaction) * 55 + (1 - city.lastGoodsSatisfaction) * 20 + state.policies.corporateTax * 0.2) };
    const farmers = jobs.filter(b => b.type === 'farm').reduce((sum, b) => sum + b.employees, 0);
    const workers = jobs.filter(b => BUILDINGS[b.type]?.category === 'industrial' && b.type !== 'farm').reduce((sum, b) => sum + b.employees, 0);
    const professionals = jobs.filter(b => BUILDINGS[b.type]?.category === 'civic').reduce((sum, b) => sum + b.employees, 0);
    const clerks = Math.max(0, employed - farmers - workers - professionals);
    const classWeights = { farmers, workers: workers + Math.max(0, workforce - employed), clerks: clerks * 0.9, professionals, entrepreneurs: clerks * 0.08, capitalists: Math.max(1, employed * 0.02) };
    const weightSum = Object.values(classWeights).reduce((a, b) => a + b, 0);
    city.classes = Object.fromEntries(Object.entries(classWeights).map(([key, value]) => [key, { population: Math.round(population * value / Math.max(1, weightSum)), averageIncome: { farmers: 9, workers: 12, clerks: 15, professionals: 21, entrepreneurs: 29, capitalists: 45 }[key] }]));
    city.population = Math.max(0, population + births - deaths + immigration - emigration);
  }
}
export function exchangeGoods(state) {
  for (const route of state.connections) {
    const a = state.cities.find(c => c.id === route.a), b = state.cities.find(c => c.id === route.b);
    route.lastTrade = 0;
    if (!a || !b) continue;
    a.expenses += route.active ? 45 : 15;
    b.expenses += route.active ? 45 : 15;
    if (!route.active) continue;
    let remaining = route.capacity || 180;
    for (const resource of ['food', 'goods', 'coal', 'iron', 'steel', 'wood', 'oil', 'fuel']) {
      const reserve = city => resource === 'food' ? city.population * 0.16 : resource === 'goods' ? city.population * 0.04 : 160;
      const source = a.stock[resource] - reserve(a) > b.stock[resource] - reserve(b) ? a : b;
      const target = source === a ? b : a;
      const surplus = Math.max(0, source.stock[resource] - reserve(source));
      const shortage = Math.max(0, reserve(target) - target.stock[resource]);
      const amount = Math.min(remaining, surplus * 0.2, shortage);
      source.stock[resource] -= amount;
      target.stock[resource] += amount;
      remaining -= amount;
      route.lastTrade += amount;
      if (remaining <= 0) break;
    }
    route.lastTrade = Math.round(route.lastTrade * 100) / 100;
    const tariff = Math.round(route.lastTrade * state.policies.tariff / 100);
    a.income += tariff;
    a.gdp += Math.round(route.lastTrade * 6);
    b.gdp += Math.round(route.lastTrade * 6);
  }
}
