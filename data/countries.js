/** Historical labels are presentation only; country identity remains stable in saves. */
export const COUNTRIES = [
  { id: 'korea', name: '조선', capital: '한성', color: '#bd5845', industry: 'balanced', government: 'monarchy', description: '근대화의 갈림길에 선 반도 국가. 농업과 교육에서 산업화의 토대를 다집니다.' },
  { id: 'japan', name: '에도 막부', capital: '에도', color: '#b56f65', industry: 'manufacturing', government: 'monarchy', description: '철도와 제조업을 기반으로 근대 도시를 키우는 섬나라입니다.' },
  { id: 'britain', name: '영국', capital: '런던', color: '#668294', industry: 'trade', government: 'constitutional', description: '오랜 산업과 해상 무역을 바탕으로 금융과 교통을 발전시킵니다.' },
  { id: 'france', name: '프랑스', capital: '파리', color: '#7d8baf', industry: 'balanced', government: 'republic', description: '공화정과 문화, 농업과 도시 산업이 어우러진 국가입니다.' },
  { id: 'germany', name: '프로이센', capital: '베를린', color: '#9b8b69', industry: 'heavy', government: 'monarchy', description: '철강과 기계 공업, 전문 교육을 중심으로 성장하는 국가입니다.' },
  { id: 'usa', name: '미합중국', capital: '워싱턴', color: '#698ca2', industry: 'manufacturing', government: 'republic', description: '풍부한 자원과 큰 내수 시장을 가진 연방 공화국입니다.' },
  { id: 'russia', name: '러시아 제국', capital: '상트페테르부르크', color: '#83956b', industry: 'resources', government: 'monarchy', description: '광대한 영토의 자원을 철도와 산업으로 연결하는 국가입니다.' },
  { id: 'china', name: '청', capital: '베이징', color: '#bb9a53', industry: 'agriculture', government: 'monarchy', description: '큰 인구와 농업을 기반으로 도시와 산업의 전환을 이끕니다.' },
  { id: 'italy', name: '사르데냐 왕국', capital: '토리노', color: '#79927a', industry: 'balanced', government: 'constitutional', description: '역사적인 도시와 항만을 연결하며 제조업과 문화를 키웁니다.' },
  { id: 'austria', name: '오스트리아 제국', capital: '빈', color: '#b29b80', industry: 'balanced', government: 'monarchy', description: '중부 유럽의 교통과 문화가 만나는 다민족 제국입니다.' },
  { id: 'custom', name: '사용자 정의 국가', capital: '새 수도', color: '#719c94', industry: 'balanced', government: 'republic', description: '국가 이름과 수도, 정치 체제, 산업 방향을 직접 정해 새로운 역사를 만듭니다.' },
];

const HISTORICAL_NAMES = {
  korea: [[1850, '조선'], [1897, '대한제국'], [1910, '조선 (일제강점기)'], [1945, '조선 (해방)'], [1948, '대한민국']],
  japan: [[1850, '에도 막부'], [1868, '일본 제국'], [1947, '일본']],
  britain: [[1850, '영국']],
  france: [[1850, '프랑스 제2공화국'], [1852, '프랑스 제2제국'], [1870, '프랑스 제3공화국'], [1940, '프랑스국'], [1944, '프랑스 공화국']],
  germany: [[1850, '프로이센'], [1871, '독일 제국'], [1919, '바이마르 공화국'], [1933, '독일국'], [1945, '독일 (연합군 점령기)'], [1949, '독일 연방공화국 (서독)']],
  usa: [[1850, '미합중국']],
  russia: [[1850, '러시아 제국'], [1917, '러시아 공화국'], [1918, '러시아 소비에트 공화국'], [1922, '소련']],
  china: [[1850, '청'], [1912, '중화민국'], [1949, '중화인민공화국']],
  italy: [[1850, '사르데냐 왕국'], [1861, '이탈리아 왕국'], [1946, '이탈리아 공화국']],
  austria: [[1850, '오스트리아 제국'], [1867, '오스트리아-헝가리'], [1918, '오스트리아 공화국'], [1938, '오스트리아 (독일 병합기)'], [1945, '오스트리아 공화국']],
  custom: [[1850, '사용자 정의 국가']],
};

export function countryName(id, year = 1900) {
  const names = HISTORICAL_NAMES[id];
  if (!names) return COUNTRIES.find(country => country.id === id)?.name ?? String(id ?? '국가');
  const targetYear = Number.isFinite(Number(year)) ? Number(year) : 1900;
  let name = names[0][1];
  for (const [from, label] of names) {
    if (targetYear < from) break;
    name = label;
  }
  return name;
}

/** Scenario labels only: existing player cities are not renamed when time advances. */
export function countryCapital(id, year = 1900) {
  if (id === 'japan') return year < 1868 ? '에도' : '도쿄';
  if (id === 'italy') return year < 1865 ? '토리노' : year < 1871 ? '피렌체' : '로마';
  if (id === 'russia') return year < 1918 ? '상트페테르부르크' : '모스크바';
  if (id === 'korea') return year < 1910 ? '한성' : year < 1945 ? '경성' : '서울';
  return COUNTRIES.find(country => country.id === id)?.capital || '새 수도';
}
