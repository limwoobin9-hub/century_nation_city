/** Versioned, bounded browser saves. This module deliberately has no network dependencies. */
import { BUILDINGS } from '../../data/buildings.js';
import { COUNTRIES } from '../../data/countries.js';
import { TECHNOLOGIES } from '../../data/technologies.js';

export const SAVE_FORMAT = 'century-nation-city';
export const SAVE_VERSION = 1;
export const MAX_SAVE_BYTES = 24 * 1024 * 1024;
export const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_ASSETS_BYTES = 8 * MAX_ASSET_BYTES;
const DATABASE = 'century-nation-city';
const STORE = 'saves';
const LOCAL_PREFIX = 'century-nation-city:save:';
const SLOTS = [0, 1, 2, 'auto'];
const TERRAINS = new Set(['grass', 'water', 'forest']);
const ZONES = new Set([null, 'residential', 'commercial', 'industrial']);
const STOCKS = ['food', 'wood', 'coal', 'iron', 'steel', 'goods', 'oil', 'fuel'];
const POLICIES = ['incomeTax', 'corporateTax', 'education', 'healthcare', 'industry', 'tariff'];
let databasePromise;

export class SaveError extends Error {
  constructor(message, code = 'INVALID_SAVE', options = {}) {
    super(message, options);
    this.name = 'SaveError';
    this.code = code;
  }
}

function invalid(path, reason = '올바르지 않은 값입니다.') {
  throw new SaveError(`저장 데이터 ${path}: ${reason}`);
}
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '객체가 필요합니다.');
}
function string(value, path, max = 200, min = 1) {
  if (typeof value !== 'string' || value.length < min || value.length > max) invalid(path, '문자열 길이가 잘못되었습니다.');
}
function number(value, path, min = -1e15, max = 1e15, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(path, '숫자 범위가 잘못되었습니다.');
}
function bool(value, path) {
  if (typeof value !== 'boolean') invalid(path, '참/거짓 값이 필요합니다.');
}
function array(value, path, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(path, '목록 크기가 잘못되었습니다.');
}
function identifier(value, path) {
  string(value, path, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) invalid(path, '식별자가 잘못되었습니다.');
}
function date(value, path) {
  object(value, path);
  number(value.year, `${path}.year`, 1800, 9999, true);
  number(value.month, `${path}.month`, 1, 12, true);
}
function bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

// Inspect JSON before cloning it: JSON.stringify would silently replace NaN,
// omit undefined, and execute user-defined toJSON methods.
function inspectJson(root) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(value, path, depth) {
    if (++nodes > 2_000_000 || depth > 24) invalid(path, '데이터가 너무 복잡합니다.');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid(path, '유한한 숫자가 필요합니다.');
      return;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_SAVE_BYTES) invalid(path, '문자열이 너무 큽니다.');
      return;
    }
    if (typeof value !== 'object') invalid(path, 'JSON으로 저장할 수 없는 값입니다.');
    if (ancestors.has(value)) invalid(path, '순환 참조는 저장할 수 없습니다.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, '일반 객체만 저장할 수 있습니다.');
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid(path, '허용되지 않는 속성입니다.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) invalid(path, '접근자 속성은 저장할 수 없습니다.');
      visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(value);
  }
  visit(root, 'state', 0);
}

function validateAsset(asset, index) {
  const path = `customAssets[${index}]`;
  object(asset, path);
  identifier(asset.id, `${path}.id`);
  if (!asset.id.startsWith('custom-')) invalid(`${path}.id`, 'custom- 접두사가 필요합니다.');
  string(asset.name, `${path}.name`, 100);
  identifier(asset.baseType, `${path}.baseType`);
  if (asset.baseType.startsWith('custom-') || !Object.hasOwn(BUILDINGS, asset.baseType)) invalid(`${path}.baseType`, '기본 건물 종류를 찾을 수 없습니다.');
  number(asset.cost, `${path}.cost`, 0, 1e12);
  string(asset.dataUrl, `${path}.dataUrl`, Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 100);
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.dataUrl);
  if (!match || match[2].length % 4 !== 0) invalid(path, 'PNG, JPEG, WebP, GIF 이미지 데이터가 필요합니다.');
  const body = match[2];
  const byteLength = body.length * 3 / 4 - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
  if (byteLength > MAX_ASSET_BYTES) invalid(path, '이미지는 1 MiB 이하여야 합니다.');
  let header;
  try { header = atob(body.slice(0, 48)); } catch { invalid(path, '이미지 인코딩이 잘못되었습니다.'); }
  const code = (i) => header.charCodeAt(i);
  const signatures = {
    png: () => header.slice(0, 8) === '\x89PNG\r\n\x1a\n',
    jpeg: () => code(0) === 255 && code(1) === 216 && code(2) === 255,
    webp: () => header.slice(0, 4) === 'RIFF' && header.slice(8, 12) === 'WEBP',
    gif: () => ['GIF87a', 'GIF89a'].includes(header.slice(0, 6)),
  };
  if (!signatures[match[1]]()) invalid(path, '이미지 형식과 실제 데이터가 일치하지 않습니다.');
  if (match[1] === 'png' && header.length >= 24) {
    const uint32 = (offset) => ((code(offset) * 2 ** 24) + (code(offset + 1) << 16) + (code(offset + 2) << 8) + code(offset + 3));
    number(uint32(16), `${path}.width`, 1, 512, true);
    number(uint32(20), `${path}.height`, 1, 512, true);
  }
  if (match[1] === 'gif' && header.length >= 10) {
    number(code(6) + code(7) * 256, `${path}.width`, 1, 512, true);
    number(code(8) + code(9) * 256, `${path}.height`, 1, 512, true);
  }
  return byteLength;
}

/** Validate without mutating state; returns the original valid state. */
export function validateState(state) {
  inspectJson(state);
  object(state, 'state');
  if (state.version !== SAVE_VERSION) throw new SaveError('지원하지 않는 게임 저장 버전입니다.', 'INCOMPATIBLE_VERSION');
  number(state.seed, 'seed', 0, 0xffffffff, true);
  number(state.nextId, 'nextId', 1, 1e12, true);
  if (state.industryLevel !== undefined) number(state.industryLevel, 'industryLevel', 0, 10);
  identifier(state.country, 'country');
  if (!COUNTRIES.some((country) => country.id === state.country)) invalid('country', '국가를 찾을 수 없습니다.');
  string(state.countryLabel, 'countryLabel', 100);
  string(state.government, 'government', 100);
  string(state.flagColor, 'flagColor', 40);
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(state.flagColor)) invalid('flagColor');
  date(state.date, 'date');
  number(state.money, 'money');
  number(state.debt, 'debt', 0);
  object(state.policies, 'policies');
  for (const key of POLICIES) number(state.policies[key], `policies.${key}`, 0, 1000);
  if (state.customAssets !== undefined) array(state.customAssets, 'customAssets', 64);
  const customIds = new Set();
  let totalAssetBytes = 0;
  for (const [index, asset] of (state.customAssets || []).entries()) {
    totalAssetBytes += validateAsset(asset, index);
    if (customIds.has(asset.id)) invalid('customAssets', '이미지 식별자가 중복되었습니다.');
    customIds.add(asset.id);
  }
  if (totalAssetBytes > MAX_ASSETS_BYTES) invalid('customAssets', '이미지는 합계 8 MiB 이하여야 합니다.');
  array(state.cities, 'cities', 16, 1);
  const cityIds = new Set();
  const buildingIds = new Set();
  for (const [ci, city] of state.cities.entries()) {
    const cp = `cities[${ci}]`;
    object(city, cp);
    identifier(city.id, `${cp}.id`);
    if (cityIds.has(city.id)) invalid(cp, '도시 식별자가 중복되었습니다.');
    cityIds.add(city.id);
    string(city.name, `${cp}.name`, 100);
    number(city.mapX, `${cp}.mapX`, -10000, 10000);
    number(city.mapY, `${cp}.mapY`, -10000, 10000);
    number(city.size, `${cp}.size`, 16, 128, true);
    array(city.tiles, `${cp}.tiles`, city.size ** 2, city.size ** 2);
    for (const [ti, tile] of city.tiles.entries()) {
      const tp = `${cp}.tiles[${ti}]`;
      object(tile, tp);
      if (!TERRAINS.has(tile.terrain)) invalid(`${tp}.terrain`);
      bool(tile.road, `${tp}.road`);
      bool(tile.rail, `${tp}.rail`);
      if (!ZONES.has(tile.zone)) invalid(`${tp}.zone`);
    }
    array(city.buildings, `${cp}.buildings`, city.size ** 2);
    const occupied = new Set();
    for (const [bi, building] of city.buildings.entries()) {
      const bp = `${cp}.buildings[${bi}]`;
      object(building, bp);
      identifier(building.id, `${bp}.id`);
      // Building IDs are unique within a city; older drafts reused IDs in other cities.
      const uniqueId = `${city.id}:${building.id}`;
      if (buildingIds.has(uniqueId)) invalid(bp, '건물 식별자가 중복되었습니다.');
      buildingIds.add(uniqueId);
      identifier(building.type, `${bp}.type`);
      if (building.type.startsWith('custom-') && !customIds.has(building.type)) invalid(bp, '사용자 이미지가 누락되었습니다.');
      const customAsset = state.customAssets?.find((asset) => asset.id === building.type);
      const definitionId = customAsset ? customAsset.baseType : building.type;
      if (!Object.hasOwn(BUILDINGS, definitionId)) invalid(`${bp}.type`, '건물 종류를 찾을 수 없습니다.');
      const definition = BUILDINGS[definitionId];
      number(building.x, `${bp}.x`, 0, city.size - 1, true);
      number(building.y, `${bp}.y`, 0, city.size - 1, true);
      if (building.x + definition.width > city.size || building.y + definition.height > city.size) invalid(bp, '건물이 지도 경계를 벗어납니다.');
      for (let y = building.y; y < building.y + definition.height; y++) {
        for (let x = building.x; x < building.x + definition.width; x++) {
          const tileIndex = y * city.size + x;
          if (occupied.has(tileIndex)) invalid(bp, '건물의 부지가 겹칩니다.');
          occupied.add(tileIndex);
        }
      }
      number(building.level, `${bp}.level`, 1, 4, true);
      number(building.variant, `${bp}.variant`, 0, 3, true);
      string(building.name, `${bp}.name`, 100);
      bool(building.active, `${bp}.active`);
      bool(building.preserved, `${bp}.preserved`);
      number(building.budget, `${bp}.budget`, 0, 1000);
      number(building.age, `${bp}.age`, 0, 1e9);
      number(building.employees, `${bp}.employees`, 0, 1e12);
      number(building.production, `${bp}.production`, 0, 1e15);
      number(building.utilization, `${bp}.utilization`, 0, 1000);
      number(building.profit, `${bp}.profit`);
      for (const key of ['connected', 'powered']) if (building[key] !== undefined) bool(building[key], `${bp}.${key}`);
      for (const key of ['happiness', 'landValue']) if (building[key] !== undefined) number(building[key], `${bp}.${key}`, 0, 100);
      if (building.operatingScale !== undefined) number(building.operatingScale, `${bp}.operatingScale`, 0, 1000);
    }
    number(city.population, `${cp}.population`, 0, 1e12);
    for (const key of ['happiness', 'education', 'health', 'unemployment']) number(city[key], `${cp}.${key}`, 0, 100);
    for (const key of ['gdp', 'pollution', 'income', 'expenses']) number(city[key], `${cp}.${key}`, 0, 1e15);
    object(city.stock, `${cp}.stock`);
    for (const key of STOCKS) number(city.stock[key], `${cp}.stock.${key}`, 0, 1e15);
    for (const key of ['demand', 'services']) if (city[key] !== undefined) {
      object(city[key], `${cp}.${key}`);
      for (const [metric, value] of Object.entries(city[key])) number(value, `${cp}.${key}.${metric}`, -100, 100);
    }
    for (const key of ['lastFoodSatisfaction', 'lastGoodsSatisfaction']) if (city[key] !== undefined) number(city[key], `${cp}.${key}`, 0, 1);
    if (city.demographics !== undefined) {
      object(city.demographics, `${cp}.demographics`);
      for (const [key, value] of Object.entries(city.demographics)) number(value, `${cp}.demographics.${key}`, 0, 1e15);
    }
    if (city.classes !== undefined) {
      object(city.classes, `${cp}.classes`);
      for (const [key, value] of Object.entries(city.classes)) {
        object(value, `${cp}.classes.${key}`);
        number(value.population, `${cp}.classes.${key}.population`, 0, 1e12);
        number(value.averageIncome, `${cp}.classes.${key}.averageIncome`, 0, 1e15);
      }
    }
  }
  if (!cityIds.has(state.activeCity)) invalid('activeCity', '존재하지 않는 도시입니다.');
  object(state.research, 'research');
  array(state.research.completed, 'research.completed', 500);
  for (const id of state.research.completed) {
    identifier(id, 'research.completed');
    if (!Object.hasOwn(TECHNOLOGIES, id)) invalid('research.completed', '연구를 찾을 수 없습니다.');
  }
  if (new Set(state.research.completed).size !== state.research.completed.length) invalid('research.completed', '연구가 중복되었습니다.');
  if (state.research.active !== null) {
    identifier(state.research.active, 'research.active');
    if (!Object.hasOwn(TECHNOLOGIES, state.research.active)) invalid('research.active', '연구를 찾을 수 없습니다.');
    if (state.research.completed.includes(state.research.active)) invalid('research.active', '이미 완료한 연구입니다.');
  }
  number(state.research.progress, 'research.progress', 0, 1e9);
  array(state.history, 'history', 10000);
  for (const [i, entry] of state.history.entries()) {
    const hp = `history[${i}]`;
    date(entry, hp);
    number(entry.population, `${hp}.population`, 0, 1e12);
    number(entry.gdp, `${hp}.gdp`, 0, 1e15);
    number(entry.happiness, `${hp}.happiness`, 0, 100);
    number(entry.unemployment, `${hp}.unemployment`, 0, 100);
    number(entry.money, `${hp}.money`);
  }
  array(state.events, 'events', 10000);
  for (const [i, entry] of state.events.entries()) {
    const ep = `events[${i}]`;
    date(entry, ep);
    string(entry.title, `${ep}.title`, 300);
    if (entry.text !== undefined) string(entry.text, `${ep}.text`, 10000, 0);
  }
  array(state.connections, 'connections', 256);
  const connectionPairs = new Set();
  for (const [i, connection] of state.connections.entries()) {
    const cp = `connections[${i}]`;
    object(connection, cp);
    if (!cityIds.has(connection.a) || !cityIds.has(connection.b) || connection.a === connection.b) invalid(cp, '도시간 연결이 잘못되었습니다.');
    identifier(connection.id, `${cp}.id`);
    if (connection.type !== 'rail') invalid(`${cp}.type`);
    number(connection.capacity, `${cp}.capacity`, 1, 1e12);
    number(connection.lastTrade, `${cp}.lastTrade`, 0, 1e15);
    bool(connection.active, `${cp}.active`);
    const pair = [connection.a, connection.b].sort().join(':');
    if (connectionPairs.has(pair)) invalid(cp, '도시간 연결이 중복되었습니다.');
    connectionPairs.add(pair);
  }
  array(state.undo, 'undo', 100);
  for (const [i, record] of state.undo.entries()) {
    const rp = `undo[${i}]`;
    object(record, rp);
    if (!['place', 'tile', 'demolish', 'upgrade'].includes(record.kind)) invalid(`${rp}.kind`);
    const city = state.cities.find((entry) => entry.id === record.cityId);
    if (!city) invalid(`${rp}.cityId`, '도시를 찾을 수 없습니다.');
    if (record.kind === 'place' || record.kind === 'upgrade') identifier(record.buildingId, `${rp}.buildingId`);
    if (record.kind === 'upgrade') number(record.oldLevel, `${rp}.oldLevel`, 1, 3, true);
    if (record.kind === 'demolish') {
      object(record.building, `${rp}.building`);
      const building = record.building;
      identifier(building.id, `${rp}.building.id`);
      const asset = state.customAssets?.find((entry) => entry.id === building.type);
      const definitionId = asset ? asset.baseType : building.type;
      if (!Object.hasOwn(BUILDINGS, definitionId)) invalid(`${rp}.building.type`);
      const definition = BUILDINGS[definitionId];
      number(building.x, `${rp}.building.x`, 0, city.size - definition.width, true);
      number(building.y, `${rp}.building.y`, 0, city.size - definition.height, true);
      number(building.level, `${rp}.building.level`, 1, 4, true);
      number(building.variant, `${rp}.building.variant`, 0, 3, true);
      string(building.name, `${rp}.building.name`, 100);
      for (const key of ['active', 'preserved']) bool(building[key], `${rp}.building.${key}`);
      for (const key of ['age', 'budget', 'employees', 'production', 'utilization']) number(building[key], `${rp}.building.${key}`, 0, 1e15);
      number(building.profit, `${rp}.building.profit`);
      number(record.refund, `${rp}.refund`, 0, 1e15);
    } else {
      number(record.cost, `${rp}.cost`, 0, 1e15);
      object(record.materials, `${rp}.materials`);
      for (const [resource, amount] of Object.entries(record.materials)) {
        if (!STOCKS.includes(resource)) invalid(`${rp}.materials`, '자원을 찾을 수 없습니다.');
        number(amount, `${rp}.materials.${resource}`, 0, 1e15);
      }
    }
    if (record.kind === 'place' || record.kind === 'tile') array(record.tiles, `${rp}.tiles`, 64, 1);
    if (record.tiles !== undefined) {
      array(record.tiles, `${rp}.tiles`, 64);
      for (const [ti, entry] of record.tiles.entries()) {
        const tp = `${rp}.tiles[${ti}]`;
        object(entry, tp);
        number(entry.index, `${tp}.index`, 0, city.size ** 2 - 1, true);
        object(entry.tile, `${tp}.tile`);
        if (!TERRAINS.has(entry.tile.terrain) || !ZONES.has(entry.tile.zone)) invalid(`${tp}.tile`);
        bool(entry.tile.road, `${tp}.tile.road`);
        bool(entry.tile.rail, `${tp}.tile.rail`);
      }
    }
  }
  if (state.politics !== undefined) {
    object(state.politics, 'politics');
    number(state.politics.stability, 'politics.stability', 0, 100);
    number(state.politics.support, 'politics.support', 0, 100);
    string(state.politics.governingParty, 'politics.governingParty', 100);
    number(state.politics.nextElection, 'politics.nextElection', 1800, 10003, true);
    if (state.politics.lastElection !== null) {
      date(state.politics.lastElection, 'politics.lastElection');
      string(state.politics.lastElection.winner, 'politics.lastElection.winner', 100);
      number(state.politics.lastElection.turnout, 'politics.lastElection.turnout', 0, 100);
      number(state.politics.lastElection.support, 'politics.lastElection.support', 0, 100);
    }
  }
  if (state.diplomacy !== undefined) {
    object(state.diplomacy, 'diplomacy');
    object(state.diplomacy.relations, 'diplomacy.relations');
    for (const [id, value] of Object.entries(state.diplomacy.relations)) {
      if (!COUNTRIES.some((country) => country.id === id && id !== 'custom' && id !== state.country)) invalid('diplomacy.relations', '국가를 찾을 수 없습니다.');
      number(value, `diplomacy.relations.${id}`, 0, 100);
    }
    if (state.diplomacy.markets !== undefined) {
      object(state.diplomacy.markets, 'diplomacy.markets');
      for (const [id, market] of Object.entries(state.diplomacy.markets)) {
        const mp = `diplomacy.markets.${id}`;
        if (!COUNTRIES.some((country) => country.id === id && id !== 'custom' && id !== state.country)) invalid(mp, '국가를 찾을 수 없습니다.');
        object(market, mp);
        number(market.development, `${mp}.development`, 0, 10);
        for (const key of ['stock', 'imports', 'exports']) {
          object(market[key], `${mp}.${key}`);
          for (const [resource, amount] of Object.entries(market[key])) {
            if (!STOCKS.includes(resource)) invalid(`${mp}.${key}`, '자원을 찾을 수 없습니다.');
            number(amount, `${mp}.${key}.${resource}`, 0, 1e15);
          }
        }
        for (const key of STOCKS) number(market.stock[key], `${mp}.stock.${key}`, 0, 1e15);
      }
    }
    array(state.diplomacy.agreements, 'diplomacy.agreements', 16);
    const countries = new Set();
    for (const [i, agreement] of state.diplomacy.agreements.entries()) {
      const ap = `diplomacy.agreements[${i}]`;
      object(agreement, ap);
      if (!COUNTRIES.some((country) => country.id === agreement.countryId && country.id !== 'custom' && country.id !== state.country) || countries.has(agreement.countryId)) invalid(ap, '통상 협정 국가가 잘못되었습니다.');
      countries.add(agreement.countryId);
      number(agreement.signedYear, `${ap}.signedYear`, 1800, 9999, true);
      number(agreement.lastValue, `${ap}.lastValue`);
      for (const key of ['lastExports', 'lastImports']) {
        array(agreement[key], `${ap}.${key}`, 256);
        for (const entry of agreement[key]) {
          object(entry, `${ap}.${key}`);
          if (!cityIds.has(entry.city) || !STOCKS.includes(entry.resource)) invalid(`${ap}.${key}`, '무역 대상이 잘못되었습니다.');
          number(entry.amount, `${ap}.${key}.amount`, 0, 1e15);
          number(entry.value, `${ap}.${key}.value`, 0, 1e15);
        }
      }
    }
  }
  if (bytes(JSON.stringify(state)) > MAX_SAVE_BYTES) throw new SaveError('저장 파일은 24 MiB 이하여야 합니다.', 'SAVE_TOO_LARGE');
  return state;
}

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
function makeDocument(state) {
  validateState(state);
  const serialized = JSON.stringify(state);
  return { format: SAVE_FORMAT, formatVersion: SAVE_VERSION, savedAt: new Date().toISOString(), checksum: checksum(serialized), state: JSON.parse(serialized) };
}
function parseDocument(document) {
  object(document, 'document');
  if (document.format !== SAVE_FORMAT || document.formatVersion !== SAVE_VERSION) throw new SaveError('지원하지 않는 저장 파일 형식 또는 버전입니다.', 'INCOMPATIBLE_VERSION');
  if (typeof document.savedAt !== 'string' || !Number.isFinite(Date.parse(document.savedAt))) invalid('savedAt');
  validateState(document.state);
  if (document.checksum !== checksum(JSON.stringify(document.state))) throw new SaveError('저장 파일 검증에 실패했습니다. 파일이 손상되었거나 수정되었습니다.', 'CHECKSUM_MISMATCH');
  return document.state;
}
async function validateDecodedAssets(state) {
  // A raster signature alone cannot prove that its pixels are decodable. Check
  // browser imports before main.js replaces the currently running game.
  if (typeof globalThis.Image !== 'function') return state;
  for (const [index, asset] of (state.customAssets || []).entries()) {
    const image = new Image();
    image.src = asset.dataUrl;
    try { await image.decode(); }
    catch (cause) { throw new SaveError(`사용자 이미지 ${index + 1}을 읽을 수 없습니다. 저장 파일이 손상되었습니다.`, 'INVALID_SAVE', { cause }); }
    number(image.naturalWidth, `customAssets[${index}].width`, 1, 512, true);
    number(image.naturalHeight, `customAssets[${index}].height`, 1, 512, true);
  }
  return state;
}
function slotId(slot) {
  if (!SLOTS.includes(slot)) throw new SaveError('저장 슬롯은 0, 1, 2 또는 auto여야 합니다.', 'INVALID_SLOT');
  return slot;
}
function metadata(id, document) {
  const state = document.state;
  return { id, name: `${state.countryLabel} · ${state.cities.find((city) => city.id === state.activeCity)?.name || '도시'}`, savedAt: document.savedAt, year: state.date.year, month: state.date.month, country: state.country, population: state.cities.reduce((sum, city) => sum + city.population, 0) };
}

async function database() {
  if (!globalThis.indexedDB) return null;
  if (!databasePromise) databasePromise = new Promise((resolve) => {
    let request;
    let settled = false;
    const finish = (db) => { if (!settled) { settled = true; clearTimeout(timeout); resolve(db); } else if (db) db.close(); };
    const timeout = setTimeout(() => finish(null), 2500);
    try { request = indexedDB.open(DATABASE, 1); } catch { finish(null); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      finish(db);
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
  return databasePromise;
}
function local() {
  try {
    if (!globalThis.localStorage) throw new Error('No localStorage');
    return globalThis.localStorage;
  } catch (cause) {
    throw new SaveError('브라우저 저장소를 사용할 수 없습니다. JSON 내보내기로 저장해 주세요.', 'STORAGE_UNAVAILABLE', { cause });
  }
}
function storageFailure(cause) {
  const quota = cause?.name === 'QuotaExceededError';
  return new SaveError(quota ? '브라우저 저장 공간이 부족합니다. 다른 슬롯을 지우거나 JSON으로 내보내 주세요.' : '브라우저 저장소 작업에 실패했습니다. JSON 내보내기를 이용해 주세요.', quota ? 'QUOTA_EXCEEDED' : 'STORAGE_FAILURE', { cause });
}
async function operate(slot, operation, value) {
  slotId(slot);
  const db = await database();
  if (db) return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = operation === 'get' ? store.get(slot) : operation === 'put' ? store.put(value, slot) : store.delete(slot);
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result ?? null);
      transaction.onerror = () => reject(storageFailure(transaction.error));
      transaction.onabort = () => reject(storageFailure(transaction.error));
    } catch (cause) { reject(storageFailure(cause)); }
  });
  const storage = local();
  const key = `${LOCAL_PREFIX}${slot}`;
  try {
    if (operation === 'get') {
      const text = storage.getItem(key);
      if (text === null) return null;
      if (bytes(text) > MAX_SAVE_BYTES + 4096) throw new SaveError('저장 파일이 너무 큽니다.', 'SAVE_TOO_LARGE');
      try { return JSON.parse(text); } catch (cause) { throw new SaveError('저장 슬롯의 JSON이 손상되었습니다.', 'INVALID_SAVE', { cause }); }
    }
    if (operation === 'put') storage.setItem(key, JSON.stringify(value));
    else storage.removeItem(key);
    return null;
  } catch (cause) { if (cause instanceof SaveError) throw cause; throw storageFailure(cause); }
}

/** Metadata for occupied slots only, in 0/1/2/auto order. Corruption is explicit. */
export async function listSlots() {
  const slots = [];
  for (const id of SLOTS) {
    const document = await operate(id, 'get');
    if (document === null) continue;
    parseDocument(document);
    slots.push(metadata(id, document));
  }
  return slots;
}
export async function saveGame(state, slot = 0) {
  slotId(slot);
  const document = makeDocument(state);
  await operate(slot, 'put', document);
  return metadata(slot, document);
}
export async function loadGame(slot = 0) {
  const document = await operate(slot, 'get');
  return document === null ? null : validateDecodedAssets(parseDocument(document));
}
export async function deleteSave(slot = 0) {
  await operate(slot, 'delete');
}
export function exportGame(state) {
  return new Blob([JSON.stringify(makeDocument(state))], { type: 'application/json' });
}
export async function importGame(file) {
  if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size)) throw new SaveError('JSON 저장 파일을 선택해 주세요.');
  if (file.size > MAX_SAVE_BYTES + 4096) throw new SaveError('저장 파일은 24 MiB 이하여야 합니다.', 'SAVE_TOO_LARGE');
  const text = await file.text();
  if (bytes(text) > MAX_SAVE_BYTES + 4096) throw new SaveError('저장 파일은 24 MiB 이하여야 합니다.', 'SAVE_TOO_LARGE');
  let document;
  try { document = JSON.parse(text); } catch (cause) { throw new SaveError('JSON 저장 파일을 읽을 수 없습니다.', 'INVALID_SAVE', { cause }); }
  return validateDecodedAssets(parseDocument(document));
}
