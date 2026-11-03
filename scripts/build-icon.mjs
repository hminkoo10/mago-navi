// 손글씨 '과목 내비'(청록 #0F9D8A) → 마고 과목내비 아이콘 전부
//   public/favicon.svg(탭), public/favicon.ico(16·32·48), public/apple-touch-icon.png(180, iOS가 모서리를 깎음)
//   public/icon-192.png·icon-512.png(PWA), public/icon-maskable-512.png(가운데 안전 영역 안에만 그림)
//   desktop/build/icon.ico(16~256, exe), desktop/build/icon.png(512, 창)
// 오답노트(ohdapnote scripts/build-app-icon)와 같은 모양: 흰 둥근 사각형에 한 가지 색 손글씨, 작은 크기에서는 선을 굵게,
// ICO 는 크기마다 따로 그린 PNG 를 그대로 담음.
// 손글씨 그림 파일 대신 획을 SVG 경로로 적어 두고, 이미 의존성인 @napi-rs/canvas 로 그린다 (Chromium·Pillow 필요 없음).
// 사용: npm run icon
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, Path2D } from '@napi-rs/canvas'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const INK = '#0F9D8A'

// 1000×1000 안에 쓴 '과목 / 내비' (두 줄). 마우스로 쓴 것처럼 획마다 조금씩 기울고 휘게
const STROKES = [
  // 과: ㄱ, ㅗ, ㅏ
  'M86 96 Q170 92 262 84 Q262 150 250 214',
  'M174 250 Q175 286 172 322',
  'M66 336 Q190 326 318 322',
  'M382 46 Q392 250 384 462',
  'M388 236 Q420 236 452 228',
  // 목: ㅁ, ㅗ, ㄱ
  'M566 76 Q568 130 572 192',
  'M564 74 Q700 64 836 70 Q840 128 834 186',
  'M572 194 Q704 190 834 186',
  'M704 196 Q706 230 704 264',
  'M538 274 Q742 264 948 262',
  'M584 334 Q726 324 872 322 Q874 396 864 462',
  // 내: ㄴ, ㅐ
  'M96 594 Q94 712 100 832 Q194 828 296 818',
  'M336 556 Q344 760 336 946',
  'M340 736 Q378 734 416 728',
  'M420 538 Q428 760 420 968',
  // 비: ㅂ, ㅣ
  'M578 590 Q574 720 580 852',
  'M748 584 Q752 720 744 850',
  'M580 716 Q662 714 746 710',
  'M576 852 Q664 852 750 846',
  'M864 546 Q874 760 866 970',
]
/** 큰 그림(512px, 글자 상자 78%)에서의 선 굵기 (1000 기준) */
const BASE_WIDTH = 38

const nums = STROKES.join(' ').match(/-?\d+(\.\d+)?/g).map(Number)
const xs = nums.filter((_, i) => i % 2 === 0)
const ys = nums.filter((_, i) => i % 2 === 1)
const box = {
  x0: Math.min(...xs) - BASE_WIDTH / 2,
  y0: Math.min(...ys) - BASE_WIDTH / 2,
  x1: Math.max(...xs) + BASE_WIDTH / 2,
  y1: Math.max(...ys) + BASE_WIDTH / 2,
}
const boxSide = Math.max(box.x1 - box.x0, box.y1 - box.y0)
const cx = (box.x0 + box.x1) / 2
const cy = (box.y0 + box.y1) / 2

/** 크기별 최소 선 굵기(px). 오답노트·통합 클라우드 아이콘과 같은 표 */
function tileStroke(size) {
  const table = { 16: 1.5, 20: 1.7, 24: 1.9, 32: 2.3, 40: 2.6, 48: 2.9, 64: 3.4, 100: 4.4, 128: 5.2, 256: 8.5, 512: 15 }
  const ks = Object.keys(table).map(Number)
  if (size >= ks.at(-1)) return (table[ks.at(-1)] * size) / ks.at(-1)
  const lo = Math.max(...ks.filter((k) => k <= size))
  const hi = Math.min(...ks.filter((k) => k >= size))
  return lo === hi ? table[lo] : table[lo] + ((table[hi] - table[lo]) * (size - lo)) / (hi - lo)
}

const roundRect = (s, r) => `M${r} 0H${s - r}A${r} ${r} 0 0 1 ${s} ${r}V${s - r}A${r} ${r} 0 0 1 ${s - r} ${s}H${r}A${r} ${r} 0 0 1 0 ${s - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`

/** 글자 상자의 긴 변이 size×fill 이 되게 놓는 배율과 선 굵기(1000 기준) */
function layout(size, fill, stroke) {
  const scale = (fill * size) / boxSide
  return { scale, width: Math.max(BASE_WIDTH, (stroke ?? 0) / scale) }
}

/**
 * size×size PNG
 * bg: 'tile'(흰 둥근 사각형) | 'square'(흰 정사각형), fill: 글자 상자의 긴 변 / size, stroke: 이 크기에서의 최소 선 굵기(px)
 */
function render(size, { bg = 'tile', fill = 0.78, stroke = tileStroke(size), radius = 0.22 } = {}) {
  const canvas = createCanvas(size, size)
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  if (bg === 'tile') g.fill(new Path2D(roundRect(size, size * radius)))
  else g.fillRect(0, 0, size, size)
  const { scale, width } = layout(size, fill, stroke)
  g.translate(size / 2, size / 2)
  g.scale(scale, scale)
  g.translate(-cx, -cy)
  g.strokeStyle = INK
  g.lineWidth = width
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const d of STROKES) g.stroke(new Path2D(d))
  return canvas.toBuffer('image/png')
}

/** 창·작업 표시줄·탭 아이콘 (작을수록 여백을 줄여 글자를 크게) */
function tile(size) {
  const fill = size <= 24 ? 0.86 : size <= 48 ? 0.82 : 0.78
  return render(size, { fill, radius: size <= 24 ? 0.18 : 0.22 })
}

/** 크기별 PNG 를 그대로 담은 ICO (Windows Vista 이후는 모든 크기에서 PNG 를 읽음) */
function ico(sizes) {
  const frames = sizes.map((s) => ({ size: s, png: tile(s) }))
  const head = Buffer.alloc(6 + 16 * frames.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // 아이콘
  head.writeUInt16LE(frames.length, 4)
  let offset = head.length
  frames.forEach((f, i) => {
    const e = 6 + 16 * i
    head.writeUInt8(f.size % 256, e) // 256 은 0
    head.writeUInt8(f.size % 256, e + 1)
    head.writeUInt16LE(1, e + 4) // planes
    head.writeUInt16LE(32, e + 6) // bpp
    head.writeUInt32LE(f.png.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += f.png.length
  })
  return Buffer.concat([head, ...frames.map((f) => f.png)])
}

/** 탭 아이콘용 SVG. 탭에는 16~32px 로 보이니 32px 에 맞춘 굵기로 */
function svg() {
  const size = 64
  const { scale, width } = layout(size, 0.82, tileStroke(32) * 2)
  const r = (n) => Math.round(n * 1000) / 1000
  const t = `translate(${r(size / 2 - cx * scale)} ${r(size / 2 - cy * scale)}) scale(${Math.round(scale * 1e6) / 1e6})`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${r(size * 0.22)}" fill="#ffffff"/>` +
    `<g transform="${t}" fill="none" stroke="${INK}" stroke-width="${r(width)}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${STROKES.join(' ')}"/></g></svg>\n`
  )
}

function save(rel, data) {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log(`[icon] ${rel}`)
}

save('public/favicon.svg', svg())
save('public/favicon.ico', ico([16, 32, 48]))
save('public/apple-touch-icon.png', render(180, { bg: 'square', fill: 0.74 }))
save('public/icon-192.png', tile(192))
save('public/icon-512.png', tile(512))
// 안드로이드는 원·물방울 모양으로 깎으니 지름 80% 원 안에 글자 상자가 다 들어가게 (0.8 / √2 ≈ 0.566)
save('public/icon-maskable-512.png', render(512, { bg: 'square', fill: 0.54 }))
save('desktop/build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]))
save('desktop/build/icon.png', tile(512))
