import type { ReactNode } from 'react'
import { Link } from '../components/Link'
import { useApp } from '../lib/app'

// Google AI Studio에서 Gemini API 키를 만들어 마고 과목내비에 등록하는 방법.
// 2026년 10월 Google 안내(ai.google.dev/gemini-api/docs/api-key, Gemini API 추가 약관 2026-03-23 시행) 기준.

const STUDIO = 'https://aistudio.google.com/apikey'
const DOCS = 'https://ai.google.dev/gemini-api/docs/api-key?hl=ko'
const TERMS = 'https://ai.google.dev/gemini-api/terms?hl=ko'

const STEPS: [string, ReactNode][] = [
  [
    'Google AI Studio 열기',
    <>
      <a href={STUDIO} target="_blank" rel="noreferrer noopener">
        aistudio.google.com/apikey
      </a>
      에 들어가 Google 계정으로 로그인해요. 처음이면 서비스 약관에 동의하라는 창이 나와요.
    </>,
  ],
  [
    'API 키 만들기',
    "API 키 페이지에서 'API 키 만들기'를 눌러요. 이미 키가 있으면 그 키를 써요.",
  ],
  ['프로젝트 고르기', '기본 프로젝트를 고르거나 새 프로젝트를 만들어요.'],
  ['키 복사하기', '키를 복사해요. 다른 사람에게 보내지 마세요.'],
  [
    '마고 과목내비에 등록하기',
    "내 계정의 '내 Gemini API 키'에 붙여 넣고 등록해요. 키는 암호화해 저장해요.",
  ],
]

const TROUBLE: [string, string][] = [
  [
    "'API 키 만들기'가 눌리지 않아요",
    "'이 프로젝트에서 키를 만들 권한이 없습니다'가 나오면 개인 계정이나 새 프로젝트로 다시 시도하세요.",
  ],
  [
    '등록할 때 맞지 않는 키라고 나와요',
    "키를 끝까지 복사했는지 확인하세요. 지웠거나 차단된 키면 새로 만드세요.",
  ],
  ['사용 한도에 걸렸다고 나와요', '무료 등급은 요청 수가 정해져 있어요. 잠시 후나 다음 날 다시 시도하세요.'],
]

/** Gemini API 키 발급 방법 (로그인 없이도 볼 수 있음) */
export function GeminiKeyPage() {
  const { features, user } = useApp()
  return (
    <div className="wrap page help guide">
      <header className="page-head">
        <p className="eyebrow">도움말</p>
        <h1 className="page-title">Gemini API 키 발급 방법</h1>
        <p className="page-sub">
          편제표·파일 읽기와 문장 검색에 Google AI Studio API 키를 쓰는 방법이에요.
        </p>
      </header>

      {!features.userKey && (
        <p className="callout">지금은 키를 등록하지 않아도 돼요. 설정에 따라 필요할 수 있어요.</p>
      )}

      <section id="before" className="help-section">
        <h2 className="section-title">먼저 확인하세요</h2>
        <ul className="plain-list">
          <li>Google 계정이 필요해요. 학교·회사 계정은 제한될 수 있어요.</li>
          <li>결제 정보를 연결하지 않으면 무료 한도 안에서 써요.</li>
          <li>
            무료 등급에서는 보낸 내용과 답을 Google이 개선에 쓰고 검토자가 읽을 수 있어요. 개인정보는 보내지 마세요.
          </li>
        </ul>
      </section>

      <section id="steps" className="help-section">
        <h2 className="section-title">키 만들기</h2>
        <ol className="guide-steps">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <span className="step-no num">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="guide-action">
          {user ? (
            <Link to="/account#ai-key" className="btn btn-primary">
              내 계정에서 키 등록하기
            </Link>
          ) : (
            <Link to="/login?next=%2Faccount" className="btn btn-primary">
              로그인하고 키 등록하기
            </Link>
          )}
        </p>
      </section>

      <section id="manage" className="help-section">
        <h2 className="section-title">키 관리</h2>
        <ul className="plain-list">
          <li>키는 비밀번호처럼 다루세요.</li>
          <li>키가 새면 AI Studio에서 지우고 새 키를 등록하세요.</li>
          <li>마고 과목내비에서 키를 지우려면 내 계정의 '내 Gemini API 키'에서 지우기를 누르세요.</li>
          <li>키는 암호화해 보관하고, 기능을 쓸 때만 Google로 보내요. 화면에는 끝 4자리만 보여요.</li>
        </ul>
      </section>

      <section id="trouble" className="help-section">
        <h2 className="section-title">잘 안 될 때</h2>
        <div className="faq">
          {TROUBLE.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="fine guide-foot">
        2026년 10월 Google 안내를 기준으로 썼어요. Google 화면은 바뀔 수 있어요. 자세한 내용은 Google의{' '}
        <a href={DOCS} target="_blank" rel="noreferrer noopener">
          Gemini API 키 안내
        </a>
        와{' '}
        <a href={TERMS} target="_blank" rel="noreferrer noopener">
          Gemini API 추가 약관
        </a>
        을 확인하세요.
      </p>
    </div>
  )
}
