import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { useApp } from '../lib/app'
import { useLocation } from '../lib/router'
import { matchStudent, type Student } from '../lib/students'
import { IconPlus } from './icons'

// 학원 학생 고르기: 머리글의 '학생: 홍길동 ▾'과 학생을 고르기 전 설계 화면(StudentGate)이 함께 쓰는 목록.
// '내 담당'(담당 선생님이 나)이 있으면 그것부터 보이고, 이름·학교·학년으로 찾는다. 지운 학생은 숨긴다.

/** 학생 추가: 이름·학교·학년. 담당은 나. 추가하면 그 학생 설계를 연다 */
function AddStudent({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { students, store, notify } = useApp()
  const [name, setName] = useState('')
  const [school, setSchool] = useState('')
  const [grade, setGrade] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('학생 이름을 적어 주세요.')
    setBusy(true)
    setError('')
    try {
      // 지금 학생 설계에 못 올린 것을 먼저 올린다 (못 올려도 이 기기에 남아 다음에 열 때 올림)
      await store.flushSync()
      const s = await students.add({ name: name.trim(), school: school.trim(), grade: grade.trim() })
      notify(`${s.name} 학생을 추가하고 설계를 열었어요.`)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '학생을 추가하지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <form className="stu-add" onSubmit={(e) => void submit(e)}>
      <strong>학생 추가</strong>
      <label className="fieldset">
        <span>이름</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 홍길동" autoFocus />
      </label>
      <div className="stu-add-row">
        <label className="fieldset">
          <span>학교</span>
          <input className="input" value={school} onChange={(e) => setSchool(e.target.value)} maxLength={40} placeholder="예: 마고고" />
        </label>
        <label className="fieldset">
          <span>학년</span>
          <input className="input" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={10} placeholder="예: 고1" />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine">담당 선생님은 나로 정해요. 통합 클라우드의 학생 명단에도 함께 추가돼요.</p>
      <div className="row-btns">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? '추가하는 중' : '추가하고 열기'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          취소
        </button>
      </div>
    </form>
  )
}

/** 학생 목록: 내 담당·전체, 찾기, 추가. 고르면 그 학생 설계를 연다 */
export function StudentList({ onPicked }: { onPicked?: () => void }) {
  const { students, user, store, notify } = useApp()
  const { list, current, error, purgeDays } = students
  const me = user?.cloudId ?? ''
  const alive = useMemo(() => (list ?? []).filter((s) => !s.deletedAt), [list])
  const mine = useMemo(() => alive.filter((s) => !!me && s.teacher?.id === me), [alive, me])
  const [tab, setTab] = useState<'mine' | 'all' | null>(null)
  const shown = tab ?? (mine.length ? 'mine' : 'all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const rows = (shown === 'mine' ? mine : alive).filter((s) => matchStudent(s, q))
  const hidden = (list?.length ?? 0) - alive.length

  const open = async (s: Student) => {
    if (s.id !== current?.id) {
      // 지금 학생 설계에 못 올린 것을 먼저 올린다 (못 올려도 이 기기에 남아 다음에 열 때 올림)
      await store.flushSync()
      students.pick(s.id)
      notify(`${s.name} 학생 설계를 열었어요.`)
    }
    onPicked?.()
  }

  if (user?.magoRole === 'student') return null
  if (adding) return <AddStudent onDone={() => onPicked?.()} onCancel={() => setAdding(false)} />

  return (
    <div className="stu-list">
      <div className="stu-tools">
        <div className="seg" role="tablist" aria-label="학생 범위">
          <button type="button" role="tab" aria-selected={shown === 'mine'} className={shown === 'mine' ? 'is-on' : ''} onClick={() => setTab('mine')}>
            내 담당 {mine.length}
          </button>
          <button type="button" role="tab" aria-selected={shown === 'all'} className={shown === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>
            전체 {alive.length}
          </button>
        </div>
        <input className="input stu-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·학교·학년으로 찾기" aria-label="학생 찾기" />
      </div>
      {error && !list ? (
        <div className="stu-empty" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-sm" onClick={() => void students.reload()}>
            다시 받기
          </button>
        </div>
      ) : !list ? (
        <p className="stu-empty muted" aria-busy="true">
          학생 명단을 받는 중이에요.
        </p>
      ) : rows.length ? (
        <ul className="stu-rows">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" className={`stu-row${s.id === current?.id ? ' is-on' : ''}`} aria-current={s.id === current?.id ? 'true' : undefined} onClick={() => void open(s)}>
                <strong>{s.name}</strong>
                <span className="muted">{[s.school, s.grade, s.teacher ? `담당 ${s.teacher.name}` : '담당 없음'].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stu-empty muted">
          {q.trim() ? '찾는 학생이 없어요.' : shown === 'mine' ? '내가 담당하는 학생이 없어요. 전체에서 골라 주세요.' : '아직 학생이 없어요. 학생을 추가해 주세요.'}
        </p>
      )}
      {hidden > 0 && <p className="fine">지운 학생 {hidden}명은 목록에서 숨겼어요. 지운 뒤 {purgeDays}일 안에는 통합 클라우드의 학생 명단에서 되살릴 수 있어요.</p>}
      <button type="button" className="btn btn-sm stu-add-btn" onClick={() => setAdding(true)}>
        <IconPlus /> 학생 추가
      </button>
    </div>
  )
}

/** 머리글의 학생 고르기 (학원 사람만) */
export function StudentPicker() {
  const { students, user } = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { path } = useLocation()

  // 다른 곳을 누르거나 Esc면 닫음
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 페이지를 옮기면 닫음
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    setLastPath(path)
    setOpen(false)
  }

  if (!students.active || user?.magoRole === 'student') return null
  const { current } = students
  return (
    <div className="stu" ref={box}>
      <button
        type="button"
        className="stu-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={current ? `학생: ${current.name} (바꾸기)` : '학생 고르기'}
        onClick={() => {
          // 열 때마다 새로 받는다 (다른 선생님이 추가·지웠을 수 있음)
          if (!open) void students.reload()
          setOpen(!open)
        }}
      >
        <span className="stu-btn-label">학생</span>
        <span className="stu-btn-name">{current ? current.name : '고르기'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="stu-menu" role="dialog" aria-label="학생 고르기">
          <StudentList onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
