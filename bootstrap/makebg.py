# -*- coding: utf-8 -*-
# Nova Client 설치 창 그림 생성
#   -> bg.bmp    : 창 배경 (단색 + 클라이언트 로고 모양 별 + 아래쪽 이름)
#   -> dial.bmp  : 시계 문자판 1120x1120 (= 280 x 4배). 바늘은 없다
#   -> trig.bin  : 1도 단위 sin/cos 표 (360 x (int32 sin, int32 cos), 10000배)
#
# 24-170차: "다운로드 중일 때 그거에 따라 시계가 움직이는 게 아니라 현실 시간으로 하고"
#   진행률 시계를 진짜 벽시계로 바꾼다. 그런데 시/분/초 조합은 43200가지라 예전처럼
#   바늘 그림을 미리 구워둘 수가 없다(24-168차는 60장이었다). 그래서 바늘은 설치 창이
#   실행 중에 GDI 로 직접 그린다 - 여기서는 "바늘 없는 문자판"만 만들어 두면 된다.
#   · 문자판을 4배 크기(1120)로 만들어 두고, 설치 창이 그 위에 4배 크기로 바늘을 그린 뒤
#     280 으로 줄여서 화면에 올린다. GDI 는 선을 부드럽게 못 그리는데, 이렇게 크게 그렸다가
#     줄이면(StretchBlt HALFTONE) 예전 그림처럼 매끄럽게 나온다.
#   · 삼각함수가 NSIS 에 없어서 sin/cos 표를 파일로 만들어 같이 넣는다.
#
# 24-170차: "우리 클라이언트 색처럼 초록색을 메인으로 하고 별도 좀 클라이언트 로고 별 써줘"
#   런처 기본 테마색(style.css --accent #5FE066 / --bg-0 #0C0E14)을 그대로 쓴다.
#   별은 로고(icon.png)의 네 갈래 반짝이 모양 - 변이 안쪽으로 파인 별(아스트로이드)이다.
#
# 라벨(상태 문구/버전/창 버튼) 자리는 반드시 완전한 단색이어야 한다(24-128차). 그래서
# 배경에 그라데이션을 일절 쓰지 않고, 그 사각형 안에는 별도 찍지 않는다.
import math
import os
import random
import struct

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 960, 600

# ── NSIS 와 공유하는 값 (bootstrap.nsi 의 같은 이름 define 과 반드시 일치) -----
BG = (12, 14, 20)              # #0C0E14  창 전체 단색 = 모든 라벨의 배경색 (런처 --bg-0)

CLOCK_CX, CLOCK_CY = 480, 250
CLOCK_BOX = 280                # 화면에 올라가는 시계 한 변
S = 4                          # 4배로 그린 뒤 줄인다
BIG = CLOCK_BOX * S            # 1120 - dial.bmp 한 변

DIAL_IN, DIAL_OUT = 112, 126   # 시(時) 눈금 선의 안/바깥 반지름 (1배 기준)
MINUTE_R = 124                 # 분 눈금 점 반지름
RIM_R = 134                    # 문자판 테두리 원

# 런처 색 (style.css)
ACCENT = (95, 224, 102)        # --accent      #5FE066
ACCENT_S = (123, 255, 130)     # --accent-strong #7BFF82
ACCENT_D = (46, 125, 58)       # --accent-dim  #2E7D3A

TICK_COL = (92, 168, 108)      # 시 눈금
TICK_TOP = (150, 240, 160)     # 12시 눈금만 밝게
TICK_DIM = (40, 78, 50)        # 분 눈금 점
RIM_COL = (34, 62, 42)         # 테두리 원
WORD_COL = (226, 242, 229)

# 라벨이 올라가는 사각형(여유 포함). 이 안에는 별을 찍지 않는다
EXCLUDE = [
    (236, 420, 488, 32),   # 상태 문구
    (396, 524, 168, 24),   # 버전
    (856, 12, 48, 36),     # 최소화
    (902, 12, 48, 36),     # 닫기
]

HERE = os.path.dirname(os.path.abspath(__file__))
F_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def in_excluded(x, y, pad=0):
    for (ex, ey, ew, eh) in EXCLUDE:
        if ex - pad <= x < ex + ew + pad and ey - pad <= y < ey + eh + pad:
            return True
    return False


def in_clock_box(x, y, pad=2):
    return (abs(x - CLOCK_CX) <= CLOCK_BOX // 2 + pad and
            abs(y - CLOCK_CY) <= CLOCK_BOX // 2 + pad)


# ── 로고 별(네 갈래 반짝이) ----------------------------------------------------
# icon.png 한가운데 있는 그 모양. 변이 안쪽으로 파인 네 갈래 별 = 아스트로이드.
# t 를 한 바퀴 돌리면서 |cos t|^P 로 반지름을 깎으면 그 모양이 그대로 나온다.
STAR_P = 2.6


def star_points(cx, cy, r, n=96, squash=1.0):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        ct, st = math.cos(t), math.sin(t)
        x = r * (abs(ct) ** STAR_P) * (1 if ct >= 0 else -1)
        y = r * squash * (abs(st) ** STAR_P) * (1 if st >= 0 else -1)
        pts.append((cx + x, cy + y))
    return pts


# ── 배경: 단색 + 별 (4배로 그린 뒤 줄인다) --------------------------------------
big = Image.new("RGB", (W * S, H * S), BG)
bd = ImageDraw.Draw(big)

random.seed(20260929)


def band_density(x, y):
    """은하수 - 밝기 그라데이션 대신 '별이 몰리는 정도'로 표현(단색을 안 깨뜨리려고)"""
    dist = abs((x - y * 0.55) - 250) / 260.0
    return max(0.0, 1.0 - dist * dist)


def pick_spot(min_gap_from_clock=2):
    for _ in range(400):
        x, y = random.randrange(W), random.randrange(H)
        if in_clock_box(x, y, min_gap_from_clock):
            continue
        if in_excluded(x, y, pad=4):
            continue
        if random.random() > 0.28 + 0.72 * band_density(x, y):
            continue
        return x, y
    return None


# 1) 작은 점별 - 로고 모양을 알아볼 수 없는 크기라 그냥 점으로
for _ in range(360):
    spot = pick_spot()
    if not spot:
        continue
    x, y = spot
    mag = random.random() ** 2.6
    v = int(34 + 132 * mag)
    col = (int(v * 0.72), v, int(v * 0.78))          # 살짝 초록 기운
    bd.rectangle([x * S, y * S, x * S + S - 1, y * S + S - 1], fill=col)

# 2) 로고 별 - 크기가 있는 것만 네 갈래 반짝이로. 큰 것에는 은은한 초록 번짐을 깐다
glow = Image.new("RGB", big.size, (0, 0, 0))
gd = ImageDraw.Draw(glow)
sparkles = []
for _ in range(26):
    spot = pick_spot(min_gap_from_clock=10)
    if not spot:
        continue
    x, y = spot
    r = random.uniform(2.0, 4.6)
    mag = (r - 2.0) / 2.6
    v = int(118 + 86 * mag)
    col = (int(v * 0.64), v, int(v * 0.70))
    sparkles.append((x, y, r, col, mag))
    bd.polygon(star_points(x * S, y * S, r * S, squash=random.uniform(0.86, 1.14)), fill=col)
    if r >= 3.2:
        gcol = (int(ACCENT[0] * mag * 0.30), int(ACCENT[1] * mag * 0.30), int(ACCENT[2] * mag * 0.30))
        gd.polygon(star_points(x * S, y * S, r * S * 1.45), fill=gcol)

# 번짐은 캔버스 가장자리에 닿으면 네모로 잘린다(24-160차) - 여유를 두고 흐린 뒤 잘라낸다
PAD = 40 * S
glow_p = Image.new("RGB", (big.width + PAD * 2, big.height + PAD * 2), (0, 0, 0))
glow_p.paste(glow, (PAD, PAD))
glow_p = glow_p.filter(ImageFilter.GaussianBlur(radius=2.6 * S))
glow = glow_p.crop((PAD, PAD, PAD + big.width, PAD + big.height))

# 번짐을 먼저 더하고(덧셈) 그 다음에 단색 사각형을 강제로 칠한다 - 순서를 지켜야
# 라벨 자리가 완전한 단색으로 남는다(24-167차에 겪은 문제)
from PIL import ImageChops  # noqa: E402
big = ImageChops.add(big, glow)


# ── 아래쪽 이름 --------------------------------------------------------------
def draw_tracked(img, text, cx, y, fnt, fill, track):
    dd = ImageDraw.Draw(img)
    ws = [dd.textlength(ch, font=fnt) for ch in text]
    total = sum(ws) + track * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, ws):
        dd.text((x, y), ch, font=fnt, fill=fill)
        x += w + track


draw_tracked(big, "NOVA CLIENT", W * S // 2, 474 * S,
             ImageFont.truetype(F_BOLD, 26 * S), WORD_COL, 8 * S)

base = big.resize((W, H), Image.LANCZOS)

# 안전장치: 라벨 사각형과 시계 상자는 무슨 일이 있어도 완전한 단색
fd = ImageDraw.Draw(base)
for (ex, ey, ew, eh) in EXCLUDE:
    fd.rectangle([ex, ey, ex + ew - 1, ey + eh - 1], fill=BG)
fd.rectangle([CLOCK_CX - CLOCK_BOX // 2, CLOCK_CY - CLOCK_BOX // 2,
              CLOCK_CX + CLOCK_BOX // 2 - 1, CLOCK_CY + CLOCK_BOX // 2 - 1], fill=BG)

base.save(os.path.join(HERE, "bg.bmp"), "BMP")
base.save(os.path.join(HERE, "bg_preview.png"))


# ── 문자판 (4배 크기 그대로 저장 - 줄이는 건 설치 창이 한다) ----------------------
dial = Image.new("RGB", (BIG, BIG), BG)
dd = ImageDraw.Draw(dial)
C = BIG / 2

dd.ellipse([C - RIM_R * S, C - RIM_R * S, C + RIM_R * S, C + RIM_R * S],
           outline=RIM_COL, width=int(1.2 * S))
for i in range(60):
    if i % 5 == 0:
        continue
    a = math.radians(i * 6)
    mx = C + MINUTE_R * S * math.sin(a)
    my = C - MINUTE_R * S * math.cos(a)
    dd.ellipse([mx - 1.2 * S, my - 1.2 * S, mx + 1.2 * S, my + 1.2 * S], fill=TICK_DIM)
for h12 in range(12):
    a = math.radians(h12 * 30)
    inner = DIAL_IN - (4 if h12 == 0 else 0)
    x0 = C + inner * S * math.sin(a)
    y0 = C - inner * S * math.cos(a)
    x1 = C + DIAL_OUT * S * math.sin(a)
    y1 = C - DIAL_OUT * S * math.cos(a)
    dd.line([(x0, y0), (x1, y1)],
            fill=(TICK_TOP if h12 == 0 else TICK_COL),
            width=int((3.0 if h12 == 0 else 2.0) * S))

dial.save(os.path.join(HERE, "dial.bmp"), "BMP")
dial.resize((CLOCK_BOX, CLOCK_BOX), Image.LANCZOS).save(os.path.join(HERE, "dial_preview.png"))


# ── sin/cos 표 ---------------------------------------------------------------
# NSIS 에는 삼각함수가 없다. 1도 단위로 미리 계산해서 파일로 넘긴다(10000배 정수).
# 설치 창은 ReadFile 로 통째로 읽어서 deg*8 위치에서 (sin, cos) 두 정수를 꺼내 쓴다.
with open(os.path.join(HERE, "trig.bin"), "wb") as f:
    for deg in range(360):
        a = math.radians(deg)
        f.write(struct.pack("<ii", int(round(math.sin(a) * 10000)),
                            int(round(math.cos(a) * 10000))))

print("bg.bmp", base.size, "| dial.bmp", dial.size, "| trig.bin 360 entries",
      "| sparkles", len(sparkles))
