import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

// 스크롤바가 자리를 차지하는 PC에서는 내용이 창 가운데보다 스크롤바 폭의 절반만큼 왼쪽에 온다. 그만큼 .wrap 안을 오른쪽으로 (styles.css)
// (html 이 scrollbar-gutter: stable 이라 스크롤바 칸은 늘 같아서, 레이아웃이 잡힌 뒤와 창 크기·확대가 바뀔 때만 다시 잰다)
const measureScrollbar = () =>
  document.documentElement.style.setProperty('--sb-half', `${(window.innerWidth - document.documentElement.clientWidth) / 2}px`)
measureScrollbar()
new ResizeObserver(measureScrollbar).observe(document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// 앱 설치·오프라인용. 개발 서버에서는 등록하지 않는다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
