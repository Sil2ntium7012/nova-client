# -*- coding: utf-8 -*-
# Nova Client 세로 포스터 (1080x1350)
#
# 런처 브랜드를 그대로 씀:
#   배경 #0C0E14 (style.css --bg-0), 포인트 #5FE066 (--accent), 강조 #7BFF82 (--accent-strong)
#   글꼴 SUIT (런처 기본 글꼴, SIL OFL 1.1)
#   별은 로고(icon.png) 가운데 있는 네 갈래 반짝이 = 아스트로이드
#
# 2배로 그린 뒤 줄여서 가장자리를 매끄럽게 만든다.
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1350
S = 2                      # 2배로 그린 뒤 축소
BG = (12, 14, 20)
ACCENT = (95, 224, 102)
ACCENT_S = (123, 255, 130)
INK = (236, 244, 238)
MUTED = (110, 140, 120)

F_HEAVY = os.path.join(HERE, "fonts", "SUIT-Heavy.ttf")
F_BOLD = os.path.join(HERE, "fonts", "SUIT-Bold.ttf")
F_MED = os.path.join(HERE, "fonts", "SUIT-Medium.ttf")
F_LIGHT = os.path.join(HERE, "fonts", "SUIT-Light.ttf")

STAR_P = 2.6               # 클수록 변이 더 깊게 파인다(네 갈래가 뾰족해짐)


def star_points(cx, cy, r, n=96, squash=1.0):
    """로고의 네 갈래 반짝이. |cos|^p 로 반지름을 깎으면 그 모양이 나온다."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        ct, st = math.cos(t), math.sin(t)
        x = r * (abs(ct) ** STAR_P) * (1 if ct >= 0 else -1)
        y = r * squash * (abs(st) ** STAR_P) * (1 if st >= 0 else -1)
        pts.append((cx + x, cy + y))
    return pts


def tracked_text(draw, text, cx, y, font, fill, track):
    """자간을 직접 벌려서 그린다(PIL 에는 자간 옵션이 없다)."""
    ws = [draw.textlength(ch, font=font) for ch in text]
    total = sum(ws) + track * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, ws):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + track
    return total


# ── 캔버스 ───────────────────────────────────────────────────────────────────
img = Image.new("RGB", (W * S, H * S), BG)
d = ImageDraw.Draw(img)
# 번짐은 두 겹으로 나눈다. PIL 의 GaussianBlur 는 박스 블러를 여러 번 겹치는 방식이라,
# 작고 밝은 점에 큰 반지름을 쓰면 둥근 네모 자국이 남는다(실제로 별 주변에 네모가 보였다).
# 별은 좁게, 로고만 넓게 번지게 해서 그 자국을 없앤다.
glow_s = Image.new("RGB", img.size, (0, 0, 0))   # 별 - 좁은 번짐
gs = ImageDraw.Draw(glow_s)
glow_l = Image.new("RGB", img.size, (0, 0, 0))   # 로고 - 넓은 번짐
gd = ImageDraw.Draw(glow_l)

random.seed(20260930)

# ── 별 ───────────────────────────────────────────────────────────────────────
# 가운데(로고+글자 자리)는 비워서 글씨가 묻히지 않게 한다
CENTER_BOX = (140, 330, W - 140, 980)


def in_center(x, y, pad=0):
    return (CENTER_BOX[0] - pad <= x <= CENTER_BOX[2] + pad
            and CENTER_BOX[1] - pad <= y <= CENTER_BOX[3] + pad)


for _ in range(420):                      # 잔별
    x, y = random.randrange(W), random.randrange(H)
    if in_center(x, y, 20):
        continue
    v = int(30 + 120 * (random.random() ** 2.4))
    d.rectangle([x * S, y * S, x * S + S - 1, y * S + S - 1],
                fill=(int(v * 0.72), v, int(v * 0.78)))

for _ in range(34):                       # 로고 모양 반짝이
    x, y = random.randrange(W), random.randrange(H)
    if in_center(x, y, 40):
        continue
    r = random.uniform(2.2, 5.4)
    mag = (r - 2.2) / 3.2
    v = int(120 + 90 * mag)
    col = (int(v * 0.62), v, int(v * 0.70))
    d.polygon(star_points(x * S, y * S, r * S, squash=random.uniform(0.85, 1.15)), fill=col)
    if r >= 3.4:
        g = 0.30 * mag
        gs.polygon(star_points(x * S, y * S, r * S * 1.6),
                   fill=(int(ACCENT[0] * g), int(ACCENT[1] * g), int(ACCENT[2] * g)))

# ── 로고 마크 (3x3 격자 + 가운데 반짝이) ──────────────────────────────────────
LOGO_CX, LOGO_CY = W // 2, 470
CELL = 62                                  # 칸 한 변
GAP = 20                                   # 칸 사이
step = CELL + GAP
for row in range(3):
    for col in range(3):
        cx = LOGO_CX + (col - 1) * step
        cy = LOGO_CY + (row - 1) * step
        if row == 1 and col == 1:
            # 가운데 칸만 반짝이. 뒤에 은은한 번짐을 깐다
            gd.polygon(star_points(cx * S, cy * S, CELL * 1.0 * S),
                       fill=(int(ACCENT[0] * 0.55), int(ACCENT[1] * 0.55), int(ACCENT[2] * 0.55)))
            # 갈래가 더 가늘게 파이도록 p 를 잠깐 올려서 그린다
            _p = STAR_P
            globals()["STAR_P"] = 3.4
            d.polygon(star_points(cx * S, cy * S, CELL * 0.68 * S), fill=(232, 255, 236))
            globals()["STAR_P"] = _p
            continue
        x0, y0 = (cx - CELL / 2) * S, (cy - CELL / 2) * S
        d.rounded_rectangle([x0, y0, x0 + CELL * S, y0 + CELL * S],
                            radius=int(CELL * 0.30 * S), fill=ACCENT)
        gd.rounded_rectangle([x0, y0, x0 + CELL * S, y0 + CELL * S],
                             radius=int(CELL * 0.30 * S),
                             fill=(int(ACCENT[0] * 0.22), int(ACCENT[1] * 0.22), int(ACCENT[2] * 0.22)))

# 번짐은 캔버스 가장자리에 닿으면 네모로 잘린다 - 여유를 두고 흐린 뒤 잘라낸다
PAD = 90 * S


def blurred(layer, radius):
    gp = Image.new("RGB", (layer.width + PAD * 2, layer.height + PAD * 2), (0, 0, 0))
    gp.paste(layer, (PAD, PAD))
    gp = gp.filter(ImageFilter.GaussianBlur(radius=radius))
    return gp.crop((PAD, PAD, PAD + layer.width, PAD + layer.height))


img = ImageChops.add(img, blurred(glow_s, 5 * S))
img = ImageChops.add(img, blurred(glow_l, 26 * S))
d = ImageDraw.Draw(img)

# ── 글자 ─────────────────────────────────────────────────────────────────────
# 이름만 크게 - NOVA / CLIENT 를 두 줄로 쌓아 포스터처럼 큼직하게
f_name = ImageFont.truetype(F_HEAVY, 132 * S)
tracked_text(d, "NOVA", (W // 2) * S, 640 * S, f_name, INK, 14 * S)
tracked_text(d, "CLIENT", (W // 2) * S, 780 * S, f_name, ACCENT, 14 * S)

# 이름 아래 가는 선 - 가운데는 밝고 양끝으로 사라지게
line_y = 952 * S
for i in range(int(360 * S)):
    t = i / (360 * S)
    a = math.sin(math.pi * t)
    v = int(40 + 150 * a)
    x = (W // 2 - 180) * S + i
    d.rectangle([x, line_y, x, line_y + max(1, S // 2)],
                fill=(int(v * 0.45), v, int(v * 0.52)))

f_sub = ImageFont.truetype(F_MED, 31 * S)
tracked_text(d, "마인크래프트 런처", (W // 2) * S, 985 * S, f_sub, MUTED, 5 * S)

# 맨 아래 주소
f_url = ImageFont.truetype(F_LIGHT, 24 * S)
tracked_text(d, "nova-site-xi.vercel.app", (W // 2) * S, 1248 * S, f_url,
             (78, 100, 86), 3 * S)

# ── 저장 ─────────────────────────────────────────────────────────────────────
out = img.resize((W, H), Image.LANCZOS)
out.save(os.path.join(OUT, "nova-poster.png"))
# 인쇄하거나 크게 쓸 때를 위해 2배본도 같이(그린 원본 크기 그대로)
img.save(os.path.join(OUT, "nova-poster@2x.png"))
print("nova-poster.png", out.size, "| @2x", img.size)
