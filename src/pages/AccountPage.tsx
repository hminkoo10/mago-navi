import { type FormEvent, useState } from 'react'
import { FormError } from '../components/Form'
import { Link } from '../components/Link'
import { type AcademyAiState, type AiSource, ApiError, auth, isAdminRole, MAGO_ROLE_TEXT, magoLoginUrl, type Me, myAi, myAiKey, ROLE_TEXT } from '../lib/api'
import { useApp } from '../lib/app'
import { dateTime } from '../lib/format'
import type { SyncState } from '../lib/store'

const SYNC_TEXT: Record<SyncState, string> = {
  off: '',
  loading: '계정에 저장한 설계를 불러오는 중',
  'load-error': '계정에 저장한 설계를 불러오지 못했어요. 이 기기의 설계는 그대로 있고, 연결되면 합쳐서 저장해요.',
  saving: '계정에 저장하는 중',
  saved: '계정에 저장돼 있어요',
  error: '계정에 저장하지 못했어요. 고친 내용은 이 기기에 남아 있고, 연결되면 다시 저장해요.',
  rejected: '계정에 저장하지 못했어요.',
}

const PROVIDER_TEXT: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI 호환', anthropic: 'Claude' }

/** 학원 AI를 못 쓰는 까닭 */
const ACADEMY_AI_TEXT: Record<Exclude<AcademyAiState, 'ready'>, string> = {
  none: '학원에 아직 학원 AI가 없어요. 원장님이 통합 클라우드의 학원 AI에서 정할 수 있어요.',
  lan: '학원 AI가 학원 안 주소에 있어 웹에서는 부를 수 없어요.',
  model: '학원 AI에 모델 이름이 없어 부를 수 없어요. 원장님께 통합 클라우드의 학원 AI에서 모델을 정해 달라고 해 주세요.',
  'no-academy': '학원에 속한 계정이 아니라 학원 AI가 없어요.',
  offline: '통합 클라우드에 연결하지 못해 학원 AI를 확인하지 못했어요. 잠시 후 다시 열어 주세요.',
}

/** 등록한 키가 바뀌면 AI 상태도 바뀌어 내 정보를 다시 받는다 (못 받으면 그대로) */
async function refreshMe(setUser: (u: Me | null) => void) {
  try {
    const r = await auth.me()
    if (r.user) setUser(r.user)
  } catch {
    // 다음에 화면을 열 때 다시 받는다
  }
}

/** 통합 클라우드 로그인일 때: AI 기능에 학원 AI(기본)와 내 Gemini API 키 가운데 무엇을 쓸지 */
function AiChoiceCard() {
  const { user, setUser, notify } = useApp()
  const [busy, setBusy] = useState(false)
  const ai = user?.ai
  if (!user || !ai || user.magoRole === 'student') return null
  const { academy } = ai
  const provider = PROVIDER_TEXT[academy.provider] ?? academy.provider
  const which = provider ? `학원 AI: ${provider}${academy.model ? ` (${academy.model})` : ''}. ` : ''
  const academyText =
    academy.state === 'ready' ? `${which}키는 통합 클라우드에만 있고 이 프로그램에는 오지 않아요.` : `${which}${ACADEMY_AI_TEXT[academy.state]}`
  const instead =
    ai.source === 'own' || academy.state === 'ready'
      ? ''
      : user.aiKey?.ok
        ? '학원 AI를 못 쓰는 동안에는 등록한 내 키로 해요.'
        : ai.fallback
          ? '학원 AI를 못 쓰는 동안에는 운영자 서버 AI로 해요.'
          : '그동안 AI 기능을 쓰려면 아래에 내 키를 등록해 주세요.'

  const choose = async (source: AiSource) => {
    if (source === ai.source) return
    setBusy(true)
    try {
      const r = await myAi.set(source)
      setUser({ ...user, ai: r.ai })
      notify(source === 'own' ? '이제 AI 기능을 내 Gemini API 키로 해요.' : '이제 AI 기능을 학원 AI로 해요.')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '바꾸지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" id="ai">
      <h2 className="card-title">AI 기능에 쓸 AI</h2>
      <p className="card-sub">편제표 자동 읽기·파일 읽기·문장으로 찾기를 무엇으로 할지 골라요.</p>
      <div className="segmented segmented-2" role="radiogroup" aria-label="AI 기능에 쓸 AI">
        {(
          [
            ['academy', '학원 AI', '원장님이 정한 AI (기본)'],
            ['own', '내 키', '내 Gemini API 키'],
          ] as const
        ).map(([value, label, sub]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={ai.source === value}
            className={ai.source === value ? 'is-on' : ''}
            disabled={busy}
            onClick={() => void choose(value)}
          >
            <strong>{label}</strong>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      {ai.source === 'own' ? (
        !user.aiKey?.ok && <p className="callout is-warn">아직 쓸 수 있는 내 키가 없어요. 아래에 키를 등록해 주세요.</p>
      ) : (
        <p className={academy.state === 'ready' ? 'fine' : 'callout is-warn'}>
          {academyText}
          {instead && ` ${instead}`}
        </p>
      )}
    </section>
  )
}

/**
 * 내 Gemini API 키: '사용자 키로 AI 쓰기'가 켜졌을 때 편제표 읽기·파일 읽기·문장으로 찾기에 씀.
 * 꺼져 있어도 등록한 키가 있으면 보여 줘서 지울 수 있게
 */
function AiKeyCard() {
  const { user, setUser, features, notify } = useApp()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user || user.magoRole === 'student' || (!features.userKey && !user.aiKey)) return null
  const key = user.aiKey ?? null
  const mago = !!user.ai

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const apiKey = value.trim()
    if (apiKey.length < 20) return setError('Google AI Studio에서 복사한 키를 붙여 넣어 주세요.')
    setBusy(true)
    setError('')
    try {
      const r = await myAiKey.save(apiKey)
      setUser({ ...user, aiKey: r.aiKey })
      setValue('')
      setEditing(false)
      notify(r.note ? `키를 등록했어요. ${r.note}` : mago ? '키를 등록했어요.' : '키를 등록했어요. 이제 AI 기능을 내 키로 써요.')
      if (mago) void refreshMe(setUser)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '키를 등록하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`등록한 Gemini API 키를 지울까요?${features.userKey && !mago ? ' 지우면 편제표 자동 읽기·파일 읽기·문장으로 찾기를 쓸 수 없어요.' : ''}`)) return
    setBusy(true)
    try {
      await myAiKey.remove()
      setUser({ ...user, aiKey: null })
      notify('키를 지웠어요. Google AI Studio에서도 그 키를 지우면 더 안전해요.')
      if (mago) void refreshMe(setUser)
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '키를 지우지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" id="ai-key">
      <h2 className="card-title">내 Gemini API 키</h2>
      <p className="card-sub">
        {mago
          ? "'내 키'를 고르거나 학원 AI를 쓸 수 없을 때 편제표 자동 읽기·파일 읽기·문장으로 찾기를 이 키로 해요."
          : features.userKey
            ? '편제표 자동 읽기·파일 읽기·문장으로 찾기를 이 키로 해요. 키가 없으면 이 기능들을 쓸 수 없어요.'
            : '지금은 관리자가 서버 AI를 쓰게 해 두어서 이 키를 쓰지 않아요.'}
      </p>
      {key && !editing ? (
        <>
          <dl className="kv">
            <div>
              <dt>등록한 키</dt>
              <dd className="num">{key.hint}</dd>
            </div>
            <div>
              <dt>등록</dt>
              <dd>{dateTime(key.addedAt)}</dd>
            </div>
          </dl>
          {!key.ok && <p className="callout is-warn">서버 설정이 바뀌어 이 키를 쓸 수 없어요. 키를 다시 등록해 주세요.</p>}
          <div className="row-btns">
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>
              다른 키로 바꾸기
            </button>
            <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={() => void remove()}>
              지우기
            </button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={(e) => void save(e)} noValidate>
          <label className="field">
            <span className="field-label">Google AI Studio API 키</span>
            <input
              type="password"
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="AI Studio에서 복사한 키를 붙여 넣으세요"
              aria-describedby="ai-key-help"
            />
          </label>
          <FormError message={error} />
          <div className="row-btns">
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              {busy ? '키를 확인하는 중' : '확인하고 등록'}
            </button>
            {key && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setValue('')
                  setError('')
                }}
              >
                취소
              </button>
            )}
          </div>
        </form>
      )}
      <p className="fine" id="ai-key-help">
        키는 암호화해서 저장하고, AI 기능을 쓸 때만 Google로 보내요. 등록할 때 짧은 질문 하나로 맞는 키인지 확인해요. 키는 다른 사람에게 보내거나 채팅에 올리지
        마세요. <Link to="/help/gemini-key">발급 방법 보기</Link>
      </p>
    </section>
  )
}

export function AccountPage() {
  const { user, authReady, store, signOut, features, students } = useApp()

  if (!authReady) return <div className="wrap gate" aria-busy="true" />
  if (!user)
    return (
      <div className="wrap auth">
        <div className="auth-card">
          <h1 className="auth-title">로그인이 필요해요</h1>
          <p className="auth-sub">마고 과목내비는 마고에듀 통합 클라우드 계정으로 로그인해 써요.</p>
          {features.login ? (
            <a href={magoLoginUrl('/account')} className="btn btn-primary btn-lg btn-block">
              마고에듀 통합 클라우드 계정으로 로그인
            </a>
          ) : (
            <p className="callout is-warn">지금은 로그인을 쓸 수 없어요. 서버에 통합 클라우드 로그인이 아직 설정되지 않았어요.</p>
          )}
        </div>
      </div>
    )

  const syncText = SYNC_TEXT[store.sync]
  const student = students.current
  // 학원 사람은 지금 연 학생의 설계 (학생을 고르기 전이면 안내만)
  const noStudent = students.active && !student

  return (
    <div className="wrap page account">
      <header className="page-head">
        <p className="eyebrow">내 계정</p>
        <h1 className="page-title account-email">{user.name || user.email}</h1>
        <p className="page-sub">
          {user.name ? `${user.email} · ` : ''}
          {user.academy ? `${user.academy.name} ` : ''}
          {(user.magoRole && MAGO_ROLE_TEXT[user.magoRole]) || ROLE_TEXT[user.role]} · 통합 클라우드 계정으로 로그인 · {dateTime(user.createdAt, false)}부터 씀
        </p>
        <p className="fine">이름·비밀번호·학원은 통합 클라우드에서 바꿔요. 바꾸면 여기에도 곧 반영돼요.</p>
      </header>

      <div className="settings-list">
        <section className="panel-card">
          <h2 className="card-title">{students.active ? (student ? `${student.name} 학생 설계` : '학생 설계') : '저장한 설계'}</h2>
          <p className="card-sub">
            {noStudent
              ? user.magoRole === 'student' ? '내 학생 정보를 확인하고 있어요.' : '학생마다 설계를 따로 저장해요. 머리글의 학생에서 학생을 고르면 그 학생 설계를 보여 줘요.'
              : store.sync === 'saved' && store.savedAt
                ? `${syncText} · ${dateTime(store.savedAt)}`
                : store.sync === 'rejected' && store.syncMessage
                  ? `${syncText} ${store.syncMessage}`
                  : syncText}
          </p>
          {!noStudent && (
            <dl className="kv">
              <div>
                <dt>학교</dt>
                <dd>
                  {store.school
                    ? `${store.school.name} (${store.school.cohort}학년도 입학${store.school.track ? ` · ${store.school.track}` : ''})`
                    : '아직 고르지 않았어요'}
                </dd>
              </div>
              <div>
                <dt>저장한 학교</dt>
                <dd>{store.schools.length}곳</dd>
              </div>
              <div>
                <dt>슬롯</dt>
                <dd>{store.slots.length}개</dd>
              </div>
              <div>
                <dt>분야 · 대학</dt>
                <dd>
                  분야 {store.prefs.majors.length}개 · 대학 {store.prefs.univs.length}곳
                </dd>
              </div>
            </dl>
          )}
          <div className="row-btns">
            {(store.sync === 'error' || store.sync === 'load-error') && (
              <button type="button" className="btn" onClick={store.retrySync}>
                지금 다시 시도
              </button>
            )}
            <Link to={store.school ? '/plan' : '/start'} className="btn">
              {noStudent ? user.magoRole === 'student' ? '내 설계 보기' : '학생 고르기' : store.school ? (student ? '과목 설계 보기' : '내 과목 설계 보기') : '시작하기'}
            </Link>
            {user.magoRole !== 'student' && isAdminRole(user.role) && (
              <Link to="/admin" className="btn">
                관리 화면
              </Link>
            )}
          </div>
        </section>

        <AiChoiceCard />

        <AiKeyCard />

        {user.magoRole === 'student' && (
          <section className="panel-card">
            <h2 className="card-title">AI 기능</h2>
            <p className="card-sub">{user.aiMode === 'teacher' ? '담당 선생님의 AI 키로 이용해요.' : '학원 AI로 이용해요.'} AI 설정은 선생님이 정해요.</p>
            {user.ai?.message && <p className="callout is-warn">{user.ai.message}</p>}
          </section>
        )}

        <section className="panel-card">
          <h2 className="card-title">로그아웃</h2>
          <p className="card-sub">
            로그아웃하면 이 기기에 남은 설계를 지워요. 계정에는 그대로 남아 있어요. 브라우저를 닫아도 로그아웃되지 않으니, 같이 쓰는 컴퓨터에서는 꼭
            로그아웃하세요.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </section>

      </div>
    </div>
  )
}
