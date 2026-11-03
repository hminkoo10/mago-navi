# 손글씨 '과목 내비' 그림(흰 바탕) → 마고 과목내비 아이콘 전부
#   웹(초록, scripts/icon-source-web.png):
#     public/favicon.svg(탭), public/favicon.ico(16·32·48), public/apple-touch-icon.png(180, iOS가 모서리를 깎음)
#     public/icon-192.png·icon-512.png(PWA, 통합 클라우드 목록의 웹 카드), public/icon-maskable-512.png(가운데 안전 영역 안에만 그림)
#   PC(빨강, scripts/icon-source-pc.png):
#     desktop/build/icon.ico(16~256, exe), desktop/build/icon.png(512, 창·통합 클라우드 목록의 PC 카드)
# 통합 클라우드(MagoEdu launcher/scripts/build-app-icon.py)와 같은 방법: 흰 둥근 사각형에 그림의 색 그대로,
# 작은 크기에서는 선을 굵게 다시 그려서 글자가 사라지지 않게 한다. ICO 는 크기마다 따로 그린 PNG 를 그대로 담음.
# 사용: npm run icon   (Python, Pillow, numpy, scipy 필요)
from pathlib import Path

import base64
import io
import struct

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt


class Drawing:
    """흰 바탕에 한 가지 색으로 그린 그림 → 잉크 양(0~1)과 선 색."""

    def __init__(self, path):
        rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
        d = 255.0 - rgb
        far = np.sqrt((d ** 2).sum(axis=2))
        self.ink = tuple(int(v) for v in np.median(rgb[far > far.max() * 0.8], axis=0))
        v = 255.0 - np.array(self.ink, np.float32)
        a = np.clip((d * v).sum(axis=2) / (v * v).sum(), 0, 1)  # 흰색→선 색 사이 어디쯤인지 = 잉크 양
        a[a < 0.06] = 0
        ys, xs = np.nonzero(a)
        self.mask = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        b = self.mask > 0.5
        p = np.pad(b, 1)
        edge = b & ~(p[2:, 1:-1] & p[:-2, 1:-1] & p[1:-1, 2:] & p[1:-1, :-2])
        self.stroke = 2.0 * b.sum() / edge.sum()  # 선 굵기(원본 픽셀) ≈ 2 × 넓이 / 둘레
        h, w = self.mask.shape
        yy, xx = np.nonzero(b)
        self.reach = np.sqrt((yy - h / 2) ** 2 + (xx - w / 2) ** 2).max()  # 가운데에서 가장 먼 잉크까지

    def ink_alpha(self, scale, stroke):
        """scale 배로 키운 잉크. 선이 stroke(같은 픽셀 단위)보다 가늘면 그만큼 굵게."""
        h, w = self.mask.shape
        W, H = max(1, round(w * scale)), max(1, round(h * scale))
        a = np.asarray(Image.fromarray((self.mask * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
        grow = (stroke - self.stroke * scale) / 2 if stroke else 0
        if grow > 0:
            a = np.pad(a, int(grow) + 2)
            dist = distance_transform_edt(a <= 0.5)
            a = np.maximum(a, np.clip(grow + 0.5 - dist, 0, 1))
        return a


def render(dr, size, *, bg='tile', fill=0.78, reach=None, stroke=None, radius=0.22):
    """size×size RGBA. 크게 그린 뒤 줄여서 경계를 부드럽게.
    bg: 'tile'(흰 둥근 사각형) | 'square'(흰 정사각형)
    fill: 글자 상자의 긴 변 / size,  reach: 가운데에서 가장 먼 잉크까지 / size (fill 대신)
    stroke: 이 크기에서의 최소 선 굵기(px)"""
    ss = max(2, -(-1024 // size))
    S = size * ss
    h, w = dr.mask.shape
    scale = (reach * S / dr.reach) if reach else (fill * S / max(h, w))
    a = dr.ink_alpha(scale, stroke * ss if stroke else None)
    im = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    g = ImageDraw.Draw(im)
    if bg == 'tile':
        g.rounded_rectangle((0, 0, S - 1, S - 1), radius=round(S * radius), fill=(255, 255, 255, 255))
    else:
        g.rectangle((0, 0, S, S), fill=(255, 255, 255, 255))
    ink = Image.new('RGBA', (a.shape[1], a.shape[0]), dr.ink + (255,))
    ink.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    im.alpha_composite(ink, ((S - a.shape[1]) // 2, (S - a.shape[0]) // 2))
    return im.resize((size, size), Image.LANCZOS)


def tile_stroke(size):
    """창·작업 표시줄·탭 아이콘의 크기별 최소 선 굵기(px). 통합 클라우드·오답노트 아이콘과 같은 표"""
    table = {16: 1.5, 20: 1.7, 24: 1.9, 32: 2.3, 40: 2.6, 48: 2.9, 64: 3.4, 100: 4.4, 128: 5.2, 256: 8.5, 512: 15}
    ks = sorted(table)
    if size >= ks[-1]:
        return table[ks[-1]] * size / ks[-1]
    lo = max(k for k in ks if k <= size)
    hi = min(k for k in ks if k >= size)
    return table[lo] if lo == hi else table[lo] + (table[hi] - table[lo]) * (size - lo) / (hi - lo)


def tile(dr, size):
    # 작을수록 여백을 줄여 글자를 크게
    fill = 0.86 if size <= 24 else 0.82 if size <= 48 else 0.78
    return render(dr, size, bg='tile', fill=fill, stroke=tile_stroke(size), radius=0.18 if size <= 24 else 0.22)


def png(im):
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return b.getvalue()


def save_ico(path, frames):
    """크기별 PNG 를 그대로 담은 ICO (Windows Vista 이후는 모든 크기에서 PNG 를 읽음)"""
    frames = sorted(frames, key=lambda f: f.width)
    blobs = [png(f) for f in frames]
    out = struct.pack('<HHH', 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    for f, b in zip(frames, blobs):
        out += struct.pack('<BBBBHHII', f.width % 256, f.height % 256, 0, 0, 1, 32, len(b), offset)
        offset += len(b)
    path.write_bytes(out + b''.join(blobs))


def favicon_svg(dr):
    """탭 아이콘. 손글씨는 그림이라 SVG 안에 PNG 를 넣는다. 탭에는 16~32px 로 보이니 32px 에 맞춘 굵기로"""
    data = base64.b64encode(png(render(dr, 64, fill=0.82, stroke=tile_stroke(32) * 2))).decode()
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<image width="64" height="64" href="data:image/png;base64,{data}"/></svg>\n'
    )


def save(root, rel, data):
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, Image.Image):
        data.save(f, optimize=True)
    elif isinstance(data, str):
        f.write_text(data, encoding='utf-8')
    else:
        data(f)
    print(f'[icon] {rel}')


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    web = Drawing(root / 'scripts' / 'icon-source-web.png')
    save(root, 'public/favicon.svg', favicon_svg(web))
    save(root, 'public/favicon.ico', lambda f: save_ico(f, [tile(web, s) for s in (16, 32, 48)]))
    save(root, 'public/apple-touch-icon.png', render(web, 180, bg='square', fill=0.74, stroke=tile_stroke(180)))
    save(root, 'public/icon-192.png', tile(web, 192))
    save(root, 'public/icon-512.png', tile(web, 512))
    # 안드로이드는 원·물방울 모양으로 깎으니 지름 80% 원 안에 잉크가 다 들어가게
    save(root, 'public/icon-maskable-512.png', render(web, 512, bg='square', reach=0.38, stroke=tile_stroke(512)))
    pc = Drawing(root / 'scripts' / 'icon-source-pc.png')
    save(root, 'desktop/build/icon.ico', lambda f: save_ico(f, [tile(pc, s) for s in (16, 24, 32, 48, 64, 128, 256)]))
    save(root, 'desktop/build/icon.png', tile(pc, 512))
