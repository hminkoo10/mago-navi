import { describe, expect, it } from 'vitest'
import { matchRosterSchool, normalizeSchoolName, rosterCohort, rosterForUser, type AcademyRoster } from './academy-roster'
import type { Me } from './api'

describe('학교명 매칭', () => {
  const school = { name: '반송고등학교', code: '7530847' }
  it('공백·고/고등학교 차이만 무시한다', () => {
    expect(matchRosterSchool(' 반 송 고 ', [school])).toBe(school)
    expect(normalizeSchoolName('반송고등학교'.normalize('NFD'))).toBe('반송고')
  })
  it('다른 지역의 동명 학교·부분일치·누락은 고르지 않는다', () => {
    expect(matchRosterSchool('반송고', [school, { ...school, code: 'other' }])).toBeNull()
    expect(matchRosterSchool('반송', [school])).toBeNull()
    expect(matchRosterSchool('', [school])).toBeNull()
    expect(matchRosterSchool('서울고', [school])).toBeNull()
    expect(matchRosterSchool('반송여자고', [school])).toBeNull()
    expect(matchRosterSchool('반송고(서울)', [school])).toBeNull()
    expect(matchRosterSchool('반송고', [school], false)).toBeNull() // 잘린 목록은 유일성을 보장하지 않음
  })
  it('같은 학교여도 편제표가 여러 개면 임의 선택하지 않는다', () => {
    expect(matchRosterSchool('반송고', [{ ...school, cohort: 2025 }, { ...school, cohort: 2026 }])).toBeNull()
  })
})

describe('학교 코드 매칭', () => {
  const school = { name: '반송고등학교', office: 'J10', code: '7530847' }
  const codes = { schoolOffice: school.office, schoolCode: school.code }
  it('동명 학교 중 교육청·학교 코드가 모두 같은 학교를 고른다', () => {
    const hits = [{ ...school, office: 'B10' }, { ...school, code: '7530848' }, school]
    expect(matchRosterSchool('반송고', hits, true, codes)).toBe(school)
  })
  it('이름보다 코드를 우선한다', () => {
    const renamed = { ...school, name: '새이름고등학교' }
    expect(matchRosterSchool('반송고', [{ ...school, code: '7530848' }, renamed], true, codes)).toBe(renamed)
  })
  it('검색 결과가 잘려도 코드가 같으면 고를 수 있다', () => {
    const hits = [0, 1, 2, 3].map((n) => ({ ...school, code: `753084${n}` }))
    expect(matchRosterSchool('반송고', [...hits, school], false, codes)).toBe(school)
  })
  it.each([{ schoolOffice: 'B10', schoolCode: school.code }, { schoolOffice: school.office, schoolCode: '7530848' }])(
    '교육청·학교 코드 중 하나만 같으면 코드 일치로 보지 않는다: %j', (other) => {
      expect(matchRosterSchool('다른고', [school], true, other)).toBeNull()
    },
  )
  it('코드 일치가 없으면 기존의 유일한 정규화 이름 매칭으로 돌아간다', () => {
    expect(matchRosterSchool(' 반 송 고 ', [school], true, { ...codes, schoolCode: '7530848' })).toBe(school)
  })
  it.each([{ schoolOffice: school.office }, { schoolCode: school.code }])('코드 쌍이 없으면 이름으로만 고른다: %j', (partial) => {
    expect(matchRosterSchool('반송고', [school], true, partial)).toBe(school)
    expect(matchRosterSchool('다른고', [school], true, partial)).toBeNull()
  })
  it('코드 일치도 없고 이름도 모호하거나 검색이 불완전하면 수동 선택한다', () => {
    const missing = { ...codes, schoolCode: '7530848' }
    expect(matchRosterSchool('반송고', [school, { ...school, office: 'B10' }], true, missing)).toBeNull()
    expect(matchRosterSchool('반송', [school], true, missing)).toBeNull()
    expect(matchRosterSchool('반송고', [], true, missing)).toBeNull()
    expect(matchRosterSchool('반송고', [school], false, missing)).toBeNull()
  })
  it('코드가 같은 결과도 여러 개면 임의로 고르지 않는다', () => {
    expect(matchRosterSchool('반송고', [school, { ...school, name: '새이름고등학교' }], true, codes)).toBeNull()
  })
})

describe('학년 → 입학년도', () => {
  const now = new Date('2026-11-04T00:00:00Z')
  it.each(['고2', '고 2 학년', '고등학교2학년', '2학년', '2'])('%s 해석', (grade) => {
    expect(rosterCohort({ school: '반송고등학교', grade }, now)).toBe(2025)
  })
  it.each(['', '중1', '초3', '4', '졸업', '예비고1', '1반'])('%s 추정하지 않음', (grade) => {
    expect(rosterCohort({ school: '반송고', grade }, now)).toBeNull()
  })
  it('고교인지 모르는 1학년은 추정하지 않는다', () => {
    expect(rosterCohort({ school: '반송', grade: '1학년' }, now)).toBeNull()
  })
  it('한국 시간 3월 1일 학년도 경계·고3도 처리한다', () => {
    const s = { school: '반송고', grade: '고3' }
    expect(rosterCohort(s, new Date('2026-02-28T14:59:59Z'))).toBe(2023)
    expect(rosterCohort(s, new Date('2026-02-28T15:00:00Z'))).toBe(2024)
  })
})

const me: Me = { id: 1, email: 'student', name: '홍학생', role: 'user', createdAt: '', cloudId: 'user-1', magoRole: 'student',
  academy: { id: 7, name: '학원' }, student: { id: 'student-1', name: '홍학생', teacherUid: null, teacherName: '' } }
const roster: AcademyRoster = { academy: { id: 7, name: '학원' }, me: { id: 'user-1', name: '홍학생', role: 'student' },
  students: [{ id: 'student-1', name: '홍학생', school: '반송고', grade: '고1' }, { id: 'other', name: '홍학생', school: '', grade: '' }] }
it('학생 본인 확인은 계정·학원·역할과 SSO student.id 모두 일치해야 한다', () => {
  expect(rosterForUser(roster, me)?.students).toEqual([roster.students[0]])
  expect(rosterForUser(roster, { ...me, student: null })).toBeNull()
  expect(rosterForUser(roster, { ...me, cloudId: 'other' })).toBeNull()
  expect(rosterForUser(roster, { ...me, magoRole: 'teacher' })).toBeNull()
  expect(rosterForUser(roster, { ...me, academy: { id: 8, name: '학원' } })).toBeNull()
  expect(rosterForUser(roster, null)).toBeNull()
  expect(rosterForUser(null, me)).toBeNull()
  expect(rosterForUser({ ...roster, students: [roster.students[0], roster.students[0]] }, me)).toBeNull()
})
