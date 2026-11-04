import { useState } from 'react'
import { ApiError } from '../lib/api'
import { useApp } from '../lib/app'
import { StudentList } from './StudentPicker'
import { AcademyRosterPicker } from './AcademyRosterPicker'

/** 학원 사람이 학생을 고르기 전: 설계 화면 자리에 학생 목록을 보인다 */
export function StudentGate() {
  const { user, students } = useApp()
  if (user?.magoRole === 'student') return (
    <div className="wrap stu-gate" role={students.error ? 'alert' : 'status'}>
      <h1 className="page-title">내 설계를 여는 중이에요</h1>
      <p className="page-sub">{students.error || '내 학생 정보를 확인하고 있어요.'}</p>
      {students.error && <button type="button" className="btn" onClick={() => void students.reload()}>다시 받기</button>}
    </div>
  )
  return (
    <div className="wrap stu-gate">
      <h1 className="page-title">어느 학생의 설계를 열까요?</h1>
      <p className="page-sub">
        {user?.academy?.name ? `${user.academy.name}의 ` : ''}학생마다 설계를 따로 저장해요. 같은 학원 선생님은 누구나 함께 보고 고칠 수 있어요.
        {students.list && !students.list.length && !students.roster?.students.length ? ' 먼저 학생을 추가해 주세요.' : ''}
      </p>
      <div className="panel-card">
        {students.roster ? <AcademyRosterPicker /> : <StudentList />}
      </div>
    </div>
  )
}

/** 지금 연 학생을 누가 지웠을 때: 설계는 보기만 하고, 되살리면 다시 고칠 수 있다 */
export function DeletedStudentBar() {
  const { students, notify, user } = useApp()
  const [busy, setBusy] = useState(false)
  const s = students.current
  if (!s?.deletedAt || user?.magoRole === 'student') return null

  const restore = async () => {
    setBusy(true)
    try {
      await students.restore(s.id)
      notify(`${s.name} 학생을 되살렸어요. 이제 설계를 고칠 수 있어요.`)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '학생을 되살리지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap stu-bar no-print">
      <div className="callout is-warn" role="status">
        <p>
          <strong>{s.name}</strong> 학생은 명단에서 지운 학생이에요. 설계를 볼 수만 있고, 여기서 고친 내용은 저장되지 않아요. 되살리면 다시 고칠 수
          있어요.
        </p>
        <div className="row-btns">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void restore()}>
            {busy ? '되살리는 중' : '되살리기'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => students.pick(null)}>
            다른 학생 고르기
          </button>
        </div>
      </div>
    </div>
  )
}
