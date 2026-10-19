import { getCity, metrics } from '../core/game.js';
import { BUILDINGS } from '../../data/buildings.js';
import { TECHNOLOGIES } from '../../data/technologies.js';
import { COUNTRIES, countryName } from '../../data/countries.js';

const RESOURCE_NAMES = { food: '식량', wood: '목재', coal: '석탄', iron: '철광석', steel: '철강', goods: '소비재', oil: '원유', fuel: '연료' };
const GOVERNMENTS = { monarchy: '전제군주제', constitutional: '입헌군주제', republic: '대통령제 공화국', parliamentary: '의원내각제 공화국' };
const CLASS_NAMES = { farmers: '농민', workers: '노동자', clerks: '사무직', professionals: '전문직', entrepreneurs: '사업가', capitalists: '자본가' };
const SECTOR_COLORS = ['#8b9a6b', '#b1a074', '#78877b', '#a98a71', '#7e9395', '#a28a8b', '#a9ad84', '#728a79', '#c0ac85', '#8b899b'];
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, finite(value)));

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function formatNumber(value, decimals = 0) {
  return finite(value).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

const money = value => `₩${formatNumber(value)}`;
const percent = value => `${formatNumber(value, 1)}%`;
const short = value => Math.abs(finite(value)) >= 100000000 ? `${formatNumber(value / 100000000, 1)}억` : Math.abs(finite(value)) >= 10000 ? `${formatNumber(value / 10000, 1)}만` : formatNumber(value);
const dateLabel = date => `${finite(date.year)}년 ${finite(date.month)}월`;
const countryLabel = state => state.country === 'custom' ? state.countryLabel || '새로운 국가' : countryName(state.country, state.date.year);
const row = (label, value, className = '') => `<div class="stat-row"><span>${escapeHTML(label)}</span><strong${className ? ` class="${className}"` : ''}>${value}</strong></div>`;
const progress = (value, label) => `<div class="progress" role="meter" aria-label="${escapeHTML(label)}" aria-valuenow="${clamp(value).toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${clamp(value)}%"></i></div>`;
const weighted = (state, key) => {
  const total = state.cities.reduce((sum, city) => sum + finite(city.population), 0);
  return total ? state.cities.reduce((sum, city) => sum + finite(city[key]) * finite(city.population), 0) / total : 0;
};

function chart(state, key, label, { format = short, get = item => finite(item[key]) } = {}) {
  const history = (state.history || []).slice(-24);
  if (!history.length) return `<p>${escapeHTML(label)} 기록은 다음 달부터 표시됩니다.</p>`;
  const values = history.map(get);
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const padding = (maximum - minimum) * 0.16 || Math.max(1, Math.abs(maximum) * 0.03);
  const lower = minimum - padding, upper = maximum + padding;
  const y = value => 64 - (value - lower) / (upper - lower) * 51;
  const x = index => history.length === 1 ? 116 : 7 + index / (history.length - 1) * 218;
  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  const last = history.length - 1;
  const firstDate = `${history[0].year}.${String(history[0].month).padStart(2, '0')}`;
  const lastDate = `${history[last].year}.${String(history[last].month).padStart(2, '0')}`;
  return `<svg class="mini-chart" viewBox="0 0 232 94" role="img" aria-label="${escapeHTML(label)}: ${escapeHTML(firstDate)}부터 ${escapeHTML(lastDate)}까지, 최근 ${escapeHTML(format(values[last]))}">
    <path d="M7 23H225M7 45H225M7 67H225" stroke="#dbe1ce" stroke-dasharray="2 3" stroke-width=".7"/>
    ${history.length > 1 ? `<path d="M7 70 L${points} L225 70 Z" fill="#819967" fill-opacity=".1" stroke="none"/><polyline points="${points}"/>` : ''}
    <circle cx="${x(last).toFixed(2)}" cy="${y(values[last]).toFixed(2)}" r="2.7" fill="#748d60" stroke="#f7f7ef" stroke-width="1.5"/>
    <text x="7" y="88" stroke="none">${escapeHTML(firstDate)}</text>
    <text x="225" y="88" text-anchor="end" stroke="none">${history.length > 1 ? escapeHTML(lastDate) : '첫 기록'}</text>
  </svg>`;
}

function policy(state, key, label, max, description, min = 0) {
  const value = finite(state.policies[key]);
  return `<div class="field"><label for="policy-${key}">${escapeHTML(label)}<span><output>${formatNumber(value)}%</output></span></label><input id="policy-${key}" data-policy="${key}" type="range" min="${min}" max="${max}" step="1" value="${value}" aria-label="${escapeHTML(label)}"><p style="margin:0;font-size:9px">${escapeHTML(description)}</p></div>`;
}

function overview(state) {
  const city = getCity(state), total = metrics(state);
  const history = state.history || [];
  const prior = history.length > 1 ? history[history.length - 2] : null;
  const change = prior ? total.population - prior.population : 0;
  return `<div class="info-block"><div class="card-eyebrow"><span>CITY PROFILE</span><span>${state.activeCity === state.cities[0]?.id ? '수도' : '지방 도시'}</span></div><h4 style="font-family:var(--serif);font-size:22px;margin-top:9px">${escapeHTML(city.name)}</h4><div class="metric-large">${formatNumber(city.population)} <small>명</small></div><p>국가 전체 인구의 ${percent(city.population / Math.max(1, total.population) * 100)}</p></div>
    <h3>도시의 오늘</h3>
    ${row('연간 생산 규모', money(city.gdp))}
    ${row('시민 행복도', percent(city.happiness))}${progress(city.happiness, '시민 행복도')}
    ${row('교육 수준', percent(city.education))}
    ${row('시민 건강', percent(city.health))}
    ${row('실업률', percent(city.unemployment), city.unemployment > 20 ? 'negative' : '')}
    ${row('대기 오염', `${formatNumber(city.pollution, 1)} / 100`)}
    <div class="divider"></div><h3>함께 성장하는 국가</h3>
    ${row('총인구', `${formatNumber(total.population)}명`)}
    ${row('지난달 인구 변화', `${change > 0 ? '+' : ''}${formatNumber(change)}명`, change < 0 ? 'negative' : 'positive')}
    ${row('국가 행복도', percent(total.happiness))}
    ${chart(state, 'happiness', '국가 행복도', { format: percent })}
    <h3>1인당 연간 생산</h3><div class="metric-large">${money(total.gdp / Math.max(1, total.population))}</div>
    ${chart(state, 'gdpPerCapita', '1인당 연간 생산', { format: value => money(value), get: item => finite(item.gdp) / Math.max(1, finite(item.population)) })}
    <p>그래프는 최근 ${Math.min(24, history.length)}개 월별 기록입니다. 도로와 일자리, 공공 서비스가 시민의 생활을 바꿉니다.</p>
    <button class="secondary-button full" data-action="next-month">한 달 진행하기 <span aria-hidden="true">→</span></button>`;
}

function nationMap(state) {
  const cities = state.cities;
  const position = city => ({ x: clamp(city.mapX, 12, 88), y: clamp(city.mapY, 12, 84) });
  const lines = (state.connections || []).map(connection => {
    const a = cities.find(city => city.id === connection.a), b = cities.find(city => city.id === connection.b);
    if (!a || !b) return '';
    const start = position(a), end = position(b);
    return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${connection.active ? '#728961' : '#a7b19a'}" stroke-width="${connection.active ? '1' : '.6'}" stroke-dasharray="2 1.5"/>`;
  }).join('');
  return `<div class="nation-map" aria-label="세 도시와 도시 간 철도 연결 개략도"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M-5 5Q15 17 5 35T8 70T-5 100M102-5Q72 12 89 35T88 62T105 95" fill="none" stroke="#cbd6ba" stroke-width="4"/><path d="M-5 8Q15 20 5 38T8 73T-5 103M102-2Q72 15 89 38T88 65T105 98" fill="none" stroke="#d6dfc8" stroke-width="2"/>${lines}</svg>${cities.map((city, index) => { const point = position(city); return `<button data-action="switch-city" data-id="${escapeHTML(city.id)}" style="left:${point.x}%;top:${point.y}%;${state.activeCity === city.id ? 'border-color:#5c7854;background:#f8f7e5' : ''}" aria-label="${escapeHTML(city.name)} 도시로 이동"><strong>${escapeHTML(city.name)}${index === 0 ? ' · 수도' : ''}</strong><small>${formatNumber(city.population)}명</small></button>`; }).join('')}</div>`;
}

function nation(state) {
  const total = metrics(state);
  const pairs = [];
  for (let a = 0; a < state.cities.length; a++) for (let b = a + 1; b < state.cities.length; b++) pairs.push([state.cities[a], state.cities[b]]);
  return `<div class="card-eyebrow">A NATION, CONNECTED</div><h3 style="font:23px var(--serif);margin-top:9px">${escapeHTML(countryLabel(state))}</h3><p>${state.cities.length}개 도시 · ${escapeHTML(GOVERNMENTS[state.government] || state.government)}<br>도시를 선택해 같은 국가 안에서 오가세요.</p>
    ${nationMap(state)}
    ${state.cities.map((city, index) => `<button class="city-list-button ${city.id === state.activeCity ? 'active' : ''}" data-action="switch-city" data-id="${escapeHTML(city.id)}"><span><strong>${escapeHTML(city.name)}</strong><small>${index === 0 ? '수도 · ' : ''}인구 ${formatNumber(city.population)}명</small></span><span>${percent(city.happiness)}<small>행복도</small></span></button>`).join('')}
    <h3>도시별 경제</h3><table class="national-table"><caption class="tiny-note" style="text-align:left;margin-bottom:8px">도시별 연간 GDP와 월간 재정 수지</caption><thead><tr><th scope="col">도시</th><th scope="col">GDP</th><th scope="col">수지</th></tr></thead><tbody>${state.cities.map(city => `<tr><th scope="row">${escapeHTML(city.name)}</th><td>${short(city.gdp)}</td><td class="${city.income - city.expenses >= 0 ? 'positive' : 'negative'}">${city.income - city.expenses > 0 ? '+' : ''}${short(city.income - city.expenses)}</td></tr>`).join('')}</tbody></table>
    ${row('국가 전체 GDP', money(total.gdp))}
    <h3>도시 간 물류망</h3><p>철도를 연결하면 부족한 자원을 잉여 도시에서 운송합니다. 두 도시 모두 도로와 철로에 연결된 역이 필요합니다.</p>
    ${pairs.map(([a, b]) => { const route = (state.connections || []).find(item => (item.a === a.id && item.b === b.id) || (item.a === b.id && item.b === a.id)); return `<div class="info-block"><h4>${escapeHTML(a.name)} <span style="color:#9ba68b">↔</span> ${escapeHTML(b.name)}</h4>${route ? `${row('철도 연결', route.active ? '<span class="positive">운행 중</span>' : '운행 중단')}${row('지난달 자원 운송', `${formatNumber(route.lastTrade, 1)} 단위`)}` : `<p>철도 연결로 두 도시 사이에 물류 노선을 만듭니다.</p><button class="secondary-button full" style="margin-top:10px" data-action="connect" data-a="${escapeHTML(a.id)}" data-b="${escapeHTML(b.id)}" ${state.money >= 12000 ? '' : 'disabled'}>철도 연결 · ₩12,000</button>`}</div>`; }).join('')}`;
}

function economy(state) {
  const total = metrics(state);
  return `<div class="card-eyebrow">NATIONAL TREASURY</div><div class="metric-large">${money(state.money)}</div><p>현재 국고 · 모든 도시가 함께 사용합니다.</p>
    ${row('월간 세입', money(total.income), 'positive')}
    ${row('월간 지출', money(total.expenses))}
    ${row('월간 수지', `${total.balance > 0 ? '+' : ''}${money(total.balance)}`, total.balance >= 0 ? 'positive' : 'negative')}
    ${row('국가 부채', money(state.debt), state.debt > 0 ? 'negative' : '')}
    <h3>국고 추이</h3>${chart(state, 'money', '국고 추이', { format: money })}
    <h3>연간 국내총생산</h3><div class="metric-large">${money(total.gdp)}</div>${chart(state, 'gdp', '국내총생산 추이', { format: money })}
    <p>GDP는 월간 생산과 서비스 규모를 연간으로 환산한 값입니다. 건설·연구 비용은 실행할 때 국고에서 지불합니다.</p>
    <div class="divider"></div><h3>세금과 산업 정책</h3>
    ${policy(state, 'incomeTax', '소득세', 50, '시민 소득에서 세입을 확보합니다. 높은 세율은 행복도를 낮춥니다.')}
    ${policy(state, 'corporateTax', '법인세', 50, '이익을 내는 사업장에서 세금을 걷습니다.')}
    ${policy(state, 'industry', '산업 보조금', 100, '공업 생산을 지원하며 고용 규모에 따라 예산이 지출됩니다.')}
    ${policy(state, 'tariff', '물류 관세', 40, '도시 간 자원 운송과 해외 수출에 관세를 적용합니다.')}
    <p>정책은 전국에 적용되며, 월간 결산에 반영됩니다.</p>`;
}

function population(state) {
  const total = metrics(state), city = getCity(state);
  const employed = city.buildings.reduce((sum, building) => sum + finite(building.employees), 0);
  const homes = city.buildings.filter(building => building.active && BUILDINGS[building.type]?.category === 'residential');
  const capacity = homes.reduce((sum, building) => sum + BUILDINGS[building.type].capacity * (1 + (building.level - 1) * 0.65), 0);
  const demographics = city.demographics;
  const classes = Object.entries(CLASS_NAMES).filter(([key]) => city.classes?.[key]);
  return `<div class="card-eyebrow">PEOPLE & EVERYDAY LIFE</div><div class="metric-large">${formatNumber(total.population)} <small>명</small></div><p>${escapeHTML(countryLabel(state))} 전체 인구</p>
    ${chart(state, 'population', '국가 인구 추이')}
    ${row('국가 실업률', percent(total.unemployment))}${chart(state, 'unemployment', '국가 실업률', { format: percent })}
    ${row('국가 교육 수준', percent(weighted(state, 'education')))}${progress(weighted(state, 'education'), '국가 교육 수준')}
    ${row('국가 시민 건강', percent(weighted(state, 'health')))}${progress(weighted(state, 'health'), '국가 시민 건강')}
    <div class="divider"></div><h3>${escapeHTML(city.name)}의 생활</h3>
    ${row('거주 인구', `${formatNumber(city.population)}명`)}
    ${row('활성 주택 수용 인원', `${formatNumber(capacity)}명`)}
    ${row('취업 인원', `${formatNumber(employed)}명`)}
    ${row('식량 충족률', percent(finite(city.lastFoodSatisfaction) * 100))}${progress(finite(city.lastFoodSatisfaction) * 100, '식량 충족률')}
    ${row('소비재 충족률', percent(finite(city.lastGoodsSatisfaction) * 100))}${progress(finite(city.lastGoodsSatisfaction) * 100, '소비재 충족률')}
    <h3>지난달 인구와 생활</h3>
    ${demographics ? `<div class="info-block">${row('출생 · 사망', `${formatNumber(demographics.births)} · ${formatNumber(demographics.deaths)}명`)}${row('전입 · 전출', `${formatNumber(demographics.immigration)} · ${formatNumber(demographics.emigration)}명`)}${row('취업 인구 · 경제활동 인구', `${formatNumber(demographics.employed)} · ${formatNumber(demographics.laborForce)}명`)}${row('취업자 평균 월소득', `₩${formatNumber(demographics.averageIncome, 1)}`)}${row('생활비 지수', `${formatNumber(demographics.costOfLiving, 1)} <small style="font:9px var(--sans);color:#939c83">기준 100</small>`)}</div>` : '<p>월말 결산 후 표시</p>'}
    <h3>시민 계층</h3>
    ${classes.length ? `<table class="national-table"><caption class="tiny-note" style="text-align:left;margin-bottom:8px">지난달 계층별 인구와 평균 월소득</caption><thead><tr><th scope="col">계층</th><th scope="col">인구</th><th scope="col">월소득</th></tr></thead><tbody>${classes.map(([key, name]) => `<tr><th scope="row">${escapeHTML(name)}</th><td>${formatNumber(city.classes[key].population)}명</td><td>₩${formatNumber(city.classes[key].averageIncome, 1)}</td></tr>`).join('')}</tbody></table>` : '<p>월말 결산 후 표시</p>'}
    <h3>공공 서비스 예산</h3>
    ${policy(state, 'education', '교육 예산', 200, '100%가 기본 예산입니다. 학교 운영비와 교육 효과를 함께 조정합니다.')}
    ${policy(state, 'healthcare', '의료 예산', 200, '병원 운영비와 시민의 건강 개선 효과를 조정합니다.')}
    <p>교육·건강·행복도는 0–100 지수입니다. 인구 변화는 일자리, 주거, 식량과 생활 수준을 반영합니다.</p>`;
}

function industry(state) {
  const city = getCity(state);
  const plants = city.buildings.filter(building => BUILDINGS[building.type]?.category === 'industrial');
  const connected = plants.filter(building => building.active && building.connected);
  const employees = plants.reduce((sum, building) => sum + finite(building.employees), 0);
  const groups = new Map();
  for (const building of plants) {
    const group = groups.get(building.type) || { count: 0, production: 0, employees: 0, profit: 0, utilization: 0 };
    group.count++; group.production += finite(building.production); group.employees += finite(building.employees); group.profit += finite(building.profit); group.utilization += finite(building.utilization);
    groups.set(building.type, group);
  }
  const productionTotal = plants.reduce((sum, building) => sum + Math.max(0, finite(building.production)), 0);
  const sectors = [...groups].filter(([, group]) => group.production > 0).map(([type, group], index) => ({ type, share: group.production / productionTotal * 100, color: SECTOR_COLORS[index % SECTOR_COLORS.length] }));
  return `<div class="card-eyebrow">INDUSTRY & RESOURCES</div><h3 style="font:23px var(--serif);margin-top:9px">${escapeHTML(city.name)}의 생산</h3>
    ${row('산업 시설', `${plants.length}개`)}${row('가동·도로 연결 시설', `${connected.length}개`)}${row('산업 종사자', `${formatNumber(employees)}명`)}${row('월간 산업 생산', `${formatNumber(plants.reduce((sum, building) => sum + finite(building.production), 0), 1)} 단위`)}
    <h3>산업별 생산량 비중</h3>
    ${productionTotal > 0 ? `<div role="img" aria-label="${escapeHTML(sectors.map(sector => `${BUILDINGS[sector.type].name} ${percent(sector.share)}`).join(', '))}" style="display:flex;height:16px;overflow:hidden;border-radius:3px;margin:13px 0">${sectors.map(sector => `<span style="width:${sector.share.toFixed(6)}%;background:${sector.color}" title="${escapeHTML(BUILDINGS[sector.type].name)} ${percent(sector.share)}"></span>`).join('')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 12px">${sectors.map(sector => `<div style="display:flex;align-items:center;gap:5px;font-size:9px;color:#7b8978"><i aria-hidden="true" style="display:block;width:6px;height:6px;flex-shrink:0;border-radius:1px;background:${sector.color}"></i><span>${escapeHTML(BUILDINGS[sector.type].name)}</span><strong style="margin-left:auto;font-weight:400;color:#526b57">${percent(sector.share)}</strong></div>`).join('')}</div><p>자원 생산량을 단위 수 기준으로 비교합니다.</p>` : '<p>생산이 시작되면 산업별 비중을 표시합니다.</p>'}
    <h3>실물 자원 재고</h3>${Object.entries(RESOURCE_NAMES).map(([key, name]) => `<div class="resource-row"><span>${escapeHTML(name)}</span><strong>${formatNumber(city.stock[key], 1)} <small style="font:9px var(--sans);color:#949d86">단위</small></strong></div>`).join('')}
    <p>생산은 실제 재고를 사용합니다. 원료가 부족하거나 도로가 연결되지 않은 공장은 생산이 줄어듭니다.</p>
    <h3>산업별 가동 현황</h3>${[...groups].map(([type, group]) => `<div class="info-block"><h4>${escapeHTML(BUILDINGS[type].name)} <span style="color:#949d86;font-size:10px">${group.count}개</span></h4>${row('종사자 · 가동률', `${formatNumber(group.employees)}명 · ${percent(group.utilization / group.count * 100)}`)}${progress(group.utilization / group.count * 100, `${BUILDINGS[type].name} 가동률`)}${row('지난달 생산', `${formatNumber(group.production, 1)} 단위`)}${row('지난달 수익', money(group.profit), group.profit >= 0 ? 'positive' : 'negative')}<p style="margin-top:9px">${Object.keys(BUILDINGS[type].inputs || {}).length ? `${Object.keys(BUILDINGS[type].inputs).map(key => RESOURCE_NAMES[key] || key).map(escapeHTML).join(' + ')} → ` : ''}${Object.keys(BUILDINGS[type].production || {}).map(key => RESOURCE_NAMES[key] || key).map(escapeHTML).join(' + ') || '산업 서비스'}</p></div>`).join('') || '<p>산업 시설을 건설하면 생산 현황이 표시됩니다.</p>'}
    <p>원료 채굴 → 가공 → 소비재 생산을 연결하고, 산업 지역과 주거지 사이에 녹지를 확보하세요.</p>`;
}

function politics(state) {
  const politics = state.politics;
  if (!politics) return `<p>현재 정치 체제는 ${escapeHTML(GOVERNMENTS[state.government] || state.government)}입니다.</p><p>정부 지지도와 안정도를 중심으로 진행하는 간단한 정치 모형입니다.</p>`;
  const support = clamp(politics.support), stability = clamp(politics.stability);
  const last = politics.lastElection;
  const elapsed = last ? (state.date.year - last.year) * 12 + state.date.month - last.month : Infinity;
  const electionAllowed = state.government !== 'monarchy' && elapsed >= 12 && state.money >= 1500;
  const gaugePoints = Array.from({ length: 30 }, (_, index) => {
    const angle = Math.PI + index / 29 * Math.PI;
    return `<circle cx="${116 + Math.cos(angle) * 86}" cy="${100 + Math.sin(angle) * 82}" r="3.5" fill="${index < Math.round(support / 100 * 30) ? '#7d9568' : '#d9dfcc'}" stroke="none"/>`;
  }).join('');
  return `<div class="card-eyebrow">GOVERNMENT & REFORM</div><h3 style="font:23px var(--serif);margin-top:9px">${escapeHTML(GOVERNMENTS[state.government] || state.government)}</h3>
    <svg class="seat-chart" viewBox="0 0 232 114" role="img" aria-label="정부 지지도 ${percent(support)}">${gaugePoints}<text x="116" y="81" text-anchor="middle" fill="#3a5648" stroke="none" style="font:30px var(--serif)">${formatNumber(support, 1)}%</text><text x="116" y="101" text-anchor="middle" fill="#919b83" stroke="none" style="font-size:9px">정부 지지도</text></svg>
    ${row('국가 안정도', percent(stability))}${progress(stability, '국가 안정도')}
    ${politics.governingParty ? row('집권 세력', escapeHTML(politics.governingParty)) : ''}
    ${politics.nextElection ? row('다음 선거 예정', `${finite(politics.nextElection)}년`) : ''}
    ${last ? `<div class="info-block" style="margin-top:18px"><h4>최근 선거 · ${escapeHTML(dateLabel(last))}</h4>${row('당선 세력', escapeHTML(last.winner))}${row('투표율', percent(last.turnout))}${row('당선 지지율', percent(last.support))}</div>` : ''}
    <button class="primary-button full" style="margin-top:14px" data-action="election" ${electionAllowed ? '' : 'disabled'}>선거 실시 · ₩1,500</button>
    <p>${state.government === 'monarchy' ? '선거를 실시하려면 입헌군주제 또는 공화제로 개혁해야 합니다.' : elapsed < 12 ? `다음 선거까지 ${12 - elapsed}개월이 필요합니다.` : '시민의 생활 수준과 정책에 따라 선거 결과가 달라집니다.'}</p>
    <h3>정치 체제 개혁</h3>${Object.entries(GOVERNMENTS).filter(([id]) => id !== state.government).map(([id, name]) => `<div class="info-block"><h4>${escapeHTML(name)}</h4><p>${id === 'monarchy' ? '군주가 통치하며 정기 선거를 실시하지 않습니다.' : id === 'constitutional' ? '군주제를 유지하면서 선거를 통해 정부를 구성합니다.' : id === 'parliamentary' ? '의회와 내각을 중심으로 공화국의 정부를 구성합니다.' : '선출된 대통령을 중심으로 공화국의 정부를 구성합니다.'}</p><button class="secondary-button full" style="margin-top:10px" data-action="reform" data-id="${id}" ${stability >= 40 && state.money >= 15000 ? '' : 'disabled'}>개혁 · ₩15,000</button></div>`).join('')}
    <p>개혁에는 안정도 40 이상이 필요합니다. 정치는 정부 지지도·안정도·선거를 중심으로 단순화한 모형이며, 정당별 의석 배분은 다루지 않습니다.</p>`;
}

function diplomacy(state) {
  const diplomacy = state.diplomacy;
  const agreements = diplomacy?.agreements || [];
  const partners = COUNTRIES.filter(country => country.id !== state.country && country.id !== 'custom');
  return `<div class="card-eyebrow">RELATIONS & WORLD TRADE</div><h3 style="font:23px var(--serif);margin-top:9px">국경을 넘어</h3><p>외교는 국가 간 관계와 양자 무역 협정을 중심으로 단순화한 모형입니다.</p>
    ${row('체결한 무역 협정', `${agreements.length}개`)}
    ${row('지난달 총교역액', money(agreements.reduce((sum, agreement) => sum + [...(agreement.lastExports || []), ...(agreement.lastImports || [])].reduce((value, shipment) => value + finite(shipment.value), 0), 0)))}
    <h3>국가별 관계</h3>${partners.map(country => {
      const agreement = agreements.find(item => item.countryId === country.id);
      const relation = finite(diplomacy?.relations?.[country.id]);
      const exports = agreement?.lastExports || [], imports = agreement?.lastImports || [];
      const shipmentLabel = shipments => shipments.reduce((sum, shipment) => sum + finite(shipment.amount), 0);
      return `<div class="info-block ${agreement ? 'active' : ''}"><h4>${escapeHTML(countryName(country.id, state.date.year))}${agreement ? '<span style="float:right;color:#6d855d;font-size:9px">협정 체결</span>' : ''}</h4>${diplomacy ? `${row('관계 지수', `${formatNumber(relation)} / 100`)}${progress(relation, `${countryName(country.id, state.date.year)} 관계 지수`)}` : ''}${agreement ? `${row('협정 체결 연도', `${finite(agreement.signedYear)}년`)}${row('지난달 수출 · 수입', `${formatNumber(shipmentLabel(exports), 1)} · ${formatNumber(shipmentLabel(imports), 1)} 단위`)}${row('지난달 무역 수지', money(agreement.lastValue), agreement.lastValue >= 0 ? 'positive' : 'negative')}${exports.length ? `<p style="margin-top:8px">수출: ${[...new Set(exports.map(shipment => RESOURCE_NAMES[shipment.resource] || shipment.resource))].map(escapeHTML).join(' · ')}</p>` : ''}${imports.length ? `<p style="margin-top:5px">수입: ${[...new Set(imports.map(shipment => RESOURCE_NAMES[shipment.resource] || shipment.resource))].map(escapeHTML).join(' · ')}</p>` : ''}` : `<p>${escapeHTML(country.description)}</p><button class="secondary-button full" style="margin-top:11px" data-action="trade" data-id="${escapeHTML(country.id)}" ${diplomacy && state.money >= 3000 ? '' : 'disabled'}>무역 협정 · ₩3,000</button>`}</div>`;
    }).join('')}
    <p>협정 체결 후 매월 잉여 자원을 수출하고 부족한 자원을 수입합니다. 교역량은 자원 재고와 노선 운송 한도에 따라 달라집니다.</p>`;
}

function research(state) {
  const completed = state.research.completed || [];
  const active = typeof state.research.active === 'string' ? state.research.active : state.research.active?.id;
  const activeTech = TECHNOLOGIES[active];
  return `<div class="card-eyebrow">IDEAS THAT SHAPE A CENTURY</div><h3 style="font:23px var(--serif);margin-top:9px">다음 시대를 준비하다</h3>
    ${row('완료한 연구', `${completed.length} / ${Object.keys(TECHNOLOGIES).length}`)}
    ${activeTech ? `<div class="info-block active" style="margin-top:14px"><h4>${escapeHTML(activeTech.name)} · 연구 중</h4>${row('진행 상황', `${formatNumber(state.research.progress, 1)} / ${activeTech.months}개월`)}${progress(state.research.progress / activeTech.months * 100, `${activeTech.name} 연구 진행`)}<p>도시를 경영하며 시간을 진행하면 연구가 진전됩니다.</p></div>` : '<p>한 번에 하나의 기술을 연구합니다. 연구비는 시작할 때 지불하며 진행 기간은 게임 속 개월 수입니다.</p>'}
    <h3>기술 연구</h3>${Object.values(TECHNOLOGIES).map(technology => {
      const done = completed.includes(technology.id), isActive = active === technology.id;
      const missing = (technology.requires || []).filter(id => !completed.includes(id));
      const early = state.date.year < (technology.year || 1900);
      const affordable = state.money >= technology.cost;
      const disabled = done || isActive || Boolean(active) || missing.length > 0 || early || !affordable;
      let status = done ? '연구 완료' : isActive ? '연구 진행 중' : early ? `${technology.year}년부터 연구 가능` : missing.length ? `${missing.map(id => TECHNOLOGIES[id]?.name || id).join(' · ')} 필요` : active ? '현재 연구 완료 후 시작 가능' : !affordable ? '국고가 부족합니다' : '연구 가능';
      return `<div class="info-block ${done || isActive ? 'active' : ''}"><div class="card-eyebrow"><span>${technology.year || 1900} — ${technology.months} MONTHS</span>${done ? '<span class="positive">완료 ✓</span>' : ''}</div><h4 style="margin-top:9px">${escapeHTML(technology.name)}</h4><p>${escapeHTML(technology.description)}</p>${technology.unlocks?.length ? `<p style="margin-top:6px;color:#798960">해금: ${technology.unlocks.map(id => escapeHTML(BUILDINGS[id]?.name || id)).join(' · ')}</p>` : ''}${row('연구비 · 기간', `${money(technology.cost)} · ${technology.months}개월`)}${done ? '' : `<button class="${isActive ? 'primary' : 'secondary'}-button full" style="margin-top:10px" data-action="research" data-id="${escapeHTML(technology.id)}" ${disabled ? 'disabled' : ''}>${isActive ? '연구 진행 중' : disabled ? escapeHTML(status) : '연구 시작'}</button>`}</div>`;
    }).join('')}`;
}

function chronicle(state) {
  const events = [...(state.events || [])].sort((a, b) => finite(b.year) - finite(a.year) || finite(b.month) - finite(a.month));
  return `<div class="card-eyebrow">THE STORY OF YOUR NATION</div><h3 style="font:23px var(--serif);margin-top:9px">${escapeHTML(dateLabel(state.date))}</h3><p>작은 변화가 모여 국가의 역사가 됩니다.</p>
    <div class="button-row"><button class="secondary-button" data-action="open-saves">저장 · 불러오기</button><button class="secondary-button" data-action="export-png">도시 PNG 저장</button></div>
    <div class="button-row" style="margin-bottom:24px"><button class="secondary-button" data-action="upload-sprite">픽셀 이미지 적용</button><button class="secondary-button" data-action="new-game">새로운 국가</button></div>
    <h3>국가 연대기 <span style="font-weight:400;color:#9ba48a">${events.length}개 기록</span></h3>
    ${events.length ? events.map(event => `<article class="event-entry"><small>${escapeHTML(dateLabel(event))}</small><h4>${escapeHTML(event.title)}</h4>${event.text ? `<p>${escapeHTML(event.text)}</p>` : ''}</article>`).join('') : '<p>국가의 중요한 사건이 여기에 기록됩니다.</p>'}`;
}

/** Pure HTML rendering; actions are handled by the application's delegated listeners. */
export function renderPanel(name, state) {
  if (!state?.cities?.length) return '<p>도시를 준비하고 있습니다.</p>';
  const panels = { overview, nation, economy, population, industry, politics, diplomacy, research, chronicle };
  return (panels[name] || overview)(state);
}
