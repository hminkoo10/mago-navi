# 마고 과목내비

학생마다 희망 학과와 대학을 고르면 우리 학교 편제표에서 들을 선택과목을 짜 주는 웹앱. 대학별 2028학년도 권장과목과 전형을 함께 보여 준다.

https://magonavi.milky.kr

[과목내비](https://github.com/hminkoo10/gwamok-navi)(hminkoo10/gwamok-navi)를 마고에듀 통합 클라우드에 맞춰 고친 포크다.

- 로그인은 **마고에듀 통합 클라우드** 계정으로만 한다 (Google 로그인·가입 화면 없음).
- 설계는 학원 학생마다 따로 저장한다. 학생 명단은 통합 클라우드의 것을 쓴다.
- AI는 학원 AI(통합 클라우드에서 원장이 정함)나 내 키 중에서 고른다.
- PC 프로그램(`desktop/`)은 통합 클라우드가 설치·실행하고 자동으로 로그인한다.

## 학생 계정

- 학생은 웹에서 본인 학생 설계만 보고 고쳐요. 명단·학생 추가·관리·키 입력 화면은 보이지 않아요.
- 로그인할 때 클라우드 `/api/me`의 `user.role`, `student`, `aiMode`를 확인하고, 기존 세션은 10분마다 다시 확인해요.
- `teacher` 모드는 담당 선생님이 과목내비에 등록한 Gemini 키를 서버에서만 써요. 학생에게 키나 끝자리를 보내지 않아요.
- `academy` 모드는 학생의 앱 세션으로 학원 AI를 중계해요. 학생은 본인 키나 운영자 서버 AI로 자동 전환하지 않아요.
- 통합 조건: 학생의 `mago-navi` 앱 세션에 **`GET /api/academy/ai`의 키 없는 공급자·모델 정보 조회**가 필요해요. 이 경로가 `student_forbidden`이면 중계 전에 막혀요. 클라우드 쪽 읽기 허용을 맞춘 뒤 통합 시험해야 해요. `/api/students`는 학생 세션으로 부르지 않아요.

## 실행

Node 24 이상.

```bash
npm install
cp .env.example .env   # 값 설명은 아래와 파일 안에 있다
npm run dev
npm test
```

운영은 `npm run build` 후 `npm start`.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `MAGO_CLOUD_URL` | 통합 클라우드 주소 (예: `https://mago.milky.kr`) |
| `MAGO_APP_ID` | 통합 클라우드 프로그램 목록의 웹 프로그램 ID. 기본 `mago-navi` |
| `MAGO_APP_SECRET` | 통합 클라우드 **프로그램 관리 → 앱 비밀값 만들기**에서 한 번만 보여 주는 값 |
| `AI_KEY_SECRET` | 서버에 저장하는 키 암호화용 비밀값 (16자 이상). 비우면 `DATA_DIR/ai-key.secret`을 만들어 쓴다. 운영에서는 DB와 떨어진 여기가 안전. 바꾸면 저장된 값을 못 푼다 |
| `MAGO_SERVER_AI_FALLBACK` | `1`이면 학원 AI도 내 키도 없을 때 서버 AI(`AI_BASE_URL` 등)를 쓴다. 기본 끔 (비용) |
| `NEIS_API_KEY` | 나이스 교육정보 개방 포털 인증키. 없으면 학교 검색 결과 5건까지 |
| `PORT`, `HOST` | 기본 `8080`, `127.0.0.1`. 운영 서버는 `8480` |
| `TRUST_PROXY` | nginx 등 프록시 뒤면 `1` (**운영 필수**). X-Forwarded-For·Proto를 믿어야 요청 제한이 실제 IP로 걸리고 로그인 쿠키(`__Host-`)에 Secure가 붙는다 |
| `DATA_DIR` | SQLite 위치. 기본 `./data` |

서버 AI(`AI_*`), 하루 상한(`DAILY_LIMIT_*`), `ADMIN_TOKEN`, `ALLOWED_ORIGINS` 같은 나머지 값은 `.env.example`에 있다.
Google 로그인 값(`GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`OWNER_EMAIL`)은 쓰지 않는다. 통합 클라우드 운영자가 관리자다.

## 배포

- 웹: `main`에 올리면 `.github/workflows/deploy.yml`이 시험·빌드한 뒤 서버에 올리고 `mago-navi-deploy`로 바꿔 끼운다 (`/api/health`가 안 뜨면 이전 판으로 되돌림).
  서버에 처음 한 번 넣을 파일과 순서는 `deploy/`에 있다.
- PC: `desktop-v<버전>` 태그를 올리면 `.github/workflows/release-desktop.yml`이 `MagoNavi-<버전>-win-x64.zip`을 Release에 올리고, 통합 클라우드가 받아 설치한다. 자세한 것은 `desktop/README.md`.

## 라이선스

AGPL-3.0 (`LICENSE`). 원본 과목내비와 같다. 이 판의 소스: https://github.com/hminkoo10/mago-navi
고친 판을 서버로 띄우면 그 소스도 사용자에게 공개해야 한다. 웹에서는 `/LICENSE`로 전문을 보인다.

## 자료

- 권장과목: 대교협 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」과 대학 공식 자료 (`data-src/adiga2028`)
- 전형: 대학별 「2028학년도 대학입학전형시행계획」 (`data-src/admissions2028`)
