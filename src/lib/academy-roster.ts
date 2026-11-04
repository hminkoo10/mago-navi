import { useEffect, useState } from 'react'
import type { Me } from './api'

export interface RosterStudent { id: string; name: string; school: string; grade: string; schoolOffice?: string; schoolCode?: string }
export interface AcademyRoster {
  academy: { id: number; name: string }
  me: { id: string; name: string; role: string }
  students: RosterStudent[]
}

declare global {
  interface Window {
    magoNaviRoster?: {
      get: () => Promise<AcademyRoster | null>
      onChanged: (callback: () => void) => () => void
    }
  }
}

/** PC 실행 계정과 웹 로그인 계정이 같아야 한다. 학생은 기존 SSO의 student.id로만 연결한다. */
export function rosterForUser(roster: AcademyRoster | null, user: Me | null): AcademyRoster | null {
  if (!roster || !user?.cloudId || roster.me.id !== user.cloudId || roster.me.role !== user.magoRole || roster.academy.id !== user.academy?.id) return null
  if (roster.me.role !== 'student') return roster
  const self = roster.students.filter((s) => s.id === user.student?.id)
  return self.length === 1 ? { ...roster, students: self } : null
}

export function useAcademyRoster(user: Me | null): AcademyRoster | null {
  const [roster, setRoster] = useState<AcademyRoster | null>(null)
  const cloudId = user?.cloudId
  const academyId = user?.academy?.id
  useEffect(() => {
    const bridge = window.magoNaviRoster
    if (!bridge || !cloudId || !academyId) return
    let alive = true
    let seq = 0
    const refresh = () => {
      const n = ++seq
      void bridge.get().then((r) => { if (alive && n === seq) setRoster(r) }, () => { if (alive && n === seq) setRoster(null) })
    }
    const stop = bridge.onChanged(refresh)
    refresh()
    return () => { alive = false; stop() }
  }, [cloudId, academyId])
  return rosterForUser(roster, user)
}

/** 공백과 끝의 '고등학교'/'고'만 통일. 지역·여자·부설 등은 지우지 않는다. */
export const normalizeSchoolName = (name: string) => name.normalize('NFC').replace(/\s+/gu, '').replace(/고등학교$/, '고')

/** 코드 쌍이 일치하는 한 건을 우선하고, 없으면 완전한 목록에서 이름을 비교한다. */
export function matchRosterSchool<T extends { name: string; office?: string; code?: string }>(
  name: string, schools: T[], complete = true, codes?: Pick<RosterStudent, 'schoolOffice' | 'schoolCode'>,
): T | null {
  if (codes?.schoolOffice && codes.schoolCode) {
    const matches = schools.filter((s) => s.office === codes.schoolOffice && s.code === codes.schoolCode)
    if (matches.length) return matches.length === 1 ? matches[0] : null
  }
  const key = normalizeSchoolName(name)
  if (!key || !complete) return null
  const matches = schools.filter((s) => normalizeSchoolName(s.name) === key)
  return matches.length === 1 ? matches[0] : null
}

/** 자유 입력 학년은 명확한 고1~고3만. 숫자/1학년은 고교 이름이 명확할 때만 해석한다. */
export function rosterCohort(student: Pick<RosterStudent, 'school' | 'grade'>, now = new Date()): number | null {
  const grade = student.grade.replace(/\s+/gu, '')
  const explicit = /^(?:고|고등학교)([1-3])(?:학년)?$/.exec(grade)
  const plain = /(?:고등학교|고)$/.test(normalizeSchoolName(student.school)) ? /^([1-3])(?:학년)?$/.exec(grade) : null
  const n = explicit?.[1] ?? plain?.[1]
  if (!n) return null
  const kst = new Date(now.getTime() + 9 * 3600000)
  const year = kst.getUTCFullYear() - (kst.getUTCMonth() < 2 ? 1 : 0)
  return year - Number(n) + 1
}
