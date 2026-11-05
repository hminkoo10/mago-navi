import { IconArrow } from '../components/icons'
import { SUBJECTS } from '../data/subjects'
import { UNITS } from '../data/units'
import { UNIVERSITIES } from '../data/universities'
import admissionsMeta from '../data/admissions2028.meta.json'
import { useApp } from '../lib/app'
import { Link } from '../components/Link'

const STEPS: [string, string][] = [
  ['우리 학교 고르기', '학교 편제표를 찾아 불러와요. 특성화고는 학과까지 골라요.'],
  ['가고 싶은 분야와 대학', '분야를 고르고 목표 대학을 담아요.'],
  ['학기별 추천 과목', '선택 칸에 맞춰 학기별 추천을 보여 줘요.'],
  ['지원할 수 있는 전형', '내 조건에 맞는 2028 전형을 찾아 수시 6장·정시 3장을 짜 봐요.'],
]

const FAQ: [string, string][] = [
  ['권장과목을 안 들으면 지원할 수 없나요?', '지원 자격은 아니지만, 학생부 평가에서 이수 여부를 보는 대학이 많아요.'],
  [
    '우리 학교에 없는 과목은 어떻게 하나요?',
    '공동교육과정·온라인학교로 들을 수 있어요. 결과 화면에서 지역 주소를 보여 줘요.',
  ],
  [
    '전형 정보는 믿을 만한가요?',
    '2028 시행계획 원문을 옮기고, 바뀐 내용은 확인해 반영해요. 최종 내용은 모집요강을 확인하세요.',
  ],
  ['특성화고도 쓸 수 있나요?', '학교와 학과를 고르면 그 편제표로 계산해요.'],
  [
    '꼭 로그인해야 하나요?',
    '통합 클라우드 계정으로 로그인해요. 학생별 설계를 다른 기기에서도 이어서 봐요.',
  ],
]

export function HomePage() {
  const { store, user, features, authReady } = useApp()
  // 로그인한 사람을 확인한 뒤에만 이 기기 설계를 봄 (다른 사람이 남긴 것일 수 있음)
  const started = !!store.school && authReady && (!!user || !features.server)
  // 로그인 필수: 로그인 전이면 로그인 화면을 거쳐 시작
  const guest = features.server && !user
  const subjects = SUBJECTS.filter((s) => s.kind !== '기타').length
  const tracks = admissionsMeta.tracks

  return (
    <div className="home">
      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <p className="eyebrow">2028 대입 · 고교학점제</p>
            <h1>
              우리 학교 선택과목,
              <br />
              <span className="mark">가고 싶은 학과</span>에 맞춰 고르세요
            </h1>
            <p className="lead">학교 편제표에 맞춘 과목 추천과 2028 전형을 봐요.</p>
            <div className="hero-actions">
              {guest ? (
                <Link to="/login?next=%2Fstart" className="btn btn-primary btn-lg">
                  로그인하고 시작하기 <IconArrow />
                </Link>
              ) : (
                <Link to={started ? '/plan' : '/start'} className="btn btn-primary btn-lg">
                  {started ? '내 과목 설계 보기' : '우리 학교로 시작하기'} <IconArrow />
                </Link>
              )}
              <Link to="/universities" className="btn btn-lg">
                대학 권장과목 보기
              </Link>
            </div>
            <p className="hero-note">
              {guest
                ? '통합 클라우드 계정으로 로그인해 여러 기기에서 이어서 봐요.'
                : '고른 학교와 설계는 계정에 저장돼요.'}
            </p>
          </div>

          <div className="hero-demo" aria-label="결과 화면 예시">
            <div className="demo-card">
              <div className="demo-head">
                <strong>2학년 1학기</strong>
                <span>29학점</span>
              </div>
              <p className="demo-group">
                사회·과학 탐구 <em>3과목 선택</em>
              </p>
              <ul className="demo-list">
                <li className="is-pick">
                  물리학<small>공학계열 권장</small>
                </li>
                <li className="is-pick">
                  화학<small>앞 과목</small>
                </li>
                <li className="is-free">원하는 과목 1개</li>
              </ul>
              <p className="demo-group">
                교과 선택 <em>1과목 선택</em>
              </p>
              <ul className="demo-list">
                <li className="is-pick">
                  기하<small>자연계열 권장</small>
                </li>
              </ul>
            </div>
            <p className="demo-caption">파란 막대는 추천 과목이에요.</p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap stats">
          <div>
            <strong className="num">{UNIVERSITIES.length}</strong>
            <span>대학</span>
          </div>
          <div>
            <strong className="num">{UNITS.length.toLocaleString('ko-KR')}</strong>
            <span>학과(모집단위)</span>
          </div>
          <div>
            <strong className="num">{subjects}</strong>
            <span>2022 개정 과목</span>
          </div>
          <div>
            <strong className="num">{tracks.toLocaleString('ko-KR')}</strong>
            <span>2028 전형</span>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <h2 className="section-title">이렇게 써요</h2>
        <ol className="steps-grid">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="step-card">
              <span className="step-no num">{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap section">
        <h2 className="section-title">어디서 온 자료인가요</h2>
        <div className="source-grid">
          <div className="source-card">
            <h3>대교협 대입정보포털 자료집</h3>
            <p>대학별 핵심·권장과목을 옮겼어요.</p>
          </div>
          <div className="source-card">
            <h3>대학 입학처 원문</h3>
            <p>
              자료집에 없는 대학은 입학처 원문을 확인해 옮겼어요. 권장과목이 없으면 확인한 문서를 보여 줘요.
            </p>
          </div>
          <div className="source-card">
            <h3>학교알리미 공시</h3>
            <p>학교알리미 공시와 학교 홈페이지에서 가져와요.</p>
          </div>
        </div>
        <p className="section-more">
          <Link to="/help#sources">자료 출처 자세히</Link>
        </p>
      </section>

      <section className="wrap section">
        <h2 className="section-title">자주 묻는 질문</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
        <p className="section-more">
          <Link to="/help">질문 더 보기</Link>
        </p>
      </section>

      <section className="cta-band">
        <div className="wrap cta-in">
          <h2>우리 학교 편제표로 시작하기</h2>
          <Link to={started ? '/plan' : '/start'} className="btn btn-primary btn-lg">
            {started ? '내 과목 설계 보기' : '시작하기'} <IconArrow />
          </Link>
        </div>
      </section>
    </div>
  )
}
