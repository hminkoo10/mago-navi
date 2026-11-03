import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { safeNext } from './account-api'
import { Accounts, GONE_USER } from './accounts'
import { createApi } from './handler'
import { Store } from './store'
import { caller, cookieOf, fakeCloud, type FakeCloud, type FakeCloudUser, magoSignIn } from './testing'
import { UserAiKeys } from './user-keys'

// 시험용 계정 (가짜 통합 클라우드에만 있음)
const ACADEMY = { id: 7, name: '마고학원' }
const TEACHER: FakeCloudUser = { id: '11111111-aaaa-4aaa-8aaa-000000000001', username: 'teacher1', name: '김선생', role: 'teacher', academy: ACADEMY }
const DIRECTOR: FakeCloudUser = { id: '11111111-aaaa-4aaa-8aaa-000000000002', username: 'director1', name: '박원장', role: 'director', academy: ACADEMY }
const OTHER: FakeCloudUser = { id: '11111111-aaaa-4aaa-8aaa-000000000003', username: 'teacher2', name: '이선생', role: 'teacher', academy: ACADEMY }
const BOSS: FakeCloudUser = { id: '11111111-aaaa-4aaa-8aaa-000000000009', username: 'operator', name: '최운영', role: 'admin', academy: null }

const clouds: FakeCloud[] = []
afterEach(async () => {
  await Promise.all(clouds.splice(0).map((c) => c.close()))
})

async function setup(extraEnv: Record<string, string> = {}) {
  const cloud = await fakeCloud()
  clouds.push(cloud)
  for (const u of [TEACHER, DIRECTOR, OTHER, BOSS]) cloud.addUser({ ...u })
  const store = new Store(':memory:')
  const env = { ...cloud.env, ...extraEnv }
  const call = caller(createApi({ store }), env)
  /** 통합 클라우드로 로그인 (처음이면 계정이 생김) */
  const join = (who: FakeCloudUser, opts: Parameters<typeof magoSignIn>[3] = {}) => magoSignIn(call, cloud, who.id, opts)
  const me = async (cookie: string) => (await (await call('GET', '/api/auth/me', { cookie })).json()).user
  /** 다음 요청에서 클라우드에 다시 확인하게 (10분이 지난 것처럼) */
  const age = () => store.db.prepare('update sessions set cloud_checked_at = ?').run(new Date(Date.now() - 11 * 60_000).toISOString())
  return { cloud, store, env, call, join, me, age }
}

const tokenRequests = (cloud: FakeCloud) => cloud.requests.filter((r) => r.path === '/api/sso/token')

describe('통합 클라우드 로그인', () => {
  it('시작하면 state를 쿠키에도 두고 클라우드 로그인 화면으로, 돌아오면 코드를 바꿔 로그인하고 Referer 없이 돌려보낸다', async () => {
    const t = await setup()
    const { start, loc, state, back, cookie, code } = await t.join(TEACHER)
    expect(start.status).toBe(302)
    expect(loc).toBe(`${t.cloud.url}/#/sso?app=mago-navi&state=${state}`)
    expect(state).toMatch(/^[\w-]{43}$/)
    expect(start.headers.getSetCookie()[0]).toMatch(/^gwamok_oauth=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/)
    // 서버끼리 코드를 바꾼다 (앱 ID·비밀값·코드)
    expect(tokenRequests(t.cloud).map((r) => r.body)).toEqual([{ appId: 'mago-navi', secret: t.env.MAGO_APP_SECRET, code }])
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/plan')
    expect(back.headers.get('referrer-policy')).toBe('no-referrer')
    expect(cookie).toMatch(/^gwamok_sid=[\w-]{43}$/)
    expect(back.headers.getSetCookie().find((c) => c.startsWith('gwamok_oauth='))).toContain('Max-Age=0')
    expect(await t.me(cookie)).toMatchObject({
      email: 'teacher1',
      name: '김선생',
      role: 'user',
      cloudId: TEACHER.id,
      magoRole: 'teacher',
      academy: ACADEMY,
    })
  })

  it('state가 쿠키와 다르거나 한 번 썼거나 시간이 지났으면 막는다 (클라우드에 묻지도 않는다)', async () => {
    const t = await setup()
    const first = await t.join(TEACHER)
    expect(first.back.headers.get('location')).toBe('/plan')
    // 한 번 쓴 state와 쿠키
    const again = await t.call('GET', `/api/auth/mago/callback?code=${t.cloud.codeFor(TEACHER.id)}&state=${first.state}`, { cookie: first.flow })
    expect(again.headers.get('location')).toBe('/login?error=expired')
    // 쿠키 없이, 다른 로그인의 쿠키로
    const other = await t.call('GET', '/api/auth/mago?next=%2F')
    const otherState = /state=([\w-]+)/.exec(other.headers.get('location') ?? '')?.[1]
    expect((await t.call('GET', `/api/auth/mago/callback?code=${t.cloud.codeFor(TEACHER.id)}&state=${otherState}`)).headers.get('location')).toBe(
      '/login?error=expired',
    )
    expect(
      (await t.call('GET', `/api/auth/mago/callback?code=${t.cloud.codeFor(TEACHER.id)}&state=${otherState}`, { cookie: first.flow })).headers.get('location'),
    ).toBe('/login?error=expired')
    // 10분이 지난 로그인
    const late = await t.call('GET', '/api/auth/mago')
    t.store.db.prepare('update oauth_flows set created_at = ?').run(new Date(Date.now() - 11 * 60_000).toISOString())
    const lateState = /state=([\w-]+)/.exec(late.headers.get('location') ?? '')?.[1]
    const expired = await t.call('GET', `/api/auth/mago/callback?code=${t.cloud.codeFor(TEACHER.id)}&state=${lateState}`, {
      cookie: cookieOf(late, 'gwamok_oauth'),
    })
    expect(expired.headers.get('location')).toBe('/login?error=expired')
    expect(expired.headers.get('referrer-policy')).toBe('no-referrer')
    expect(tokenRequests(t.cloud)).toHaveLength(1)
  })

  it('한 번 쓴 코드는 다시 못 쓴다', async () => {
    const t = await setup()
    const first = await t.join(TEACHER)
    expect(first.cookie).not.toBe('')
    const reuse = await t.join(TEACHER, { code: first.code })
    expect(reuse.back.headers.get('location')).toBe('/login?error=expired')
    expect(reuse.cookie).toBe('')
  })

  it('클라우드 세션 토큰은 암호화해 로그인 세션에 묶는다 (저장소에 원문이 없다)', async () => {
    const t = await setup()
    await t.join(TEACHER)
    const [token] = [...t.cloud.sessions.keys()]
    expect(token).toMatch(/^mgc_/)
    const rows = t.store.db.prepare('select cloud_token from sessions').all() as { cloud_token: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].cloud_token.startsWith('v1:')).toBe(true)
    expect(rows[0].cloud_token).not.toContain(token)
    const dump = JSON.stringify(t.store.db.prepare('select * from sessions').all()) + JSON.stringify(t.store.db.prepare('select * from users').all())
    expect(dump).not.toContain(token)
  })

  it('역할: 운영자는 대표 관리자, 원장·선생님은 일반. 로그인할 때마다 이름·역할·학원을 맞춘다', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    expect(await t.me(boss.cookie)).toMatchObject({ role: 'owner', magoRole: 'admin', academy: null })
    expect((await t.call('GET', '/api/admin/overview', { cookie: boss.cookie })).status).toBe(200)
    const director = await t.join(DIRECTOR)
    expect(await t.me(director.cookie)).toMatchObject({ role: 'user', magoRole: 'director', academy: ACADEMY })
    expect((await t.call('GET', '/api/admin/overview', { cookie: director.cookie })).status).toBe(403)
    // 클라우드에서 이름·역할·학원이 바뀌면 다음 로그인 때 맞춘다
    Object.assign(t.cloud.users.get(DIRECTOR.id)!, { name: '박대표', role: 'admin', academy: { id: 8, name: '새학원' } })
    const again = await t.join(DIRECTOR)
    expect(await t.me(again.cookie)).toMatchObject({ name: '박대표', role: 'owner', academy: { id: 8, name: '새학원' } })
    expect(new Accounts(t.store.db).stats().total).toBe(2)
    // 클라우드 계정 ID는 화면에 cloudId로만, 계정 고유 칸 그대로는 안 보낸다
    expect(JSON.stringify(await t.me(again.cookie))).not.toContain(`mago:${DIRECTOR.id}`)
  })

  it('권한 없는 계정·정지된 계정·앱 비밀값이 틀리면 까닭과 함께 로그인 화면으로', async () => {
    const t = await setup()
    t.cloud.users.get(OTHER.id)!.denied = true
    expect((await t.join(OTHER)).back.headers.get('location')).toBe('/login?error=denied')
    t.cloud.users.get(DIRECTOR.id)!.status = 'suspended'
    expect((await t.join(DIRECTOR)).back.headers.get('location')).toBe('/login?error=disabled')
    const wrong = caller(createApi({ store: new Store(':memory:') }), { ...t.env, MAGO_APP_SECRET: 'mgs_wrong' })
    expect((await magoSignIn(wrong, t.cloud, TEACHER.id)).back.headers.get('location')).toBe('/login?error=unavailable')
    // 이 서버에서 정지한 계정: 받은 클라우드 세션은 바로 끝낸다
    const ok = await t.join(TEACHER)
    const accounts = new Accounts(t.store.db)
    accounts.setDisabled((await t.me(ok.cookie)).id, true)
    expect(await t.me(ok.cookie)).toBeNull()
    const blocked = await t.join(TEACHER)
    expect(blocked.back.headers.get('location')).toBe('/login?error=disabled')
    await expect.poll(() => t.cloud.requests.filter((r) => r.path === '/api/auth/logout').length).toBe(1)
  })

  it('통합 클라우드 설정이 없으면 로그인을 끈다', async () => {
    const t = await setup()
    const off = caller(createApi({ store: new Store(':memory:') }), {})
    expect((await (await off('GET', '/api/health')).json()).login).toBe(false)
    expect((await off('GET', '/api/auth/mago')).headers.get('location')).toBe('/login?error=unavailable')
    expect((await (await t.call('GET', '/api/health')).json())).toMatchObject({ login: true, userKey: true, ai: true })
  })

  it('HTTPS면 쿠키에 __Host-와 Secure를 붙인다', async () => {
    const t = await setup()
    const { start, cookie, back } = await t.join(TEACHER, { secure: true })
    expect(start.headers.getSetCookie()[0]).toMatch(/^__Host-gwamok_oauth=.*Secure$/)
    expect(cookie).toMatch(/^__Host-gwamok_sid=/)
    const set = back.headers.getSetCookie().find((c) => c.startsWith('__Host-gwamok_sid='))!
    expect(set).toContain('Secure')
    expect(set).toContain('Path=/')
  })

  it('10분마다 클라우드에 다시 확인한다: 바뀐 이름·학원은 맞추고, 연결이 안 되면 그대로, 401이면 로그아웃', async () => {
    const t = await setup()
    const { cookie } = await t.join(TEACHER)
    const meCalls = () => t.cloud.requests.filter((r) => r.path === '/api/me').length
    // 10분 안에는 묻지 않는다
    await t.me(cookie)
    expect(meCalls()).toBe(0)
    t.cloud.users.get(TEACHER.id)!.name = '김바뀜'
    t.age()
    expect(await t.me(cookie)).toMatchObject({ name: '김바뀜' })
    expect(meCalls()).toBe(1)
    await t.me(cookie)
    expect(meCalls()).toBe(1)
    // 클라우드에 닿지 못하면 로그인은 그대로
    t.age()
    const down = caller(createApi({ store: t.store }), { ...t.env, MAGO_CLOUD_URL: 'http://127.0.0.1:9' })
    expect((await (await down('GET', '/api/auth/me', { cookie })).json()).user).toMatchObject({ name: '김바뀜' })
    // 클라우드에서 로그아웃(비밀번호 초기화·사용 중지)하면 여기서도 끊긴다
    t.cloud.sessions.clear()
    t.age()
    expect(await t.me(cookie)).toBeNull()
    expect((t.store.db.prepare('select count(*) n from sessions').get() as { n: number }).n).toBe(0)
  })

  it('PC 로그인: x-mago-pc 머리글이 있어야 하고, 그 머리글이 있으면 다른 곳에서 온 요청도 받는다', async () => {
    const t = await setup()
    const pc = (code: string, headers: Record<string, string>) => t.call('POST', '/api/auth/mago/code', { body: { code }, headers })
    expect((await pc(t.cloud.codeFor(TEACHER.id), {})).status).toBe(403)
    expect((await pc(t.cloud.codeFor(TEACHER.id), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await pc(t.cloud.codeFor(TEACHER.id), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    const code = t.cloud.codeFor(TEACHER.id)
    const ok = await pc(code, { 'x-mago-pc': '1', origin: 'null', 'sec-fetch-site': 'cross-site' })
    expect(ok.status).toBe(200)
    expect((await ok.json()).user).toMatchObject({ email: 'teacher1', name: '김선생' })
    const cookie = cookieOf(ok, 'gwamok_sid')
    expect(await t.me(cookie)).toMatchObject({ academy: ACADEMY })
    // 같은 코드는 다시 못 쓴다
    const again = await pc(code, { 'x-mago-pc': '1' })
    expect(again.status).toBe(400)
    expect((await again.json()).error).toContain('시간이 지났어요')
    // CORS 사전 요청에는 답하지 않는다
    expect((await t.call('OPTIONS', '/api/auth/mago/code')).status).toBe(404)
    // 머리글은 PC 로그인에서만 같은 곳 검사를 건너뛴다
    expect((await t.call('POST', '/api/auth/logout', { cookie, body: {}, headers: { 'x-mago-pc': '1', origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('로그아웃하면 클라우드 세션도 끝내고 이 세션도 끊는다', async () => {
    const t = await setup()
    const { cookie } = await t.join(TEACHER)
    const [token] = [...t.cloud.sessions.keys()]
    const out = await t.call('POST', '/api/auth/logout', { cookie, body: {} })
    expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0')
    expect(t.cloud.requests.filter((r) => r.path === '/api/auth/logout').map((r) => r.token)).toEqual([token])
    expect(t.cloud.sessions.size).toBe(0)
    expect(await t.me(cookie)).toBeNull()
  })

  it('예전 Google 계정의 로그인은 서버를 켤 때 끊는다', async () => {
    const t = await setup()
    const { cookie } = await t.join(TEACHER)
    const accounts = new Accounts(t.store.db)
    const old = accounts.create({ sub: '1000000000000000000001', email: 'student@example.com' })
    const oldCookie = `gwamok_sid=${accounts.createSession(old.id).token}`
    const restarted = caller(createApi({ store: t.store }), t.env)
    expect((await (await restarted('GET', '/api/auth/me', { cookie: oldCookie })).json()).user).toBeNull()
    expect((await (await restarted('GET', '/api/auth/me', { cookie })).json()).user).toMatchObject({ email: 'teacher1' })
  })

  it('돌아갈 주소는 이 사이트 안 화면만', async () => {
    expect(safeNext('/plan?step=1')).toBe('/plan?step=1')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/auth/logout', 'plan', '', null]) expect(safeNext(bad)).toBe('/')
    const t = await setup()
    expect((await t.join(TEACHER, { next: '//evil.example/x' })).back.headers.get('location')).toBe('/')
  })

  it('가입을 막아 두면 처음 오는 계정은 못 들어온다 (운영자와 이미 쓴 계정은 된다)', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    await t.join(TEACHER)
    await t.call('POST', '/api/admin/settings', { cookie: boss.cookie, body: { values: { signupOpen: false } } })
    expect((await t.join(DIRECTOR)).back.headers.get('location')).toBe('/login?error=closed')
    expect((await t.join(TEACHER)).back.headers.get('location')).toBe('/plan')
    expect((await (await t.call('GET', '/api/health')).json()).signup).toBe(false)
  })

  it('다른 사이트에서 보낸 요청은 막는다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const body = { data: { prefs: {}, schools: [] } }
    expect((await t.call('POST', '/api/me/data', { cookie, body, headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await t.call('POST', '/api/me/data', { cookie, body, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })

  it('없어진 경로: Google 로그인·가입 동의·탈퇴·이름 바꾸기·관리자 지정', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    for (const [method, path] of [
      ['GET', '/api/auth/google'],
      ['GET', '/api/auth/pending'],
      ['POST', '/api/auth/complete'],
      ['POST', '/api/auth/delete'],
      ['POST', '/api/me/name'],
      ['POST', '/api/admin/users/role'],
    ])
      expect((await t.call(method, path, { cookie, body: method === 'GET' ? undefined : {} })).status, path).toBe(404)
  })

  it('아이디·비밀번호 시절의 계정 표는 옆으로 옮기고 그 세션은 끊는다', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      create table users (id integer primary key, username text not null unique, password text not null, role text not null default 'user',
        disabled integer not null default 0, must_change integer not null default 0, created_at text not null, last_login_at text);
      create table sessions (id text primary key, user_id integer not null, created_at text not null, expires_at text not null, last_seen_at text not null);
      create table user_data (user_id integer primary key, data text not null, updated_at text not null);
      insert into users (username, password, role, created_at) values ('admin', 'scrypt$x', 'admin', '2026-10-01');
      insert into sessions values ('s', 1, '2026-10-01', '2099-01-01', '2026-10-01');
      insert into user_data values (1, '{"prefs":{}}', '2026-10-01');
    `)
    const accounts = new Accounts(db)
    const tables = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['users', 'users_password_legacy', 'user_data', 'user_data_password_legacy']))
    expect((db.prepare('select count(*) n from sessions').get() as { n: number }).n).toBe(0)
    // 새 계정이 1번이 돼도 예전 계정의 설계를 넘겨받지 않는다
    const u = accounts.create({ sub: 'mago:g-1', email: 'new' })
    expect(u.id).toBe(1)
    expect(accounts.getData(u.id)).toBeNull()
    // 다시 열어도 옮기지 않는다
    expect(() => new Accounts(db)).not.toThrow()
  })
})

describe('계정에 설계 저장 (학원 없는 계정)', () => {
  it('로그인해야 쓰고, 저장한 것을 그대로 돌려준다', async () => {
    const t = await setup()
    expect((await t.call('GET', '/api/me/data')).status).toBe(401)
    const { cookie } = await t.join(BOSS)
    expect((await (await t.call('GET', '/api/me/data', { cookie })).json()).saved).toBeNull()
    const data = { prefs: { majors: ['cs'], schoolId: 'x' }, schools: [{ id: 'x', name: '가나고' }] }
    const put = await t.call('POST', '/api/me/data', { cookie, body: { data } })
    expect(put.status).toBe(200)
    const got = await (await t.call('GET', '/api/me/data', { cookie })).json()
    expect(got.saved.data).toEqual({ ...data, plans: [] })
  })

  it('모양이 틀리거나 너무 크면 받지 않는다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: [] } })).status).toBe(400)
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: { prefs: {}, schools: Array(21).fill({}) } } })).status).toBe(400)
    const big = { prefs: {}, schools: [{ notes: ['x'.repeat(500_000)] }] }
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: big } })).status).toBe(413)
  })
})

describe('관리자', () => {
  it('통합 클라우드 운영자는 대표 관리자, 원장·선생님과 비로그인은 관리 API를 못 쓴다', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    expect((await t.call('GET', '/api/admin/overview')).status).toBe(401)
    const teacher = await t.join(TEACHER)
    expect((await t.call('GET', '/api/admin/overview', { cookie: teacher.cookie })).status).toBe(403)
    const ov = await (await t.call('GET', '/api/admin/overview', { cookie: boss.cookie })).json()
    expect(ov.users.total).toBe(2)
    expect(ov.users.admins).toBe(1)
  })

  it('대표 관리자는 사용자를 정지·삭제하고, 대표 관리자·내 계정은 관리 화면에서 못 바꾼다', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    const teacher = await t.join(TEACHER)
    const ids = { boss: (await t.me(boss.cookie)).id, teacher: (await t.me(teacher.cookie)).id }
    expect((await t.call('POST', '/api/admin/users/update', { cookie: boss.cookie, body: { id: ids.boss, disabled: true } })).status).toBe(400)
    expect((await t.call('POST', '/api/admin/users/update', { cookie: boss.cookie, body: { id: ids.teacher, disabled: true } })).status).toBe(200)
    expect(await t.me(teacher.cookie)).toBeNull()
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: boss.cookie, body: { id: ids.teacher } })).status).toBe(200)
    const log = await (await t.call('GET', '/api/admin/log?kind=admin', { cookie: boss.cookie })).json()
    expect(log.entries.map((e: { action: string; who: string }) => `${e.action}:${e.who}`)).toEqual(['user.delete:operator', 'user.disable:operator'])
    const list = await (await t.call('GET', '/api/admin/users?q=teacher', { cookie: boss.cookie })).json()
    expect(list.users).toEqual([])
  })

  it('설정: 틀린 값은 하나도 저장하지 않고, 바꾼 값은 공개 정보에 바로 반영된다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const bad = await t.call('POST', '/api/admin/settings', { cookie, body: { values: { notice: '점검 안내', dailyReadLimit: -5 } } })
    expect(bad.status).toBe(400)
    expect((await (await t.call('GET', '/api/health')).json()).notice).toBe('')
    const ok = await (
      await t.call('POST', '/api/admin/settings', { cookie, body: { values: { notice: '  오늘 밤\n점검해요 ', signupOpen: false, dailyReadLimit: 50 } } })
    ).json()
    expect(ok.changed.sort()).toEqual(['dailyReadLimit', 'notice', 'signupOpen'])
    const health = await (await t.call('GET', '/api/health')).json()
    expect(health.notice).toBe('오늘 밤 점검해요')
    expect(health.signup).toBe(false)
    expect((await t.call('POST', '/api/admin/settings', { cookie, body: { values: { nope: 1 } } })).status).toBe(400)
  })

  it('로그인하지 않으면 자동 읽기를 못 쓴다', async () => {
    const t = await setup({ AI_BASE_URL: 'https://ai.example.com/v1', AI_API_KEY: 'k', AI_MODEL: 'm' })
    const res = await t.call('POST', '/api/curriculum/read', { body: { office: 'J10', code: '7530847', cohort: 2026, url: 'https://x' } })
    expect(res.status).toBe(401)
  })

  it('공유 편제표: 숨기기·확인 표시·고친 판 저장, 신고 처리', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const row = t.store.insert({
      office: 'J10',
      code: '7530847',
      cohort: 2027,
      track: '',
      schoolName: '반송고등학교',
      region: '경기',
      data: { ...BANSONG_2026, id: 'neis-J10-7530847-2027', cohort: 2027 },
      sourceUrl: 'https://example.com/a.pdf',
      pageUrl: 'https://example.com/post',
      sourceTitle: '편제표',
      method: 'school-site',
      model: 'm',
    })
    t.store.report(row.id, '2학년 과목이 틀려요')
    const list = await (await t.call('GET', '/api/admin/curricula?status=reported', { cookie })).json()
    expect(list.items.map((i: { id: number }) => i.id)).toEqual([row.id])

    await t.call('POST', '/api/admin/curricula/update', { cookie, body: { id: row.id, verified: true } })
    expect(t.store.byId(row.id)?.verified).toBe(true)

    const edited = await (
      await t.call('POST', '/api/admin/curricula/edit', { cookie, body: { id: row.id, data: { terms: BANSONG_2026.terms, tracks: [] } } })
    ).json()
    expect(edited.item.method).toBe('manual')
    expect(t.store.byId(row.id)?.hidden).toBe(true)
    // 이제 이 학교 2027은 고친 판을 준다
    expect(t.store.latest('J10', '7530847', 2027)?.id).toBe(edited.item.id)

    const reports = await (await t.call('GET', '/api/admin/reports', { cookie })).json()
    expect(reports.items[0].reason).toBe('2학년 과목이 틀려요')
    await t.call('POST', '/api/admin/reports/update', { cookie, body: { id: reports.items[0].id, resolved: true } })
    expect((await (await t.call('GET', '/api/admin/reports', { cookie })).json()).total).toBe(0)
  })
})

describe('이용 기록 (처음 로그인·로그인·로그아웃)', () => {
  it('처음 로그인·로그인·로그아웃·설계 저장을 남긴다', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    const first = await t.join(TEACHER)
    await t.call('POST', '/api/auth/logout', { cookie: first.cookie, body: {} })
    const again = await t.join(TEACHER)
    const saved = await t.call('POST', '/api/me/data', { cookie: again.cookie, body: { data: { prefs: { majors: ['cs-software'] }, schools: [], plans: [] } } })
    expect(saved.status).toBe(200)
    const userLog = async (q = '') =>
      (await (await t.call('GET', `/api/admin/log?kind=user${q}`, { cookie: boss.cookie })).json()).entries as { who: string; action: string }[]
    expect((await userLog('&q=teacher1')).map((e) => e.action)).toEqual(['plan.save', 'auth.login', 'auth.logout', 'auth.signup'])
    expect((await userLog('&q=operator')).map((e) => e.action)).toEqual(['auth.signup'])
  })

  it('관리자가 지운 계정은 누가 했는지 지운다 (관리자가 지운 사실은 관리자 기록에 남는다)', async () => {
    const t = await setup()
    const boss = await t.join(BOSS)
    const teacher = await t.join(TEACHER)
    const id = (await t.me(teacher.cookie)).id
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: boss.cookie, body: { id } })).status).toBe(200)
    const log = (await (await t.call('GET', '/api/admin/log', { cookie: boss.cookie })).json()).entries as {
      kind: string
      who: string
      action: string
      target: string
    }[]
    expect(log.find((e) => e.kind === 'user' && e.action === 'auth.signup' && e.who === GONE_USER)).toBeTruthy()
    expect(log.find((e) => e.kind === 'admin' && e.action === 'user.delete')?.target).toBe('teacher1')
  })
})

describe('지운 계정과 겹치는 일', () => {
  it('지운 계정의 번호는 다시 쓰지 않고, 주인 없는 설계·키·세션은 지운다', () => {
    const db = new DatabaseSync(':memory:')
    // 예전 표: autoincrement가 없어 가장 큰 번호를 다시 쓰던 표. 3번은 지워졌는데 늦게 들어온 저장이 설계·키를 남겼다
    db.exec(`
      create table users (id integer primary key, google_sub text not null unique, email text not null default '', name text not null default '',
        role text not null default 'user', disabled integer not null default 0, created_at text not null, last_login_at text);
      create table user_data (user_id integer primary key, data text not null, updated_at text not null);
      create table user_ai_keys (user_id integer primary key, key_enc text not null, key_hint text not null, created_at text not null);
      insert into users (id, google_sub, email, created_at) values (1, 'a', 'a@example.com', '2026-10-01'), (2, 'b', 'b@example.com', '2026-10-01');
      insert into user_data values (2, '{"prefs":{}}', '2026-10-01'), (3, '{"prefs":{"secret":1}}', '2026-10-02');
      insert into user_ai_keys values (3, 'enc', 'abcd', '2026-10-02');
    `)
    const accounts = new Accounts(db)
    expect(db.prepare('select user_id from user_data order by user_id').all()).toEqual([{ user_id: 2 }])
    expect(db.prepare('select count(*) n from user_ai_keys').get()).toEqual({ n: 0 })
    expect((db.prepare("select sql from sqlite_master where name = 'users'").get() as { sql: string }).sql).toMatch(/autoincrement/i)
    expect(accounts.byId(2)?.email).toBe('b@example.com')
    accounts.remove(2)
    const next = accounts.create({ sub: 'c', email: 'c@example.com' })
    expect(next.id).toBe(3)
    expect(accounts.getData(next.id)).toBeNull()
    // 다시 열어도 그대로
    expect(new Accounts(db).create({ sub: 'd', email: 'd@example.com' }).id).toBe(4)
  })

  it('지운 계정과 겹쳐 늦게 끝난 저장은 남지 않고, 다음 계정은 아무것도 물려받지 않는다', async () => {
    const t = await setup()
    await t.join(TEACHER)
    const accounts = new Accounts(t.store.db)
    const gone = accounts.bySub(`mago:${TEACHER.id}`)!
    const keys = new UserAiKeys(t.store.db, Buffer.alloc(32, 7))
    keys.save(gone.id, 'AIzaFakeGoodKey-0123456789abcdefghijkl')
    accounts.remove(gone.id)
    expect(keys.count()).toBe(0)
    expect(accounts.putData(gone.id, '{"prefs":{"schoolId":"x"},"schools":[]}')).toBeNull()
    expect(keys.save(gone.id, 'AIzaFakeGoodKey-0123456789abcdefghijkl')).toBeNull()
    accounts.activity(gone, 'design.pin', '설계', '+ 물리학')
    expect(accounts.logs({ q: 'teacher1' }).total).toBe(0)
    const next = await t.join(DIRECTOR)
    const me = await t.me(next.cookie)
    expect(me.id).not.toBe(gone.id)
    expect(me.aiKey).toBeNull()
    expect((await (await t.call('GET', '/api/me/data', { cookie: next.cookie })).json()).saved).toBeNull()
  })

  it('돌아갈 주소의 우회를 풀고 한글은 %로 바꿔, 로그인이 오류 없이 돌아간다', async () => {
    expect(safeNext('/한글')).toBe('/%ED%95%9C%EA%B8%80')
    expect(safeNext('/universities?q=서울')).toBe('/universities?q=%EC%84%9C%EC%9A%B8')
    for (const bad of ['/./api/auth/logout', '/.//evil.example', '/API/x', '/a/../api/x', '/api']) expect(safeNext(bad), bad).toBe('/')
    const t = await setup()
    const { back } = await t.join(TEACHER, { next: '/한글' })
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/%ED%95%9C%EA%B8%80')
  })

  it('쿠키 없는 로그인 요청은 같은 IP의 요청 수를 쓰지 않는다', async () => {
    const t = await setup()
    for (let i = 0; i < 31; i++)
      expect((await t.call('GET', '/api/auth/mago/callback?state=junk-state&code=msc_xxxxxxxx')).headers.get('location')).toBe('/login?error=expired')
    expect((await t.join(TEACHER)).back.headers.get('location')).toBe('/plan')
  })
})

describe('설계 저장이 겹칠 때', () => {
  it('다른 곳에서 먼저 저장했으면 덮어쓰지 않고 지금 계정의 설계를 돌려준다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const save = (data: unknown, base?: unknown) => t.call('POST', '/api/me/data', { cookie, body: base === undefined ? { data } : { data, base } })
    const a = { prefs: { majors: ['cs'] }, schools: [] }
    const first = await save(a, null)
    expect(first.status).toBe(200)
    const v1 = (await first.json()).updatedAt
    // 계정에 없다고 알고 보낸 저장, 예전 판을 바탕으로 한 저장은 막는다
    const stale = await save({ prefs: {}, schools: [] }, null)
    expect(stale.status).toBe(409)
    expect((await stale.json()).saved).toEqual({ data: { ...a, plans: [] }, updatedAt: v1 })
    expect((await save(a, '2020-01-01T00:00:00.000Z')).status).toBe(409)
    // 마지막 판을 바탕으로 하면 저장되고 판이 바뀐다. base를 보내지 않는 예전 화면은 그대로 덮어쓴다
    const second = await save({ prefs: { majors: ['ai'] }, schools: [] }, v1)
    expect(second.status).toBe(200)
    expect((await second.json()).updatedAt > v1).toBe(true)
    expect((await save(a)).status).toBe(200)
    expect((await save(a, 3)).status).toBe(400)
  })

  it('설계의 목록이 터무니없이 길면 받지 않는다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const save = (prefs: unknown) => t.call('POST', '/api/me/data', { cookie, body: { data: { prefs, schools: [] } } })
    expect((await save({ picks: Array(301).fill('korea:x') })).status).toBe(400)
    expect((await save({ majors: 'cs' })).status).toBe(400)
    expect((await save([])).status).toBe(400)
    expect((await save({ picks: Array(300).fill('korea:x') })).status).toBe(200)
  })

  it('한 번에 많이 바꾸면 기록은 몇 줄만 남기고 나머지는 한 줄로 모은다', async () => {
    const t = await setup()
    const { cookie } = await t.join(BOSS)
    const save = (plans: unknown[]) => t.call('POST', '/api/me/data', { cookie, body: { data: { prefs: { majors: ['cs'] }, schools: [], plans } } })
    await save([])
    const accounts = new Accounts(t.store.db)
    const before = accounts.logs({ kind: 'user' }).total
    await save(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `슬롯 ${i}` })))
    const rows = accounts.logs({ kind: 'user' }).entries.slice(0, accounts.logs({ kind: 'user' }).total - before)
    expect(rows.filter((r) => r.action === 'design.slot')).toHaveLength(8)
    expect(rows[0]).toMatchObject({ action: 'plan.save', target: '설계', detail: '한꺼번에 많이 바꿔 자세한 줄은 줄임' })
  })
})
