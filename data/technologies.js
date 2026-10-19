/** Research costs are paid once; progress is measured in simulation months. */
export const TECHNOLOGIES = {
  mechanization: { id: 'mechanization', name: '증기 기계화', cost: 4500, months: 4, year: 1850, requires: [], description: '증기기관과 기계 설비를 보급해 초기 산업의 생산성을 높입니다.' },
  railways: { id: 'railways', name: '철도 운송', cost: 5500, months: 5, year: 1850, requires: [], description: '증기 철도와 화물 운송 체계를 발전시켜 도시 간 교역을 지원합니다.' },
  telegraph: { id: 'telegraph', name: '전신 통신', cost: 4000, months: 4, year: 1850, requires: [], description: '전신망으로 소식을 빠르게 전달해 행정과 상업의 효율을 높입니다.' },
  agricultural_science: { id: 'agricultural_science', name: '근대 농학', cost: 4200, months: 4, year: 1850, requires: [], description: '작물 개량과 토양 관리 기술을 도입해 안정적인 식량 생산을 지원합니다.' },
  electricity: { id: 'electricity', name: '도시 전력망', cost: 8000, months: 5, year: 1880, requires: ['mechanization'], description: '전력 공급과 공장 설비를 개선합니다. 발전소를 해금합니다.', unlocks: ['power'] },
  sanitation: { id: 'sanitation', name: '근대 상하수도', cost: 6500, months: 4, year: 1850, requires: [], description: '깨끗한 식수와 위생 시설로 질병을 줄이고 시민 건강을 개선합니다.' },
  mass_education: { id: 'mass_education', name: '보편 교육', cost: 9500, months: 6, year: 1870, requires: [], description: '공공 교육을 확대하고 종합대학교 건설을 해금합니다.', unlocks: ['university'] },
  steelmaking: { id: 'steelmaking', name: '근대 제강법', cost: 11000, months: 6, year: 1855, requires: ['mechanization'], description: '철강 가공을 발전시켜 제철소와 기계 공장, 조선소를 건설할 수 있습니다.', unlocks: ['steel', 'machine', 'shipyard'] },
  petroleum: { id: 'petroleum', name: '석유 산업', cost: 13500, months: 7, year: 1880, requires: ['steelmaking'], description: '원유 채굴과 정제를 도입합니다. 유전·정유소·화학 공장을 해금합니다.', unlocks: ['oilwell', 'refinery', 'chemical'] },
  assembly_line: { id: 'assembly_line', name: '대량 생산', cost: 18000, months: 8, year: 1910, requires: ['electricity', 'steelmaking'], description: '조립 라인을 도입해 자동차 공장을 건설하고 공업 생산을 확대합니다.', unlocks: ['auto'] },
  aviation: { id: 'aviation', name: '항공 공학', cost: 20000, months: 9, year: 1915, requires: ['petroleum'], description: '엔진과 경량 구조물 연구로 운송·산업 기술의 기반을 확장합니다.' },
  radio: { id: 'radio', name: '무선 통신', cost: 17000, months: 7, year: 1920, requires: ['electricity'], description: '도시 사이의 통신과 정보 전달을 발전시켜 상업 효율을 높입니다.' },
  urban_planning: { id: 'urban_planning', name: '근대 도시계획', cost: 12000, months: 6, year: 1870, requires: ['sanitation'], description: '위생과 교통을 고려한 고밀도 시가지를 설계합니다. 공동 주택을 해금합니다.', unlocks: ['apartment'] },
  medicine: { id: 'medicine', name: '현대 의학', cost: 24000, months: 10, year: 1930, requires: ['sanitation', 'mass_education'], description: '의료 연구와 치료 기술을 발전시켜 병원의 효과와 시민 건강을 개선합니다.' },
  advanced_rail: { id: 'advanced_rail', name: '철도 전철화', cost: 30000, months: 11, year: 1930, requires: ['railways', 'electricity'], description: '전기 기관차와 신호 체계로 도시 간 철도 운송의 효율을 높입니다.' },
};
