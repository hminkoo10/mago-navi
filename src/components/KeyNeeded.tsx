import { useApp } from '../lib/app'
import { Link } from './Link'

/**
 * 쓸 수 있는 AI가 없을 때 AI 기능 자리에 띄우는 등록·발급 안내.
 * 통합 클라우드 로그인이면 학원 AI나 내 Gemini API 키, 아니면 '사용자 키로 AI 쓰기'가 켜졌는데 내 키가 없을 때
 */
export function KeyNeeded({ what, other }: { what: string; other?: string }) {
  const { user } = useApp()
  const ai = user?.ai
  if (user?.magoRole === 'student') return (
    <div className="callout key-needed" role="status">
      <p>{ai?.message || (user.aiMode === 'teacher' ? '담당 선생님이 AI 키를 등록하지 않았어요' : '지금은 학원 AI를 쓸 수 없어요. 선생님께 알려 주세요.')}{other && ` ${other}`}</p>
    </div>
  )
  return (
    <div className="callout key-needed">
      <p>
        {ai?.source === 'own' ? (
          <>
            <strong>{what}</strong>는 내 Google AI Studio(Gemini) API 키로 하기로 골라 두었어요. 키를 내 계정에 등록하거나 내 계정에서 학원 AI로 바꿔 주세요.
          </>
        ) : ai ? (
          <>
            <strong>{what}</strong>는 학원 AI나 내 Google AI Studio(Gemini) API 키로 해요. 지금은 쓸 수 있는 학원 AI가 없어요. 원장님께 학원 AI를 정해
            달라고 하거나, 키를 내 계정에 등록하면 바로 쓸 수 있어요.
          </>
        ) : (
          <>
            <strong>{what}</strong>는 내 Google AI Studio(Gemini) API 키로 해요. 키를 내 계정에 등록하면 바로 쓸 수 있어요.
          </>
        )}
        {other && ` ${other}`}
      </p>
      <div className="row-btns">
        <Link to="/account#ai-key" className="btn btn-sm btn-primary">
          내 키 등록하기
        </Link>
        <Link to="/help/gemini-key" className="btn btn-sm">
          발급 방법
        </Link>
      </div>
    </div>
  )
}
