import type { School, Term, TermId, Track } from '../data/schema'

// 서버 /api 호출. 서버가 없거나(정적 배포) AI 키가 없으면 AI 기능을 숨기고 키워드 검색만 쓴다.

export class ApiError extends Error {
  readonly status: number
  /** 서버가 오류와 함께 보낸 본문 (예: 409의 계정 설계) */
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** 세션이 끊겼다는 이벤트. /api/auth/ 밖의 401에서 보내고, 화면이 로그인으로 돌린다 */
export const AUTH_LOST = 'gwamok:auth-lost'

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요.')
  }
  // 로그인 필수 서비스라 세션이 끝나면(만료·정지·다른 기기에서 탈퇴) 다시 로그인하게 한다
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_LOST))
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? '요청을 처리하지 못했어요.', data)
  return data
}

export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** 서버가 알려 주는 기능 켜짐 여부와 공지. 관리자 설정에 따라 바뀐다 */
export interface Features {
  /** /api 서버가 있는지 (정적 배포면 false) */
  server: boolean
  ai: boolean
  /** 보낸 내용을 AI 공급자가 제품 개선에 쓰고 사람이 검토할 수 있는지 (Gemini API 무료 등급) */
  aiTraining: boolean
  /** 학교 편제표 자동 읽기 */
  read: boolean
  /** 올린 파일 읽기 */
  import: boolean
  /** 문장으로 분야 찾기 */
  match: boolean
  /** 자동 읽기·파일 읽기·문장으로 찾기에 사용자 각자의 Gemini API 키를 쓰는지 (관리자 설정) */
  userKey: boolean
  /** 통합 클라우드 로그인 가능 여부 (서버에 MAGO_CLOUD_URL·MAGO_APP_SECRET 필요) */
  login: boolean
  signup: boolean
  notice: string
}

export const NO_FEATURES: Features = {
  server: false,
  ai: false,
  aiTraining: false,
  read: false,
  import: false,
  match: false,
  userKey: false,
  login: false,
  signup: false,
  notice: '',
}

/**
 * 서버 기능 확인. 정적 배포(/api/health가 404이거나 index.html이 옴)면 NO_FEATURES.
 * 연결 실패·서버 오류는 ApiError를 던진다 (그때 로그인 없이 열어 주면 안 되므로)
 */
export async function health(): Promise<Features> {
  let res: Response
  try {
    res = await fetch('/api/health')
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요.')
  }
  const json = (res.headers.get('content-type') ?? '').includes('json')
  if (!json && (res.status === 404 || res.ok)) return NO_FEATURES
  const h = (await res.json().catch(() => null)) as Partial<Features> | null
  if (!res.ok || !h || typeof h !== 'object') throw new ApiError(res.status, '서버에 연결하지 못했어요.')
  return {
    server: true,
    ai: !!h.ai,
    aiTraining: !!h.aiTraining,
    read: !!h.read,
    import: !!h.import,
    match: !!h.match,
    userKey: !!h.userKey,
    login: !!h.login,
    signup: h.signup !== false,
    notice: typeof h.notice === 'string' ? h.notice.slice(0, 200) : '',
  }
}

// ---- 계정 ----

/** owner: 대표 관리자 (통합 클라우드 운영자), admin: 관리자, user: 일반 (원장·선생님) */
export type Role = 'user' | 'admin' | 'owner'

/** 내 Gemini API 키 정보. 키 값은 오지 않고 끝 4자리(hint)만 */
export interface AiKeyInfo {
  hint: string
  addedAt: string
  /** 서버가 지금 이 키를 쓸 수 있는지. 서버 비밀값이 바뀌면 다시 등록해야 한다 */
  ok: boolean
}

/** 학원 AI 상태. ready: 부를 수 있음, none: 없음, lan: 학원 안 주소, model: 모델 이름이 없음, no-academy: 학원 사람이 아님, offline: 클라우드 연결 실패 */
export type AcademyAiState = 'ready' | 'none' | 'lan' | 'model' | 'no-academy' | 'offline'

/** 'academy': 학원 AI (기본), 'own': 내 Gemini API 키 */
export type AiSource = 'academy' | 'own'

/** AI 기능에 쓸 AI (통합 클라우드 로그인일 때만) */
export interface AiStatus {
  source: AiSource
  academy: { state: AcademyAiState; provider: string; model: string }
  /** 학원 AI를 못 쓸 때 운영자 서버 AI로 넘어가는지 */
  fallback: boolean
  /** 지금 AI 기능을 쓸 수 있는지 (못 쓰면 키 등록 안내) */
  ready: boolean
}

export interface Me {
  id: number
  /** 통합 클라우드 아이디 */
  email: string
  /** 통합 클라우드에 적힌 이름 */
  name: string
  role: Role
  createdAt: string
  aiKey?: AiKeyInfo | null
  /** 통합 클라우드 계정 ID */
  cloudId?: string
  /** 통합 클라우드 역할 (admin·director·teacher) */
  magoRole?: string
  /** 속한 학원. 없으면 학생 명단 없이 내 계정에 설계 하나 */
  academy?: { id: number; name: string } | null
  ai?: AiStatus | null
}

export const isAdminRole = (role: Role) => role === 'admin' || role === 'owner'

export const ROLE_TEXT: Record<Role, string> = { owner: '대표 관리자', admin: '관리자', user: '일반 계정' }

/** 통합 클라우드 로그인 시작 주소 (페이지 이동). 끝나면 next로 돌아온다 */
export const magoLoginUrl = (next?: string | null) => `/api/auth/mago${next ? `?next=${encodeURIComponent(next)}` : ''}`

export const auth = {
  me: () => call<{ user: Me | null }>('/api/auth/me'),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', postJson({})),
}

/** '학원 AI / 내 키' 고르기 */
export const myAi = {
  set: (source: AiSource) => call<{ ai: AiStatus | null }>('/api/me/ai', postJson({ source })),
}

/** 내 Gemini API 키 등록·삭제. 등록 때 서버가 Google에 짧게 물어 키를 확인한다 */
export const myAiKey = {
  save: (apiKey: string) => call<{ aiKey: AiKeyInfo; note: string }>('/api/me/ai-key', postJson({ apiKey })),
  remove: () => call<{ aiKey: null }>('/api/me/ai-key/delete', postJson({})),
}

/** 계정 설계와 그 판. updatedAt은 저장할 때마다 커진다 */
export interface SavedData {
  data: unknown
  updatedAt: string
}

/** keepalive 요청(페이지를 닫는 중에도 끝까지 보냄)의 본문 상한. 브라우저는 모두 합쳐 64KB까지만 받는다 */
const KEEPALIVE_MAX = 60_000

/** 오래 걸리는 요청은 끊는다 (멈춘 연결이 저장을 계속 붙잡지 않게) */
const timeout = (ms: number) => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined)

/** 설계 하나를 받고 올리는 곳 (내 계정 설계, 학원 학생의 설계) */
export interface DesignApi {
  get: () => Promise<{ saved: SavedData | null }>
  /**
   * base: 이 탭이 마지막으로 받거나 저장한 판 (계정이 비었다고 알면 null). 계정 판과 다르면 서버가 409와 계정 설계를 돌려준다.
   * keepalive: 탭을 닫는 중일 때. 본문이 KEEPALIVE_MAX 이하일 때만 keepalive, 크면 보통 요청
   */
  put: (data: unknown, base: string | null, opts?: { keepalive?: boolean }) => Promise<{ updatedAt: string }>
}

/** path의 설계 (GET으로 받고 POST로 올림) */
export const designApi = (path: string): DesignApi => ({
  get: () => call<{ saved: SavedData | null }>(path, { signal: timeout(20_000) }),
  put: (data, base, opts = {}) => {
    const body = JSON.stringify({ data, base })
    const keepalive = !!opts.keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX
    return call<{ updatedAt: string }>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive,
      signal: timeout(30_000),
    })
  },
})

/** 계정 설계 (고른 학교·분야·대학, 편제표) */
export const myData = designApi('/api/me/data')

export function matchMajors(text: string) {
  return call<{ majors: { id: string; why: string }[] }>('/api/match', postJson({ text }))
}

export interface ImportResult {
  status: 'ready'
  terms: Term[]
  tracks: Track[]
  unknown: string[]
  credits: Record<TermId, number>
  variants: string[]
}

/** 학과·과정별 표가 여러 개라 골라야 할 때 */
export interface ImportChoose {
  status: 'choose'
  variants: string[]
}

export function importCurriculum(input: { text?: string; images?: string[]; cohort: number; track?: string }) {
  return call<ImportResult | ImportChoose>('/api/import', postJson(input))
}

export interface SchoolHit {
  office: string
  code: string
  /** 전형 자격용 고교 유형 (일반고·자율고·특성화고·마이스터고·과학고·외고·국제고·예술고·체육고). 모르면 빈 문자열 */
  schoolType?: string
  name: string
  region: string
  address: string
  homepage: string
  type: string
}

export function searchSchools(q: string) {
  return call<{ schools: SchoolHit[] }>(`/api/schools?q=${encodeURIComponent(q)}`)
}

// ---- 학교 교육과정 자동 불러오기 ----

export interface SharedCurriculum {
  id: number
  school: School
  sourceUrl: string
  pageUrl: string
  sourceTitle: string
  createdAt: string
  /** 관리자가 원문과 맞춰 본 편제표 */
  verified?: boolean
}

export type CurriculumStatus = { status: 'none' } | { status: 'ready'; curriculum: SharedCurriculum; unknown?: string[] }

export interface Candidate {
  url: string
  kind: 'pdf' | 'xlsx' | 'images' | 'table' | 'hwp'
  source: 'homepage' | 'schoolinfo'
  fileName: string
  postTitle: string
  postUrl: string
}

export interface SchoolKey {
  office: string
  code: string
  cohort: number
  /** 학과·계열 (특성화고·특목고) */
  track?: string
}

/** 학교의 학과·과정 (나이스 학급 정보). tracks는 일반고면 빈 목록, general: 일반 학급도 있는지 */
export interface TrackInfo {
  kind: string
  tracks: string[]
  /** 학과마다 그 학년 학급 수 */
  classes: Record<string, number>
  general: boolean
  generalClasses?: number
  source: 'classes' | 'majors' | 'none'
}

export function getTracks(office: string, code: string, cohort: number) {
  const q = new URLSearchParams({ office, code, cohort: String(cohort) })
  return call<TrackInfo>(`/api/school-tracks?${q}`)
}

export function getCurriculum(k: SchoolKey) {
  const q = new URLSearchParams({ office: k.office, code: k.code, cohort: String(k.cohort), track: k.track ?? '' })
  return call<CurriculumStatus>(`/api/curriculum?${q}`)
}

export function discoverCurriculum(k: SchoolKey) {
  return call<{ homepage: string; candidates: Candidate[]; notes: string[] }>('/api/curriculum/discover', postJson(k))
}

/** 표의 학기별 합계와 다르게 읽힌 학기 */
export interface Mismatch {
  term: string
  table: number
  read: number
}

export type ReadOutcome =
  | CurriculumStatus
  | { status: 'partial'; school: School; unknown: string[]; mismatch?: Mismatch[] }
  /** 문서에 학과·과정별 표가 여러 개라 골라야 할 때 */
  | { status: 'choose'; variants: string[]; url: string }

export function readCurriculum(k: SchoolKey & { url: string }, signal?: AbortSignal) {
  return call<ReadOutcome>('/api/curriculum/read', { ...postJson(k), signal })
}

export function reportCurriculum(id: number, reason: string) {
  return call<{ ok: boolean }>('/api/curriculum/report', postJson({ id, reason }))
}

// ---- 대입 자료 소식 ----

export interface DataUpdate {
  id: number
  dataset: string
  key: string
  summary: string
  createdAt: string
}

export function dataUpdates(limit = 30) {
  return call<{ entries: DataUpdate[] }>(`/api/data/updates?limit=${limit}`)
}
