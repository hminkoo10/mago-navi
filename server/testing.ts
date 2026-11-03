// 테스트에서 쓰는 도우미. 앱 코드에서는 쓰지 않는다.
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Accounts, type Role } from './accounts'
import { type ApiOptions, createApi } from './handler'
import type { ApiContext } from './services'
import { Store } from './store'

export type ApiHandler = (req: Request, ctx: ApiContext) => Promise<Response>

/**
 * 통합 클라우드 로그인 없이 계정·세션을 바로 만들어 요청 쿠키(이름=값)를 돌려준다 (인증이 주제가 아닌 테스트용).
 * 클라우드 세션은 묶지 않아 학원 기능은 못 쓴다. 계정 고유 값은 'mago:'로 시작해야 서버를 켤 때 끊기지 않는다
 */
export function sessionFor(store: Store, who: { email: string; role?: Role; sub?: string }): string {
  const accounts = new Accounts(store.db)
  const sub = who.sub ?? `mago:test-${who.email}`
  const user = accounts.bySub(sub) ?? accounts.create({ sub, email: who.email }, { role: who.role ?? 'user' })
  return `gwamok_sid=${accounts.createSession(user.id).token}`
}

/** 로그인한 사람으로 부르는 API: cookie가 없는 요청에 그 사람의 세션 쿠키를 붙인다 (로그인이 주제가 아닌 테스트용) */
export function signedIn(api: ApiHandler, store: Store, who: { email: string; role?: Role } = { email: 'student@example.com' }): ApiHandler {
  const cookie = sessionFor(store, who)
  return (req, ctx) => {
    if (req.headers.has('cookie')) return api(req, ctx)
    const headers = new Headers(req.headers)
    headers.set('cookie', cookie)
    return api(new Request(req, { headers }), ctx)
  }
}

/** 테스트용 API: 저장소가 없으면 메모리 저장소를 만들고, 로그인한 학생으로 부른다 */
export function testApi(options: ApiOptions = {}): ApiHandler {
  const store = options.store ?? new Store(':memory:')
  return signedIn(createApi({ ...options, store }), store)
}

// ---- 가짜 통합 클라우드 ----

/** 가짜 클라우드의 계정 (클라우드 publicUser 모양) */
export interface FakeCloudUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'director' | 'teacher'
  academy: { id: number; name: string } | null
  /** suspended면 코드 바꾸기·세션 모두 401 */
  status?: 'active' | 'suspended'
  /** 이 프로그램을 쓸 권한이 없음 (코드 바꾸기 403) */
  denied?: boolean
}

export interface FakeStudent {
  id: string
  academyId: number
  name: string
  school: string
  grade: string
  teacher: { id: string; name: string } | null
  memo: string
  rev: number
  deletedAt: number | null
}

export interface FakeRequest {
  method: string
  path: string
  query: string
  /** Authorization: Bearer 또는 x-api-key에 담긴 값 */
  token: string
  headers: IncomingMessage['headers']
  body: unknown
}

/** OpenAI 호환 답 */
const completion = (content: string) => ({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })

/** Claude Messages API 스트리밍 답 (SSE) */
function claudeEvents(text: string): string {
  const message = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
}

/**
 * 시험용 통합 클라우드: 127.0.0.1 빈 포트에 진짜 http 서버를 띄운다 (실제 클라우드에는 닿지 않음).
 * 로그인 코드 바꾸기(한 번만)·/api/me·로그아웃·학생 명단·학원 사람·학원 AI·AI 중계를 클라우드 계약대로 흉내 내고 받은 요청을 모두 적어 둔다
 */
export async function fakeCloud() {
  const users = new Map<string, FakeCloudUser>()
  const codes = new Map<string, string>()
  const sessions = new Map<string, string>()
  const students: FakeStudent[] = []
  const purged = new Map<number, string[]>()
  const ai = new Map<number, Record<string, unknown> | null>()
  const requests: FakeRequest[] = []
  /** 중계가 돌려줄 AI 답. error가 있으면 그 상태·본문으로 */
  const relay = { reply: '{"majors":[{"id":"cs-software","why":"게임"}]}', status: 200, error: null as Record<string, unknown> | null }
  const secret = 'mgs_test-app-secret-0123456789'
  let seq = 0

  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const fail = (res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    send(res, status, { error: { code, message, ...extra } })
  const bodyOf = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
  // 학원 ID는 보내지 않는다 (undefined는 JSON에서 빠짐)
  const publicStudent = (s: FakeStudent) => ({ ...s, academyId: undefined, purgeAt: s.deletedAt ? s.deletedAt + 30 * 86400_000 : null })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://cloud.test')
    const raw = await bodyOf(req)
    let body: unknown = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }
    const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? String(req.headers['x-api-key'] ?? '')
    const method = req.method ?? 'GET'
    const path = url.pathname
    requests.push({ method, path, query: url.search, token, headers: req.headers, body })
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const me = () => {
      const u = users.get(sessions.get(token) ?? '')
      return u && u.status !== 'suspended' ? u : null
    }

    if (method === 'POST' && path === '/api/sso/token') {
      if (b.appId !== 'mago-navi' || b.secret !== secret) return fail(res, 401, 'invalid_client', '앱 비밀값이 맞지 않아요.')
      const uid = codes.get(String(b.code))
      codes.delete(String(b.code))
      const u = uid ? users.get(uid) : undefined
      if (!u) return fail(res, 400, 'invalid_code', '로그인 코드가 맞지 않거나 시간이 지났어요. 다시 로그인해 주세요.')
      if (u.status === 'suspended') return fail(res, 401, 'account_suspended', '사용할 수 없는 계정이에요.')
      if (u.denied) return fail(res, 403, 'forbidden', '이 프로그램을 쓸 권한이 없어요.')
      const t = `mgc_${randomBytes(32).toString('base64url')}`
      sessions.set(t, u.id)
      return send(res, 200, { token: t, user: { ...u, roleLabel: u.role, status: 'active' } })
    }
    if (path.startsWith('/api/ai/relay/')) {
      const u = me()
      if (!u) return fail(res, 401, 'session_invalid', '로그인이 끝났어요. 다시 로그인해 주세요.')
      if (!u.academy || !ai.get(u.academy.id)) return fail(res, 404, 'no_academy_ai', '학원 AI 가 아직 없어요.')
      if (relay.error) return send(res, relay.status, relay.error)
      const rest = path.replace(/^\/api\/ai\/relay\/mago-navi\//, '')
      if (rest === 'v1/messages') return b.stream ? send(res, 200, claudeEvents(relay.reply), 'text/event-stream') : send(res, 200, { content: [{ type: 'text', text: relay.reply }] })
      if (rest === 'chat/completions' || rest === 'v1beta/openai/chat/completions') return send(res, 200, completion(relay.reply))
      return fail(res, 403, 'relay_path', '학원 AI 로 할 수 없는 요청이에요.')
    }
    const u = me()
    if (!u) return fail(res, 401, 'session_invalid', '로그인이 끝났어요. 다시 로그인해 주세요.')
    if (method === 'GET' && path === '/api/me') return send(res, 200, { user: { ...u, roleLabel: u.role, status: 'active' } })
    if (method === 'POST' && path === '/api/auth/logout') {
      sessions.delete(token)
      return send(res, 200, { ok: true })
    }
    const aca = u.role === 'admin' ? Number(url.searchParams.get('academy')) || null : (u.academy?.id ?? null)
    if (!aca) return fail(res, 404, 'no_academy', '학원에 속한 계정만 학생 명단을 쓸 수 있어요.')
    if (method === 'GET' && path === '/api/students')
      return send(res, 200, { academyId: aca, purgeDays: 30, students: students.filter((s) => s.academyId === aca).map(publicStudent), purged: purged.get(aca) ?? [] })
    if (method === 'GET' && path === '/api/academy/members')
      return send(res, 200, { academyId: aca, members: [...users.values()].filter((x) => x.academy?.id === aca).map((x) => ({ id: x.id, name: x.name, role: x.role })) })
    if (method === 'GET' && path === '/api/academy/ai') return send(res, 200, { app: 'mago-navi', ai: ai.get(aca) ?? null })
    if (method === 'POST' && path === '/api/students') {
      if (typeof b.name !== 'string' || !b.name.trim()) return fail(res, 400, 'invalid_name', '학생 이름을 입력해 주세요.')
      const teacher = typeof b.teacherId === 'string' ? users.get(b.teacherId) : undefined
      const s: FakeStudent = {
        id: `stu-${String(++seq).padStart(4, '0')}`,
        academyId: aca,
        name: b.name.trim(),
        school: typeof b.school === 'string' ? b.school : '',
        grade: typeof b.grade === 'string' ? b.grade : '',
        teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
        memo: '',
        rev: 1,
        deletedAt: null,
      }
      students.push(s)
      return send(res, 200, { student: publicStudent(s), existed: false })
    }
    const m = /^\/api\/students\/([^/]+)(\/restore)?$/.exec(path)
    const s = m ? students.find((x) => x.id === m[1] && x.academyId === aca) : undefined
    if (m && !s) return fail(res, 404, 'no_student', '학생을 찾을 수 없어요.')
    if (s && method === 'PATCH') {
      if (b.baseRev !== undefined && b.baseRev !== s.rev) return fail(res, 409, 'conflict', '다른 사람이 먼저 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.', { student: publicStudent(s) })
      if (s.deletedAt) return fail(res, 409, 'student_deleted', '지운 학생이에요. 먼저 되살려 주세요.')
      for (const k of ['name', 'school', 'grade', 'memo'] as const) if (typeof b[k] === 'string') s[k] = b[k]
      s.rev++
      return send(res, 200, { student: publicStudent(s) })
    }
    if (s && method === 'DELETE' && !m?.[2]) {
      s.deletedAt ??= Date.now()
      s.rev++
      return send(res, 200, { student: publicStudent(s) })
    }
    if (s && method === 'POST' && m?.[2]) {
      s.deletedAt = null
      s.rev++
      return send(res, 200, { student: publicStudent(s) })
    }
    return fail(res, 404, 'not_found', '찾을 수 없어요.')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url,
    /** 과목내비 서버에 줄 환경 변수 */
    env: { MAGO_CLOUD_URL: url, MAGO_APP_ID: 'mago-navi', MAGO_APP_SECRET: secret, AI_KEY_SECRET: 'test-key-secret-0123456789' } as Record<string, string>,
    users,
    sessions,
    students,
    purged,
    ai,
    requests,
    relay,
    addUser(u: FakeCloudUser) {
      users.set(u.id, u)
      return u
    },
    /** 그 사람이 클라우드에서 로그인해 받은 일회용 코드 */
    codeFor(uid: string) {
      const code = `msc_${randomBytes(24).toString('base64url')}`
      codes.set(code, uid)
      return code
    },
    addStudent(s: Partial<FakeStudent> & { academyId: number; name: string }) {
      const st: FakeStudent = { id: `stu-${String(++seq).padStart(4, '0')}`, school: '', grade: '', teacher: null, memo: '', rev: 1, deletedAt: null, ...s }
      students.push(st)
      return st
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export type FakeCloud = Awaited<ReturnType<typeof fakeCloud>>

/** 과목내비 API를 부르는 도우미: 같은 주소에서 온 요청처럼 (POST에는 origin을 붙임) */
export function caller(api: ApiHandler, env: Record<string, string | undefined>, origin = 'http://app.test') {
  return (
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string; headers?: Record<string, string>; secure?: boolean; ip?: string } = {},
  ) =>
    api(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { origin } : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
      { ip: opts.ip ?? '10.0.0.1', env, secure: opts.secure },
    )
}

/** 응답이 심은 쿠키 하나를 요청 머리글 모양(이름=값)으로 */
export const cookieOf = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${name}=`)) ?? ''

/**
 * 통합 클라우드로 웹 로그인 끝까지: 시작 → (클라우드가 코드를 줌) → 돌아옴.
 * state: 돌아올 때 쓸 state (기본은 시작 때 받은 것), code: 돌아올 때 쓸 코드 (기본은 새로 받은 것)
 */
export async function magoSignIn(
  call: ReturnType<typeof caller>,
  cloud: FakeCloud,
  uid: string,
  opts: { next?: string; secure?: boolean; state?: string; code?: string; flowCookie?: string } = {},
) {
  const start = await call('GET', `/api/auth/mago?next=${encodeURIComponent(opts.next ?? '/plan')}`, { secure: opts.secure })
  const loc = start.headers.get('location') ?? ''
  const state = /[?&]state=([\w-]+)/.exec(loc)?.[1] ?? ''
  const flow = opts.flowCookie ?? cookieOf(start, `${opts.secure ? '__Host-' : ''}gwamok_oauth`)
  const code = opts.code ?? cloud.codeFor(uid)
  const back = await call('GET', `/api/auth/mago/callback?code=${encodeURIComponent(code)}&state=${opts.state ?? state}`, { cookie: flow, secure: opts.secure })
  return { start, loc, state, flow, code, back, cookie: cookieOf(back, `${opts.secure ? '__Host-' : ''}gwamok_sid`) }
}

/** 압축 없이(stored) 담는 최소 zip */
export function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** 칸 배열로 HWPX 본문(section0.xml)을 만든다. 첫 줄 위에 제목 문단을 둔다 */
export function hwpxSection(caption: string, rows: string[][]): string {
  const t = (s: string) => `<hp:p><hp:run><hp:t>${s}</hp:t></hp:run></hp:p>`
  const cells = rows
    .map(
      (row, r) =>
        `<hp:tr>${row
          .map(
            (text, c) => `<hp:tc><hp:subList>${t(text)}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`,
          )
          .join('')}</hp:tr>`,
    )
    .join('')
  return `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${t(caption)}<hp:p><hp:run><hp:tbl rowCnt="${rows.length}" colCnt="${rows[0].length}">${cells}</hp:tbl></hp:run></hp:p></hs:sec>`
}
