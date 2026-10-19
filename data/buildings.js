/** Monthly, nominal game-currency values. Every footprint fits a 3 × 3 lot. */
const define = (id, name, category, width, height, cost, upkeep, options = {}) => ({
  id, name, category, width, height, cost, upkeep, capacity: 0, jobs: 0,
  description: '', pollution: 0, color: '#b99a72', requires: [], ...options,
});

export const BUILDINGS = {
  house: define('house', '도시 주택', 'residential', 1, 1, 1200, 12, {
    description: '작은 정원과 벽돌 굴뚝을 갖춘 가정집. 초기 도시의 주거 기반입니다.',
    capacity: 180, color: '#bb7655',
  }),
  apartment: define('apartment', '공동 주택', 'residential', 2, 2, 11500, 90, {
    description: '전차와 상점 가까이에 많은 시민이 거주하는 고밀도 주택입니다.',
    capacity: 1100, pollution: 1, requires: ['urban_planning'], color: '#a38d77',
  }),
  shop: define('shop', '상점가', 'commercial', 1, 1, 1800, 25, {
    description: '생활필수품을 판매하고 시민에게 일자리를 제공합니다.',
    jobs: 110, production: { goods: 5 }, inputs: { food: 3 }, color: '#ccae75',
  }),
  farm: define('farm', '농장', 'industrial', 3, 3, 2800, 45, {
    description: '도시의 식량을 생산하는 농장. 공해는 적지만 넓은 땅이 필요합니다.',
    jobs: 180, production: { food: 160 }, color: '#8b9d4e',
  }),
  lumber: define('lumber', '제재소', 'industrial', 2, 2, 3200, 55, {
    description: '건설과 공업에 필요한 목재를 가공하는 제재소입니다.',
    jobs: 160, production: { wood: 110 }, pollution: 5, color: '#9c7549',
  }),
  coal: define('coal', '탄광', 'industrial', 2, 2, 4800, 80, {
    description: '기관차와 공장의 연료인 석탄을 공급합니다. 대기 오염이 발생합니다.',
    jobs: 260, production: { coal: 60 }, pollution: 15, color: '#625e60',
  }),
  iron: define('iron', '철광산', 'industrial', 2, 2, 5200, 85, {
    description: '제철에 필요한 철광석을 생산합니다.',
    jobs: 240, production: { iron: 35 }, pollution: 12, color: '#947062',
  }),
  textile: define('textile', '방직 공장', 'industrial', 2, 2, 5800, 95, {
    description: '전통적인 경공업 일자리를 제공하고 직물을 생산합니다.',
    jobs: 450, production: { goods: 55 }, inputs: { coal: 10 }, pollution: 9, color: '#b57960',
  }),
  steel: define('steel', '제철소', 'industrial', 3, 3, 10500, 165, {
    description: '철광석과 석탄을 사용해 철강을 생산하는 중공업의 중심입니다.',
    jobs: 540, production: { steel: 45 }, inputs: { iron: 30, coal: 20 }, pollution: 25, requires: ['steelmaking'], color: '#7f7371',
  }),
  power: define('power', '발전소', 'civic', 2, 2, 8500, 145, {
    description: '석탄으로 전력을 생산해 산업과 시민 생활을 지원합니다.',
    jobs: 180, capacity: 14000, inputs: { coal: 28 }, pollution: 22, requires: ['electricity'], color: '#878d8e',
  }),
  school: define('school', '공립학교', 'civic', 2, 2, 4500, 120, {
    description: '기초 교육을 제공해 시민의 교육 수준과 미래 생산성을 높입니다.',
    jobs: 80, capacity: 3500, color: '#b98d67',
  }),
  hospital: define('hospital', '시립병원', 'civic', 2, 2, 6800, 180, {
    description: '보건과 위생을 개선하고 인구 성장에 필요한 의료를 제공합니다.',
    jobs: 150, capacity: 5000, color: '#c4c5b3',
  }),
  police: define('police', '경찰서', 'civic', 1, 2, 3400, 90, {
    description: '시민의 안전을 지키고 도시의 생활 안정도를 높입니다.',
    jobs: 70, capacity: 6000, color: '#788b9b',
  }),
  fire: define('fire', '소방서', 'civic', 1, 2, 3200, 85, {
    description: '주거지와 공업지의 화재에 대비하는 공공 안전 시설입니다.',
    jobs: 60, capacity: 6500, color: '#aa5d48',
  }),
  park: define('park', '시민 공원', 'nature', 2, 2, 1500, 25, {
    description: '시민이 쉴 수 있는 녹지. 주변 행복도를 높이고 오염을 완화합니다.',
    jobs: 12, capacity: 2500, pollution: -12, color: '#6b965b',
  }),
  station: define('station', '철도역', 'transport', 2, 2, 6500, 100, {
    description: '철도와 도로로 연결된 도시의 여객·물류 거점입니다.',
    jobs: 150, capacity: 12000, color: '#8d917e',
  }),
  port: define('port', '무역항', 'transport', 3, 3, 14000, 210, {
    description: '해상 교역과 물류를 지원하는 부두와 창고 단지입니다.',
    jobs: 380, capacity: 18000, production: { goods: 20 }, pollution: 9, color: '#768d93',
  }),
  warehouse: define('warehouse', '물류 창고', 'commercial', 2, 2, 3800, 55, {
    description: '생산물을 보관하고 공장과 상점 사이의 물류를 지원합니다.',
    jobs: 140, capacity: 12000, color: '#ad9a77',
  }),
  bank: define('bank', '상업은행', 'commercial', 2, 2, 7200, 85, {
    description: '상공업 자금을 중개하고 도시의 금융 일자리를 만듭니다.',
    jobs: 230, color: '#bfbaa1',
  }),
  university: define('university', '종합대학교', 'civic', 3, 3, 18500, 310, {
    description: '고등 교육과 연구를 수행하며 기술 개발을 지원합니다.',
    jobs: 330, capacity: 9000, requires: ['mass_education'], color: '#9e7c65',
  }),
  townhall: define('townhall', '시청', 'civic', 2, 2, 6000, 110, {
    description: '도시 행정과 공공 서비스를 조율하는 시정의 중심입니다.',
    jobs: 130, capacity: 18000, color: '#c9b899',
  }),
  machine: define('machine', '기계 공장', 'industrial', 2, 3, 14500, 210, {
    description: '철강을 가공해 기계와 산업용 제품을 생산합니다.',
    jobs: 620, production: { goods: 85 }, inputs: { steel: 18, coal: 10 },
    pollution: 18, requires: ['steelmaking'], color: '#8b9992',
  }),
  auto: define('auto', '자동차 공장', 'industrial', 3, 3, 24500, 325, {
    description: '조립 라인으로 자동차를 생산하는 대규모 제조 시설입니다.',
    jobs: 1050, production: { goods: 150 }, inputs: { steel: 30, fuel: 12 },
    pollution: 24, requires: ['assembly_line'], color: '#89999b',
  }),
  chemical: define('chemical', '화학 공장', 'industrial', 2, 3, 16500, 230, {
    description: '석유를 원료로 산업용 화학제품과 생활용품을 생산합니다.',
    jobs: 440, production: { goods: 80 }, inputs: { oil: 22, coal: 8 },
    pollution: 28, requires: ['petroleum'], color: '#97a88f',
  }),
  refinery: define('refinery', '정유소', 'industrial', 3, 3, 21000, 280, {
    description: '원유를 정제해 공장과 운송에 필요한 연료를 공급합니다.',
    jobs: 420, production: { fuel: 70 }, inputs: { oil: 48 },
    pollution: 30, requires: ['petroleum'], color: '#9da3a3',
  }),
  museum: define('museum', '시립박물관', 'civic', 2, 2, 7800, 100, {
    description: '도시의 역사와 문화를 보존하고 시민의 문화생활을 풍요롭게 합니다.',
    jobs: 80, capacity: 6000, color: '#c5b79b',
  }),
  theatre: define('theatre', '시립극장', 'commercial', 2, 2, 6800, 75, {
    description: '연극과 공연이 열리는 문화 시설. 상업과 시민 만족에 기여합니다.',
    jobs: 130, capacity: 5000, color: '#ad8175',
  }),
  post: define('post', '우체국', 'civic', 1, 2, 2800, 55, {
    description: '편지와 소포를 전달하며 지역 사이의 연락을 지원합니다.',
    jobs: 90, capacity: 10000, color: '#a98968',
  }),
  government: define('government', '정부 청사', 'civic', 3, 3, 21000, 270, {
    description: '국가 정책과 공공 예산을 운영하는 중앙 행정 기관입니다.',
    jobs: 410, capacity: 40000, color: '#b9b099',
  }),
  parliament: define('parliament', '의회', 'civic', 3, 3, 24000, 280, {
    description: '시민의 대표가 모여 국가의 제도와 예산을 논의하는 의회입니다.',
    jobs: 280, capacity: 40000, color: '#b8a58a',
  }),
  centralbank: define('centralbank', '중앙은행', 'civic', 2, 3, 18500, 210, {
    description: '국가 금융 체계와 통화 정책을 담당하는 중앙은행입니다.',
    jobs: 260, capacity: 50000, color: '#b4b49e',
  }),
  shipyard: define('shipyard', '조선소', 'industrial', 3, 3, 22000, 310, {
    description: '철강과 목재로 선박과 해양 설비를 생산합니다.',
    jobs: 870, production: { goods: 125 }, inputs: { steel: 25, wood: 18, coal: 10 },
    pollution: 22, requires: ['steelmaking'], color: '#819496',
  }),
  industrial: define('industrial', '일반 공장', 'industrial', 2, 2, 5200, 90, {
    description: '목재와 석탄을 소비해 다양한 생활용품을 생산하는 소규모 공장입니다.',
    jobs: 380, production: { goods: 85 }, inputs: { wood: 20, coal: 12 },
    pollution: 12, color: '#a18266',
  }),
  depot: define('depot', '철도 차량기지', 'transport', 2, 3, 8500, 120, {
    description: '기관차를 정비하고 철도 화물과 운행을 지원하는 시설입니다.',
    jobs: 220, capacity: 22000, inputs: { coal: 10 }, pollution: 8, color: '#8e8676',
  }),
  oilwell: define('oilwell', '유전', 'industrial', 2, 2, 14500, 190, {
    description: '정유소와 화학 공장의 원료가 되는 원유를 생산합니다.',
    jobs: 290, production: { oil: 90 }, pollution: 21, requires: ['petroleum'], color: '#8b8575',
  }),
};
