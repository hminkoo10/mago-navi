import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppContext, type AppCtx } from '../lib/app'
import { AcademyRosterPicker } from './AcademyRosterPicker'
import { rosterForUser, type AcademyRoster } from '../lib/academy-roster'

const student = { id: 'student-1', name: '홍학생', school: '반송고', grade: '고2' }
const roster: AcademyRoster = { academy: { id: 7, name: '마고학원' }, me: { id: 'teacher-1', name: '선생님', role: 'teacher' }, students: [student] }
function render(value: AcademyRoster | null) {
  const context = { students: { roster: value, current: student }, store: {} } as unknown as AppCtx
  return renderToStaticMarkup(<AppContext.Provider value={context}><AcademyRosterPicker /></AppContext.Provider>)
}

describe('PC 명단 UI', () => {
  it('웹·학원 밖·누락된 명단은 UI가 바뀌지 않는다', () => expect(render(null)).toBe(''))
  it('선생님은 명단 선택과 이름·학교·학년을 볼 수 있다', () => {
    const html = render(roster)
    expect(html).toContain('학원 명단에서 고르기')
    for (const value of [student.name, student.school, student.grade]) expect(html).toContain(value)
    expect(html).not.toContain('학생 추가')
  })
  it('학생 본인은 정보만 보이고 다른 학생 고르기는 없다', () => {
    const html = render({ ...roster, me: { ...roster.me, role: 'student' } })
    expect(html).toContain(student.name)
    expect(html).not.toContain('학원 명단에서 고르기')
  })
  it('웹 로그인과 다른 계정의 PC 명단은 표시하지 않는다', () => expect(render(rosterForUser(roster, null))).toBe(''))
})
