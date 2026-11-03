import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type Me, NO_FEATURES } from '../lib/api'
import { AppContext, type AppCtx } from '../lib/app'
import { useStudents } from '../lib/students'
import { AccountPage } from '../pages/AccountPage'
import { KeyNeeded } from './KeyNeeded'
import { Footer } from './Shell'
import { StudentGate } from './StudentGate'
import { StudentList, StudentPicker } from './StudentPicker'

const STUDENT: Me = {
  id: 1, email: 'student1', name: '홍학생', role: 'user', magoRole: 'student', createdAt: '2026-11-03T00:00:00Z',
  academy: { id: 7, name: '마고학원' }, student: { id: 'stu-1000', name: '홍학생', teacherUid: 'teacher-1', teacherName: '김선생' }, aiMode: 'teacher',
  ai: { source: 'teacher', academy: { state: 'none', provider: '', model: '' }, fallback: false, ready: false, message: '담당 선생님이 AI 키를 등록하지 않았어요' },
}

function WithStudent({ user = STUDENT, children }: { user?: Me; children: ReactNode }) {
  const students = useStudents(user)
  const context: AppCtx = {
    user, students, authReady: true, features: { ...NO_FEATURES, server: true, userKey: true },
    setUser: () => {}, signOut: async () => {}, notify: () => {},
    store: { sync: 'saved', school: null, schools: [], slots: [], prefs: { majors: [], univs: [] } } as unknown as AppCtx['store'],
  }
  return <AppContext.Provider value={context}>{children}</AppContext.Provider>
}

describe('학생 전용 화면', () => {
  it('명단을 받기 전에도 본인 학생 설계로 바로 들어간다', () => {
    function Current() {
      const s = useStudents(STUDENT)
      return <p>{s.active ? s.current?.id : '개인 설계'} · {s.current?.name}</p>
    }
    expect(renderToStaticMarkup(<Current />)).toContain('stu-1000 · 홍학생')
  })

  it('학생 고르기·명단·추가 버튼을 그리지 않는다', () => {
    expect(renderToStaticMarkup(<WithStudent><StudentPicker /><StudentList /></WithStudent>)).toBe('')
  })

  it('학생 정보가 없으면 학생 선택 화면 대신 확인 안내를 보인다', () => {
    const html = renderToStaticMarkup(<WithStudent user={{ ...STUDENT, student: null }}><StudentGate /></WithStudent>)
    expect(html).toContain('내 학생 정보를 확인하고 있어요')
    expect(html).not.toContain('어느 학생')
    expect(html).not.toContain('학생 추가')
  })

  it('담당 키가 없으면 안내만 보이고 학생의 키 등록·발급 링크는 없다', () => {
    const html = renderToStaticMarkup(<WithStudent><KeyNeeded what="파일 읽기" /></WithStudent>)
    expect(html).toContain('담당 선생님이 AI 키를 등록하지 않았어요')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('내 키 등록')
  })

  it('내 계정에서는 AI 상태만 보이고 선택·키 입력·관리 화면을 숨긴다', () => {
    const html = renderToStaticMarkup(<WithStudent user={{ ...STUDENT, role: 'owner' }}><AccountPage /><Footer /></WithStudent>)
    expect(html).toContain('담당 선생님의 AI 키로 이용해요')
    expect(html).toContain('담당 선생님이 AI 키를 등록하지 않았어요')
    expect(html).not.toContain('radiogroup')
    expect(html).not.toContain('type="password"')
    expect(html).not.toContain('/admin')
    expect(html).not.toContain('/help/gemini-key')
    expect(html).not.toContain('학생 고르기')
  })

  it('학원 AI 학생은 선생님께 알리는 안내, 선생님은 기존 키 등록 화면을 유지한다', () => {
    const student = renderToStaticMarkup(<WithStudent user={{ ...STUDENT, aiMode: 'academy', ai: null }}><KeyNeeded what="파일 읽기" /></WithStudent>)
    expect(student).toContain('지금은 학원 AI를 쓸 수 없어요. 선생님께 알려 주세요.')
    const teacher = renderToStaticMarkup(<WithStudent user={{ ...STUDENT, magoRole: 'teacher', student: null, ai: null }}><AccountPage /><StudentPicker /></WithStudent>)
    expect(teacher).toContain('type="password"')
    expect(teacher).toContain('학생 고르기')
  })
})
