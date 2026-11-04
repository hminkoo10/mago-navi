'use strict';

// 마고 과목내비 PC - Electron 메인 프로세스
// - 마고에듀 통합 클라우드에서만 켜짐 (src/magoedu-cloud.js). 통합 클라우드가 넘겨준 일회용 코드(MAGOEDU_SSO_CODE)로
//   웹 마고 과목내비(https://magonavi.milky.kr)에 로그인한 뒤 그 사이트를 창으로 보여 줌. 데이터는 웹 서버에 있어서 동기화할 것이 없음
// - 계정마다 따로 저장 공간(persist:navi-<계정 ID>): 쿠키·캐시가 다른 계정과 섞이지 않게
// - 로그인이 끊기면(사이트가 /login 으로 감) 통합 클라우드에 새 코드를 받아 다시 로그인
// - 이동은 과목내비 주소 안에서만, 다른 주소는 기본 브라우저로. 권한 요청(카메라·알림 등)은 모두 거절
// - 배포본에서는 개발자 도구를 막음 (창의 개발자 도구·원격 디버깅·--inspect, ELECTRON_RUN_AS_NODE 는 package.json 의 electronFuses)
// - 업데이트는 통합 클라우드가 받아 둠 (다음에 켤 때 새 버전으로)

const { app, BrowserWindow, Menu, dialog, ipcMain, session: sessions, shell } = require('electron');
const path = require('node:path');
const cloud = require('./magoedu-cloud');
const { readRoster, watchRoster, rosterSender } = require('./academy-roster');

const APP_ID = 'mago-navi-pc';
const TITLE = '마고 과목내비';
// 개발 실행(빌드 전)에서만 MAGO_NAVI_URL 로 바꿀 수 있음 (예: http://localhost:5173)
const NAVI = new URL((!app.isPackaged && process.env.MAGO_NAVI_URL) || 'https://magonavi.milky.kr').origin;
const PAGES = path.join(__dirname, 'pages');
/** 로그인하고 이만큼 안에 또 로그인 화면으로 가면 되풀이하지 않고 안내 화면 (쿠키가 저장되지 않는 경우 등) */
const RELOGIN_GUARD_MS = 20 * 1000;

// 배포본에서는 개발자 도구를 막는다 (창의 개발자 도구, 원격 디버깅으로 붙기). 개발 실행에서만 열 수 있음
const devTools = !app.isPackaged;
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some((s) => app.commandLine.hasSwitch(s))) app.exit(1);

// 통합 클라우드에서 켜졌는지 확인. 개발 실행은 MAGOEDU_DEV=1 (README)
const cs = cloud.check(APP_ID, { packaged: app.isPackaged });
if (cs) app.setPath('userData', cs.localDir); // 캐시·로그는 이 컴퓨터에만

// 윈도우 작업 표시줄에서 통합 클라우드가 만든 바로 가기와 같은 앱으로 묶이게
if (process.platform === 'win32') app.setAppUserModelId('io.github.hminkoo10.magonavi');

let win = null;
let ses = null;
let launchCode = cs?.ssoCode || ''; // 켤 때 받은 60초짜리 코드 (한 번만 씀)
let loggedInAt = 0;
let opening = null;
let stopRoster = () => {};

ipcMain.handle('academy-roster:get', (event) => rosterSender(event, win, NAVI) ? readRoster(cs) : null);

function isNavi(url) {
  try {
    return new URL(url).origin === NAVI;
  } catch {
    return false;
  }
}

function openOutside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
  } catch {
    /* 잘못된 주소는 무시 */
  }
}

/** 안내 화면 (src/pages/*.html). '다시 시도'는 ?retry 로 이동하는 링크라 will-navigate 에서 받는다 */
function showPage(name) {
  if (win && !win.isDestroyed()) win.loadFile(path.join(PAGES, `${name}.html`)).catch(() => {});
}

function isRetry(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.searchParams.has('retry');
  } catch {
    return false;
  }
}

/** 웹 로그인 시작 주소 (사이트의 로그인 버튼). PC 에서는 통합 클라우드 코드로 대신 로그인 */
function isWebLogin(url) {
  return isNavi(url) && new URL(url).pathname === '/api/auth/mago';
}

/** 일회용 코드로 과목내비에 로그인. 이 계정의 저장 공간으로 보내서 받은 쿠키가 창에 그대로 쓰임 → 'ok' | 'offline' | 'failed' */
async function postCode(code) {
  let res;
  try {
    res = await ses.fetch(`${NAVI}/api/auth/mago/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mago-pc': '1' },
      body: JSON.stringify({ code }),
      credentials: 'include',
    });
  } catch (err) {
    console.warn('[login] 연결하지 못함:', err?.message || err);
    return 'offline';
  }
  if (res.ok) return 'ok';
  console.warn('[login] 로그인 거절:', res.status, (await res.text().catch(() => '')).slice(0, 300));
  return 'failed';
}

/** 켤 때 받은 코드(그사이 지났으면 새 코드로 한 번 더), 없거나 다 썼으면 통합 클라우드에 새 코드를 부탁 */
async function login() {
  for (let i = 0; i < 2; i += 1) {
    const fromLaunch = !!launchCode;
    let code = launchCode;
    launchCode = '';
    if (!code) {
      const r = await cloud.ssoCode(cs);
      if (!r.ok) {
        console.warn('[login] 새 코드를 받지 못함:', r.errorCode, r.error);
        return r.errorCode === 'offline' ? 'offline' : 'failed';
      }
      code = r.code;
    }
    const result = await postCode(code);
    if (result !== 'failed' || !fromLaunch) return result;
  }
  return 'failed';
}

/** 로그인하고 과목내비 열기 (여러 번 불려도 한 번만) */
function open() {
  opening ??= (async () => {
    const r = await login();
    if (!win || win.isDestroyed()) return;
    if (r !== 'ok') return showPage(r === 'offline' ? 'offline' : 'login-failed');
    loggedInAt = Date.now();
    // 기다리지 않음: 열리는 중에 사이트가 /login 으로 가도 onNavigated 가 받게. 못 열면 did-fail-load 가 안내 화면으로
    win.loadURL(`${NAVI}/`).catch(() => {});
  })().finally(() => {
    opening = null;
  });
  return opening;
}

/** 사이트가 로그인 화면으로 가면(로그아웃·세션 끝남) 다시 로그인 */
function onNavigated(url) {
  if (!isNavi(url) || new URL(url).pathname !== '/login' || opening) return;
  if (Date.now() - loggedInAt < RELOGIN_GUARD_MS) return showPage('login-failed');
  open();
}

function createWindow() {
  ses = sessions.fromPartition(`persist:navi-${String(cs.user.id || 'dev').replace(/[^A-Za-z0-9_-]/g, '_')}`);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: TITLE,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools,
    },
  });
  const wc = win.webContents;
  stopRoster = watchRoster(cs, () => {
    // 데이터 대신 변경 알림만. 받는 쪽은 검증된 get IPC로 다시 읽는다.
    if (!wc.isDestroyed() && isNavi(wc.getURL())) wc.send('academy-roster:changed');
  });

  win.once('ready-to-show', () => win.show());

  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (isRetry(url)) {
      event.preventDefault();
      showPage('loading');
      open();
    } else if (isWebLogin(url)) {
      event.preventDefault();
      open();
    } else if (!isNavi(url)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  wc.on('will-redirect', (event, url) => {
    if (isWebLogin(url)) {
      event.preventDefault();
      open();
    } else if (!isNavi(url)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  wc.on('did-navigate', (_e, url) => onNavigated(url));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) onNavigated(url);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3: 다른 이동으로 멈춤 (오류 아님)
    if (!isMainFrame || code === -3 || !isNavi(url)) return;
    console.warn('[load] 열지 못함:', code, desc, url);
    showPage('offline');
  });
  wc.on('before-input-event', (event, input) => {
    if (devTools && input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      wc.toggleDevTools();
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    stopRoster();
    win = null;
  });
  showPage('loading');
  open();
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

if (!cs) {
  // 통합 클라우드에서 켜지 않음 → 통합 클라우드가 설치되어 있으면 안내 없이 넘겨서 켜 달라고 함.
  // 없거나 넘기지 못했거나 통합 클라우드가 켰는데 확인이 안 됐으면 안내 (통합 클라우드가 있으면 열어 줌)
  app.whenReady().then(() => {
    const installed = !!app.getApplicationNameForProtocol(`magoedu://launch/${APP_ID}`);
    const handOff = cloud.shouldHandOff({ installed });
    if (handOff && cloud.openCloud(APP_ID)) return app.exit(0);
    dialog.showMessageBoxSync({ type: 'info', title: TITLE, message: cloud.reason(), buttons: ['확인'] });
    if (installed && !handOff) cloud.openCloud(APP_ID);
    app.exit(0);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on('window-all-closed', () => {
    stopRoster();
    app.quit();
  });
}
