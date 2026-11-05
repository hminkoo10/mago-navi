import { useState } from 'react'
import { useApp } from '../lib/app'
import type { RosterStudent } from '../lib/academy-roster'

/** 새 학생을 만드는 대신 기존 학생 ID의 설계를 연다. 명단에는 아무것도 쓰지 않는다. */
export function AcademyRosterPicker({ onSelected, disabled = false }: { onSelected?: (s: RosterStudent) => void; disabled?: boolean }) {
  const { students, store } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const roster = students.roster
  if (!roster) return null
  const current = roster.students.find((s) => s.id === students.current?.id)
  const rows = roster.students.filter((s) => s.name.includes(q.trim())).slice(0, 100)
  const pick = async (s: RosterStudent) => {
    setBusy(true)
    setError('')
    try {
      if (s.id !== students.current?.id) {
        await store.flushSync()
        students.pick(s.id)
      } else onSelected?.(s)
      setOpen(false)
    } catch {
      setError('학생 설계를 전환하지 못했어요. 다시 고르세요.')
    } finally { setBusy(false) }
  }
  return (
    <section className="field-block" aria-label="학원 학생 정보">
      {roster.me.role !== 'student' && (
        <button type="button" className="btn btn-sm" aria-expanded={open} disabled={disabled || busy} onClick={() => setOpen(!open)}>
          학원 명단에서 고르기
        </button>
      )}
      {current && <p className="hint" role="status">이름: {current.name} · 학교: {current.school || '미입력'} · 학년: {current.grade || '미입력'}</p>}
      {open && roster.me.role !== 'student' && (
        <div className="stu-list">
          <input className="input stu-search" type="search" aria-label="학원 명단 이름 검색" placeholder="학생 이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
          <ul className="stu-rows">
            {rows.map((s) => <li key={s.id}><button type="button" className="stu-row" disabled={busy || disabled} onClick={() => void pick(s)}>
              <strong>{s.name}</strong><span className="muted">{[s.school, s.grade].filter(Boolean).join(' · ') || '학교·학년 미입력'}</span>
            </button></li>)}
          </ul>
          {!rows.length && <p className="hint">찾는 학생이 없어요.</p>}
          {rows.length === 100 && <p className="fine">최대 100명이에요. 이름을 더 적어 보세요.</p>}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  )
}
