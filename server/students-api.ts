import type { User } from './accounts'
import { designSaver, type DesignStore } from './account-api'
import { json } from './http'
import { HttpError, LruCache, RateLimiter, readJson } from './limits'
import { CloudError, cloudCall, cloudGone, cloudTokenOf, magoConfig, type MagoConfig } from './mago-auth'
import { type Call, requireUser, type Route } from './services'

// 학원 학생 명단과 학생별 설계.
// - 명단은 통합 클라우드에 있고, 사용자의 클라우드 세션으로 대신 부른다. 상태 코드·안내는 클라우드 것 그대로.
//   GET은 학원마다 30초 기억하고, 고치면 바로 버린다. 명단을 받을 때마다 클라우드에서 완전히 지운 학생의 설계를 지운다.
// - 설계는 이 서버의 student_data에 학생마다 하나. /api/me/data와 같은 검사·크기 한도·판(base)/409 합치기·이용 기록.
//   그 학원 사람 누구나 읽고 고치며, 명단에 없거나 완전히 지운 학생은 404, 지운 학생은 읽기만 (고치면 403).
// 학원에 속하지 않은 계정(예: 학원 없는 통합 클라우드 운영자)은 지금처럼 내 계정에 설계 하나 (/api/me/data).

/** 클라우드가 준 학생 한 명 (화면에는 그대로 보냄) */
type CloudStudent = Record<string, unknown> & { id: string }

interface Roster {
  students: CloudStudent[]
  /** 완전히 지운 학생 ID */
  purged: string[]
  purgeDays: number
  /** 받은 때 */
  at: number
}

/** 이 학원 사람이 클라우드를 부르는 데 필요한 것 */
interface Member {
  user: User
  cfg: MagoConfig
  academyId: number
  token: string
}

const SID_RE = /^[A-Za-z0-9-]{1,64}$/
/** 명단을 고칠 때 클라우드에 넘기는 칸 (나머지는 버림) */
const FIELDS = ['name', 'school', 'grade', 'teacherId', 'memo', 'baseRev']

function member(call: Call): Member {
  const user = requireUser(call)
  const cfg = magoConfig(call.ctx.env)
  const academyId = call.services.mago.profile(user.id)?.academyId ?? null
  if (!cfg || !academyId) throw new HttpError(404, '학원에 속한 계정만 학생 명단을 쓸 수 있어요.')
  return { user, cfg, academyId, token: cloudTokenOf(call) }
}

/** 클라우드 오류를 그대로 전한다 (상태·안내·함께 온 값). 클라우드 세션이 끝났으면 이 세션도 끊고 401 */
function cloudFailed(call: Call, e: unknown): Response {
  if (cloudGone(call, e)) return json({ error: '로그인이 끝났어요. 다시 로그인해 주세요.' }, 401)
  if (!(e instanceof CloudError)) throw e
  const status = e.status >= 400 && e.status < 600 ? e.status : 502
  return json({ ...e.extra, error: e.message, code: e.code }, status)
}

function rosterOf(data: Record<string, unknown>): Roster {
  return {
    students: Array.isArray(data.students)
      ? data.students.filter((s): s is CloudStudent => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string')
      : [],
    purged: Array.isArray(data.purged) ? data.purged.filter((x): x is string => typeof x === 'string') : [],
    purgeDays: typeof data.purgeDays === 'number' ? data.purgeDays : 30,
    at: Date.now(),
  }
}

export function studentRoutes(deps: { fetch: typeof fetch }) {
  const rosters = new LruCache<Roster>(500, 30_000)
  const limits = { write: new RateLimiter(60, 10 * 60_000) }
  const saveDesign = designSaver()

  /** 클라우드 부르기. 운영자 계정은 학원을 골라야 해서 늘 ?academy=를 붙인다 (원장·선생님은 클라우드가 무시함) */
  const ask = (m: Member, method: string, path: string, body?: unknown) =>
    cloudCall(m.cfg, `${path}?academy=${m.academyId}`, { method, token: m.token, body, timeoutMs: 10_000 }, deps.fetch)

  /** 학원 명단 (30초 기억). 받을 때마다 완전히 지운 학생의 설계를 지운다 */
  const roster = async (call: Call, m: Member, fresh = false): Promise<Roster> => {
    const key = String(m.academyId)
    const hit = fresh ? undefined : rosters.get(key)
    if (hit) return hit
    const data = await ask(m, 'GET', '/api/students')
    // 그사이 다른 학원으로 옮긴 계정: 다음 요청에서 클라우드에 다시 확인해 학원을 맞춘다
    if (data.academyId !== undefined && data.academyId !== m.academyId) {
      if (call.token) call.services.mago.checked(call.token, null)
      throw new HttpError(409, '학원 정보가 바뀌었어요. 화면을 새로 고쳐 주세요.')
    }
    const r = rosterOf(data)
    call.services.students.purge(m.academyId, r.purged)
    rosters.set(key, r)
    return r
  }

  /** 설계를 열 학생. 명단에 없으면(방금 추가했을 수 있어) 명단을 한 번 새로 받는다. 없거나 완전히 지웠으면 404 */
  const studentOf = async (call: Call, m: Member, sid: string): Promise<{ name: string; deleted: boolean }> => {
    let r = await roster(call, m)
    let s = r.students.find((x) => x.id === sid)
    if (!s && !r.purged.includes(sid) && Date.now() - r.at > 2_000) {
      r = await roster(call, m, true)
      s = r.students.find((x) => x.id === sid)
    }
    if (!s) throw new HttpError(404, '학생을 찾지 못했어요. 명단에서 완전히 지워졌을 수 있어요.')
    return { name: typeof s.name === 'string' ? s.name.slice(0, 40) : '', deleted: !!s.deletedAt }
  }

  const designsOf = (call: Call, m: Member, sid: string): DesignStore => {
    const { students } = call.services
    return {
      get: () => students.get(m.academyId, sid),
      text: () => students.text(m.academyId, sid),
      version: () => students.version(m.academyId, sid),
      put: (text) => students.put(m.academyId, sid, m.user.id, text),
    }
  }

  /** 명단 고치기: 클라우드에 그대로 보내고, 이 학원 명단 기억은 버린다 */
  const write = async (call: Call, method: string, path: string): Promise<Response> => {
    const m = member(call)
    let body: Record<string, unknown> | undefined
    if (method === 'PATCH' || path === '/api/students') {
      const raw = await readJson(call.req, 4_000)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '보낸 내용이 맞지 않아요.')
      body = Object.fromEntries(FIELDS.filter((k) => k in raw).map((k) => [k, (raw as Record<string, unknown>)[k]]))
    }
    if (!limits.write.take(`u:${m.user.id}`)) throw new HttpError(429, '학생 명단을 너무 자주 고쳤어요. 잠시 후 다시 해 주세요.')
    try {
      return json(await ask(m, method, path, body ?? (method === 'POST' ? {} : undefined)))
    } catch (e) {
      return cloudFailed(call, e)
    } finally {
      rosters.delete(String(m.academyId))
    }
  }

  /** 학생 확인이 클라우드 오류로 막히면 그 오류를 그대로 */
  const withStudent = async (call: Call, sid: string, run: (m: Member, s: { name: string; deleted: boolean }) => Response | Promise<Response>) => {
    const m = member(call)
    let s: { name: string; deleted: boolean }
    try {
      s = await studentOf(call, m, sid)
    } catch (e) {
      if (e instanceof HttpError) throw e
      return cloudFailed(call, e)
    }
    return run(m, s)
  }

  const routes: Record<string, Route> = {
    'GET /api/students': async (call) => {
      const m = member(call)
      try {
        const r = await roster(call, m)
        return json({ students: r.students, purged: r.purged, purgeDays: r.purgeDays })
      } catch (e) {
        if (e instanceof HttpError) throw e
        return cloudFailed(call, e)
      }
    },
    'POST /api/students': (call) => write(call, 'POST', '/api/students'),
    /** 학원 사람 (담당 선생님 고르기) */
    'GET /api/academy/members': async (call) => {
      const m = member(call)
      try {
        return json(await ask(m, 'GET', '/api/academy/members'))
      } catch (e) {
        return cloudFailed(call, e)
      }
    },
  }

  /** 주소에 학생 ID가 든 경로: PATCH·DELETE /api/students/:id, POST /api/students/:id/restore, GET·POST /api/students/:id/data */
  const match = (key: string): Route | null => {
    const m = /^(GET|POST|PATCH|DELETE) \/api\/students\/([^/]+)(\/data|\/restore)?$/.exec(key)
    if (!m || !SID_RE.test(m[2])) return null
    const [, method, sid, tail] = m
    if (tail === '/data' && method === 'GET') return (call) => withStudent(call, sid, (a) => json({ saved: call.services.students.get(a.academyId, sid) }))
    if (tail === '/data' && method === 'POST')
      return (call) =>
        withStudent(call, sid, (a, s) => {
          if (s.deleted) throw new HttpError(403, '지운 학생이라 설계를 고칠 수 없어요. 먼저 학생을 되살려 주세요.')
          return saveDesign(call, a.user, designsOf(call, a, sid), s.name)
        })
    if (tail === '/restore') return method === 'POST' ? (call) => write(call, 'POST', `/api/students/${sid}/restore`) : null
    if (!tail && (method === 'PATCH' || method === 'DELETE')) return (call) => write(call, method, `/api/students/${sid}`)
    return null
  }

  return { routes, match }
}
