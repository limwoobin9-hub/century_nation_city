import { COUNTRIES } from '../../data/countries.js';
import { PRICES, clamp } from './economy.js';
const fail = reason => ({ ok: false, reason });
const monthNumber = date => date.year * 12 + date.month;

export function createDiplomacy(countryId) {
  const partners = COUNTRIES.filter(c => c.id !== countryId && c.id !== 'custom');
  return { relations: Object.fromEntries(partners.map(c => [c.id, 50])), agreements: [], markets: Object.fromEntries(partners.map(c => [c.id, { development: ['heavy', 'manufacturing', 'trade'].includes(c.industry) ? 1.15 : 1, stock: { food: 2000, wood: 600, coal: 400, iron: 250, steel: 140, goods: 800, oil: 200, fuel: 150 }, imports: {}, exports: {} }])) };
}
function advanceForeignMarkets(state) {
  if (!state.diplomacy.markets) state.diplomacy.markets = createDiplomacy(state.country).markets;
  for (const [countryId, market] of Object.entries(state.diplomacy.markets)) {
    const industry = COUNTRIES.find(c => c.id === countryId)?.industry;
    market.development = Math.min(2.2, market.development + 0.0008);
    market.imports = {}; market.exports = {};
    const production = { food: 300, wood: 70, coal: 45, iron: 30, steel: 20, goods: 90, oil: 20, fuel: 15 };
    const consumption = { food: 280, wood: 60, coal: 35, iron: 32, steel: 22, goods: 95, oil: 16, fuel: 14 };
    if (industry === 'agriculture') production.food *= 1.4;
    if (industry === 'resources') { production.coal *= 1.7; production.oil *= 2; }
    if (industry === 'heavy') { production.steel *= 1.6; production.iron *= 1.4; }
    if (industry === 'manufacturing') production.goods *= 1.5;
    for (const resource of Object.keys(PRICES)) market.stock[resource] = Math.max(0, Math.min(100000, market.stock[resource] + production[resource] * market.development - consumption[resource] * (0.7 + market.development * 0.3)));
  }
}

export function advanceGovernance(state) {
  if (!state.politics) return;
  const population = state.cities.reduce((sum, c) => sum + c.population, 0);
  const happiness = population ? state.cities.reduce((sum, c) => sum + c.population * c.happiness, 0) / population : 0;
  const unemployment = population ? state.cities.reduce((sum, c) => sum + c.population * c.unemployment, 0) / population : 0;
  const support = clamp(happiness * 0.9 + 15 - unemployment * 0.25 - state.debt / 100000);
  state.politics.support = Math.round((state.politics.support * 0.8 + support * 0.2) * 10) / 10;
  state.politics.stability = Math.round(clamp(state.politics.stability * 0.96 + (35 + state.politics.support * 0.6) * 0.04) * 10) / 10;
}
export function election(state) {
  if (!state.politics) return fail('정치 정보를 찾을 수 없습니다.');
  if (state.government === 'monarchy') return fail('총선을 실시하려면 입헌군주정 또는 공화정으로 개혁하세요.');
  if (state.politics.lastElection && monthNumber(state.date) - monthNumber(state.politics.lastElection) < 12) return fail('총선은 최소 12개월 간격으로 실시할 수 있습니다.');
  if (state.money < 1500) return fail('선거 운영비 1,500이 필요합니다.');
  state.money -= 1500;
  const support = Math.round(state.politics.support);
  if (support < 50) state.politics.governingParty = state.politics.governingParty === '시민연합' ? '개혁연대' : '시민연합';
  const education = state.cities.reduce((s, c) => s + c.education, 0) / state.cities.length;
  state.politics.lastElection = { ...state.date, winner: state.politics.governingParty, turnout: Math.round(clamp(52 + education * 0.28, 45, 88)), support: support < 50 ? 100 - support : support };
  state.politics.nextElection = state.date.year + 4;
  state.politics.stability = clamp(state.politics.stability + 5);
  state.politics.support = Math.max(51, support);
  for (const city of state.cities) city.happiness = clamp(city.happiness + 1);
  return { ok: true };
}
export function reform(state, government) {
  if (!['monarchy', 'constitutional', 'republic', 'parliamentary'].includes(government)) return fail('알 수 없는 정치 체제입니다.');
  if (state.government === government) return fail('현재와 같은 정치 체제입니다.');
  if (state.politics.stability < 40) return fail('정치 안정도 40 이상이 필요합니다.');
  if (state.money < 15000) return fail('제도 개혁비 15,000이 필요합니다.');
  state.money -= 15000;
  state.government = government;
  state.politics.stability = clamp(state.politics.stability - 10);
  state.politics.support = clamp(state.politics.support + 3);
  if (state.customCountry) state.customCountry.government = government;
  return { ok: true };
}
export function tradeAgreement(state, countryId) {
  if (!COUNTRIES.some(country => country.id === countryId) || countryId === 'custom' || countryId === state.country) return fail('다른 실제 국가를 선택하세요.');
  if (state.diplomacy.agreements.some(a => a.countryId === countryId)) return fail('이미 통상 협정을 맺은 국가입니다.');
  if (state.money < 3000) return fail('통상 협정 체결비 3,000이 필요합니다.');
  state.money -= 3000;
  state.diplomacy.relations[countryId] = clamp((state.diplomacy.relations[countryId] || 50) + 15);
  state.diplomacy.agreements.push({ countryId, signedYear: state.date.year, lastExports: [], lastImports: [], lastValue: 0 });
  return { ok: true };
}
export function advanceForeignTrade(state) {
  if (!state.diplomacy) return;
  advanceForeignMarkets(state);
  const reserves = (city, resource) => resource === 'food' ? city.population * 0.16 : resource === 'goods' ? city.population * 0.04 : resource === 'oil' || resource === 'fuel' ? 50 : 100;
  const importResources = { china: ['food', 'goods'], russia: ['oil', 'coal'], britain: ['coal', 'steel'], japan: ['goods', 'steel'], usa: ['food', 'oil'], france: ['food', 'goods'], germany: ['steel', 'iron'], italy: ['goods', 'food'], austria: ['wood', 'iron'], korea: ['food', 'goods'] };
  for (const agreement of state.diplomacy.agreements) {
    agreement.lastExports = []; agreement.lastImports = []; agreement.lastValue = 0;
    const market = state.diplomacy.markets[agreement.countryId];
    if (!market) continue;
    let remainingExport = 80, remainingImport = 80;
    const resources = Object.keys(PRICES);
    for (const city of state.cities) {
      const exportChoices = resources.map(resource => ({ resource, surplus: Math.max(0, city.stock[resource] - reserves(city, resource) * 2) })).sort((a, b) => b.surplus * PRICES[b.resource] - a.surplus * PRICES[a.resource]);
      for (const { resource, surplus } of exportChoices) {
        const amount = Math.floor(Math.min(remainingExport, surplus * 0.12, Math.max(0, (resource === 'food' ? 2400 : resource === 'goods' ? 900 : 400) * market.development - market.stock[resource])));
        if (!amount) continue;
        const value = Math.round(amount * PRICES[resource] * 0.85);
        city.stock[resource] -= amount;
        market.stock[resource] += amount;
        market.imports[resource] = (market.imports[resource] || 0) + amount;
        city.income += value + Math.round(value * state.policies.tariff / 100);
        city.gdp += value * 12;
        agreement.lastExports.push({ city: city.id, resource, amount, value });
        agreement.lastValue += value;
        remainingExport -= amount;
        if (!remainingExport) break;
      }
      for (const resource of importResources[agreement.countryId] || ['food', 'goods']) {
        const deficit = Math.max(0, reserves(city, resource) - city.stock[resource]);
        const amount = Math.floor(Math.min(remainingImport, deficit, market.stock[resource], Math.max(0, state.money - 3000) / PRICES[resource]));
        if (!amount) continue;
        const value = Math.round(amount * PRICES[resource]);
        city.stock[resource] += amount;
        market.stock[resource] -= amount;
        market.exports[resource] = (market.exports[resource] || 0) + amount;
        city.expenses += value;
        agreement.lastImports.push({ city: city.id, resource, amount, value });
        agreement.lastValue -= value;
        remainingImport -= amount;
        if (!remainingImport) break;
      }
      if (!remainingExport && !remainingImport) break;
    }
    state.diplomacy.relations[agreement.countryId] = clamp(state.diplomacy.relations[agreement.countryId] + (agreement.lastExports.length + agreement.lastImports.length ? 0.03 : -0.01) - state.policies.tariff * 0.001);
  }
}
