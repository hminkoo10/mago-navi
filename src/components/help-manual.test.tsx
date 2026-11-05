import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { EMPTY_PROFILE } from '../engine/admissions'
import { NO_FEATURES } from '../lib/api'
import { AppContext, type AppCtx } from '../lib/app'
import { HelpPage } from '../pages/HelpPage'
import { StartPage } from '../pages/StartPage'
import { Footer } from './Shell'

const route = vi.hoisted(() => ({ query: '' }))
vi.mock('../lib/router', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/router')>(),
  useLocation: () => ({ path: '/start', query: new URLSearchParams(route.query) }),
}))
afterEach(() => { route.query = '' })

function render(children: ReactNode, options: { cloudUrl?: string; school?: boolean; majors?: string[]; univs?: string[] } = {}) {
  const context = {
    user: null,
    features: { ...NO_FEATURES, cloudUrl: options.cloudUrl ?? NO_FEATURES.cloudUrl },
    students: { roster: null, current: null },
    store: {
      school: options.school ? BANSONG_2026 : null,
      schools: [BANSONG_2026],
      slots: [],
      prefs: { majors: options.majors ?? [], univs: options.univs ?? [], profile: EMPTY_PROFILE },
    },
  } as unknown as AppCtx
  return renderToStaticMarkup(<AppContext.Provider value={context}>{children}</AppContext.Provider>)
}

describe('통합 설명서 연결', () => {
  it.each(['https://mago.milky.kr', 'http://cloud.example.com:3000'])('도움말·바닥글에서 %s 설명서를 새 탭으로 연다', (cloudUrl) => {
    const html = render(<><HelpPage /><Footer /></>, { cloudUrl })
    const navi = `href="${cloudUrl}/help/navi.html" target="_blank" rel="noopener noreferrer"`
    expect(html.split(navi)).toHaveLength(3)
    expect(html).toContain(`href="${cloudUrl}/help/" target="_blank" rel="noopener noreferrer"`)
    expect(html.indexOf('처음이라면 사용 설명서부터 확인하세요')).toBeLessThan(html.indexOf('aria-label="목차"'))
    expect(html).toContain('과목내비 사용 설명서 열기')
    expect(html).toContain('자주 묻는 질문')
  })
})

describe('시작 단계의 다음 안내', () => {
  it.each([
    { step: 'school', school: false, majors: [], univs: [], hint: '학교를 먼저 고르세요' },
    { step: 'major', school: true, majors: [], univs: [], hint: '분야를 하나 이상 고르세요' },
    { step: 'univ', school: true, majors: ['cs'], univs: [], hint: '대학을 하나 이상 고르세요' },
  ])('$step 단계에서 먼저 해야 할 일을 버튼과 연결해 보여 준다', ({ step, hint, ...options }) => {
    route.query = `step=${step}`
    const html = render(<StartPage />, options)
    expect(html).toContain('disabled="" aria-describedby="start-next-hint"')
    expect(html).toContain(`id="start-next-hint" class="muted small">${hint}</p>`)
  })

  it('앞 단계를 안 마치고 대학 주소로 와도 학교 선택부터 안내한다', () => {
    route.query = 'step=univ'
    expect(render(<StartPage />)).toContain('학교를 먼저 고르세요')
  })

  it('학교를 골랐으면 다음 버튼을 켜고 안내는 숨긴다', () => {
    route.query = 'step=school'
    const html = render(<StartPage />, { school: true })
    expect(html).not.toContain('start-next-hint')
    expect(html).toMatch(/<button type="button" class="btn btn-primary btn-lg">다음/)
  })

  it('선택 사항인 조건 단계는 비어 있어도 결과를 볼 수 있다', () => {
    route.query = 'step=profile'
    const html = render(<StartPage />, { school: true, majors: ['cs'], univs: ['snu'] })
    expect(html).not.toContain('start-next-hint')
    expect(html).toMatch(/<button type="button" class="btn btn-primary btn-lg">결과 보기/)
  })
})
