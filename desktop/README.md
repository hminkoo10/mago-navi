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
