import { afterEach, describe, expect, it } from 'vitest'
import { GEMINI_URL } from './ai-providers'
import { Accounts } from './accounts'
import { createApi } from './handler'
import { relayConfig } from './mago-ai'
import { Store } from './store'
import { caller, fakeCloud, type FakeCloud, type FakeCloudUser, magoSignIn } from './testing'

// 시험용 계정 (가짜 통합 클라우드에만 있음)
const MAGO = { id: 7, name: '마고학원' }
const TEACHER: FakeCloudUser = { id: '33333333-cccc-4ccc-8ccc-000000000001', username: 'teacher1', name: '김선생', role: 'teacher', academy: MAGO }
// 테스트용 가짜 키 (실제 키 아님)
const GOOD = 'AIzaFakeGoodKey-0123456789abcdefghijkl'
const SERVER_AI = { AI_BASE_URL: 'https://server-ai.example.com/v1', AI_API_KEY: 'sk-server-secret', AI_MODEL: 'server-model' }

const clouds: FakeCloud[] = []
afterEach(async () => {
  await Promise.all(clouds.splice(0).map((c) => c.close()))
})

async function setup(env: Record<string, string> = {}) {
  const cloud = await fakeCloud()
  clouds.push(cloud)
  cloud.addUser({ ...TEACHER })
  // 가짜 클라우드 밖(Google·서버 AI)으로 가는 요청은 실제로 보내지 않고 적어 두기만 한다
  const outside: { url: string; auth: string }[] = []
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith(`${cloud.url}/`)) return fetch(input, init)
    outside.push({ url, auth: new Headers(init?.headers).get('authorization') ?? '' })
    return Response.json({ choices: [{ message: { content: '{"majors":[{"id":"cs-software","why":"게임"}]}' } }] })
  }) as typeof fetch
  const store = new Store(':memory:')
  const call = caller(createApi({ store, fetch: guarded }), { ...cloud.env, ...env })
  const { cookie } = await magoSignIn(call, cloud, TEACHER.id)
  const token = [...cloud.sessions.keys()].pop()!
  let n = 0
  /** 문장으로 찾기 (같은 문장은 캐시에서 답하므로 매번 다른 문장) */
  const match = () => call('POST', '/api/match', { cookie, body: { text: `게임을 만들고 싶어요 ${++n}` } })
  const relayed = () => cloud.requests.filter((r) => r.path.startsWith('/api/ai/relay/'))
  const asked = (path: string) => cloud.requests.filter((r) => r.path === path)
  const log = () => new Accounts(store.db).logs({ kind: 'user' }).entries.map((e) => `${e.action}:${e.detail}`)
  return { cloud, store, call, cookie, token, match, relayed, asked, outside, log }
}

describe('학원 AI 중계 연결', () => {
  const cfg = { url: 'https://cloud.example.com', appId: 'mago-navi', secret: 'x' }
  it('공급자마다 중계 주소와 키 자리에 클라우드 세션 토큰을 넣는다', () => {
    expect(relayConfig(cfg, { provider: 'gemini', model: '', direct: false }, 'mgc_t', 'gemini-3.6-flash')).toMatchObject({
      kind: 'google',
      name: '학원 AI',
      baseUrl: 'https://cloud.example.com/api/ai/relay/mago-navi/v1beta/openai',
      apiKey: 'mgc_t',
      model: 'gemini-3.6-flash',
    })
    expect(relayConfig(cfg, { provider: 'gemini', model: 'gemini-3.5-pro', direct: false }, 'mgc_t', 'gemini-3.6-flash')?.model).toBe('gemini-3.5-pro')
    expect(relayConfig(cfg, { provider: 'openai', model: 'gpt-5.5-mini', direct: false }, 'mgc_t', 'g')).toMatchObject({
      kind: 'openai',
      baseUrl: 'https://cloud.example.com/api/ai/relay/mago-navi',
      apiKey: 'mgc_t',
      model: 'gpt-5.5-mini',
      maxTokensParam: 'max_tokens',
    })
    expect(relayConfig(cfg, { provider: 'openai', model: '', direct: false }, 'mgc_t', 'g')).toBeNull()
    expect(relayConfig(cfg, { provider: 'anthropic', model: '', direct: false }, 'mgc_t', 'g')).toMatchObject({
      kind: 'anthropic',
      baseUrl: 'https://cloud.example.com/api/ai/relay/mago-navi',
      apiKey: 'mgc_t',
      model: 'claude-sonnet-5-5',
    })
  })
})

describe('학원 AI로 AI 기능 쓰기', () => {
  it('Gemini: 중계의 OpenAI 호환 주소로 클라우드 세션 토큰을 담아 가고, 학원 AI 설정은 60초 기억한다', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'gemini', model: '', direct: false })
    const res = await t.match()
    expect(res.status).toBe(200)
    expect((await res.json()).majors.map((m: { id: string }) => m.id)).toEqual(['cs-software'])
    expect(t.relayed().map((r) => [r.path, r.token, (r.body as { model: string }).model])).toEqual([
      ['/api/ai/relay/mago-navi/v1beta/openai/chat/completions', t.token, 'gemini-3.6-flash'],
    ])
    expect(t.relayed()[0].headers.authorization).toBe(`Bearer ${t.token}`)
    expect(t.asked('/api/academy/ai').map((r) => r.query)).toEqual(['?academy=7'])
    expect((await t.match()).status).toBe(200)
    expect(t.asked('/api/academy/ai')).toHaveLength(1)
    expect(t.relayed()).toHaveLength(2)
    expect(t.outside).toEqual([])
    expect(t.log().filter((e) => e.startsWith('match:')).every((e) => e.endsWith(' · 학원 AI'))).toBe(true)
  })

  it('OpenAI 호환: 중계 주소 그대로 정해 둔 모델로 간다. 모델이 없으면 못 쓴다고 알린다', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'openai', model: 'gpt-5.5-mini', direct: false })
    expect((await t.match()).status).toBe(200)
    const sent = t.relayed()[0]
    expect([sent.path, sent.token]).toEqual(['/api/ai/relay/mago-navi/chat/completions', t.token])
    expect(sent.body).toMatchObject({ model: 'gpt-5.5-mini', max_tokens: 1200 })

    const u = await setup()
    u.cloud.ai.set(MAGO.id, { provider: 'openai', model: '', direct: false })
    const res = await u.match()
    expect(res.status).toBe(428)
    expect((await res.json()).error).toContain('학원 AI에 모델 이름이 없어')
    expect(u.relayed()).toEqual([])
  })

  it('Claude: SDK가 중계의 /v1/messages로 x-api-key에 토큰을 담아 스트리밍으로 부른다 (모델을 비우면 기본 모델)', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'anthropic', model: '', direct: false })
    const res = await t.match()
    expect(res.status).toBe(200)
    expect((await res.json()).majors.map((m: { id: string }) => m.id)).toEqual(['cs-software'])
    const sent = t.relayed()[0]
    expect([sent.path, sent.token, sent.headers['x-api-key']]).toEqual(['/api/ai/relay/mago-navi/v1/messages', t.token, t.token])
    expect(sent.body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true })
  })

  it('학원 AI가 없거나 학원 안 주소면 키 등록 안내(428)를 주고, 내 계정 화면에 까닭을 보인다', async () => {
    const t = await setup()
    const none = await t.match()
    expect(none.status).toBe(428)
    expect((await none.json()).error).toBe(
      '문장으로 찾기는 학원 AI나 내 Gemini API 키로 해요. 학원에 아직 학원 AI가 없어요. 원장님이 통합 클라우드의 학원 AI에서 정하거나, 내 계정에서 내 Gemini API 키를 등록해 주세요.',
    )
    // 없다는 것도 60초 기억하므로 새 사람으로 본다
    const u = await setup()
    u.cloud.ai.set(MAGO.id, { provider: 'gemini', model: '', direct: true })
    const lan = await u.match()
    expect(lan.status).toBe(428)
    expect((await lan.json()).error).toContain('학원 안 주소에 있어 웹에서는 부를 수 없어요')
    expect(u.relayed()).toEqual([])
    const me = (await (await u.call('GET', '/api/auth/me', { cookie: u.cookie })).json()).user
    expect(me).toMatchObject({ cloudId: TEACHER.id, academy: { id: 7, name: '마고학원' } })
    expect(me.ai).toEqual({ source: 'academy', academy: { state: 'lan', provider: 'gemini', model: '' }, fallback: false, ready: false })
  })

  it('학원 AI를 못 쓰면 내 키, 그것도 없으면 MAGO_SERVER_AI_FALLBACK=1일 때만 운영자 서버 AI', async () => {
    const t = await setup(SERVER_AI)
    expect((await t.match()).status).toBe(428)
    expect(t.outside).toEqual([])

    const f = await setup({ ...SERVER_AI, MAGO_SERVER_AI_FALLBACK: '1' })
    expect((await (await f.call('GET', '/api/me/ai', { cookie: f.cookie })).json()).ai).toMatchObject({ fallback: true, ready: true })
    expect((await f.match()).status).toBe(200)
    expect(f.outside).toEqual([{ url: 'https://server-ai.example.com/v1/chat/completions', auth: 'Bearer sk-server-secret' }])

    expect((await t.call('POST', '/api/me/ai-key', { cookie: t.cookie, body: { apiKey: GOOD } })).status).toBe(200)
    expect((await t.match()).status).toBe(200)
    expect(t.outside.at(-1)).toEqual({ url: `${GEMINI_URL}/chat/completions`, auth: `Bearer ${GOOD}` })
    expect(t.log().some((e) => e.startsWith('match:') && e.endsWith(' · 내 키'))).toBe(true)
  })
})

describe("'학원 AI / 내 키' 고르기", () => {
  it('내 키를 고르면 학원 AI가 있어도 내 키만 쓰고, 키가 없으면 428. 고른 것은 기록에 남는다', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'gemini', model: '', direct: false })
    expect((await t.call('POST', '/api/me/ai', { cookie: t.cookie, body: { source: 'gemini' } })).status).toBe(400)
    const own = await t.call('POST', '/api/me/ai', { cookie: t.cookie, body: { source: 'own' } })
    expect((await own.json()).ai).toMatchObject({ source: 'own', academy: { state: 'ready', provider: 'gemini' }, ready: false })
    await t.call('POST', '/api/me/ai', { cookie: t.cookie, body: { source: 'own' } })
    const res = await t.match()
    expect(res.status).toBe(428)
    expect((await res.json()).error).toContain('내 Gemini API 키로 하기로 골라 두었어요')
    await t.call('POST', '/api/me/ai-key', { cookie: t.cookie, body: { apiKey: GOOD } })
    expect((await t.match()).status).toBe(200)
    expect(t.relayed()).toEqual([])
    expect(t.outside.at(-1)?.auth).toBe(`Bearer ${GOOD}`)
    await t.call('POST', '/api/me/ai', { cookie: t.cookie, body: { source: 'academy' } })
    expect((await t.match()).status).toBe(200)
    expect(t.relayed()).toHaveLength(1)
    expect(t.log().filter((e) => e.startsWith('ai-key.source:'))).toEqual(['ai-key.source:학원 AI', 'ai-key.source:내 키'])
  })
})

describe('학원 AI 오류', () => {
  it('클라우드 세션이 끝났으면 401을 주고 여기서도 로그아웃한다', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'gemini', model: '', direct: false })
    expect((await t.match()).status).toBe(200)
    t.cloud.sessions.clear()
    const res = await t.match()
    expect(res.status).toBe(401)
    expect((await (await t.call('GET', '/api/auth/me', { cookie: t.cookie })).json()).user).toBeNull()
  })

  it('Claude 의 키 오류나 종류 없는 401 은 로그아웃하지 않고 학원 AI 키 안내, 클라우드 세션이 끝났으면 Claude 로도 로그아웃', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'anthropic', model: 'claude-x', direct: false })
    for (const error of [{ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { message: '게이트웨이 거절' }]) {
      t.cloud.relay.status = 401
      t.cloud.relay.error = error
      const res = await t.match()
      expect(res.status).toBe(502)
      expect((await res.json()).error).toContain('학원 AI 키로 AI를 부르지 못했어요')
      expect((await (await t.call('GET', '/api/auth/me', { cookie: t.cookie })).json()).user).not.toBeNull()
    }
    t.cloud.relay.error = null
    t.cloud.sessions.clear()
    expect((await t.match()).status).toBe(401)
    expect((await (await t.call('GET', '/api/auth/me', { cookie: t.cookie })).json()).user).toBeNull()
  })

  it('중계가 바쁘면 429, 학원 AI가 없어졌으면 503을 주고 학원 AI 설정을 다시 받는다', async () => {
    const t = await setup()
    t.cloud.ai.set(MAGO.id, { provider: 'openai', model: 'gpt-5.5-mini', direct: false })
    t.cloud.relay.status = 429
    t.cloud.relay.error = { error: { code: 'rate_limited', message: '요청이 너무 많아요.' } }
    const busy = await t.match()
    expect(busy.status).toBe(429)
    expect((await busy.json()).error).toBe('학원 AI 요청이 너무 많아요. 잠시 후 다시 해 주세요.')
    t.cloud.relay.error = null
    t.cloud.ai.delete(MAGO.id)
    const gone = await t.match()
    expect(gone.status).toBe(503)
    expect((await gone.json()).error).toContain('학원 AI가 없어졌어요')
    expect(t.asked('/api/academy/ai')).toHaveLength(1)
    expect((await t.match()).status).toBe(428)
    expect(t.asked('/api/academy/ai')).toHaveLength(2)
  })
})
