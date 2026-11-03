import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Footer, Header, NoticeBar, type Section } from './components/Shell'
import { DeletedStudentBar, StudentGate } from './components/StudentGate'
import { watchAdmissions } from './lib/admissions'
import { ApiError, AUTH_LOST, auth, type DesignApi, health, type Me, NO_FEATURES, type Features } from './lib/api'
import { AppContext, type AppCtx, type ToastAction } from './lib/app'
import { navigate, useLocation } from './lib/router'
import { useAppState } from './lib/store'
import { studentData, type Students, useStudents } from './lib/students'
import { AccountPage } from './pages/AccountPage'
import { AdminPage } from './pages/AdminPage'
import { AdmissionsPage } from './pages/AdmissionsPage'
import { GeminiKeyPage } from './pages/GeminiKeyPage'
import { HelpPage } from './pages/HelpPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlanPage } from './pages/PlanPage'
import { StartPage } from './pages/StartPage'
import { UniversitiesPage } from './pages/UniversitiesPage'
import { UniversityPage } from './pages/UniversityPage'
import { UpdatesPage } from './pages/UpdatesPage'

type Page = 'home' | 'start' | 'plan' | 'admissions' | 'updates' | 'universities' | 'help' | 'geminiKey' | 'login' | 'account' | 'admin' | 'notfound'
type Route = { page: Page } | { page: 'university'; id: string }

const PATHS: Record<string, Page> = {
  '/': 'home',
  '/start': 'start',
  '/plan': 'plan',
  '/admissions': 'admissions',
  '/updates': 'updates',
  '/universities': 'universities',
  '/help': 'help',
  '/help/gemini-key': 'geminiKey',
  '/login': 'login',
  '/account': 'account',
  '/admin': 'admin',
}

function route(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/'
  if (PATHS[p]) return { page: PATHS[p] }
  const m = p.match(/^\/universities\/([a-z0-9-]{2,40})$/)
  if (m) return { page: 'university', id: m[1] }
  return { page: 'notfound' }
}

const TITLE: Record<Route['page'], string> = {
  home: '마고 과목내비 · 대학 권장과목에 맞춘 고교학점제 과목 선택',
  start: '시작하기 · 마고 과목내비',
  plan: '내 과목 설계 · 마고 과목내비',
  admissions: '전형 찾기 · 마고 과목내비',
  updates: '대입 정보 소식 · 마고 과목내비',
  universities: '대학 권장과목 · 마고 과목내비',
  university: '대학 권장과목 · 마고 과목내비',
  help: '도움말 · 마고 과목내비',
  geminiKey: 'Gemini API 키 발급 방법 · 마고 과목내비',
  login: '로그인 · 마고 과목내비',
  account: '내 계정 · 마고 과목내비',
  admin: '관리 · 마고 과목내비',
  notfound: '없는 페이지 · 마고 과목내비',
}

/** 로그인 없이 보는 화면: 첫 화면, 도움말(개인정보 안내), 로그인 */
const OPEN_PAGES = new Set<Route['page']>(['home', 'help', 'geminiKey', 'login', 'notfound'])
/** 서버에 닿지 못해도 보이는 화면. 로그인은 서버가 있어야 해서 뺀다 */
const NO_SERVER_PAGES = new Set<Route['page']>(['home', 'help', 'geminiKey', 'notfound'])
/** 학원 사람은 학생을 골라야 여는 설계 화면 */
const DESIGN_PAGES = new Set<Route['page']>(['start', 'plan', 'admissions'])

const SECTION: Record<Route['page'], Section> = {
  home: 'home',
  start: 'plan',
  plan: 'plan',
  admissions: 'admissions',
  updates: 'admissions',
  universities: 'universities',
  university: 'universities',
  help: 'help',
  geminiKey: 'help',
  login: 'account',
  account: 'account',
  admin: 'admin',
  notfound: 'other',
}

export default function App() {
  const [user, setUser] = useState<Me | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [features, setFeatures] = useState<Features>(NO_FEATURES)
  /** 연결·서버 오류로 서버에 닿지 못함 (정적 배포와 다름). 로그인 없이 열지 않고 다시 시도하게 한다 */
  const [down, setDown] = useState(false)
  const [toast, setToast] = useState<{ text: string; action?: ToastAction } | null>(null)
  const notify = useCallback((text: string, action?: ToastAction) => setToast({ text, action }), [])
  const students = useStudents(user)

  /** 서버 기능과 로그인 확인. 서버에 닿지 못하면 down (정적 배포로 여겨 열어 주지 않는다) */
  const probe = useCallback(
    () =>
      health()
        .then(async (f) => {
          if (f.server) setUser((await auth.me()).user)
          setFeatures(f)
          setAuthReady(true)
        })
        .catch(() => setDown(true)),
    [],
  )
  useEffect(() => {
    void probe()
  }, [probe])
  const retry = useCallback(() => {
    setDown(false)
    void probe()
  }, [probe])
  // 인터넷이 돌아오면 다시 확인한다
  useEffect(() => {
    if (!down) return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [down, retry])

  // 관리자가 대입 자료를 고치면 열려 있는 화면도 새 자료로 바꾼다
  useEffect(() => watchAdmissions(() => notify('대입 정보가 업데이트됐어요.')), [notify])

  const message = toast
  useEffect(() => {
    if (!message) return
    // 되돌리기 같은 버튼이 있으면 누를 틈을 더 준다 (7초, 없으면 2.8초)
    const t = setTimeout(() => setToast(null), message.action ? 7000 : 2800)
    return () => clearTimeout(t)
  }, [message])

  // 과목 서랍 같은 모달 위에도 보이게, 띄울 때마다 popover를 다시 열어 맨 위 층(top layer)으로 올린다
  const toastRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = toastRef.current
    if (!el || typeof el.showPopover !== 'function') return
    try {
      if (el.matches(':popover-open')) el.hidePopover()
      el.showPopover()
    } catch {
      // 팝오버를 못 쓰는 브라우저에서는 그냥 화면 아래에 띄운다
    }
  }, [message])

  // 학원 사람은 학생마다 설계가 따로다. 학생을 바꾸면 화면 상태(store)를 새로 만들어 앞 학생 것이 섞이지 않게 한다.
  // 학생을 고르기 전에는 빈 설계를 보이기만 하고, 지운 학생은 받아 보이기만 한다 (이 기기·계정에 저장하지 않음)
  const sid = students.current?.id ?? null
  const deleted = !!students.current?.deletedAt
  const api = useMemo(() => (!students.active ? undefined : sid ? studentData(sid) : null), [students.active, sid])
  const scope = !students.active ? '' : sid ? `@${sid}` : '@'
  const readOnly = students.active && (!sid || deleted)

  return (
    <>
      <Workspace
        key={`${scope}${readOnly ? ':ro' : ''}`}
        user={user}
        setUser={setUser}
        authReady={authReady}
        features={features}
        down={down}
        retry={retry}
        notify={notify}
        students={students}
        scope={scope}
        api={api}
        readOnly={readOnly}
      />
      <div
        ref={toastRef}
        popover="manual"
        className={`toast${message ? ' is-on' : ''}${message?.action ? ' has-action' : ''}`}
        role="status"
        aria-live="polite"
      >
        {message?.text}
        {message?.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              message.action?.run()
              setToast(null)
            }}
          >
            {message.action.label}
          </button>
        )}
      </div>
    </>
  )
}

interface WorkspaceProps {
  user: Me | null
  setUser: (user: Me | null) => void
  authReady: boolean
  features: Features
  down: boolean
  retry: () => void
  notify: (text: string, action?: ToastAction) => void
  students: Students
  /** 이 기기 저장소 키 끝 (학생별 설계면 '@학생 ID') */
  scope: string
  /** 설계를 받고 올리는 곳 (없으면 내 계정 설계, null이면 학생을 고르기 전) */
  api: DesignApi | null | undefined
  readOnly: boolean
}

/** 화면 상태(store)와 화면. 학생을 바꾸면 App이 새로 만든다 */
function Workspace({ user, setUser, authReady, features, down, retry, notify, students, scope, api, readOnly }: WorkspaceProps) {
  // 공유 링크로 들어오면 설계 화면으로. 공유받은 설계는 로그인하고 계정 설계를 합친 뒤에 연다
  const store = useAppState({
    onShared: () => navigate('/plan', { replace: true }),
    onNotice: notify,
    userId: user?.id ?? null,
    ready: authReady && (!!user || !features.server),
    scope,
    api,
    readOnly,
  })
  const { path, query } = useLocation()
  const r = route(path)

  // 로그인 필수: 서버가 있으면 OPEN_PAGES 밖은 로그인 화면으로 보내고, 로그인하면 돌아온다
  const open = OPEN_PAGES.has(r.page)
  const needLogin = !open && authReady && features.server && !user
  // 학원 사람은 학생을 골라야 설계 화면을 연다
  const needStudent = DESIGN_PAGES.has(r.page) && students.active && !students.current
  const search = query.toString()
  const here = path + (search ? `?${search}` : '')
  useEffect(() => {
    if (needLogin) navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true })
  }, [needLogin, here])
  // 쓰는 중 세션이 끝나면(만료·이용 정지·통합 클라우드에서 로그아웃) 다시 로그인하게 한다.
  // 이 기기 설계도 지운다 (공용 컴퓨터 대비). 못 올린 것은 남겨 같은 계정으로 다시 로그인할 때 올린다
  const { sessionLost } = store
  useEffect(() => {
    if (!user) return
    const lost = () => {
      setUser(null)
      sessionLost()
      notify('로그인이 끝났어요. 다시 로그인해 주세요.')
    }
    window.addEventListener(AUTH_LOST, lost)
    return () => window.removeEventListener(AUTH_LOST, lost)
  }, [user, notify, sessionLost, setUser])

  useEffect(() => {
    document.title = TITLE[r.page]
  }, [r.page])

  const { clearLocal, flushSync } = store

  const signOut = useCallback(async () => {
    // 로그아웃하면 이 기기 설계를 지우므로 못 올린 것을 먼저 올린다
    if (!(await flushSync()) && !confirm('계정에 저장하지 못한 변경이 있어요. 로그아웃하면 이 기기에서 지워져요. 그래도 로그아웃할까요?')) return
    try {
      await auth.logout()
    } catch (e) {
      // 401이면 이미 로그아웃된 것. 서버가 세션을 끝냈는지 모르면 로그아웃했다고 하지 않는다
      if (!(e instanceof ApiError && e.status === 401)) {
        notify('로그아웃하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
        return
      }
    }
    setUser(null)
    clearLocal()
    notify('로그아웃했어요.')
    navigate('/')
  }, [clearLocal, flushSync, notify, setUser])

  const ctx = useMemo<AppCtx>(
    () => ({ store, features, user, authReady, setUser, students, signOut, notify }),
    [store, features, user, authReady, setUser, students, signOut, notify],
  )

  return (
    <AppContext.Provider value={ctx}>
      <a className="skip" href="#main">
        본문으로
      </a>
      <div className="site">
        <NoticeBar />
        <Header section={SECTION[r.page]} />
        <main id="main" className="site-main">
          {down && !NO_SERVER_PAGES.has(r.page) ? (
            <div className="wrap gate" role="alert">
              <h1 className="page-title">서버에 연결하지 못했어요</h1>
              <p className="page-sub">인터넷 연결을 확인하고 다시 시도해 주세요.</p>
              <button type="button" className="btn btn-primary btn-lg" onClick={retry}>
                다시 시도
              </button>
            </div>
          ) : (!open || !NO_SERVER_PAGES.has(r.page)) && (!authReady || (!open && (needLogin || store.holding))) ? (
            // 빈 화면: 로그인 확인 중(로그인 화면도, '서버 기능이 꺼져 있다'고 잘못 보이지 않게),
            // 로그인 화면으로 옮기는 중, 이 기기에서 처음 계정 설계를 받는 중
            <div className="wrap gate" aria-busy="true" />
          ) : needStudent ? (
            <StudentGate />
          ) : (
            <>
              {DESIGN_PAGES.has(r.page) && <DeletedStudentBar />}
              {r.page === 'home' && <HomePage />}
              {r.page === 'start' && <StartPage />}
              {r.page === 'plan' && <PlanPage />}
              {r.page === 'admissions' && <AdmissionsPage />}
              {r.page === 'updates' && <UpdatesPage />}
              {r.page === 'universities' && <UniversitiesPage />}
              {r.page === 'university' && <UniversityPage id={r.id} />}
              {r.page === 'help' && <HelpPage />}
              {r.page === 'geminiKey' && (user?.magoRole === 'student' ? <NotFoundPage /> : <GeminiKeyPage />)}
              {r.page === 'login' && <LoginPage />}
              {r.page === 'account' && <AccountPage />}
              {r.page === 'admin' && (user?.magoRole === 'student' ? <NotFoundPage /> : <AdminPage />)}
              {r.page === 'notfound' && <NotFoundPage />}
            </>
          )}
        </main>
        <Footer />
      </div>
    </AppContext.Provider>
  )
}
