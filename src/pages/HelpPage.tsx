import { useEffect } from 'react'
import { JOINT_BY_SIDO, JOINT_CHECKED, JOINT_NATIONAL } from '../data/joint'
import { DATA_DATE } from '../data/meta'
import { SIDO } from '../engine/admissions'
import { UNITS } from '../data/units'
import { ADIGA_OWN_SOURCE } from '../data/adiga'
import { EXCLUDED_NOTE, UNIVERSITIES } from '../data/universities'
import { useAiTraining, useApp } from '../lib/app'
import { COVERAGE_LABEL } from '../lib/format'
import { Link } from '../components/Link'

const FAQ: [string, string][] = [
  [
    '권장과목이 뭔가요?',
    '대학이 학과마다 이수하면 좋다고 밝힌 고등학교 과목이에요. 핵심과목은 특히 중요하다고 본 과목이에요.',
  ],
  [
    '권장과목을 안 들으면 지원할 수 없나요?',
    '지원 자격은 아니지만, 여러 대학이 학생부 평가에서 이수 여부를 봐요. 학교에 과목이 없는 경우를 따로 보는 대학도 있어요.',
  ],
  [
    '우리 학교에 없는 과목은 어떻게 하나요?',
    '공동교육과정·온라인학교로 들을 수 있어요. 신청 방법은 학교에 물어보고, 아래에서 지역별 주소를 확인하세요.',
  ],
  ['특성화고·특목고도 쓸 수 있나요?', '학교와 학과를 고르면 그 편제표로 계산해요.'],
  ['우리 학교 편제표를 못 찾았어요.', "PDF·사진은 '파일' 탭에, 한글·엑셀 표는 '텍스트' 탭에 넣어요."],
  ['불러온 편제표가 틀려요.', '출처 탭에서 알려 주거나, 저장된 학교에서 표를 열어 고치세요.'],
  ['입학년도는 어떻게 고르나요?', '고등학교에 들어간 해를 고르세요. 입학년도마다 편제표가 달라요.'],
  [
    '지원 가능·확인 필요·지원 불가는 어떻게 정하나요?',
    '대학 시행계획의 자격과 내 학교·조건을 맞춰 봐요. 서류 확인이나 학교장 추천이 필요한 전형은 확인 필요로 보여 줘요. 최종 자격은 모집요강을 확인하세요.',
  ],
  [
    '원서 후보는 어떻게 쓰나요?',
    '전형 오른쪽의 담기를 누르면 원서 후보에 모여요. 수시 6장·정시 3장을 넘거나 지원할 수 없는 전형을 알려 줘요.',
  ],
  [
    '대입 정보는 언제 바뀌나요?',
    '대학 원문이 바뀌면 확인해 반영해요. 바뀐 내용은 대입 정보 소식에서 봐요.',
  ],
  [
    '분야를 더 좁혀서 고를 수 있나요?',
    '분야마다 세부 학과를 고를 수 있어요. 하고 싶은 일을 문장으로 적으면 맞는 학과를 찾아 줘요. 넓은 모집단위는 함께 나와요.',
  ],
  [
    '목표 전형을 바꾸면 무엇이 달라지나요?',
    '전형마다 학생부를 보는 방식이 달라 권장과목을 반영하는 학과가 달라요. 정시는 수능 과목, 논술은 출제 범위를 더해요.',
  ],
  [
    '빈칸의 "추천"은 어떻게 정하나요?',
    '같은 분야 학과가 많이 권한 과목을 추천해요. 앞 과목 순서를 지키고, 원하는 과목 직접 고르기에서 바꿀 수 있어요.',
  ],
  [
    '정시 반영 비율 표는 어떻게 보나요?',
    '모집단위별 수능 반영 비율이에요. 진한 영역이 가장 많이 반영되고, 합이 100%를 넘으면 성적이 좋은 영역을 골라 반영해요.',
  ],
  [
    '"내 학과 n명"은 무엇인가요?',
    '고른 학과의 모집 인원이에요. 학과별 인원표를 옮긴 대학에서만 보여요. "인원 미정"은 학과별 인원이 따로 없다는 뜻이에요.',
  ],
  [
    '설계를 여러 개 저장해 두고 비교하고 싶어요.',
    '내 과목 설계 맨 위 설계안 줄에서 새 설계안을 열거나 복사하세요. 설계안마다 학교·분야·대학·학과를 따로 저장해요. 최대 10개예요.',
  ],
  [
    '처음부터 다시 고르고 싶어요.',
    '내 과목 설계의 초기화에서 꼭 듣기·빼기만 지우거나 현재 설계안을 비울 수 있어요. 학교 편제표와 다른 설계안은 그대로예요.',
  ],
  [
    '꼭 로그인해야 하나요?',
    '통합 클라우드 계정으로 로그인해요. 학생별 설계를 다른 기기에서도 이어서 봐요.',
  ],
  [
    '계정은 어떻게 만드나요?',
    '통합 클라우드에서 만들어요. 이 프로그램에서 따로 가입하거나 비밀번호를 만들지 않아요.',
  ],
  [
    '학생은 어떻게 고르나요?',
    '머리글의 학생에서 이름·학교·학년으로 찾아요. 없으면 바로 추가하고, 같은 학원 선생님과 설계를 함께 써요.',
  ],
]

const TERMS: [string, string][] = [
  ['편제표', '학년·학기별 과목과 학점을 정한 학교 교육과정 표예요.'],
  ['선택 칸', '여러 과목 중 정해진 개수를 고르는 묶음이에요.'],
  ['일반선택·진로선택·융합선택', '2022 개정 교육과정의 선택과목 구분이에요.'],
  ['학과(모집단위)', '대학이 학생을 뽑는 단위예요.'],
  ['앞 과목', '순서상 먼저 듣는 과목이에요.'],
  ['공동교육과정', '여러 학교가 함께 여는 수업이에요.'],
  [
    '수시 6번·정시 3번',
    '수시는 6번, 정시는 3번까지 지원할 수 있어요. 특별법 대학·산업대·전문대는 제외돼요.',
  ],
  ['수능 최저학력기준', '합격에 필요한 수능 최소 등급이에요. "3합 7"은 세 영역 등급 합이 7 이내라는 뜻이에요.'],
]

export function HelpPage() {
  const { features, user } = useApp()
  const ai = features.ai
  const training = useAiTraining()
  const counts = {
    official: UNIVERSITIES.filter((u) => u.coverage === 'official').length,
    other: UNIVERSITIES.filter((u) => u.coverage !== 'official').length,
  }

  // 다른 페이지의 '자료 출처' 같은 링크(#id)로 들어오면 그 칸으로 스크롤
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [])

  return (
    <div className="wrap page help">
      <header className="page-head">
        <h1 className="page-title">도움말</h1>
        <p className="page-sub">마고 과목내비가 무엇을 계산하는지, 자료는 어디서 왔는지 정리했어요.</p>
      </header>

      <section className="help-manual" aria-labelledby="manual-title">
        <h2 id="manual-title" className="section-title">처음이라면 사용 설명서부터 확인하세요</h2>
        <p>과목내비와 통합 클라우드 사용법을 설명해요.</p>
        <div className="help-manual-links">
          <a href={`${features.cloudUrl}/help/navi.html`} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            과목내비 사용 설명서 열기
          </a>
          <a href={`${features.cloudUrl}/help/`} target="_blank" rel="noopener noreferrer" className="small">
            마고에듀 전체 설명서
          </a>
        </div>
      </section>

      <nav className="toc" aria-label="목차">
        <a href="#faq">자주 묻는 질문</a>
        <a href="#terms">용어 풀이</a>
        <a href="#joint">학교에 없는 과목 듣기</a>
        <a href="#sources">자료 출처</a>
        <a href="#school-data">학교 편제표를 가져오는 방법</a>
        <a href="#privacy">개인정보 안내</a>
        {features.userKey && user?.magoRole !== 'student' && <Link to="/help/gemini-key">Gemini API 키 발급 방법</Link>}
      </nav>

      <section id="faq" className="help-section">
        <h2 className="section-title">자주 묻는 질문</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="terms" className="help-section">
        <h2 className="section-title">용어 풀이</h2>
        <dl className="terms">
          {TERMS.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="joint" className="help-section">
        <h2 className="section-title">학교에 없는 과목 듣기</h2>
        <p>
          시도교육청마다 온라인학교와 공동교육과정을 운영해요. 온라인학교는 따로 입학하는 학교가 아니라, 다니는 학교에 적을 둔 채 과목만 듣는 곳이에요. 학점은
          다니는 학교에서 인정해요.
        </p>
        <ul className="joint-list">
          {SIDO.map((sido) => {
            const j = JOINT_BY_SIDO[sido]
            const links = [j?.online, j?.joint].filter((x) => x !== undefined)
            return (
              <li key={sido}>
                <strong>{sido}</strong>
                <span>
                  {links.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 && ' · '}
                      <a href={l.url} target="_blank" rel="noreferrer noopener">
                        {l.name}
                      </a>
                    </span>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="muted">
          전국 안내는{' '}
          <a href={JOINT_NATIONAL.joint.url} target="_blank" rel="noreferrer noopener">
            고교학점제 홈페이지
          </a>
          에 있어요. 주소는 {JOINT_CHECKED}에 확인했어요. 전남온라인학교는 확인한 날 접속이 되지 않아 뺐어요.
        </p>
      </section>

      <section id="sources" className="help-section">
        <h2 className="section-title">자료 출처</h2>
        <p>
          대학 {UNIVERSITIES.length}곳, 학과 {UNITS.length.toLocaleString('ko-KR')}개의 권장과목을 담았어요. 자료가 없는 대학은 확인한 문서만 보여 줘요.{' '}
          {counts.other ? `공식 자료 ${counts.official}곳, 그 밖의 자료 ${counts.other}곳이에요.` : '모두 대학이나 대교협이 낸 공식 자료예요.'}
        </p>
        <ul className="plain-list">
          <li>
            대교협 자료집(2025-12-18)과 대학 입학처 원문을 대조해 옮겼어요. 다르면 대학 원문을 따랐어요.
          </li>
          <li>연세대: 입학처 「2028학년도 전공연계과목 선택 가이드라인」(2026-04), 중앙대: 입학처 학문단위별 이수 권장과목 안내(2025-09)</li>
          <li>
            성균관대·서강대는 학과별 권장과목이 없다고 밝혔어요.
          </li>
          {ADIGA_OWN_SOURCE.length > 0 && (
            <li>
              자료집에 없어서 대학이 따로 낸 자료로 넣은 대학:{' '}
              {ADIGA_OWN_SOURCE.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && ', '}
                  <a href={u.sources[0].url} target="_blank" rel="noreferrer noopener">
                    {u.sources[0].title}
                  </a>{' '}
                  ({u.sources[0].date})
                </span>
              ))}
            </li>
          )}
        </ul>
        <p className="muted">{EXCLUDED_NOTE}</p>
        <details className="source-table">
          <summary>대학별 출처 보기</summary>
          <ul>
            {UNIVERSITIES.map((u) => (
              <li key={u.id}>
                <Link to={`/universities/${u.id}`}>{u.name}</Link>
                <span className="muted"> · {COVERAGE_LABEL[u.coverage]}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="muted">자료 기준일 {DATA_DATE}. 지원 전에는 대학 입학처 공지를 확인하세요.</p>
      </section>

      <section id="school-data" className="help-section">
        <h2 className="section-title">학교 편제표를 가져오는 방법</h2>
        <ol className="plain-list">
          <li>이미 불러온 학교면 저장된 편제표를 바로 보여 줘요.</li>
          <li>
            처음 보는 학교면 학교알리미와 학교 홈페이지에서 편제표 파일을 찾아요.
          </li>
          <li>파일에서 과목과 학점을 읽어요. 학과를 고르면 그 표만 읽어요.</li>
          <li>학기별 학점을 확인하고, 이상하면 저장 전에 고쳐요.</li>
        </ol>
        <p>
          학교 홈페이지는 허용된 곳만 읽어요. 자동으로 옮긴 표는 틀릴 수 있으니 원문과 확인하세요.
        </p>
      </section>

      <section id="privacy" className="help-section">
        <h2 className="section-title">개인정보 안내</h2>
        <ul className="plain-list">
          <li>
            로그인 정보와 고른 학교·분야·대학·편제표를 서버와 브라우저에 저장해요. 학원 계정은 학생별로 저장해요.
          </li>
          <li>
            로그인 계정 정보와 로그인 시각을 보관해요. 비밀번호는 받지 않아요. 로그인 토큰은 암호화해 로그인하는 동안만 보관해요.
          </li>
          <li>
            학생 명단은 통합 클라우드에 있고, 이 서버는 화면에 보여 줄 때 잠깐만 기억해요. 학생별 설계는 같은 학원 사람만 보고 고칠 수 있어요. 학생을 완전히 지우면 설계도 지워요.
          </li>
          <li>
            로그인·설계 변경·편제표 읽기·신고 같은 이용 기록을 남겨요. 운영과 부정 이용 방지에만 쓰고, 파일·문장 내용과 IP는 남기지 않아요. 1년 뒤 지워요.
          </li>
          <li>
            로그아웃하면 이 기기의 설계를 지워요. 서버에는 남아 있어요. 같이 쓰는 컴퓨터에서는 꼭 로그아웃하세요.
          </li>
          <li>공유 링크에는 고른 설정과 학교 편제표만 담겨요.</li>
          {features.userKey && (
            <li>
              편제표 자동 읽기·파일 읽기·문장으로 찾기는 학원 AI나 등록한 Google AI Studio(Gemini) API 키로 해요. 키는 암호화해 보관하고, 기능을 쓸 때만 보내요.
            </li>
          )}
          <li>
            학교 편제표를 자동으로 불러오면 서버에 남아 다른 사람도 쓸 수 있어요. 누가 불러왔는지는 공개하지 않아요.
          </li>
          {ai && <li>직접 올린 파일이나 적은 문장은 읽기 위해 외부 서비스로 보내고, 이 서버에는 저장하지 않아요.</li>}
          {ai && training && (
            <li>
              Google Gemini 무료 등급은 보낸 내용과 답을 제품 개선에 쓰고 검토자가 읽을 수 있어요. 개인정보는 적거나 올리지 마세요.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
