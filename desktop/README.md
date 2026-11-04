# 마고 과목내비 PC

웹 마고 과목내비(https://magonavi.milky.kr)를 창으로 여는 Windows 프로그램(Electron).
**마고에듀 통합 클라우드에서만** 설치·실행하고, 켤 때 통합 클라우드가 넘겨준 일회용 코드로 그 계정에 자동으로 로그인한다.
데이터는 웹 서버에 있어서 이 프로그램은 동기화할 것이 없다. 연결 방법은 MagoEdu `docs/INTEGRATION.md` (특히 4-3번 `sso`).

- `src/main.js`: 통합 클라우드 확인 → `POST /api/auth/mago/code` (`x-mago-pc: 1`)로 로그인 → 사이트 열기.
  사이트가 `/login`으로 가면 통합 클라우드에 새 코드를 받아 다시 로그인한다. 인터넷이 없으면 안내 화면(`src/pages/`).
- 계정마다 따로 저장 공간(`persist:navi-<계정 ID>`), 이동은 과목내비 주소 안에서만(나머지는 기본 브라우저), 권한 요청은 모두 거절.
- 배포본에서는 개발자 도구를 막는다: 창의 개발자 도구, `--inspect`·`--remote-debugging-*` 인수(바로 끝냄),
  `ELECTRON_RUN_AS_NODE`·`NODE_OPTIONS` (`package.json`의 `electronFuses`).
- `src/magoedu-cloud.js`는 MagoEdu `sdk/node/magoedu-cloud.js`를 그대로 복사한 것이다. 고치지 말고 SDK가 바뀌면 다시 복사한다.

## 학원 학생 명단 (읽기 전용)

- `magoedu-app.json`의 `academyInfo: true` → launcher가 계정별 앱 폴더의 `academy-info.json`을 쓰고
  `MAGOEDU_ACADEMY_INFO`로 경로를 넘긴다. `sync` 폴더의 형제 파일이다.
  학원 공유 파일 기능은 쓰지 않으므로 `MAGOEDU_ACADEMY_ID`가 비어 있어도 정상이다.
- `src/academy-roster.js`: 8 MiB·학생 5,000명 상한, format/계정/역할/필드 검증, 삭제·영구삭제·중복 ID 제외.
  폴더 감시(원자 교체 대응)와 30초 주기 확인. 파일 삭제/손상은 명단을 비우며 SDK/원본 파일은 고치지 않는다.
- main → 제한된 preload IPC → 웹 UI. 허용 사이트의 주 창/주 프레임만 읽을 수 있고 이름·학교·학년 외 메모·AI·키는 보내지 않는다.
  웹 로그인 계정의 cloudId·학원·역할도 대조한다. 학생은 기존 SSO `user.student.id`가 명단 ID와 일치할 때만 본인 정보를 채운다.
- 학생 선택 화면과 학교 입력 화면의 **학원 명단에서 고르기**로 이름 검색 → 기존 학생 ID의 설계를 연다.
  새 학생을 만들거나 `students.save`를 보내지 않는다. 이름·학교·학년을 표시하고 새 설계의 학교·입학년도를 채운다.
  기존 설계의 학교와 사용자가 고친 값은 자동 갱신으로 덮지 않는다. 현재 학생을 다시 고르면 명시적으로 다시 채운다.
- 학교는 기존 나이스 검색 결과에서 공백·끝의 `고등학교`/`고`만 정규화해 정확히 하나일 때 선택한다.
  동명/미일치/잘릴 수 있는 결과(5건 이상)는 직접 선택. 학년은 명확한 고1~고3만 한국 시간 학년도 기준 입학년도로 변환한다.
  편제표 조회·AI 읽기·저장은 **이 학교 편제표 불러오기**를 누른 뒤 기존 흐름을 따른다.
- 일반 브라우저/학원 밖 계정/명단을 못 읽는 경우에는 기존 UI 유지. 브라우저에서도 자동 채우기를 쓰려면
  이미 있는 `/api/students` 명단을 동일 UI에 연결하면 된다(이번 변경에는 포함하지 않음).

launcher 코드 변경은 필요 없다. 다만 새 `academyInfo` 매니페스트가 포함된 PC 묶음과 이 저장소의 웹 UI를 함께 배포해야 한다.
PC가 원격 웹 화면을 여는 구조라 PC만 업데이트하면 새 선택 UI는 나타나지 않는다.

검증: 루트 `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`; desktop `npm test`, `npm run check`, `npm run dist`.
desktop 테스트는 루트의 기존 Vitest를 사용하므로 루트/desktop 각각 `npm ci --prefer-offline` 필요.

## 개발 실행

로컬 과목내비(저장소 맨 위에서 `npm run dev`, 로컬 통합 클라우드에 연결)에 붙인다. 빌드 전에는 `MAGOEDU_DEV=1`이면 통합 클라우드 없이 켜진다.

```bash
cd desktop
npm install
# 로그인 코드: 로컬 통합 클라우드에 로그인한 토큰으로 받는다 (60초 안에 켜기)
#   curl -s -X POST http://localhost:8470/api/sso/authorize -H "authorization: Bearer <토큰>" \
#        -H "content-type: application/json" -d '{"appId":"mago-navi"}'
MAGOEDU_DEV=1 MAGOEDU_USER_ID=<계정 ID> MAGOEDU_SSO_CODE=<code> MAGO_NAVI_URL=http://localhost:5173 npm start
```

- `MAGO_NAVI_URL`은 빌드 전에만 쓴다 (배포본은 언제나 https://magonavi.milky.kr).
- 다시 로그인(`cloud.ssoCode`)까지 시험하려면 `MAGOEDU_REQUEST_DIR`도 줘야 한다. 없으면 코드를 다 쓴 뒤에는 '로그인하지 못했어요' 화면이 나온다.
  끝까지 확인하려면 로컬 통합 클라우드 앱에 이 프로그램(zip)을 설치해서 켠다.
- `MAGOEDU_DEV` 없이 `npm start`를 하면 "통합 클라우드에서만 켤 수 있어요" 안내가 뜨고 통합 클라우드를 연다.
- 개발 실행에서는 F12로 개발자 도구를 연다.

## 빌드·배포

```bash
npm run dist   # dist/win-unpacked (MagoNavi.exe, LICENSE, magoedu-app.json)
# 통합 클라우드가 받는 묶음 (zip 맨 위에 MagoNavi.exe)
cd dist/win-unpacked && 7z a -tzip ../MagoNavi-<버전>-win-x64.zip . && cd .. && sha256sum MagoNavi-<버전>-win-x64.zip > MagoNavi-<버전>-win-x64.zip.sha256
```

보통은 GitHub Actions(`.github/workflows/release-desktop.yml`)가 한다: `package.json`의 `version`을 올리고 `desktop-v<버전>` 태그를 올리면
`MagoNavi-<버전>-win-x64.zip`, `.sha256`, `magoedu-app.json`을 Release에 올리고, 통합 클라우드가 새 버전을 받아 다음에 켤 때 쓴다.

아이콘(`build/icon.ico`, `build/icon.png`)은 저장소 맨 위의 `npm run icon`이 만든다.
