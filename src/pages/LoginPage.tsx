import { Link } from '../components/Link'
import { magoLoginUrl } from '../lib/api'
import { safeNext, useApp } from '../lib/app'
import { useLocation } from '../lib/router'

/** 서버가 통합 클라우드 로그인을 마치지 못하고 돌려보낼 때 붙이는 error 코드 → 안내 */
const ERRORS: Record<string, string> = {
  unavailable: '지금은 로그인을 쓸 수 없어요. 서버에 통합 클라우드 로그인이 아직 설정되지 않았어요. 학원 원장님이나 관리자에게 알려 주세요.',
  busy: '로그인 요청이 너무 많아요. 잠시 후 다시 해 주세요.',
  expired: '로그인 시간이 지났거나 다른 창에서 시작한 로그인이에요. 다시 해 주세요.',
  denied: '통합 클라우드에서 이 프로그램을 쓸 권한을 받지 못했어요. 원장님이나 관리자에게 문의해 주세요.',
  failed: '통합 클라우드 로그인을 마치지 못했어요. 잠시 후 다시 해 주세요.',
  disabled: '이용이 정지된 계정이에요. 관리자에게 문의해 주세요.',
  closed: '지금은 처음 쓰는 계정을 받지 않아요. 이미 쓰던 계정만 로그인할 수 있어요.',
}

export function LoginPage() {
  const { user, features, store } = useApp()
  const { query } = useLocation()
  const next = safeNext(query.get('next'))
  // 주소에서 온 값이라 hasOwn으로만 찾음 (__proto__ 같은 상속 속성 방지)
  const code = query.get('error') ?? ''
  const error = Object.hasOwn(ERRORS, code) ? ERRORS[code] : ''

  if (!features.server)
    return (
      <div className="wrap gate">
        <h1 className="page-title">로그인을 쓸 수 없어요</h1>
        <p className="page-sub">이 주소에서는 서버 기능이 꺼져 있어요. 학원 원장님이나 관리자에게 알려 주세요. 고른 내용은 이 기기에 저장돼요.</p>
      </div>
    )

  if (user)
    return (
      <div className="wrap auth">
        <div className="auth-card">
          <h1 className="auth-title">이미 로그인했어요</h1>
          <p className="auth-sub">
            {user.name ? `${user.name}(${user.email})` : user.email} 계정으로 로그인돼 있어요.
          </p>
          <div className="auth-actions">
            <Link to={next ?? '/'} className="btn btn-primary btn-lg btn-block">
              계속하기
            </Link>
            <Link to="/account" className="btn btn-lg btn-block">
              내 계정
            </Link>
          </div>
        </div>
      </div>
    )

  return (
    <div className="wrap auth">
      <div className="auth-card">
        <h1 className="auth-title">로그인</h1>
        <p className="auth-sub">
          마고 과목내비는 마고에듀 통합 클라우드 계정으로 로그인해 써요. 학원 학생 명단을 함께 쓰고, 학생마다 과목 설계를 저장해 다른 기기에서도 이어서 볼 수
          있어요.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {features.login ? (
          // 화면 이동이라 보통 링크. 서버가 통합 클라우드로 보냈다가 next로 돌려보냄
          <a href={magoLoginUrl(next ?? (store.school ? '/plan' : '/'))} className="btn btn-primary btn-lg btn-block">
            마고에듀 통합 클라우드 계정으로 로그인
          </a>
        ) : (
          <p className="callout is-warn">{ERRORS.unavailable}</p>
        )}
        <div className="auth-foot">
          <p className="muted">계정은 통합 클라우드에서 만들어요. 계정이 없으면 원장님께 만들어 달라고 해 주세요. 이 프로그램은 비밀번호를 받지 않아요.</p>
          <p className="muted">
            로그인·설계 저장·편제표 읽기 같은 이용 기록을 남겨요. 자세한 것은 <Link to="/help#privacy">개인정보 안내</Link>에 있어요.
          </p>
        </div>
      </div>
    </div>
  )
}
