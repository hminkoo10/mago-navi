import { afterEach, describe, expect, it, vi } from 'vitest'
import { Accounts } from './accounts'
import { createApi } from './handler'
import { Store } from './store'
import { caller, fakeCloud, type FakeCloud, type FakeCloudUser, magoSignIn } from './testing'

// 시험용 계정 (가짜 통합 클라우드에만 있음)
const MAGO = { id: 7, name: '마고학원' }
const TEACHER: FakeCloudUser = { id: '22222222-bbbb-4bbb-8bbb-000000000001', username: 'teacher1', name: '김선생', role: 'teacher', academy: MAGO }
const DIRECTOR: FakeCloudUser = { id: '22222222-bbbb-4bbb-8bbb-000000000002', username: 'director1', name: '박원장', role: 'director', academy: MAGO }
const STRANGER: FakeCloudUser = { id: '22222222-bbbb-4bbb-8bbb-000000000003', username: 'other1', name: '남선생', role: 'teacher', academy: { id: 8, name: '옆학원' } }
const BOSS: FakeCloudUser = { id: '22222222-bbbb-4bbb-8bbb-000000000009', username: 'operator', name: '최운영', role: 'admin', academy: null }

const clouds: FakeCloud[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(clouds.splice(0).map((c) => c.close()))
})

async function setup() {
  const cloud = await fakeCloud()
  clouds.push(cloud)
  for (const u of [TEACHER, DIRECTOR, STRANGER, BOSS]) cloud.addUser({ ...u })
  const store = new Store(':memory:')
  const call = caller(createApi({ store }), cloud.env)
  const login = async (who: FakeCloudUser) => {
    const { cookie } = await magoSignIn(call, cloud, who.id)
    const token = [...cloud.sessions.entries()].filter(([, uid]) => uid === who.id).pop()![0]
    return { cookie, token }
  }
  const student = cloud.addStudent({ academyId: MAGO.id, name: '홍길동', school: '마고고', grade: '고1', teacher: { id: TEACHER.id, name: TEACHER.name } })
  const asked = (path: string) => cloud.requests.filter((r) => r.path === path)
  return { cloud, store, call, login, student, asked }
}

const design = (majors: string[]) => ({ prefs: { majors, schoolId: 's1' }, schools: [{ id: 's1', name: '마고고등학교' }], plans: [] })

describe('학생 명단 (통합 클라우드에 대신 부르기)', () => {
  it('사용자의 클라우드 세션으로 부르고, 30초 기억했다가 고치면 바로 다시 받는다', async () => {
    const t = await setup()
    const me = await t.login(TEACHER)
    const list = await t.call('GET', '/api/students', { cookie: me.cookie })
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.students.map((s: { name: string }) => s.name)).toEqual(['홍길동'])
    expect(body).toMatchObject({ purged: [], purgeDays: 30 })
    expect(t.asked('/api/students').map((r) => [r.token, r.query])).toEqual([[me.token, '?academy=7']])
    // 기억한 명단
    await t.call('GET', '/api/students', { cookie: me.cookie })
    expect(t.asked('/api/students')).toHaveLength(1)
    // 추가: 정한 칸만 넘기고, 명단 기억은 버린다
    const added = await t.call('POST', '/api/students', {
      cookie: me.cookie,
      body: { name: '김학생', school: '마고고', grade: '고2', teacherId: TEACHER.id, role: 'admin' },
    })
    expect(added.status).toBe(200)
    const kim = (await added.json()).student
    expect(kim).toMatchObject({ name: '김학생', grade: '고2', teacher: { id: TEACHER.id, name: '김선생' } })
    expect(t.asked('/api/students').at(-1)?.body).toEqual({ name: '김학생', school: '마고고', grade: '고2', teacherId: TEACHER.id })
    const again = await (await t.call('GET', '/api/students', { cookie: me.cookie })).json()
    expect(again.students.map((s: { name: string }) => s.name)).toEqual(['홍길동', '김학생'])
    expect(t.asked('/api/students').filter((r) => r.method === 'GET')).toHaveLength(2)
  })

  it('고치기·지우기·되살리기를 넘기고, 클라우드의 상태와 안내를 그대로 전한다', async () => {
    const t = await setup()
    const me = await t.login(DIRECTOR)
    const sid = t.student.id
    const stale = await t.call('PATCH', `/api/students/${sid}`, { cookie: me.cookie, body: { grade: '고2', baseRev: 99 } })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: '다른 사람이 먼저 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.', code: 'conflict', student: { id: sid, rev: 1 } })
    const ok = await t.call('PATCH', `/api/students/${sid}`, { cookie: me.cookie, body: { grade: '고2', baseRev: 1 } })
    expect((await ok.json()).student).toMatchObject({ grade: '고2', rev: 2 })
    const gone = await t.call('DELETE', `/api/students/${sid}`, { cookie: me.cookie })
    expect((await gone.json()).student.deletedAt).toBeTypeOf('number')
    const back = await t.call('POST', `/api/students/${sid}/restore`, { cookie: me.cookie, body: {} })
    expect((await back.json()).student.deletedAt).toBeNull()
    const noName = await t.call('POST', '/api/students', { cookie: me.cookie, body: { name: ' ' } })
    expect(noName.status).toBe(400)
    expect((await noName.json()).error).toBe('학생 이름을 입력해 주세요.')
    expect((await t.call('PATCH', '/api/students/nope-0000', { cookie: me.cookie, body: {} })).status).toBe(404)
    const members = await (await t.call('GET', '/api/academy/members', { cookie: me.cookie })).json()
    expect(members.members.map((m: { name: string }) => m.name).sort()).toEqual(['김선생', '박원장'])
  })

  it('학원에 속하지 않은 계정은 명단을 못 쓰고, 지금처럼 내 계정에 설계 하나를 둔다', async () => {
    const t = await setup()
    const me = await t.login(BOSS)
    const res = await t.call('GET', '/api/students', { cookie: me.cookie })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('학원에 속한 계정만 학생 명단을 쓸 수 있어요.')
    expect((await t.call('GET', `/api/students/${t.student.id}/data`, { cookie: me.cookie })).status).toBe(404)
    expect((await t.call('POST', '/api/me/data', { cookie: me.cookie, body: { data: design(['cs']), base: null } })).status).toBe(200)
    expect(t.asked('/api/students')).toHaveLength(0)
  })

  it('클라우드 세션이 끝났으면 401을 주고 여기서도 로그아웃한다', async () => {
    const t = await setup()
    const me = await t.login(TEACHER)
    t.cloud.sessions.clear()
    const res = await t.call('GET', '/api/students', { cookie: me.cookie })
    expect(res.status).toBe(401)
    expect((await (await t.call('GET', '/api/auth/me', { cookie: me.cookie })).json()).user).toBeNull()
  })
})

describe('학생별 설계', () => {
  it('같은 학원 사람 누구나 읽고 고치고, 그사이 다른 사람이 저장했으면 409와 지금 설계를 준다', async () => {
    const t = await setup()
    const a = await t.login(TEACHER)
    const b = await t.login(DIRECTOR)
    const path = `/api/students/${t.student.id}/data`
    expect((await (await t.call('GET', path, { cookie: a.cookie })).json()).saved).toBeNull()
    const first = await t.call('POST', path, { cookie: a.cookie, body: { data: design(['cs']), base: null } })
    expect(first.status).toBe(200)
    const v1 = (await first.json()).updatedAt
    // 원장도 같은 설계를 본다
    expect((await (await t.call('GET', path, { cookie: b.cookie })).json()).saved).toEqual({ data: design(['cs']), updatedAt: v1 })
    // 비었다고 알고 보낸 저장은 덮지 않는다
    const stale = await t.call('POST', path, { cookie: b.cookie, body: { data: design(['ai']), base: null } })
    expect(stale.status).toBe(409)
    expect((await stale.json()).saved).toEqual({ data: design(['cs']), updatedAt: v1 })
    const merged = await t.call('POST', path, { cookie: b.cookie, body: { data: design(['cs', 'ai']), base: v1 } })
    expect(merged.status).toBe(200)
    const v2 = (await merged.json()).updatedAt
    expect(v2 > v1).toBe(true)
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: design(['bio']), base: v1 } })).status).toBe(409)
    // 학생마다 따로, 내 계정 설계와도 따로
    expect((await (await t.call('GET', '/api/me/data', { cookie: a.cookie })).json()).saved).toBeNull()
    const row = t.store.db.prepare('select academy_id, student_id, updated_by from student_data').all()
    expect(row).toEqual([{ academy_id: 7, student_id: t.student.id, updated_by: new Accounts(t.store.db).bySub(`mago:${DIRECTOR.id}`)!.id }])
  })

  it('검사·크기 한도는 내 계정 설계와 같고, 이용 기록에는 학생 이름이 붙는다', async () => {
    const t = await setup()
    const a = await t.login(TEACHER)
    const path = `/api/students/${t.student.id}/data`
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: [] } })).status).toBe(400)
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: { prefs: {}, schools: Array(21).fill({}) } } })).status).toBe(400)
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: { prefs: { picks: Array(301).fill('x') }, schools: [] } } })).status).toBe(400)
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: { prefs: {}, schools: [{ notes: ['x'.repeat(500_000)] }] } } })).status).toBe(413)
    expect((await t.call('POST', path, { cookie: a.cookie, body: { data: design(['cs-software']), base: 3 } })).status).toBe(400)
    await t.call('POST', path, { cookie: a.cookie, body: { data: design(['cs-software']), base: null } })
    const log = new Accounts(t.store.db).logs({ kind: 'user', actions: ['plan.save'] }).entries
    expect(log[0]).toMatchObject({ who: 'teacher1', target: '홍길동 · 마고고등학교' })
    expect(log[0].detail).toContain('처음 저장')
  })

  it('다른 학원 학생·명단에 없는 학생은 404, 지운 학생은 읽기만, 완전히 지운 학생의 설계는 명단을 받을 때 지운다', async () => {
    const t = await setup()
    const a = await t.login(TEACHER)
    const other = await t.login(STRANGER)
    const path = `/api/students/${t.student.id}/data`
    await t.call('POST', path, { cookie: a.cookie, body: { data: design(['cs']), base: null } })
    // 옆 학원 사람: 그 학원 명단에 없는 학생
    expect((await t.call('GET', path, { cookie: other.cookie })).status).toBe(404)
    expect((await t.call('POST', path, { cookie: other.cookie, body: { data: design(['ai']) } })).status).toBe(404)
    expect((await t.call('GET', '/api/students/stu-9999/data', { cookie: a.cookie })).status).toBe(404)
    // 지운 학생: 읽을 수는 있고 고치면 403
    expect((await t.call('DELETE', `/api/students/${t.student.id}`, { cookie: a.cookie })).status).toBe(200)
    expect((await (await t.call('GET', path, { cookie: a.cookie })).json()).saved.data).toEqual(design(['cs']))
    const locked = await t.call('POST', path, { cookie: a.cookie, body: { data: design(['ai']) } })
    expect(locked.status).toBe(403)
    expect((await locked.json()).error).toContain('되살려')
    // 30일이 지나 완전히 지움: 다음에 명단을 받을 때 설계도 지운다
    t.cloud.students.splice(0)
    t.cloud.purged.set(MAGO.id, [t.student.id])
    await t.call('POST', '/api/students', { cookie: a.cookie, body: { name: '새학생' } })
    const list = await (await t.call('GET', '/api/students', { cookie: a.cookie })).json()
    expect(list.purged).toEqual([t.student.id])
    expect(t.store.db.prepare('select count(*) n from student_data').get()).toEqual({ n: 0 })
    expect((await t.call('GET', path, { cookie: a.cookie })).status).toBe(404)
  })

  it('기억한 명단에 없는 학생(다른 곳에서 방금 추가)은 명단을 다시 받아 찾는다', async () => {
    const t = await setup()
    const a = await t.login(TEACHER)
    await t.call('GET', '/api/students', { cookie: a.cookie })
    const fresh = t.cloud.addStudent({ academyId: MAGO.id, name: '방금학생' })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 5_000)
    const res = await t.call('GET', `/api/students/${fresh.id}/data`, { cookie: a.cookie })
    expect(res.status).toBe(200)
    expect(t.asked('/api/students')).toHaveLength(2)
  })
})
