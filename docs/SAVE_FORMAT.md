# 저장 파일과 브라우저 슬롯

저장은 서버로 전송되지 않습니다. 같은 브라우저·기기·사이트 주소에서 IndexedDB 데이터베이스 `century-nation-city`의 `saves` 저장소에 기록됩니다. 수동 슬롯 `0`, `1`, `2`와 자동 슬롯 `auto`가 있습니다. IndexedDB를 열 수 없을 때만 localStorage를 사용합니다. 브라우저 저장소를 지우거나 시크릿 창을 닫으면 저장이 사라질 수 있으므로 JSON 내보내기로 별도 보관하세요. 다른 도메인으로 배포하면 기존 브라우저 슬롯은 공유되지 않습니다.

JSON 파일은 다음 포맷을 사용합니다. `state`는 게임 상태의 깊은 복사본입니다. `savedAt`은 UTC ISO 날짜입니다. `checksum`은 `JSON.stringify(state)`의 UTF-16 코드 유닛에 대한 FNV-1a 32비트 체크섬으로, 파일의 우발적인 손상·수정을 감지합니다. 암호화나 악의적인 위변조에 대한 인증은 아닙니다.

```json
{
  "format": "century-nation-city",
  "formatVersion": 1,
  "savedAt": "2026-10-19T00:00:00.000Z",
  "checksum": "fnv1a32:12345678",
  "state": { "version": 1 }
}
```

위 예시의 `state`는 설명용 축약입니다. 실제 파일은 국가, 날짜, 정책, 연구, 도시 전체 타일과 건물, 자원, 연결, 통계, 이벤트, 되돌리기 기록을 모두 포함합니다. 사용자 이미지는 `customAssets` 배열의 `{id, name, dataUrl, baseType, cost}` 레코드로 함께 저장됩니다. 이미지의 `id`는 `custom-`로 시작하고, 해당 건물의 `type`과 연결됩니다.

가져오기는 버전, 전체 JSON 구조, 유한 숫자, 타일 수, 좌표, 날짜, 고유 식별자, 존재하는 도시 연결, 사용자 이미지 및 체크섬을 검사합니다. HTML·SVG·원격 이미지 주소는 허용하지 않습니다. 잘못된 파일은 현재 게임을 바꾸기 전에 거부됩니다. 버전 1 이외의 파일과 봉투 없는 원시 상태는 지원하지 않습니다.

- 상태 크기: 최대 24 MiB, 도시 최대 16개, 지도 한 변 16~128칸.
- 이미지: PNG/JPEG/WebP/GIF, 파일당 1 MiB, 합계 8 MiB, 최대 64개. PNG/GIF 헤더의 최대 치수는 512×512이며 편집기는 실제 이미지 치수도 검사합니다.
- 슬롯 목록은 사용 중인 슬롯의 `id`, `name`, `savedAt`, `year`, `month`, `country`, `population`을 반환합니다. 빈 슬롯은 목록에 없습니다. 존재하지 않는 슬롯 로드는 `null`입니다.
- 저장 공간 부족이나 손상된 슬롯은 명시적인 `SaveError`를 발생시킵니다. `QUOTA_EXCEEDED`, `STORAGE_UNAVAILABLE`, `STORAGE_FAILURE`, `INVALID_SAVE`, `CHECKSUM_MISMATCH`, `INCOMPATIBLE_VERSION`, `SAVE_TOO_LARGE`, `INVALID_SLOT` 코드를 사용할 수 있습니다.

슬롯을 삭제하는 작업은 해당 슬롯만 제거합니다. JSON 파일을 가져오는 것만으로 슬롯을 덮어쓰지 않으며, 가져온 게임에서 저장을 눌러야 슬롯에 기록됩니다. 저장 API는 `src/save/storage.js`에 있습니다.

## 선택적 실제 브라우저 검증

게임 실행에는 Python Playwright가 필요하지 않습니다. 개발 중 브라우저 저장과 업로드 흐름을 재검증할 때만 설치합니다. 먼저 별도 터미널에서 `npm run dev`를 실행하세요.

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser_storage.py --url http://127.0.0.1:3000 --output /tmp/century-browser-storage
```

이미 Chromium이 설치되어 있다면 `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`으로 지정할 수 있습니다. 서버 주소는 `--url` 또는 `CENTURY_URL`로 바꿀 수 있고, 선택적인 `--output` 폴더에 `report.json`을 기록합니다. 테스트는 격리된 임시 브라우저 컨텍스트에서 실제 저장·불러오기·삭제 버튼, IndexedDB 슬롯 3개와 자동 슬롯, 새 페이지·새로고침 후 복원, PNG 업로드·지도 건설, JSON 다운로드·가져오기, 체크섬 손상 파일과 이미지 픽셀 데이터 손상 파일 거부를 검사합니다. 자동 저장은 실제 등록된 250ms 타이머 콜백을 240회 호출하여 60초 조건을 검증하며 1분의 실제 대기 시간은 필요하지 않습니다. 게임 파일이나 사용자의 기존 브라우저 저장은 바꾸지 않습니다.
