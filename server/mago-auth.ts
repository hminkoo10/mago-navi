import { publicUser, safeNext } from './account-api'
import { hashOf, type Role, type User } from './accounts'
import { cookieName, json, readCookie, redirect, sessionCookie, shortCookie } from './http'
import { HttpError, RateLimiter, readJson } from './limits'
import type { CloudStudentInfo, StudentAiMode } from './mago-store'
import type { Call, Route, Services } from './services'

export type { AiSource } from './mago-store'

// 마고에듀 통합 클라우드 계정으로 로그인(SSO)하고, 사용자의 클라우드 세션으로 클라우드 API를 부른다.
//   1) GET /api/auth/mago: state를 만들어 쿠키에도 두고 클라우드 로그인 화면(<클라우드>/#/sso?app=&state=)으로 보낸다
//   2) 클라우드가 GET /api/auth/mago/callback?code=&state= 로 돌려보내면 state를 쿠키와 맞춰 보고(한 번만 씀),
//      서버끼리 POST /api/sso/token {appId, secret, code}로 코드를 바꿔 사용자 정보와 이 프로그램 전용 클라우드 세션을 받는다
//   3) 클라우드 세션 토큰은 암호화해서 로그인 세션 행에 묶어 둔다. 학생 명단·학원 AI를 부를 때 쓰고, 10분마다 GET /api/me로 다시 확인한다
//   PC 프로그램(마고 과목내비 PC)은 통합 클라우드가 넘겨준 코드를 POST /api/auth/mago/code로 보낸다.
//
// 운영에서는 nginx 뒤라 TRUST_PROXY=1이 꼭 있어야 한다 (index.ts가 없으면 알림). 없으면 HTTPS인 줄 몰라 쿠키에 __Host-·Secure가 안 붙고,
// mago·magonavi는 같은 사이트(milky.kr)라 SameSite로는 다른 하위 도메인이 심은 쿠키를 막지 못한다. 요청 제한도 모두 같은 IP로 센다.

export type Env = Record<string, string | undefined>

export interface MagoConfig {
  /** 통합 클라우드 주소 (끝 / 없이) */
  url: string
  appId: string
  /** 앱 비밀값 (통합 클라우드 프로그램 관리에서 만듦). 서버끼리 코드를 바꿀 때만 */
  secret: string
}

/** MAGO_CLOUD_URL·MAGO_APP_SECRET이 둘 다 있어야 로그인을 켠다. MAGO_APP_ID는 없으면 mago-navi */
export function magoConfig(env: Env): MagoConfig | null {
  const url = (env.MAGO_CLOUD_URL ?? '').trim().replace(/\/+$/, '')
  const secret = (env.MAGO_APP_SECRET ?? '').trim()
  const appId = (env.MAGO_APP_ID ?? '').trim() || 'mago-navi'
  if (!secret || !/^https?:\/\/[^\s/?#]+$/.test(url) || !/^[\w-]{1,64}$/.test(appId)) return null
  return { url, appId, secret }
}

// ---- 클라우드 API ----

/** 통합 클라우드 역할: admin 운영자, director 원장, teacher 선생님, student 학생 */
export type CloudRole = 'admin' | 'director' | 'teacher' | 'student'

export interface CloudUser {
  /** 통합 클라우드 계정 ID (바뀌지 않음) */
  id: string
  username: string
  name: string
  role: CloudRole
  roleLabel: string
  academy: { id: number; name: string } | null
  student: CloudStudentInfo | null
  aiMode: StudentAiMode
}

/** 클라우드 오류. status 0이면 연결하지 못함. message는 클라우드가 준 한국어 안내 */
export class CloudError extends Error {
  readonly status: number
  readonly code: string
  /** 오류와 함께 온 값 (예: 409 conflict의 지금 학생 정보) */
  readonly extra: Record<string, unknown>

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

const text = (x: unknown, max: number) =>
  typeof x === 'string'
    ? x
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .trim()
        .slice(0, max)
    : ''

/** 클라우드가 준 사용자 정보 검사. 모양이 틀리면 null */
export function cloudUser(raw: unknown, details: Record<string, unknown> = {}): CloudUser | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : ''
  const role = r.role === 'admin' || r.role === 'director' || r.role === 'teacher' || r.role === 'student' ? r.role : null
  if (!id || !role) return null
  const a = r.academy && typeof r.academy === 'object' ? (r.academy as Record<string, unknown>) : null
  const academy = a && typeof a.id === 'number' && Number.isInteger(a.id) && a.id > 0 ? { id: a.id, name: text(a.name, 60) } : null
  const username = text(r.username, 60)
  const rawStudent = r.student ?? details.student
  const st = rawStudent && typeof rawStudent === 'object' ? rawStudent as Record<string, unknown> : null
  const student = role === 'student' && st && typeof st.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(st.id)
    ? { id: st.id, name: text(st.name, 40), teacherUid: typeof st.teacherUid === 'string' && /^[\w-]{1,64}$/.test(st.teacherUid) ? st.teacherUid : null, teacherName: text(st.teacherName, 40) }
    : null
  const aiMode = r.aiMode ?? details.aiMode
  if (role === 'student' && (!academy || !student || (aiMode !== 'academy' && aiMode !== 'teacher'))) return null
  return { id, username, name: text(r.name, 40) || username, role, roleLabel: text(r.roleLabel, 20), academy, student, aiMode: aiMode === 'teacher' ? 'teacher' : 'academy' }
}

/**
 * 클라우드 API 부르기. token이 있으면 Authorization: Bearer로 (키 자리에 담긴 것이라 다른 주소로 옮겨 가지 않게 redirect는 막음).
 * 2xx가 아니면 클라우드의 {error:{code, message}}를 CloudError로
 */
export async function cloudCall(
  cfg: MagoConfig,
  path: string,
  opts: { method?: string; token?: string; body?: unknown; timeoutMs?: number },
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetchImpl(`${cfg.url}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
  } catch {
    throw new CloudError(0, 'offline', '통합 클라우드에 연결하지 못했어요. 잠시 후 다시 해 주세요.')
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const e = data?.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {}
    const { code, message, ...extra } = e
    throw new CloudError(
      res.status,
      typeof code === 'string' && /^[\w.-]{1,40}$/.test(code) ? code : 'error',
      text(message, 300) || '통합 클라우드가 요청을 처리하지 못했어요. 잠시 후 다시 해 주세요.',
      extra,
    )
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CloudError(502, 'bad_response', '통합 클라우드의 응답을 읽지 못했어요.')
  return data
}

/** 클라우드 세션 끝내기. 늦거나 실패해도 그냥 넘어감 (이 서버의 로그아웃을 막지 않게) */
export async function dropCloud(cfg: MagoConfig, token: string, fetchImpl: typeof fetch): Promise<void> {
  await cloudCall(cfg, '/api/auth/logout', { method: 'POST', token, body: {}, timeoutMs: 3_000 }, fetchImpl).catch(() => undefined)
}

/** 서버를 켤 때: 예전 Google 계정은 이제 로그인할 수 없으니 남은 세션을 끊는다 */
export function prepareMago(s: Services, env: Env): void {
  const n = s.mago.revokeLegacy()
  if (n) console.log(`[auth] 통합 클라우드 계정이 아닌 예전 계정의 로그인 ${n}개를 끊었어요.`)
  if (!magoConfig(env)) console.warn('[auth] MAGO_CLOUD_URL·MAGO_APP_SECRET이 없어 로그인을 쓸 수 없어요.')
}

/** 클라우드 역할 → 이 서버 역할: 운영자는 대표 관리자, 원장·선생님은 일반 */
export const roleOf = (role: CloudRole): Role => (role === 'admin' ? 'owner' : 'user')

/** 클라우드 사용자를 이 서버 계정으로 만들거나 맞춘다 (아이디·이름·역할·학원). created: 처음 온 사람 */
export function upsertUser(s: Services, u: CloudUser): { user: User; created: boolean } {
  const { accounts } = s
  const sub = `mago:${u.id}`
  const role = roleOf(u.role)
  let user = accounts.bySub(sub)
  let created = false
  if (!user) {
    try {
      user = accounts.create({ sub, email: u.username }, { role, name: u.name })
      created = true
    } catch (e) {
      // 같은 사람이 동시에 두 번 로그인하면 먼저 만든 계정
      user = accounts.bySub(sub)
      if (!user) throw e
    }
  } else {
    accounts.setEmail(user.id, u.username)
    accounts.setName(user.id, u.name)
    if (user.role !== role) accounts.setRole(user.id, role)
  }
  s.mago.setProfile(user.id, { academyId: u.academy?.id ?? null, academyName: u.academy?.name ?? '', magoRole: u.role, student: u.student, aiMode: u.aiMode })
  return { user: accounts.byId(user.id)!, created }
}

/**
 * 요청의 로그인 사용자. 클라우드 세션이 묶인 세션은 10분마다 GET /api/me로 다시 확인한다:
 * 401(클라우드에서 로그아웃·비밀번호 초기화·사용 중지)이면 이 세션도 끊고, 연결 실패면 세션을 그대로 두고, 아니면 이름·역할·학원을 맞춘다
 */
export async function magoSessionUser(s: Services, token: string, env: Env, fetchImpl: typeof fetch, now = new Date()): Promise<User | null> {
  const user = s.accounts.sessionUser(token, now)
  const cfg = magoConfig(env)
  if (!user || !cfg || !s.mago.due(token, now)) return user
  const id = hashOf(token)
  let job = s.mago.refreshing.get(id)
  if (!job) {
    job = refresh(s, cfg, token, user, fetchImpl, now).finally(() => s.mago.refreshing.delete(id))
    s.mago.refreshing.set(id, job)
  }
  return job
}

async function refresh(s: Services, cfg: MagoConfig, token: string, user: User, fetchImpl: typeof fetch, now: Date): Promise<User | null> {
  const cloud = s.mago.cloudToken(token)
  if (cloud === undefined) return user
  // 서버 비밀값(AI_KEY_SECRET)이 바뀌어 클라우드 세션을 못 풀면 다시 로그인해야 함
  if (cloud === null) {
    s.accounts.revokeSession(token)
    return null
  }
  try {
    const data = await cloudCall(cfg, '/api/me', { token: cloud, timeoutMs: 5_000 }, fetchImpl)
    const me = cloudUser(data.user, data)
    // 다른 사람의 정보나 잘못된 학생 정보가 오면 이 세션을 믿지 않는다
    if (!me || s.mago.profile(user.id)?.cloudId !== me.id) {
      s.accounts.revokeSession(token)
      return null
    }
    upsertUser(s, me)
  } catch (e) {
    if (e instanceof CloudError && (e.status === 401 || (e.status === 403 && e.code === 'account_suspended'))) {
      s.accounts.revokeSession(token)
      return null
    }
    // 연결 실패·클라우드 오류: 세션은 그대로 두고 10분 뒤에 다시 본다
  }
  s.mago.checked(token, now)
  return s.accounts.sessionUser(token, now)
}

/** 이 요청 세션에 묶인 클라우드 세션 토큰. 없거나 못 풀면 세션을 끊고 401 (클라우드를 못 부르면 학생 명단·학원 AI를 쓸 수 없음) */
export function cloudTokenOf(call: Call): string {
  const token = call.token ? call.services.mago.cloudToken(call.token) : undefined
  if (token) return token
  if (call.token) call.services.accounts.revokeSession(call.token)
  throw new HttpError(401, '로그인이 끝났어요. 다시 로그인해 주세요.')
}

/** 클라우드가 401을 주면(클라우드 세션이 끝남) 이 세션도 끊는다 */
export function cloudGone(call: Call, e: unknown): boolean {
  if (!(e instanceof CloudError) || e.status !== 401) return false
  if (call.token) call.services.accounts.revokeSession(call.token)
  return true
}

/** 로그아웃: 묶인 클라우드 세션도 끝낸다 (짧게 기다리고, 실패해도 이 서버 로그아웃은 함) */
export async function cloudLogout(call: Call, fetchImpl: typeof fetch): Promise<void> {
  const cfg = magoConfig(call.ctx.env)
  const token = call.token ? call.services.mago.cloudToken(call.token) : undefined
  if (cfg && token) await dropCloud(cfg, token, fetchImpl)
}

// ---- 로그인 경로 ----

/** 로그인을 마치지 못한 까닭 (로그인 화면의 ?error=) */
type Fail = 'expired' | 'failed' | 'denied' | 'disabled' | 'unavailable' | 'closed' | 'student-web-only'

/** FLOW: 로그인을 시작한 브라우저인지 맞춰 보는 쿠키 (Google 로그인 때와 같은 이름) */
const FLOW_COOKIE = 'gwamok_oauth'
const CODE_RE = /^[\w-]{8,200}$/

/** PC 프로그램 로그인. x-mago-pc: 1 머리글이 있을 때만 다른 곳에서 온 요청도 받는다 (handler.ts sameOrigin) */
export const PC_LOGIN = 'POST /api/auth/mago/code'

/** 클라우드 오류 → 로그인 화면에 보일 까닭 */
function failOf(e: unknown): Fail {
  if (!(e instanceof CloudError)) return 'failed'
  // 한 번 쓴 코드, 60초가 지난 코드
  if (e.code === 'invalid_code') return 'expired'
  // 앱 비밀값이 맞지 않음: 서버 설정 문제
  if (e.code === 'invalid_client') return 'unavailable'
  if (e.code === 'account_suspended') return 'disabled'
  if (e.status === 403) return 'denied'
  return 'failed'
}

export function magoRoutes(deps: { fetch: typeof fetch }): Record<string, Route> {
  const limits = {
    start: new RateLimiter(30, 10 * 60_000),
    callback: new RateLimiter(30, 10 * 60_000),
    code: new RateLimiter(30, 10 * 60_000),
  }

  /** 로그인을 마치거나 못 마치고 보내는 곳. 주소에 코드가 담긴 이 요청이 다음 화면의 Referer로 새지 않게 */
  const away = (location: string, cookies: string[]) => {
    const res = redirect(location, cookies)
    res.headers.set('referrer-policy', 'no-referrer')
    return res
  }

  /** 코드를 클라우드 세션으로 바꾸고 이 서버 세션을 만든다. 이 브라우저의 이전 세션은 끊음 */
  const signIn = async (call: Call, cfg: MagoConfig, code: string): Promise<{ user: User; cookie: string } | Fail> => {
    let token: string
    let cloud: CloudUser | null
    try {
      const data = await cloudCall(cfg, '/api/sso/token', { method: 'POST', body: { appId: cfg.appId, secret: cfg.secret, code }, timeoutMs: 10_000 }, deps.fetch)
      token = typeof data.token === 'string' && /^[\w.~+/=-]{20,400}$/.test(data.token) ? data.token : ''
      cloud = cloudUser(data.user)
      if (token && data.user && typeof data.user === 'object' && (data.user as { role?: unknown }).role === 'student') {
        const me = await cloudCall(cfg, '/api/me', { token, timeoutMs: 5_000 }, deps.fetch)
        cloud = cloudUser(me.user, me)
        if (cloud?.id !== (data.user as { id?: unknown }).id || cloud?.role !== 'student') cloud = null
      }
      if (!token || !cloud) throw new CloudError(502, 'bad_response', '')
    } catch (e) {
      const why = failOf(e)
      if (why === 'failed' || why === 'unavailable')
        console.warn(`[auth] 통합 클라우드 로그인을 마치지 못했어요: ${e instanceof CloudError ? `${e.status} ${e.code}` : 'unknown'}`)
      return why
    }
    const { accounts, settings } = call.services
    if (cloud.role === 'student' && call.url.pathname === '/api/auth/mago/code') {
      void dropCloud(cfg, token, deps.fetch)
      return 'student-web-only'
    }
    const before = accounts.bySub(`mago:${cloud.id}`)
    // 가입을 막아 두면 처음 오는 계정은 받지 않는다 (통합 클라우드 운영자는 예외). 받은 클라우드 세션은 바로 끝냄
    if ((!before && !settings.get().signupOpen && cloud.role !== 'admin') || before?.disabled) {
      void dropCloud(cfg, token, deps.fetch)
      return before?.disabled ? 'disabled' : 'closed'
    }
    const { user, created } = upsertUser(call.services, cloud)
    if (call.token) accounts.revokeSession(call.token)
    const session = accounts.createSession(user.id)
    call.services.mago.attach(session.token, token)
    accounts.activity(user, created ? 'auth.signup' : 'auth.login')
    return { user, cookie: sessionCookie(session.token, !!call.ctx.secure) }
  }

  return {
    /** 로그인 시작: 통합 클라우드 로그인 화면으로 (로그인하고 이 프로그램을 쓸 수 있으면 바로 돌아옴) */
    'GET /api/auth/mago': (call) => {
      const secure = !!call.ctx.secure
      const cfg = magoConfig(call.ctx.env)
      if (!cfg) return redirect('/login?error=unavailable')
      if (!limits.start.take(call.ctx.ip)) return redirect('/login?error=busy')
      const state = call.services.accounts.startFlow({ verifier: '', nonce: '', next: safeNext(call.url.searchParams.get('next')) })
      return redirect(`${cfg.url}/#/sso?app=${encodeURIComponent(cfg.appId)}&state=${state}`, [shortCookie(FLOW_COOKIE, state, secure, 600)])
    },

    /** 통합 클라우드에서 돌아옴: state를 쿠키와 맞춰 보고 코드를 바꿔 로그인 */
    'GET /api/auth/mago/callback': async (call) => {
      const secure = !!call.ctx.secure
      const clearFlow = shortCookie(FLOW_COOKIE, '', secure, 0)
      const fail = (reason: Fail | 'busy') => away(`/login?error=${reason}`, [clearFlow])
      const cfg = magoConfig(call.ctx.env)
      if (!cfg) return fail('unavailable')
      // 이 브라우저에서 시작한 로그인인지 쿠키로 맞춰 봄 (남이 받은 코드로 끌어들이기 방지). state는 한 번만.
      // 요청 수는 쿠키가 맞을 때만 센다 (아무 요청으로 같은 IP의 로그인을 막지 못하게)
      const state = call.url.searchParams.get('state') ?? ''
      if (!state || state !== readCookie(call.req, cookieName(FLOW_COOKIE, secure))) return fail('expired')
      if (!limits.callback.take(call.ctx.ip)) return fail('busy')
      const flow = call.services.accounts.takeFlow(state)
      if (!flow) return fail('expired')
      if (call.url.searchParams.has('error')) return fail('denied')
      const code = call.url.searchParams.get('code') ?? ''
      if (!CODE_RE.test(code)) return fail('failed')
      const done = await signIn(call, cfg, code)
      if (typeof done === 'string') return fail(done)
      return away(flow.next, [clearFlow, done.cookie])
    },

    /**
     * PC 프로그램 로그인: 통합 클라우드가 넘겨준 코드를 바꿔 세션 쿠키를 준다.
     * x-mago-pc: 1 머리글이 꼭 있어야 한다. 다른 사이트의 브라우저는 이 머리글을 붙이려면 CORS 사전 요청을 거쳐야 하는데
     * 이 서버는 CORS에 답하지 않으므로, 다른 사이트에서 남의 코드로 로그인시키지 못한다
     */
    [PC_LOGIN]: async (call) => {
      if (call.req.headers.get('x-mago-pc') !== '1') throw new HttpError(403, '허용되지 않은 요청이에요.')
      const cfg = magoConfig(call.ctx.env)
      if (!cfg) throw new HttpError(503, '지금은 로그인을 쓸 수 없어요.')
      const body = (await readJson(call.req, 1_000)) as { code?: unknown }
      const code = typeof body.code === 'string' ? body.code : ''
      if (!CODE_RE.test(code)) throw new HttpError(400, '로그인 코드가 맞지 않아요.')
      if (!limits.code.take(call.ctx.ip)) throw new HttpError(429, '로그인 요청이 너무 많아요. 잠시 후 다시 해 주세요.')
      const done = await signIn(call, cfg, code)
      if (typeof done === 'string') {
        const [status, message] = PC_FAIL[done]
        throw new HttpError(status, message)
      }
      return json({ user: publicUser(done.user) }, 200, { 'set-cookie': done.cookie })
    },
  }
}

/** PC 로그인 실패: 상태와 안내 */
const PC_FAIL: Record<Fail, [number, string]> = {
  expired: [400, '로그인 코드가 맞지 않거나 시간이 지났어요. 통합 클라우드에서 다시 켜 주세요.'],
  failed: [502, '통합 클라우드 로그인을 마치지 못했어요. 잠시 후 다시 해 주세요.'],
  denied: [403, '이 계정은 마고 과목내비를 쓸 권한이 없어요. 원장님이나 운영자에게 문의해 주세요.'],
  disabled: [403, '이용이 정지된 계정이에요. 원장님이나 운영자에게 문의해 주세요.'],
  unavailable: [503, '지금은 로그인을 쓸 수 없어요.'],
  closed: [403, '지금은 처음 오는 계정을 받지 않아요.'],
  'student-web-only': [403, '학생 계정은 웹에서만 써요. 브라우저에서 마고 과목내비를 열어 주세요.'],
}
