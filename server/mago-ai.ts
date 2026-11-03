import { type AiConfig, AiError } from './ai-types'
import { json } from './http'
import { HttpError, LruCache, readJson } from './limits'
import { type AiSource, CloudError, cloudCall, cloudGone, magoConfig, type MagoConfig } from './mago-auth'
import { type Call, currentAi, requireUser, type Route } from './services'
import { userGeminiConfig } from './user-keys'

// 학원 AI: 원장이 통합 클라우드에서 정한 AI를 클라우드 중계(<클라우드>/api/ai/relay/<프로그램 ID>)로 부른다.
// 키는 클라우드에만 있고, 키 자리에 사용자의 클라우드 세션 토큰을 넣으면 클라우드가 진짜 키로 바꿔 보낸다 (요청·응답 모양은 그 AI 그대로).
// 사람마다 '학원 AI(기본) / 내 키'를 고른다. 학원 AI를 못 쓰면 등록한 내 Gemini 키, 그것도 없으면
// MAGO_SERVER_AI_FALLBACK=1일 때만 운영자 서버 AI (비용 때문에 기본은 끔). 다 없으면 428 (화면이 키 등록 안내).
// 학원 AI 주소가 학원 안 주소면(direct) 이 웹 서버는 부를 수 없어 못 쓰는 것으로 본다.

/** Claude를 고르고 모델을 비워 두면 이 모델 */
const CLAUDE_MODEL = 'claude-sonnet-5-5'
const MODEL_RE = /^[\w.:/@-]{1,100}$/

/** 클라우드가 알려 준 학원 AI (키는 오지 않음) */
export interface AcademyAiInfo {
  provider: 'gemini' | 'openai' | 'anthropic'
  /** 비어 있으면 이 프로그램 기본 모델 */
  model: string
  /** 학원 안 주소라 각 PC에서 바로 불러야 함 */
  direct: boolean
}

/**
 * ready: 부를 수 있음, none: 학원 AI가 없음, lan: 학원 안 주소라 이 서버가 못 부름, model: 모델 이름이 없음 (OpenAI 호환),
 * no-academy: 학원 사람이 아님, offline: 클라우드에 연결하지 못함
 */
export type AcademyState = 'ready' | 'none' | 'lan' | 'model' | 'no-academy' | 'offline'

/** 이번 요청에 쓸 AI */
export interface AiPick {
  cfg: AiConfig | null
  /** 내 Gemini 키 (서버 하루 한도를 세지 않음) */
  own: boolean
  /** 학원 AI면 그 학원 ID (서버 전체 하루 한도는 세지 않고, 오류는 학원 AI 안내로) */
  academy: number | null
}

/** 내 계정 화면에 보이는 AI 상태 */
export interface AiStatus {
  source: AiSource | 'teacher'
  academy: { state: AcademyState; provider: string; model: string }
  /** 학원 AI를 못 쓸 때 운영자 서버 AI로 넘어가는지 */
  fallback: boolean
  /** 지금 AI 기능을 쓸 수 있는지 (못 쓰면 화면이 키 등록 안내) */
  ready: boolean
  /** 학생에게 보이는 안내 (키 등록 화면으로 보내지 않음) */
  message?: string
}

const TEACHER_KEY_NEEDED = '담당 선생님이 AI 키를 등록하지 않았어요'

const STUDENT_ACADEMY_TEXT: Record<Exclude<AcademyState, 'ready'>, string> = {
  none: '학원에 아직 학원 AI가 없어요. 선생님께 알려 주세요.',
  lan: '학원 AI가 학원 안 주소에 있어 웹에서는 부를 수 없어요. 선생님께 알려 주세요.',
  model: '학원 AI에 모델 이름이 없어 부를 수 없어요. 선생님께 알려 주세요.',
  'no-academy': '학원 AI를 확인하지 못했어요. 선생님께 알려 주세요.',
  offline: '통합 클라우드에 연결하지 못해 학원 AI를 쓸 수 없어요. 잠시 후 다시 해 주세요.',
}

const ACADEMY_TEXT: Record<Exclude<AcademyState, 'ready'>, string> = {
  none: '학원에 아직 학원 AI가 없어요. 원장님이 통합 클라우드의 학원 AI에서 정하거나, 내 계정에서 내 Gemini API 키를 등록해 주세요.',
  lan: '학원 AI가 학원 안 주소에 있어 웹에서는 부를 수 없어요. 내 계정에서 내 Gemini API 키를 등록해 주세요.',
  model: '학원 AI에 모델 이름이 없어 부를 수 없어요. 원장님께 통합 클라우드의 학원 AI에서 모델을 정해 달라고 하거나, 내 계정에서 내 Gemini API 키를 등록해 주세요.',
  'no-academy': '학원에 속한 계정이 아니라 학원 AI를 쓸 수 없어요. 내 계정에서 내 Gemini API 키를 등록해 주세요.',
  offline: '통합 클라우드에 연결하지 못해 학원 AI를 쓸 수 없어요. 잠시 후 다시 해 주세요.',
}

/**
 * 학원 AI 중계가 클라우드 세션이 끝났다고 할 때의 오류 종류 (AI 공급자의 401과 가리려고).
 * 종류가 없는 401 은 공급자·게이트웨이 것일 수 있어 로그아웃하지 않는다 (클라우드 세션이 정말 끝났으면 10분 안에 /api/me 확인이 끊음)
 */
const SESSION_GONE = new Set(['session_invalid', 'auth_required', 'account_suspended'])

export function cleanAcademyAi(raw: unknown): AcademyAiInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.provider !== 'gemini' && r.provider !== 'openai' && r.provider !== 'anthropic') return null
  const model = typeof r.model === 'string' && MODEL_RE.test(r.model.trim()) ? r.model.trim() : ''
  return { provider: r.provider, model, direct: r.direct === true }
}

/**
 * 중계로 부르는 연결. Gemini는 OpenAI 호환 주소(<중계>/v1beta/openai, Bearer), OpenAI 호환은 <중계>(Bearer),
 * Claude는 SDK 주소를 <중계>로 (SDK가 /v1/messages를 붙이고 키를 x-api-key로). 키 자리에는 클라우드 세션 토큰.
 * OpenAI 호환인데 모델이 없으면 부를 수 없어 null
 */
export function relayConfig(cfg: MagoConfig, ai: AcademyAiInfo, token: string, geminiModel: string): AiConfig | null {
  const base = `${cfg.url}/api/ai/relay/${encodeURIComponent(cfg.appId)}`
  const name = '학원 AI'
  if (ai.provider === 'gemini') return { ...userGeminiConfig(token, ai.model || geminiModel), name, baseUrl: `${base}/v1beta/openai` }
  const model = ai.model || (ai.provider === 'anthropic' ? CLAUDE_MODEL : '')
  if (!model) return null
  return { kind: ai.provider, name, baseUrl: base, apiKey: token, model, visionModel: model, maxTokensParam: 'max_tokens', jsonMode: false }
}

/** MAGO_SERVER_AI_FALLBACK=1일 때만 운영자 서버 AI */
const fallbackAi = (call: Call) => (call.ctx.env.MAGO_SERVER_AI_FALLBACK === '1' ? currentAi(call) : null)

/** 담당 선생님의 키는 서버에서만 꺼내 쓴다. 담당이 바뀌면 다음 요청부터 새 담당의 키를 쓴다. */
function teacherKey(call: Call): string | null {
  const { accounts, mago, userKeys } = call.services
  const p = call.user ? mago.profile(call.user.id) : null
  const uid = p?.student?.teacherUid
  const teacher = uid ? accounts.bySub(`mago:${uid}`) : null
  if (!teacher || teacher.disabled) return null
  const profile = mago.profile(teacher.id)
  if (!p?.academyId || profile?.academyId !== p.academyId || !['teacher', 'director', 'admin'].includes(profile.magoRole)) return null
  return userKeys.key(teacher.id)
}

export function academyAi(fetchImpl: typeof fetch) {
  // 학원마다 60초 기억 (학원 AI가 없다는 것도)
  const cache = new LruCache<{ ai: AcademyAiInfo | null }>(500, 60_000)

  /** 이 사람이 부를 수 있는 학원 AI. gone: 클라우드 세션이 끝남 (이 세션도 끊었음) */
  const academy = async (call: Call): Promise<{ state: AcademyState | 'gone'; ai?: AcademyAiInfo; cfg?: AiConfig; academyId?: number }> => {
    const cfg = magoConfig(call.ctx.env)
    const academyId = call.user ? call.services.mago.profile(call.user.id)?.academyId : null
    const token = call.token ? call.services.mago.cloudToken(call.token) : undefined
    if (!cfg || !academyId || !token) return { state: 'no-academy' }
    const key = String(academyId)
    let hit = cache.get(key)
    if (!hit) {
      try {
        const data = await cloudCall(cfg, `/api/academy/ai?academy=${academyId}`, { token, timeoutMs: 5_000 }, fetchImpl)
        hit = { ai: cleanAcademyAi(data.ai) }
        cache.set(key, hit)
      } catch (e) {
        if (cloudGone(call, e)) return { state: 'gone' }
        return { state: e instanceof CloudError && e.status === 404 ? 'no-academy' : 'offline' }
      }
    }
    const ai = hit.ai ?? undefined
    if (!ai) return { state: 'none' }
    if (ai.direct) return { state: 'lan', ai }
    const c = relayConfig(cfg, ai, token, call.services.settings.get().userAiModel)
    return c ? { state: 'ready', ai, cfg: c, academyId } : { state: 'model', ai }
  }

  /**
   * 사용자 기능(자동 읽기·파일 읽기·문장으로 찾기)에 쓸 AI. 통합 클라우드 설정이 없으면 null (handler.ts가 원래대로 고름).
   * 고른 것이 '내 키'면 내 키만, '학원 AI'면 학원 AI → 내 키 → 운영자 서버 AI(켜 두었을 때) 순서
   */
  const pick = async (call: Call, what: string): Promise<AiPick | null> => {
    if (!magoConfig(call.ctx.env)) {
      if (call.user && call.services.mago.profile(call.user.id)?.magoRole === 'student')
        throw new HttpError(503, '통합 클라우드 연결 설정을 확인하지 못했어요. 선생님께 알려 주세요.')
      return null
    }
    const user = requireUser(call)
    const { userKeys, settings, mago } = call.services
    const profile = mago.profile(user.id)
    if (profile?.magoRole === 'student') {
      if (profile.aiMode === 'teacher') {
        const key = teacherKey(call)
        if (!key) throw new HttpError(503, TEACHER_KEY_NEEDED)
        return { cfg: { ...userGeminiConfig(key, settings.get().userAiModel), name: '담당 선생님 AI' }, own: true, academy: null }
      }
      const a = await academy(call)
      if (a.state === 'gone') throw new HttpError(401, '로그인이 끝났어요. 다시 로그인해 주세요.')
      if (a.cfg && a.academyId) return { cfg: a.cfg, own: false, academy: a.academyId }
      throw new HttpError(a.state === 'offline' ? 502 : 503, STUDENT_ACADEMY_TEXT[a.state === 'ready' ? 'none' : a.state])
    }
    const key = userKeys.key(user.id)
    const own: AiPick | null = key ? { cfg: userGeminiConfig(key, settings.get().userAiModel), own: true, academy: null } : null
    if (mago.profile(user.id)?.aiSource === 'own') {
      if (own) return own
      throw new HttpError(428, `${what}는 내 Gemini API 키로 하기로 골라 두었어요. 내 계정에서 키를 등록하거나 학원 AI로 바꿔 주세요.`)
    }
    const a = await academy(call)
    if (a.state === 'gone') throw new HttpError(401, '로그인이 끝났어요. 다시 로그인해 주세요.')
    if (a.cfg && a.academyId) return { cfg: a.cfg, own: false, academy: a.academyId }
    if (own) return own
    const server = fallbackAi(call)
    if (server) return { cfg: server, own: false, academy: null }
    throw new HttpError(a.state === 'offline' ? 502 : 428, `${what}는 학원 AI나 내 Gemini API 키로 해요. ${ACADEMY_TEXT[a.state === 'ready' ? 'none' : a.state]}`)
  }

  /** 내 계정 화면용 AI 상태. 통합 클라우드 설정이 없거나 로그인 전이면 null */
  const status = async (call: Call): Promise<AiStatus | null> => {
    if (!magoConfig(call.ctx.env) || !call.user) return null
    const profile = call.services.mago.profile(call.user.id)
    if (profile?.magoRole === 'student') {
      if (profile.aiMode === 'teacher') {
        const ready = !!teacherKey(call)
        return {
          source: 'teacher', academy: { state: 'none', provider: '', model: '' }, fallback: false, ready,
          message: ready ? '' : TEACHER_KEY_NEEDED,
        }
      }
      const a = await academy(call)
      const state = a.state === 'gone' ? 'offline' : a.state
      return {
        source: 'academy', academy: { state, provider: a.ai?.provider ?? '', model: a.ai?.model ?? '' }, fallback: false, ready: !!a.cfg,
        message: state === 'ready' ? '' : STUDENT_ACADEMY_TEXT[state],
      }
    }
    const source = profile?.aiSource ?? 'academy'
    const a = await academy(call)
    const own = !!call.services.userKeys.key(call.user.id)
    const fallback = !!fallbackAi(call)
    return {
      source,
      academy: { state: a.state === 'gone' ? 'offline' : a.state, provider: a.ai?.provider ?? '', model: a.ai?.model ?? '' },
      fallback,
      ready: source === 'own' ? own : !!a.cfg || own || fallback,
    }
  }

  /** 학원 AI 호출 오류를 할 일이 보이는 말로. 클라우드 세션이 끝났으면 이 세션도 끊고 401 (화면이 다시 로그인) */
  const failed = (call: Call, e: unknown, academyId: number): unknown => {
    if (!(e instanceof AiError)) return e
    const m = /^HTTP (\d{3})(?: (\S+))?/.exec(e.detail)
    const code = Number(m?.[1] ?? 0)
    const kind = m?.[2] ?? ''
    if (code === 401 && SESSION_GONE.has(kind)) {
      if (call.token) call.services.accounts.revokeSession(call.token)
      return new HttpError(401, '로그인이 끝났어요. 다시 로그인해 주세요.')
    }
    if ((code === 404 && (kind === 'no_academy_ai' || kind === 'no_academy')) || (code === 403 && kind === 'private_target')) {
      cache.delete(String(academyId))
      if (call.user && call.services.mago.profile(call.user.id)?.magoRole === 'student')
        return new AiError(503, STUDENT_ACADEMY_TEXT[kind === 'private_target' ? 'lan' : 'none'], e.detail)
      return new AiError(503, kind === 'private_target' ? `학원 AI를 부르지 못했어요. ${ACADEMY_TEXT.lan}` : `학원 AI가 없어졌어요. ${ACADEMY_TEXT.none}`, e.detail)
    }
    if (code === 403 && kind === 'student_ai_teacher') {
      if (call.token) call.services.mago.checked(call.token, null)
      return new AiError(409, '담당 선생님의 AI 키를 쓰도록 설정이 바뀌었어요. 화면을 새로 고쳐 주세요.', e.detail)
    }
    if (code === 429) return new AiError(429, '학원 AI 요청이 너무 많아요. 잠시 후 다시 해 주세요.', e.detail)
    if (code === 401 || code === 403 || kind === 'API_KEY_INVALID')
      return new AiError(502, '학원 AI 키로 AI를 부르지 못했어요. 키가 지워졌거나 막혔을 수 있어요. 원장님께 알려 주세요.', e.detail)
    if (code === 404) return new AiError(502, '학원 AI에 정해 둔 모델을 쓸 수 없어요. 원장님께 알려 주세요.', e.detail)
    return e
  }

  /** 내 계정의 '학원 AI / 내 키' 고르기 */
  const routes: Record<string, Route> = {
    'GET /api/me/ai': async (call) => {
      requireUser(call)
      return json({ ai: await status(call) })
    },
    'POST /api/me/ai': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, 200)) as { source?: unknown }
      if (body.source !== 'academy' && body.source !== 'own') throw new HttpError(400, '학원 AI나 내 키 가운데 하나를 골라 주세요.')
      if (call.services.mago.profile(user.id)?.aiSource !== body.source) {
        call.services.mago.setAiSource(user.id, body.source)
        call.services.accounts.activity(user, 'ai-key.source', '', body.source === 'own' ? '내 키' : '학원 AI')
      }
      return json({ ai: await status(call) })
    },
  }

  return { pick, status, failed, routes }
}

export type AcademyAi = ReturnType<typeof academyAi>
