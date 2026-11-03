import { describe, expect, it } from 'vitest'
import { designChanges } from './design-log'

const base = () => ({
  prefs: {
    schoolId: 's1',
    majors: ['cs-software'],
    univs: ['korea'],
    unitIds: null,
    pinned: ['확률과 통계'],
    excluded: [] as string[],
    focus: '종합',
    keepAll: false,
    slot: 'a',
    picks: [] as string[],
    profile: { status: '재학생', schoolType: '', region: '', special: [], types: [] as string[] },
  },
  schools: [{ id: 's1', name: '반송고등학교', terms: [{ id: '2-1', fixed: [] }], tracks: [] }] as Record<string, unknown>[],
  plans: [{ id: 'a', name: '슬롯 1' }] as { id: string; name: string }[],
})
const lines = (before: unknown, after: unknown) => designChanges(before, after).map((c) => `${c.action} [${c.target}] ${c.detail}`)

describe('사용자 로그: 설계에서 한 일', () => {
  it('지금 슬롯에서 바꾼 것을 한 줄씩, 이름으로 남긴다', () => {
    const a = base()
    const b = base()
    b.prefs.majors = ['cs-software', 'edu-computer']
    b.prefs.univs = []
    b.prefs.pinned = []
    b.prefs.excluded = ['미적분Ⅱ']
    b.prefs.unitIds = ['u1', 'u2'] as never
    b.prefs.focus = '정시'
    b.prefs.keepAll = true
    expect(lines(a, b)).toEqual([
      'design.majors [슬롯 1] + 컴퓨터교육',
      'design.univs [슬롯 1] - 고려대',
      'design.units [슬롯 1] 학과 2곳만 고름',
      'design.pin [슬롯 1] - 확률과 통계',
      'design.exclude [슬롯 1] + 미적분Ⅱ',
      'design.focus [슬롯 1] 종합 → 정시',
      'design.keepAll [슬롯 1] 켬',
    ])
    // 같은 내용이면 아무것도 남기지 않는다
    expect(lines(a, base())).toEqual([])
  })

  it('슬롯을 만들거나 열면 그 슬롯의 설계로 바뀐 것은 따로 남기지 않는다', () => {
    const a = base()
    const b = base()
    b.plans = [
      { id: 'a', name: '정시 준비' },
      { id: 'b', name: '공유받은 설계' },
    ]
    b.prefs.slot = 'b'
    b.prefs.majors = ['med']
    expect(lines(a, b)).toEqual(["design.slot [공유받은 설계] 새 슬롯 '공유받은 설계'", "design.slot [정시 준비] 이름 '슬롯 1' → '정시 준비'"])
    // 있던 슬롯을 열면 '슬롯 열기'만
    const c = { ...b, prefs: { ...b.prefs, slot: 'a', majors: ['cs-software'] } }
    expect(lines(b, c)).toEqual(["design.slot [정시 준비] 슬롯 열기 '정시 준비'"])
    const d = { ...c, plans: [{ id: 'a', name: '정시 준비' }] }
    expect(lines(c, d)).toEqual(["design.slot [공유받은 설계] 슬롯 지움 '공유받은 설계'"])
  })

  it('학교 고르기·편제표 저장·원서 후보·내 조건', () => {
    const a = base()
    const b = base()
    b.schools = [...a.schools, { id: 's2', name: '한국디지털미디어고등학교', terms: [], tracks: [] }]
    b.prefs.schoolId = 's2'
    b.prefs.picks = ['korea:school-rec']
    b.prefs.profile = { ...b.prefs.profile, status: '졸업생', region: '경기', types: ['학생부종합'] }
    // 학교를 고르며 함께 저장한 편제표는 '학교 고르기' 줄로 충분하다
    expect(lines(a, b)).toEqual([
      'design.school [슬롯 1] 반송고등학교 → 한국디지털미디어고등학교',
      // 전형 이름(기회균형 같은 자격)은 남기지 않고 개수와 대학만
      'design.picks [원서 후보] 0개 → 1개 (+ 고려대)',
      'design.profile [내 조건] 졸업생 · 지역 경기 · 관심 전형 + 학생부종합',
    ])
    // 편제표를 직접 고치거나 지우면
    const c = { ...b, schools: [{ ...b.schools[0], terms: [{ id: '2-1', fixed: [{ subject: '문학', credits: 4 }] }] }, b.schools[1]] }
    expect(lines(b, c)).toEqual(['design.curriculum [반송고등학교] 편제표 고침'])
    expect(lines(c, { ...c, schools: [c.schools[1]] })).toEqual(['design.curriculum [반송고등학교] 편제표 지움'])
    // 이름·출처 같은 꼬리표나 칸 id만 바뀐 것은 고친 것이 아니다 (화면이 편제표를 정리할 때)
    expect(lines(b, { ...b, schools: [{ ...b.schools[0], shared: { id: 3 } }, b.schools[1]] })).toEqual([])
    const tidy = (s: Record<string, unknown>) => ({
      ...s,
      terms: [
        { id: '1-1', fixed: [], groups: [] },
        { fixed: [], id: '2-1', groups: [] },
      ],
      source: { title: '', url: '' },
    })
    expect(lines(b, { ...b, schools: [tidy(b.schools[0]), b.schools[1]] })).toEqual([])
  })

  it('모양이 틀린 값에도 멈추지 않는다', () => {
    expect(lines(null, null)).toEqual([])
    expect(lines({ prefs: 3, plans: 'x' }, { prefs: { majors: [1, null, 'cs-software'] }, schools: [null] })).toEqual(['design.majors [설계] + 소프트웨어'])
  })
})
