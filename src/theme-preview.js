// ════════════════════════════════════════════════════════════════════════════
// 24-86차 신규: 색/테마 미리보기 프레임(theme-preview.html) 안에서 도는 작은 스크립트
//
// 하는 일은 두 가지뿐입니다.
//   1) 실제 창 크기(1000x620)로 그려둔 화면을 액자 크기에 맞게 통째로 축소
//   2) 부모(index.html)가 postMessage로 보내준 테마/색을 이 문서의 body에 그대로 반영
//
// 부모 문서와 이 문서는 둘 다 file:// 이라 서로의 DOM에 직접 접근할 수 없습니다
// (Electron 기본 설정). 그래서 값 전달은 postMessage 한 가지 경로만 씁니다.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  // main.js가 BrowserWindow를 만드는 실제 크기와 같아야 비율이 진짜 화면과 일치함
  const STAGE_W = 1280;
  const STAGE_H = 800;
  const stage = document.getElementById("tp-stage");

  function fit() {
    if (!stage) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // 가로/세로 중 더 빡빡한 쪽에 맞춤(액자 비율이 달라도 잘리지 않게)
    const scale = Math.min(w / STAGE_W, h / STAGE_H);
    // 남는 쪽은 가운데로
    const left = Math.round((w - STAGE_W * scale) / 2);
    const top = Math.round((h - STAGE_H * scale) / 2);
    stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }

  // renderer.js의 applyThemeColor와 같은 계산(포인트색에서 밝은/어두운 변형을 만듦).
  // 같은 공식을 써야 미리보기와 실제 화면의 색이 정확히 일치합니다.
  function shade(hex, amount) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return hex;
    const num = parseInt(h, 16);
    let r = (num >> 16) & 0xff;
    let g = (num >> 8) & 0xff;
    let b = num & 0xff;
    const mix = (c) =>
      amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount));
    r = Math.max(0, Math.min(255, mix(r)));
    g = Math.max(0, Math.min(255, mix(g)));
    b = Math.max(0, Math.min(255, mix(b)));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function applyPreview({ theme, colorTheme, accent } = {}) {
    const body = document.body;
    const root = document.documentElement;

    // 밝기 모드(다크/화이트)
    body.dataset.theme = theme === "light" ? "light" : "dark";

    // 완전 테마(배경까지 바뀌는 것) - 없으면 속성을 지워서 기본 테마로
    if (colorTheme) body.dataset.colorTheme = colorTheme;
    else delete body.dataset.colorTheme;

    // 포인트색 - 실제 앱과 동일하게 html/body 양쪽에 인라인으로 걸어야
    // 라이트 테마의 body 규칙에 밀리지 않습니다(renderer.js 주석 참고)
    const props = ["--accent", "--accent-strong", "--accent-dim"];
    props.forEach((p) => {
      root.style.removeProperty(p);
      body.style.removeProperty(p);
    });
    if (accent) {
      const strong = shade(accent, 0.25);
      const dim = shade(accent, -0.45);
      [
        ["--accent", accent],
        ["--accent-strong", strong],
        ["--accent-dim", dim],
      ].forEach(([p, v]) => {
        root.style.setProperty(p, v);
        body.style.setProperty(p, v);
      });
    }
  }

  window.addEventListener("resize", fit);
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.type !== "nova-theme-preview") return;
    applyPreview(msg);
    fit();
  });

  fit();
  // 부모가 준비된 뒤에 값을 보내지만, 프레임이 늦게 뜨는 경우를 대비해 준비됐다고 알림
  try {
    window.parent?.postMessage({ type: "nova-theme-preview-ready" }, "*");
  } catch (_) {
    /* 부모가 없어도(직접 열어봐도) 그냥 기본 화면으로 보이면 됨 */
  }
})();
