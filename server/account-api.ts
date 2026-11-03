import { MAJOR_BY_ID } from '../src/data/majors'
import type { SavedData, User } from './accounts'
import { designChanges } from './design-log'
import { AiError, chat } from './ai'
import { cleanUserKey, userGeminiConfig } from './user-keys'
import { clearSessionCookie, json } from './http'
import { HttpError, RateLimiter, readJson } from './limits'
import { type Call, requireUser, type Route } from './services'

// 로그인 확인·로그아웃, 내 Gemini 키, 계정에 설계 저장. 로그인(통합 클라우드)은 mago-auth.ts

/** 화면에 보내는 사용자 정보 */
export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })

/** 계정에 저장하는 설계의 크기 상한, 글자 수 (학교 편제표 20개 정도) */
const MAX_DATA = 400_000

/**
 * 로그인 뒤 돌아갈 주소. 이 사이트의 화면 경로만 (다른 사이트·API로 못 보내게).
 * URL로 정리해 '/./api', '/.//x' 같은 우회를 풀고, 한글 등은 %로 바꿔 둔다 (Location 머리글에 그대로 넣으면 오류)
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length > 300 || !/^\/(?!\/)[^\s\\]*$/.test(next)) return '/'
  let u: URL
  try {
    u = new URL(next, 'http://next.invalid')
  } catch {
    return '/'
  }
  const path = `${u.pathname}${u.search}${u.hash}`
  if (u.origin !== 'http://next.invalid' || path.startsWith('//') || /^\/api(\/|$)/i.test(u.pathname) || path.length > 1_000) return '/'
  return path
}

/** 설계 속 목록의 길이 상한. 화면이 만드는 것보다 넉넉하게 (너무 길면 저장할 때마다 견주는 데 오래 걸림) */
const PREF_LISTS: Record<string, number> = { majors: 100, univs: 200, pinned: 500, excluded: 500, picks: 300, unitIds: 5000 }
const prefsFit = (p: Record<string, unknown>) =>
  Object.entries(PREF_LISTS).every(([k, max]) => p[k] === undefined || p[k] === null || (Array.isArray(p[k]) && (p[k] as unknown[]).length <= max))

/** 저장 한 번에 남기는 설계 기록 줄 수, 한 사람이 10분에 남기는 줄 수. 넘으면 한 줄로 모음 */
const LOG_ROWS_PER_SAVE = 8
const LOG_ROWS_PER_10MIN = 60

/** 기록 칸에 넣을 한 줄. 사용자가 보낸 값이라 줄바꿈·제어 문자를 뺌 */
const oneLine = (x: unknown, max: number) =>
  typeof x === 'string'
    ? x
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/**
 * 저장한 설계를 기록 한 줄로. 대상: 지금 고른 학교와 학과, 내용: 분야·대학·꼭 듣기·빼기·슬롯 수.
 * 화면이 보낸 값이라 모양을 믿지 않고, 분야는 아는 id만 이름으로 바꾼다
 */
export function planSummary(d: { prefs: unknown; schools: unknown[]; plans: unknown[] }): { target: string; detail: string } {
  const p = (d.prefs ?? {}) as Record<string, unknown>
  const list = (x: unknown) => (Array.isArray(x) ? x : [])
  const school = d.schools.find((x) => !!x && typeof x === 'object' && (x as { id?: unknown }).id === p.schoolId) as
    { name?: unknown; track?: unknown } | undefined
  const name = oneLine(school?.name, 40)
  const track = oneLine(school?.track, 20)
  const majors = list(p.majors)
    .map((id) => (typeof id === 'string' ? MAJOR_BY_ID.get(id)?.name : undefined))
    .filter((x): x is string => !!x)
  const fields = majors.length > 2 ? `${majors.slice(0, 2).join(', ')} 외 ${majors.length - 2}` : majors.join(', ')
  const parts = [
    `분야 ${fields || '없음'}`,
    `대학 ${list(p.univs).length}곳`,
    `꼭 듣기 ${list(p.pinned).length}`,
    `빼기 ${list(p.excluded).length}`,
    `슬롯 ${Math.max(1, d.plans.length)}개`,
  ]
  return { target: name ? `${name}${track ? ` ${track}` : ''}` : '학교 고르기 전', detail: parts.join(' · ') }
}

/** 설계를 두는 곳: 내 계정(user_data) 또는 학원 학생(student_data, students-api.ts) */
export interface DesignStore {
  get(): SavedData | null
  /** 저장된 설계 원문 */
  text(): string | null
  /** 저장된 설계의 저장 시각(판), 없으면 null */
  version(): string | null
  /** 저장 시각. 그사이 계정이 지워졌으면 저장하지 않고 null */
  put(text: string): string | null
}

/** 내 계정에 저장한 설계 */
export const myDesigns = (call: Call, user: User): DesignStore => {
  const { accounts } = call.services
  return {
    get: () => accounts.getData(user.id),
    text: () => accounts.dataText(user.id),
    version: () => accounts.dataVersion(user.id),
    put: (text) => accounts.putData(user.id, text),
  }
}

/**
 * 설계 저장 (내 계정·학생별 설계가 함께 씀). base: 화면이 마지막으로 받거나 저장한 판의 저장 시각, 저장된 것이 없다고 알면 null.
 * 그사이 다른 탭·기기·사람이 먼저 저장했으면 덮지 않고 409와 지금 설계를 돌려준다 (화면이 합쳐 다시 저장).
 * base를 안 보내는 예전 화면은 그대로 덮어쓴다. label: 이용 기록 대상 앞에 붙이는 이름 (학생 이름)
 */
export function designSaver() {
  const limits = {
    data: new RateLimiter(120, 10 * 60_000),
    designRows: new RateLimiter(LOG_ROWS_PER_10MIN, 10 * 60_000),
  }
  return async (call: Call, user: User, store: DesignStore, label = ''): Promise<Response> => {
    const body = (await readJson(call.req, MAX_DATA + 1_000)) as { data?: unknown; base?: unknown }
    const data = body.data
    const bad = '저장할 내용이 맞지 않아요.'
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, bad)
    const d = data as { prefs?: unknown; schools?: unknown; plans?: unknown }
    if (!d.prefs || typeof d.prefs !== 'object' || Array.isArray(d.prefs) || !Array.isArray(d.schools) || d.schools.length > 20) throw new HttpError(400, bad)
    if (!prefsFit(d.prefs as Record<string, unknown>)) throw new HttpError(400, bad)
    // plans: 설계 슬롯 (화면 MAX_SLOTS와 같게)
    if (d.plans !== undefined && (!Array.isArray(d.plans) || d.plans.length > 10)) throw new HttpError(400, '슬롯은 10개까지 저장할 수 있어요.')
    if (body.base !== undefined && body.base !== null && typeof body.base !== 'string') throw new HttpError(400, bad)
    if (!limits.data.take(`u:${user.id}`)) throw new HttpError(429, '저장 요청이 너무 많아요. 잠시 후 다시 해 주세요.')
    const text = JSON.stringify({ prefs: d.prefs, schools: d.schools, plans: d.plans ?? [] })
    if (text.length > MAX_DATA) throw new HttpError(413, '저장할 내용이 너무 커요. 쓰지 않는 학교를 지워 주세요.')
    const { accounts } = call.services
    if (body.base !== undefined && body.base !== store.version()) return json({ error: '다른 곳에서 먼저 저장했어요.', saved: store.get() }, 409)
    const before = store.text()
    const updatedAt = store.put(text)
    // 저장하는 사이 계정이 지워짐
    if (!updatedAt) throw new HttpError(401, '로그인이 필요해요.')
    const at = (target: string) => (label ? `${label} · ${target}` : target)
    // 사용자 기록: 이전 설계와 견줘 바뀐 것을 한 줄씩 (화면을 열 때 같은 내용을 다시 올린 것은 남기지 않음)
    if (before !== text) {
      const next = { prefs: d.prefs, schools: d.schools, plans: Array.isArray(d.plans) ? d.plans : [] }
      let prev: unknown = null
      try {
        prev = before ? JSON.parse(before) : null
      } catch {
        prev = null
      }
      if (!prev) {
        // 첫 저장: 아무것도 안 고른 빈 설계면 남기지 않음
        const p = (d.prefs ?? {}) as { schoolId?: unknown; majors?: unknown; univs?: unknown }
        const chosen = !!p.schoolId || (Array.isArray(p.majors) && p.majors.length > 0) || (Array.isArray(p.univs) && p.univs.length > 0)
        if (chosen) {
          const { target, detail } = planSummary(next)
          accounts.activity(user, 'plan.save', at(target), `처음 저장 · ${detail}`)
        }
      } else {
        // 한 번에 너무 많이 바뀌거나 아주 자주 바꾸면 나머지는 한 줄로 모음 (기록이 넘치지 않게)
        const changes = designChanges(prev, next)
        for (const [i, c] of changes.entries()) {
          if (i < LOG_ROWS_PER_SAVE && limits.designRows.take(`u:${user.id}`)) {
            accounts.activity(user, c.action, at(c.target), c.detail)
            continue
          }
          accounts.activity(user, 'plan.save', at('설계'), '한꺼번에 많이 바꿔 자세한 줄은 줄임', { mergeMinutes: 60 })
          break
        }
      }
    }
    return json({ updatedAt })
  }
}

export interface AccountDeps {
  fetch: typeof fetch
  /** 로그아웃 전에 (통합 클라우드 세션도 끝냄) */
  logout?: (call: Call) => Promise<void>
  /** 본인 정보에 더할 것 (통합 클라우드 계정·학원, 학원 AI) */
  me?: (call: Call, user: User) => Promise<Record<string, unknown>>
}

export function accountRoutes(deps: AccountDeps): Record<string, Route> {
  const limits = {
    // 등록할 때마다 Google에 실제로 물어 확인하므로 적게
    aiKey: new RateLimiter(10, 3600_000),
  }
  const saveDesign = designSaver()

  /** 본인에게 보내는 정보. 등록한 Gemini 키 여부(끝 4자리) 포함 */
  const meOf = async (call: Call, u: User) => ({ ...publicUser(u), aiKey: call.services.userKeys.info(u.id), ...(await deps.me?.(call, u)) })

  return {
    'GET /api/auth/me': async (call) => json({ user: call.user ? await meOf(call, call.user) : null }),

    'POST /api/auth/logout': async (call) => {
      if (call.user) call.services.accounts.activity(call.user, 'auth.logout')
      if (call.token) {
        await deps.logout?.(call)
        call.services.accounts.revokeSession(call.token)
      }
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(!!call.ctx.secure) })
    },

    /**
     * 내 Gemini API 키 등록: 모양 검사 → 관리자가 정한 모델에 짧은 질문으로 확인 → 암호화해 저장.
     * 무료 한도·혼잡(429·503)으로 확인이 안 되면 맞는 키로 보고 저장하되 그 사실을 알린다
     */
    'POST /api/me/ai-key': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, 2_000)) as { apiKey?: unknown }
      const apiKey = cleanUserKey(body.apiKey)
      if (!apiKey) throw new HttpError(400, 'API 키 모양이 맞지 않아요. Google AI Studio에서 복사한 키를 앞뒤 빈칸 없이 붙여 넣어 주세요.')
      if (!limits.aiKey.take(`u:${user.id}`)) throw new HttpError(429, '키 등록은 한 시간에 10번까지예요. 잠시 후 다시 해 주세요.')
      const { settings, userKeys, accounts } = call.services
      let note = ''
      try {
        await chat(
          userGeminiConfig(apiKey, settings.get().userAiModel),
          { system: '숫자만 답한다.', user: '1+1=?', maxTokens: 64, timeoutMs: 30_000 },
          deps.fetch,
        )
      } catch (e) {
        if (!(e instanceof AiError)) throw e
        const code = Number(/^HTTP (\d{3})/.exec(e.detail)?.[1] ?? 0)
        // 429·503이면 키 자체는 통과한 것
        if (code === 429 || code === 503)
          note = code === 429 ? '키는 맞지만 지금은 사용 한도에 걸려 있어요.' : '키는 맞지만 지금은 Gemini에 요청이 몰려 있어요.'
        else {
          accounts.activity(user, 'ai-key.save', '', `실패: ${e.detail || e.message}`, { mergeMinutes: 10 })
          throw new HttpError(
            400,
            e.detail === 'timeout' || e.detail === 'connection'
              ? 'Google에 연결하지 못해 키를 확인하지 못했어요. 잠시 후 다시 해 주세요.'
              : code === 400 || code === 401 || code === 403
                ? '맞지 않는 키예요. Google AI Studio에서 키를 끝까지 복사했는지, 지우거나 막힌 키는 아닌지 확인해 주세요.'
                : code === 404
                  ? '관리자가 정한 Gemini 모델을 쓸 수 없어 키를 확인하지 못했어요. 관리자에게 알려 주세요.'
                  : '키를 확인하지 못했어요. 잠시 후 다시 해 주세요.',
          )
        }
      }
      const info = userKeys.save(user.id, apiKey)
      if (!info) throw new HttpError(401, '로그인이 필요해요.')
      accounts.activity(user, 'ai-key.save', '', note ? '확인 보류 (한도·혼잡)' : '확인됨')
      return json({ aiKey: info, note })
    },

    'POST /api/me/ai-key/delete': (call) => {
      const user = requireUser(call)
      if (call.services.userKeys.remove(user.id)) call.services.accounts.activity(user, 'ai-key.delete')
      return json({ aiKey: null })
    },

    'GET /api/me/data': (call) => {
      const user = requireUser(call)
      return json({ saved: call.services.accounts.getData(user.id) })
    },

    /** 내 계정에 설계 저장 (학원에 속하지 않은 계정. 학원 사람은 학생별로 students-api.ts) */
    'POST /api/me/data': (call) => {
      const user = requireUser(call)
      return saveDesign(call, user, myDesigns(call, user))
    },
  }
}
