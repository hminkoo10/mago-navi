import { afterEach, describe, expect, it } from 'vitest'
import { Accounts } from './accounts'
import { createApi } from './handler'
import { cloudUser } from './mago-auth'
import { Store } from './store'
import { caller, fakeCloud, type FakeCloud, type FakeCloudUser, magoSignIn } from './testing'

const ACADEMY = { id: 7, name: '마고학원' }
const TEACHER: FakeCloudUser = { id: 'teacher-1', username: 'teacher1', name: '김선생', role: 'teacher', academy: ACADEMY }
const NEXT_TEACHER: FakeCloudUser = { ...TEACHER, id: 'teacher-2', username: 'teacher2', name: '이선생' }
const STUDENT: FakeCloudUser = { id: 'student-user-1', username: 'student1', name: '홍학생', role: 'student', academy: ACADEMY, studentId: 'stu-1000', aiMode: 'academy' }
// 시험용 가짜 키 (실제 키 아님)
const TEACHER_KEY = 'AIzaTeacherKey-0123456789abcdefghijkl'
const NEXT_KEY = 'AIzaNextTeacherKey-0123456789abcdefgh'
const design = (majors: string[]) => ({ prefs: { majors }, schools: [], plans: [] })
const clouds: FakeCloud[] = []
afterEach(async () => { await Promise.all(clouds.splice(0).map((c) => c.close())) })

async function setup(mode: 'academy' | 'teacher' = 'academy') {
  const cloud = await fakeCloud()
  clouds.push(cloud)
  for (const u of [TEACHER, NEXT_TEACHER, { ...STUDENT, aiMode: mode }]) cloud.addUser({ ...u })
  const student = cloud.addStudent({ id: STUDENT.studentId, academyId: 7, name: '홍학생', memo: '선생님 메모', teacher: { id: TEACHER.id, name: TEACHER.name } })
  const other = cloud.addStudent({ academyId: 7, name: '다른학생' })
  const foreign = cloud.addStudent({ academyId: 8, name: '옆학원학생' })
  const outside: { url: string; auth: string }[] = []
  const upstream = { status: 200 }
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith(`${cloud.url}/`)) return fetch(input, init)
    outside.push({ url, auth: new Headers(init?.headers).get('authorization') ?? '' })
    return upstream.status === 200
      ? Response.json({ choices: [{ message: { content: '{"majors":[{"id":"cs-software","why":"게임"}]}' } }] })
      : Response.json({ error: { code: 'API_KEY_INVALID', message: 'invalid key' } }, { status: upstream.status })
  }) as typeof fetch
  const store = new Store(':memory:')
  const env = { ...cloud.env, MAGO_SERVER_AI_FALLBACK: '1', AI_BASE_URL: 'https://server-ai.example.com/v1', AI_API_KEY: 'sk-test-server', AI_MODEL: 'test-model' }
  const call = caller(createApi({ store, fetch: guarded }), env)
  const login = (u: FakeCloudUser) => magoSignIn(call, cloud, u.id)
  const teacher = await login(TEACHER)
  const signed = await login(STUDENT)
  const cookie = signed.cookie
  const token = [...cloud.sessions.entries()].find(([, uid]) => uid === STUDENT.id)![0]
  const accounts = new Accounts(store.db)
  const uid = accounts.bySub(`mago:${STUDENT.id}`)!.id
  const teacherId = accounts.bySub(`mago:${TEACHER.id}`)!.id
  const me = async () => (await (await call('GET', '/api/auth/me', { cookie })).json()).user
  let seq = 0
  const match = () => call('POST', '/api/match', { cookie, body: { text: `게임을 만들고 싶어요 ${++seq}` } })
  const refresh = () => store.db.prepare('update sessions set cloud_checked_at = null where user_id = ?').run(uid)
  const key = (value = TEACHER_KEY, who = teacher.cookie) => call('POST', '/api/me/ai-key', { cookie: who, body: { apiKey: value } })
  return { cloud, store, env, call, login, student, other, foreign, teacher, signed, cookie, token, uid, teacherId, me, match, refresh, key, outside, upstream }
}

describe('학생 로그인과 설계 권한', () => {
  it('학생 역할과 본인 정보를 /api/me에서 받아 저장하고 웹 로그인한다', async () => {
    const t = await setup()
    expect(t.signed.back.status).toBe(302)
    expect(await t.me()).toMatchObject({ role: 'user', magoRole: 'student', aiKey: null, aiMode: 'academy',
      student: { id: t.student.id, name: '홍학생', teacherUid: TEACHER.id, teacherName: '김선생' } })
    expect(t.cloud.requests.filter((r) => r.path === '/api/me' && r.token === t.token)).toHaveLength(1)
    expect(t.store.db.prepare('select mago_role, student_id, teacher_uid, student_ai_mode from users where id = ?').get(t.uid))
      .toEqual({ mago_role: 'student', student_id: t.student.id, teacher_uid: TEACHER.id, student_ai_mode: 'academy' })
    const pc = await t.call('POST', '/api/auth/mago/code', { headers: { 'x-mago-pc': '1' }, body: { code: t.cloud.codeFor(STUDENT.id) } })
    expect(pc.status).toBe(403)
    expect((await pc.json()).error).toContain('웹에서만')
    expect(pc.headers.get('set-cookie')).toBeNull()
  })

  it('학생 sid·학원·AI 설정이 빠지거나 틀리면 학생 계정으로 받지 않는다', () => {
    const user = { ...STUDENT, student: { id: 'stu-1000', name: '홍학생', teacherUid: TEACHER.id } }
    expect(cloudUser(user)?.student?.id).toBe('stu-1000')
    for (const bad of [{ student: null }, { student: { id: '../other' } }, { academy: null }, { aiMode: 'own' }])
      expect(cloudUser({ ...user, ...bad })).toBeNull()
    expect(cloudUser({ ...STUDENT, aiMode: undefined }, { student: user.student, aiMode: 'teacher' })?.aiMode).toBe('teacher')
  })

  it('선생님 명단 캐시가 있어도 학생에게는 본인 한 명만 주고 클라우드 명단은 부르지 않는다', async () => {
    const t = await setup()
    await t.call('GET', '/api/students', { cookie: t.teacher.cookie })
    const before = t.cloud.requests.filter((r) => r.path === '/api/students').length
    const list = await (await t.call('GET', '/api/students', { cookie: t.cookie })).json()
    expect(list.students).toHaveLength(1)
    expect(list.students[0]).toMatchObject({ id: t.student.id, name: '홍학생', memo: '', teacher: { id: TEACHER.id } })
    expect(list.purged).toEqual([])
    expect(t.cloud.requests.filter((r) => r.path === '/api/students')).toHaveLength(before)
    const direct = await fetch(`${t.cloud.url}/api/students`, { headers: { authorization: `Bearer ${t.token}` } })
    expect(direct.status).toBe(403)
    expect((await direct.json()).error.code).toBe('student_forbidden')
  })

  it('본인 설계는 선생님과 함께 읽고 저장하며 충돌 검사를 유지한다. 다른 학생은 403이다', async () => {
    const t = await setup()
    const path = `/api/students/${t.student.id}/data`
    const saved = await t.call('POST', path, { cookie: t.teacher.cookie, body: { data: design(['cs']), base: null } })
    const version = (await saved.json()).updatedAt
    expect((await (await t.call('GET', path, { cookie: t.cookie })).json()).saved).toEqual({ data: design(['cs']), updatedAt: version })
    expect((await t.call('POST', path, { cookie: t.cookie, body: { data: design(['ai']), base: null } })).status).toBe(409)
    expect((await t.call('POST', path, { cookie: t.cookie, body: { data: design(['ai']), base: version } })).status).toBe(200)
    expect((await (await t.call('GET', path, { cookie: t.teacher.cookie })).json()).saved.data).toEqual(design(['ai']))
    for (const sid of [t.other.id, t.foreign.id, 'unknown-student']) {
      expect((await t.call('GET', `/api/students/${sid}/data?sid=${t.student.id}`, { cookie: t.cookie })).status).toBe(403)
      expect((await t.call('POST', `/api/students/${sid}/data`, { cookie: t.cookie, body: { data: design(['cs']) } })).status).toBe(403)
    }
    expect(t.store.db.prepare('select student_id, updated_by from student_data').all()).toEqual([{ student_id: t.student.id, updated_by: t.uid }])
  })

  it('명단·키·AI 선택·관리·개인 설계 API는 직접 불러도 막는다', async () => {
    const t = await setup()
    const paths = [
      ['POST', '/api/students'], ['PATCH', `/api/students/${t.student.id}`], ['DELETE', `/api/students/${t.student.id}`],
      ['POST', `/api/students/${t.student.id}/restore`], ['GET', '/api/academy/members'],
      ['POST', '/api/me/ai'], ['POST', '/api/me/ai-key'], ['POST', '/api/me/ai-key/delete'],
      ['GET', '/api/me/data'], ['POST', '/api/me/data'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/users'],
    ]
    // 예전 로컬 관리자 역할이 남아 있어도 학생 제한이 우선이다
    t.store.db.prepare("update users set role = 'owner' where id = ?").run(t.uid)
    for (const [method, path] of paths)
      expect((await t.call(method, path, { cookie: t.cookie, body: method === 'GET' ? undefined : {} })).status, path).toBe(403)
    expect(t.cloud.requests.filter((r) => r.token === t.token && (r.path.startsWith('/api/students') || r.path === '/api/academy/members'))).toEqual([])
  })

  it('클라우드에서 학생이 삭제되거나 계정이 중지되면 재확인 때 세션을 끊는다', async () => {
    const t = await setup()
    t.student.deletedAt = Date.now()
    t.refresh()
    expect((await t.call('GET', `/api/students/${t.student.id}/data`, { cookie: t.cookie })).status).toBe(401)
    expect(await t.me()).toBeNull()
  })
})

describe('학생 AI', () => {
  it('학원 AI는 학생의 앱 세션으로 중계하고 공급자 설정을 따른다', async () => {
    const t = await setup()
    t.cloud.ai.set(7, { provider: 'openai', model: 'academy-model', direct: false })
    expect((await t.match()).status).toBe(200)
    const requests = t.cloud.requests.filter((r) => r.path.startsWith('/api/ai/relay/'))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ token: t.token, path: '/api/ai/relay/mago-navi/chat/completions', body: { model: 'academy-model' } })
    expect(t.outside).toEqual([])
    expect((await t.me()).ai).toMatchObject({ source: 'academy', ready: true, fallback: false })
  })

  it('학원 AI가 없으면 학생 본인의 예전 키나 서버 AI로 넘어가지 않는다', async () => {
    const t = await setup()
    await t.key()
    t.store.db.prepare('insert into user_ai_keys select ?, key_enc, key_hint, created_at from user_ai_keys where user_id = ?').run(t.uid, t.teacherId)
    t.store.db.prepare("update users set ai_source = 'own' where id = ?").run(t.uid)
    t.outside.length = 0
    const res = await t.match()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('학원에 아직 학원 AI가 없어요. 선생님께 알려 주세요.')
    expect(t.outside).toEqual([])
    expect(await t.me()).toMatchObject({ aiKey: null, ai: { ready: false, fallback: false, source: 'academy' } })
  })

  it('담당 선생님 키를 서버에서 사용하고 키·힌트는 학생 응답에 싣지 않는다', async () => {
    const t = await setup('teacher')
    expect((await t.key()).status).toBe(200)
    t.outside.length = 0
    expect((await t.match()).status).toBe(200)
    expect(t.outside).toHaveLength(1)
    expect(t.outside[0].auth).toBe(`Bearer ${TEACHER_KEY}`)
    const me = await t.me()
    expect(me).toMatchObject({ aiKey: null, ai: { source: 'teacher', ready: true, fallback: false } })
    expect(JSON.stringify(me)).not.toContain(TEACHER_KEY)
    expect(JSON.stringify(me)).not.toContain('hint')
    expect(t.cloud.requests.filter((r) => r.token === t.token && (r.path.startsWith('/api/ai/relay/') || r.path === '/api/academy/ai'))).toEqual([])
    t.upstream.status = 403
    const failed = await t.match()
    expect((await failed.json()).error).toContain('선생님께 알려 주세요')
  })

  it('클라우드 연결 설정이 꺼져도 학생 요청은 서버 AI로 넘어가지 않는다', async () => {
    const t = await setup('teacher')
    Reflect.deleteProperty(t.env, 'MAGO_APP_SECRET')
    const res = await t.match()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('통합 클라우드 연결 설정')
    expect(t.outside).toEqual([])
  })

  it('담당 키가 없거나 담당 계정이 중지되면 안내하고 학원·서버 AI로 넘어가지 않는다', async () => {
    const t = await setup('teacher')
    t.cloud.ai.set(7, { provider: 'gemini', model: '', direct: false })
    const none = await t.match()
    expect(none.status).toBe(503)
    expect((await none.json()).error).toBe('담당 선생님이 AI 키를 등록하지 않았어요')
    expect((await t.me()).ai).toMatchObject({ ready: false, message: '담당 선생님이 AI 키를 등록하지 않았어요' })
    await t.key()
    t.store.db.prepare('update users set disabled = 1 where id = ?').run(t.teacherId)
    t.outside.length = 0
    expect((await t.match()).status).toBe(503)
    expect(t.outside).toEqual([])
  })

  it('담당 변경·AI 모드 변경을 클라우드 재확인으로 반영한다', async () => {
    const t = await setup('teacher')
    await t.key()
    const next = await t.login(NEXT_TEACHER)
    await t.key(NEXT_KEY, next.cookie)
    t.student.teacher = { id: NEXT_TEACHER.id, name: NEXT_TEACHER.name }
    t.refresh()
    t.outside.length = 0
    expect((await t.match()).status).toBe(200)
    expect(t.outside[0].auth).toBe(`Bearer ${NEXT_KEY}`)
    t.cloud.users.get(STUDENT.id)!.aiMode = 'academy'
    t.cloud.ai.set(7, { provider: 'gemini', model: '', direct: false })
    t.refresh()
    t.outside.length = 0
    expect((await t.match()).status).toBe(200)
    expect(t.outside).toEqual([])
    expect((await t.me()).ai.source).toBe('academy')
  })

  it('담당이 없거나 다른 학원의 담당 계정이면 키를 쓰지 않는다', async () => {
    const t = await setup('teacher')
    await t.key()
    t.store.db.prepare('update users set academy_id = 8 where id = ?').run(t.teacherId)
    t.outside.length = 0
    expect((await t.match()).status).toBe(503)
    t.student.teacher = null
    t.refresh()
    expect((await t.match()).status).toBe(503)
    expect(t.outside).toEqual([])
  })

  it('클라우드 중계가 담당 키 모드로 바뀌었다고 알리면 재확인한다', async () => {
    const t = await setup()
    t.cloud.ai.set(7, { provider: 'gemini', model: '', direct: false })
    await t.key()
    expect((await t.match()).status).toBe(200)
    t.cloud.users.get(STUDENT.id)!.aiMode = 'teacher'
    const changed = await t.match()
    expect(changed.status).toBe(409)
    expect((await changed.json()).error).toContain('설정이 바뀌었어요')
    expect((await t.match()).status).toBe(200)
    expect(t.outside.at(-1)?.auth).toBe(`Bearer ${TEACHER_KEY}`)
  })
})
