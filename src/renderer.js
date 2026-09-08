// ============================================================================
//  Nova Client - renderer.js
// ============================================================================

// ---- 타이틀바 버튼 -----------------------------------------------------
document.getElementById("btn-min").addEventListener("click", () => window.luna.minimize());
document.getElementById("btn-close").addEventListener("click", () => window.luna.close());

// 17차: "전체화면 지원을 다시 켜주고, 창 크기에 비례해서 박스들이 여백 없이 늘어나게 해줘" -
// 리사이즈/최대화는 여전히 막혀있지만(main.js 참고), 전체화면(F11/버튼)만 별도로 다시 허용함.
// body에 data-fullscreen 플래그를 달아서, 전체화면일 때만 필요한 미세 조정을 CSS에서 걸 수
// 있게 해둠(대부분의 레이아웃은 이미 flex/grid 기반이라 창이 커져도 자동으로 늘어남)
document.getElementById("btn-fullscreen")?.addEventListener("click", () => window.luna.toggleFullscreen?.());
window.luna.onFullscreenChanged?.((isFullscreen) => {
  document.body.classList.toggle("is-fullscreen", !!isFullscreen);
});
window.luna.isFullscreen?.().then((res) => {
  if (res?.fullscreen) document.body.classList.add("is-fullscreen");
});
// 10차 "미래 준비": 후원 사이트 주소가 아직 없어서, 자리만 미리 만들어두고 누르면 안내
// 토스트만 뜨게 함. 실제 사이트가 생기면 이 안을 window.luna.openExternal?.("실제 URL")로
// 바꾸기만 하면 됨
document.getElementById("btn-donate")?.addEventListener("click", () => {
  showToast("후원 사이트는 아직 준비 중이에요. 조금만 기다려주세요!");
});

// ---- 24-39차: 로고 "O" 안 스파클 위치 계산 코드 전체 제거 -----------------------
// 24-16차~24-38차까지 여기 있던 positionBrandOSparks()(Canvas TextMetrics로 "O" 글자의
// 실제 잉크 중심을 실측해서 그 위에 별 SVG를 겹쳐 그리던 함수)와 그 측정용 Canvas는 더 이상
// 필요 없어져서 완전히 제거함. "그냥 O 자체를 별로 바꿔줘" 요청으로 접근을 바꿔서, 이제 별은
// "O" 글자 위에 겹치는 오버레이가 아니라 "O" 글자 자체를 대신하는 인라인 요소(.brand-o-star,
// index.html/style.css 참고)라서 글자 위치를 실측해서 좌표를 계산해줄 필요 자체가 없어짐 -
// 순수 CSS(em 단위)만으로 항상 정확한 자리에 그려짐.

// ---- 6차: 탭/칩 그룹 슬라이딩 하이라이트 (공용 헬퍼) ----------------------------
// 이미 선택된 게 있는 상태에서 다른 걸 고르면, 하이라이트가 스냅되지 않고 이전 위치에서
// 새 위치로 부드럽게 "이동"하는 느낌을 주기 위함. container 안에 절대위치 pill(배경 요소)을
// 하나 만들어두고, 활성 버튼이 바뀔 때마다 그 버튼의 위치/크기로 transform+크기를 옮김
// (실제 움직임은 CSS transition이 처리 - .slide-pill 규칙 참고)
function mountSlidingPill(container, extraClass) {
  if (!container) return { update: () => {} };
  let pill = container.querySelector(":scope > .slide-pill");
  if (!pill) {
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    pill = document.createElement("div");
    pill.className = "slide-pill" + (extraClass ? " " + extraClass : "");
    container.insertBefore(pill, container.firstChild);
  }
  function setRect(rect) {
    pill.style.width = rect.width + "px";
    pill.style.height = rect.height + "px";
    pill.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  }
  // 10차: "블록 자체가 옮겨가는 느낌 말고, 이전 위치랑 새 위치를 이어주고 뒤에서부터
  // 사라지는 잔상 느낌으로 해줘" - 예전엔 그냥 위치/크기를 한 번에 새 값으로 트랜지션해서
  // "네모가 슥 이동하는" 느낌이었음. 이제는 2단계로 나눠서:
  //  1단계) 이전 자리와 새 자리를 모두 덮는 영역까지 빠르게 "늘어남" (둘을 이어줌)
  //  2단계) 이동 방향의 앞쪽 끝은 이미 새 자리에 도착해 있으니 그대로 두고, 뒤쪽 끝만
  //         새 자리 크기로 따라잡으며 "줄어듦" (마치 꼬리가 뒤에서부터 사라지는 느낌)
  function update(activeEl, instant) {
    // 24-15차: "프로필 고르는 거 왜 맨 위로 올리면 이렇게 빈 공간이 나와?" 원인 조사 중 발견한
    // 버그 - server-list-items/profile-list-items처럼 목록을 다시 그릴 때마다
    // container.innerHTML = ""로 통째로 비우는 곳에서는, 처음 mountSlidingPill()이 컨테이너
    // 맨 앞에 넣어둔 pill 요소까지 같이 지워져 버림. 그 뒤로는 update()가 DOM에서 떨어져나간
    // (분리된) pill 노드의 style만 계속 바꾸는 꼴이라 실제로는 화면에 전혀 반영이 안 됐음.
    // 매 update()마다 pill이 지금 컨테이너 안에 붙어있는지 확인해서, 빠져있으면 다시
    // 맨 앞에 끼워넣어 자가 복구되게 함(탭 종류처럼 컨테이너를 통째로 비우지 않는 다른
    // mountSlidingPill 사용처에서는 이미 붙어있으니 이 검사가 그냥 통과됨)
    if (!container.contains(pill)) {
      container.insertBefore(pill, container.firstChild);
    }
    if (!activeEl || !activeEl.offsetWidth) {
      // 컨테이너가 아직 숨겨져 있거나(화면 전환 전) 선택된 게 없으면 그냥 숨겨둠
      pill.style.opacity = "0";
      pill._lastRect = null;
      return;
    }
    const newRect = {
      left: activeEl.offsetLeft,
      top: activeEl.offsetTop,
      width: activeEl.offsetWidth,
      height: activeEl.offsetHeight,
    };
    pill.style.opacity = "1";
    const prevRect = pill._lastRect;
    if (instant || !prevRect) {
      pill.classList.remove("is-stretching", "is-settling");
      pill.classList.add("is-instant");
      setRect(newRect);
      // 강제 리플로우 후 no-transition 클래스를 떼서, 다음 update부터는 다시 애니메이션되게 함
      void pill.offsetWidth;
      pill.classList.remove("is-instant");
      pill._lastRect = newRect;
      return;
    }
    if (pill._settleTimer) clearTimeout(pill._settleTimer);
    const union = {
      left: Math.min(prevRect.left, newRect.left),
      top: Math.min(prevRect.top, newRect.top),
    };
    union.width = Math.max(prevRect.left + prevRect.width, newRect.left + newRect.width) - union.left;
    union.height = Math.max(prevRect.top + prevRect.height, newRect.top + newRect.height) - union.top;
    pill.classList.remove("is-settling");
    pill.classList.add("is-stretching");
    setRect(union);
    pill._settleTimer = setTimeout(() => {
      pill.classList.remove("is-stretching");
      pill.classList.add("is-settling");
      setRect(newRect);
      pill._settleTimer = setTimeout(() => {
        pill.classList.remove("is-settling");
      }, 340);
    }, 130);
    pill._lastRect = newRect;
  }
  // 24차: "서버<>프로필 옮길 때 선택된 게 넘어가는 애니메이션도 해주고" - 서버 목록과 프로필
  // 목록은 서로 다른 컨테이너(별개의 mountSlidingPill 인스턴스)라, 그냥 update()만으로는
  // "이 pill이 저 pill 자리에서 시작해서 새 자리로 이어졌다"는 걸 표현할 방법이 없음.
  // getRect()로 한쪽 pill의 마지막 위치를 읽어서 다른 쪽 pill에 seedRect()로 심어두면,
  // 그다음 update(el, false)가 "심어둔 자리 → 실제 새 자리"로 이어지는 애니메이션을 만들어줌
  // (아래 setHeroSideMode 참고)
  function getRect() { return pill._lastRect || null; }
  function seedRect(rect) { pill._lastRect = rect; }
  return { update, getRect, seedRect };
}

// ---- 9차: skinview3d로 모자(2번째 레이어)/망토까지 보이는 3D 스킨 렌더 -----------------
// crafatar(<img> 렌더)는 모자는 ?overlay로 어느 정도 보여주지만 망토(cape)는 아예 렌더링을
// 지원 안 함 - skinview3d(three.js 기반 3D 뷰어, MIT 라이선스, src/vendor에 로컬 번들)로
// 직접 그리는 걸로 바꿈. 실제 스킨/망토 PNG URL은 Mojang 세션 서버에서 받아와야 하는데
// CSP(connect-src 'self')에 막혀 렌더러에서 직접 fetch 못 해서 main.js가 대신 조회해줌
// (window.luna.getSkinTextures). 캔버스 하나당 SkinViewer 인스턴스를 하나만 만들어 재사용해서
// WebGL 컨텍스트가 팝업 열 때마다 새로 생기지 않게 함. 실패하면(라이브러리 로드 실패, 네트워크
// 오류 등) 그냥 조용히 손을 떼고 - 호출부에서 이미 채워둔 crafatar <img>가 폴백으로 그대로 보임
const skinViewerInstances = new Map(); // canvas -> skinview3d.SkinViewer
async function mountSkinViewer(canvasEl, imgEl, uuid, size) {
  if (!canvasEl || !imgEl || !uuid) return;
  if (typeof skinview3d === "undefined") {
    window.luna?.logClient?.("[3D스킨] mountSkinViewer: skinview3d 전역이 undefined - 번들 로드 실패");
    return;
  }
  if (!window.luna?.getSkinTextures) return;
  try {
    const tex = await window.luna.getSkinTextures(uuid);
    if (!tex?.ok || !tex.skinUrl) {
      window.luna?.logClient?.(`[3D스킨] mountSkinViewer: getSkinTextures 실패/skinUrl 없음 uuid=${uuid} ok=${tex?.ok}`);
      return; // crafatar <img> 폴백 유지
    }

    // 24-54차: "스킨 아직도 3D로 안보여" - 원격 https:// URL을 <img crossOrigin="anonymous">로
    // 바로 읽어 WebGL 텍스처로 쓰면, CORS 응답이 조금만 어긋나도 캔버스가 "오염"돼서 조용히
    // 실패할 수 있음. main.js가 대신 내려받아 준 data: URL(skinDataUrl/capeDataUrl)이 있으면
    // 그쪽을 우선 씀 - data: URL은 애초에 크로스 오리진이 아니라서 이 문제가 구조적으로 없음
    const skinSrc = tex.skinDataUrl || tex.skinUrl;
    const capeSrc = tex.capeDataUrl || tex.capeUrl;

    let viewer = skinViewerInstances.get(canvasEl);
    if (!viewer) {
      viewer = new skinview3d.SkinViewer({
        canvas: canvasEl,
        width: size.w,
        height: size.h,
        skin: skinSrc,
        model: "auto-detect",
      });
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.controls.enableRotate = false;
      // 24-69차: "스킨은 이제부터 대각선 모습만 보여주고 돌리지마" - 예전엔 정면만 보여주면
      // 등 쪽 망토가 안 보여서 계속 회전시켰는데, 이제는 회전 없이 고정된 대각선 각도만 보여줌
      viewer.autoRotate = false;
      viewer.playerObject.rotation.y = -Math.PI / 5;
      skinViewerInstances.set(canvasEl, viewer);
    } else {
      await viewer.loadSkin(skinSrc, { model: "auto-detect" });
    }
    if (capeSrc) await viewer.loadCape(capeSrc);
    else viewer.loadCape(null);

    canvasEl.hidden = false;
    imgEl.hidden = true;
  } catch (err) {
    // 24-54차: 예전엔 여기서 조용히 손을 떼서(crafatar 폴백만 보임) 원인을 알 방법이 없었음 -
    // 이제 실패 이유를 launcher.log에 남겨서, 다음에 "3D로 안 보여요"라는 얘기가 나오면 로그로
    // 바로 원인(라이브러리 예외/텍스처 로드 실패/캔버스 오염 등)을 확인할 수 있게 함
    window.luna?.logClient?.(`[3D스킨] mountSkinViewer 예외 uuid=${uuid}: ` + (err?.message || err));
  }
}

// 19차: 스킨 팝업의 기본 스킨/내가 추가한 스킨 목록은 이미 로컬에 원본 PNG(dataUrl)를 갖고
// 있어서, mountSkinViewer처럼 UUID로 Mojang 세션 서버를 조회할 필요 없이 skinview3d에
// 바로 그 이미지를 로드함 ("스킨에 튀어나온 부분들 다 어디갔어" - 얼굴만 오려낸 2D 아이콘
// 대신 모자/소매 등 겉레이어까지 포함된 실제 3D 렌더를 보여주기 위함)
function mountSkinPresetViewer(canvasEl, dataUrl, variant) {
  if (!canvasEl || !dataUrl || typeof skinview3d === "undefined") return;
  try {
    const model = variant === "slim" ? "slim" : "default";
    let viewer = skinViewerInstances.get(canvasEl);
    if (!viewer) {
      viewer = new skinview3d.SkinViewer({
        canvas: canvasEl,
        width: canvasEl.width || 54,
        height: canvasEl.height || 74,
        skin: dataUrl,
        model,
      });
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.controls.enableRotate = false;
      // 24-69차: 위 mountSkinViewer와 동일하게 회전 없이 고정 대각선 각도만 보여줌
      viewer.autoRotate = false;
      viewer.playerObject.rotation.y = -Math.PI / 5;
      skinViewerInstances.set(canvasEl, viewer);
    } else {
      viewer.loadSkin(dataUrl, { model });
    }
  } catch (err) {
    // 조용히 실패 - 빈 캔버스로 남음
  }
}

// 19차: 프리셋/커스텀 목록을 다시 그릴 때마다 캔버스를 통째로 새로 만들다 보니, 예전 캔버스에
// 연결된 skinview3d 인스턴스(WebGL 컨텍스트)가 skinViewerInstances에 계속 쌓이던 누수를 막기
// 위해, 컨테이너를 비우기 직전에 그 안의 캔버스들부터 먼저 정리(dispose)함
function disposeSkinViewersIn(container) {
  if (!container) return;
  container.querySelectorAll("canvas").forEach((canvasEl) => {
    const viewer = skinViewerInstances.get(canvasEl);
    if (viewer) {
      try { viewer.dispose(); } catch (err) {}
      skinViewerInstances.delete(canvasEl);
    }
  });
}

// ---- 24-61차 신규: 스킨 박스(내 스킨/다른 사람 스킨) 로딩 스피너 --------------------------
// "내 스킨이나 다른 사람들 스킨 로딩할 때도" - crafatar 이미지가 뜨기 전(네트워크 왕복
// 동안)엔 빈 박스만 보이고 있어서, 로딩 중이라는 걸 알 수 있는 스피너를 얹음. 3D 캔버스
// (skinview3d)는 이 img가 다 뜬 다음 조용히 교체되는 점진적 개선이라(위 mountSkinViewer
// 참고), 스피너는 img의 load/error 시점까지만 있으면 충분함 - 그 이후엔 이미 img(최소한
// crafatar 2D 렌더)가 화면에 떠 있어서 빈 화면으로 보일 일이 없음
function bindSkinLoadingSpinner(imgEl, spinnerEl) {
  if (!imgEl || !spinnerEl) return;
  const hide = () => { spinnerEl.hidden = true; };
  imgEl.addEventListener("load", hide);
  imgEl.addEventListener("error", hide);
}
function showSkinLoadingSpinner(spinnerEl) {
  if (spinnerEl) spinnerEl.hidden = false;
}

// ---- 약관 동의 화면 (첫 실행 + 설정에서 다시 보기) -----------------------------
const termsOverlay = document.getElementById("terms-overlay");
const termsCheckbox = document.getElementById("terms-checkbox");
const btnTermsAgree = document.getElementById("btn-terms-agree");
const termsLicenseEl = document.getElementById("terms-license");
const btnTermsClose = document.getElementById("btn-terms-close");

window.luna.getLicense?.().then((text) => {
  if (termsLicenseEl && text) termsLicenseEl.textContent = text;
});

// 9-4: 설정에서 다시 열었을 때는(alreadyAgreed) 체크박스를 건드려도 절대 못 나가는 상황이
// 없도록, 체크박스 상태와 상관없이 항상 눌러서 닫을 수 있는 별도 X 버튼을 보여줌.
// 첫 실행 때(alreadyAgreed=false)는 원래 의도대로 닫기 버튼 없이, 동의해야만 진행되게 둠.
// 10-7: 첫 실행 약관 화면이 떠 있는 동안은(아직 동의 전) 옆 사이드바로 다른 화면에
// 못 가게 숨김/비활성화함. 설정에서 다시 보는 경우(alreadyAgreed)는 이미 동의한 상태라
// 사이드바를 그대로 둠
function setSidebarLockedForTerms(locked) {
  const sidebarEl = document.querySelector(".sidebar");
  if (!sidebarEl) return;
  sidebarEl.style.visibility = locked ? "hidden" : "";
  sidebarEl.querySelectorAll("button").forEach((b) => (b.disabled = locked));
}

function showTerms({ alreadyAgreed }) {
  if (!termsOverlay) return;
  termsOverlay.hidden = false;
  if (alreadyAgreed) {
    termsCheckbox.checked = true;
    btnTermsAgree.disabled = false;
    btnTermsAgree.textContent = "닫기";
    if (btnTermsClose) btnTermsClose.hidden = false;
  } else {
    termsCheckbox.checked = false;
    btnTermsAgree.disabled = true;
    btnTermsAgree.textContent = "동의하고 시작하기";
    if (btnTermsClose) btnTermsClose.hidden = true;
    setSidebarLockedForTerms(true);
  }
}

termsCheckbox?.addEventListener("change", () => {
  // 설정에서 다시 보는 중(이미 X 버튼이 떠 있음)이면 체크박스를 풀어도 메인 버튼을 잠그지 않음 -
  // 첫 실행 때만 체크 전까지 진행을 막는 원래 동작을 유지
  if (btnTermsClose && !btnTermsClose.hidden) return;
  btnTermsAgree.disabled = !termsCheckbox.checked;
});
btnTermsAgree?.addEventListener("click", async () => {
  await window.luna.agreeTerms();
  termsOverlay.hidden = true;
  setSidebarLockedForTerms(false);
  await maybeShowThemeOnboarding();
});
btnTermsClose?.addEventListener("click", () => {
  termsOverlay.hidden = true;
});

document.getElementById("btn-view-terms")?.addEventListener("click", () => {
  showTerms({ alreadyAgreed: true });
});

// 24-11차 신규: 최초 실행 시 한 번만 뜨는 무료 테마(다크/화이트) 선택 화면. 약관에 처음
// 동의한 직후(위 btnTermsAgree) 바로 이어서 뜨고, 아직 못 본 상태로 남아있으면 시작할 때도
// 한 번 더 확인함. 테마 버튼 자체의 클릭 동작(저장/적용)은 위 ".theme-option" 공용
// 핸들러가 그대로 처리해줌(onboarding 버튼도 같은 클래스를 씀)
const themeOnboardingOverlay = document.getElementById("theme-onboarding-overlay");
async function maybeShowThemeOnboarding() {
  if (!themeOnboardingOverlay) return;
  const seen = await window.luna.getThemeOnboardingSeen?.();
  if (!seen) themeOnboardingOverlay.hidden = false;
}
document.getElementById("btn-theme-onboarding-done")?.addEventListener("click", async () => {
  await window.luna.setThemeOnboardingSeen?.();
  if (themeOnboardingOverlay) themeOnboardingOverlay.hidden = true;
});

(async () => {
  const agreed = await window.luna.getTermsAgreed();
  if (!agreed) {
    showTerms({ alreadyAgreed: false });
  } else {
    await maybeShowThemeOnboarding();
  }
})();

// ---- 엘리먼트 참조 -------------------------------------------------------
const viewLogin = document.getElementById("view-login");
const viewHome = document.getElementById("view-home");

// 24-4차: 마이크로소프트 로그인 버튼(btnLogin)이 있던 자리가 사이트 계정 로그인/회원가입
// 폼으로 바뀜 - 아래 "사이트 계정 로그인" 섹션에서 이 엘리먼트들을 씀
const siteLoginTabLogin = document.getElementById("site-login-tab-login");
const siteLoginTabRegister = document.getElementById("site-login-tab-register");
const siteLoginTabsEl = document.querySelector(".site-login-tabs");
const siteLoginForm = document.getElementById("site-login-form");
const siteLoginEmailInput = document.getElementById("site-login-email");
const siteLoginIdInput = document.getElementById("site-login-id");
const siteLoginPasswordInput = document.getElementById("site-login-password");
const btnSiteLoginSubmit = document.getElementById("btn-site-login-submit");
const siteLoginError = document.getElementById("site-login-error");

const btnLogout = document.getElementById("btn-logout");
const btnPlay = document.getElementById("btn-play");
const gameError = document.getElementById("game-error");

const avatarEl = document.getElementById("avatar");
const profileNameEl = document.getElementById("profile-name");

const playArea = document.getElementById("play-area");
const btnPlayFill = document.getElementById("btn-play-fill");
const btnPlayLabel = document.getElementById("btn-play-label");
const progressCaption = document.getElementById("progress-caption");

const PHASE_LABELS = {
  java: "자바(Java 21) 준비 중",
  "mods-meta": "Fabric 로더 준비 중",
  mods: "모드 설치 중",
  resourcepacks: "리소스팩 설치 중",
  game: "마인크래프트 파일 다운로드 중",
};

// ---- 화면 전환 -----------------------------------------------------------
let currentProfile = null;

// 24-4차: 지금 로그인해있는 사이트 계정(및 연동된 마인크래프트/디스코드 계정 목록) - 게스트
// 배너 표시, 설정 화면의 사이트 계정 패널 등에서 씀. 사이트 로그인/등록/연동/연동해제할 때마다
// 이 변수를 최신 값으로 갱신함.
let currentSiteAccount = null;

// 24-15차: "로그인 안하면 다른 거 못하게 해달라니까 자유롭게 돌아다녀지네? 게스트
// 없애라고" - "게스트로 홈을 구경만 하는" 상태 자체를 없앰. 이제 지금 로그인한
// 마인크래프트 계정(currentProfile)이 실제로 이 사이트 계정에 연동된 계정과 일치할 때만
// "연동됨"으로 침. currentProfile.uuid만 보지 않고 currentSiteAccount.links까지 대조하는
// 이유: 로컬에 마인크래프트 로그인 세션은 남아있어도, 그 계정이 이미 다른 마인크래프트
// 계정이 연동된 사이트 계정이라 서버가 연동을 거절한 경우(계정당 1개 제한)까지 걸러내기
// 위함 - 그런 경우엔 로그인은 됐지만 "연동된 계정"은 아니므로 홈에 들여보내면 안 됨.
// 24-21차: "아직도 마크 로그인해도 들어가지지가 않아" - 이 함수가 진짜 원인이었음. UUID를
// 있는 그대로 문자열 비교(===)하고 있었는데, main.js는 같은 비교를 할 때 항상
// normalizeUuid()(대시 제거 + 소문자)를 거친 뒤에 비교함(applySiteAccountRow의
// cachedSiteAccountLinkedUuids가 그 예). 마이크로소프트/Mojang 인증에서 돌아오는
// currentProfile.uuid는 대시 없는 형식인데, 서버에 저장된 provider_uid가 대시 있는 표준
// UUID 형식이면(혹은 그 반대) 실제로는 같은 계정인데도 문자열이 달라 항상 false만 나옴 -
// 연동은 서버에 정상적으로 성공했는데도 클라이언트가 "연동 안 됨"으로 오판해서 계속
// view-mc-gate로 되돌리고 있었던 것. main.js와 동일한 방식으로 대시/대소문자를 무시하고
// 비교하도록 고침.
function normalizeUuidForCompare(u) {
  return String(u || "").replace(/-/g, "").toLowerCase();
}
function hasLinkedMcAccount() {
  if (!currentProfile?.uuid) return false;
  const links = currentSiteAccount?.links || [];
  const myUuid = normalizeUuidForCompare(currentProfile.uuid);
  return links.some(
    (l) => (l.provider === "minecraft" || l.provider === "mc") && normalizeUuidForCompare(l.provider_uid) === myUuid
  );
}

// 24-23차: "연동을 해제하면 내가 연동한 다른 마크 계정으로 가지고 아니면 마크 연동창으로
// 가야지" - 지금 쓰던 마인크래프트 계정의 연동을 해제했을 때, 이 사이트 계정에 아직 연동돼
// 있으면서 이 PC에도 로그인 기록이 남아있는(=다시 로그인 안 해도 바로 전환 가능한) 다른
// 계정이 있으면 그걸로 자동 전환함. 그런 계정이 없으면(연동된 다른 계정이 아예 없거나,
// 있어도 이 PC에서 로그인해본 적이 없어 토큰이 없음) null을 돌려줘서 호출부가 대신
// view-mc-gate로 보내도록 함.
async function trySwitchToAnotherLinkedAccount(account) {
  const mcLinks = (account?.links || []).filter((l) => l.provider === "minecraft" || l.provider === "mc");
  if (mcLinks.length === 0) return null;
  let localAccounts = [];
  try {
    localAccounts = (await window.luna.listAccounts()) || [];
  } catch (_) {
    return null;
  }
  for (const link of mcLinks) {
    const linkUuid = normalizeUuidForCompare(link.provider_uid);
    const local = localAccounts.find((a) => normalizeUuidForCompare(a.uuid) === linkUuid);
    if (!local) continue;
    try {
      const res = await window.luna.switchAccount(local.uuid);
      if (res.ok) {
        currentProfile = res.profile;
        updateProfileClusterDisplay();
        refreshCoins();
        applyEquippedShopTheme(); // 24-30차: 이 경로(연동 해제 중 다른 계정으로 자동 전환)도 착용 테마를 새 계정 기준으로 다시 입힘
        return res.profile;
      }
    } catch (_) {
      // 이 계정은 전환 실패(토큰 만료 등) - 다음 후보로 계속 시도
    }
  }
  return null;
}

// 24-4차: 마이크로소프트 로그인/계정 전환 직후, 그 계정이 사이트 계정에 자동으로
// 등록됐는지(=연동 성공 여부)를 반영해줌 - 이미 다른 사이트 계정에 등록된 계정이거나
// 이미 다른 마인크래프트 계정이 연동돼있어서(24-15차: 계정당 1개 제한) 연동이 안 됐으면
// 경고 토스트를 보여줌.
async function refreshSiteLinkStateAfterMcLogin(res) {
  if (res?.siteLinkWarning) showToast(res.siteLinkWarning, "error");
  try {
    const siteRes = await window.luna.getSiteAccount();
    // 24-16차: "로그인하고 마크 로그인했는데 안돼" - account:get-site-account는 메인
    // 프로세스의 세션 캐시가 일시적으로 비어있어도(예: 방금 로그인 직후 타이밍, 네트워크
    // 지연 등) ok:true와 함께 account:null을 돌려줄 수 있음. 예전엔 이걸 "로그아웃됨"으로
    // 오판해서 방금 막 로그인해서 갖고 있던 currentSiteAccount를 그대로 null로 덮어써버렸고,
    // 그러면 hasLinkedMcAccount()도 같이 false가 되면서 곧바로 이어지는 showHome→showAppPanel
    // 게이트가 아무 경고도 없이 로그인 화면으로 조용히 되돌려버렸음(마인크래프트 로그인
    // 자체는 성공했는데 화면만 로그인으로 튕기는 것처럼 보였던 원인). account가 실제로 왔을
    // 때만 갱신하고, 못 받았을 땐 기존 값을 그대로 유지함 - 진짜 로그아웃(다른 기기 로그인
    // 등)은 하트비트 쪽에서 별도로 감지/안내함.
    if (siteRes?.ok && siteRes.account) {
      currentSiteAccount = siteRes.account;
      updateProfileClusterDisplay();
    }
  } catch (_) {}
}

// 24-11차: "프로필 표시를 계정닉네임/마크닉네임으로 바꿔줘" - 위쪽 큰 줄은 노바클
// 사이트 계정 닉네임, 아래 작은 줄은 실제 마인크래프트 닉네임을 보여줌(예전엔 아래 줄이
// "Nova · Fabric" 고정 문구였음). currentProfile/currentSiteAccount가 바뀔 때마다 다시
// 불러서 최신 상태를 반영함(showHome 안 + 사이트 로그인/연동 성공 직후 등)
function updateProfileClusterDisplay() {
  const t = window.NovaI18n?.t;
  const profileMcVersionEl = document.getElementById("profile-mc-version");
  if (currentProfile) {
    const mcNick = currentProfile.name || t?.("home_default_name") || "플레이어";
    const accountNick = currentSiteAccount?.nickname || mcNick;
    if (profileNameEl) profileNameEl.textContent = accountNick;
    if (profileMcVersionEl) profileMcVersionEl.textContent = mcNick;
  } else {
    const accountNick = currentSiteAccount?.nickname || t?.("home_login_required") || "로그인이 필요해요";
    if (profileNameEl) profileNameEl.textContent = accountNick;
    if (profileMcVersionEl) profileMcVersionEl.textContent = t?.("home_guest_name") || "게스트";
  }
}

// 24-30차: "내가 기본적으로 블랙&화이트+보라색으로 했는데 처음 들어갔을 때는 기본이다가
// 갑자기 다른 거 누르니까 제대로 돌아오는데" - 상점에서 산 완전테마(블랙&화이트 등)/포인트색을
// 실제로 화면에 입히는 applyThemeColor()가, 앱이 막 켜져서 홈으로 들어가는 시점(showHome)엔
// 한 번도 안 불리고 있었음. 계정 전환 메뉴 클릭 핸들러(아래 openAccountMenu 안)에만 "계정마다
// 상점에서 산 테마 색이 다를 수 있으니 새 계정 기준으로 다시 적용"하는 코드가 있어서, 그
// 핸들러를 거치는(=계정을 전환하는) 순간에야 비로소 착용해둔 테마가 제대로 입혀졌던 것 -
// 그래서 "처음엔 기본, 뭘 누르면 그제서야 맞게 돌아온다"로 보였던 것임(테스트 환경만의 문제가
// 아니라 코드 자체의 버그라 배포판에도 똑같이 있었을 것). 계정 전환 핸들러에 있던 로직을 여기
// 공용 함수로 빼서, 앱이 처음 뜰 때 홈으로 들어가는 시점(showHome)에도 항상 똑같이 적용되게 함
async function applyEquippedShopTheme() {
  try {
    const state = await window.luna.getShopState();
    if (state?.equipped || state?.equippedMode) {
      const catalog = await window.luna.getShopCatalog();
      const color = state.equipped ? catalog.find((c) => c.id === state.equipped) : null;
      const mode = state.equippedMode ? catalog.find((c) => c.id === state.equippedMode) : null;
      applyThemeColor(color, mode);
    } else {
      applyThemeColor(null, null);
    }
  } catch (_) {
    // 실패해도 화면엔 기본 테마가 그대로 유지될 뿐이라 조용히 무시함(다음 진입/전환 때 재시도됨)
  }
}

function showHome(profile) {
  currentProfile = profile;
  applyEquippedShopTheme();
  // 24-13차: "그 계정 바꿀 때 이렇게 떠(사진처럼)" - 여기서 view-login/view-home 둘만 직접
  // 토글했었는데, 계정을 "프로필 관리"(view-profile-manage) 등 다른 화면을 보던 중에 바꾸면
  // 그 화면이 안 닫힌 채로 새로 켜진 view-home과 같은 자리에(둘 다 position:absolute) 겹쳐서
  // 같이 보이는 버그였음 - showAppPanel로 다른 화면들도 확실히 다 같이 닫히게 함
  // 24-15차: 여기서 view-login/view-home을 직접 다시 토글하면(예전 코드) 바로 위
  // showAppPanel이 게이트 판단으로 view-mc-gate를 대신 보여준 걸 곧바로 덮어써버림 -
  // 화면 표시는 이제 전부 showAppPanel 하나에게 맡기고 여기서는 다시 건드리지 않음
  showAppPanel("view-home");

  // 13차: 이름을 문장 중간에 끼워넣어야 해서(예: "Welcome, {name}!") 고정 data-i18n으로는
  // 안 되던 부분 - t()의 {변수} 치환을 써서 JS에서 매번 채움
  const greetingEl = document.getElementById("home-greeting");
  const t = window.NovaI18n?.t;

  updateProfileClusterDisplay();

  if (profile) {
    const displayName = profile.name || t?.("home_default_name") || "플레이어";
    if (greetingEl) {
      greetingEl.innerHTML = t
        ? t("home_welcome", { name: `<span id="home-greeting-name" class="home-greeting-wave">${escapeHtml(displayName)}</span>` })
        : `환영합니다, <span id="home-greeting-name" class="home-greeting-wave">${escapeHtml(displayName)}</span>님!`;
    }
    if (profile.uuid) {
      avatarEl.innerHTML = `<img src="https://mc-heads.net/avatar/${profile.uuid}/64" alt="${profile.name}" />`;
    } else {
      avatarEl.textContent = (profile.name || "?").charAt(0).toUpperCase();
    }
  } else {
    // 24-15차: "게스트 없애라고" - 마인크래프트 계정이 연동 안 된 상태로는 애초에 이
    // 화면까지 오지 못하고 showAppPanel이 view-mc-gate로 되돌리므로, 이 분기는 사실상
    // 화면에 보이지 않는 방어용 처리로만 남음(profile이 null인 채로 showHome이 불렸을 때
    // 잠깐이라도 이상한 값이 남지 않게)
    const guestName = t?.("home_guest_name") || "게스트";
    if (greetingEl) {
      greetingEl.innerHTML = t
        ? t("home_welcome", { name: `<span id="home-greeting-name" class="home-greeting-wave">${escapeHtml(guestName)}</span>` })
        : `환영합니다, <span id="home-greeting-name" class="home-greeting-wave">${escapeHtml(guestName)}</span>님!`;
    }
    avatarEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-3.6 4.6-5.5 7.5-5.5s6.1 1.9 7.5 5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  loadHomeNewsCards();
  refreshFriends();
  if (profile?.uuid) sendFriendsHeartbeat();

  // 2-6(7차): "업데이트 연동"이 켜진 공유받은 프로필들을 앱 시작 시 한 번 조용히 최신화
  // (실패해도 화면엔 영향 없게 fire-and-forget)
  window.luna.checkShareUpdates?.().catch(() => {});
}

async function loadHomeNewsCards() {
  const gridEl = document.getElementById("home-news-grid");
  if (!gridEl || gridEl.dataset.loaded) return;
  const changelog = await window.luna.getChangelog();
  const recent = (changelog || []).slice(-6).reverse(); // 최신 6개까지만
  gridEl.innerHTML = "";
  recent.forEach((entry) => {
    const el = document.createElement("div");
    el.className = "home-news-card";
    el.title = "눌러서 업데이트 내역 보기";
    // 23차: "업데이트 내용을 더 많이 보여주던가" - 카드가 grid-auto-rows:1fr로 세로로
    // 늘어나면서(style.css .home-news-grid 참고) 항목 하나짜리 요약만으론 카드 아래쪽이
    // 휑하게 비어 보였음. 첫 항목 하나 대신 최대 4개까지 불릿으로 보여줌
    const descText = (entry.items || []).slice(0, 4).map((it) => `• ${it}`).join("\n");
    el.innerHTML = `
      <div class="home-news-card-head">
        <span class="home-news-card-version">v${entry.version}</span>
        <span class="home-news-card-date">${entry.date}</span>
      </div>
      <div class="home-news-card-desc">${escapeHtml(descText)}</div>
    `;
    el.addEventListener("click", () => openUpdates());
    gridEl.appendChild(el);
  });
  gridEl.dataset.loaded = "1";
}

function showLogin() {
  currentProfile = null;
  showAppPanel("view-login");
}

// ---- 친구 --------------------------------------------------------------
const homeFriendsList = document.getElementById("home-friends-list");
const homeFriendsRequests = document.getElementById("home-friends-requests");
const homeFriendsEmpty = document.getElementById("home-friends-empty");
const homeFriendsOnlineEl = document.getElementById("home-friends-online");
const homeFriendAddInput = document.getElementById("home-friend-add-input");
const homeFriendAddError = document.getElementById("home-friend-add-error");
// 24-53차: "친구 | 친구추가 | 차단 관련" 세 블록으로 나누면서 "+" 토글 팝오버는 없어지고
// 항상 보이는 입력창으로 바뀜 - 차단 섹션도 같은 모양의 입력 행을 씀
const homeFriendBlockInput = document.getElementById("home-friend-block-input");
const homeFriendBlockError = document.getElementById("home-friend-block-error");
const homeFriendsBlockedList = document.getElementById("home-friends-blocked-list");
const homeFriendsBlockedEmpty = document.getElementById("home-friends-blocked-empty");
const homeFriendsAddTabDot = document.getElementById("home-friends-add-tab-dot");
// 24-61차: "귓속말 오면 친구창에 빨간색 점 뜨게 해줘" - 기존엔 안 읽은 귓속말을 보낸 친구
// 그 사람 줄(.friend-row-unread-dot)에만 빨간 점이 붙어서, "친구" 탭 자체를 보고 있지 않으면
// (예: "친구추가"/"차단" 탭을 보고 있거나 친구창을 아예 안 열어놨으면) 새 귓속말이 와도 전혀
// 알아챌 방법이 없었음. 받은 친구요청 알림(home-friends-add-tab-dot)과 동일한 패턴으로
// "친구" 탭 버튼 자체에도 점을 하나 더 붙임
const homeFriendsTabDot = document.getElementById("home-friends-tab-dot");

// 24-53차 후속: "3개를 세로 말고 가로로 나눈 다음에 각각의 창이 밑에 뜨게 하는 방식" -
// 인벤토리 탭(showInventoryTab)과 완전히 같은 패턴: 위쪽 가로 탭 3개 중 고른 것만
// is-active + 그 아래 대응하는 패널만 보이고 나머지는 hidden
// 24-56차: "친구창 넘어갈 때도 페이드인 아웃 밝기라던가 이런 애니메이션 좀 넣어주고" -
// 그냥 hidden만 뚝 바뀌던 걸, 새로 보이게 되는 패널에 한해 페이드인+밝기 애니메이션
// (.is-tab-entering, style.css)을 입혀줌. [hidden]은 display:none이라 트랜지션이 안
// 먹으므로 hidden을 먼저 풀고 나서 클래스를 다시 붙이고, void offsetWidth로 리플로우를
// 강제해서 같은 탭을 연달아 눌러도 애니메이션이 매번 처음부터 재생되게 함
function showFriendsTab(tab) {
  document.querySelectorAll(".home-friends-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.friendsTab === tab));
  [
    ["friends", document.getElementById("home-friends-panel-friends")],
    ["add", document.getElementById("home-friends-panel-add")],
    ["block", document.getElementById("home-friends-panel-block")],
  ].forEach(([key, panel]) => {
    if (!panel) return;
    if (key === tab) {
      panel.hidden = false;
      panel.classList.remove("is-tab-entering");
      void panel.offsetWidth;
      panel.classList.add("is-tab-entering");
    } else {
      panel.hidden = true;
      panel.classList.remove("is-tab-entering");
    }
  });
}
document.querySelectorAll(".home-friends-tab").forEach((tab) => {
  tab.addEventListener("click", () => showFriendsTab(tab.dataset.friendsTab));
});

// 지금 게임이 실제로 실행 중인지 (친구 목록에 "OO 플레이 중"으로 보여주는 데 씀)
let isInGame = false;

// 친구에게 보여줄 내 상태 문구 계산 - 게임 중이면 서버/프로필 이름과 함께, 아니면 대기 중으로
// 17차: 문구(text)뿐 아니라 kind("server"|"profile")/ref(서버 또는 프로필 id)/version(마크 버전)도
// 같이 계산해서 돌려줌 - 친구 목록의 "참가하기"가 문구 파싱이 아니라 이 값들로 정확히 동작하게 함
async function getMyStatus() {
  if (!currentProfile?.uuid) return { text: "", kind: null, ref: null, version: null };
  if (!isInGame) return { text: "런처에서 대기 중", kind: null, ref: null, version: null };
  try {
    const mode = await window.luna.getLaunchMode?.();
    // 17차: "친구에게 상태 공유 안 함"이 켜져 있으면, 온라인 표시는 유지하되 뭘 하는지는 숨김
    const settings = await window.luna.getSettings?.();
    if (settings?.hidePresence) return { text: "런처 사용 중", kind: null, ref: null, version: null };
    if (mode === "profile") {
      const p = lastProfilesData.find((x) => x.selected);
      const label = p?.name || profileChipName?.textContent;
      return { text: label ? `${label} 플레이 중` : "플레이 중", kind: "profile", ref: p?.id || null, version: p?.mcVersion || null };
    }
    const s = lastServersData.find((x) => x.selected);
    const label = s?.name || serverChipName?.textContent;
    return { text: label ? `${label} 플레이 중` : "플레이 중", kind: "server", ref: s?.id || null, version: s?.version || null };
  } catch (_) {
    return { text: "플레이 중", kind: null, ref: null, version: null };
  }
}
// 하위 호환: 문구만 필요한 기존 호출부를 위해 유지
async function getMyStatusText() {
  return (await getMyStatus()).text;
}
async function sendFriendsHeartbeat() {
  const s = await getMyStatus();
  window.luna.friendsHeartbeat?.(s.text, s.kind, s.ref, s.version);
}

// 17차: 온라인/자리비움/오프라인 3단계 점 색(요청대로 초록/노랑/빨강)
function presenceDotClass(presence) {
  if (presence === "online") return "friend-row-dot is-online";
  if (presence === "away") return "friend-row-dot is-away";
  return "friend-row-dot is-offline";
}

// 24-69차: "친구는 무조건 온라인 오프라인으로 나눠주고 플레이중, 런처 대기중, 잠수, 오프라인
// 순으로 정리해줘" - 정렬 우선순위만 매기는 함수. presence(away 판정 등)는 이미 main.js
// friends:list 핸들러가 계산해서 내려주므로(FRIEND_ONLINE_WINDOW_MS/FRIEND_AWAY_WINDOW_MS)
// 여기선 순서만 정함. statusKind가 있으면(getMyStatus 참고) 게임 중, 없으면 런처 대기 중
function friendSortRank(entry) {
  const presence = entry.presence || (entry.online ? "online" : "offline");
  if (presence === "online" && entry.statusKind) return 0; // 플레이중
  if (presence === "online") return 1; // 런처 대기중
  if (presence === "away") return 2; // 잠수
  return 3; // 오프라인
}

function friendRowHtml(entry, kind, unreadUuids) {
  const presence = kind === "friend" ? entry.presence || (entry.online ? "online" : "offline") : null;
  const dotClass = kind === "friend" ? presenceDotClass(presence) : "friend-row-dot";
  // 15-6(6차): 이 친구가 안 읽은 귓속말을 보냈으면 출석체크 표시처럼 작은 빨간 점을 붙임
  const hasUnread = kind === "friend" && unreadUuids?.has?.(entry.uuid);
  let actions = "";
  if (kind === "incoming") {
    actions = `<button type="button" class="accept" data-action="accept" data-id="${entry.id}" title="수락">✓</button><button type="button" class="decline" data-action="decline" data-id="${entry.id}" title="거절">✕</button>`;
  } else if (kind === "outgoing") {
    actions = `<button type="button" class="decline" data-action="cancel" data-id="${entry.id}" title="요청 취소">취소</button>`;
  }
  // 24-69차: "친구창에서 친구 옆에 X 버튼 저거 없애 필요없어" - 친구 삭제는 우클릭 메뉴
  // (friend-context-menu, 24-61차)로 이미 가능해서 행마다 있던 단축 ✕ 버튼은 제거함.
  // kind === "friend"일 땐 actions가 비어 있으므로 아래에서 .friend-row-actions 자체를 생략함
  const statusLine =
    kind === "friend" && entry.online && entry.status ? `<span class="friend-row-status">${escapeHtml(entry.status)}</span>` : "";
  // 17차: 참가하기를 문구 파싱이 아니라 statusKind/statusRef/statusVersion으로 정확히 처리하기 위해 데이터 속성으로 실어보냄
  // 24-53차: entry.name/status는 상대가 정한 닉네임/상태문구(외부 입력)라 속성/본문에 그대로
  // 꽂으면 안 되고 escapeHtml을 거쳐야 함 - 예전엔 이 부분만 이스케이프가 빠져 있었음
  // 24-61차: 우클릭 메뉴의 "친구 삭제하기"가 friendsRemove(친구 행 id)를 부르려면 노바 계정
  // id(data-whisper-uuid)가 아니라 이 friends 테이블 행 자체의 id가 필요해서 새로 추가함
  const clickableAttrs =
    kind === "friend"
      ? ` data-friend-id="${escapeHtml(entry.id || "")}" data-whisper-uuid="${escapeHtml(entry.uuid || "")}" data-whisper-name="${escapeHtml(entry.name || "")}" data-friend-status="${escapeHtml(
          entry.online ? entry.status || "" : ""
        )}" data-friend-status-kind="${escapeHtml(entry.statusKind || "")}" data-friend-status-ref="${escapeHtml(entry.statusRef || "")}" data-friend-status-version="${escapeHtml(entry.statusVersion || "")}"`
      : "";
  return `
    <div class="friend-row${kind === "friend" ? " is-clickable" : ""}"${clickableAttrs}>
      <span class="friend-row-main">
        <span class="friend-row-name"><span class="${dotClass}"></span>${escapeHtml(entry.name || "")}${kind === "outgoing" ? " (대기 중)" : ""}${hasUnread ? `<span class="friend-row-unread-dot" title="안 읽은 귓속말이 있어요"></span>` : ""}</span>
        ${statusLine}
      </span>
      ${actions ? `<span class="friend-row-actions">${actions}</span>` : ""}
    </div>
  `;
}

// 24-53차 신규: "차단 관련" 목록 행 - 친구 행과 같은 모양을 쓰되 온라인 점 대신 "차단 해제"
// 버튼만 둠. 차단 해제는 새 IPC 없이 기존 friends:remove(행 삭제)를 그대로 재사용
function blockedRowHtml(entry) {
  return `
    <div class="friend-row">
      <span class="friend-row-main">
        <span class="friend-row-name">${escapeHtml(entry.name)}</span>
      </span>
      <span class="friend-row-actions">
        <button type="button" class="decline" data-action="unblock" data-id="${entry.id}" data-i18n="btn_unblock">차단 해제</button>
      </span>
    </div>
  `;
}

async function refreshFriends() {
  if (!currentProfile?.uuid || !homeFriendsList) return;
  const { friends, incoming, outgoing, blocked } = await window.luna.friendsList();

  if (homeFriendsOnlineEl) homeFriendsOnlineEl.textContent = friends.filter((f) => f.online).length;

  // 24-53차: "차단 관련" 섹션 - 친구/요청과 완전히 분리된 별도 목록으로 렌더링
  if (homeFriendsBlockedList) {
    homeFriendsBlockedList.innerHTML = (blocked || []).map(blockedRowHtml).join("");
    if (homeFriendsBlockedEmpty) homeFriendsBlockedEmpty.hidden = (blocked || []).length !== 0;
  }

  homeFriendsRequests.innerHTML = [
    incoming.length ? `<div class="home-friends-requests-title">받은 친구 요청</div>` : "",
    ...incoming.map((r) => friendRowHtml(r, "incoming")),
    outgoing.length ? `<div class="home-friends-requests-title">보낸 친구 요청</div>` : "",
    ...outgoing.map((r) => friendRowHtml(r, "outgoing")),
  ].join("");
  // 24-53차 후속: 받은 요청이 "친구추가" 탭 안으로 숨겨지면서, 지금 "친구" 탭을 보고 있으면
  // 받은 요청이 와도 알아챌 방법이 없어짐 - 인벤토리 출석 탭과 같은 방식(.notif-dot)으로 알림
  if (homeFriendsAddTabDot) homeFriendsAddTabDot.hidden = incoming.length === 0;

  // 15-6(6차): 친구 목록을 새로고침할 때마다 "안 읽은 귓속말을 보낸 친구" 목록을 같이 물어옴
  // (완전 실시간은 아니고, 이 목록이 로드/새로고침될 때 기준 - whisper:unread-senders 주석 참고)
  let unreadUuids = new Set();
  try {
    const friendUuids = friends.map((f) => f.uuid).filter(Boolean);
    if (friendUuids.length) {
      const unread = await window.luna.whisperUnreadSenders?.(friendUuids);
      if (Array.isArray(unread)) unreadUuids = new Set(unread);
    }
  } catch (_) {
    // 실패해도 빨간 점만 안 뜰 뿐 친구 목록 자체는 정상 표시
  }
  // 24-61차: 안 읽은 귓속말이 하나라도 있으면 "친구" 탭 버튼에도 점을 띄움(리스트 안의
  // 개별 줄 점과 별개로, 탭을 안 보고 있어도 눈에 띄도록)
  if (homeFriendsTabDot) homeFriendsTabDot.hidden = unreadUuids.size === 0;

  // 24-69차: "온라인 오프라인으로 나눠주고 플레이중, 런처 대기중, 잠수, 오프라인 순으로"
  const sortedFriends = [...friends].sort((a, b) => friendSortRank(a) - friendSortRank(b));
  const onlineFriends = sortedFriends.filter((f) => friendSortRank(f) < 3);
  const offlineFriends = sortedFriends.filter((f) => friendSortRank(f) === 3);
  homeFriendsList.innerHTML = [
    onlineFriends.length ? `<div class="home-friends-list-title">온라인</div>` : "",
    ...onlineFriends.map((f) => friendRowHtml(f, "friend", unreadUuids)),
    offlineFriends.length ? `<div class="home-friends-list-title">오프라인</div>` : "",
    ...offlineFriends.map((f) => friendRowHtml(f, "friend", unreadUuids)),
  ].join("");

  // 24-53차: "친구" 섹션이 요청 목록과 분리됐으니, 여기 빈 상태는 이제 친구 수만 기준으로 판단
  homeFriendsEmpty.hidden = friends.length !== 0;
}

async function handleFriendAction(action, id) {
  if (action === "accept") {
    const res = await window.luna.friendsAccept(id);
    if (res.ok) showToast("친구 요청을 수락했어요");
  } else if (action === "unfriend") {
    // 17-3(4차): 친구 삭제는 바로 실행하지 않고, 다른 곳에서 쓰는 것과 같은 확인창을 먼저 띄움
    const confirmed = await showConfirm("정말 친구를 삭제할까요?", "삭제", "취소");
    if (!confirmed) return;
    const res = await window.luna.friendsRemove(id);
    if (res.ok) showToast("친구를 삭제했어요");
  } else if (action === "unblock") {
    const res = await window.luna.friendsRemove(id);
    if (res.ok) showToast("차단을 해제했어요");
  } else {
    await window.luna.friendsRemove(id);
  }
  refreshFriends();
}

document.addEventListener("click", (e) => {
  // 친구 삭제/수락 등 액션 버튼이 우선 (이 버튼을 눌렀을 때 귓속말이 같이 열리면 안 되니까 먼저 처리하고 끝)
  const actionBtn = e.target.closest?.("[data-action][data-id]");
  if (actionBtn && actionBtn.closest(".home-friends")) {
    handleFriendAction(actionBtn.dataset.action, actionBtn.dataset.id);
    return;
  }
  // 14차: "프로필 눌렀을 때 3번(이름/귓속말/프로필보기 팝업) 스킵하고 4번(전체 프로필
  // 팝업)으로 바로 가게 해줘" - 예전엔 여기서 작은 중간 팝업(openFriendStatusPopup)을 먼저
  // 띄우고, 그 팝업의 "프로필 보기"를 한 번 더 눌러야 스킨/코인/작성글이 보이는 전체
  // 프로필로 갔음. 이제 친구 이름을 누르면 곧바로 전체 프로필 팝업으로 가고, 서버에서
  // 플레이 중이면 그 팝업에 "참가하기" 버튼이 같이 뜸(openForumUserPopup의 server 인자)
  const friendRow = e.target.closest?.(".friend-row.is-clickable");
  if (friendRow) {
    // 24-23차: 친구 목록의 data-whisper-uuid는 이제 마인크래프트 uuid가 아니라 노바 계정 id임
    // (friends:list 참고) - openForumUserPopup은 스킨/게시글 조회 때문에 여전히 마인크래프트
    // uuid가 필요해서, 그 계정에 연동된 대표 마인크래프트 캐릭터를 먼저 찾아서 넘겨줌
    const accountId = friendRow.dataset.whisperUuid;
    const name = friendRow.dataset.whisperName;
    // 17차: "참가하기"를 문구 파싱이 아니라 statusKind/statusRef로 정확히 판단
    const playing = buildFriendPlayingInfo(
      friendRow.dataset.friendStatusKind,
      friendRow.dataset.friendStatusRef,
      friendRow.dataset.friendStatusVersion,
      friendRow.dataset.friendStatus
    );
    openFriendProfileByAccountId(accountId, name, playing);
  }
});

// 24-23차 신규: 친구 목록 클릭 -> 노바 계정 id를 대표 마인크래프트 캐릭터로 바꾼 뒤 전체
// 프로필 팝업을 염. 아직 마인크래프트 계정을 하나도 연동하지 않은 친구(사이트 계정만 있는
// 경우)는 보여줄 스킨/게시글이 없으므로, 팝업을 열지 않고 안내만 함
async function openFriendProfileByAccountId(accountId, name, playing) {
  if (!accountId) return;
  let resolved = null;
  try {
    resolved = await window.luna.resolveAccountMinecraft?.(accountId);
  } catch (_) {
    resolved = null;
  }
  if (!resolved?.ok) {
    showToast(`${name}님은 아직 마인크래프트 계정을 연동하지 않았어요.`);
    return;
  }
  openForumUserPopup(resolved.uuid, resolved.name || name, playing);
}

// 17차: 친구의 statusKind/statusRef를 실제 "참가 가능한 대상"으로 변환.
// - kind==="server"이고 그 ref가 우리 서버 목록에 있으면: 그 서버로 바로 참가 가능
// - kind==="profile"이면: 같은 마인크래프트 버전의 내 프로필이 있으면 그걸로 참가 가능
//   (내가 그 프로필을 직접 갖고 있진 않아도, 버전만 맞으면 참가 가능하다고 안내)
// - 그 외(예: 친구가 우리 클라이언트 밖의 외부 서버에 있는 경우)엔 아직 추적할 방법이 없어서 null
function buildFriendPlayingInfo(kind, ref, version, statusText) {
  if (kind === "server" && ref) {
    const server = lastServersData.find((s) => s.id === ref);
    if (server) return { type: "server", server, label: server.name };
  }
  if (kind === "profile") {
    const myMatch = lastProfilesData.find((p) => p.id === ref) || lastProfilesData.find((p) => p.mcVersion === version);
    if (myMatch) return { type: "profile", profile: myMatch, label: statusText?.replace(/ 플레이 중$/, "") || myMatch.name };
    if (version) return { type: "profile-missing", version, label: statusText?.replace(/ 플레이 중$/, "") || `버전 ${version}` };
  }
  return null;
}

// 14차: 친구 이름을 누르면 이제 이 작은 중간 팝업 없이 바로 전체 프로필 팝업
// (openForumUserPopup)으로 이동함 - 그 팝업에 "참가하기"까지 흡수시켜서 이 팝업 자체를 제거함

// ---- 24-61차 신규: 친구 우클릭(컨텍스트) 메뉴 ------------------------------------
// "친구 우클릭 누르면 귓속말, 참가하기, 친구 삭제하기, 차단하기 등 해주고 귓속말 제외
// 2차 확인 받는 거 띄워줘" 요청 반영. 친구 목록 줄(.friend-row.is-clickable)에서 우클릭하면
// 커서 위치에 4개짜리 메뉴가 뜸. 좌클릭(위 document click 리스너 - 전체 프로필 팝업 열기)과는
// 완전히 별개 동작이라, contextmenu는 preventDefault로 브라우저 기본 메뉴만 막고 좌클릭
// 리스너로는 안 넘어감(별도 이벤트 타입이라 자연히 분리됨)
const friendContextMenu = document.getElementById("friend-context-menu");
let friendContextMenuTarget = null; // { id, accountId, name, playing }

function closeFriendContextMenu() {
  if (friendContextMenu) friendContextMenu.hidden = true;
  friendContextMenuTarget = null;
}

function openFriendContextMenu(row, x, y) {
  if (!friendContextMenu) return;
  const playing = buildFriendPlayingInfo(
    row.dataset.friendStatusKind,
    row.dataset.friendStatusRef,
    row.dataset.friendStatusVersion,
    row.dataset.friendStatus
  );
  friendContextMenuTarget = {
    id: row.dataset.friendId,
    accountId: row.dataset.whisperUuid,
    name: row.dataset.whisperName,
    playing,
  };
  // 지금 참가할 수 있는 대상이 없으면(오프라인/추적 불가한 상태) "참가하기" 항목은 숨김 -
  // openForumUserPopup의 join 버튼(joinBtnEl.hidden) 처리와 동일한 기준
  const joinItem = friendContextMenu.querySelector('[data-friend-ctx-action="join"]');
  if (joinItem) joinItem.hidden = !playing || playing.type === "profile-missing";

  friendContextMenu.hidden = false;
  // 24-21차 창 모서리 처리(.confirm-overlay 등)와 동일하게 body가 기준 좌표계(position:relative)
  // 라서, 메뉴가 그 오른쪽/아래쪽 경계를 넘어가지 않도록 보정함
  const bodyRect = document.body.getBoundingClientRect();
  const menuRect = friendContextMenu.getBoundingClientRect();
  const left = Math.min(Math.max(0, x), Math.max(0, bodyRect.width - menuRect.width - 4));
  const top = Math.min(Math.max(0, y), Math.max(0, bodyRect.height - menuRect.height - 4));
  friendContextMenu.style.left = `${left}px`;
  friendContextMenu.style.top = `${top}px`;
}

document.addEventListener("contextmenu", (e) => {
  const row = e.target.closest?.(".friend-row.is-clickable");
  if (!row || !row.closest(".home-friends")) return;
  e.preventDefault();
  const bodyRect = document.body.getBoundingClientRect();
  openFriendContextMenu(row, e.clientX - bodyRect.left, e.clientY - bodyRect.top);
});
document.addEventListener("click", (e) => {
  if (!friendContextMenu || friendContextMenu.hidden) return;
  if (!friendContextMenu.contains(e.target)) closeFriendContextMenu();
});
// 메뉴가 떠 있는 동안 창 크기가 바뀌면(예: 전체화면 전환) 좌표가 어긋나므로 그냥 닫음
window.addEventListener("resize", closeFriendContextMenu);

friendContextMenu?.addEventListener("click", async (e) => {
  const btn = e.target.closest?.("[data-friend-ctx-action]");
  if (!btn || btn.hidden) return;
  const target = friendContextMenuTarget;
  closeFriendContextMenu();
  if (!target) return;
  const action = btn.dataset.friendCtxAction;

  // 귓속말은 즉시 실행(요청에서 "귓속말 제외"라고 명시함), 나머지 3개는 실행 전 2차 확인
  if (action === "whisper") {
    if (!target.accountId) return;
    openWhisperPopup(target.accountId, target.name);
    return;
  }

  if (action === "join") {
    if (!target.playing) return;
    // 24-63차: "참가하기 누르면 PLAY를 누르는 게 아니라 참가하시겠습니까 이거 뜨게 해줘
    // 누르면 바로 들어가지고" - 확인 후 전환만 하고 끝내지 않고, 곧바로 handlePlayClick()
    // (PLAY 버튼과 동일한 로직)으로 이어서 바로 게임이 시작되게 함
    const confirmed = await showConfirm(`${target.playing.label}에 참가하시겠습니까?`, "참가", "취소");
    if (!confirmed) return;
    if (isSwitchingLaunchTarget) return;
    setLaunchControlsLocked(true);
    let switched = false;
    try {
      if (target.playing.type === "server") {
        const res = await window.luna.selectServer(target.playing.server.id);
        if (res.ok) {
          if (serverChipName) serverChipName.textContent = res.server.name;
          updateMcVersionLabel(res.server.version);
          await refreshChipActiveStates();
          await refreshLaunchTargetLists();
          switched = true;
        } else {
          showToast(res.error || "참가에 실패했어요.", "error");
        }
      } else if (target.playing.type === "profile") {
        const res = await window.luna.selectProfile(target.playing.profile.id);
        if (res.ok) {
          if (profileChipName) profileChipName.textContent = res.profile.name;
          updateMcVersionLabel(res.profile.mcVersion);
          await refreshChipActiveStates();
          await refreshLaunchTargetLists();
          switched = true;
        } else {
          showToast(res.error || "참가에 실패했어요.", "error");
        }
      }
    } finally {
      setLaunchControlsLocked(false);
    }
    if (switched) await handlePlayClick();
    return;
  }

  if (action === "remove") {
    if (!target.id) return;
    // 17-3(4차)에서 이미 쓰던 것과 같은 확인 문구/버튼 라벨을 그대로 재사용
    const confirmed = await showConfirm("정말 친구를 삭제할까요?", "삭제", "취소");
    if (!confirmed) return;
    const res = await window.luna.friendsRemove(target.id);
    if (res.ok) showToast("친구를 삭제했어요");
    refreshFriends();
    return;
  }

  if (action === "block") {
    if (!target.name) return;
    const confirmed = await showConfirm(`${target.name}님을 차단할까요? 차단하면 친구 목록에서 사라지고, 서로 친구 요청도 보낼 수 없어요.`, "차단", "취소");
    if (!confirmed) return;
    const res = await window.luna.friendsBlock(target.name);
    if (res.ok) showToast(`${target.name}님을 차단했어요`);
    else showToast(res.error || "차단에 실패했어요.", "error");
    refreshFriends();
    return;
  }
});

async function submitFriendAdd() {
  const name = homeFriendAddInput.value.trim();
  homeFriendAddError.textContent = "";
  if (!name) return;
  if (!currentProfile?.uuid) {
    homeFriendAddError.textContent = "로그인 후 이용할 수 있어요.";
    return;
  }
  const res = await window.luna.friendsAdd(name);
  if (res.ok) {
    homeFriendAddInput.value = "";
    showToast(res.accepted ? `${name}님과 친구가 되었어요!` : `${name}님에게 친구 요청을 보냈어요`);
    refreshFriends();
  } else {
    homeFriendAddError.textContent = res.error || "친구 추가에 실패했어요.";
  }
}
document.getElementById("btn-home-friend-add")?.addEventListener("click", submitFriendAdd);
homeFriendAddInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitFriendAdd();
});

// 24-53차 신규: "차단 관련" 섹션의 닉네임 입력 + 차단 버튼 - 위 친구 추가와 완전히 같은 모양,
// friends:block IPC만 다르게 호출
async function submitFriendBlock() {
  if (!homeFriendBlockInput) return;
  const name = homeFriendBlockInput.value.trim();
  if (homeFriendBlockError) homeFriendBlockError.textContent = "";
  if (!name) return;
  if (!currentProfile?.uuid) {
    if (homeFriendBlockError) homeFriendBlockError.textContent = "로그인 후 이용할 수 있어요.";
    return;
  }
  const res = await window.luna.friendsBlock(name);
  if (res.ok) {
    homeFriendBlockInput.value = "";
    showToast(`${name}님을 차단했어요`);
    refreshFriends();
  } else if (homeFriendBlockError) {
    homeFriendBlockError.textContent = res.error || "차단에 실패했어요.";
  }
}
document.getElementById("btn-home-friend-block")?.addEventListener("click", submitFriendBlock);
homeFriendBlockInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitFriendBlock();
});

// 친구 목록/온라인/상태 표시가 계속 정확하도록, 주기적으로 내 접속 상태를 알리고 목록을 새로고침함
setInterval(async () => {
  if (!currentProfile?.uuid) return;
  sendFriendsHeartbeat();
  refreshFriends();
}, 45000);

// ---- 시작 시 캐시된 사이트 계정 로그인 확인 --------------------------------
// 24-4차: "클라이언트도 사이트처럼 전용 계정 로그인통해서 하게 할 거고" - 이제 첫 화면
// 게이트가 마이크로소프트 로그인이 아니라 사이트 계정 로그인임. 사이트 계정으로 로그인이
// 안 돼있으면(또는 서버 확인 결과 세션이 이미 끊겨있으면) 무조건 로그인 화면부터 보여주고,
// 로그인해있으면 그 다음에 기존처럼 마인크래프트 계정 캐시를 확인해서 홈 화면을 보여줌.
// 24-27차: "로그인 확인할 때 로그인창 띄우지 마, 이미 로그인 돼있으면 로딩이 뜨다
// 들어가지게 해줘야지" - 이 확인은 IPC 왕복이 있는 비동기 작업이라, 여기(showHome/
// showLogin)가 실제로 불릴 때까지는 항상 #boot-gate 로딩 오버레이만 보이고 있음
// (index.html에서 view-login도 이제 기본 hidden). 결과가 뭐든 이 함수가 끝나는 시점에
// 오버레이를 지워서, 최종적으로 결정된 화면(홈 또는 로그인) 하나만 화면에 나타나게 함.
// 혹시라도 IPC 자체가 실패하면(네트워크 문제 등) 무한 로딩으로 멈추지 않도록 로그인
// 화면으로 안전하게 폴백함.
// 24-54차: "아직도 처음 들어갈 때 출첵 빨간점 뜨는 거 같고" - 이 IIFE가 끝나기 전까지는
// 메인 프로세스의 cachedSiteAccountLinkedUuids가 아직 비어있어서(사이트 계정 검증 IPC
// 왕복이 안 끝남), isUuidLinkedToActiveSiteAccount(uuid)가 그 사이엔 무조건 false로 나옴 -
// 그런데 아래(9797줄 부근)의 "시작할 때 코인/선물상자/테마 반영" IIFE는 이 IIFE와 별개로
// 스크립트 로드 즉시 나란히 시작돼서, 이 확인이 끝나기 전에 refreshCoins()를 먼저 불러버릴
// 수 있었음 - 그러면 사이트 계정에 저장된 진짜 출석 기록 대신 기기별 로컬 저장소를 봐서,
// 이미 사이트 계정으로 출석을 받았어도 "아직 안 받음(canClaimToday:true)"으로 잘못
// 계산되고, 그 뒤로 아무도 다시 refreshCoins()를 안 불러주면 그 빨간 점이 그대로 남아있게
// 됨. 이 확인이 끝났다는 걸 다른 시작 코드가 기다릴 수 있도록 Promise를 변수에 저장해둠
const siteAccountReadyPromise = (async () => {
  try {
    const siteRes = await window.luna.getCachedSiteAccount();
    if (siteRes?.ok && siteRes.account) {
      currentSiteAccount = siteRes.account;
      const cached = await window.luna.getCachedProfile();
      showHome(cached || null); // 마인크래프트 계정은 아직 없어도(게스트) 일단 홈은 보여줌
      startSiteHeartbeat();
    } else {
      currentSiteAccount = null;
      showLogin();
    }
  } catch (err) {
    currentSiteAccount = null;
    showLogin();
  } finally {
    document.getElementById("boot-gate")?.setAttribute("hidden", "");
    // 24-35차: "처음에 로딩시간 무조건 걸어둔 거 그 시간 없애고 그 시간에 마크 계정
    // 로딩해봐" - 스플래시(main.js)가 예전엔 이 작업과 무관하게 고정 3.2초를 기다렸는데,
    // 이제 바로 이 시점(사이트 계정 확인 + 마인크래프트 계정 자동 로그인이 실제로 끝난
    // 시점)을 메인 프로세스에 알려서, 그 신호가 올 때까지만 스플래시가 떠 있게 함
    window.luna.notifyBootReady?.();
  }
})();

// ---- 사이트 계정 로그인 / 회원가입 -----------------------------------------
// 24-6차: "로그인/회원가입 애니메이션좀 넣어주고" - 탭이 바뀔 때 배경이 각자 그냥 즉시
// 바뀌던 걸 걷어내고, 이 코드베이스의 다른 탭 그룹(설정/프로필 편집/상점 카테고리 등)과
// 똑같이 mountSlidingPill()로 하이라이트가 두 탭 사이를 미끄러지며 이동하게 함
const siteLoginTabsPill = mountSlidingPill(siteLoginTabsEl, "slide-pill-site-login-tabs");
let siteLoginMode = "login"; // "login" | "register"
function setSiteLoginMode(mode) {
  siteLoginMode = mode;
  siteLoginTabLogin?.classList.toggle("is-active", mode === "login");
  siteLoginTabRegister?.classList.toggle("is-active", mode === "register");
  siteLoginTabsPill.update(mode === "login" ? siteLoginTabLogin : siteLoginTabRegister);
  if (btnSiteLoginSubmit) btnSiteLoginSubmit.textContent = mode === "login" ? "로그인" : "회원가입";
  if (siteLoginPasswordInput) {
    siteLoginPasswordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  }
  // 24-10차: 회원가입은 웹사이트 가입과 똑같이 이메일이 추가로 필요함(로그인은 이메일 또는
  // 닉네임 아무거나로 되니 그대로 아이디 입력칸 하나만 씀).
  if (siteLoginEmailInput) siteLoginEmailInput.hidden = mode !== "register";
  if (siteLoginIdInput) {
    siteLoginIdInput.placeholder = mode === "login" ? "이메일 또는 아이디(닉네임)" : "닉네임 (아이디, 2~16자)";
  }
  if (siteLoginError) siteLoginError.textContent = "";
}
siteLoginTabLogin?.addEventListener("click", () => setSiteLoginMode("login"));
siteLoginTabRegister?.addEventListener("click", () => setSiteLoginMode("register"));
// 로그인 화면은 앱을 켜자마자(로그인 여부 확인 전에) 바로 보이는 화면이라, 첫 탭(로그인)
// 하이라이트가 pill로 처음부터 제자리에 그려져 있어야 함 - 클릭 전까지 비어있으면 안 됨
setSiteLoginMode("login");

// 24-61차: "회원가입이나 로그인할 때 로딩중일 때 화면 그대로 두지 말고 로딩창을 띄워줘" -
// 예전엔 버튼만 disabled 처리되고 문구/스피너 변화가 전혀 없어서, 서버 응답이 느리면(특히
// 회원가입 - 이메일 중복 확인 등으로 더 걸릴 수 있음) 클릭이 씹힌 것처럼 보였음. 다른 곳에서
// 이미 쓰던 withBusyButton(스피너+문구)으로 통일
siteLoginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (siteLoginError) siteLoginError.textContent = "";
  const id = siteLoginIdInput?.value || "";
  const pw = siteLoginPasswordInput?.value || "";
  const email = siteLoginEmailInput?.value || "";
  await withBusyButton(btnSiteLoginSubmit, siteLoginMode === "login" ? "로그인 중..." : "회원가입 중...", async () => {
    const res =
      siteLoginMode === "login"
        ? await window.luna.siteLogin(id, pw)
        : await window.luna.siteRegister(email, id, pw);
    if (res.ok) {
      currentSiteAccount = res.account;
      if (siteLoginPasswordInput) siteLoginPasswordInput.value = "";
      const cached = await window.luna.getCachedProfile();
      showHome(cached || null);
      startSiteHeartbeat();
    } else if (siteLoginError) {
      siteLoginError.textContent = res.error || "로그인에 실패했어요.";
    }
  });
});

// 24-4차: "클라이언트는 한 곳에서만 로그인할 수 있게 해줘 여러 곳에서 동시 로그인이
// 안되게" - 45초마다(친구 온라인 상태 하트비트와 같은 패턴) 서버에 살아있다고 알리는
// 동시에, 다른 기기가 로그인해서 내 세션이 끊겼는지 확인함. 끊겼으면(kicked) 바로
// 로그인 화면으로 돌려보내고 토스트로 알려줌.
let siteHeartbeatTimer = null;
function startSiteHeartbeat() {
  if (siteHeartbeatTimer) return;
  siteHeartbeatTimer = setInterval(async () => {
    const res = await window.luna.siteHeartbeat();
    if (res?.kicked) {
      // 24-16차: "다른 창 눌렀는데 이렇게 됐잖아 이게 아니라 창은 유지하고 경고글만
      // 날려주면 되지" - 예전엔 여기서 곧바로 currentSiteAccount/currentProfile을 지우고
      // showLogin()으로 화면 전체를 로그인 화면으로 강제 전환했음. 이 하트비트는 45초마다
      // 조용히 백그라운드에서 실행되는데(예: 마이크로소프트 로그인 팝업과 씨름하느라 45초를
      // 넘기는 등), 사용자 입장에선 지금 하던 걸 그대로 하고 있었을 뿐인데 갑자기 다른
      // 화면으로 튕겨나가는 것처럼 느껴졌음. 이제는 화면은 그대로 두고 경고 토스트만 띄우고,
      // 하트비트는 멈춰서 같은 경고가 반복되지 않게만 함 - 실제로 세션이 끊겼다면 다음에
      // 로그인이 필요한 동작(PLAY 등)을 시도할 때 그 시점의 서버 응답이 자연스럽게 알려줌.
      stopSiteHeartbeat();
      showToast(`다른 기기(${res.device || "다른 기기"})에서 로그인했을 수 있어요. 계속 문제가 있으면 다시 로그인해주세요.`, "error");
    }
  }, 45000);
}
function stopSiteHeartbeat() {
  if (siteHeartbeatTimer) {
    clearInterval(siteHeartbeatTimer);
    siteHeartbeatTimer = null;
  }
}

// ---- 로그아웃 ---------------------------------------------------------------
// 24-14차: "로그아웃하면 노바 계정을 로그인해야지 마크 로그인이 왜 뜨는 거냐" - 예전엔 이
// 계정 메뉴의 "로그아웃"이 마인크래프트 계정만 로그아웃하고(사이트 계정 로그인은 유지)
// showHome(null)로 게스트 상태의 홈 화면을 보여줬음. 그러면 PLAY를 눌렀을 때 마이크로소프트
// 로그인 창이 다시 뜨는데, 사용자 입장에선 "로그아웃했는데 왜 또 마크 로그인이 뜨냐"로
// 보임 - 이 버튼이 실제로 손이 가는 로그아웃이므로, 노바 계정까지 완전히 로그아웃하고
// 노바 로그인 화면(view-login)으로 돌아가게 바꿈(아래 siteLogoutAndReturnToLogin 재사용)
btnLogout.addEventListener("click", async () => {
  document.getElementById("account-menu")?.setAttribute("hidden", "");
  await window.luna.logout(); // 마인크래프트 쪽 로컬 세션도 같이 정리
  await siteLogoutAndReturnToLogin();
});

// ---- 사이트 계정 로그아웃 ---------------------------------------------------
// 24-4차: 마인크래프트 계정 로그아웃(위 btnLogout)과는 별개로, 사이트 계정 자체를
// 로그아웃하면 로그인 화면으로 돌아가고 하트비트도 멈춤 - 설정 화면의 사이트 계정
// 패널(loadSiteAccountPanel/renderSiteAccountPanel)에서 호출함.
async function siteLogoutAndReturnToLogin() {
  stopSiteHeartbeat();
  await window.luna.siteLogout();
  currentSiteAccount = null;
  currentProfile = null;
  closeSettings();
  showLogin();
}

// ---- 마인크래프트 계정 연동 화면 (view-mc-gate) ------------------------------
// 24-15차: "마크 로그인이 마크 계정 추가에만 있어야 한다" - 사이트 계정 로그인 직후,
// 아직 마인크래프트 계정이 연동 안 됐으면 이 화면 하나만 보여줌(showAppPanel의 게이트가
// 다른 모든 화면 요청을 여기로 되돌림). 마이크로소프트 로그인은 이 화면의 버튼과 설정 >
// 사이트 계정 패널, 이 두 곳에서만 시작됨 - PLAY나 프로필 아이콘 클릭에서 곧바로
// 뜨던 예전 흐름은 모두 없앰.
let isMcGateLoggingIn = false;
document.getElementById("btn-mc-gate-login")?.addEventListener("click", async (e) => {
  if (isMcGateLoggingIn) return;
  isMcGateLoggingIn = true;
  // 24-61차: 마이크로소프트 로그인 창과 씨름하는 동안(초 단위로 걸릴 수 있음) 버튼만
  // disabled로 굳어있던 걸, 다른 로딩 버튼들과 같은 스피너+문구로 통일
  await withBusyButton(e.target, "로그인 창 여는 중...", async () => {
    const res = await window.luna.login();
    if (res.ok) {
      currentProfile = res.profile;
      await refreshSiteLinkStateAfterMcLogin(res);
      // hasLinkedMcAccount()가 true여야만 showAppPanel이 실제로 홈을 보여줌 - 연동이
      // 거절됐으면(계정당 1개 제한 등) 위 refreshSiteLinkStateAfterMcLogin이 이미 경고
      // 토스트를 띄웠고, 여기선 그대로 이 화면에 머무름
      showHome(res.profile);
    } else if (res.error) {
      showToast(res.error, "error");
    }
  });
  isMcGateLoggingIn = false;
});
document.getElementById("btn-mc-gate-logout")?.addEventListener("click", async () => {
  await siteLogoutAndReturnToLogin();
});

// ---- 실행(Play) ----------------------------------------------------------
let downloadDotsTimer = null;
let currentDownloadPercent = null;

function startDownloadDots() {
  let dotCount = 1;
  stopDownloadDots();
  downloadDotsTimer = setInterval(() => {
    dotCount = (dotCount % 3) + 1;
    const dots = ".".repeat(dotCount);
    const pctText = currentDownloadPercent === null ? "" : ` ${currentDownloadPercent}%`;
    btnPlayLabel.textContent = `DOWNLOADING${pctText}${dots}`;
  }, 450);
}
function stopDownloadDots() {
  if (downloadDotsTimer) {
    clearInterval(downloadDotsTimer);
    downloadDotsTimer = null;
  }
}

// 10-1: 지금 idle 상태에서 Play 버튼에 뭐라고 써야 하는지 (게임 실행 중이면 STOP)
// 24-54차: "복제 실행 버튼 없애고 이전으로 되돌린 다음에 프로필로 실행을 하면 STOP이
// 뜨는 게 아니라 추가 실행하기가 뜨는 걸로 바꿔줘" - 24-51차에서 만든 별도 정사각형
// 복제 실행 버튼을 없애는 대신, 프로필 모드에서 이미 실행 중일 땐 PLAY 버튼 자체가
// "추가 실행하기"로 바뀌어 그 자리에서 같은 프로필을 하나 더 실행하는 용도를 겸함
// (아래 btnPlay 클릭 핸들러 참고). 서버 모드는 기존과 동일하게 STOP으로 표시됨
function playIdleLabel() {
  if (!isInGame) return "PLAY";
  return launchModeCache === "profile" ? "추가 실행하기" : "STOP";
}

function setDownloadingState(isDownloading) {
  btnPlay.classList.toggle("is-downloading", isDownloading);
  btnPlay.disabled = isDownloading;
  if (!isDownloading) {
    stopDownloadDots();
    currentDownloadPercent = null;
    btnPlayFill.style.width = "0%";
    btnPlayLabel.textContent = playIdleLabel();
    progressCaption.textContent = "";
  }
}

// 10-1: 게임이 실행 중일 때 Play → Stop 으로 바꾸고, 켜져 있는 서버/프로필 쪽을 빛나게 함
// 14차: 새로고침 트리거 버튼이 없어져서, 빛나는 대상을 버튼이 아니라 바깥 박스 자체로 옮김
function setInGameUiState(active) {
  // 24-54차: 프로필 모드에서는 이미 실행 중이어도 "정지"가 아니라 "추가 실행하기"로
  // 동작하므로, 빨간 정지 버튼 스타일(.is-in-game)은 서버 모드일 때만 입힘 - 프로필
  // 모드는 그대로 초록 PLAY 모양을 유지한 채 글자만 바뀜(playIdleLabel 참고)
  btnPlay.classList.toggle("is-in-game", active && launchModeCache !== "profile");
  const heroBlockServer = document.getElementById("hero-side-block-server");
  const heroBlockProfile = document.getElementById("hero-side-block-profile");
  const activeBlock = launchModeCache === "profile" ? heroBlockProfile : heroBlockServer;
  [heroBlockServer, heroBlockProfile].forEach((el) => el?.classList.remove("is-playing-glow"));
  if (active) activeBlock?.classList.add("is-playing-glow");
  // 롤 채팅창처럼: Launch(게임 실행) 나가면 귓속말 창은 자동으로 숨김
  if (active) closeWhisperPopup();
}

// 24-63차: "참가하기 누르면 PLAY를 누르는 게 아니라 참가하시겠습니까 이거 뜨게 해줘 누르면
// 바로 들어가지고" - 원래 PLAY 버튼 클릭 핸들러 안에만 있던 실행 로직(로그인/연동 확인,
// 다운로드 진행률 표시, 실행 중이면 추가 실행 등 전부 포함)을 이름 있는 함수로 뽑아서,
// 친구 프로필 팝업/친구 우클릭 메뉴의 "참가하기"에서도 (서버/프로필로 전환한 다음) 그대로
// 재사용할 수 있게 함 - PLAY를 직접 누른 것과 100% 동일하게 동작함
async function handlePlayClick() {
  // 게임이 이미 실행 중이면...
  if (isInGame) {
    // 24-54차: 프로필 모드에서는 더 이상 "정지"가 아니라 "추가 실행하기" - 이미 실행
    // 중인 PLAY 버튼을 한 번 더 눌러서 같은 프로필을 하나 더 켬(24-51차 launch:start-duplicate
    // 핸들러를 그대로 재사용 - 기존 gameProcess/진행률/디스코드 상태는 안 건드림). 서버
    // 모드는 기존과 동일하게 "정지"로 취급함
    if (launchModeCache === "profile") {
      btnPlay.disabled = true;
      try {
        const res = await window.luna.startDuplicateLaunch();
        if (res.ok) {
          showToast("추가로 실행했어요");
        } else if (!res.aborted) {
          showToast(res.error || "추가 실행에 실패했어요", "error");
        }
      } finally {
        btnPlay.disabled = false;
      }
      return;
    }
    btnPlay.disabled = true;
    const res = await window.luna.stopLaunch();
    btnPlay.disabled = false;
    if (!res.ok) showToast(res.error || "게임을 종료하지 못했어요", "error");
    return;
  }

  // 24-11차: "로그인 안 했을 때 PLAY 누르면 마크 로그인이 왜 뜨는 거야" - 노바클 사이트
  // 계정으로 아예 로그인이 안 돼있는 상태에서 PLAY를 누르면(예: 화면을 옮겨다니다 세션이
  // 끊긴 경우 등) 곧바로 마이크로소프트 로그인 창부터 띄우던 걸 고쳐서, 그럴 땐 먼저
  // 사이트 로그인 화면으로 보냄. 사이트 계정은 있는데 마인크래프트 계정만 없는 "진짜
  // 게스트" 상태에서만 아래의 마이크로소프트 로그인 흐름으로 이어짐
  if (!currentSiteAccount) {
    showToast("먼저 노바클 계정으로 로그인해주세요", "error");
    stopSiteHeartbeat();
    showLogin();
    return;
  }

  // 24-15차: "마크 로그인이 마크 계정 추가에만 있어야 한다" - PLAY에서 곧바로 마이크로소프트
  // 로그인 창을 띄우던 흐름을 없앰. 이제 홈 화면 자체가 마인크래프트 계정 연동 없이는
  // 보이지 않으므로(showAppPanel 게이트) 이 분기는 세션이 중간에 끊기는 등 아주 드문
  // 경우에만 방어적으로 걸리고, 그럴 땐 연동 화면(view-mc-gate)으로 돌려보내기만 함
  // 24-22차: 이미 홈 화면에 있는 채로 이 분기를 타면(연동이 그새 끊긴 경우), 24-18차의
  // "이미 인증된 화면에서는 게이트가 화면을 강제로 안 바꾼다" 안전장치가 view-home 요청을
  // view-mc-gate로 바꾸려는 이 의도적인 전환까지 같이 막아버림 - 그 안전장치를 안 거치도록
  // 처음부터 view-mc-gate를 직접 요청함
  if (!hasLinkedMcAccount()) {
    showAppPanel("view-mc-gate");
    return;
  }

  gameError.textContent = "";
  cancelReconnectPrompt();
  setDownloadingState(true);
  currentDownloadPercent = null;
  startDownloadDots();

  const res = await window.luna.startLaunch();

  if (!res.ok) {
    setDownloadingState(false);
    if (!res.aborted) {
      gameError.textContent = "실행에 실패했습니다: " + (res.error || "알 수 없는 오류");
    }
  } else {
    isInGame = true; // 친구 목록에 "OO 플레이 중"으로 보이게
    sendFriendsHeartbeat();
    setDownloadingState(false); // 다운로드 표시는 끄고, Play 버튼을 Stop 모양으로
    setInGameUiState(true);
  }
}
btnPlay.addEventListener("click", handlePlayClick);

// ---- 진행률 이벤트 ---------------------------------------------------------
window.luna.onProgress(({ phase, percent, detail }) => {
  btnPlayFill.style.width = percent + "%";
  currentDownloadPercent = percent;
  progressCaption.textContent = `${PHASE_LABELS[phase] || phase}${detail ? " · " + detail : ""}`;
});

// ---- 게임 종료 후 런처 복귀 -------------------------------------------------
window.luna.onGameClosed(async ({ code } = {}) => {
  isInGame = false;
  setInGameUiState(false);
  setDownloadingState(false);
  sendFriendsHeartbeat();
  if (code === 0) {
    startReconnectPrompt();
  }
});

// ---- 서버 상태(켜짐/꺼짐) 표시 ----------------------------------------------
// 13차: "오프라인" 글자로 지금 고른 서버 하나만 알려주던 걸 없애고, 목록의 서버 항목마다
// 각자 온라인/오프라인/확인중을 작은 점으로 보여주도록 바꿈 - 그래서 서버 전체를 한 번에
// 확인한 결과(servers:status-all)를 id별로 저장해뒀다가 목록을 다시 그릴 때 씀
let launchModeCache = "server";
let serverStatusById = {};
window.luna.onServersStatusAll((results) => {
  const map = {};
  (results || []).forEach((r) => {
    map[r.serverId] = r;
  });
  serverStatusById = map;
  renderServerListItems();
});

// ---- 서버 선택 -----------------------------------------------------------
// 14차: 새로고침 트리거 버튼 자체를 없애서 관련 DOM 참조도 함께 제거함(주기적 상태 폴링이
// servers:status-all/onServersStatusAll로 알아서 갱신해주므로 수동 새로고침이 필요 없어짐)
const serverChipName = document.getElementById("server-chip-name");
const serverListItemsEl = document.getElementById("server-list-items");
let lastServersData = [];
// 10차: "프로필에도 잔상 효과" - 서버/프로필 선택 목록도 다른 탭들처럼 고른 항목이 바뀔 때
// 이전 자리에서 새 자리로 이어지며 사라지는 잔상 하이라이트가 보이게 함. 카드 자체의
// 선택 배경(.is-selected)은 그대로 두고, 이 pill은 전환되는 "순간"에만 스쳐 지나가는
// 보조 효과 - 카드가 pill 위에 그려져야 하므로 .server-box-item에 z-index:1을 줌
const serverListPill = mountSlidingPill(serverListItemsEl, "slide-pill-hero-list");

// 서버/프로필을 바꾸는 도중에는 PLAY와 전환 컨트롤을 잠궈서, 바뀌는 중에 또 누르는 걸 막음
let isSwitchingLaunchTarget = false;
function setLaunchControlsLocked(locked) {
  isSwitchingLaunchTarget = locked;
  if (btnPlay) btnPlay.disabled = locked;
  if (playArea) playArea.classList.toggle("is-switching", locked);
  if (btnPlayLabel) btnPlayLabel.textContent = locked ? "전환 중..." : playIdleLabel();
}

function updateMcVersionLabel(version) {
  // 10-8: 공식 마인크래프트 브랜딩으로 오해될 수 있는 표기를 피하려고 "Minecraft용"으로 표기
  const text = `Minecraft용 ${version} · Nova`;
  const loginEl = document.getElementById("login-mc-version");
  if (loginEl) loginEl.textContent = text;
  // 24-11차: "프로필 표시를 계정닉네임/마크닉네임으로" - 프로필 클러스터의 아래 줄
  // (#profile-mc-version)은 이제 이 함수가 아니라 updateProfileClusterDisplay()가
  // 실제 마인크래프트 닉네임으로 채움 - 여기서 고정 문구로 덮어쓰지 않음
  updateProfileClusterDisplay();
}

// 10차: 예전엔 이 자리에 "홈 화면 서버/프로필 인라인 목록용 페이지 번호 넘기기" 헬퍼가
// 있었는데("박스 크기 조절 필요, 프로필 목록 휠 스크롤 가능하게" 피드백으로) 페이지 번호
// 클릭 대신 목록 자체를 휠로 스크롤하는 방식으로 바뀌면서 더 이상 쓰이지 않아 제거함
// (renderServerListItems/renderProfileListItems 쪽 참고)

// 10차: "박스 크기 조절 필요(너무 길어짐), 프로필 목록 휠 스크롤 가능하게" - 페이지 번호를
// 눌러 넘기던 방식(4차) 대신, 목록 자체를 고정 높이 안에서 마우스 휠로 스크롤하는 방식으로
// 바꿈. 항목 수가 몇 개든 박스 높이가 늘어나지 않고, "새 프로필 만들기" 같은 항상 붙던 줄도
// 더 이상 페이지 계산에서 잘려나가지 않음
// 13차: "서버는 이름순/등록순이 아니라 최근 플레이순 고정" 요청 - 프로필과 같은 방식으로
// 정렬 버튼(고를 것)을 아예 없애고, 항상 최근에 플레이한 서버가 위로 오게 고정함. 서버는
// CONFIG.SERVERS가 고정 설정값이라 main.js에서 실제로 플레이할 때마다 서버별 마지막
// 플레이 시각을 따로 기록해서 내려줌(lastPlayedAt) - 한 번도 안 켠 서버는 맨 뒤로
// 22차: "프로필 많아지면 아래 조금 튀어나오는 현상 없애줘" - .hero-list-scroll의 max-height가
// 17차에 항목 자체를 키운 뒤로 딱 정수 개의 줄과 안 맞아떨어져서, 스크롤 경계가 항목 중간을
// 가로질러 마지막 줄이 반쯤 잘린 채로 보였음(전역 규칙으로 스크롤바 자체가 안 보이니 "스크롤
// 가능"이라는 힌트도 없어서 더 어색해 보였음). 스크롤 가능한 상태일 때만 아래쪽에 옅은 페이드
// 마스크를 붙여서 "더 있다"는 걸 자연스럽게 알려줌(.style.css의 .hero-list-scroll.has-more 참고)
// 24-11차: "목록에 더 있으면 위/아래 화살표로도 알려줘" - 기존 아래쪽 페이드 마스크
// (has-more)에 더해, 이미 스크롤을 내린 상태에서 위로 더 있는지(has-more-top)도 스크롤
// 위치(scrollTop) 기준으로 같이 계산하고, 각 방향에 대응하는 화살표(위/아래) 요소도 함께
// 켜고 끔. el의 id(server-list-items/profile-list-items)에서 화살표 요소 id를 유추함
function updateHeroListScrollFade(el) {
  if (!el) return;
  const canScroll = el.scrollHeight - el.clientHeight > 2;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  const atTop = el.scrollTop <= 2;
  el.classList.toggle("has-more", canScroll && !atBottom);
  el.classList.toggle("has-more-top", canScroll && !atTop);
  // 24-24차: 계정 전환 메뉴 목록/설정 창 본문처럼 화살표 힌트가 아예 없는 다른 요소에도
  // 이 함수를 재사용하게 되면서, "id가 profile-list-items가 아니면 무조건 server"로
  // 단정하던 예전 로직이 그 요소들에 대해 엉뚱하게 server-list-arrow-*를 건드릴 뻔했음 -
  // 화살표를 가진 두 목록(server/profile)일 때만 화살표를 찾아 갱신하도록 좁힘
  const prefix = el.id === "profile-list-items" ? "profile" : el.id === "server-list-items" ? "server" : null;
  if (!prefix) return;
  const arrowUp = document.getElementById(`${prefix}-list-arrow-up`);
  const arrowDown = document.getElementById(`${prefix}-list-arrow-down`);
  if (arrowUp) arrowUp.hidden = !(canScroll && !atTop);
  if (arrowDown) arrowDown.hidden = !(canScroll && !atBottom);
}
document.getElementById("server-list-items")?.addEventListener("scroll", (e) => updateHeroListScrollFade(e.target));
document.getElementById("profile-list-items")?.addEventListener("scroll", (e) => updateHeroListScrollFade(e.target));
// 24-24차: "끝에 박스가 끊어지는 느낌을 주면 안돼" - 위 두 목록 말고도 스크롤이 넘칠 때
// 딱 잘려 보이던 계정 전환 메뉴 목록/설정 창 본문에도 같은 페이드 처리를 붙임(마스크는
// .scroll-fade-mask, 크기/스크롤은 각 요소가 원래 갖고 있던 CSS 그대로)
document.getElementById("account-menu-list")?.addEventListener("scroll", (e) => updateHeroListScrollFade(e.target));
document.getElementById("settings-content")?.addEventListener("scroll", (e) => updateHeroListScrollFade(e.target));

function renderServerListItems() {
  // 24-14차: "고른 프로필 맨 위로 하는 거 취소할게 그거 돌려놓고" - 24-11차에서 추가했던
  // "선택된 항목 항상 맨 위" 정렬을 요청에 따라 되돌림. 다시 최근 플레이순 정렬만 씀
  const servers = lastServersData.slice().sort((a, b) => {
    const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
    const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
    return bt - at;
  });

  serverListItemsEl.innerHTML = "";
  if (servers.length === 0) {
    serverListItemsEl.innerHTML = `<div class="mini-list-empty">서버가 없어요</div>`;
    serverListPill.update(null, true);
    return;
  }

  servers.forEach((s) => {
    const item = document.createElement("div");
    item.className = "server-box-item" + (s.selected ? " is-selected" : "");
    // 13차: "오프라인" 글자 대신 아이콘 모서리에 작은 빛 점으로 온라인/오프라인/확인중 표시
    const status = serverStatusById[s.id];
    const dotClass = !status ? "is-checking" : status.online ? "" : "offline";
    item.innerHTML = `
      <span class="server-box-icon-wrap">
        <span class="server-box-icon">${escapeHtml((s.name || "?").slice(0, 1))}</span>
        <span class="server-item-dot ${dotClass}"></span>
      </span>
      <span class="server-box-info">
        <b class="server-box-name">${escapeHtml(s.name)}</b>
        <span class="server-box-version">Minecraft용 ${escapeHtml(s.version)} · Nova</span>
      </span>
    `;
    if (!s.selected) {
      item.addEventListener("click", async () => {
        if (isSwitchingLaunchTarget) return;
        // 고른 순간 바로 이전 선택 자리에서 이 카드로 잔상이 이어지도록 먼저 pill을 옮겨둠
        serverListPill.update(item, false);
        setLaunchControlsLocked(true);
        try {
          const res = await window.luna.selectServer(s.id);
          if (res.ok) {
            if (serverChipName) serverChipName.textContent = res.server.name;
            updateMcVersionLabel(res.server.version);
            refreshChipActiveStates();
            showToast(`${res.server.name}(으)로 전환했어요`);
            // 24-61차: "프로필 선택할 때 나는 소리 서버에도 적용해줘" - 프로필 선택 때만
            // 나던 효과음을 서버 선택에도 동일하게 재생함
            playProfileSwitchDing();
            // 9차: 목록이 이제 항상 펼쳐져 있어서, 고른 뒤에도 선택 표시가 바로 갱신되도록 다시 그려줌
            // 24-48차: 프로필 목록도 같이 다시 불러와서, 서버를 고르면서 풀린 프로필 선택
            // 표시가 (화면에 안 보이는 동안에도) 바로 꺼지도록 함
            await refreshLaunchTargetLists();
          }
        } finally {
          setLaunchControlsLocked(false);
        }
      });
    }
    serverListItemsEl.appendChild(item);
  });
  serverListPill.update(serverListItemsEl.querySelector(".server-box-item.is-selected"), true);
  updateHeroListScrollFade(serverListItemsEl);
}

async function loadServerList() {
  const servers = await window.luna.listServers();
  lastServersData = servers;
  const selected = servers.find((s) => s.selected);
  if (selected) {
    if (serverChipName) serverChipName.textContent = selected.name;
    updateMcVersionLabel(selected.version);
  }
  renderServerListItems();
}

// 시작할 때 서버 목록을 바로 로드해서 항상 펼쳐진 목록으로 보여줌
loadServerList();

// ---- 프로필 선택 (서버 선택과 서로 배타적) -----------------------------------
const profileChipName = document.getElementById("profile-chip-name");
const profileListItemsEl = document.getElementById("profile-list-items");
let lastProfilesData = [];
// 10차: 서버 목록과 동일하게 프로필 목록에도 전환 잔상 pill을 붙임
const profileListPill = mountSlidingPill(profileListItemsEl, "slide-pill-hero-list");

// 19(4차): "서버" / "프로필" 인라인 모드 스위치 - 항상 하나만 카드 안에 보이게 함
// 6차: 스위치 배경 하이라이트가 스냅되지 않고 슬라이드되도록 공용 pill 헬퍼를 붙였었음.
// 11차: "버튼 하나 눌리는 효과는 모드린스 슬라이드 느낌 말고 새로 만들자, 이전 표시가
// 페이드아웃되고 새 표시가 페이드인되는 식으로" - 이런 2개짜리 단순 스위치는 위치를 옮겨
// 다닐 필요가 없어서, 공용 슬라이딩 pill 대신 버튼마다 자기 배경(::before)을 갖고 opacity로
// 크로스페이드하는 새 방식으로 교체함(.hero-side-mode-btn::before 참고)
function updateHeroModeSwitchPill() {}
let heroSideSwapOutTimer = null;
function setHeroSideMode(mode) {
  document.getElementById("hero-mode-server-btn")?.classList.toggle("is-active", mode !== "profile");
  document.getElementById("hero-mode-profile-btn")?.classList.toggle("is-active", mode === "profile");
  const serverBlock = document.getElementById("hero-side-block-server");
  const profileBlock = document.getElementById("hero-side-block-profile");
  const activeBlock = mode === "profile" ? profileBlock : serverBlock;
  const outgoingBlock = mode === "profile" ? serverBlock : profileBlock;
  // 22차: "서버<>프로필 간 옮길 때 전처럼 에니메이션 넣어주고" - 이미 안 보이던 쪽으로
  // 다시 전환하는 경우(예: 빠르게 두 번 클릭)엔 굳이 페이드아웃을 재생할 게 없으므로
  // 즉시 전환하고, 실제로 보이고 있던 블록이 바뀔 때만 크로스페이드를 재생함
  const wasOutgoingVisible = !outgoingBlock.hidden;
  if (heroSideSwapOutTimer) { clearTimeout(heroSideSwapOutTimer); heroSideSwapOutTimer = null; }
  outgoingBlock.classList.remove("hero-side-swap-in", "hero-side-swap-out");
  if (wasOutgoingVisible) {
    void outgoingBlock.offsetWidth;
    outgoingBlock.classList.add("hero-side-swap-out");
  }
  const showIncoming = () => {
    outgoingBlock.hidden = true;
    outgoingBlock.classList.remove("hero-side-swap-out");
    activeBlock.hidden = false;
    // 24-15차: "화살표가 건들면 보이는데 처음엔 안보여" - 목록이 [hidden]인 동안(또는 부모
    // 화면이 아직 안 보이는 동안) updateHeroListScrollFade가 계산되면 scrollHeight/clientHeight가
    // 둘 다 0이라 "더 있음" 판정이 항상 false로 나옴. 그 뒤로는 사용자가 실제로 스크롤해서
    // scroll 이벤트가 한 번 발생해야만 다시 계산되니, 처음엔 화살표가 있어야 하는데도 안 보임.
    // 블록이 실제로 화면에 나타나는 이 시점에 한 번 더 계산해줘서 처음부터 맞게 보이게 함
    const listEl = mode === "profile" ? profileListItemsEl : serverListItemsEl;
    requestAnimationFrame(() => updateHeroListScrollFade(listEl));
    // 17차: "서버↔프로필 전환에도 효과를 달라" - 새로 보이게 된 블록에 짧은 페이드+살짝
    // 떠오르는 진입 애니메이션을 재생함
    activeBlock.classList.remove("hero-side-swap-in");
    void activeBlock.offsetWidth; // 강제 리플로우로 같은 클래스를 다시 붙여도 애니메이션이 재시작되게 함
    activeBlock.classList.add("hero-side-swap-in");
    // 24차: "선택된 게 넘어가는 애니메이션도 해주고" - 전에는 다시 보이게 된 쪽의 선택 pill을
    // 항상 즉시(instant) 스냅시켰음(숨겨진 동안 크기가 0이라 위치를 못 재고 있었으므로).
    // 이제 실제로 모드가 바뀐 경우(wasOutgoingVisible)엔, 방금 사라진 쪽 pill의 마지막 위치를
    // 읽어서(getRect) 새로 나타나는 쪽 pill에 그대로 심어준 다음(seedRect) 애니메이션으로
    // 갱신해서, 두 목록이 서로 다른 컨테이너인데도 마치 선택 표시가 한쪽에서 다른 쪽으로
    // 그대로 이어져 넘어간 것처럼 보이게 함. 두 박스가 같은 자리에 같은 구조로 겹쳐있어서
    // 좌표계가 거의 그대로 맞아떨어짐
    const incomingPill = mode === "profile" ? profileListPill : serverListPill;
    const outgoingPill = mode === "profile" ? serverListPill : profileListPill;
    const carryRect = wasOutgoingVisible ? outgoingPill.getRect() : null;
    requestAnimationFrame(() => {
      const activeItem = activeBlock.querySelector(".server-box-item.is-selected");
      if (carryRect && activeItem) {
        incomingPill.seedRect(carryRect);
        incomingPill.update(activeItem, false);
      } else {
        incomingPill.update(activeItem, true);
      }
    });
  };
  if (wasOutgoingVisible) {
    heroSideSwapOutTimer = setTimeout(showIncoming, 140);
  } else {
    showIncoming();
  }
}
document.getElementById("hero-mode-server-btn")?.addEventListener("click", () => setHeroSideMode("server"));
document.getElementById("hero-mode-profile-btn")?.addEventListener("click", () => setHeroSideMode("profile"));
window.addEventListener("resize", () => {
  serverListPill.update(serverListItemsEl.querySelector(".server-box-item.is-selected"), true);
  profileListPill.update(profileListItemsEl.querySelector(".server-box-item.is-selected"), true);
});

async function refreshChipActiveStates() {
  const mode = await window.luna.getLaunchMode?.();
  launchModeCache = mode;
  setHeroSideMode(mode);
}

// 10차: 서버 목록과 동일하게 페이지 번호 대신 휠 스크롤 방식으로 바꿈 - "새 프로필 만들기"
// 줄도 더는 페이지 계산에 밀려 잘려나가지 않고 스크롤하면 항상 맨 아래에서 보임
// 13차: "프로필도 최근 플레이순 고정" 요청 - 정렬 버튼(고를 것)을 없애고 항상 최근 플레이순으로
function renderProfileListItems() {
  // 24-14차: "고른 프로필 맨 위로 하는 거 취소할게 그거 돌려놓고" - 24-11차의 "선택된 프로필
  // 항상 맨 위" 정렬을 되돌림. 다시 최근 플레이순 정렬만 씀(안 켠 프로필은 맨 뒤)
  const profiles = lastProfilesData.slice().sort((a, b) => {
    const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
    const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
    return bt - at;
  });

  profileListItemsEl.innerHTML = "";
  if (profiles.length === 0) {
    profileListItemsEl.innerHTML = `<div class="mini-list-empty">아직 만든 프로필이 없어요</div>`;
    profileListPill.update(null, true);
    return;
  }

  profiles.forEach((p) => {
    const item = document.createElement("div");
    item.className = "server-box-item" + (p.selected ? " is-selected" : "");
    const iconHtml = p.iconUrl
      ? `<img src="${p.iconUrl}" class="server-box-icon-img" alt="" />`
      : `<span class="server-box-icon">${escapeHtml((p.name || "?").slice(0, 1))}</span>`;
    // 14차: "가져다 대면 추가 정보가 뜨면서 목록 길이가 밑으로 늘어나는 게 이상하다" -
    // 마지막 플레이 시각을 호버 시에만 펼쳐 보여주던 3번째 줄을 완전히 제거함
    item.innerHTML = `
      ${iconHtml}
      <span class="server-box-info">
        <b class="server-box-name">${escapeHtml(p.name)}</b>
        <span class="server-box-version">${escapeHtml(p.mcVersion || "")} · Nova</span>
      </span>
    `;

    if (!p.selected) {
      item.addEventListener("click", async () => {
        if (isSwitchingLaunchTarget) return;
        // 고른 순간 바로 이전 선택 자리에서 이 카드로 잔상이 이어지도록 먼저 pill을 옮겨둠
        profileListPill.update(item, false);
        setLaunchControlsLocked(true);
        try {
          const res = await window.luna.selectProfile(p.id);
          if (res.ok) {
            if (profileChipName) profileChipName.textContent = res.profile.name;
            updateMcVersionLabel(res.profile.mcVersion);
            refreshChipActiveStates();
            showToast(`${res.profile.name} 프로필로 전환했어요`);
            // 24-15차: "프로필 바꿀때 띠링 소리 같은 거 나게 해줘 효과음으로"
            playProfileSwitchDing();
            // 9차: 목록이 항상 펼쳐져 있으니 선택 표시도 바로 다시 그려줌
            // 24-48차: 서버 목록도 같이 다시 불러와서, 프로필을 고르면서 풀린 서버 선택
            // 표시가 (화면에 안 보이는 동안에도) 바로 꺼지도록 함
            await refreshLaunchTargetLists();
          }
        } finally {
          setLaunchControlsLocked(false);
        }
      });
    }
    profileListItemsEl.appendChild(item);
  });

  profileListPill.update(profileListItemsEl.querySelector(".server-box-item.is-selected"), true);
  updateHeroListScrollFade(profileListItemsEl);
}

async function loadProfileList() {
  const profiles = await window.luna.listProfiles();
  lastProfilesData = profiles;
  const selected = profiles.find((p) => p.selected);
  if (selected && profileChipName) profileChipName.textContent = selected.name;
  renderProfileListItems();
}

// 24-48차: "프로필 골랐을 때 서버가 고른 게 꺼져야 하는데 켜져있고" - 서버 선택과 프로필
// 선택은 launch_mode 하나로 서로 배타적인데(서버를 고르면 프로필 선택이 풀리고, 반대도
// 마찬가지 - main.js의 servers:select/profiles:select 참고), 지금까지는 서버를 고르면
// 서버 목록(loadServerList)만, 프로필을 고르면 프로필 목록(loadProfileList)만 다시
// 불러왔음. 반대쪽 목록은 화면에 안 보이는 동안 다시 안 불러와지니 DOM에는 예전 선택
// 표시(.is-selected)가 그대로 남아있었고, 나중에 서버<>프로필 스위치를 다시 눌러 그
// 목록으로 돌아가면(그 사이 다시 안 불러왔으므로) 낡은 선택 표시가 계속 켜진 채로
// 보였던 것. 서버든 프로필이든 하나를 고르면 항상 양쪽 목록을 같이 다시 불러오도록 통일함.
async function refreshLaunchTargetLists() {
  await Promise.all([loadServerList(), loadProfileList()]);
}

// 시작할 때 프로필 목록도 바로 로드
loadProfileList();
refreshChipActiveStates();

// ---- 현재 버전 / 제작자 표시 -----------------------------------------------
Promise.all([window.luna.getAppVersion?.(), window.luna.getCreator?.()]).then(
  ([v, creator]) => {
    if (v) {
      const homeEl = document.getElementById("app-version");
      if (homeEl) homeEl.textContent = "v" + v;
      const loginEl = document.getElementById("login-version");
      if (loginEl) loginEl.textContent = `v${v} · 제작자 ${creator || ""}`;
    }
    const creatorEl = document.getElementById("app-creator");
    if (creatorEl && creator) creatorEl.textContent = creator;
  }
);
document.getElementById("app-version")?.addEventListener("click", () => {
  window.luna.openReleases?.();
});

// ---- 최근 업데이트 날짜 표시 -------------------------------------------------
window.luna.getLastUpdate?.().then((iso) => {
  const el = document.getElementById("last-update");
  if (!el || !iso) return;
  try {
    const d = new Date(iso);
    const text = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
      d.getDate()
    ).padStart(2, "0")}`;
    el.textContent = `최근 업데이트 ${text}`;
  } catch (_) {
    /* 무시 */
  }
});

// ---- 자동 업데이트 -----------------------------------------------------------
// 새 버전이 있으면 타이틀바에 업데이트 아이콘을 표시. 언제든 눌러서 시작 가능.
// 다운로드 진행률 화면은 별도의 독립된 창(update.html)에서 처리함.
const btnUpdateAvailable = document.getElementById("btn-update-available");

window.luna.onUpdateAvailable?.(() => {
  if (btnUpdateAvailable) btnUpdateAvailable.hidden = false;
});

btnUpdateAvailable?.addEventListener("click", () => {
  btnUpdateAvailable.hidden = true; // 누르면 바로 시작되니 아이콘은 숨김
  window.luna.startUpdateDownload?.();
});

// ---- 설정 / 업데이트 내역 오버레이 -------------------------------------------
const btnSettingsSave = document.getElementById("btn-settings-save");
const settingsOverlay = document.getElementById("settings-overlay");

// 24-58차: "배경음악 설정이랑 음악 아예 전부 삭제하자" - 여기 있던 런처 배경음악 볼륨
// 슬라이더(setLauncherVolume/setLauncherVolumeValue) DOM 참조를 제거함(효과음 볼륨은 유지)
const setSfxVolume = document.getElementById("set-sfx-volume");
const setSfxVolumeValue = document.getElementById("set-sfx-volume-value");
// 17차: 게임 실행 시 런처 동작 / 자동 실행 / 상태 공유 여부
// 24-23차: 자동 실행이 select("아니오"/"예"/"백그라운드로") 하나였던 걸 체크박스 2개로
// 나눔(자동 실행 켜기 + 백그라운드로 시작) - 저장되는 값(autostartMode: "no"/"yes"/
// "background")은 그대로라 main.js는 안 건드림
const setOnLaunchBehavior = document.getElementById("set-on-launch-behavior");
const setAutostartEnabled = document.getElementById("set-autostart-enabled");
const setAutostartBackground = document.getElementById("set-autostart-background");
const autostartBackgroundRow = document.getElementById("setting-row-autostart-background");
const setHidePresence = document.getElementById("set-hide-presence");
// 24-24차: "설정 화면에서 전체화면 + 해상도 기능 넣어주고" - 서버로 플레이할 때 쓰이던
// 하드코딩 1280x720을 직접 바꿀 수 있는 UI (main.js DEFAULT_SETTINGS의 mcResolutionWidth/
// mcResolutionHeight/mcFullscreen과 짝을 이룸)
const setMcResolutionWidth = document.getElementById("set-mc-resolution-width");
const setMcResolutionHeight = document.getElementById("set-mc-resolution-height");
const setMcFullscreen = document.getElementById("set-mc-fullscreen");


function fillSettingsForm(s) {
  if (setOnLaunchBehavior) setOnLaunchBehavior.value = s.onLaunchBehavior || "stay";
  const autostartMode = s.autostartMode || "no";
  if (setAutostartEnabled) setAutostartEnabled.checked = autostartMode !== "no";
  if (setAutostartBackground) setAutostartBackground.checked = autostartMode === "background";
  if (autostartBackgroundRow) autostartBackgroundRow.classList.toggle("is-disabled", autostartMode === "no");
  // 24-23차: "친구에게 지금 뭐하는지 공유 안 하기"(체크=숨김) -> "친구에게 상태 공유"(체크=공유)로
  // 문구를 긍정형으로 바꾸면서 체크 의미도 반전시킴 - 저장 필드명(hidePresence)은 그대로 둠
  if (setHidePresence) setHidePresence.checked = !s.hidePresence;
  if (setMcResolutionWidth) setMcResolutionWidth.value = s.mcResolutionWidth || 1280;
  if (setMcResolutionHeight) setMcResolutionHeight.value = s.mcResolutionHeight || 720;
  if (setMcFullscreen) setMcFullscreen.checked = !!s.mcFullscreen;
  setSfxVolume.value = s.sfxVolume;
  setSfxVolumeValue.textContent = s.sfxVolume + "%";
  // 7-1: language-picker도 .theme-option 클래스를 같이 쓰지만(스타일 재사용), 여기서는
  // 진짜 다크/화이트/시스템 테마 버튼(.lang-option이 아닌 것)만 골라서 상태를 맞춤
  document.querySelectorAll(".theme-option:not(.lang-option)").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.theme === (s.theme || "dark"));
  });
  // 24-14차: "시스템 언어" 옵션이 없어지면서 language는 항상 ko/en 둘 중 하나로 확정되어
  // 내려옴 - 혹시 모를 예전 값(system)이 남아있는 경우만 안전하게 ko로 폴백
  document.querySelectorAll(".lang-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.lang === (s.language === "en" ? "en" : "ko"));
  });
  // 설정 화면이 열리는 시점(hidden=false 직후)에 openSettings()에서 다시 애니메이션 없이 맞춰줌
}

// 17차: 이 세 설정은 테마/언어 선택과 같이 고르자마자 바로 저장됨(따로 "저장" 버튼을
// 안 눌러도 됨) - autostartMode는 main.js의 settings:set 핸들러가 바뀐 걸 감지해서
// applyAutostartSetting()을 자동으로 다시 호출해줌
setOnLaunchBehavior?.addEventListener("change", () => {
  window.luna.setSettings({ onLaunchBehavior: setOnLaunchBehavior.value });
});
// 24-23차: 체크박스 2개(자동 실행 켜기 + 백그라운드로 시작)를 예전 select 3지선다와 같은
// autostartMode 값("no"/"yes"/"background")으로 합쳐서 저장함
function saveAutostartMode() {
  const enabled = !!setAutostartEnabled?.checked;
  const background = !!setAutostartBackground?.checked;
  autostartBackgroundRow?.classList.toggle("is-disabled", !enabled);
  window.luna.setSettings({ autostartMode: !enabled ? "no" : background ? "background" : "yes" });
}
setAutostartEnabled?.addEventListener("change", saveAutostartMode);
setAutostartBackground?.addEventListener("change", saveAutostartMode);
setHidePresence?.addEventListener("change", () => {
  window.luna.setSettings({ hidePresence: !setHidePresence.checked });
});
function saveMcResolution() {
  const w = Math.max(640, Math.min(7680, Number(setMcResolutionWidth?.value) || 1280));
  const h = Math.max(480, Math.min(4320, Number(setMcResolutionHeight?.value) || 720));
  if (setMcResolutionWidth) setMcResolutionWidth.value = w;
  if (setMcResolutionHeight) setMcResolutionHeight.value = h;
  window.luna.setSettings({ mcResolutionWidth: w, mcResolutionHeight: h });
}
setMcResolutionWidth?.addEventListener("change", saveMcResolution);
setMcResolutionHeight?.addEventListener("change", saveMcResolution);
setMcFullscreen?.addEventListener("change", () => {
  window.luna.setSettings({ mcFullscreen: setMcFullscreen.checked });
});

// 저장 버튼을 안 누르고 바깥을 클릭하거나 X로 닫으려고 할 때, 바뀐 게 있으면 저장할지 물어봄
let settingsDirty = false;
[setSfxVolume].forEach((el) => {
  el?.addEventListener("input", () => {
    settingsDirty = true;
  });
});

// 9차: 설정 좌측 카테고리 목록도 다른 탭 전환처럼 슬라이딩 하이라이트를 씀
// 11차: "설정같은 세로로 된 박스는 애니메이션 넣으면 안 돼, 심플하게 해줘야 해" - 슬라이드
// 이동 연출을 빼고 항상 즉시(instant) 전환만 되도록 고정함(하이라이트 자체는 유지)
const settingsNavPill = mountSlidingPill(document.querySelector(".settings-nav"), "slide-pill-settings-nav");
function updateSettingsNavPill() {
  const active = document.querySelector(".settings-nav-item.is-active");
  settingsNavPill.update(active, true);
}

// 설정 팝업 안 카테고리 전환 (스킨/플레이/화면/클라이언트)
function showSettingsCategory(cat) {
  document.querySelectorAll(".settings-nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.cat === cat);
  });
  document.querySelectorAll(".settings-panel-section").forEach((sec) => {
    sec.classList.toggle("is-active", sec.dataset.catPanel === cat);
  });
  updateSettingsNavPill();
  // 6차: 테마 모드 pill은 "화면" 카테고리 패널 안에 있어서, 그 패널이 실제로 보이게 된
  // 시점에야 위치를 정확히 잴 수 있음 (숨겨진 동안엔 offsetWidth가 0)
  if (cat === "display") {
    requestAnimationFrame(() => {
      updateThemeModePill?.(true);
      updateLangModePill?.(true);
    });
  }
  // 24-24차: 탭마다 내용 길이가 달라서 스크롤 가능 여부도 달라지는데, 이전 탭에서 계산된
  // has-more/has-more-top이 그대로 남아있으면 안 맞을 수 있음 - 탭 전환마다(그리고 방금 켜진
  // 패널이 실제로 레이아웃을 잡은 다음) 다시 계산함
  const settingsContentEl = document.getElementById("settings-content");
  if (settingsContentEl) {
    settingsContentEl.scrollTop = 0;
    requestAnimationFrame(() => updateHeroListScrollFade(settingsContentEl));
  }
}
document.querySelectorAll(".settings-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => showSettingsCategory(btn.dataset.cat));
});

let changelogLoaded = false;
async function loadChangelog() {
  const container = document.getElementById("changelog-list");
  // 실제로 스크롤이 걸려있는 건 이 목록(container) 자신(.updates-popup-changelog에 overflow-y:auto)인데,
  // 예전엔 스크롤 안 되는 부모 박스를 스크롤시키려고 해서 "최신 업데이트부터 보기"가 항상 실패했음
  if (changelogLoaded) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  const list = await window.luna.getChangelog();
  container.innerHTML = "";
  (list || []).forEach((entry) => {
    const el = document.createElement("div");
    el.className = "changelog-entry";
    el.innerHTML = `
      <div class="changelog-entry-head">
        <span class="changelog-version">v${entry.version}</span>
        <span class="changelog-date">${entry.date}</span>
      </div>
      <ul>${(entry.items || []).map((i) => `<li>${i}</li>`).join("")}</ul>
    `;
    container.appendChild(el);
  });
  changelogLoaded = true;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

async function openUpdates() {
  document.getElementById("updates-overlay").hidden = false;
  loadChangelog();

  // 17차: 업데이트 내역을 실제로 열어봤으니 "안 읽음" 점을 지움
  window.luna.markUpdateSeen?.();
  document.getElementById("settings-about-update-dot")?.setAttribute("hidden", "");

  const [current, latestList] = await Promise.all([
    window.luna.getAppVersion?.(),
    window.luna.getChangelog(),
  ]);
  document.getElementById("updates-current-version").textContent = current || "-";

  const latestVersion = latestList?.[latestList.length - 1]?.version;
  const badge = document.getElementById("updates-status-badge");
  // 18-1(4차) 버그 수정: 최신 버전인데도 "업데이트 가능"이 뜨던 원인 - 문자열을 그냥 !==로
  // 비교하고 있어서, 표기 형식이 살짝만 달라도(예: changelog엔 "1.4.0", 실제 앱 버전은 "1.4")
  // 사실상 같은 버전인데 다르다고 오판했음. compareVersionStrings로 숫자 단위 비교를 해서,
  // changelog의 마지막 항목이 지금 버전보다 "진짜로 더 높을 때"만 업데이트 가능으로 표시
  const isNewer = latestVersion && current && compareVersionStrings(latestVersion, current) > 0;
  if (isNewer) {
    badge.textContent = "업데이트 가능";
    badge.className = "updates-status-badge is-outdated";
  } else {
    badge.textContent = "최신 버전이에요";
    badge.className = "updates-status-badge is-latest";
  }
}
document.getElementById("btn-updates-close")?.addEventListener("click", () => {
  document.getElementById("updates-overlay").hidden = true;
});
document.getElementById("btn-updates-github")?.addEventListener("click", () => {
  window.luna.openReleases?.();
});

// 설정은 이제 전체 화면이 아니라 작은 팝업으로 뜸 (기존 화면 그대로 두고 그 위에 띄움)
async function openSettings() {
  const s = await window.luna.getSettings();
  fillSettingsForm(s);
  settingsDirty = false;
  // 24-54차: 프로필 사진 미리보기가 더 이상 renderSiteAccountPanel 안에서 매번 다시
  // 그려지지 않으므로, 설정 창을 열 때 여기서 한 번 새로 불러옴
  loadAvatarPreview();
  loadNicknameTicketCount();
  // 24-31차: "내 프로필을 설정 맨 위로 올려" - 목록 맨 앞이 "내 프로필"로 바뀌면서
  // 기본으로 열리는 탭도 같이 옮김(18차 때 세운 "목록 맨 앞 = 기본 탭" 관례를 그대로 따름)
  showSettingsCategory("profile");
  document.getElementById("settings-overlay").hidden = false;
  // 6차: 설정 화면이 숨겨져 있는 동안엔 pill 위치를 잴 수 없으므로, 실제로 보이게 된
  // 지금 시점에 애니메이션 없이 다시 맞춰둠
  requestAnimationFrame(() => {
    updateThemeModePill?.(true);
    updateSettingsNavPill?.(true);
  });
  loadInstalledSize();
  loadProfileBio();
  loadSiteAccountPanel();
  loadJavaInfoSection();
  loadThemeGallery();
}

// 18차: "설정에서는 스킨을 없애고 저기(사이드바 더보기)로 옮겨야지" - 3D 미리보기 + 기본
// 스킨 목록을 설정 팝업이 아니라 독립된 작은 팝업(#skin-overlay)에서 열도록 분리
function openSkinOverlay() {
  document.getElementById("skin-overlay").hidden = false;
  loadSkinSection();
}
function closeSkinOverlay() {
  document.getElementById("skin-overlay").hidden = true;
  // 19차: 프리셋/커스텀 목록의 3D 캔버스들(WebGL 컨텍스트)을 닫을 때 정리해서 계속
  // 쌓이지 않게 함
  disposeSkinViewersIn(document.getElementById("skin-default-presets-grid"));
  disposeSkinViewersIn(document.getElementById("skin-custom-list"));
}
document.getElementById("btn-skin-overlay-close")?.addEventListener("click", closeSkinOverlay);

// 19차: "소식은 포럼이 아니야 내가 올리는 완전 이벤트나 이런 거야, 소식에는 여러 박스로
// 올라갈 거야" - 개발자가 news.json(GitHub)에 올린 이벤트/소식을 여러 카드로 보여줌
// 20차: "소식은 창이 따로 열리는 게 아니라 화면이 바뀌어야지" - 독립 팝업(openNewsOverlay)
// 대신, 다른 사이드바 메뉴들처럼 showAppPanel("view-news")로 화면 자체를 바꾸고 이 함수는
// 그 화면의 내용만 채움
async function loadNewsView() {
  const grid = document.getElementById("news-grid");
  if (!grid) return;
  grid.innerHTML = `<div class="news-empty">불러오는 중...</div>`;

  const items = await window.luna.getNews?.();
  if (!items?.length) {
    grid.innerHTML = `<div class="news-empty" data-i18n="news_empty_list">아직 올라온 소식이 없어요</div>`;
    return;
  }

  grid.innerHTML = items
    .map(
      (item) => `
        <div class="news-card" style="${item.color ? `border-top-color:${item.color}` : ""}">
          ${item.tag ? `<span class="news-card-tag" style="${item.color ? `background:${item.color}` : ""}">${escapeHtml(item.tag)}</span>` : ""}
          <div class="news-card-title">${escapeHtml(item.title || "")}</div>
          ${item.description ? `<div class="news-card-desc">${escapeHtml(item.description)}</div>` : ""}
          ${item.date ? `<div class="news-card-date">${escapeHtml(item.date)}</div>` : ""}
        </div>`
    )
    .join("");
}

// 15차: 설정 > 화면의 테마 갤러리 - 기본 3개 밝기 모드(다크/화이트/시스템) 박스는 HTML에
// 이미 있고, 여기서는 상점의 fulltheme(완전 테마) 상품들만 최신 보유 상태를 읽어 그 뒤에
// 미리보기 카드로 이어붙임. 안 산 테마는 잠금 오버레이 + 가격을 보여주고, 클릭하면 상점으로
// 이동시킴(구매는 상점에서만, 착용은 보관함과 동일하게 여기서도 바로 가능)
async function loadThemeGallery() {
  const gallery = document.getElementById("theme-mode-gallery");
  if (!gallery) return;
  gallery.querySelectorAll(".theme-gallery-shop-item").forEach((el) => el.remove());

  const [catalog, state] = await Promise.all([window.luna.getShopCatalog(), window.luna.getShopState()]);
  const fullThemes = catalog.filter((c) => c.category === "fulltheme");

  // 16차: "다크나 화이트를 고르면 블랙앤화이트나 핑크는 꺼져야 하는데 이상해, 이중 하나만
  // 가능한 거야" - 다크/화이트 모드 버튼과 상점 완전테마(fulltheme) 카드가 서로 독립적으로
  // "활성" 표시를 갖고 있어서, 완전테마가 장착된 상태에서도 다크/화이트 버튼이 계속 활성으로
  // 보이는(그리고 실제로는 완전테마가 배경을 계속 덮어써서 아무 변화도 없는) 문제가 있었음 -
  // 이 갤러리 전체를 하나의 라디오 그룹처럼 취급해서, 완전테마가 장착돼 있으면 다크/화이트
  // 버튼은 비활성으로 표시함(둘 중 하나만 "선택됨"으로 보이게)
  // 17차: 완전 테마는 이제 색상과 별도 슬롯(equippedMode)에 저장됨
  const equippedFullTheme = fullThemes.find((c) => c.id === state.equippedMode) || null;
  document.querySelectorAll(".theme-mode-option").forEach((btn) => {
    btn.classList.toggle("is-active", !equippedFullTheme && btn.dataset.theme === (currentThemeSetting || "dark"));
  });

  fullThemes.forEach((item) => {
    const owned = state.owned.includes(item.id);
    const equipped = state.equippedMode === item.id;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "theme-gallery-item theme-gallery-shop-item" + (equipped ? " is-active" : "") + (owned ? "" : " is-locked");
    // 16차: 다크/화이트 미리보기 박스와 마찬가지로 상점 테마 카드도 사이드바 띠 + 글줄
    // 목업을 넣어서 납작한 색상 사각형이 아니라 미니 클라이언트 화면처럼 보이게 함
    card.innerHTML = `
      <div class="theme-gallery-preview theme-gallery-preview-shop" style="background:${item.hex}">
        <span class="theme-gallery-preview-side"></span>
        <span class="theme-gallery-preview-lines"><span></span><span></span><span></span></span>
        ${owned ? "" : `<span class="theme-gallery-lock"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="10.5" width="14" height="9" rx="1.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke-linecap="round"/></svg></span>`}
      </div>
      <span class="theme-gallery-item-label">${escapeHtml(item.name)}${owned ? "" : ` · 🪙 ${item.price}`}</span>
    `;
    card.addEventListener("click", async () => {
      if (!owned) {
        closeSettings();
        document.querySelector('.sidebar-icon[data-panel="shop"]')?.click();
        return;
      }
      if (equipped) return;
      const res = await window.luna.equipColor(item.id);
      if (res.ok) {
        // 17차: 완전 테마를 새로 착용해도 이미 착용 중이던 색상 슬롯은 그대로 유지되므로,
        // 그 색상 아이템을 같이 찾아서 둘 다 넘겨줌(동시 적용)
        const equippedColorItem = res.equipped ? catalog.find((c) => c.id === res.equipped) : null;
        applyThemeColor(equippedColorItem, item);
        loadThemeGallery();
      }
    });
    gallery.appendChild(card);
  });
}

// 7-2: 설정 > 클라이언트에 마인크래프트/Fabric 버전별로 필요한 자바 버전과 설치 위치를 보여줌
async function loadJavaInfoSection() {
  const listEl = document.getElementById("java-info-list");
  if (!listEl) return;
  listEl.innerHTML = `<div style="color:var(--text-2); font-size:12px;">확인 중...</div>`;
  const info = await window.luna.getJavaInfo?.();
  if (!info || info.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-2); font-size:12px;">정보를 확인할 수 없어요</div>`;
    return;
  }
  listEl.innerHTML = "";
  info.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "java-info-row " + (entry.installed ? "is-installed" : "is-missing");
    row.innerHTML = `
      <span class="java-info-check">${entry.installed ? "✓" : "-"}</span>
      <div class="java-info-main">
        <div class="java-info-title">Java ${entry.javaFeatureVersion} · ${entry.mcVersions.join(", ")}</div>
        <div class="java-info-sub">${entry.installed ? entry.path : "아직 설치되지 않았어요 (해당 버전으로 처음 실행할 때 자동으로 받아요)"}</div>
      </div>
      <button type="button" class="java-info-open-btn" ${entry.installed ? "" : "disabled"}>폴더 열기</button>
    `;
    const openBtn = row.querySelector(".java-info-open-btn");
    if (entry.installed) {
      openBtn.addEventListener("click", () => window.luna.openJavaFolder?.(entry.javaFeatureVersion));
    }
    listEl.appendChild(row);
  });
}

async function loadProfileBio() {
  const bioEl = document.getElementById("set-profile-bio");
  if (!bioEl || !currentProfile?.uuid) return;
  const info = await window.luna.forumGetUserInfo(currentProfile.uuid);
  bioEl.value = info?.bio || "";
}
document.getElementById("btn-profile-bio-save")?.addEventListener("click", async () => {
  const bioEl = document.getElementById("set-profile-bio");
  const res = await window.luna.setProfileBio(bioEl.value);
  if (res.ok) showToast("자기소개를 저장했어요");
  else showToast(res.error || "저장에 실패했어요.", "error");
});

// 24-4차: 사이트 전용 계정(마인크래프트 계정 여러 개 + 디스코드를 하나로 묶는 연동) 패널.
// #site-account-panel은 항상 통째로 다시 그려서(innerHTML 교체) 안의 버튼/입력 리스너도
// 그때마다 새로 붙임 - 목록 항목 개수가 그때그때 달라지는 화면이라 이 쪽이 더 단순함.
// 24-4차부터는 로그인 자체가 사이트 계정 기준이라(view-login이 사이트 로그인 화면으로
// 바뀜) 여기서 더 이상 "계정 만들기"를 하지 않고, 항상 로그인해있는 사이트 계정을 보여줌 -
// 그래서 currentProfile(마인크래프트 계정) 대신 currentSiteAccount 유무로 게이트함.
async function loadSiteAccountPanel() {
  const panel = document.getElementById("site-account-panel");
  if (!panel || !currentSiteAccount) return;
  panel.innerHTML = `<div style="color:var(--text-2); font-size:12px;">확인 중...</div>`;
  let siteRes;
  try {
    siteRes = await window.luna.getSiteAccount();
  } catch (_) {
    siteRes = null;
  }
  if (!siteRes?.ok) {
    panel.innerHTML = `<div style="color:var(--text-2); font-size:12px;">사이트 계정 정보를 불러오지 못했어요.</div>`;
    return;
  }
  currentSiteAccount = siteRes.account;
  renderSiteAccountPanel(siteRes.account);
}

// 24-15차: "여기에 마크 로그인이 있어야지, 마크 로그인을 해야 연동된 리스트에 추가를
// 해줘야지 한번 했다고 연동을 했다뺐다 하냐?" - 예전엔 이미 이 런처에 로그인해둔 로컬 계정
// 중 하나를 드롭다운에서 "골라서" 연동만 하는 방식이라, 진짜 마이크로소프트 로그인 없이도
// 계속 연동을 뗐다 붙였다 할 수 있었음. 이제 이 패널이 마인크래프트 로그인의 유일한 자리 -
// 실제 마이크로소프트 로그인에 성공해야만 연동됨.
// 24-23차: "마크 계정당 노바클 계정 1개라고 노바클 계정은 마크 계정 여러개 된다고" - 24-15차
// 때는 "연동은 계정당 하나만"이었는데 반대로 뒤집혔음 - 사이트 계정 하나에 마인크래프트
// 계정을 여러 개 연동할 수 있고, 각 마인크래프트 계정은 사이트 계정 하나에만 연동됨(서버가
// 그 반대 방향을 계속 지켜줌). 해제는 여전히 다시 로그인해야만 재연동됨(로컬 캐시로 몰래
// 재연동되는 경로 없음).
function renderSiteAccountPanel(account) {
  const panel = document.getElementById("site-account-panel");
  if (!panel) return;

  currentSiteAccount = account;
  // 24-15차: 마인크래프트 계정을 해제해서 더 이상 연동된 계정이 없어지면(=1개 제한 하의
  // "게스트"가 다시 되면), 설정 화면에 계속 머물 게 아니라 곧바로 마인크래프트 연동
  // 화면으로 돌려보내야 함.
  // 24-22차: "연동 해제 눌렀는데 이렇게 뜨잖아(경고 토스트만 뜨고 화면은 홈에 그대로)" -
  // 예전엔 showAppPanel("view-home")을 불러서 그 안의 게이트가 알아서 view-mc-gate로
  // 대신 보내주는 방식이었는데, 24-18차에 추가한 "이미 인증된 화면에서는 게이트가 화면을
  // 강제로 안 바꾼다"는 안전장치(화면 유지 요청 대응)가 이 요청 id("view-home")와 실제
  // 게이트 결과("view-mc-gate")가 다르다고 보고 이 의도적인 전환까지 같이 막아버렸음 -
  // 해제 직후엔 홈이 아니라 애초에 view-mc-gate로 가고 싶은 것이므로, 처음부터 그 화면을
  // 직접 요청함(요청 id와 게이트 결과 id가 같아서 그 안전장치에 걸리지 않고 정상 전환됨)
  if (!hasLinkedMcAccount()) {
    closeSettings();
    showAppPanel("view-mc-gate");
  }

  if (!account) {
    panel.innerHTML = `<div style="color:var(--text-2); font-size:12px;">사이트 계정 정보를 불러오지 못했어요.</div>`;
    return;
  }

  const links = account.links || [];
  const mcLinks = links.filter((l) => l.provider === "minecraft");
  const discordLink = links.find((l) => l.provider === "discord");

  const linkRows = links
    .map((l) => {
      const badge = l.provider === "minecraft" ? "MC" : "DC";
      return `
        <div class="site-account-link-row">
          <div class="site-account-link-info">
            <span class="site-account-link-badge">${badge}</span>
            <span class="site-account-link-name">${escapeHtml(l.provider_name || l.provider_uid)}</span>
          </div>
          <button class="btn btn-ghost btn-small btn-unlink-site-account" type="button" data-link-id="${l.id}">해제</button>
        </div>
      `;
    })
    .join("") || `<div style="color:var(--text-2); font-size:11.5px;">아직 연동된 마인크래프트 계정이 없어요. 아래 버튼으로 로그인하면 자동으로 연동돼요.</div>`;

  // 24-23차: "마크 계정당 노바클 계정 1개라고 노바클 계정은 마크 계정 여러개 된다고" -
  // 사이트 계정 하나에 마인크래프트 계정을 여러 개 연동할 수 있게 바뀌면서, 이미 하나
  // 연동돼 있어도 로그인 버튼을 계속 보여줌(문구만 "처음 연동"과 "추가 연동"으로 구분).
  const mcLinkForm = `<button id="btn-link-mc-account" class="btn btn-primary btn-small" type="button">${
    mcLinks.length > 0 ? "다른 마인크래프트 계정 추가로 연동하기" : "마인크래프트 계정으로 로그인해서 연동하기"
  }</button>`;

  // 24-54차: "프로필 사진이 사이트 계정에 왜 있어 내 프로필에 있어야지" - 프로필 사진
  // 변경 UI(#site-account-avatar-preview/#btn-change-avatar)는 이제 index.html의 "내 프로필"
  // 영역 최상단에 고정 마크업으로 옮겨져서, 이 패널이 다시 그려질 때마다 같이 새로 만들
  // 필요가 없어짐(로드/리스너는 openSettings()에서 한 번만 처리)
  panel.innerHTML = `
    <div class="site-account-name">${escapeHtml(account.login_id || account.display_name || "사이트 계정")}</div>
    <div class="site-account-links">${linkRows}</div>
    <div class="settings-subgroup-title" style="margin-top:6px; padding-top:10px;">마인크래프트 계정 연동</div>
    ${mcLinkForm}
    <div class="settings-subgroup-title" style="margin-top:6px; padding-top:10px;">디스코드 연동</div>
    <div class="site-account-link-form">
      <input id="site-account-discord-input" type="text" class="setting-input" placeholder="디스코드 태그 (예: username)" value="${escapeHtml(discordLink?.provider_name || "")}" />
      <button id="btn-link-discord" class="btn btn-ghost btn-small" type="button">저장</button>
    </div>
    <button id="btn-site-account-logout" class="btn btn-ghost btn-small" type="button" style="align-self:flex-start; margin-top:6px;">사이트 계정 로그아웃</button>
  `;
  // 24-69차: 닉네임 변경 UI는 이제 이 패널 안이 아니라 "내 프로필" 최상단(프로필 사진 옆)의
  // 고정 마크업으로 옮겨졌음(index.html profile-identity-row 참고) - 여기서 다시 그릴 때마다
  // 매번 새로 만들 필요가 없어져서, 이 패널이 새로고침돼도(계정 전환 등) 닉네임 입력칸에
  // 타이핑 중이던 내용이 날아가지 않음. 다만 닉네임 변경으로 로그인 아이디 자체가 바뀌면
  // 위 site-account-name 표시는 이 함수가 다시 그리면서 자동으로 최신화됨.

  panel.querySelectorAll(".btn-unlink-site-account").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // 24-24차: "연동 해제 눌렀을 때 로딩창이라도 띄워줘라 되는지 아닌지 모르겠다" - 누른
      // 즉시 버튼 글자를 "해제하는 중..."으로 바꾸고 잠가서, 응답이 올 때까지 눌린 게 맞는지
      // 알 수 있게 함. 성공 시엔 패널이 통째로 다시 그려지며 버튼도 새로 생기니 원상복구가
      // 따로 필요 없고, 실패했을 때만 원래 글자/상태로 되돌림
      if (btn.dataset.busy) return;
      btn.dataset.busy = "1";
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "해제하는 중...";
      // 24-23차: 지금 실제로 플레이 중인 계정을 해제하는 건지 미리 확인해둠 - 다른(지금
      // 안 쓰는) 연동 계정을 해제할 땐 화면 전환이 필요 없음
      const wasActiveLink = mcLinks.some(
        (l) => l.id === btn.dataset.linkId && normalizeUuidForCompare(l.provider_uid) === normalizeUuidForCompare(currentProfile?.uuid)
      );
      const res = await window.luna.unlinkSiteAccountLink(btn.dataset.linkId);
      if (!res.ok) {
        btn.dataset.busy = "";
        btn.disabled = false;
        btn.textContent = originalText;
      }
      if (res.ok) {
        currentSiteAccount = res.account;
        if (wasActiveLink) {
          const switched = await trySwitchToAnotherLinkedAccount(res.account);
          if (switched) {
            showToast(`연동을 해제하고 ${switched.name}(으)로 전환했어요`);
            renderSiteAccountPanel(res.account);
            return;
          }
          showToast("연동을 해제했어요. 다시 연동하려면 마인크래프트 계정으로 새로 로그인해주세요.");
          closeSettings();
          showAppPanel("view-mc-gate");
          return;
        }
        showToast("연동을 해제했어요.");
        renderSiteAccountPanel(res.account);
      } else {
        showToast(res.error || "연동을 해제하지 못했어요.", "error");
      }
    });
  });

  let isLinkingMc = false;
  document.getElementById("btn-link-mc-account")?.addEventListener("click", async (e) => {
    if (isLinkingMc) return;
    isLinkingMc = true;
    // 24-24차: "추가할 때도 마찬가지로" - 마이크로소프트 로그인 창이 뜨는 동안(사용자가
    // 실제 로그인을 마칠 때까지 시간이 걸림) 버튼이 그냥 회색으로 죽어있기만 해서 눌린 건지
    // 안 눌린 건지 알기 어려웠음 - 글자를 "연동하는 중..."으로 바꿔서 진행 중임을 알려줌
    const originalText = e.target.textContent;
    e.target.disabled = true;
    e.target.textContent = "연동하는 중...";
    try {
      const res = await window.luna.login();
      if (res.ok) {
        await refreshSiteLinkStateAfterMcLogin(res);
        currentProfile = res.profile;
        updateProfileClusterDisplay();
        if (hasLinkedMcAccount()) {
          showToast("마인크래프트 계정을 연동했어요");
        }
        // getSiteAccount로 링크 목록까지 다시 반영된 최신 상태로 패널을 다시 그림
        await loadSiteAccountPanel();
      } else {
        e.target.disabled = false;
        e.target.textContent = originalText;
        if (res.error) showToast(res.error, "error");
      }
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = originalText;
      throw err;
    } finally {
      isLinkingMc = false;
    }
  });

  document.getElementById("btn-link-discord")?.addEventListener("click", async () => {
    const input = document.getElementById("site-account-discord-input");
    const res = await window.luna.linkDiscordAccount(input?.value || "");
    if (res.ok) {
      showToast("디스코드를 연동했어요");
      renderSiteAccountPanel(res.account);
    } else {
      showToast(res.error || "디스코드를 연동하지 못했어요.", "error");
    }
  });

  document.getElementById("btn-site-account-logout")?.addEventListener("click", async () => {
    await siteLogoutAndReturnToLogin();
  });
}

// ---- 24-45차 신규: 프로필 사진(아바타) 선택 + 크롭 -----------------------------
// 기본 사람 아이콘(아직 사진을 안 골랐을 때 원형 미리보기 안에 보여줌)
// 24-54차: 프로필 사진 미리보기 요소가 이제 index.html "내 프로필" 영역에 고정 마크업으로
// 있어서(renderSiteAccountPanel처럼 매번 다시 그려지지 않음), 변경 버튼 리스너도 한 번만
// 붙이면 됨 - 로드 자체는 설정 창을 열 때마다 openSettings()에서 새로 함
document.getElementById("btn-change-avatar")?.addEventListener("click", openAvatarCropFlow);

// 24-69차: 닉네임 변경도 프로필 사진과 같은 자리(내 프로필 최상단)로 옮기면서 같은 패턴을
// 따름 - 리스너는 한 번만 붙이고, 데이터(보유 변경권 개수)만 openSettings()에서 새로 불러옴
document.getElementById("btn-use-nickname-ticket")?.addEventListener("click", handleUseNicknameTicket);

async function loadNicknameTicketCount() {
  const el = document.getElementById("nickname-ticket-count");
  if (!el) return;
  try {
    const state = await window.luna.getShopState?.();
    const have = state?.consumables?.nicknameChangeTickets || 0;
    el.textContent = have > 0 ? `(보유 변경권 ${have}개)` : "(보유 변경권 없음 - 상점 > 기타 탭에서 구매)";
  } catch (_) {
    el.textContent = "";
  }
}

async function handleUseNicknameTicket(e) {
  const btn = e.currentTarget;
  const input = document.getElementById("site-account-new-nickname-input");
  const newNickname = (input?.value || "").trim();
  if (!newNickname) {
    showToast("새 닉네임을 입력해주세요.", "error");
    return;
  }
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "변경하는 중...";
  try {
    const res = await window.luna.useNicknameTicket(newNickname);
    if (res.ok) {
      showToast("닉네임을 변경했어요.");
      if (input) input.value = "";
      renderSiteAccountPanel(res.account);
      loadNicknameTicketCount();
      updateProfileClusterDisplay?.();
    } else {
      showToast(res.error || "닉네임 변경에 실패했어요.", "error");
    }
  } catch (err) {
    showToast("닉네임 변경에 실패했어요.", "error");
  } finally {
    btn.dataset.busy = "";
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function loadAvatarPreview() {
  const el = document.getElementById("site-account-avatar-preview");
  if (!el) return;
  try {
    const url = await window.luna.getAvatar?.();
    if (url) {
      el.innerHTML = "";
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    }
  } catch (_) {
    // 실패해도 기본 아이콘 그대로 두면 됨
  }
}

// 캔버스 크롭 상태 - 팝업이 열려있는 동안만 쓰는 값들이라 모듈 스코프에 하나씩만 둠
let avatarCropImg = null;
let avatarCropScale = 1;
let avatarCropMinScale = 1;
let avatarCropOffsetX = 0;
let avatarCropOffsetY = 0;
let avatarCropDragging = false;
let avatarCropDragStart = null; // { x, y, offsetX, offsetY }
const AVATAR_CROP_SIZE = 280; // 캔버스(=미리보기) 픽셀 크기
const AVATAR_OUTPUT_SIZE = 320; // 실제로 업로드할 정사각형 이미지 크기(미리보기보다 살짝 크게 저장)

// "고를 때 크기 조정도 할 수 있게" - 파일을 고르면 이 크롭 팝업을 열어서, 드래그로 위치를
// 옮기고 슬라이더로 확대/축소한 뒤 저장하면 그 상태 그대로를 정사각형 PNG로 잘라서 올림
async function openAvatarCropFlow() {
  const picked = await window.luna.pickAvatarTemp();
  if (!picked?.ok) {
    if (!picked?.canceled) showToast(picked?.error || "사진을 선택하지 못했어요", "error");
    return;
  }
  const img = new Image();
  img.onload = () => {
    avatarCropImg = img;
    // 이미지가 캔버스(원형 크롭 영역) 전체를 항상 덮도록 하는 최소 배율 - 이보다 작게
    // 줄이면 원 안에 빈 공간(투명/배경색)이 생겨버림
    avatarCropMinScale = Math.max(AVATAR_CROP_SIZE / img.naturalWidth, AVATAR_CROP_SIZE / img.naturalHeight);
    avatarCropScale = avatarCropMinScale;
    avatarCropOffsetX = 0;
    avatarCropOffsetY = 0;
    const zoomSlider = document.getElementById("avatar-crop-zoom");
    if (zoomSlider) zoomSlider.value = 0;
    document.getElementById("avatar-crop-popup").hidden = false;
    drawAvatarCropCanvas();
  };
  img.onerror = () => showToast("이미지를 불러오지 못했어요", "error");
  img.src = picked.previewUrl;
}

// 지금 scale/offset 상태로 캔버스를 다시 그림 - 이동/확대할 때마다 계속 호출됨
function drawAvatarCropCanvas() {
  const canvas = document.getElementById("avatar-crop-canvas");
  if (!canvas || !avatarCropImg) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, AVATAR_CROP_SIZE, AVATAR_CROP_SIZE);
  const w = avatarCropImg.naturalWidth * avatarCropScale;
  const h = avatarCropImg.naturalHeight * avatarCropScale;
  const x = (AVATAR_CROP_SIZE - w) / 2 + avatarCropOffsetX;
  const y = (AVATAR_CROP_SIZE - h) / 2 + avatarCropOffsetY;
  ctx.drawImage(avatarCropImg, x, y, w, h);
}

// 드래그가 항상 이미지 경계 안쪽에서만 움직이게 막음(원 밖으로 빈 공간이 보이지 않게) -
// 확대/축소 슬라이더 조작 직후에도 다시 불러서 범위를 벗어난 상태를 바로잡음
function clampAvatarCropOffset() {
  if (!avatarCropImg) return;
  const w = avatarCropImg.naturalWidth * avatarCropScale;
  const h = avatarCropImg.naturalHeight * avatarCropScale;
  const maxOffsetX = Math.max(0, (w - AVATAR_CROP_SIZE) / 2);
  const maxOffsetY = Math.max(0, (h - AVATAR_CROP_SIZE) / 2);
  avatarCropOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, avatarCropOffsetX));
  avatarCropOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, avatarCropOffsetY));
}

(function setupAvatarCropInteractions() {
  const canvas = document.getElementById("avatar-crop-canvas");
  const zoomSlider = document.getElementById("avatar-crop-zoom");
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (e) => {
    if (!avatarCropImg) return;
    avatarCropDragging = true;
    canvas.setPointerCapture(e.pointerId);
    avatarCropDragStart = { x: e.clientX, y: e.clientY, offsetX: avatarCropOffsetX, offsetY: avatarCropOffsetY };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!avatarCropDragging || !avatarCropDragStart) return;
    avatarCropOffsetX = avatarCropDragStart.offsetX + (e.clientX - avatarCropDragStart.x);
    avatarCropOffsetY = avatarCropDragStart.offsetY + (e.clientY - avatarCropDragStart.y);
    clampAvatarCropOffset();
    drawAvatarCropCanvas();
  });
  const endDrag = () => { avatarCropDragging = false; avatarCropDragStart = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  zoomSlider?.addEventListener("input", () => {
    if (!avatarCropImg) return;
    // 슬라이더 0~100을 "최소 배율(꽉 채움) ~ 최소 배율의 3배"로 매핑
    const t = Number(zoomSlider.value) / 100;
    avatarCropScale = avatarCropMinScale * (1 + t * 2);
    clampAvatarCropOffset();
    drawAvatarCropCanvas();
  });
})();

document.getElementById("btn-avatar-crop-cancel")?.addEventListener("click", () => {
  document.getElementById("avatar-crop-popup").hidden = true;
  avatarCropImg = null;
});
document.getElementById("btn-avatar-crop-save")?.addEventListener("click", async () => {
  if (!avatarCropImg) return;
  const btn = document.getElementById("btn-avatar-crop-save");
  await withBusyButton(btn, "저장 중...", async () => {
    // 미리보기 캔버스와 완전히 같은 변환을 출력 크기(AVATAR_OUTPUT_SIZE)에 맞게 그대로
    // 비율만 키워서 한 번 더 그림 - 사용자가 화면에서 본 크롭 결과와 실제 저장되는
    // 이미지가 어긋나지 않게 함
    const out = document.createElement("canvas");
    out.width = AVATAR_OUTPUT_SIZE;
    out.height = AVATAR_OUTPUT_SIZE;
    const octx = out.getContext("2d");
    const ratio = AVATAR_OUTPUT_SIZE / AVATAR_CROP_SIZE;
    const w = avatarCropImg.naturalWidth * avatarCropScale * ratio;
    const h = avatarCropImg.naturalHeight * avatarCropScale * ratio;
    const x = (AVATAR_OUTPUT_SIZE - w) / 2 + avatarCropOffsetX * ratio;
    const y = (AVATAR_OUTPUT_SIZE - h) / 2 + avatarCropOffsetY * ratio;
    octx.save();
    octx.beginPath();
    octx.arc(AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, AVATAR_OUTPUT_SIZE / 2, 0, Math.PI * 2);
    octx.clip();
    octx.drawImage(avatarCropImg, x, y, w, h);
    octx.restore();
    const dataUrl = out.toDataURL("image/png");
    const res = await window.luna.uploadAvatar(dataUrl);
    if (res.ok) {
      showToast("프로필 사진을 저장했어요");
      document.getElementById("avatar-crop-popup").hidden = true;
      avatarCropImg = null;
      loadAvatarPreview();
    } else {
      showToast(res.error || "저장하지 못했어요", "error");
    }
  });
});

function closeSettings() {
  document.getElementById("settings-overlay").hidden = true;
}

// X버튼이나 바깥 클릭으로 닫으려고 할 때 - 저장 안 한 변경사항이 있으면 먼저 물어봄
async function requestCloseSettings() {
  if (!settingsDirty) {
    closeSettings();
    return;
  }
  const shouldSave = await showConfirm("설정을 저장하시겠습니까?", "저장", "저장 안 함");
  if (shouldSave) {
    await saveSettingsAndClose();
  } else {
    // 24-58차: 배경음악 기능 자체가 없어지면서, 여기서 슬라이더 미리듣기 볼륨을 저장된
    // 값으로 되돌려주던 코드(런처 배경음악 전용)도 같이 제거함 - 효과음 볼륨은 애초에
    // 슬라이더를 움직이는 것만으로 소리가 나지 않아 되돌릴 "미리듣기 상태"가 없음
    closeSettings();
  }
}

async function openShop() {
  showAppPanel("view-shop");
  // 24-13차: "아직도 위쪽에 상점 위치 문제... 해결 안됐다" - .shop-modal-body는 상점을 열 때마다
  // 새로 만들어지는 게 아니라 계속 같은 DOM을 재사용하는 스크롤 영역이라(overflow-y:auto),
  // 예전에 "전체상품" 쪽으로 스크롤해서 내려가 있던 상태로 상점을 닫았다가 다시 열면 맨 위
  // 메인 상품(캐러셀) 대신 아까 스크롤해뒀던 위치가 그대로 보였음 - 열 때마다 맨 위로 되돌림
  document.querySelector(".shop-modal-body")?.scrollTo({ top: 0 });
  loadShop();
}

function formatBytes(bytes) {
  if (!bytes) return "0MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

async function loadInstalledSize() {
  const el = document.getElementById("installed-size");
  if (!el) return;
  el.textContent = "확인 중...";
  const bytes = await window.luna.getInstalledSize();
  el.textContent = formatBytes(bytes);
}

document.getElementById("btn-reset-install")?.addEventListener("click", async () => {
  const confirmed = await showConfirm(
    "설치된 자바/마인크래프트/모드/설정을 전부 삭제해요. 다음 실행 시 처음부터 다시 받아요. 정말 진행할까요?",
    "삭제",
    "취소"
  );
  if (!confirmed) return;

  const res = await window.luna.resetInstall();
  if (res.ok) {
    showToast("삭제됐어요. 다음 PLAY 때 새로 설치돼요.");
    loadInstalledSize();
  } else {
    showToast(res.error || "삭제 실패", "error");
  }
});

// 설치/구매 등 시간이 걸리는 버튼 클릭을 눌러놓고 다시 누르지 못하게 잠그고, 진행 중 문구를 보여줌
// (연타로 같은 요청이 여러 번 나가서 렉이 생기는 걸 막기 위함)
// 24-61차: "로딩중일 때 화면 그대로 두지 말고" - 문구만 바뀌던 걸 작은 회전 스피너와 함께
// 보여줘서 "지금 뭔가 진행 중"이라는 게 더 눈에 띄게 함(.btn-spinner는 currentColor를 써서
// 버튼 색이 뭐든 자연스럽게 어울림) - 이 함수를 쓰는 기존 18곳(설치/제거/저장/구매 등)에도
// 전부 자동으로 같이 적용됨
async function withBusyButton(btn, busyText, fn) {
  if (!btn || btn.disabled) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "";
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  btn.append(spinner, busyText);
  try {
    await fn();
  } finally {
    // 버튼 자체가 다시 그려져서 사라졌을 수도 있어서, DOM에 남아있을 때만 되돌림
    if (document.body.contains(btn)) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

// 간단한 확인창 (저장/취소 선택) - 어디서든 재사용 가능
function showConfirm(message, confirmLabel = "저장", cancelLabel = "취소") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-ghost btn-small" data-choice="cancel">${cancelLabel}</button>
          <button type="button" class="btn btn-fixed-green btn-small" data-choice="confirm">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      const choice = e.target?.dataset?.choice;
      if (!choice) return;
      document.body.removeChild(overlay);
      resolve(choice === "confirm");
    });
  });
}

// 22차: "삭제할 때에는 재확인 메시지 대신 프로필 이름을 적는 걸로 하자" - 되돌릴 수 없는
// 삭제(프로필 삭제 등)는 예/아니오 두 번 묻는 대신, 대상 이름을 정확히 입력해야만 삭제
// 버튼이 활성화되는 방식으로 바꿈(모드린스/깃허브 등에서 흔한 "타이핑으로 재확인" 패턴)
function showTypeToConfirm(message, expectedText, confirmLabel = "삭제") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const escaped = String(expectedText).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    overlay.innerHTML = `
      <div class="confirm-box type-confirm-box">
        <div class="confirm-message">${message}</div>
        <div class="type-confirm-target">${escaped}</div>
        <input type="text" class="setting-input type-confirm-input" autocomplete="off" spellcheck="false" placeholder="위 이름을 그대로 입력" />
        <div class="confirm-actions">
          <button type="button" class="btn btn-ghost btn-small" data-choice="cancel">취소</button>
          <button type="button" class="btn btn-danger-filled btn-small" data-choice="confirm" disabled>${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".type-confirm-input");
    const confirmBtn = overlay.querySelector('[data-choice="confirm"]');
    const finish = (result) => {
      if (!document.body.contains(overlay)) return;
      document.body.removeChild(overlay);
      resolve(result);
    };
    input.addEventListener("input", () => {
      confirmBtn.disabled = input.value !== expectedText;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !confirmBtn.disabled) finish(true);
    });
    overlay.addEventListener("click", (e) => {
      const choice = e.target?.dataset?.choice;
      if (!choice) return;
      if (choice === "confirm" && confirmBtn.disabled) return;
      finish(choice === "confirm");
    });
    requestAnimationFrame(() => input.focus());
  });
}

async function saveSettingsAndClose() {
  await window.luna.setSettings({
    sfxVolume: Number(setSfxVolume.value),
  });
  settingsDirty = false;
  closeSettings();
}

// ---- 테마 (다크 / 화이트 / 시스템) ---------------------------------------------
let currentThemeSetting = "dark";
async function applyTheme(themeValue) {
  currentThemeSetting = themeValue;
  let resolved = themeValue;
  if (themeValue === "system") {
    const isDark = await window.luna.getSystemIsDark?.();
    resolved = isDark ? "dark" : "light";
  }
  document.body.dataset.theme = resolved === "light" ? "light" : "dark";
}

// 6차: 다크/화이트/시스템 하이라이트에 슬라이딩 pill을 붙였었는데, 12차에서 "설정 화면은
// 잔상(슬라이딩) UI 안 써도 돼, 기존처럼 심플하게 해줘" - 언어 선택 쪽에서 pill이 실제
// 활성 버튼과 다른 자리에 남아 보이는 버그도 있었던 김에, 테마 모드/언어 선택 둘 다 pill
// 오버레이를 완전히 걷어내고 .theme-option.is-active의 테두리+라디오점 스타일만으로
// 표시하도록 되돌림 (호출부를 다 안 건드리도록 함수 이름은 남겨두고 빈 함수로)
function updateThemeModePill() {}
document.querySelectorAll(".theme-option:not(.lang-option)").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".theme-option:not(.lang-option)").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    updateThemeModePill();
    await window.luna.setSettings({ theme: btn.dataset.theme });
    applyTheme(btn.dataset.theme);
    // 16차: "다크나 화이트를 고르면 블랙앤화이트나 핑크는 꺼져야" - 배경/글자색까지 통째로
    // 덮어쓰는 완전테마(fulltheme, 예: 블랙&화이트/핑크)가 장착돼 있으면 다크/화이트를
    // 눌러도 실제로는 그 완전테마가 계속 이겨서 아무것도 안 바뀌어 보이고, 갤러리에도
    // 두 개가 동시에 활성 표시되는 문제가 있었음 - 다크/화이트를 고르면 장착된 완전테마를
    // 같이 해제해서 둘 중 하나만 켜지도록 함
    // 17차: "테마모드랑 색상은 동시에 착용 가능해야" - 완전테마 슬롯만 따로 해제하고,
    // 착용해둔 색상(포인트색) 슬롯은 그대로 유지함(예전엔 equipColor("default")로 둘 다
    // 초기화해버려서 다크/화이트로 바꾸면 애써 고른 색상까지 같이 풀려버렸음)
    if (document.body.dataset.colorTheme) {
      const res = await window.luna.unequipShopCategory?.("fulltheme");
      if (res?.ok) {
        delete document.body.dataset.colorTheme;
        loadThemeGallery();
      }
    }
  });
});

// 9차에서 언어 선택에도 슬라이딩 pill을 붙였었지만 12차에서 위와 같은 이유로 제거함
function updateLangModePill() {}

// 7-1: 언어 선택 - 바로 저장하고, 이번 세션에서 옮긴 문구들은 재시작 없이 바로 바뀜
document.querySelectorAll(".lang-option").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".lang-option").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    updateLangModePill();
    await window.luna.setSettings({ language: btn.dataset.lang });
    const effective = await window.luna.getEffectiveLanguage?.();
    window.NovaI18n?.setLang(effective || "ko");
  });
});

// 시스템 테마를 골랐을 때, OS 설정이 바뀌면 실시간으로 반영
window.luna.onSystemThemeChanged?.((isDark) => {
  if (currentThemeSetting === "system") {
    document.body.dataset.theme = isDark ? "dark" : "light";
  }
});

// 앱 시작할 때부터 저장된 테마 적용
window.luna.getSettings().then((s) => applyTheme(s.theme || "dark"));

// 7-1: 앱 시작할 때 저장된 언어(또는 시스템 언어)를 옮겨둔 문구들에 바로 적용
window.NovaI18n?.initI18n?.();

window.luna.getLicense?.().then((text) => {
  const el = document.getElementById("settings-license");
  if (el && text) el.textContent = text;
});

// 17차: "유료화하니까 법적으로 필요한 사업자 정보도 넣어줘" - main.js CONFIG.BUSINESS_INFO를
// 그대로 표로 보여줌 (실제 값은 사업자가 main.js에서 채워야 하고, 지금은 "미기재" 플레이스홀더)
// 17차: "업데이트 내역에 안 읽은 게 있으면 점 보여줘"
window.luna.hasUnseenUpdate?.().then((unseen) => {
  const dot = document.getElementById("settings-about-update-dot");
  if (dot) dot.hidden = !unseen;
});

window.luna.getBusinessInfo?.().then((info) => {
  const el = document.getElementById("settings-business-info");
  if (!el || !info) return;
  const rows = [
    ["상호명", info.businessName],
    ["대표자", info.representativeName],
    ["사업자등록번호", info.businessRegNo],
    ["통신판매업신고번호", info.mailOrderRegNo],
    ["주소", info.address],
    ["문의", info.contactEmail],
    ["환불정책", info.refundPolicy],
  ];
  el.innerHTML = rows
    .map(([label, value]) => `<div class="business-info-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || "미기재")}</b></div>`)
    .join("");
});

// ---- 설정 화면으로 옮겨진 클라이언트 관련 기능들 -------------------------------
document.getElementById("btn-brand-terms")?.addEventListener("click", () => {
  showTerms({ alreadyAgreed: true });
});
document.getElementById("btn-restart-launcher")?.addEventListener("click", () => {
  window.luna.restartApp?.();
});
document.getElementById("btn-brand-discord")?.addEventListener("click", () => {
  window.luna.openDiscord?.();
});
document.getElementById("btn-brand-website")?.addEventListener("click", () => {
  window.luna.openWebsite?.();
});
// 24-31차 신규: 설정 > 정보 > 커뮤니티 "상점" 버튼 - 코인 구매(충전) 페이지를 브라우저로 바로 엶
document.getElementById("btn-brand-coins-shop")?.addEventListener("click", () => {
  window.luna.openCoinsShop?.();
});
document.getElementById("btn-brand-open-game-folder")?.addEventListener("click", () => {
  window.luna.openGameFolder?.();
});

// ---- 17차 신규, 24-25차 대폭 확장: AI 진단 도우미 (딥러닝/외부 AI 없이 선택지+키워드 매칭만으로 답을 찾음) ------
// 24-25차: "AI 진단 도우미를 최대한 업데이트해서... 스펙트럼을 넓혀줘" 요청으로 커버 범위를
// 8개 대분류(게임 실행/모드+컨텐츠/계정+로그인/상점+코인/친구+포럼/프로필+프리셋/설정+성능/
// 클라이언트 정보)로 확장. 17차 당시엔 "모드/클라이언트 정보/계정" 3개뿐이었는데, 그 사이
// 24-4~24-24차에 걸쳐 새로 생긴 기능(사이트 계정 로그인, 마인크래프트 N:1 연동, 상점/코인,
// 친구/포럼, 실행 해상도 설정 등)이 전혀 반영 안 돼 있던 걸 이번에 따라잡음. 노드 종류는 기존과 동일:
// - { question, options: [{ label, next }] } : 선택지를 눌러 다음 노드로 이동
// - { question, options: [{ label, answer }] } : answer가 있으면 그 옵션이 최종 답(리프)
// - { question, keywordInput: true, rules: [{ keywords, answer }], fallback } : 문구를 직접
//   입력하면 keywords 중 하나라도 포함되는 규칙을 찾아 그 answer를 보여줌 (없으면 fallback)
// - { dynamicAnswer: async () => string } : 지금 이 순간의 실제 값(버전/설정 등)을 IPC로 읽어와 답을 만듦
const AI_ASSISTANT_TREE = {
  root: {
    question: "어떠한 문제로 오셨나요?",
    options: [
      { label: "게임이 안 켜지거나 튕겨요", next: "game_wont_start" },
      { label: "모드/리소스팩/쉐이더/모드팩 설치 문제", next: "content_problem" },
      { label: "계정/로그인 문제", next: "account_problem" },
      { label: "상점/코인 문제", next: "shop_problem" },
      { label: "친구/포럼 문제", next: "social_problem" },
      { label: "프로필/프리셋 관리 문제", next: "profile_problem" },
      { label: "설정/성능 문제", next: "settings_perf_problem" },
      { label: "클라이언트(런처) 정보", next: "client_info" },
    ],
  },

  // ---- A. 게임 실행/튕김 ----
  game_wont_start: {
    question: "어떤 상황에 가장 가까운가요?",
    options: [
      { label: "모드 때문에 튕기는 것 같아요", next: "mod_conflict" },
      { label: "Forge/NeoForge 프로필이 안 켜져요", next: "game_wont_start_forge" },
      { label: "특정 프로필 하나만 안 켜져요", next: "game_wont_start_one_profile" },
      { label: "해상도/전체화면 설정이 적용이 안 돼요", next: "game_wont_start_resolution" },
      { label: "오류 문구를 직접 입력해서 찾을래요", next: "game_wont_start_general" },
    ],
  },
  game_wont_start_forge: {
    question: "Forge/NeoForge는 처음 실행할 때 공식 설치 프로그램을 자동으로 받아서 돌리는 방식이에요",
    options: [
      { label: "처음 켤 때 시간이 오래 걸려요", answer: "정상이에요. 처음 한 번은 Forge/NeoForge 설치 프로그램을 내려받아 그 자리에서 설치까지 하기 때문에 Fabric 프로필보다 시간이 더 걸려요. 진행률 표시가 멈춘 것처럼 보여도 조금만 더 기다려주세요." },
      { label: "설치 프로그램 실행 중 오류가 나요", answer: "logs 폴더의 로그 파일(설정 > 클라이언트 > 폴더에서 게임 폴더 열기)에 설치 프로그램 출력이 그대로 남아요. 자바가 없거나 손상됐을 수 있으니, 이 프로필을 지우고 새로 만들어 자바를 다시 받게 해보시고, 그래도 안 되면 로그 내용을 그대로 루나 디스코드에 남겨주세요." },
      { label: "이 마인크래프트 버전엔 아예 안 켜져요", answer: "너무 최신이거나 너무 오래된 마인크래프트 버전은 그 버전용 Forge/NeoForge가 아직 없거나 지원이 끊겼을 수 있어요. 다른 마인크래프트 버전으로 프로필을 다시 만들어보세요." },
    ],
  },
  game_wont_start_one_profile: {
    question: "다른 프로필은 잘 켜지는데 이 프로필만 안 된다면, 그 프로필 안의 무언가가 원인일 가능성이 높아요",
    options: [
      { label: "최근에 모드를 추가/업데이트했어요", next: "mod_conflict" },
      { label: "프로필 설정(메모리/버전 등)을 바꿨어요", answer: "프로필 수정 > 실행 설정에서 메모리 할당량이 너무 낮거나(권장: 최소 2~4GB) 컴퓨터 실제 메모리보다 높게 잡혀있진 않은지 확인해주세요. 해상도 값이 비정상적으로 크거나 0으로 되어 있어도 안 켜질 수 있어요." },
      { label: "아무것도 안 바꿨는데 갑자기 안 켜져요", answer: "설치 파일 일부가 손상됐을 가능성이 있어요. 그 프로필의 케밥(⋮) 메뉴 또는 프로필 수정 > 위험 구역에서 삭제 후 같은 설정으로 새로 만들어보세요 (모드는 다시 설치해야 해요)." },
    ],
  },
  game_wont_start_resolution: {
    dynamicAnswer: async () => {
      const s = await window.luna.getSettings?.();
      const w = s?.mcResolutionWidth || 1280;
      const h = s?.mcResolutionHeight || 720;
      const fs = s?.mcFullscreen ? "켜짐" : "꺼짐";
      return `지금 설정 > 화면에 저장된 서버 실행 해상도는 ${w}×${h}, 전체화면으로 시작은 ${fs} 상태예요. 이 설정은 서버로 플레이할 때만 적용돼요 - 프로필로 플레이할 때는 그 프로필 수정 화면의 실행 설정 카테고리에 있는 해상도/전체화면 값을 따로 써요. 서버로 플레이하는데도 안 바뀐다면 값을 바꾼 뒤 다른 칸을 눌러(자동 저장) 다시 실행해주세요.`;
    },
  },
  game_wont_start_general: {
    question: "화면에 뜬 오류 문구를 그대로 적어주시면 원인을 찾아드릴게요 (모르면 아래 자주 나오는 문구 중에서 골라주세요)",
    keywordInput: true,
    rules: [
      { keywords: ["outofmemory", "메모리 부족", "heap"], answer: "메모리가 부족해서 나는 오류예요. 프로필 수정 > 실행 설정에서 최대 메모리 할당량을 늘려보세요 (컴퓨터에 실제로 설치된 메모리보다는 낮게 잡아야 해요 - 보통 4GB~8GB 정도가 안전해요)." },
      { keywords: ["unsupported class version", "java 버전"], answer: "자바 버전이 안 맞을 때 나는 오류예요. Nova Client는 프로필을 처음 실행할 때 알맞은 자바를 자동으로 받아 설치해요 - 설정 > 클라이언트 > 자바 위치에서 지금 설치된 자바 정보를 확인해보시고, 이상해 보이면 프로필을 지우고 새로 만들어 자바를 다시 받게 해주세요." },
      { keywords: ["download", "다운로드", "네트워크", "network", "timeout", "econnreset"], answer: "파일을 받아오는 중 네트워크 문제가 있었을 가능성이 높아요. 인터넷 연결을 확인하고 다시 실행해주세요 - 중간에 끊긴 파일은 다시 실행할 때 자동으로 이어받거나 새로 받아요." },
      { keywords: ["corrupt", "손상", "깨짐", "zip"], answer: "설치 파일 일부가 손상됐을 수 있어요. 프로필 수정 > 위험 구역에서 그 프로필을 지우고 새로 만들어보세요." },
      { keywords: ["exit code", "closed with code", "비정상 종료", "crash"], answer: "게임이 시작하다 바로 꺼졌다는 뜻이에요. 설정 > 클라이언트 > 폴더에서 게임 폴더를 열어 logs/latest.log의 마지막 오류(빨간 글씨 근처)를 확인해주시고, 최근에 추가한 모드가 있다면 하나씩 빼보면서 원인을 좁혀보세요." },
      { keywords: ["mixin"], answer: "모드가 게임 코드에 끼워 넣는 방식(Mixin)끼리 충돌났다는 뜻이에요. 최근에 새로 추가한 모드를 하나씩 빼보면서 어떤 모드 때문인지 찾아보시는 게 가장 확실해요." },
      { keywords: ["access denied", "권한", "permission"], answer: "설치 폴더에 파일을 쓸 권한이 없을 때 나는 오류예요. Nova Client를 관리자 권한으로 한 번 실행해보시거나, 백신 프로그램이 게임 폴더를 막고 있지 않은지 확인해주세요." },
      { keywords: ["msmc", "microsoft", "마이크로소프트", "로그인 창"], answer: "마이크로소프트 로그인 창 자체의 문제라면, 계정/로그인 문제 쪽 안내가 더 자세해요 - 처음으로 돌아가서 '계정/로그인 문제'를 골라주세요." },
    ],
    fallback: "정확히 어떤 문제인지 이 문구만으로는 찾기 어려워요. 프로필 관리에서 최근에 추가한 모드를 하나씩 빼보면서 확인해보시거나, 이 문구를 그대로 커뮤니티나 루나 디스코드에 남겨주시면 더 빠르게 도와드릴 수 있어요.",
  },
  mod_conflict: {
    question: "화면에 뜬 오류 문구를 직접 적어주시면 원인을 찾아드릴게요 (모르면 아래 자주 나오는 문구 중에서 골라주세요)",
    keywordInput: true,
    rules: [
      { keywords: ["duplicate", "중복"], answer: "같은 모드가 프로필 폴더 안에 두 개(버전이 다른 파일 포함) 들어있을 때 나는 문구예요. 프로필 관리 > 모드 목록에서 이름이 같은 모드가 두 개 있는지 확인하고, 오래된 버전 파일을 지워주세요." },
      { keywords: ["requires", "depend", "필요", "missing"], answer: "이 모드가 실행되려면 다른 모드(라이브러리 모드 등)가 같이 설치돼 있어야 한다는 뜻이에요. 오류 문구에 같이 적힌 모드 이름을 Contents에서 검색해서 먼저 설치해주세요 (Fabric API는 이제 모든 Fabric 프로필에 자동으로 들어있어서 따로 안 찾으셔도 돼요)." },
      { keywords: ["incompatib", "호환"], answer: "두 모드(또는 모드와 마인크래프트/로더 버전)가 서로 호환되지 않는다는 뜻이에요. 오류 문구에 적힌 두 모드 중 하나를 최신 버전으로 업데이트해보거나, 그래도 안 되면 둘 중 하나를 프로필에서 빼주세요." },
      { keywords: ["mixin"], answer: "모드가 게임 코드에 끼워 넣는 방식(Mixin)끼리 충돌났다는 뜻이에요. 최근에 새로 추가한 모드를 하나씩 빼보면서 어떤 모드 때문인지 찾아보시는 게 가장 확실해요." },
      { keywords: ["crash", "exit code", "튕김", "튕겨"], answer: "정확한 원인은 로그를 봐야 알 수 있어요. 설정 > 클라이언트 > 폴더에서 게임 폴더를 열어 logs/latest.log 안의 마지막 오류(빨간 글씨 근처)를 확인해주시고, 그래도 모르겠으면 이 문구를 그대로 커뮤니티나 루나 디스코드에 남겨주세요." },
      { keywords: ["fabric api", "fabric-api"], answer: "24-46차부터 Fabric API는 모든 Fabric 프로필에 자동으로 포함돼요(Contents에서 따로 검색은 안 돼요 - 이미 항상 켜져있는 상태라서 그래요). 그런데도 이 오류가 난다면, 프로필의 마인크래프트 버전이 아직 Fabric API가 지원하지 않는 아주 최신/구버전일 수 있어요 - 다른 버전으로 프로필을 새로 만들어보세요." },
      { keywords: ["forge", "neoforge"], answer: "Forge/NeoForge 프로필이라면 위 'Forge/NeoForge 프로필이 안 켜져요' 항목이 더 자세해요. 모드 자체의 문제라면, 그 모드가 실제로 Forge/NeoForge용 파일이 맞는지(Fabric용을 잘못 넣으면 이런 오류가 나요) 확인해주세요." },
    ],
    fallback: "정확히 어떤 문제인지 이 문구만으로는 찾기 어려워요. 프로필 관리에서 최근에 추가한 모드를 하나씩 빼보면서 확인해보시거나, 이 문구를 그대로 커뮤니티나 루나 디스코드에 남겨주시면 더 빠르게 도와드릴 수 있어요.",
  },

  // ---- B. 모드/리소스팩/쉐이더/모드팩 설치 ----
  content_problem: {
    question: "컨텐츠 관련해서 어떤 문제인가요?",
    options: [
      { label: "설치가 안 돼요", next: "mod_install_fail" },
      { label: "업데이트가 안 돼요", next: "mod_update_fail" },
      { label: "모드팩(.mrpack) 설치가 이상해요", next: "modpack_problem" },
      { label: "리소스팩/쉐이더 설치가 안 돼요", answer: "리소스팩/쉐이더도 모드처럼 필요한 다른 모드(대부분 라이브러리 모드)가 있으면 설치 전에 자동으로 확인해서 같이 설치할지 물어봐요. 그 안내가 뜨면 '같이 설치'를 눌러주시고, 설치 후에도 게임에 안 보이면 프로필 관리 > 리소스팩/쉐이더 탭에서 꺼짐(비활성화) 상태가 아닌지 확인해주세요." },
      { label: "찾는 모드가 검색이 안 돼요", answer: "개별 '모드' 검색은 지금 Fabric 모드만 대상이에요(Forge/NeoForge는 모드팩 단위로만 지원). 클라이언트 전용 모드만 보기 필터를 켜두셨다면, 서버 전용 모드는 그 필터 때문에 안 보일 수 있으니 꺼보세요. 기본으로는 정식 버전만 보이니, 베타/알파까지 보려면 버전 목록 화면의 베타 표시 토글도 확인해주세요." },
      { label: "스크린샷/설명이 안 보여요", answer: "일부 모드는 Modrinth 쪽 이미지 정보가 예상과 다른 형태로 와서 화면에 못 띄우는 경우가 있어요(계속 조사 중인 부분이에요). 어떤 모드에서 그런지 이름을 알려주시면 다음에 더 정확히 봐드릴 수 있어요." },
      { label: "제작자 페이지로 이동이 안 돼요", answer: "탐색 목록의 제작자 이름을 눌러도 안 열린다면, 그 항목이 팀/여러 명 공동 제작이라 대표 제작자 정보가 비어있는 경우일 수 있어요. 모드 상세 화면에서 다시 시도해주세요." },
    ],
  },
  mod_install_fail: {
    question: "설치가 안 되는 상황을 좀 더 알려주세요",
    options: [
      { label: "Contents에서 설치를 눌러도 반응이 없어요", answer: "먼저 오른쪽에서 설치할 프로필을 골랐는지 확인해주세요. 프로필을 안 고르면 설치 버튼이 동작하지 않아요." },
      { label: "설치는 됐는데 게임에서 안 보여요/안 켜져요", answer: "그 모드가 지금 프로필의 마인크래프트 버전을 지원하는지 확인해주세요. 프로필 관리 > 모드 목록에서 그 모드가 꺼짐(비활성화) 상태는 아닌지도 같이 확인해주세요." },
      { label: "설치한 모드가 목록에서 사라져요", answer: "같은 모드를 다른 버전으로 다시 설치하면 예전 파일을 자동으로 대체해요. 목록에서 안 보인다면 검색어나 정렬 때문에 가려져 있을 수 있으니, 검색창을 비우고 다시 확인해주세요." },
      { label: "종속 모드 설치 확인창이 계속 떠요", answer: "그 모드가 필요로 하는 다른 모드가 아직 설치 안 됐다는 뜻이에요. 확인창에서 '같이 설치'를 누르면 한 번에 해결돼요 - 계속 뜬다면 그 종속 모드 자체의 설치가 실패하고 있는 것일 수 있으니, 종속 모드 이름으로 직접 검색해서 따로 설치해보세요." },
    ],
  },
  mod_update_fail: {
    question: "업데이트 관련해서 어떤 상황인가요?",
    options: [
      { label: "'전체 업데이트' 버튼이 아예 안 보여요", answer: "업데이트할 모드가 없으면 이 버튼 자체가 안 보여요 (이미 다 최신 버전이라는 뜻이에요)." },
      { label: "업데이트를 눌러도 실패해요", answer: "그 모드의 새 버전이 지금 프로필 마인크래프트 버전을 아직 지원하지 않을 수 있어요. 잠시 후 다시 시도해보시거나, Contents에서 그 모드를 직접 검색해 지원 버전을 확인해주세요." },
      { label: "'업데이트 연동'을 켰는데 안 따라와요", answer: "이 프로필이 공유받아 불러온(가져오기) 프로필일 때만 나오는 옵션이에요. 원작자가 프로필을 갱신했을 때만 새 내용이 반영되니, 아직 원작자가 갱신을 안 했다면 기다려주셔야 해요." },
    ],
  },
  modpack_problem: {
    question: "모드팩 관련해서 어떤 상황인가요?",
    options: [
      { label: "Explore에서 설치한 모드팩이 이상해요", answer: "모드팩은 dependencies에 적힌 로더(Fabric/Forge/NeoForge)를 자동으로 감지해서 그에 맞는 프로필을 만들어요. 설치 후 로더가 예상과 다르게 표시된다면, 그 모드팩 자체의 정보가 특이한 경우일 수 있어요 - 모드팩 이름을 알려주시면 다음에 더 자세히 봐드릴게요." },
      { label: "내가 만든 프로필을 .mrpack으로 내보냈는데 다른 런처에서 안 열려요", answer: "표준 modrinth.index.json 형식으로 내보내지만, 직접 추가해서 출처를 알 수 없는 파일(모드 사이트 정보가 없는 파일)은 실제 파일째로 overrides 폴더에 담겨요 - 상대 런처가 이 폴더 구조를 지원하는지 확인해주세요. 어떤 런처에서 안 열리는지 알려주시면 더 정확히 봐드릴 수 있어요." },
      { label: "다른 곳에서 받은 .mrpack을 가져왔는데 실패해요", answer: "그 모드팩이 요구하는 로더나 마인크래프트 버전이 이 클라이언트가 아직 지원하지 않는 조합일 수 있어요. 파일이 정말 .mrpack 형식이 맞는지, 손상되지 않았는지도 확인해주세요." },
    ],
  },

  // ---- C. 계정/로그인 (24-4~24-24차의 사이트 계정+마인크래프트 연동 체계 반영) ----
  account_problem: {
    question: "계정 관련해서 어떤 문제인가요?",
    options: [
      { label: "사이트 계정 로그인/회원가입이 안 돼요", next: "account_site_login" },
      { label: "마인크래프트 계정 연동이 안 돼요", answer: "로그인 후 마인크래프트 계정이 하나도 연동 안 되어 있으면 마인크래프트 연동 화면으로 이동하는데, 거기 '마인크래프트 계정으로 로그인' 버튼을 누르면 마이크로소프트 로그인 창이 따로 떠요. 그 창에서 로그인을 마치면 서버가 실제 소유권을 확인한 뒤 자동으로 연동돼요. 창이 안 뜨거나 로그인 후에도 계속 연동 화면에 머문다면, 런처를 완전히 종료 후 다시 켜보시고 인터넷 연결도 확인해주세요." },
      { label: "마인크래프트 계정을 하나 더 연동하고 싶어요", answer: "지금은 사이트 계정 하나에 마인크래프트 계정을 여러 개 연동할 수 있어요. 설정 > 내 프로필 탭의 사이트 계정 패널에서 '다른 마인크래프트 계정 추가로 연동하기' 버튼을 누르면 마이크로소프트 로그인 창이 다시 뜨고, 그 계정으로 로그인하면 추가로 연동돼요." },
      { label: "연동을 해제했는데 다시 로그인이 안 돼요", answer: "연동을 해제한 마인크래프트 계정은 로컬에 남아있던 정보로 바로 다시 붙지 않고, 반드시 설정의 연동 버튼으로 마이크로소프트 로그인을 새로 거쳐야 다시 연동돼요 - 계정 자체가 사라진 건 아니니 같은 마이크로소프트 계정으로 다시 로그인하면 정상적으로 돌아와요." },
      { label: "다른 기기에서 로그인해서 로그아웃됐다는 메시지가 떴어요", answer: "이 클라이언트는 한 사이트 계정으로 한 곳에서만 로그인할 수 있어요(동시 로그인 방지). 다른 컴퓨터나 다른 실행 창에서 같은 계정으로 로그인하면, 먼저 있던 쪽은 다음 확인 시점(최대 약 45초 이내)에 이 메시지와 함께 밀려나요. 지금 이 기기에서 계속 쓰시려면 다시 로그인해주세요 - 만약 본인이 로그인한 적이 없다면 비밀번호가 유출됐을 수 있으니 다시 로그인한 뒤 되도록 빨리 비밀번호를 바꿔주세요." },
      { label: "비밀번호를 잊어버렸어요", answer: "죄송하지만 지금은 런처 안에서 바로 비밀번호를 재설정하는 기능이 아직 없어요. 루나 디스코드(설정 > 정보 탭에서 이동 가능)로 문의해주시면 확인 도와드릴게요." },
      { label: "계정을 잘못 골랐어요/바꾸고 싶어요", answer: "홈 화면의 프로필(내 마인크래프트 프로필) 아이콘을 누르면 계정 메뉴가 열려요. 거기서 연동된 다른 마인크래프트 계정으로 전환하거나, 사이트 계정 자체를 로그아웃할 수 있어요." },
    ],
  },
  account_site_login: {
    question: "화면에 뜬 오류 문구나 상황을 적어주시면 원인을 찾아드릴게요 (모르면 아래 자주 있는 상황 중에서 골라주세요)",
    keywordInput: true,
    rules: [
      { keywords: ["아이디 또는 비밀번호", "일치하지", "올바르지"], answer: "아이디(또는 이메일)와 비밀번호 중 하나가 틀렸다는 뜻이에요. 대소문자까지 정확히 맞는지 확인해주시고, 웹사이트에서 만든 계정이라면 런처 회원가입 화면이 아니라 로그인 화면(아이디/이메일 + 비밀번호)을 써주세요 - 웹사이트 계정과 런처 계정은 이제 같은 계정이에요." },
      { keywords: ["8자", "비밀번호는"], answer: "비밀번호는 8자 이상이어야 해요. 더 길게 다시 만들어주세요." },
      { keywords: ["이미 사용", "중복", "already"], answer: "이미 같은 아이디나 이메일로 가입된 계정이 있다는 뜻이에요. 그 계정을 기억하지 못하신다면 새로 회원가입하지 마시고, 위 '비밀번호를 잊어버렸어요' 안내대로 루나 디스코드에 문의해주세요." },
      { keywords: ["네트워크", "network", "연결", "timeout", "서버"], answer: "Nova Site 서버에 접속이 안 되고 있을 수 있어요. 인터넷 연결을 확인하고 잠시 후 다시 시도해주세요 - 계속되면 서버 쪽 점검 중일 수 있으니 루나 디스코드 공지를 확인해주세요." },
      { keywords: ["닉네임", "2~16", "nickname"], answer: "닉네임은 2~16자여야 해요. 이 닉네임이 로그인 아이디로도 쓰이니, 너무 짧거나 특수문자가 많으면 거부될 수 있어요." },
    ],
    fallback: "정확히 어떤 상황인지 이 문구만으로는 찾기 어려워요. 로그인 화면에 뜬 오류 문구를 그대로 캡처해서 루나 디스코드에 문의해주시면 더 빠르게 도와드릴 수 있어요.",
  },

  // ---- D. 상점/코인 ----
  shop_problem: {
    question: "상점/코인 관련해서 어떤 문제인가요?",
    options: [
      { label: "구매가 안 돼요 / 코인이 부족하다고 떠요", answer: "코인이 부족하면 '코인이 부족해요 (보유 X / 필요 Y)' 형태로 정확한 숫자가 함께 떠요. 그 안내가 맞다면 출석 체크나 일일/주간 퀘스트로 코인을 더 모으시거나, 사이트에서 직접 코인을 충전하실 수 있어요. 코인이 충분한데도 안 된다면 아래 '관리자 계정인데 구매가 안 돼요'를 확인하시거나 잠시 후 다시 시도해주세요." },
      { label: "관리자 계정인데 구매가 안 돼요", answer: "관리자 판별은 지금 로그인한 사이트 계정의 아이디/닉네임 또는 지금 활성화된 마인크래프트 캐릭터 이름 중 하나가 정확히 일치해야 동작해요(대소문자/공백 차이는 무시하도록 되어 있어요). 그래도 안 된다면 정확한 로그인 아이디/닉네임을 알려주시면 확인해드릴게요." },
      { label: "산 스킨/색이 다른 마인크래프트 계정에서 안 보여요", answer: "상점에서 산 색/스킨은 그 마인크래프트 계정이 지금 연동된 사이트 계정의 공용 데이터예요. 연동이 안 된(게스트 상태였던) 계정으로 예전에 산 거라면 그 기기의 로컬 저장소에만 남아있을 수 있어요 - 지금은 모든 계정이 사이트 계정에 연동돼야 하니, 연동만 되어 있으면 같은 사이트 계정에 연동된 다른 마인크래프트 캐릭터에서도 똑같이 보여야 해요." },
      { label: "코인이 갑자기 줄었거나 사라졌어요", answer: "코인은 일단 화면에 바로 반영되고(낙관적 갱신) 실제 서버 값은 뒤에서 동기화돼요. 아주 드물게 동기화가 어긋나 보일 수 있는데, 로그아웃 후 다시 로그인하면 서버에 실제로 저장된 값으로 다시 맞춰져요. 그래도 이상하면 언제, 무엇을 산 직후였는지 알려주시면 확인해드릴게요." },
      { label: "할인 상품이 어디 있는지 모르겠어요", answer: "상점 '전체' 카테고리에서는 할인 중인 상품이 맨 앞쪽에 정렬돼서 나오고, 원래 가격에 취소선이 그어진 채 할인가가 같이 표시돼요. 다른 카테고리(테마/색 등)를 보고 계셨다면 '전체'로 바꿔서 확인해주세요." },
      { label: "구매 확인창(미리보기)이 이상해요", answer: "상품을 클릭하면 바로 구매되지 않고 먼저 미리보기 팝업이 뜨는 게 정상이에요(잘못 눌러서 구매되는 걸 막기 위함) - 거기서 이름/가격을 확인한 뒤 구매 버튼을 눌러야 실제로 구매돼요." },
    ],
  },

  // ---- E. 친구/포럼 ----
  social_problem: {
    question: "친구인가요, 포럼인가요?",
    options: [
      { label: "친구 추가가 안 돼요", answer: "친구 추가는 마인크래프트 닉네임이 아니라 클라이언트 닉네임(사이트 계정 닉네임)으로 찾아요. 정확한 대소문자까지 맞는지 확인해주세요. 그래도 안 된다면 서버 쪽 업데이트가 아직 배포 전이라 일시적으로 검색이 안 될 수 있으니 잠시 후 다시 시도해주세요." },
      { label: "친구가 온라인인데 오프라인으로 나와요", answer: "온라인 상태는 약 45초 간격으로 서버에 보고되는 방식이라, 실제 접속/종료 시점과 화면에 반영되는 시점 사이에 최대 45초 정도 차이가 날 수 있어요. 잠시 기다렸다가 다시 확인해주세요." },
      { label: "귓속말이 안 오거나 안 읽음 표시가 이상해요", answer: "귓속말은 친구창이나 별도 대화창을 열어야 최신 내용을 받아와요. 알림(안 읽음 표시)이 이상하다면 한 번 그 대화창을 열었다 닫아서 새로고침해보세요." },
      { label: "글을 썼는데 하루 제한에 걸려요", answer: "스팸 방지를 위해 하루에 게시글 5개, 답글 100개까지만 쓸 수 있어요(자정 기준으로 초기화). 관리자 계정은 이 제한에서 제외돼요." },
      { label: "글/계정이 정지당했어요", answer: "포럼 이용 규칙 위반으로 관리자가 정지시킨 경우예요. 이의가 있으시면 루나 디스코드로 문의해주세요." },
      { label: "내가 쓴 글이 '내 글만 보기'에 안 나와요/글 수가 안 맞아요", answer: "예전 버전에서 저장된 일부 게시글의 작성자 정보 형식이 최신 버전과 살짝 달라서 못 찾는 경우가 있었는데, 최신 업데이트에서 고쳤어요. 그래도 여전히 안 보이면 어떤 글인지 알려주시면 확인해드릴게요." },
      { label: "인용구/강조박스/표가 깨져 보여요", answer: "포럼 에디터의 인용구/강조박스/표 스타일이 몇 차례 업데이트됐어요. 아주 예전에 작성된 글이라면 옛날 스타일 그대로 저장돼 있어 다르게 보일 수 있으니, 그 글을 다시 수정 저장하면 최신 스타일로 갱신돼요." },
      { label: "신고했는데 상대가 신고당한 걸 아는 것 같아요", answer: "신고 여부는 신고한 본인에게만 보이도록 되어 있어요(다른 사람에게는 안 보임). 혹시 그렇게 보이는 상황이 있다면 어떤 화면이었는지 알려주세요." },
    ],
  },

  // ---- F. 프로필/프리셋 관리 ----
  profile_problem: {
    question: "프로필/프리셋 관련해서 어떤 문제인가요?",
    options: [
      { label: "프로필 생성이 안 돼요", answer: "이름을 비워두지 않았는지, 로더(Vanilla/Fabric - 일반 프로필은 이 둘만 고를 수 있고, Forge/NeoForge는 모드팩 설치로만 만들어져요)와 마인크래프트 버전을 골랐는지 확인해주세요. 프리셋으로 만드는 경우엔 이름칸이 자동으로 채워지고 화면엔 안 보이니 신경 안 쓰셔도 돼요." },
      { label: "프리셋으로 만들 때 이름을 못 정해요", answer: "프리셋에서 만드는 프로필은 일부러 이름칸을 없앴어요(요청하신 대로) - '프리셋 이름 (버전)' 형태로 자동으로 이름이 붙어서, 같은 프리셋으로 여러 버전을 만들어도 이름이 겹치지 않아요." },
      { label: "프로필을 실수로 지웠어요", answer: "프로필 삭제는 이름을 직접 타이핑해서 확인해야 하는 되돌릴 수 없는 작업이라, 안타깝지만 복구는 어려워요. 모드/설정을 미리 백업해두시는 걸 추천드려요." },
      { label: "프리셋 목록에 원하는 버전이 없어요", answer: "프리셋은 지금 Fabric 프로필만 만들 수 있고, 사용 가능한 버전 목록도 프리셋마다 상한이 있어요(모드 없는 프리셋 최대 60개, 모드 있는 프리셋 최대 30개). 정말 필요한 버전이 안 보이면 어떤 프리셋/버전인지 알려주세요." },
      { label: ".mrpack으로 내보낸 파일이 다른 런처에서 안 열려요", answer: "표준 modrinth.index.json 형식으로 내보내요. 어떤 런처(Modrinth App 등)에서 안 열리는지, 어떤 오류가 나는지 알려주시면 더 정확히 봐드릴 수 있어요." },
      { label: "케밥(⋮) 메뉴가 안 보이거나 잘려 보여요", answer: "창을 아주 작게 줄인 상태라면 메뉴 위치가 화면 밖으로 밀릴 수 있어요. 창을 조금 키운 뒤 다시 눌러보세요." },
      { label: "공유받은 프로필을 가져오기했는데 이상해요", answer: "원작자가 그 프로필을 갱신하면 '업데이트 연동'을 켜둔 경우에만 자동으로 따라와요. 꺼져있다면 프로필 수정 화면에서 다시 켜주세요." },
    ],
  },

  // ---- G. 설정/성능 ----
  settings_perf_problem: {
    question: "설정/성능 관련해서 어떤 문제인가요?",
    options: [
      { label: "게임이 렉 걸리거나 느려요", answer: "프로필 수정 > 실행 설정에서 최대 메모리 할당량을 늘려보세요(컴퓨터 실제 메모리보다 낮게, 보통 4~8GB가 안전해요). 게임 안 그래픽 설정(렌더 거리 등)을 낮추는 것도 도움이 되고, 백그라운드에서 무거운 프로그램이 같이 돌고 있지 않은지도 확인해주세요." },
      { label: "메모리를 얼마나 줘야 하나요?", answer: "일반적으로 4GB면 무난하고, 모드가 많거나 리소스팩이 무거우면 6~8GB 정도를 추천드려요. 컴퓨터에 실제로 설치된 메모리보다 높게 주면 오히려 안 켜지거나 전체 컴퓨터가 느려질 수 있으니 주의해주세요." },
      { label: "실행 해상도/전체화면 설정이 어디 있나요?", next: "game_wont_start_resolution" },
      { label: "언어가 이상하게 나와요", answer: "지금은 설정 > 언어에서 한국어/English 중 하나를 직접 골라서 저장하는 방식이에요(예전의 '시스템 언어 자동 감지' 옵션은 없어졌어요). 원하는 언어를 다시 선택해서 저장해보세요." },
      { label: "컴퓨터 켜면 자동으로 실행돼요/안 돼요", answer: "설정 > 클라이언트의 '컴퓨터 시작 시 자동 실행' 체크박스로 켜고 끌 수 있어요. 켜두면 그 아래 '백그라운드로 시작' 체크박스도 같이 선택할 수 있어요(자동 실행이 꺼져 있으면 이 옵션은 비활성화돼요)." },
      { label: "게임 실행하면 런처가 어떻게 되나요", answer: "설정 > 클라이언트의 '게임 실행 시 런처는' 항목에서 그대로 켜둠 / 백그라운드(트레이)로 전환 / 완전히 종료 중에서 고를 수 있어요. 백그라운드를 고르면 게임 중엔 작업표시줄 트레이 아이콘으로만 남아있다가, 아이콘을 누르면 다시 열려요." },
      { label: "친구에게 상태 공유를 끄고 싶어요", answer: "설정 > 클라이언트의 '친구에게 상태 공유' 체크박스를 꺼두면 지금 뭘 하고 있는지가 친구 목록에 안 보여요(온라인 여부 자체는 계속 공유돼요)." },
      { label: "테마/색을 바꾸고 싶어요", answer: "설정 > 화면에서 다크/라이트 등 테마를 고르거나, 상점에서 산 포인트 색을 적용할 수 있어요." },
    ],
  },

  // ---- H. 클라이언트(런처) 정보 ----
  client_info: {
    question: "클라이언트(런처)의 어떤 정보가 궁금하신가요?",
    options: [
      { label: "지금 내 버전이 뭔가요?", next: "client_info_version" },
      { label: "필요한 자바를 따로 설치해야 하나요?", answer: "아니요, 프로필을 처음 실행할 때 그 마인크래프트 버전에 맞는 자바를 자동으로 받아서 설치해요. 설정 > 클라이언트 > 자바 위치에서 지금 설치된 자바 정보를 볼 수 있어요." },
      { label: "라이선스/사업자 정보는 어디서 봐요?", answer: "설정 > 정보 탭 아래쪽에서 라이선스·이용약관을 볼 수 있어요. 사업자 등록 정보는 아직 준비 중이라 화면에서 숨겨둔 상태예요." },
      { label: "제작자가 누구예요?", answer: "Nova Client는 Luna World에서 만들었어요. 설정 > 정보 탭에서 루나 디스코드로 바로 이동할 수 있어요." },
      { label: "백그라운드 실행이 뭐예요?", answer: "설정 > 클라이언트에서 '게임 실행 시 런처는'을 백그라운드(트레이)로 두면, 게임 중에는 런처 창이 닫히고 작업표시줄 트레이 아이콘으로만 남아있어요. 트레이 아이콘을 누르면 다시 런처를 열 수 있어요." },
      { label: "업데이트는 자동으로 되나요?", answer: "새 버전이 나오면 앱이 자동으로 감지해서 알려줘요. 설정 > 정보에서 지금 바로 업데이트를 확인하거나 설치할 수도 있어요." },
      { label: "이 AI 진단 도우미는 어떻게 동작하나요?", answer: "위쪽에 적힌 것처럼, 딥러닝이나 외부 AI 서버 없이 정해진 선택지와 키워드 매칭만으로 동작해요. 그래서 아주 특이한 상황이나 이 문서에 없는 오류는 못 찾을 수 있는데, 그럴 땐 화면 문구를 그대로 루나 디스코드에 남겨주시면 사람이 직접 도와드려요." },
    ],
  },
  client_info_version: {
    dynamicAnswer: async () => {
      const v = await window.luna.getAppVersion?.();
      return `지금 쓰고 있는 버전은 v${v || "-"} 이에요. 설정 > 정보 > 업데이트 내역에서 이 버전에 뭐가 바뀌었는지 볼 수 있어요.`;
    },
  },
};

let aiAssistantHistory = []; // 뒤로가기용 노드 키 스택
let aiAssistantCurrentKey = "root";

function aiAssistantAppendBubble(text, kind) {
  const log = document.getElementById("ai-assistant-log");
  if (!log) return;
  const bubble = document.createElement("div");
  bubble.className = `ai-assistant-bubble ai-assistant-bubble-${kind}`;
  bubble.textContent = text;
  log.appendChild(bubble);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

async function aiAssistantGoTo(nodeKey, { fromHistory = false } = {}) {
  if (!fromHistory) aiAssistantHistory.push(aiAssistantCurrentKey);
  aiAssistantCurrentKey = nodeKey;
  const node = AI_ASSISTANT_TREE[nodeKey];
  const choicesEl = document.getElementById("ai-assistant-choices");
  const inputRow = document.getElementById("ai-assistant-input-row");
  choicesEl.innerHTML = "";
  inputRow.hidden = true;

  if (node.dynamicAnswer) {
    aiAssistantAppendBubble("확인하는 중...", "bot");
    const text = await node.dynamicAnswer();
    // 방금 넣은 "확인하는 중..." 버블을 실제 답으로 교체
    const log = document.getElementById("ai-assistant-log");
    if (log.lastElementChild) log.lastElementChild.textContent = text;
    return;
  }

  aiAssistantAppendBubble(node.question, "bot");

  if (node.keywordInput) {
    inputRow.hidden = false;
    document.getElementById("ai-assistant-input").value = "";
    document.getElementById("ai-assistant-input").focus();
    (node.rules || []).forEach((rule) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-assistant-choice-btn";
      btn.textContent = rule.keywords[0];
      btn.addEventListener("click", () => aiAssistantAnswerLeaf(rule.keywords[0], rule.answer));
      choicesEl.appendChild(btn);
    });
    return;
  }

  (node.options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ai-assistant-choice-btn";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      aiAssistantAppendBubble(opt.label, "user");
      choicesEl.innerHTML = "";
      inputRow.hidden = true;
      if (opt.next) {
        aiAssistantGoTo(opt.next);
      } else {
        aiAssistantHistory.push(aiAssistantCurrentKey);
        aiAssistantAppendBubble(opt.answer, "bot");
      }
    });
    choicesEl.appendChild(btn);
  });
}

function aiAssistantAnswerLeaf(userLabel, answer) {
  aiAssistantAppendBubble(userLabel, "user");
  document.getElementById("ai-assistant-choices").innerHTML = "";
  document.getElementById("ai-assistant-input-row").hidden = true;
  aiAssistantHistory.push(aiAssistantCurrentKey);
  aiAssistantAppendBubble(answer, "bot");
}

function aiAssistantOpen() {
  document.getElementById("ai-assistant-overlay").hidden = false;
  document.getElementById("ai-assistant-log").innerHTML = "";
  aiAssistantHistory = [];
  aiAssistantCurrentKey = "root";
  aiAssistantGoTo("root", { fromHistory: true });
}
document.getElementById("btn-brand-ai-assistant")?.addEventListener("click", aiAssistantOpen);
document.getElementById("btn-ai-assistant-close")?.addEventListener("click", () => {
  document.getElementById("ai-assistant-overlay").hidden = true;
});
document.getElementById("btn-ai-assistant-restart")?.addEventListener("click", () => {
  document.getElementById("ai-assistant-log").innerHTML = "";
  aiAssistantHistory = [];
  aiAssistantCurrentKey = "root";
  aiAssistantGoTo("root", { fromHistory: true });
});
document.getElementById("btn-ai-assistant-back")?.addEventListener("click", () => {
  if (aiAssistantHistory.length === 0) return;
  const prevKey = aiAssistantHistory.pop();
  document.getElementById("ai-assistant-log").innerHTML = "";
  aiAssistantCurrentKey = prevKey;
  aiAssistantGoTo(prevKey, { fromHistory: true });
});
// 17차: 키워드 직접 입력 - 딥러닝 없이 rules의 keywords 중 하나라도 포함되면 그 answer를 보여줌
document.getElementById("btn-ai-assistant-submit")?.addEventListener("click", () => {
  const input = document.getElementById("ai-assistant-input");
  const text = (input.value || "").trim();
  if (!text) return;
  const node = AI_ASSISTANT_TREE[aiAssistantCurrentKey];
  const lower = text.toLowerCase();
  const matched = (node?.rules || []).find((rule) => rule.keywords.some((kw) => lower.includes(kw.toLowerCase())));
  aiAssistantAnswerLeaf(text, matched ? matched.answer : node?.fallback || "정확한 원인을 찾지 못했어요. 루나 디스코드에 문의해주세요.");
});
document.getElementById("ai-assistant-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-ai-assistant-submit")?.click();
});
// 24-31차: "업데이트 확인 누르면 설정 꺼지게 해줘" - 결과를 기다리는 토스트가 설정 팝업에
// 가려 잘 안 보인다는 취지로 이해해서, 누르자마자 설정 팝업부터 닫고 진행함
document.getElementById("btn-brand-check-update")?.addEventListener("click", async () => {
  closeSettings();
  showToast("업데이트를 확인하는 중...");
  const res = await window.luna.checkUpdateNow?.();
  if (res?.ok) {
    showToast("업데이트 확인을 시작했어요 (새 버전이 있으면 알림이 떠요)");
  } else {
    showToast(res?.error || "업데이트 확인에 실패했어요", "error");
  }
});


// ---- 왼쪽 사이드바 네비게이션 ------------------------------------------------
// 10-2: 로고 옆 뒤로가기/앞으로가기 - 화면(패널) 전환 기록만 오가는 방식.
// 구매/결제 같은 행위는 별도 화면이 아니라 지금 화면 안에서 버튼 클릭으로 끝나기 때문에
// 자연스럽게 히스토리에 안 남고, 모드 추가/삭제는 각 화면(Explore/프로필 관리) 안에서
// 실행취소 토스트로 따로 처리됨(되돌리기 버튼과는 별개).
let navHistory = ["launch"];
let navIndex = 0;
let suppressNavHistory = false;

function updateNavButtons() {
  const backBtn = document.getElementById("btn-nav-back");
  const fwdBtn = document.getElementById("btn-nav-forward");
  if (backBtn) backBtn.disabled = navIndex <= 0;
  if (fwdBtn) fwdBtn.disabled = navIndex >= navHistory.length - 1;
}

// 11차: "이미 Install인데 Install을 또 누르면 애니메이션이 또 나온다" - 4-11에서 사이드바
// 아이콘 활성 표시 자체는 이미 막아뒀었지만, 각 클릭 핸들러 안의 목록 다시 불러오기/다시
// 그리기(openVersionsList, loadInventory, showForumList 등)는 그거랑 상관없이 매번 실행되고
// 있었음 - 그 다시 그리기 때문에 카드들이 stagger-in 애니메이션을 처음부터 다시 재생하는
// 게 "중첩 애니메이션"처럼 보였던 진짜 원인. 지금 이미 그 패널이면(설정 팝업만 열려있는
// 경우 제외) 핸들러 전체를 건너뛰도록, 판단 로직을 공용 함수로 뽑아서 각 핸들러 맨 앞에서도 씀
function isSidebarPanelAlreadyActive(panel) {
  const settingsOverlayEl = document.getElementById("settings-overlay");
  const alreadyActiveEl = document.querySelector(".sidebar-icon.is-active");
  const settingsOpen = settingsOverlayEl && !settingsOverlayEl.hidden;
  return !settingsOpen && alreadyActiveEl && alreadyActiveEl.dataset.panel === panel;
}

function setActiveSidebarIcon(panel) {
  const settingsOverlayEl = document.getElementById("settings-overlay");
  // 4-11: 이미 켜져 있는 사이드바 아이콘을 또 눌렀을 때 화면 전환 애니메이션이 다시
  // 재생되던 문제 - 실제로 다른 패널로 바뀌는 게 아니면(설정 팝업이 열려 있어서 닫아야
  // 하는 경우가 아니면) 아무 것도 하지 않고 그냥 끝냄
  if (isSidebarPanelAlreadyActive(panel)) {
    return;
  }
  // 설정 팝업이 사이드바를 덮지 않는 구조라, 다른 사이드바 메뉴(런처/상점 등)를 눌러도
  // 설정 팝업이 안 닫히고 뒤에 그대로 남아있던 문제 수정 - 다른 화면으로 넘어갈 땐 항상 먼저 닫음
  if (settingsOverlayEl && !settingsOverlayEl.hidden) {
    requestCloseSettings();
  }
  // 16차: "프로필 추가도 다른 상호작용 눌렀을 때 안꺼진다" - 설정 팝업과 같은 원칙으로,
  // 다른 사이드바 메뉴를 누르면 "프로필 추가" 팝업도 뒤에 그대로 남지 않도록 같이 닫음
  const profileAddOverlayEl = document.getElementById("profile-add-overlay");
  if (profileAddOverlayEl && !profileAddOverlayEl.hidden) {
    closeProfileAddOverlay();
  }
  // 19차: "업데이트 로그 열었을 때 다른 화면 눌러도 안꺼지는데" / "왜 어두워져 계속" -
  // .confirm-overlay 계열 팝업(업데이트 내역/작성자 소개/AI 어시스턴트/스킨)도 설정 팝업과
  // 같은 원칙으로 다른 사이드바 메뉴를 누르면 항상 같이 닫아야 함. 안 그러면 반투명 배경이
  // 뒤에 계속 남아있다가 팝업이 여러 개 겹쳐 쌓여서 화면이 점점 더 어두워져 보이는 원인이 됨
  const skinOverlayEl = document.getElementById("skin-overlay");
  if (skinOverlayEl && !skinOverlayEl.hidden) closeSkinOverlay();
  ["updates-overlay", "author-page-overlay", "ai-assistant-overlay", "forum-user-popup"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.hidden) el.hidden = true;
  });
  document.querySelectorAll(".sidebar-icon").forEach((el) => el.classList.remove("is-active"));
  document.querySelector(`.sidebar-icon[data-panel="${panel}"]`)?.classList.add("is-active");

  if (!suppressNavHistory && panel !== "settings" && navHistory[navIndex] !== panel) {
    navHistory = navHistory.slice(0, navIndex + 1);
    navHistory.push(panel);
    navIndex = navHistory.length - 1;
  }
  updateNavButtons();
}

function navigateHistoryTo(panel) {
  suppressNavHistory = true;
  document.querySelector(`.sidebar-icon[data-panel="${panel}"]`)?.click();
  suppressNavHistory = false;
  updateNavButtons();
}

document.getElementById("btn-nav-back")?.addEventListener("click", () => {
  if (navIndex <= 0) return;
  navIndex--;
  navigateHistoryTo(navHistory[navIndex]);
});
document.getElementById("btn-nav-forward")?.addEventListener("click", () => {
  if (navIndex >= navHistory.length - 1) return;
  navIndex++;
  navigateHistoryTo(navHistory[navIndex]);
});

// 사이드바에서 어딜 누르든, 다른 화면들은 다 숨기고 그 화면 하나만 보이게 함
// (사진 속 런처처럼 왼쪽 사이드바는 항상 그대로, 오른쪽 콘텐츠만 바뀌는 방식)
const ALL_APP_VIEWS = [
  "view-login",
  "view-mc-gate",
  "view-home",
  "view-versions",
  "view-explore",
  "view-forum",
  "view-profile-manage",
  "view-shop",
  "view-inventory",
  "view-news",
];
// 24-21차: "왼쪽에 아이콘 눌러도 변경 안되게 해줘 지금 화면은 그대로인데 아이콘이 선택되는
// UI가 떠" - 사이드바 아이콘 각각의 클릭 핸들러가 실제 화면 전환(showAppPanel) 결과와
// 상관없이 미리 setActiveSidebarIcon()으로 자기 아이콘부터 활성 표시해버리고 있었음. 예를
// 들어 마인크래프트 연동 전(view-mc-gate)에 다른 아이콘을 눌러도 게이트가 화면을 그대로
// view-mc-gate에 붙잡아두는데(화면은 안 바뀜), 클릭한 아이콘은 이미 "선택됨"으로 칠해진
// 채 남아있었음. showAppPanel이 실제로 최종 확정한 화면(id)을 기준으로 사이드바 활성
// 아이콘을 마지막에 다시 맞춰서, 어떤 클릭 핸들러가 미리 뭘 칠해놨든 항상 실제 화면과
// 일치하도록 함(대응하는 사이드바 아이콘이 없는 화면이면 전부 꺼서 아무 것도 안 켜진
// 상태로 되돌림).
const VIEW_TO_SIDEBAR_PANEL = {
  "view-home": "launch",
  "view-versions": "versions",
  "view-explore": "explore",
  "view-forum": "forum",
  "view-shop": "shop",
  "view-inventory": "inventory",
  "view-profile-manage": "profile",
  "view-news": "news",
};
function syncSidebarActiveIcon(viewId) {
  const panel = VIEW_TO_SIDEBAR_PANEL[viewId] || null;
  document.querySelectorAll(".sidebar-icon").forEach((el) => {
    el.classList.toggle("is-active", !!panel && el.dataset.panel === panel);
  });
}
function showAppPanel(id) {
  // 24-15차: "로그인 안하면 다른 거 못하게 해달라니까 자유롭게 돌아다녀지네? 게스트
  // 없애라고" - 사이드바 아이콘 클릭은 로그인 여부와 무관하게 곧바로 이 함수를 불러서,
  // 로그인 화면에서도 사이드바로 상점/포럼/탐색 등에 자유롭게 들어가지던 구멍이 있었음
  // (사이드바 자체가 항상 화면에 그려져있고, 클릭 핸들러들도 로그인 체크 없이 바로
  // showAppPanel을 불렀음). 모든 화면 전환이 결국 이 함수 하나를 거치므로, 여기서 한 번에
  // 막음 - 사이트 계정 로그인이 없으면 무조건 로그인 화면으로, 사이트 계정은 있는데
  // 마인크래프트 계정이 연동 안 돼있으면(게스트 상태 자체를 없앰) 마인크래프트 연동
  // 화면(view-mc-gate)으로 강제 전환함.
  // 24-18차: "화면 유지해달라는 건 무시하는 거야?" - 24-17차에서 하트비트/마인크래프트
  // 로그인 직후 두 가지 구체적인 트리거만 고쳤는데, 이 게이트 자체가 여전히 "지금 이미
  // 로그인된 화면(홈/상점/포럼 등)을 보고 있는 도중"에도 currentSiteAccount/연동 여부가
  // 어떤 이유로든(다른 버그, 예상 못 한 타이밍 등) 잠깐 이상해지면 예고 없이 로그인/연동
  // 화면으로 튕겨버리는 구조 자체는 그대로였음 - 트리거를 하나씩 고쳐봐야 근본적으로
  // "화면을 유지해달라"는 요청을 못 지키는 구조였던 것. 이제 게이트가 실제로 화면을
  // 바꾸려는 시점에, 지금 보이는 화면이 이미 로그인 이후 화면(로그인/연동 화면이 아님)이면
  // 화면은 그대로 두고 경고만 띄움 - 로그인/연동 화면을 처음 띄우는 경우(앱 시작 시 등)나
  // 로그아웃처럼 명시적으로 그 화면을 요청한 경우는 그대로 정상 동작함(아래에서 id를 이미
  // "view-login"/"view-mc-gate"로 직접 요청한 경우는 이 분기를 안 거침).
  const currentVisibleId = ALL_APP_VIEWS.find((vid) => {
    const el = document.getElementById(vid);
    return el && !el.hidden;
  });
  const wasAlreadyAuthed = currentVisibleId && currentVisibleId !== "view-login" && currentVisibleId !== "view-mc-gate";

  let gatedId = id;
  if (id !== "view-login" && !currentSiteAccount) {
    gatedId = "view-login";
  } else if (id !== "view-login" && id !== "view-mc-gate" && currentSiteAccount && !hasLinkedMcAccount()) {
    gatedId = "view-mc-gate";
  }

  if (gatedId !== id && wasAlreadyAuthed) {
    showToast(
      gatedId === "view-login"
        ? "로그인 세션에 문제가 있는 것 같아요. 계속되면 설정에서 다시 로그인해주세요."
        : "마인크래프트 계정 연동 확인에 실패했어요. 계속되면 설정에서 다시 연동해주세요.",
      "error"
    );
    syncSidebarActiveIcon(currentVisibleId); // 화면은 안 바뀌었으니 사이드바 활성 아이콘도 원래대로
    return; // 화면은 바꾸지 않고 지금 보던 화면(currentVisibleId) 그대로 유지
  }
  id = gatedId;
  ALL_APP_VIEWS.forEach((vid) => {
    const el = document.getElementById(vid);
    if (el) el.hidden = vid !== id;
  });
  syncSidebarActiveIcon(id);
  // 사이트 로그인 화면 / 마인크래프트 연동 화면 둘 다 아직 친구 패널 자리를 쓰지 않는
  // "로그인 전" 레이아웃으로 취급함(친구 패널을 숨기는 등, 아래에서 계속 씀)
  const isPreAuth = id === "view-login" || id === "view-mc-gate";
  // 24-20차: "로그인창 전체로 쓰지 말라고... 원래 창에다가 쓰라고 버튼들 남겨두고" - 사이트
  // 계정 로그인은 아직 안 된 view-login에서는 사이드바를 누를 수 있어봐야 무의미하니 그대로
  // 숨기지만, view-mc-gate는 사이트 계정으로는 이미 로그인된 상태(마인크래프트 계정 연동만
  // 남은 것)라 사이드바・뒤로가기 화살표 같은 원래 창의 버튼들을 숨길 이유가 없음 - 눌러도
  // 게이트가 그대로 이 화면에 붙잡아두므로 안전함. view-login에서만 숨김
  document.body.classList.toggle("is-pre-auth", id === "view-login");
  // 6차: 화면이 숨겨져 있는 동안엔 슬라이딩 pill 위치를 잴 수 없으므로(offsetWidth=0),
  // 그 화면이 실제로 보이게 된 시점에 다시(애니메이션 없이) 맞춰줌
  requestAnimationFrame(() => {
    if (id === "view-explore") updateExploreKindTabsPill?.(true);
    if (id === "view-home") updateHeroModeSwitchPill?.(true);
    // 13차: Install 화면은 탭 전환 방식을 없애서 더 이상 pill을 쓰지 않음
    // 24-15차: view-home 자체가 이제 막 보이게 된 시점(로그인 직후 등)에도 서버/프로필
    // 목록의 스크롤 힌트 화살표를 같은 이유로 다시 계산해줌 - 목록은 [hidden]인 부모 화면
    // 안에서 이미 한 번 그려졌을 수 있어서(그때는 크기가 0으로 계산됐음) 처음엔 화살표가
    // 안 보이던 문제(위 setHeroSideMode의 같은 수정과 짝을 이룸)
    if (id === "view-home") {
      updateHeroListScrollFade(serverListItemsEl);
      updateHeroListScrollFade(profileListItemsEl);
      // 24-45차: "다른 창을 보고 오거나 처음 접속하면 프로필이 마지막으로 한 게 골라져있어야
      // 하는데 골라는 져있는데 표시가 안되고 있고" - 위 스크롤 화살표와 정확히 같은 원인의
      // 짝퉁 버그. 서버/프로필 목록이 [hidden]인 view-home 안에서(또는 백그라운드 상태
      // 폴링으로 refreshChipActiveStates가 view-home이 안 보이는 동안 불렸을 때) update()가
      // 불리면 offsetWidth가 0이라 mountSlidingPill이 잔상 pill을 그냥 꺼버림(주석 참고,
      // 위쪽 mountSlidingPill 함수 정의부). 선택 자체(.is-selected 클래스/데이터)는 멀쩡한데
      // 표시만 안 되는 상태로 남아있었음 - view-home이 실제로 보이게 된 이 시점에 두 목록의
      // pill을 다시 맞춰줌(현재 활성 모드가 아닌 쪽은 어차피 hidden이라 update가 다시
      // opacity 0으로 조용히 넘어감 - 부작용 없음)
      serverListPill.update(serverListItemsEl.querySelector(".server-box-item.is-selected"), true);
      profileListPill.update(profileListItemsEl.querySelector(".server-box-item.is-selected"), true);
    }
  });
  // 19차: "친구창 흐리게 하지 말라니까" - 더 이상 화면에 따라 흐려지지 않고, 아래 두 특수
  // 케이스(프로필 만들기 / 컨텐츠 설치)를 빼면 항상 또렷하게 그대로 보임
  const friendsEl = document.querySelector(".home-friends");
  const friendsDefaultEl = document.getElementById("home-friends-default-content");
  const friendsExploreSlot = document.getElementById("home-friends-explore-slot");
  const exploreSidebarEl = document.getElementById("explore-sidebar");
  const exploreContentEl = document.querySelector(".explore-content");

  // "프로필 만들기에서는 전에처럼 친구창이 안뜨게 해줘" - 이 화면에서만 통째로 숨김
  // 24-15차: 로그인 전 화면들(view-login/view-mc-gate)에서도 당연히 친구창은 숨겨야 함
  if (friendsEl) friendsEl.hidden = id === "view-versions" || isPreAuth;

  // "컨텐츠 설치는 친구창 위치에 친구창 대신 프로필 리스트로 교체하고 전에 프로필 있던
  // 자리는 그냥 모드로 채워줘" - Explore가 활성일 때만 .explore-sidebar를 친구 패널 자리로
  // 옮기고, 벗어나면 원래 자리(.explore-content)로 되돌려서 레이아웃이 정상 유지되게 함
  if (id === "view-explore") {
    if (friendsDefaultEl) friendsDefaultEl.hidden = true;
    if (friendsExploreSlot) {
      friendsExploreSlot.hidden = false;
      if (exploreSidebarEl && exploreSidebarEl.parentElement !== friendsExploreSlot) {
        friendsExploreSlot.appendChild(exploreSidebarEl);
      }
    }
  } else {
    if (friendsDefaultEl) friendsDefaultEl.hidden = false;
    if (friendsExploreSlot) friendsExploreSlot.hidden = true;
    if (exploreSidebarEl && exploreContentEl && exploreSidebarEl.parentElement !== exploreContentEl) {
      exploreContentEl.appendChild(exploreSidebarEl);
    }
  }
}

document.querySelector('.sidebar-icon[data-panel="inventory"]')?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("inventory")) return;
  setActiveSidebarIcon("inventory");
  showAppPanel("view-inventory");
  showInventoryTab("items");
  loadInventory();
});

// 18차: "보관함 바로 아래에 아래 화살표 버튼 만들어서 누르면 밑으로 스킨/서버/소식/업데이트
// 로그가 주루룩 뜨게, 닫을 수도 있게" - 사이드바를 늘 차지하는 대신, 화살표를 다시 누르면
// 그대로 접히는 아코디언 형태. 열고 닫는 것 자체는 다른 화면 전환과 상관없어서 그냥 토글만 함
const btnSidebarMoreToggle = document.getElementById("btn-sidebar-more-toggle");
const sidebarMoreIcons = document.getElementById("sidebar-more-icons");
// 19차: "더보기 닫을 때도 애니메이션 넣어주고" - 예전엔 열 때만 item-pop-in이 재생되고 닫을 땐
// hidden을 바로 켜서 순간적으로 사라졌음. 닫을 때는 먼저 .is-closing으로 item-pop-out을
// 재생시키고, 그 애니메이션이 끝난 뒤에야 실제로 hidden 처리함
function closeSidebarMoreAccordion() {
  if (!sidebarMoreIcons || sidebarMoreIcons.hidden || sidebarMoreIcons.classList.contains("is-closing")) return;
  const icons = Array.from(sidebarMoreIcons.querySelectorAll(".sidebar-icon"));
  sidebarMoreIcons.classList.add("is-closing");
  icons.forEach((el) => el.classList.add("is-closing"));
  btnSidebarMoreToggle?.classList.remove("is-expanded");
  const finish = () => {
    sidebarMoreIcons.hidden = true;
    sidebarMoreIcons.classList.remove("is-closing");
    icons.forEach((el) => el.classList.remove("is-closing"));
  };
  const lastDelay = (icons.length - 1) * 25;
  setTimeout(finish, lastDelay + 220);
}
btnSidebarMoreToggle?.addEventListener("click", () => {
  const willOpen = sidebarMoreIcons.hidden;
  if (willOpen) {
    sidebarMoreIcons.hidden = false;
    btnSidebarMoreToggle.classList.add("is-expanded");
  } else {
    closeSidebarMoreAccordion();
  }
});

// 18차: "설정에서는 스킨을 없애고 저기로 옮겨야지" - 더 이상 설정을 거치지 않고 독립
// 팝업(openSkinOverlay)을 바로 염
document.getElementById("sidebar-more-skin-btn")?.addEventListener("click", () => openSkinOverlay());
// 서버: "추가예정 아직 미구현" - 지금은 자리만 만들어두고 준비 중 안내만 보여줌
document.getElementById("sidebar-more-server-btn")?.addEventListener("click", () => {
  showToast("서버 열기 기능은 아직 준비 중이에요");
});
// 19차: "소식은 포럼이 아니야" - 커뮤니티(포럼) 공지사항 카테고리로 보내던 것을 되돌리고,
// 개발자가 직접 올리는 이벤트/소식 전용 화면(view-news)으로 바꿈
// 20차: 팝업이 아니라 다른 사이드바 메뉴들과 같은 방식(setActiveSidebarIcon + showAppPanel)의
// 화면 전환으로 바뀜
document.getElementById("sidebar-more-news-btn")?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("news")) return;
  setActiveSidebarIcon("news");
  showAppPanel("view-news");
  loadNewsView();
});
// 업데이트 로그: 기존 업데이트 내역 팝업 재사용
document.getElementById("sidebar-more-changelog-btn")?.addEventListener("click", () => openUpdates());

function showInventoryTab(tab) {
  document.querySelectorAll(".inventory-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
  document.getElementById("inventory-items-panel").hidden = tab !== "items";
  document.getElementById("inventory-attendance-panel").hidden = tab !== "attendance";
}
document.querySelectorAll(".inventory-tab").forEach((tab) => {
  tab.addEventListener("click", () => showInventoryTab(tab.dataset.tab));
});

// 10차: "설정 버튼 한번 더 누르면 닫히게" - 이미 열려 있는 상태에서 또 누르면(토글) 다시
// 여는 대신 닫히게 함. 저장 안 한 변경사항이 있을 수 있으니 닫을 때는 X버튼과 같은 안전한
// 경로(requestCloseSettings)를 그대로 씀
document.getElementById("sidebar-settings-btn")?.addEventListener("click", () => {
  const overlay = document.getElementById("settings-overlay");
  if (overlay && !overlay.hidden) {
    requestCloseSettings();
  } else {
    openSettings();
  }
});
document.querySelector('.sidebar-icon[data-panel="shop"]')?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("shop")) return;
  setActiveSidebarIcon("shop");
  openShop();
});

// ---- Forum ---------------------------------------------------------------
const forumOverlay = document.getElementById("view-forum");
const forumListPanel = document.getElementById("forum-list-panel");
const forumWritePanel = document.getElementById("forum-write-panel");
const forumDetailPanel = document.getElementById("forum-detail-panel");
const forumPostList = document.getElementById("forum-post-list");
let forumCurrentCategory = "all";
let forumCurrentSort = "latest";
let forumCurrentTag = "all";
let forumSearchTimer = null;
let forumCurrentPostId = null;
let forumAuthorFilter = null; // { uuid, name } - 프로필 팝업에서 "작성글"을 눌렀을 때만 채워짐

// 17차: "말머리 목록을 많이 쓴 순서대로 정렬해달라" - 한 세션(글쓰기 화면을 여는 동안)에는
// 매번 새로 조회하지 않도록 캐싱, 글 작성/수정으로 새 말머리가 붙을 수 있으니 세션 단위로만 유지
let forumTagUsageCountsCache = null;
async function getForumTagUsageCounts() {
  if (forumTagUsageCountsCache) return forumTagUsageCountsCache;
  try {
    const res = await window.luna.forumTagUsageCounts?.();
    forumTagUsageCountsCache = res?.ok ? res.counts || {} : {};
  } catch (_) {
    forumTagUsageCountsCache = {};
  }
  return forumTagUsageCountsCache;
}
function sortForumTagsByUsage(tags, category, counts) {
  const catCounts = counts?.[category] || {};
  return [...tags].sort((a, b) => (catCounts[b] || 0) - (catCounts[a] || 0));
}
// 말머리(선택 카테고리에 따라 고를 수 있는 목록) - 정보/질문은 서버 목록까지 포함해서 동적으로 채움,
// 17차부터 많이 쓴 순서로 정렬해서 보여줌
async function getForumTagOptionsFor(category) {
  let base = [];
  if (category === "정보" || category === "질문") {
    let serverNames = [];
    try {
      const servers = await window.luna.listServers();
      serverNames = (servers || []).map((s) => s.name);
    } catch (_) {}
    base = ["마인팜", "PVP", "모드", "마인크래프트", ...serverNames];
  } else if (category === "의견") {
    base = ["건의사항", "토론"];
  } else {
    return [];
  }
  const counts = await getForumTagUsageCounts();
  return sortForumTagsByUsage(base, category, counts);
}
// 검색 필터용 - 모든 카테고리의 말머리를 합쳐서 보여줌 (중복 제거), 17차부터 전체 사용 횟수 합산으로 정렬
async function getAllForumTagOptions() {
  const [info, opinion] = await Promise.all([getForumTagOptionsFor("정보"), getForumTagOptionsFor("의견")]);
  const merged = [...new Set([...info, ...opinion])];
  const counts = await getForumTagUsageCounts();
  const totalFor = (tag) => Object.values(counts).reduce((sum, catCounts) => sum + (catCounts[tag] || 0), 0);
  return merged.sort((a, b) => totalFor(b) - totalFor(a));
}

// 런처 제작자(운영자) 닉네임 - 이 이름으로 쓴 글/댓글엔 옆에 M 배지가 붙고, 글 고정도 이 사람만 할 수 있음
const FORUM_ADMIN_NAME = "LNR_Sil2ntium";
function adminBadgeHtml(name) {
  return name === FORUM_ADMIN_NAME ? `<span class="forum-admin-badge" title="운영자">M</span>` : "";
}

// 17-5(4차): uuid/이름을 알아낼 수 없는 상태로는 "OO님의 글만 보는 중" 필터 화면에
// 절대 들어갈 수 없게 막음 (예전엔 이 가드가 없어서 "알 수 없음님의 글 보는 중" 같은
// 화면이 뜰 수 있었음)
function setForumAuthorFilter(uuid, name) {
  if (!uuid || !name || name === "알 수 없음") {
    showToast("이 사용자의 글 목록을 볼 수 없어요", "error");
    return;
  }
  forumAuthorFilter = { uuid, name };
  showAppPanel("view-forum");
  setActiveSidebarIcon("forum");
  showForumList();
}

document.querySelector('.sidebar-icon[data-panel="forum"]')?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("forum")) return;
  setActiveSidebarIcon("forum");
  showAppPanel("view-forum");
  showForumList();
});

// 18차: 사이드바 "더보기 > 소식"에서 커뮤니티의 공지사항 카테고리로 바로 진입할 때 씀
// (setForumAuthorFilter와 같은 패턴 - 카테고리 드롭다운 표시도 실제 선택값과 맞춰줌)
function openForumCategory(category) {
  forumCurrentCategory = category;
  const menu = document.getElementById("forum-category-menu");
  const label = document.getElementById("forum-category-label");
  menu?.querySelectorAll(".dropdown-select-item").forEach((el) => {
    const active = el.dataset.category === category;
    el.classList.toggle("is-active", active);
    if (active && label) label.textContent = el.textContent;
  });
  showAppPanel("view-forum");
  setActiveSidebarIcon("forum");
  showForumList();
}

let forumTagMenuBuilt = false;
async function ensureForumTagMenuBuilt() {
  if (forumTagMenuBuilt) return;
  forumTagMenuBuilt = true;
  const menu = document.getElementById("forum-tag-menu");
  if (!menu) return;
  const tags = await getAllForumTagOptions();
  tags.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-select-item";
    btn.dataset.tag = t;
    btn.textContent = t;
    menu.appendChild(btn);
  });
  // 새로 추가한 항목들도 같은 방식으로 선택 동작하게 다시 연결
  setupDropdownSelect("forum-tag-trigger", "forum-tag-menu", "forum-tag-label", (item) => {
    forumCurrentTag = item.dataset.tag;
    runForumSearch();
  });
}

function showForumList() {
  forumListPanel.hidden = false;
  forumWritePanel.hidden = true;
  forumDetailPanel.hidden = true;
  ensureForumTagMenuBuilt();
  runForumSearch();
  window.luna.isAdmin?.().then((isAdmin) => {
    const btn = document.getElementById("btn-forum-open-reports");
    if (btn) btn.hidden = !isAdmin;
  });
}

// ---- 11-2(4차): 게시글 신고 -----------------------------------------------------
// 17차: "신고는 글 하나당 1번만 되게 하고, 신고한 뒤엔 신고 버튼을 비활성화해줘" - 모달을
// 열기 전에 먼저 이미 신고한 적 있는지 확인함(sourceBtn을 넘겨주면 이미 신고했을 때 그
// 버튼을 바로 비활성화 상태로 바꿔둠 - 목록/상세 어느 쪽에서 눌렀든 동일하게 동작)
async function openForumReportModal(postId, postTitle, sourceBtn) {
  const already = await window.luna.forumHasReported?.(postId);
  if (already) {
    if (sourceBtn) markReportButtonAsReported(sourceBtn);
    showToast("이미 신고한 글이에요", "error");
    return;
  }
  const overlay = document.getElementById("forum-report-popup");
  if (!overlay) return;
  // 24-45차: 이 모달을 답글 신고(openForumReplyReportModal)와 같이 쓰게 되면서 대상 종류를
  // dataset.targetType("post"/"reply")으로 구분함 - 접수 버튼 핸들러가 이 값으로 분기함
  document.getElementById("forum-report-title").textContent = "게시글 신고";
  document.getElementById("forum-report-target").textContent = `대상 게시글: ${postTitle || ""}`;
  document.getElementById("forum-report-detail").value = "";
  overlay.querySelector('input[name="forum-report-reason"][value="스팸"]').checked = true;
  overlay.dataset.targetType = "post";
  overlay.dataset.postId = postId;
  overlay.dataset.postTitle = postTitle || "";
  delete overlay.dataset.replyId;
  overlay.hidden = false;
}
// 24-45차 신규: "오른쪽 점점점 누르면 답글 신고하기" - 답글의 "..." 메뉴에서 호출됨.
// 위 openForumReportModal(게시글 신고)와 같은 모달을 공유하고, 접수 버튼 핸들러에서만 분기함
async function openForumReplyReportModal(replyId, postId, replyContent) {
  const already = await window.luna.forumHasReportedReply?.(replyId);
  if (already) {
    showToast("이미 신고한 답글이에요", "error");
    return;
  }
  const overlay = document.getElementById("forum-report-popup");
  if (!overlay) return;
  document.getElementById("forum-report-title").textContent = "답글 신고";
  const preview = String(replyContent || "").trim().slice(0, 40);
  document.getElementById("forum-report-target").textContent = `대상 답글: ${preview}${(replyContent || "").length > 40 ? "…" : ""}`;
  document.getElementById("forum-report-detail").value = "";
  overlay.querySelector('input[name="forum-report-reason"][value="스팸"]').checked = true;
  overlay.dataset.targetType = "reply";
  overlay.dataset.replyId = replyId;
  overlay.dataset.postId = postId || "";
  overlay.hidden = false;
}
function markReportButtonAsReported(btn) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add("is-reported");
  btn.title = "이미 신고했어요";
  // 24-14차: "신고한 게시글은 신고됨이라고 표시하기 나한테만" - 신고 버튼 바로 앞에 작은
  // "신고됨" 배지를 붙임. 이 함수는 (1) 신고 접수 직후, (2) 목록/상세를 다시 열 때 서버가
  // 알려준 내 신고 여부(reported_by_me / forumHasReported)로 처음부터 호출되므로, 이 화면을
  // 보고 있는 나(신고한 사람)한테만 보임 - 다른 사람 화면에는 애초에 이 값이 안 내려감
  if (!btn.previousElementSibling?.classList?.contains("forum-reported-badge")) {
    const badge = document.createElement("span");
    badge.className = "forum-reported-badge";
    badge.textContent = "신고됨";
    btn.insertAdjacentElement("beforebegin", badge);
  }
}
document.getElementById("btn-forum-report-cancel")?.addEventListener("click", () => {
  document.getElementById("forum-report-popup").hidden = true;
});
document.getElementById("btn-forum-report-submit")?.addEventListener("click", async () => {
  const overlay = document.getElementById("forum-report-popup");
  const reason = overlay.querySelector('input[name="forum-report-reason"]:checked')?.value || "기타";
  const detail = document.getElementById("forum-report-detail").value.trim();
  const btn = document.getElementById("btn-forum-report-submit");
  // 24-45차: 답글 신고는 게시글 신고와 접수 IPC만 다르고 나머지 흐름은 동일 - 답글 목록은
  // "신고함" 표시 등 상태가 서버에서 새로 내려오는 게 가장 정확하므로 성공 시 상세를 새로고침
  if (overlay.dataset.targetType === "reply") {
    const replyId = overlay.dataset.replyId;
    const postId = overlay.dataset.postId;
    await withBusyButton(btn, "접수 중...", async () => {
      const res = await window.luna.forumReportReply(replyId, postId, reason, detail);
      if (res.ok) {
        showToast("신고가 접수됐어요");
        overlay.hidden = true;
        if (postId) openForumDetail(postId);
      } else if (res.alreadyReported) {
        showToast("이미 신고한 답글이에요", "error");
        overlay.hidden = true;
        if (postId) openForumDetail(postId);
      } else {
        showToast(res.error || "신고 접수에 실패했어요", "error");
      }
    });
    return;
  }
  const postId = overlay.dataset.postId;
  const postTitle = overlay.dataset.postTitle;
  await withBusyButton(btn, "접수 중...", async () => {
    const res = await window.luna.forumReportPost(postId, postTitle, reason, detail);
    if (res.ok) {
      showToast("신고가 접수됐어요");
      overlay.hidden = true;
      document.querySelectorAll(`[data-post-id="${postId}"].forum-post-item-report, #btn-forum-report-post[data-post-id="${postId}"]`).forEach(markReportButtonAsReported);
    } else if (res.alreadyReported) {
      showToast("이미 신고한 글이에요", "error");
      overlay.hidden = true;
      document.querySelectorAll(`[data-post-id="${postId}"].forum-post-item-report, #btn-forum-report-post[data-post-id="${postId}"]`).forEach(markReportButtonAsReported);
    } else {
      showToast(res.error || "신고 접수에 실패했어요", "error");
    }
  });
});

// ---- 17차: 관리자 전용 - 게시글 작성자를 바로 제재(글쓰기 금지 / 읽기+쓰기 금지) --------
async function openForumModerateModal(targetUuid, targetName) {
  const overlay = document.getElementById("forum-moderate-popup");
  if (!overlay || !targetUuid) return;
  overlay.dataset.targetUuid = targetUuid;
  overlay.dataset.targetName = targetName || "";
  document.getElementById("forum-moderate-target").textContent = `대상 유저: ${targetName || targetUuid}`;
  document.getElementById("forum-moderate-reason").value = "";
  overlay.querySelector('input[name="forum-moderate-type"][value="write"]').checked = true;
  document.getElementById("forum-moderate-duration").value = "24";

  const currentBox = document.getElementById("forum-moderate-current");
  currentBox.hidden = true;
  const unrestrictBtn = document.getElementById("btn-forum-moderate-unrestrict");
  unrestrictBtn.hidden = true;
  overlay.hidden = false;

  try {
    const res = await window.luna.forumListRestrictions?.();
    const rows = res?.ok ? res.restrictions || [] : [];
    const now = Date.now();
    const active = rows.find((r) => r.target_uuid === targetUuid && (!r.expires_at || new Date(r.expires_at).getTime() > now));
    if (active) {
      const typeLabel = active.restrict_type === "read_write" ? "읽기+쓰기 금지" : "글쓰기 금지";
      const expiryLabel = active.expires_at ? `~ ${formatForumDate(active.expires_at)}까지` : "무기한";
      currentBox.textContent = `현재 제재: ${typeLabel} (${expiryLabel})`;
      currentBox.hidden = false;
      unrestrictBtn.hidden = false;
    }
  } catch (_) {}
}
document.getElementById("btn-forum-moderate-cancel")?.addEventListener("click", () => {
  document.getElementById("forum-moderate-popup").hidden = true;
});
document.getElementById("btn-forum-moderate-submit")?.addEventListener("click", async () => {
  const overlay = document.getElementById("forum-moderate-popup");
  const targetUuid = overlay.dataset.targetUuid;
  const targetName = overlay.dataset.targetName;
  const restrictType = overlay.querySelector('input[name="forum-moderate-type"]:checked')?.value || "write";
  const durationHours = Number(document.getElementById("forum-moderate-duration").value) || 0;
  const reason = document.getElementById("forum-moderate-reason").value.trim();
  const btn = document.getElementById("btn-forum-moderate-submit");
  await withBusyButton(btn, "처리 중...", async () => {
    const res = await window.luna.forumModerateUser?.({ targetUuid, targetName, restrictType, durationHours, reason });
    if (res?.ok) {
      showToast("제재했어요");
      overlay.hidden = true;
    } else {
      showToast(res?.error || "처리에 실패했어요", "error");
    }
  });
});
document.getElementById("btn-forum-moderate-unrestrict")?.addEventListener("click", async () => {
  const overlay = document.getElementById("forum-moderate-popup");
  const targetUuid = overlay.dataset.targetUuid;
  const btn = document.getElementById("btn-forum-moderate-unrestrict");
  await withBusyButton(btn, "해제 중...", async () => {
    const res = await window.luna.forumUnmoderateUser?.(targetUuid);
    if (res?.ok) {
      showToast("제재를 해제했어요");
      overlay.hidden = true;
    } else {
      showToast(res?.error || "처리에 실패했어요", "error");
    }
  });
});

// ---- 11-2(4차): 관리자 전용 신고 목록 ------------------------------------------
async function openForumReportsAdminPanel() {
  const overlay = document.getElementById("forum-reports-admin-popup");
  const listEl = document.getElementById("forum-reports-admin-list");
  if (!overlay || !listEl) return;
  overlay.hidden = false;
  listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">불러오는 중...</div>`;
  const res = await window.luna.forumListReports();
  if (!res.ok) {
    listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">${escapeHtml(res.error || "불러오지 못했어요")}</div>`;
    return;
  }
  if (!res.reports.length) {
    listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">${window.NovaI18n?.t?.("forum_reports_empty") || "신고된 글이 없어요"}</div>`;
    return;
  }
  // 10차: 신고를 한 줄씩 다 펼쳐두면 같은 글에 여러 번 신고가 쌓였을 때 보기 불편하다는 피드백 →
  // 게시글 단위로 묶어서 "N건" 카운트만 접힌 채로 보여주고, 클릭해야 개별 신고 사유가 펼쳐지도록 변경
  const byPost = new Map();
  res.reports.forEach((r) => {
    const key = r.post_id || r.post_title;
    if (!byPost.has(key)) byPost.set(key, { postId: r.post_id, postTitle: r.post_title, reports: [] });
    byPost.get(key).reports.push(r);
  });
  const groups = Array.from(byPost.values()).sort((a, b) => b.reports.length - a.reports.length);
  listEl.innerHTML = groups
    .map((g, gi) => {
      const latest = g.reports[0]?.created_at;
      // 17차: "신고를 누르면 그 글로 이동, 글이 지워졌어도 신고 내역 안에서 내용은 계속
      // 보여야 함" - post_id가 남아있으면(글이 살아있으면) "글 보기" 버튼으로 바로 이동,
      // 지워졌으면 버튼 대신 "삭제된 글" 표시 + 신고 시점에 저장해둔 본문 스냅샷을 보여줌
      const snapshotContent = g.reports.find((r) => r.post_content)?.post_content || "";
      return `
      <div class="forum-report-group">
        <div class="forum-report-group-head-row">
          <button type="button" class="forum-report-group-head" data-group-index="${gi}">
            <span class="forum-report-group-title">${escapeHtml(g.postTitle || "(제목 없음)")}</span>
            <span class="forum-report-group-count">${g.reports.length}건</span>
            <span class="forum-report-row-time">${FORUM_CALENDAR_ICON_SVG}${formatForumDate(latest)}</span>
            <svg class="forum-report-group-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          ${
            g.postId
              ? `<button type="button" class="btn btn-ghost btn-small forum-report-goto-post" data-post-id="${g.postId}">글 보기</button>`
              : `<span class="forum-report-deleted-badge">삭제된 글</span>`
          }
        </div>
        <div class="forum-report-group-body" id="forum-report-group-body-${gi}" hidden>
          ${
            snapshotContent
              ? `<div class="forum-report-content-snapshot"><div class="forum-report-content-snapshot-title">신고 당시 본문 스냅샷</div><div class="forum-report-content-snapshot-body">${escapeHtml(snapshotContent).slice(0, 2000)}</div></div>`
              : ""
          }
          ${g.reports
            .map(
              (r) => `
            <div class="forum-report-row">
              <div class="forum-report-row-top">
                <span class="forum-report-row-reason">${escapeHtml(r.reason)}</span>
                <span class="forum-report-row-time">${FORUM_CALENDAR_ICON_SVG}${formatForumDate(r.created_at)}</span>
              </div>
              ${r.detail ? `<div class="forum-report-row-detail">${escapeHtml(r.detail)}</div>` : ""}
              <div class="forum-report-row-reporter">${escapeHtml(window.NovaI18n?.t?.("forum_reporter_prefix", { name: r.reporter_name || window.NovaI18n?.t?.("forum_reporter_unknown") || "알 수 없음" }) || `신고자: ${r.reporter_name || "알 수 없음"}`)}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    })
    .join("");
  listEl.querySelectorAll(".forum-report-group-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = document.getElementById(`forum-report-group-body-${btn.dataset.groupIndex}`);
      const isOpen = !body.hidden;
      body.hidden = isOpen;
      btn.classList.toggle("is-expanded", !isOpen);
    });
  });
  // 17차: "신고 목록에서 누르면 그 글로 이동해야 해" - 신고 목록 팝업을 닫고 그 글의 상세로 이동
  listEl.querySelectorAll(".forum-report-goto-post").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("forum-reports-admin-popup").hidden = true;
      showAppPanel("view-forum");
      setActiveSidebarIcon("forum");
      openForumDetail(btn.dataset.postId);
    });
  });
}
document.getElementById("btn-forum-open-reports")?.addEventListener("click", openForumReportsAdminPanel);
document.getElementById("btn-forum-reports-admin-close")?.addEventListener("click", () => {
  document.getElementById("forum-reports-admin-popup").hidden = true;
});

// 24-14차: "업데이트 로그도 다른 곳 누르면 꺼지게 해줘 좀 이런 건 알잘딱하게 해줘 다음부터는" -
// 업데이트 로그 하나만 고치는 대신, 배경(바깥) 클릭으로 안 닫히던 나머지 팝업/오버레이도
// 한 번에 다 찾아서 고침(이 종류의 버그를 다음부터 미리미리 막아달라는 뜻으로 받아들임).
// 약관 동의/테마 온보딩처럼 사용자가 꼭 결정해야 하는 최초 실행 다이얼로그는 실수로 닫히면
// 안 돼서 일부러 빼둠
function bindOverlayBackdropClose(overlayId, onClose) {
  const el = document.getElementById(overlayId);
  el?.addEventListener("click", (e) => {
    if (e.target === el) (onClose || (() => { el.hidden = true; }))();
  });
}
[
  "updates-overlay",
  "profile-settings-overlay",
  "profile-share-overlay",
  "mods-update-overlay",
  "mod-version-overlay",
  "ai-assistant-overlay",
  "author-page-overlay",
  "forum-user-popup",
  "forum-report-popup",
  "forum-reports-admin-popup",
  "forum-moderate-popup",
].forEach((id) => bindOverlayBackdropClose(id));
bindOverlayBackdropClose("skin-overlay", closeSkinOverlay);

// ---- 공용 드롭다운 선택 컴포넌트 (카테고리 / 정렬 둘 다 같은 방식) --------------------
function setupDropdownSelect(triggerId, menuId, labelId, onSelect) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  const label = document.getElementById(labelId);
  if (!trigger || !menu) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    // 8-11: 카테고리/말머리 드롭다운이 동시에 둘 다 열려있을 수 있던 문제 -
    // 하나를 열기 전에 다른 드롭다운 메뉴들은 먼저 다 닫음
    if (willOpen) {
      document.querySelectorAll(".dropdown-select-menu").forEach((m) => {
        if (m !== menu) m.hidden = true;
      });
    }
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== trigger) {
      menu.hidden = true;
    }
  });
  menu.querySelectorAll(".dropdown-select-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu.querySelectorAll(".dropdown-select-item").forEach((i) => i.classList.remove("is-active"));
      item.classList.add("is-active");
      if (label) label.textContent = item.textContent;
      menu.hidden = true;
      onSelect(item);
    });
  });
}

setupDropdownSelect("forum-category-trigger", "forum-category-menu", "forum-category-label", (item) => {
  forumCurrentCategory = item.dataset.category;
  runForumSearch();
});
setupDropdownSelect("forum-sort-trigger", "forum-sort-menu", "forum-sort-label", (item) => {
  forumCurrentSort = item.dataset.sort;
  runForumSearch();
});

document.getElementById("forum-search-input")?.addEventListener("input", () => {
  clearTimeout(forumSearchTimer);
  forumSearchTimer = setTimeout(runForumSearch, 400);
});

async function runForumSearch() {
  forumPostList.innerHTML = `<div style="color:var(--text-2); font-size:12.5px; padding:12px;">불러오는 중...</div>`;
  const search = document.getElementById("forum-search-input").value;
  const posts = await window.luna.forumListPosts(forumCurrentCategory, search, forumCurrentSort, forumAuthorFilter?.uuid, forumCurrentTag);

  // 작성자 필터가 걸려있으면 목록 위에 "OOO님의 글" 칩을 보여주고, 눌러서 해제할 수 있게 함
  const existingChip = document.getElementById("forum-author-filter-chip");
  existingChip?.remove();
  if (forumAuthorFilter) {
    const chip = document.createElement("div");
    chip.id = "forum-author-filter-chip";
    chip.className = "forum-author-filter-chip";
    chip.innerHTML = `<span>${forumAuthorFilter.name}님의 글만 보는 중</span><button type="button" title="해제">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      forumAuthorFilter = null;
      runForumSearch();
    });
    forumPostList.insertAdjacentElement("beforebegin", chip);
  }

  forumPostList.innerHTML = "";
  if (posts.length === 0) {
    forumPostList.innerHTML = `<div style="color:var(--text-2); font-size:12.5px; padding:12px;">아직 게시글이 없어요</div>`;
    return;
  }
  const myUuidForList = currentProfile?.uuid || null;
  posts.forEach((p, postIndex) => {
    const row = document.createElement("div");
    row.className = "forum-post-item stagger-in" + (p.pinned ? " is-pinned" : "") + (p.category === "공지사항" ? " is-notice-row" : "");
    row.style.setProperty("--i", postIndex);
    // 24-23차: author_uuid 대시 유무 형식이 섞여 저장될 수 있어(main.js authorUuidInFilter
    // 참고, 게시글 카운트/필터 버그와 같은 원인) 여기도 정규화 비교로 통일
    const isMineRow = myUuidForList && normalizeUuidForCompare(myUuidForList) === normalizeUuidForCompare(p.author_uuid);
    row.innerHTML = `
      <span class="forum-post-category${p.category === "공지사항" ? " is-notice" : ""}">${p.category === "공지사항" ? "📢 " : ""}${p.category}</span>
      <div class="forum-post-item-info">
        <div class="forum-post-item-title">${p.pinned ? `<span class="forum-pin-badge" title="고정된 글">📌</span>` : ""}${forumTagChipHtml(p.tag)}${escapeHtml(p.title)}</div>
        <div class="forum-post-item-author">${escapeHtml(p.author_name)}${adminBadgeHtml(p.author_name)}</div>
      </div>
      <div class="forum-post-item-stats">
        <span class="forum-post-item-views" title="조회수">👁 ${p.view_count || 0}</span>
        <span class="forum-post-item-likes" title="좋아요">♥ ${p.like_count}</span>
        <span class="forum-post-item-date">${FORUM_CALENDAR_ICON_SVG}${formatForumDate(p.created_at)}</span>
      </div>
      ${
        // 16차: "공지사항은 신고 안뜨게 하고" - 공지사항 글에는 신고 버튼을 아예 안 보여줌
        // 24-14차: "매니저 M 달린 계정이 쓴 게시글은 신고 불가능하게 하기" - 운영자(M 배지)
        // 글에는 신고 버튼 자체를 안 보여줌(서버 쪽도 main.js forum:report-post에서 이중으로 막음)
        !isMineRow && p.category !== "공지사항" && p.author_name !== FORUM_ADMIN_NAME
          ? `<button type="button" class="icon-btn forum-post-item-report" data-post-id="${p.id}" title="이 글 신고">${FORUM_REPORT_ICON_SVG}</button>`
          : ""
      }
    `;
    const reportBtnEl = row.querySelector(".forum-post-item-report");
    reportBtnEl?.addEventListener("click", (e) => {
      e.stopPropagation();
      openForumReportModal(p.id, p.title, e.currentTarget);
    });
    // 24-14차: 서버가 목록 조회 때 같이 내려준 내 신고 여부로 처음부터 배지/비활성화를 반영
    if (p.reported_by_me && reportBtnEl) markReportButtonAsReported(reportBtnEl);
    row.addEventListener("click", () => openForumDetail(p.id));
    forumPostList.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
// 말머리 칩 - 옅은 색으로 "[말머리내용]" 형태로 제목 앞에 붙여줌
function forumTagChipHtml(tag) {
  return tag ? `<span class="forum-tag-chip">[${escapeHtml(tag)}]</span>` : "";
}
// 오늘 쓴 글이면 "N시간 전"/"방금 전" 식으로, 하루 이상 지났으면 날짜로 표시
// 14-1(4차): 프로필 관리(모드/리소스팩/쉐이더) 목록의 액션 버튼 - 이모지(📌 ✕) 대신
// 앱 다른 곳(예: 휘스퍼 닫기 버튼)과 같은 스타일의 얇은 라인 SVG 아이콘으로 통일
// 17차: "모드 고정 버튼/아이콘이 작아서 그런지 촌스러워" - 알아보기 힘든 깃발 모양 커스텀
// 아이콘 대신, 흔히 쓰이는 압정(핀 꽂기) 모양으로 바꾸고 아래 CSS에서 크기도 살짝 키움
const MANAGE_ICON_PIN_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
const MANAGE_ICON_DELETE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7M6 7l1 13.2c.05.98.86 1.8 1.84 1.8h6.32c.98 0 1.79-.82 1.84-1.8L18 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// 5-9(5차): 표 레이아웃 재구성 - "버전 변경" 텍스트 버튼도 아이콘으로 (참고 스크린샷의 ⇄ 톤에 맞춤)
const MANAGE_ICON_VERSION_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h11l-3-3M17 17H6l3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// 10-1(4차): 게시글 날짜 옆에 붙는 작은 캘린더 아이콘
const FORUM_CALENDAR_ICON_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1.5px;margin-right:3px;"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18" stroke-linecap="round"/></svg>`;
// 10차: 이모지 깃발(🚩) 대신 쓰는 신고 아이콘 (게시글 목록 줄/상세화면/신고 목록 버튼에서 공용으로 씀)
const FORUM_REPORT_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 21V4" stroke-linecap="round"/><path d="M5 4h13l-3 4.5L18 13H5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// 17차: "공유 프로필 미리보기 영역의 게임패드 이모지(🎮) 제거" - 다른 곳들과 같은 패턴대로 이모지 대신 SVG 아이콘으로
const FORUM_SHARED_PROFILE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="7" width="20" height="10" rx="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// 24-45차: 답글 "..." 더보기 메뉴 버튼 아이콘 (profile-hero-kebab-menu와 같은 세로 점 3개 모양)
const FORUM_REPLY_KEBAB_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;
// 24-45차: 답글 작성 폼의 사진 첨부 버튼 아이콘
const FORUM_ATTACH_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13" r="4"/></svg>`;

// 10-1(4차): "한눈에 알아보기 힘들다"는 재지적 - 오늘 안에서만 상대시간(분/시간)을 쓰고 그 밖은
// 바로 M.D로 점프하던 걸, 휘스퍼(formatRelativeTime)와 같은 패턴으로 통일해서 최근 7일까진
// "N일 전"까지 relative하게 보여주고, 그보다 오래된 건 절대 날짜(YYYY.MM.DD)로 확실히 보여줌.
// 날짜 옆에는 index.html의 forum-post-item-date 자리에서 캘린더 아이콘을 같이 그려줌
function formatForumDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();

    if (diffMs >= 0) {
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "방금 전";
      if (diffMin < 60) return `${diffMin}분 전`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}시간 전`;
      const diffDay = Math.floor(diffHour / 24);
      if (diffDay < 7) return `${diffDay}일 전`;
    }

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}.${mm}.${dd}`;
  } catch (_) {
    return "";
  }
}
// 텍스트 안 URL을 자동으로 링크로 바꿔줌 (11차 이전 - 순수 텍스트로 저장된 예전 글용)
function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s]+)/g, (url) => `<a href="#" class="forum-link" data-url="${url}">${url}</a>`);
}

// ---- 11차 신규: 포럼 글 리치 텍스트(HTML) 저장/표시 -----------------------------
// 글쓰기 에디터가 이제 contenteditable + 서식 툴바라서 content가 순수 텍스트가 아니라
// HTML로 저장됨. 여러 사람이 보는 공용 게시판이라 다른 사람이 만든 글의 content를
// 그대로 innerHTML에 꽂으면 스크립트/이벤트 핸들러가 섞여 들어올 수 있으므로(저장형 XSS),
// 표시할 때 항상 이 안전 목록 기반 새니타이저를 거침 - 목록에 없는 태그는 내용만 남기고
// 태그 자체는 벗겨내고, 속성도 허용된 것만(그마저도 href/src는 http(s)/data:image만) 남김
const FORUM_RICH_SAFE_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV", "SPAN",
  "BLOCKQUOTE", "HR", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
  "A", "IMG", "FONT",
]);
const FORUM_RICH_SAFE_ATTRS = {
  A: ["href"],
  IMG: ["src", "alt"],
  FONT: ["color", "size", "face"],
  SPAN: ["style"],
  DIV: ["style"],
  P: ["style"],
  TD: ["style"],
  TH: ["style"],
  // 24-11차: "박스 도구"(예전 인용구 스타일)를 진짜 인용구와 구분하려면 blockquote에
  // class가 남아있어야 함(전엔 여기 목록에 없어서 저장/렌더링 때마다 class가 통째로
  // 지워지고 있었음 - table도 마찬가지라 .forum-rt-table 스타일이 실제로는 한 번도
  // 적용되지 못하고 있었음. 둘 다 class를 허용 목록에 추가함)
  BLOCKQUOTE: ["class"],
  TABLE: ["class"],
};
// 새니타이저를 통과할 수 있는 class 값 화이트리스트(임의의 class 주입 방지)
const FORUM_RICH_SAFE_CLASSES = new Set(["forum-rt-box", "forum-quote-real", "forum-rt-table"]);
const FORUM_RICH_SAFE_STYLE_PROPS = ["color", "text-align", "font-size", "font-weight", "font-style", "text-decoration", "font-family"];
function sanitizeForumStyle(styleText) {
  return (styleText || "")
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      const propName = decl.split(":")[0]?.trim().toLowerCase();
      if (!propName || !FORUM_RICH_SAFE_STYLE_PROPS.includes(propName)) return false;
      if (/url\s*\(|expression|javascript:/i.test(decl)) return false;
      return true;
    })
    .join("; ");
}
function sanitizeForumHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  function clean(node) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName;
      if (!FORUM_RICH_SAFE_TAGS.has(tag)) {
        // 태그 자체(위험할 수 있는)만 벗겨내고, 안의 내용(텍스트/자식)은 그대로 살려둠
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      const allowed = FORUM_RICH_SAFE_ATTRS[tag] || [];
      Array.from(child.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (!allowed.includes(name)) {
          child.removeAttribute(attr.name);
          return;
        }
        if (name === "href" || name === "src") {
          const v = attr.value.trim();
          const isHttp = /^https?:\/\//i.test(v);
          const isDataImg = name === "src" && /^data:image\//i.test(v);
          if (!isHttp && !isDataImg) child.removeAttribute(attr.name);
        }
        if (name === "style") {
          const cleaned = sanitizeForumStyle(attr.value);
          if (cleaned) child.setAttribute("style", cleaned);
          else child.removeAttribute("style");
        }
        if (name === "class") {
          // 정해둔 스타일 클래스(박스/인용구/표)만 통과시키고, 그 외 임의의 class는 버림
          const kept = attr.value.split(/\s+/).filter((c) => FORUM_RICH_SAFE_CLASSES.has(c));
          if (kept.length) child.setAttribute("class", kept.join(" "));
          else child.removeAttribute("class");
        }
      });
      clean(child);
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}
// 안전하게 정리된 HTML을 넣은 뒤, 남아있는 <a href>는 이 앱의 CSP 때문에 직접 이동이
// 안 되니 클릭 가로채서 openExternal로 열리게 바꾸고, 링크 태그 없이 순수 텍스트로만
// 붙여넣힌 URL도(예전처럼) 자동으로 링크가 되게 만들어줌
function linkifyRichTextNodes(container) {
  const urlRe = /(https?:\/\/[^\s<]+[^\s<.,:;!?)\]'"])/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement && n.parentElement.closest("a")) continue;
    urlRe.lastIndex = 0;
    if (urlRe.test(n.nodeValue)) textNodes.push(n);
  }
  textNodes.forEach((node) => {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let m;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(text))) {
      if (m.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      const a = document.createElement("a");
      a.href = "#";
      a.className = "forum-link";
      a.dataset.url = m[0];
      a.textContent = m[0];
      frag.appendChild(a);
      lastIndex = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.parentNode.replaceChild(frag, node);
  });
}
function bindForumLinkClicks(container) {
  container.querySelectorAll(".forum-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.luna.openExternal?.(a.dataset.url);
    });
  });
}
// 글 본문(post.content)을 container에 채움 - 11차 이전 글은 순수 텍스트였으므로(HTML 태그가
// 없으면) 기존 방식(자동 링크만) 그대로 쓰고, 리치 에디터로 쓴 글이면 새니타이즈해서 채움
function renderForumRichContent(container, rawContent) {
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(rawContent || "");
  if (!looksLikeHtml) {
    container.innerHTML = linkify(rawContent);
    bindForumLinkClicks(container);
    return;
  }
  container.innerHTML = sanitizeForumHtml(rawContent);
  container.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    a.classList.add("forum-link");
    a.dataset.url = href;
    a.setAttribute("href", "#");
  });
  linkifyRichTextNodes(container);
  bindForumLinkClicks(container);
}

// ---- 글쓰기 ---------------------------------------------------------------
let forumAttachedImageUrl = null;
let forumAttachedFile = null; // { url, name }

// 카테고리에 따라 말머리 select 옵션을 채우고, 고를 게 없으면 행 자체를 숨김
async function refreshForumTagSelect(categoryValue, tagRowId, tagSelectId, selectedTag) {
  const row = document.getElementById(tagRowId);
  const select = document.getElementById(tagSelectId);
  if (!row || !select) return;
  const options = await getForumTagOptionsFor(categoryValue);
  if (options.length === 0) {
    row.hidden = true;
    select.innerHTML = `<option value="">없음</option>`;
    return;
  }
  row.hidden = false;
  select.innerHTML =
    `<option value="">없음</option>` + options.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (selectedTag) select.value = selectedTag;
}

document.getElementById("forum-write-category")?.addEventListener("change", (e) => {
  refreshForumTagSelect(e.target.value, "forum-write-tag-row", "forum-write-tag", null);
});

// 12차: "글 수정도 글쓰기 창을 재활용해서 서식 툴바를 그대로 쓸 수 있게 해달라" - 예전엔
// 상세화면 안에 툴바 없는 별도의 간단한 편집 박스를 또 만들어서 썼는데(11차), 그러다 보니
// 수정할 땐 서식 기능을 하나도 못 쓰는 문제가 있었음. 이제 "새 글 쓰기"와 "글 수정" 둘 다
// 같은 forum-write-panel(툴바 포함)을 그대로 열고, forumEditingPostId 유무로 제출 시
// 생성/수정만 분기함
let forumEditingPostId = null;
let forumEditingPostSharedCode = null;

// 새 글/수정 공통으로 쓰는 초기화(제목/본문/첨부/공유토글 비우기 + 공지사항 옵션 관리)
async function resetForumWriteForm() {
  document.getElementById("forum-write-title").value = "";
  document.getElementById("forum-write-content").innerHTML = "";
  forumAttachedImageUrl = null;
  forumAttachedFile = null;
  const fileBtn = document.getElementById("rt-file-btn");
  if (fileBtn) {
    fileBtn.classList.remove("is-active");
    fileBtn.dataset.tooltip = "파일 첨부";
  }
  const shareToggle = document.getElementById("forum-write-share-toggle");
  const shareSelect = document.getElementById("forum-write-share-select");
  if (shareToggle) shareToggle.checked = false;
  if (shareSelect) {
    shareSelect.hidden = true;
    delete shareSelect.dataset.loaded;
  }

  // '공지사항' 카테고리는 제작자(LNR_Sil2ntium)만 고를 수 있게, 글쓰기 화면 열 때만 넣어줌
  const categorySelect = document.getElementById("forum-write-category");
  const existingNotice = categorySelect.querySelector('option[value="공지사항"]');
  const isAdmin = await window.luna.isAdmin?.();
  if (isAdmin && !existingNotice) {
    const opt = document.createElement("option");
    opt.value = "공지사항";
    opt.textContent = "공지사항";
    categorySelect.insertBefore(opt, categorySelect.firstChild);
  } else if (!isAdmin && existingNotice) {
    existingNotice.remove();
  }
  // 24-11차: "카테고리를 미리 선택해두지 말고 직접 고르게 해줘" - 관리자용 '공지사항'
  // 옵션을 추가/제거하는 과정에서 선택 상태가 흐트러질 수 있어, 매번 명시적으로 빈
  // 플레이스홀더로 되돌림
  categorySelect.value = "";
}

// 17차 신규: 글쓰기 임시저장 - 계정당 1개만, 새 글 작성 중에만 동작(수정 중엔 원본이 이미
// 있으니 임시저장 대상이 아님). 서버가 아니라 이 컴퓨터에만 저장됨(forum:save-draft 참고)
function collectForumDraftInput() {
  return {
    title: document.getElementById("forum-write-title").value,
    content: document.getElementById("forum-write-content").innerHTML,
    category: document.getElementById("forum-write-category").value,
    tag: document.getElementById("forum-write-tag").value || null,
  };
}
function formatDraftSavedAt(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 임시저장됨`;
  } catch (_) {
    return "임시저장됨";
  }
}
async function saveForumDraftNow(silent) {
  if (forumEditingPostId) return;
  const draft = collectForumDraftInput();
  if (!draft.title.trim() && !document.getElementById("forum-write-content").textContent.trim()) return; // 빈 글은 저장 안 함
  const res = await window.luna.forumSaveDraft?.(draft);
  const statusEl = document.getElementById("forum-draft-status");
  if (res?.ok && statusEl) {
    statusEl.textContent = formatDraftSavedAt(new Date().toISOString());
    statusEl.hidden = false;
  }
  if (!silent) {
    showToast("임시저장했어요");
    // 24-11차: "임시저장하면 글쓰기 화면에서 나가지게 해줘" - 자동 저장(silent)은 그대로
    // 화면에 머물지만, 버튼을 직접 눌러 저장했을 땐 목록 화면으로 돌아감
    showForumList();
  }
}
let forumDraftAutoSaveTimer = null;
function scheduleForumDraftAutoSave() {
  if (forumEditingPostId) return;
  clearTimeout(forumDraftAutoSaveTimer);
  forumDraftAutoSaveTimer = setTimeout(() => saveForumDraftNow(true), 2500);
}
document.getElementById("forum-write-title")?.addEventListener("input", scheduleForumDraftAutoSave);
document.getElementById("forum-write-content")?.addEventListener("input", scheduleForumDraftAutoSave);
document.getElementById("btn-forum-draft-save")?.addEventListener("click", () => saveForumDraftNow(false));

document.getElementById("btn-forum-write")?.addEventListener("click", async () => {
  forumEditingPostId = null;
  forumEditingPostSharedCode = null;
  document.getElementById("btn-forum-submit").textContent = "게시하기";
  forumListPanel.hidden = true;
  forumDetailPanel.hidden = true;
  forumWritePanel.hidden = false;
  await resetForumWriteForm();
  await refreshForumTagSelect(document.getElementById("forum-write-category").value, "forum-write-tag-row", "forum-write-tag", null);
  const draftBtn = document.getElementById("btn-forum-draft-save");
  const statusEl = document.getElementById("forum-draft-status");
  if (draftBtn) draftBtn.hidden = false;
  if (statusEl) statusEl.hidden = true;

  // 17차: 임시저장된 글이 있으면(제목/내용 중 하나라도 실제 내용이 있을 때만) 불러올지 물어봄
  const draft = await window.luna.forumGetDraft?.();
  const draftHasContent = draft && (draft.title?.trim() || draft.content?.replace(/<[^>]*>/g, "").trim());
  if (draftHasContent) {
    const restore = await showConfirm("임시저장된 글이 있어요. 불러올까요?", "불러오기", "새로 쓰기");
    if (restore) {
      document.getElementById("forum-write-title").value = draft.title || "";
      document.getElementById("forum-write-content").innerHTML = sanitizeForumHtml(draft.content || "");
      if (draft.category) {
        document.getElementById("forum-write-category").value = draft.category;
        await refreshForumTagSelect(draft.category, "forum-write-tag-row", "forum-write-tag", draft.tag || null);
      }
      if (draft.savedAt && statusEl) {
        statusEl.textContent = formatDraftSavedAt(draft.savedAt);
        statusEl.hidden = false;
      }
    } else {
      await window.luna.forumClearDraft?.();
    }
  }
});
document.getElementById("btn-forum-write-back")?.addEventListener("click", async () => {
  // 24-15차: "포럼 글 쓰다가 내용이 하나라도 있는데 나가기 하면 임시 저장하시겠습니까 라고
  // 물어봐주고" - 새 글 작성 중(수정 중이 아닐 때, 수정은 원본이 이미 있어 임시저장 대상이
  // 아님)에 제목/본문 중 뭐라도 입력돼 있는 상태로 나가기를 누르면 그냥 사라지지 않고
  // 먼저 임시저장할지 물어봄
  if (!forumEditingPostId) {
    const draft = collectForumDraftInput();
    const hasContent = draft.title.trim() || document.getElementById("forum-write-content").textContent.trim();
    if (hasContent) {
      const save = await showConfirm("작성 중인 내용이 있어요. 임시 저장하시겠습니까?", "임시 저장", "저장 안 함");
      if (save) {
        await window.luna.forumSaveDraft?.(draft);
        showToast("임시저장했어요");
      } else {
        await window.luna.forumClearDraft?.();
      }
    }
  }
  // 글 수정 중에 뒤로가기를 누르면 목록이 아니라 그 글 상세로 돌아가는 게 자연스러움
  if (forumEditingPostId) {
    const id = forumEditingPostId;
    forumEditingPostId = null;
    forumEditingPostSharedCode = null;
    openForumDetail(id);
  } else {
    showForumList();
  }
});


// ---- 11차 신규: 글쓰기 리치 텍스트 툴바 (네이버 카페/블로그 에디터 참고) --------------
// 별도 라이브러리 없이 contenteditable + document.execCommand로 동작함. execCommand가
// 만들어내는 태그(b/i/u/strike/font/blockquote/hr 등)는 renderForumRichContent가 표시할
// 때 거치는 새니타이저(FORUM_RICH_SAFE_TAGS/ATTRS)의 허용 목록과 맞춰뒀음
function forumRichExec(cmd, value) {
  document.getElementById("forum-write-content")?.focus();
  document.execCommand(cmd, false, value);
  updateForumRichToolbarState();
}
document.querySelectorAll("#forum-richtext-toolbar .rt-btn[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => forumRichExec(btn.dataset.cmd, btn.dataset.cmdValue || undefined));
});
// 12차: "볼드/기울임 눌러도 켜진 건지 꺼진 건지 모르겠다" - 커서 위치의 서식 상태를
// queryCommandState로 읽어서 해당 버튼에 is-active를 켜고 끔(클릭 직후 + 커서 이동/타이핑마다 갱신)
const FORUM_RT_STATE_CMDS = ["bold", "italic", "underline", "strikeThrough", "justifyLeft", "justifyCenter", "justifyRight"];
function updateForumRichToolbarState() {
  FORUM_RT_STATE_CMDS.forEach((cmd) => {
    const btn = document.querySelector(`#forum-richtext-toolbar .rt-btn[data-cmd="${cmd}"]`);
    if (!btn) return;
    let active = false;
    try { active = document.queryCommandState(cmd); } catch (_) { active = false; }
    btn.classList.toggle("is-active", active);
  });
}
document.getElementById("forum-write-content")?.addEventListener("keyup", updateForumRichToolbarState);
document.getElementById("forum-write-content")?.addEventListener("mouseup", updateForumRichToolbarState);
document.addEventListener("selectionchange", () => {
  if (document.activeElement === document.getElementById("forum-write-content")) updateForumRichToolbarState();
});
// 12차: "글씨 크기를 숫자로, 기본값도 표시해달라" - execCommand의 fontSize는 legacy 1~7
// 단계만 지원해서 정확한 px를 못 주므로, 일단 가장 큰 7단계로 적용해 결과로 생기는
// <font size="7"> 태그를 찾아 실제 원하는 px의 <span style="font-size:...">로 바꿔치기함
// (흔히 쓰이는 우회 방법 - 새로 생긴 font 태그만 골라내려고 매 실행 전/후로 비교함)
document.getElementById("rt-font-size")?.addEventListener("change", (e) => {
  const px = e.target.value;
  const editor = document.getElementById("forum-write-content");
  if (!editor) return;
  editor.focus();
  const before = new Set(editor.querySelectorAll('font[size="7"]'));
  document.execCommand("fontSize", false, "7");
  editor.querySelectorAll('font[size="7"]').forEach((f) => {
    if (before.has(f)) return;
    f.removeAttribute("size");
    f.style.fontSize = px + "px";
  });
});
document.getElementById("rt-font-name")?.addEventListener("change", (e) => forumRichExec("fontName", e.target.value));

const FORUM_RT_COLORS = ["#f1f1f2", "#e5484d", "#ff9f43", "#f5d90a", "#5fe066", "#4fa8ff", "#a78bfa", "#ff5c9d", "#86867f"];
const forumRtColorMenu = document.getElementById("rt-color-menu");
if (forumRtColorMenu) {
  forumRtColorMenu.innerHTML = FORUM_RT_COLORS.map((c) => `<button type="button" class="rt-color-swatch-btn" style="background:${c}" data-color="${c}"></button>`).join("");
  forumRtColorMenu.querySelectorAll(".rt-color-swatch-btn").forEach((b) => {
    b.addEventListener("click", () => {
      forumRichExec("foreColor", b.dataset.color);
      // 12차: 네모 스와치 대신 "가" 글자 밑의 지그재그 밑줄 색으로 지금 고른 색을 보여줌
      const swatch = document.getElementById("rt-color-swatch");
      if (swatch) swatch.setAttribute("stroke", b.dataset.color);
      forumRtColorMenu.hidden = true;
    });
  });
}
document.getElementById("rt-color-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (forumRtColorMenu) forumRtColorMenu.hidden = !forumRtColorMenu.hidden;
});

// "스티커" = 컴퓨터에 이미 있는 유니코드 이모지를 커서 위치에 넣어주는 간단한 피커
const FORUM_RT_EMOJIS = ["😀","😂","😍","😎","🤔","😢","😡","👍","👎","🙏","🎉","🔥","❤️","💚","⭐","✅","❌","⚠️","🎮","⛏️","🧱","💎","🏆","📌"];
const forumRtEmojiMenu = document.getElementById("rt-emoji-menu");
if (forumRtEmojiMenu) {
  forumRtEmojiMenu.innerHTML = FORUM_RT_EMOJIS.map((em) => `<button type="button" class="rt-emoji-item">${em}</button>`).join("");
  forumRtEmojiMenu.querySelectorAll(".rt-emoji-item").forEach((b) => {
    b.addEventListener("click", () => {
      forumRichExec("insertText", b.textContent);
      forumRtEmojiMenu.hidden = true;
    });
  });
}
document.getElementById("rt-emoji-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (forumRtEmojiMenu) forumRtEmojiMenu.hidden = !forumRtEmojiMenu.hidden;
});
const forumRtTableMenu = document.getElementById("rt-table-menu");
document.addEventListener("click", () => {
  if (forumRtColorMenu) forumRtColorMenu.hidden = true;
  if (forumRtEmojiMenu) forumRtEmojiMenu.hidden = true;
  if (forumRtTableMenu) forumRtTableMenu.hidden = true;
});

// 24-11차: "표 만들 때 행/열 개수를 직접 고를 수 있게" - 고정 3x3 삽입 대신 작은
// 팝오버에서 숫자를 입력받아 삽입함
document.getElementById("rt-table-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (forumRtTableMenu) forumRtTableMenu.hidden = !forumRtTableMenu.hidden;
});
forumRtTableMenu?.addEventListener("click", (e) => e.stopPropagation());
document.getElementById("rt-table-insert-btn")?.addEventListener("click", () => {
  const rowsInput = document.getElementById("rt-table-rows");
  const colsInput = document.getElementById("rt-table-cols");
  const rows = Math.min(12, Math.max(1, parseInt(rowsInput?.value, 10) || 3));
  const cols = Math.min(12, Math.max(1, parseInt(colsInput?.value, 10) || 3));
  let html = '<table class="forum-rt-table"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += "<tr>" + "<td>&nbsp;</td>".repeat(cols) + "</tr>";
  }
  html += "</tbody></table><p><br></p>";
  forumRichExec("insertHTML", html);
  if (forumRtTableMenu) forumRtTableMenu.hidden = true;
});

// 24-11차: "인용구가 그냥 박스라 별로다" - 예전 박스 스타일은 "강조 박스" 도구로 그대로
// 재활용하고(class="forum-rt-box"), 인용구 버튼은 실제 말풍선처럼 보이는 새 스타일로
// 새로 만듦(class 없는 기본 blockquote 스타일 = style.css의 새 "진짜 인용구" 모양)
document.getElementById("rt-box-btn")?.addEventListener("click", () => {
  document.getElementById("forum-write-content")?.focus();
  document.execCommand("formatBlock", false, "blockquote");
  const editor = document.getElementById("forum-write-content");
  const sel = window.getSelection();
  if (editor && sel && sel.anchorNode) {
    let node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    while (node && node !== editor) {
      if (node.tagName === "BLOCKQUOTE") {
        node.classList.add("forum-rt-box");
        break;
      }
      node = node.parentElement;
    }
  }
  updateForumRichToolbarState();
});
document.getElementById("rt-quote-btn")?.addEventListener("click", () => {
  const editor = document.getElementById("forum-write-content");
  editor?.focus();
  const sel = window.getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString() : "";
  const html = `<blockquote>${escapeHtml(text) || "인용할 내용을 입력하세요"}</blockquote><p><br></p>`;
  forumRichExec("insertHTML", html);
});
document.getElementById("rt-image-btn")?.addEventListener("click", async () => {
  const res = await window.luna.forumUploadImage();
  if (res.ok) {
    forumRichExec("insertHTML", `<img src="${res.url}" style="max-width:100%;" /><p><br></p>`);
  } else if (!res.canceled) {
    showToast(res.error || "업로드 실패", "error");
  }
});
// 12차: 아래 있던 별도 "파일 첨부" 버튼을 툴바 안으로 옮김 - 이미지처럼 본문에 바로 끼워
//넣을 수 없는 일반 파일(zip 등)이라 여전히 글 상단에 따로 붙는 첨부 형태(forumAttachedFile)로
// 남지만, 버튼만 툴바로 합쳐서 아래쪽 첨부 줄을 없앰. 첨부되면 버튼 자체에 표시(활성 색 +
// 파일명 툴팁)를 줘서 별도 라벨 없이도 첨부 여부를 알 수 있게 함
document.getElementById("rt-file-btn")?.addEventListener("click", async () => {
  const res = await window.luna.forumUploadFile();
  if (res.ok) {
    forumAttachedFile = { url: res.url, name: res.name };
    const btn = document.getElementById("rt-file-btn");
    if (btn) {
      btn.classList.add("is-active");
      btn.dataset.tooltip = `파일 첨부됨: ${res.name} (다시 눌러 변경)`;
    }
    showToast(`"${res.name}" 파일을 첨부했어요`);
  } else if (!res.canceled) {
    showToast(res.error || "업로드 실패", "error");
  }
});

// ---- 11차 신규: 글에 내 프로필 공유 코드를 고정 첨부 ----------------------------
document.getElementById("forum-write-share-toggle")?.addEventListener("change", async (e) => {
  const select = document.getElementById("forum-write-share-select");
  if (!select) return;
  select.hidden = !e.target.checked;
  if (e.target.checked && !select.dataset.loaded) {
    const profiles = await window.luna.listProfiles();
    select.innerHTML = profiles.length
      ? profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.mcVersion)})</option>`).join("")
      : `<option value="">먼저 프로필을 만들어주세요</option>`;
    select.dataset.loaded = "1";
  }
});

// 코드로 다른 사람의 공유 프로필을 미리보기(설치 없이 이름/버전/모드·리소스팩·쉐이더 목록만 확인)
async function openSharedProfilePreview(code) {
  if (!code) return;
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `<div class="confirm-box shared-profile-preview-box"><div style="color:var(--text-2); font-size:12.5px;">불러오는 중...</div></div>`;
  document.body.appendChild(overlay);
  const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.dataset?.choice === "close") close();
  });

  const res = await window.luna.previewSharedProfile(code);
  const box = overlay.querySelector(".shared-profile-preview-box");
  if (!box) return;
  if (!res.ok) {
    box.innerHTML = `
      <div class="confirm-message">${escapeHtml(res.error || "불러오지 못했어요")}</div>
      <div class="confirm-actions"><button type="button" class="btn btn-ghost btn-small" data-choice="close">닫기</button></div>
    `;
    return;
  }
  const groupHtml = (label, files) =>
    files.length
      ? `<div class="shared-profile-preview-group">
          <div class="shared-profile-preview-group-title">${label} (${files.length})</div>
          <div class="shared-profile-preview-group-files">${files.map((f) => `<span class="shared-profile-preview-file">${escapeHtml(f)}</span>`).join("")}</div>
        </div>`
      : "";
  box.innerHTML = `
    <div class="shared-profile-preview-head">
      ${res.iconUrl ? `<img src="${res.iconUrl}" class="shared-profile-preview-icon" />` : `<div class="shared-profile-preview-icon shared-profile-preview-icon-fallback">${escapeHtml((res.name || "?").slice(0, 1))}</div>`}
      <div>
        <div class="shared-profile-preview-name">${escapeHtml(res.name)}</div>
        <div class="shared-profile-preview-meta">${escapeHtml(res.mcVersion)} · Nova${res.author ? ` · by ${escapeHtml(res.author)}` : ""}</div>
      </div>
    </div>
    <div class="shared-profile-preview-lists">
      ${groupHtml("모드", res.modFiles)}
      ${groupHtml("리소스팩", res.resourcepackFiles)}
      ${groupHtml("쉐이더팩", res.shaderFiles)}
    </div>
    <div class="confirm-actions">
      <button type="button" class="btn btn-ghost btn-small" data-choice="close">닫기</button>
      <button type="button" class="btn btn-fixed-green btn-small" id="btn-shared-profile-preview-import">이 프로필 불러오기</button>
    </div>
  `;
  box.querySelector("#btn-shared-profile-preview-import")?.addEventListener("click", async () => {
    const importRes = await window.luna.importProfile(code);
    if (importRes.ok) {
      showToast(`"${importRes.profile.name}" 프로필을 불러왔어요`);
      close();
    } else {
      showToast(importRes.error || "불러오기 실패", "error");
    }
  });
}

document.getElementById("btn-forum-submit")?.addEventListener("click", async () => {
  const title = document.getElementById("forum-write-title").value.trim();
  const contentEl = document.getElementById("forum-write-content");
  const content = sanitizeForumHtml(contentEl.innerHTML).trim();
  const category = document.getElementById("forum-write-category").value;
  const tag = document.getElementById("forum-write-tag").value || null;
  if (!title || !contentEl.textContent.trim()) {
    showToast("제목과 내용을 입력해주세요", "error");
    return;
  }
  // 24-11차: "카테고리를 미리 선택해두지 말고 직접 고르게" - 빈 플레이스홀더인 채로
  // 제출하려고 하면 막고 안내함
  if (!category) {
    showToast("카테고리를 선택해주세요", "error");
    return;
  }
  // 17차: "말머리 선택을 필수로" - 그 카테고리에 고를 수 있는 말머리가 있는데(행이 보이는 상태)
  // 아무것도 안 골랐으면 제출을 막음. 말머리 자체가 없는 카테고리(행이 숨겨짐)는 그대로 통과
  const tagRow = document.getElementById("forum-write-tag-row");
  if (tagRow && !tagRow.hidden && !tag) {
    showToast("말머리를 선택해주세요", "error");
    return;
  }

  // 12차: 글쓰기 창을 수정에도 재활용하면서, 수정 중이면 생성 대신 업데이트로 분기
  if (forumEditingPostId) {
    const id = forumEditingPostId;
    const res = await window.luna.forumUpdatePost({
      id,
      title,
      content,
      category,
      tag,
      // 수정 화면엔 공유 코드를 바꾸는 UI가 따로 없어서, 원래 붙어있던 코드를 그대로 유지해서
      // 보냄(안 보내면 서버에서 null로 지워짐)
      sharedProfileCode: forumEditingPostSharedCode || null,
    });
    if (res.ok) {
      showToast("수정했어요");
      forumEditingPostId = null;
      forumEditingPostSharedCode = null;
      openForumDetail(id);
    } else {
      showToast(res.error || "수정 실패", "error");
    }
    return;
  }

  let sharedProfileCode = null;
  const shareToggle = document.getElementById("forum-write-share-toggle");
  if (shareToggle?.checked) {
    const profileId = document.getElementById("forum-write-share-select")?.value;
    if (!profileId) {
      showToast("공유할 프로필을 선택해주세요", "error");
      return;
    }
    const shareRes = await window.luna.shareProfile(profileId);
    if (!shareRes.ok) {
      showToast(shareRes.error || "프로필 공유 코드 생성 실패", "error");
      return;
    }
    sharedProfileCode = shareRes.code;
  }
  const res = await window.luna.forumCreatePost({
    title,
    content,
    category,
    tag,
    imageUrl: forumAttachedImageUrl,
    attachmentUrl: forumAttachedFile?.url,
    attachmentName: forumAttachedFile?.name,
    sharedProfileCode,
  });
  if (res.ok) {
    showToast("게시글을 올렸어요");
    clearTimeout(forumDraftAutoSaveTimer);
    await window.luna.forumClearDraft?.(); // 17차: 게시 성공했으니 임시저장 글은 필요 없어짐
    openForumDetail(res.post.id);
  } else {
    showToast(res.error || "게시 실패", "error");
  }
});

// ---- 24-45차: 답글 작성 폼 공용 컴포넌트 -------------------------------------
// "답글 작성 폼도 닉네임/사진 첨부/등록 이런식으로 구성해주고" - 최상단 답글 입력창과
// 각 답글의 "답글쓰기"(대댓글) 입력창 둘 다 이 마크업/로직 하나를 공유해서 중복을 없앰.
function buildForumReplyComposerHtml(placeholder) {
  const myName = currentSiteAccount?.nickname || currentProfile?.name || "";
  // 24-46차: "글 쓰는 부분 박스 자체가 넘 크고 없어도 될 박스가 너무 많아" - 감싸는 카드
  // 박스를 없애고 위쪽 얇은 구분선만 남김, textarea는 꽉 찬 박스 대신 밑줄만, 사진 첨부
  // 버튼도 아이콘 박스(icon-btn) 대신 맨 아이콘만 남김. 남기는 박스는 "등록" 버튼 하나뿐
  // (실제로 누르는 동작이라 또렷한 게 맞음 - 로그인 화면 재작업 때와 같은 기준).
  return `
    <div class="forum-reply-composer">
      <div class="forum-reply-composer-head">
        <span class="forum-reply-composer-name">${escapeHtml(myName)}</span>
      </div>
      <textarea class="forum-reply-composer-textarea" placeholder="${escapeHtml(placeholder)}"></textarea>
      <div class="forum-reply-composer-foot">
        <button type="button" class="forum-reply-composer-attach-btn" title="사진 첨부">${FORUM_ATTACH_ICON_SVG}</button>
        <span class="forum-reply-composer-attach-name" hidden></span>
        <button type="button" class="btn btn-primary btn-small forum-reply-composer-submit">등록</button>
      </div>
    </div>
  `;
}
// root: 위 HTML이 채워진 컨테이너. postId/parentId는 forumCreateReply로 그대로 전달되고,
// onSubmitted는 성공적으로 답글이 올라간 뒤 호출됨(보통 openForumDetail로 새로고침)
function wireForumReplyComposer(root, { postId, parentId, onSubmitted }) {
  if (!root) return;
  let attachedImageUrl = null;
  const textarea = root.querySelector(".forum-reply-composer-textarea");
  const attachBtn = root.querySelector(".forum-reply-composer-attach-btn");
  const attachNameEl = root.querySelector(".forum-reply-composer-attach-name");
  const submitBtn = root.querySelector(".forum-reply-composer-submit");
  attachBtn?.addEventListener("click", async () => {
    const res = await window.luna.forumUploadImage();
    if (res.ok) {
      attachedImageUrl = res.url;
      attachBtn.classList.add("is-active");
      if (attachNameEl) {
        attachNameEl.hidden = false;
        attachNameEl.textContent = "사진 첨부됨";
      }
    } else if (!res.canceled) {
      showToast(res.error || "업로드 실패", "error");
    }
  });
  submitBtn?.addEventListener("click", async () => {
    const content = textarea.value.trim();
    if (!content && !attachedImageUrl) return;
    await withBusyButton(submitBtn, "등록 중...", async () => {
      const res = await window.luna.forumCreateReply(postId, parentId || null, content, attachedImageUrl);
      if (res.ok) {
        textarea.value = "";
        attachedImageUrl = null;
        onSubmitted?.();
      } else {
        // 24차: 하루 최대 답글 제한 등 실패 사유가 있어도 조용히 무시되던 문제 - 토스트로 보여줌
        showToast(res.error || "답글을 남기지 못했어요", "error");
      }
    });
  });
}

// 24-45차: 답글 "..." 더보기 메뉴 - 답글 목록이 새로고침될 때마다 다시 그려지므로, 메뉴마다
// 새로 document 리스너를 붙이면 열 때마다 계속 쌓임(메모리 누수). 대신 위임(delegation)
// 방식으로 딱 한 번만 등록해서, 몇 번을 다시 그려도 리스너는 항상 하나만 존재하게 함.
document.addEventListener("click", (e) => {
  const kebabBtn = e.target.closest(".forum-reply-kebab-btn");
  if (kebabBtn) {
    e.stopPropagation();
    const menu = kebabBtn.closest(".forum-reply-kebab-wrap")?.querySelector(".forum-reply-kebab-menu");
    document.querySelectorAll(".forum-reply-kebab-menu").forEach((m) => {
      if (m !== menu) m.hidden = true;
    });
    if (menu) menu.hidden = !menu.hidden;
    return;
  }
  if (!e.target.closest(".forum-reply-kebab-menu")) {
    document.querySelectorAll(".forum-reply-kebab-menu").forEach((m) => {
      m.hidden = true;
    });
  }
});

// ---- 글 상세 + 답글(대댓글 포함) + 좋아요 -------------------------------------
async function openForumDetail(postId) {
  forumCurrentPostId = postId;
  forumListPanel.hidden = true;
  forumWritePanel.hidden = true;
  forumDetailPanel.hidden = false;

  const container = document.getElementById("forum-detail-content");
  container.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">불러오는 중...</div>`;

  const { post, replies, liked } = await window.luna.forumGetPost(postId);
  if (!post) {
    container.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">게시글을 찾을 수 없어요</div>`;
    return;
  }

  const myUuid = currentProfile?.uuid || null;
  const isMine = !!myUuid && normalizeUuidForCompare(myUuid) === normalizeUuidForCompare(post.author_uuid);
  const isAdmin = await window.luna.isAdmin?.();

  container.innerHTML = `
    <div class="forum-detail-header">
      <span class="forum-post-category${post.category === "공지사항" ? " is-notice" : ""}">${post.category === "공지사항" ? "📢 " : ""}${post.category}</span>
      <div style="display:flex; gap:6px;">
        ${isAdmin ? `<button id="btn-forum-pin-post" class="btn btn-ghost btn-small" type="button">${post.pinned ? "고정 해제" : "고정"}</button>` : ""}
        ${!isMine && post.category !== "공지사항" && post.author_name !== FORUM_ADMIN_NAME ? `<button id="btn-forum-report-post" class="btn btn-ghost btn-small" type="button" data-post-id="${post.id}">${FORUM_REPORT_ICON_SVG} 신고</button>` : ""}
        ${isMine ? `<button id="btn-forum-edit-post" class="btn btn-ghost btn-small" type="button">수정</button>` : ""}
        ${isAdmin && !isMine ? `<button id="btn-forum-moderate-user" class="btn btn-ghost btn-small danger-text" type="button">제재</button>` : ""}
        ${isMine || isAdmin ? `<button id="btn-forum-delete-post" class="btn btn-ghost btn-small danger-text" type="button">삭제</button>` : ""}
      </div>
    </div>
    <div id="forum-view-mode">
      <!-- 24-11차: "공유 프로필 코드 안내를 제목 오른쪽으로" - 제목과 같은 줄에 나란히 두고,
           박스 테두리도 옅게 낮춤(style.css .forum-shared-profile-pin 참고) -->
      <div class="forum-detail-title-row">
        <div class="forum-detail-title">${post.pinned ? `<span class="forum-pin-badge" title="고정된 글">📌</span>` : ""}${forumTagChipHtml(post.tag)}${escapeHtml(post.title)}</div>
        ${post.shared_profile_code ? `
        <div class="forum-shared-profile-pin">
          <span class="forum-shared-profile-pin-icon">${FORUM_SHARED_PROFILE_ICON_SVG}</span>
          <span class="forum-shared-profile-pin-label">공유된 프로필 코드</span>
          <code class="forum-shared-profile-pin-code">${escapeHtml(post.shared_profile_code)}</code>
          <button type="button" class="btn btn-ghost btn-small" id="btn-shared-profile-copy">복사</button>
          <button type="button" class="btn btn-fixed-green btn-small" id="btn-shared-profile-preview">미리보기</button>
        </div>` : ""}
      </div>
      <div class="forum-detail-meta">
        <span class="forum-author-link" id="forum-detail-author">${escapeHtml(post.author_name)}${adminBadgeHtml(post.author_name)}</span>
        · ${FORUM_CALENDAR_ICON_SVG}${formatForumDate(post.created_at)}
        · <span title="조회수">👁 ${post.view_count || 0}</span>
      </div>
      ${post.image_url ? `<img class="forum-detail-image" src="${post.image_url}" />` : ""}
      ${post.attachment_url ? `<a href="#" class="forum-attachment-link" data-url="${post.attachment_url}">📎 ${escapeHtml(post.attachment_name || "첨부파일")}</a>` : ""}
      <div class="forum-detail-body" id="forum-detail-body"></div>
    </div>
    <div class="forum-detail-actions">
      <button id="forum-like-btn" class="btn btn-ghost btn-small forum-like-btn ${liked ? "is-liked" : ""}" type="button">♥ <span id="forum-like-count">${post.like_count}</span></button>
    </div>
    <div class="setting-section-title">답글</div>
    <div id="forum-reply-composer-root"></div>
    <div id="forum-reply-list" style="margin-top:10px;"></div>
  `;

  renderForumRichContent(document.getElementById("forum-detail-body"), post.content);
  container.querySelector(".forum-attachment-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.luna.openExternal?.(e.currentTarget.dataset.url);
  });
  document.getElementById("btn-shared-profile-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(post.shared_profile_code);
      showToast("코드를 복사했어요");
    } catch (_) {
      showToast("복사에 실패했어요", "error");
    }
  });
  document.getElementById("btn-shared-profile-preview")?.addEventListener("click", () => {
    openSharedProfilePreview(post.shared_profile_code);
  });
  document.getElementById("forum-detail-author")?.addEventListener("click", () => openForumUserPopup(post.author_uuid, post.author_name));
  document.getElementById("btn-forum-delete-post")?.addEventListener("click", async () => {
    const confirmed = await showConfirm("이 게시글을 삭제할까요?", "삭제", "취소");
    if (!confirmed) return;
    const res = await window.luna.forumDeletePost(post.id);
    if (res.ok) {
      showToast("삭제했어요");
      showForumList();
    }
  });
  document.getElementById("btn-forum-report-post")?.addEventListener("click", (e) => {
    openForumReportModal(post.id, post.title, e.currentTarget);
  });
  document.getElementById("btn-forum-moderate-user")?.addEventListener("click", () => {
    openForumModerateModal(post.author_uuid, post.author_name);
  });
  // 17차: 상세화면을 열 때 이미 신고한 글이면 신고 버튼을 처음부터 비활성화해둠
  window.luna.forumHasReported?.(post.id).then((already) => {
    if (already) markReportButtonAsReported(document.getElementById("btn-forum-report-post"));
  });
  document.getElementById("btn-forum-pin-post")?.addEventListener("click", async () => {
    const res = post.pinned ? await window.luna.forumUnpinPost(post.id) : await window.luna.forumPinPost(post.id);
    if (res.ok) {
      showToast(post.pinned ? "고정을 해제했어요" : "글을 고정했어요");
      openForumDetail(post.id);
    } else {
      showToast(res.error || "실패했어요", "error");
    }
  });
  // 12차: "수정도 글쓰기 창을 재활용해서 서식 기능들 쓸 수 있게 해달라" - 수정 버튼을 누르면
  // 이 상세화면 안에 따로 작은 편집 박스를 펴는 대신, 툴바가 있는 forum-write-panel을 그대로
  // 열고 기존 내용을 채워넣음(제출 시 forumEditingPostId가 있으면 생성 대신 수정으로 처리됨)
  document.getElementById("btn-forum-edit-post")?.addEventListener("click", async () => {
    forumEditingPostId = post.id;
    forumEditingPostSharedCode = post.shared_profile_code || null;
    forumDetailPanel.hidden = true;
    forumWritePanel.hidden = false;
    await resetForumWriteForm();
    // 17차: 수정 중엔 임시저장 대상이 아니므로(원본이 이미 있음) 버튼/상태 표시를 숨김
    const draftBtn = document.getElementById("btn-forum-draft-save");
    const draftStatusEl = document.getElementById("forum-draft-status");
    if (draftBtn) draftBtn.hidden = true;
    if (draftStatusEl) draftStatusEl.hidden = true;
    document.getElementById("btn-forum-submit").textContent = "수정 완료";
    document.getElementById("forum-write-title").value = post.title;
    // 11차 이전 순수 텍스트 글은 줄바꿈을 살려서(<br>) 채우고, 리치 텍스트 글은 그대로(새니타이즈해서) 채움
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(post.content || "");
    document.getElementById("forum-write-content").innerHTML = looksLikeHtml
      ? sanitizeForumHtml(post.content)
      : escapeHtml(post.content || "").replace(/\n/g, "<br>");
    document.getElementById("forum-write-category").value = post.category;
    await refreshForumTagSelect(post.category, "forum-write-tag-row", "forum-write-tag", post.tag);
  });
  document.getElementById("forum-like-btn")?.addEventListener("click", async () => {
    const res = await window.luna.forumToggleLike(post.id);
    if (res.ok) {
      document.getElementById("forum-like-btn").classList.toggle("is-liked", res.liked);
      document.getElementById("forum-like-count").textContent = res.likeCount;
    }
  });
  // 24-45차: 답글 입력창을 공용 컴포넌트(buildForumReplyComposerHtml/wireForumReplyComposer)로
  // 교체 - 위 답글 도움말대로 닉네임/사진첨부/등록 버튼으로 재구성됨
  const replyComposerRoot = document.getElementById("forum-reply-composer-root");
  if (replyComposerRoot) {
    replyComposerRoot.innerHTML = buildForumReplyComposerHtml("답글을 입력하세요");
    wireForumReplyComposer(replyComposerRoot, {
      postId: post.id,
      parentId: null,
      onSubmitted: () => openForumDetail(post.id), // 새로고침
    });
  }

  renderForumReplies(replies, post.id, myUuid, isAdmin);
}

// 24-5차: "내가 쓴 게시글 답변도 삭제/수정 가능하게 해줘" - 답글 목록을 그리는 이 함수도
// 게시글 상세(isMine/isAdmin)와 같은 기준으로 내가 쓴 답글엔 수정/삭제 버튼을, 관리자에겐
// (본인 게 아니어도) 삭제 버튼을 붙여야 해서 myUuid/isAdmin을 인자로 같이 받도록 함
function renderForumReplies(replies, postId, myUuid, isAdmin) {
  const listEl = document.getElementById("forum-reply-list");
  listEl.innerHTML = "";

  const topLevel = replies.filter((r) => !r.parent_id);
  const childrenOf = (id) => replies.filter((r) => r.parent_id === id);

  // 24-45차: 답글 UI 전면 개편(참고 이미지 1) - 작성자 줄 오른쪽에 "..." 더보기 메뉴로
  // 신고/수정/삭제를 몰아넣고, 아래쪽에 날짜/좋아요/답글쓰기를 한 줄로 두는 구성으로 바꿈.
  // "내가 쓴 글은 불투명도 조절해서 보기 쉽게"는 반투명하게 만드는 게 아니라(그러면 오히려
  // 더 안 보임) 옅은 강조 배경을 깔아서 눈에 잘 띄게 하는 쪽으로 해석해 .is-mine으로 처리함.
  function renderOne(reply, nested) {
    const el = document.createElement("div");
    const isMine = !!myUuid && normalizeUuidForCompare(myUuid) === normalizeUuidForCompare(reply.author_uuid);
    const canDelete = isMine || isAdmin;
    el.className = "forum-reply" + (nested ? " is-nested" : "") + (isMine ? " is-mine" : "");
    const menuItemsHtml = `
      ${!isMine && reply.reported_by_me ? `<span class="dropdown-select-item is-disabled-text">신고함</span>` : ""}
      ${!isMine && !reply.reported_by_me ? `<button type="button" class="dropdown-select-item forum-reply-report-item">${FORUM_REPORT_ICON_SVG} 신고하기</button>` : ""}
      ${isMine ? `<button type="button" class="dropdown-select-item forum-reply-edit-item">수정</button>` : ""}
      ${canDelete ? `<button type="button" class="dropdown-select-item danger-text forum-reply-delete-item">삭제</button>` : ""}
    `;
    el.innerHTML = `
      <div class="forum-reply-head">
        <span class="forum-author-link">${escapeHtml(reply.author_name)}${adminBadgeHtml(reply.author_name)}</span>
        ${menuItemsHtml.trim() ? `
        <div class="dropdown-select-wrap forum-reply-kebab-wrap">
          <button type="button" class="icon-btn icon-btn-tiny forum-reply-kebab-btn" title="더보기">${FORUM_REPLY_KEBAB_ICON_SVG}</button>
          <div class="dropdown-select-menu forum-reply-kebab-menu" hidden>${menuItemsHtml}</div>
        </div>` : ""}
      </div>
      <div class="forum-reply-body">${linkify(reply.content)}</div>
      ${reply.image_url ? `<img class="forum-reply-image" src="${reply.image_url}" />` : ""}
      <div class="forum-reply-edit-box forum-reply-input-row" hidden>
        <textarea class="forum-reply-edit-textarea"></textarea>
        <div class="forum-reply-edit-actions">
          <button class="forum-reply-plain-btn is-accent forum-reply-edit-save" type="button">저장</button>
          <button class="forum-reply-plain-btn forum-reply-edit-cancel" type="button">취소</button>
        </div>
      </div>
      <div class="forum-reply-foot">
        ${FORUM_CALENDAR_ICON_SVG}<span class="forum-reply-date">${formatForumDate(reply.created_at)}</span>
        <button type="button" class="forum-reply-like-btn${reply.liked_by_me ? " is-liked" : ""}">♥ <span class="forum-reply-like-count">${reply.like_count || 0}</span></button>
        <button type="button" class="forum-reply-btn">답글쓰기</button>
      </div>
      <div class="forum-nested-input" hidden></div>
    `;
    const bodyEl = el.querySelector(".forum-reply-body");
    const editBox = el.querySelector(".forum-reply-edit-box");
    const replyInputBox = el.querySelector(".forum-nested-input");
    replyInputBox.innerHTML = buildForumReplyComposerHtml("답글을 입력하세요");
    wireForumReplyComposer(replyInputBox, {
      postId,
      parentId: reply.id,
      onSubmitted: () => openForumDetail(postId),
    });
    el.querySelector(".forum-author-link").addEventListener("click", () => openForumUserPopup(reply.author_uuid, reply.author_name));
    el.querySelector(".forum-reply-btn").addEventListener("click", () => {
      const box = replyInputBox;
      const willOpen = box.hidden;
      // 8-12: 답글 입력창이 동시에 여러 개 열려있을 수 있던 문제 - 새로 하나를 열기 전에
      // 다른 답글 입력창들은 먼저 다 닫음(한 번에 하나만 열리게)
      if (willOpen) {
        listEl.querySelectorAll(".forum-nested-input").forEach((b) => {
          if (b !== box) b.hidden = true;
        });
        // 24-5차: 수정 입력창이 열려있는 채로 답글 입력창까지 같이 열리면 화면이 헷갈려서 같이 닫음
        if (!editBox.hidden) {
          editBox.hidden = true;
          bodyEl.hidden = false;
        }
      }
      box.hidden = !box.hidden;
    });
    // 24-45차: "답글 좋아요" - 게시글 좋아요 버튼(#forum-like-btn)과 같은 토글 방식
    el.querySelector(".forum-reply-like-btn")?.addEventListener("click", async () => {
      const res = await window.luna.forumToggleReplyLike(reply.id);
      if (res.ok) {
        const btn = el.querySelector(".forum-reply-like-btn");
        btn.classList.toggle("is-liked", res.liked);
        btn.querySelector(".forum-reply-like-count").textContent = res.likeCount;
      } else {
        showToast(res.error || "실패했어요", "error");
      }
    });
    // 24-5차: "내가 쓴 게시글 답변도 삭제/수정 가능하게 해줘" - 수정은 답글 본문 자리에
    // textarea를 펴서 그 자리에서 바로 고치는 방식(게시글처럼 별도 글쓰기 화면으로 옮기지
    // 않음 - 답글은 짧은 텍스트라 그 자리 수정이 더 자연스러움). 24-45차: 이제 이 버튼은
    // 인라인이 아니라 "..." 더보기 메뉴 안에 있으므로 열려있던 메뉴도 같이 닫아줌
    el.querySelector(".forum-reply-edit-item")?.addEventListener("click", () => {
      el.querySelector(".forum-reply-kebab-menu").hidden = true;
      listEl.querySelectorAll(".forum-nested-input").forEach((b) => { b.hidden = true; });
      const textarea = editBox.querySelector("textarea");
      textarea.value = reply.content;
      bodyEl.hidden = true;
      editBox.hidden = false;
      textarea.focus();
    });
    el.querySelector(".forum-reply-edit-cancel")?.addEventListener("click", () => {
      editBox.hidden = true;
      bodyEl.hidden = false;
    });
    el.querySelector(".forum-reply-edit-save")?.addEventListener("click", async () => {
      const textarea = editBox.querySelector("textarea");
      const content = textarea.value.trim();
      if (!content) return;
      const res = await window.luna.forumUpdateReply(reply.id, content);
      if (res.ok) {
        showToast("수정했어요");
        openForumDetail(postId);
      } else {
        showToast(res.error || "수정하지 못했어요", "error");
      }
    });
    // 24-45차 신규: "오른쪽 점점점 누르면 답글 신고하기" - 남이 쓴 답글에만 노출됨
    el.querySelector(".forum-reply-report-item")?.addEventListener("click", () => {
      el.querySelector(".forum-reply-kebab-menu").hidden = true;
      openForumReplyReportModal(reply.id, postId, reply.content);
    });
    el.querySelector(".forum-reply-delete-item")?.addEventListener("click", async () => {
      el.querySelector(".forum-reply-kebab-menu").hidden = true;
      const confirmed = await showConfirm("이 답글을 삭제할까요?", "삭제", "취소");
      if (!confirmed) return;
      const res = await window.luna.forumDeleteReply(reply.id);
      if (res.ok) {
        showToast("삭제했어요");
        openForumDetail(postId);
      } else {
        showToast(res.error || "삭제하지 못했어요", "error");
      }
    });
    listEl.appendChild(el);

    childrenOf(reply.id).forEach((child) => renderOne(child, true));
  }

  topLevel.forEach((r) => renderOne(r, false));
}

document.getElementById("btn-forum-detail-back")?.addEventListener("click", showForumList);

// ---- 유저 프로필 팝업 (닉네임/코인/작성글/전신 스킨) -----------------------------
const forumUserPopup = document.getElementById("forum-user-popup");
let forumUserPopupTarget = null; // { uuid, name } - 지금 보고 있는 사람
let forumUserPopupServer = null; // 14차: 그 사람이 지금 플레이 중인 서버(있으면 "참가하기" 노출)
// 24-61차: 이 img가 뜨거나(성공/실패 상관없이) 나면 로딩 스피너를 지움 - 팝업을 열 때마다
// 매번 새로 연결하면 리스너가 계속 쌓이므로, 이 팝업이 재사용되는 요소인 만큼 한 번만 연결
bindSkinLoadingSpinner(document.getElementById("forum-user-skin"), document.getElementById("forum-user-skin-spinner"));
// 17-1(4차): 다른 유저 프로필(포럼 작성자 팝업 + 친구 프로필 보기 - 둘 다 이 함수 하나를 씀)을
// 볼 때 예전 라운드에서 본인 프로필에 적용했던 "얼굴만 크롭 대신 전신 스킨 렌더" 수정이
// 여기엔 빠져 있었던 걸 동일하게 적용 - forum-user-head(얼굴 크롭) 완전히 제거하고
// forum-user-skin(전신 렌더) 하나로 통일. 목록 줄의 작은 아이콘(친구 목록, 게시글 목록
// 작성자 아이콘)은 이번 범위에서 제외 - 그대로 둠
// 14차: server 인자는 "이 친구가 지금 등록된 서버에서 플레이 중"일 때만 넘어옴(홈 친구
// 목록에서 바로 이 팝업으로 진입하는 경로 전용) - 넘어오면 "참가하기" 버튼도 같이 보여줌
async function openForumUserPopup(uuid, knownName, playing = null) {
  if (!uuid) {
    // 17-5(4차): 대상 uuid가 없는데도 팝업이 뜨는 걸 막음(알 수 없음 유저로 진입 방지)
    showToast("이 사용자 정보를 불러올 수 없어요", "error");
    return;
  }
  forumUserPopup.hidden = false;
  forumUserPopupTarget = null;
  forumUserPopupServer = playing; // 17차: 서버뿐 아니라 프로필 참가 정보도 여기 같이 담김({type, ...})
  const serverLineEl = document.getElementById("forum-user-server-line");
  const joinBtnEl = document.getElementById("btn-forum-user-join");
  if (playing && playing.type !== "profile-missing") {
    if (serverLineEl) { serverLineEl.textContent = `${playing.label} 플레이 중`; serverLineEl.hidden = false; }
    if (joinBtnEl) { joinBtnEl.hidden = false; joinBtnEl.textContent = "참가하기"; }
  } else if (playing && playing.type === "profile-missing") {
    // 같은 버전의 내 프로필이 없어서 바로 참가는 못하지만, 뭘 하는지는 보여줌
    if (serverLineEl) { serverLineEl.textContent = `${playing.label} 플레이 중`; serverLineEl.hidden = false; }
    if (joinBtnEl) { joinBtnEl.hidden = true; }
  } else {
    if (serverLineEl) serverLineEl.hidden = true;
    if (joinBtnEl) joinBtnEl.hidden = true;
  }
  // 9차: 이미 알고 있는 이름(글 작성자명/친구목록 이름)이 있으면 그걸 먼저 보여주고,
  // 서버에서 못 받아와도("알 수 없음") 이 이름으로 그대로 유지되게 함 - 아래 참고
  document.getElementById("forum-user-name").textContent = knownName || "불러오는 중...";
  document.getElementById("forum-user-coins").textContent = "-";
  document.getElementById("forum-user-postcount").textContent = "-";
  document.getElementById("forum-user-skin").src = "";
  document.getElementById("forum-user-bio").textContent = "";
  document.getElementById("forum-user-locked-msg").hidden = true;
  document.getElementById("forum-user-stats").hidden = false;
  document.getElementById("forum-user-actions").hidden = true;
  document.getElementById("forum-user-skin").hidden = false;
  const forumUserSkin3d = document.getElementById("forum-user-skin-3d");
  if (forumUserSkin3d) forumUserSkin3d.hidden = true;
  // 24-61차: 유저 정보(+스킨 렌더 URL)를 서버에서 받아오는 동안(아래 await) 빈 박스만
  // 보이지 않도록 스피너를 띄움 - 실제 스킨 img가 뜨면(load/error) 자동으로 지워짐
  showSkinLoadingSpinner(document.getElementById("forum-user-skin-spinner"));

  const info = await window.luna.forumGetUserInfo(uuid);
  if (!info) {
    forumUserPopup.hidden = true;
    showToast("이 사용자 정보를 불러올 수 없어요", "error");
    return;
  }
  // 9차 버그 수정: user_profiles에 아직 닉네임이 동기화 안 돼있으면(하트비트/코인 동기화가
  // 한 번도 안 된 신규/비활성 유저) 서버가 "알 수 없음"을 내려줬는데, 이미 알고 있는 이름
  // (글 작성자명/친구목록 이름)이 있으면 그걸 우선해서 "알 수 없음"으로 안 덮어씀
  const resolvedName = info.name && info.name !== "알 수 없음" ? info.name : knownName || info.name;
  // 24-23차: uuid/name은 예전 그대로 마인크래프트 캐릭터 기준(스킨/게시글용)이고,
  // novaAccountId/novaNickname이 새로 추가됨 - 친구 추가/귓속말은 이제 이 둘을 씀(마인크래프트
  // 캐릭터 이름이 아니라 진짜 노바 클라이언트 계정 기준이어야 하므로)
  forumUserPopupTarget = {
    uuid: info.uuid,
    name: resolvedName,
    novaAccountId: info.novaAccountId || null,
    novaNickname: info.novaNickname || null,
  };

  document.getElementById("forum-user-name").textContent = resolvedName;
  // 항상 전신 스킨 렌더를 보여줌 (crafatar 이미지가 먼저 뜨고, 성공하면 모자/망토까지
  // 그려지는 skinview3d 캔버스로 자연스럽게 바뀜)
  document.getElementById("forum-user-skin").src = info.skinRenderUrl || "";
  // 24-61차: 렌더 URL 자체가 없으면(드문 경우) img의 load/error가 안 뜰 수도 있어서 안전하게
  // 바로 지움 - 있으면 곧 img load/error가 알아서 지워줌
  if (!info.skinRenderUrl) {
    const spinnerEl = document.getElementById("forum-user-skin-spinner");
    if (spinnerEl) spinnerEl.hidden = true;
  }
  if (uuid) mountSkinViewer(document.getElementById("forum-user-skin-3d"), document.getElementById("forum-user-skin"), uuid, { w: 90, h: 140 });

  // 9차: 코인/작성글/자기소개를 친구가 아니어도 항상 공개로 보여주도록 바꿈(이전엔 친구가
  // 아니면 전부 잠갔었는데, 그건 의도한 게 아니었다는 피드백)
  document.getElementById("forum-user-stats").hidden = false;
  document.getElementById("forum-user-locked-msg").hidden = true;
  document.getElementById("forum-user-coins").textContent = info.coins ?? 0;
  document.getElementById("forum-user-postcount").textContent = info.postCount ?? 0;
  document.getElementById("forum-user-bio").textContent = info.bio || "";

  const isSelf = !!info.isSelf;
  const actionsEl = document.getElementById("forum-user-actions");
  actionsEl.hidden = isSelf;
  // 귓속말은 여전히 친구 사이에만 가능(별개 기능) - 친구가 아니면 친구 추가만 보여줌
  document.getElementById("btn-forum-user-whisper").hidden = !info.isFriend;
  document.getElementById("btn-forum-user-add-friend").hidden = !!info.isFriend;
}
document.getElementById("btn-forum-user-close")?.addEventListener("click", () => {
  forumUserPopup.hidden = true;
});
document.getElementById("btn-forum-user-postcount")?.addEventListener("click", () => {
  if (!forumUserPopupTarget) return;
  forumUserPopup.hidden = true;
  setForumAuthorFilter(forumUserPopupTarget.uuid, forumUserPopupTarget.name);
});
document.getElementById("btn-forum-user-add-friend")?.addEventListener("click", async () => {
  if (!forumUserPopupTarget) return;
  // 24-23차: 마인크래프트 캐릭터 이름이 아니라 이 사람의 진짜 노바 클라이언트 닉네임으로
  // 요청해야 함(둘이 다를 수 있음) - novaNickname이 없으면(연동된 노바 계정을 못 찾음) 애초에
  // friends:add를 부를 수가 없으므로 바로 안내만 하고 끝냄
  if (!forumUserPopupTarget.novaNickname) {
    showToast("아직 노바 클라이언트 계정과 연동되지 않은 사용자예요.", "error");
    return;
  }
  const res = await window.luna.friendsAdd(forumUserPopupTarget.novaNickname);
  if (res.ok) {
    showToast(res.accepted ? `${forumUserPopupTarget.novaNickname}님과 친구가 되었어요!` : `${forumUserPopupTarget.novaNickname}님에게 친구 요청을 보냈어요`);
    refreshFriends();
  } else {
    showToast(res.error || "친구 추가에 실패했어요.", "error");
  }
});
document.getElementById("btn-forum-user-whisper")?.addEventListener("click", () => {
  if (!forumUserPopupTarget || !forumUserPopupTarget.novaAccountId) return;
  forumUserPopup.hidden = true;
  // 24-23차: 귓속말은 이제 노바 계정 id 기준이라 forumUserPopupTarget.uuid(마인크래프트
  // uuid)가 아니라 novaAccountId를 넘겨야 함(whisper:send/list가 그 값을 기대함)
  openWhisperPopup(forumUserPopupTarget.novaAccountId, forumUserPopupTarget.novaNickname || forumUserPopupTarget.name);
});
// 14차: 기존 friend-status-popup의 "참가하기" 버튼과 동일한 로직 - 이 프로필 팝업으로 흡수됨
// 17차: 서버뿐 아니라 "같은 버전의 내 프로필로 참가"도 지원 - "우리 클라이언트에 있는 서버라면
// 그걸로 들어가고 아니라면 맞는 버전의 프로필을 골라서 들어갈 수 있게" 요청 반영
// 24-63차: "참가하기 누르면 PLAY를 누르는 게 아니라 참가하시겠습니까 이거 뜨게 해줘 누르면
// 바로 들어가지고" - 예전엔 여기서 서버/프로필 전환만 해주고 "PLAY를 눌러 참가하세요!"
// 토스트로 안내한 뒤 사용자가 직접 PLAY를 한 번 더 눌러야 했음. 이제 확인창을 먼저 띄우고,
// 확인하면 전환 후 곧바로 handlePlayClick()(PLAY 버튼과 100% 동일한 로직)을 호출해서
// 바로 게임이 시작되게 함
document.getElementById("btn-forum-user-join")?.addEventListener("click", async () => {
  const playing = forumUserPopupServer;
  if (!playing) return;
  forumUserPopup.hidden = true;
  const confirmed = await showConfirm(`${playing.label}에 참가하시겠습니까?`, "참가", "취소");
  if (!confirmed) return;
  if (isSwitchingLaunchTarget) return;
  setLaunchControlsLocked(true);
  try {
    if (playing.type === "server") {
      const res = await window.luna.selectServer(playing.server.id);
      if (res.ok) {
        if (serverChipName) serverChipName.textContent = res.server.name;
        updateMcVersionLabel(res.server.version);
        await refreshChipActiveStates();
        await refreshLaunchTargetLists(); // 24-48차: 반대쪽(프로필) 목록의 낡은 선택 표시도 같이 정리
      } else {
        showToast(res.error || "참가에 실패했어요.", "error");
        return;
      }
    } else if (playing.type === "profile") {
      const res = await window.luna.selectProfile(playing.profile.id);
      if (res.ok) {
        if (profileChipName) profileChipName.textContent = res.profile.name;
        updateMcVersionLabel(res.profile.mcVersion);
        await refreshChipActiveStates();
        await refreshLaunchTargetLists(); // 24-48차: 반대쪽(서버) 목록의 낡은 선택 표시도 같이 정리
      } else {
        showToast(res.error || "참가에 실패했어요.", "error");
        return;
      }
    }
  } finally {
    setLaunchControlsLocked(false);
  }
  await handlePlayClick();
});

// ---- 귓속말 (친구끼리만) ----------------------------------------------------
const whisperPopup = document.getElementById("whisper-popup");
const whisperMessageList = document.getElementById("whisper-message-list");
const whisperInput = document.getElementById("whisper-input");
let whisperTarget = null; // { uuid, name }
let whisperPollTimer = null;

// 24-53차: 스킨 공유 귓속말 마커 - whisper:send-skin(main.js)이 앞에 이 문자열을 붙여서 보냄
const SKIN_SHARE_MARKER = "NOVASKIN";
// 공유받은 스킨 데이터는 전체 dataUrl을 매번 HTML data-* 속성에 통째로 넣기엔 너무 커서(수십
// KB 텍스트), 메모리에 id로만 들고 있다가 버튼 클릭 시점에 조회하는 방식으로 처리
const receivedSkinShares = new Map(); // shareId -> { name, variant, dataUrl }
let skinShareIdSeq = 0;

function whisperMsgHtml(m) {
  const time = new Date(m.createdAt);
  const timeText = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  // 11-2: 마우스를 올렸을 때 시간만이 아니라 정확한 날짜까지 함께 보이도록 툴팁을 보강
  const dateText = `${time.getFullYear()}.${String(time.getMonth() + 1).padStart(2, "0")}.${String(time.getDate()).padStart(2, "0")} ${timeText}`;
  const cls = `whisper-msg${m.fromMe ? " is-mine" : ""}`;

  if (typeof m.message === "string" && m.message.startsWith(SKIN_SHARE_MARKER)) {
    try {
      const payload = JSON.parse(m.message.slice(SKIN_SHARE_MARKER.length));
      const shareId = `share-${++skinShareIdSeq}`;
      receivedSkinShares.set(shareId, payload);
      return `
        <div class="${cls} whisper-msg-skin-share" title="${escapeHtml(dateText)}">
          <img class="whisper-skin-share-thumb" src="${payload.dataUrl}" alt="${escapeHtml(payload.name)}" />
          <div class="whisper-skin-share-info">
            <span class="whisper-skin-share-name">${escapeHtml(payload.name)}</span>
            <div class="whisper-skin-share-actions">
              <button type="button" class="btn btn-ghost btn-small whisper-skin-share-download" data-share-id="${shareId}">다운로드</button>
              ${m.fromMe ? "" : `<button type="button" class="btn btn-primary btn-small whisper-skin-share-apply" data-share-id="${shareId}">적용</button>`}
            </div>
          </div>
        </div>
      `;
    } catch (_) {
      // 파싱 실패하면 그냥 평범한 텍스트로 폴백
    }
  }

  return `<div class="${cls}" title="${escapeHtml(dateText)}">${escapeHtml(m.message)}</div>`;
}

// 스킨 공유 말풍선의 다운로드/적용 버튼 - 목록이 매번 innerHTML로 통째로 다시 그려지므로
// (loadWhisperMessages) 개별 리스너 대신 위임(delegation)으로 한 번만 등록
document.addEventListener("click", async (e) => {
  const dlBtn = e.target.closest?.(".whisper-skin-share-download");
  if (dlBtn) {
    const payload = receivedSkinShares.get(dlBtn.dataset.shareId);
    if (!payload) return;
    const res = await window.luna.downloadSharedSkin(payload.dataUrl, payload.name);
    if (res.ok) showToast("스킨 파일을 저장했어요");
    else if (!res.canceled) showToast(res.error || "다운로드에 실패했어요", "error");
    return;
  }
  const applyBtn = e.target.closest?.(".whisper-skin-share-apply");
  if (applyBtn) {
    const payload = receivedSkinShares.get(applyBtn.dataset.shareId);
    if (!payload) return;
    applyBtn.disabled = true;
    const res = await window.luna.applySharedSkin(payload.dataUrl, payload.variant, payload.name);
    applyBtn.disabled = false;
    if (res.ok) {
      showToast(`${payload.name} 스킨을 적용했어요`);
      loadCustomSkinsList?.();
      loadSkinHistoryList?.();
    } else {
      showToast(res.error || "스킨 적용에 실패했어요", "error");
    }
  }
});

async function loadWhisperMessages(scrollToBottom) {
  if (!whisperTarget) return;
  const messages = await window.luna.whisperList(whisperTarget.uuid);
  if (!whisperTarget) return; // 그 사이에 닫혔으면 무시
  whisperMessageList.innerHTML = messages.length
    ? messages.map(whisperMsgHtml).join("")
    : `<div class="whisper-empty">아직 대화가 없어요. 먼저 인사해보세요!</div>`;
  if (scrollToBottom) whisperMessageList.scrollTop = whisperMessageList.scrollHeight;
  // 15-6(6차): 대화를 여는/새로고침하는 시점마다 "읽음" 시각을 갱신해둠 -> 친구 목록의
  // 빨간 안읽음 점은 그 이후에 도착한 귓속말이 있을 때만 다시 뜸
  window.luna.whisperMarkRead?.(whisperTarget.uuid);
}

function openWhisperPopup(uuid, name) {
  // 게임이 실행 중일 땐 귓속말 창을 띄우지 않음(플레이 나가면 자동으로 닫힘 - setInGameUiState 참고)
  if (isInGame) return;
  whisperTarget = { uuid, name };
  // 9차: 영어일 때는 "Whisper - name"으로 보이게 i18n 키를 씀
  document.getElementById("whisper-popup-title").textContent = `${window.NovaI18n?.t?.("whisper_title_prefix") || "귓속말"} - ${name}`;
  whisperMessageList.innerHTML = `<div class="whisper-empty">불러오는 중...</div>`;
  whisperPopup.hidden = false;
  loadWhisperMessages(true);
  clearInterval(whisperPollTimer);
  whisperPollTimer = setInterval(() => loadWhisperMessages(false), 4000);
  whisperInput.value = "";
  whisperInput.focus();
  // 방금 이 친구 항목의 빨간 안읽음 점을 봤을 테니 바로 지워줌 (다음 refreshFriends를
  // 기다리지 않고 즉시 반응하도록)
  document.querySelector(`.friend-row[data-whisper-uuid="${uuid}"] .friend-row-unread-dot`)?.remove();
}

function closeWhisperPopup() {
  whisperPopup.hidden = true;
  whisperTarget = null;
  clearInterval(whisperPollTimer);
}

document.getElementById("btn-whisper-close")?.addEventListener("click", closeWhisperPopup);

async function submitWhisper() {
  const text = whisperInput.value.trim();
  if (!text || !whisperTarget) return;
  whisperInput.value = "";
  const res = await window.luna.whisperSend(whisperTarget.uuid, text);
  if (res.ok) {
    await loadWhisperMessages(true);
  } else {
    showToast(res.error || "전송에 실패했어요.", "error");
  }
}
document.getElementById("btn-whisper-send")?.addEventListener("click", submitWhisper);
whisperInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitWhisper();
});

// ---- Explore: 모드린스에서 모드/리소스팩 검색+설치 ----------------------------
const exploreOverlay = document.getElementById("view-explore");
const exploreListPanel = document.getElementById("explore-list-panel");
const exploreDetailPanel = document.getElementById("explore-detail-panel");
const exploreResults = document.getElementById("explore-results");
const exploreSearchInput = document.getElementById("explore-search-input");
const exploreProfileList = document.getElementById("explore-profile-list");
let exploreCurrentType = "mod";
let exploreCurrentProfile = null; // { id, name, mcVersion }
let exploreSearchTimer = null;
let exploreDetailItem = null;
// 24-14차: "모드 보기에서 버전에서 릴리스만 볼지 베타도 다 볼지 고르게 해주고 기본은 릴리스만" -
// 기본은 릴리스만(false), 체크하면 베타/알파도 같이 보여줌. 토글이 바뀌면 마지막으로 그렸던
// item/profile 기준으로 다시 그려야 해서 컨텍스트를 같이 저장해둠
let modVersionShowBeta = false;
let modVersionListCtx = { item: null, profile: null };

// explore 타입("mod"/"resourcepack"/"shader")을 실제 프로필 폴더 종류로 변환
function explKindOf(type) {
  if (type === "mod") return "mods";
  if (type === "shader") return "shaderpacks";
  return "resourcepacks";
}

document.querySelector('.sidebar-icon[data-panel="explore"]')?.addEventListener("click", async () => {
  if (isSidebarPanelAlreadyActive("explore")) return;
  setActiveSidebarIcon("explore");
  await ensureExploreProfileOptions();
  updateExploreSidebarForType();
  showAppPanel("view-explore");
  showExploreList();
});

function showExploreList() {
  exploreListPanel.hidden = false;
  exploreDetailPanel.hidden = true;
  runExploreSearch();
}

// 왼쪽 "프로필" 선택 - 박스 목록에서 골라서 클릭, 여기서 고른 프로필의 마인크래프트 버전이 그대로 검색/설치 기준이 됨
async function ensureExploreProfileOptions() {
  const profiles = await window.luna.listProfiles();
  exploreProfileList.innerHTML = "";

  if (profiles.length === 0) {
    exploreProfileList.innerHTML = `<div style="color:var(--text-2); font-size:12px;">먼저 Install에서 프로필을 만들어주세요</div>`;
    exploreCurrentProfile = null;
    return;
  }

  const selected = profiles.find((p) => p.selected) || profiles[0];
  exploreCurrentProfile = selected;

  profiles.forEach((p) => {
    const item = document.createElement("div");
    item.className = "version-item" + (p.id === selected.id ? " is-active" : "");
    item.innerHTML = `<b>${p.name}</b><span>${p.mcVersion}</span>`;
    item.addEventListener("click", () => {
      exploreProfileList.querySelectorAll(".version-item").forEach((i) => i.classList.remove("is-active"));
      item.classList.add("is-active");
      exploreCurrentProfile = p;
      exploreCurrentPage = 1;
      runExploreSearch();
    });
    exploreProfileList.appendChild(item);
  });
}

// 5-11(7차): 프로필 관리 화면의 "Browse content" - Explore로 이동하되, 지금 편집 중인
// 프로필(전역 "선택된" 프로필과 다를 수 있음) + 지금 보고 있던 탭(모드/리소스팩/쉐이더)로
// 미리 필터링해서 딜어감 (참고 스크린샷의 "프리필터된 Browse content" 동작)
async function openExploreScopedToProfile(profileId, kind) {
  const profiles = await window.luna.listProfiles();
  exploreProfileList.innerHTML = "";

  if (profiles.length === 0) {
    exploreProfileList.innerHTML = `<div style="color:var(--text-2); font-size:12px;">먼저 Install에서 프로필을 만들어주세요</div>`;
    exploreCurrentProfile = null;
  } else {
    const target = profiles.find((p) => p.id === profileId) || profiles.find((p) => p.selected) || profiles[0];
    exploreCurrentProfile = target;
    profiles.forEach((p) => {
      const item = document.createElement("div");
      item.className = "version-item" + (p.id === target.id ? " is-active" : "");
      item.innerHTML = `<b>${p.name}</b><span>${p.mcVersion}</span>`;
      item.addEventListener("click", () => {
        exploreProfileList.querySelectorAll(".version-item").forEach((i) => i.classList.remove("is-active"));
        item.classList.add("is-active");
        exploreCurrentProfile = p;
        exploreCurrentPage = 1;
        runExploreSearch();
      });
      exploreProfileList.appendChild(item);
    });
  }

  if (kind) {
    const type = explTypeOf(kind);
    document.querySelectorAll(".explore-type-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.type === type));
    updateExploreKindTabsPill(true);
    exploreCurrentType = type;
    renderExploreCategoryChips();
  }

  setActiveSidebarIcon("explore");
  updateExploreSidebarForType();
  showAppPanel("view-explore");
  exploreCurrentPage = 1;
  showExploreList();
}
// explore 타입 방향의 역변환("mods"/"resourcepacks"/"shaderpacks" -> "mod"/"resourcepack"/"shader")
function explTypeOf(kind) {
  if (kind === "mods") return "mod";
  if (kind === "shaderpacks") return "shader";
  return "resourcepack";
}

// 7-5: 드롭다운이 아니라 항상 보이는 탭 버튼 행으로 종류(모드/리소스팩/쉐이더)를 고름
// 6차: 탭 배경이 스냅 대신 슬라이드되도록 pill 헬퍼를 붙임
const exploreKindTabsPill = mountSlidingPill(document.getElementById("explore-kind-tabs"), "slide-pill-explore-kind");
function updateExploreKindTabsPill(instant) {
  const active = document.querySelector("#explore-kind-tabs .explore-type-tab.is-active");
  exploreKindTabsPill.update(active, instant);
}
// 10차 신규: 모드팩 탭에서는 "지금 프로필 고르기" 사이드바가 의미가 없음(설치하면 새
// 프로필이 통째로 만들어지므로) - 그 자리를 안내 문구로 바꿔 보여줌
function updateExploreSidebarForType() {
  const isModpack = exploreCurrentType === "modpack";
  const profileListEl = document.getElementById("explore-profile-list");
  const noticeEl = document.getElementById("explore-modpack-notice");
  if (profileListEl) profileListEl.hidden = isModpack;
  if (noticeEl) noticeEl.hidden = !isModpack;
  // 24-14차: "모드에서 클라이언트 모드만 따로 볼 수 있게" - 이 필터는 모드 탭에서만 의미가 있음
  const clientOnlyFilterEl = document.getElementById("explore-client-only-filter");
  if (clientOnlyFilterEl) clientOnlyFilterEl.hidden = exploreCurrentType !== "mod";
}

// 16차: "프로필 추가" 팝업의 "모드팩 찾기"를 고르면 Contents(Explore)의 모드팩 탭으로
// 바로 이동시킴 - 사이드바 explore 아이콘 클릭 핸들러와 같은 절차를 모드팩 탭 고정으로 재사용
async function openExploreModpackTab() {
  document.querySelectorAll(".explore-type-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.type === "modpack"));
  updateExploreKindTabsPill(true);
  exploreCurrentType = "modpack";
  exploreCurrentPage = 1;
  renderExploreCategoryChips();
  setActiveSidebarIcon("explore");
  await ensureExploreProfileOptions();
  updateExploreSidebarForType();
  showAppPanel("view-explore");
  showExploreList();
}

document.querySelectorAll(".explore-type-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("is-active")) return;
    document.querySelectorAll(".explore-type-tab").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    updateExploreKindTabsPill();
    exploreCurrentType = btn.dataset.type;
    exploreCurrentPage = 1;
    renderExploreCategoryChips();
    updateExploreSidebarForType();
    runExploreSearch();
  });
});

// 7-7: 종류별 카테고리 필터 칩 (Modrinth 카테고리 택소노미 기준으로 대표적인 값만 추림)
// 13차: "모드 세부 카테고리가 영어로 안 바뀐다" - label을 고정 한국어 문자열 대신
// i18n 키(labelKey)로 바꾸고, 렌더링할 때 t()로 옮김. labelKey가 없으면(예: 16x/32x 같은
// 숫자 표기는 번역이 필요 없음) label을 그대로 씀.
const EXPLORE_CATEGORIES_BY_TYPE = {
  mod: [
    { id: "adventure", labelKey: "explore_cat_adventure", label: "어드벤처" },
    { id: "technology", labelKey: "explore_cat_technology", label: "기술" },
    { id: "magic", labelKey: "explore_cat_magic", label: "마법" },
    { id: "decoration", labelKey: "explore_cat_decoration", label: "꾸미기" },
    { id: "storage", labelKey: "explore_cat_storage", label: "인벤토리" },
    { id: "utility", labelKey: "explore_cat_utility", label: "유틸리티" },
    { id: "optimization", labelKey: "explore_cat_optimization", label: "최적화" },
    { id: "food", labelKey: "explore_cat_food", label: "음식" },
  ],
  // 14차: "쉐이더는 하위 카테고리 없애줘" - 목록을 비워서 칩 자체가 안 뜨게 함
  // (renderExploreCategoryChips가 빈 목록이면 컨테이너까지 통째로 숨김)
  shader: [],
  resourcepack: [
    { id: "16x", label: "16x" },
    { id: "32x", label: "32x" },
    { id: "64x", label: "64x" },
    { id: "128x", label: "128x" },
    { id: "realistic", labelKey: "explore_cat_realistic", label: "사실적" },
    { id: "vanilla-like", labelKey: "explore_cat_vanillastyle", label: "바닐라풍" },
    { id: "themed", labelKey: "explore_cat_theme", label: "테마" },
  ],
};
// 5-6(5차): "카테고리 칩을 그래픽으로 바꿔줘" - 텍스트만 있던 칩에 간단한 단색 라인 아이콘을
// 붙여줌. 앱 다른 곳(saa-chevron 등)과 톤을 맞춰 stroke 기반 24x24 아이콘으로 통일.
const EXPLORE_CATEGORY_ICON_PATHS = {
  // 12차: 기존 방패+별 모양이 다른 카테고리 아이콘과 헷갈린다는 지적 - 탐험을 더 직관적으로
  // 나타내는 나침반 모양으로 교체
  adventure: '<circle cx="12" cy="12" r="9"/><path d="M15.3 8.7 13.6 13.6 8.7 15.3 10.4 10.4 15.3 8.7Z"/>',
  // 24-14차: "마법, 기술 아이콘 바꿔줘" - 10차의 톱니바퀴 아이콘이 설정 사이드바 아이콘(원+스포크)과
  // 너무 비슷해 헷갈린다는 지적으로 판단, 기술다운 느낌은 유지하면서 확실히 다른 모양인
  // 회로기판/칩 아이콘으로 교체
  technology: '<rect x="8" y="8" width="8" height="8" rx="1.2"/><path d="M8 4v3M12 4v3M16 4v3M8 17v3M12 17v3M16 17v3M4 8h3M4 12h3M4 16h3M17 8h3M17 12h3M17 16h3" stroke-linecap="round"/>',
  // 24-14차: 이전 스파클 2개 조합이 상점의 "테마" 배지(격자) 및 태그 칩과 톤이 비슷해 눈에 안
  // 띈다는 지적 - 마법지팡이+반짝임으로 바꿔서 한눈에 "마법" 카테고리로 알아볼 수 있게 함
  magic: '<path d="M4.5 19.5 15 9" stroke-linecap="round"/><path d="M17.2 2.6c.35 1.5.8 1.95 2.3 2.3-1.5.35-1.95.8-2.3 2.3-.35-1.5-.8-1.95-2.3-2.3 1.5-.35 1.95-.8 2.3-2.3Z"/><path d="M20 10.4c.22.9.48 1.16 1.4 1.4-.92.24-1.18.5-1.4 1.4-.22-.9-.48-1.16-1.4-1.4.92-.24 1.18-.5 1.4-1.4Z"/>',
  // 16차: "꾸미기 하위 카테고리 아이콘 바꿔줘" - 예전 아이콘이 연필(수정) 아이콘처럼 보여서
  // 헷갈린다는 지적 - 액자/그림을 나타내는 아이콘으로 교체(꾸미기 모드에 흔한 액자류를 연상시킴)
  decoration: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-4 4-2-2-5 5" stroke-linecap="round" stroke-linejoin="round"/>',
  storage: '<path d="M3 8.5 12 4l9 4.5v8L12 21l-9-4.5v-8Z"/><path d="M3 8.5 12 13l9-4.5"/><path d="M12 13v8"/>',
  utility: '<path d="M4 6h16M4 6a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z"/><path d="M4 12h16M14 12a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z"/><path d="M4 18h16M8 18a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z"/>',
  optimization: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l5-5"/><path d="M12 12 8 15"/>',
  food: '<path d="M12 8c-3.5 0-6 3-6 7 0 3 2 6 4 6s1.5-1 2-1 1 1 2 1 4-3 4-6c0-4-2.5-7-6-7Z"/><path d="M12 8c0-2 1-3.5 2.5-4"/>',
  fantasy: '<path d="M4 8l3 3 5-6 5 6 3-3-2 10H6L4 8Z"/><path d="M6 18h12"/>',
  realistic: '<path d="M3 18l6-9 4 5 2-3 6 7H3Z"/><circle cx="8" cy="7" r="2"/>',
  "vanilla-like": '<path d="M4 7 12 3l8 4v10l-8 4-8-4V7Z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  cursed: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.5 4.5 2 6h10c.5-1.5 2-3 2-6a7 7 0 0 0-7-7Z"/><circle cx="9.5" cy="10" r="1.3"/><circle cx="14.5" cy="10" r="1.3"/><path d="M9 20h6"/>',
  "low-end": '<rect x="3" y="8" width="15" height="8" rx="1.5"/><path d="M20 10.5v3"/><path d="M6 11v2"/>',
  "high-end": '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  // 9차 버그 수정: 64x/128x 아이콘이 13px로 작게 렌더될 때 선이 4~5줄씩 겹쳐서 뭉개져
  // 안 보이는 문제가 있었음 - 32x와 같은 3x3 격자(선 2개)로 격자 밀도를 통일해서 항상
  // 또렷하게 보이게 함(해상도 구분은 옆에 같이 붙는 "64x"/"128x" 글자로 이미 충분히 됨)
  "16x": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h16M12 4v16"/>',
  "32x": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  "64x": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  "128x": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  themed: '<path d="M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6V4a1.4 1.4 0 0 1 1.4-1.4h8.6Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
};
function exploreCategoryIconSvg(id) {
  const path = EXPLORE_CATEGORY_ICON_PATHS[id];
  if (!path) return "";
  // 9차: 아이콘이 13px로 너무 작게 보여서 얇은 선들이 잘 안 보인다는 피드백 - 선 두께를 살짝 키움
  // (실제 렌더 크기는 style.css의 .explore-category-chip-icon에서 13px -> 15px로 같이 키움)
  return `<svg class="explore-category-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
let exploreSelectedCategories = [];
function renderExploreCategoryChips() {
  const chipsEl = document.getElementById("explore-category-chips");
  if (!chipsEl) return;
  exploreSelectedCategories = [];
  chipsEl.innerHTML = "";
  const list = EXPLORE_CATEGORIES_BY_TYPE[exploreCurrentType] || [];
  // 14차: 하위 카테고리가 없는 종류(쉐이더)는 구분선까지 포함해서 컨테이너 자체를 숨김
  chipsEl.hidden = list.length === 0;
  list.forEach((cat) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "explore-category-chip";
    const catLabel = cat.labelKey ? window.NovaI18n?.t?.(cat.labelKey) || cat.label : cat.label;
    chip.innerHTML = `${exploreCategoryIconSvg(cat.id)}<span>${escapeHtml(catLabel)}</span>`;
    chip.dataset.category = cat.id;
    // 4-5: 여러 개를 동시에 고를 수 있던 것(체크박스 방식)을 라디오 버튼처럼 하나만 고를 수 있게 바꿈.
    // 이미 선택된 칩을 다시 누르면 선택 해제(전체 보기)됨
    chip.addEventListener("click", () => {
      const wasActive = chip.classList.contains("is-active");
      chipsEl.querySelectorAll(".explore-category-chip.is-active").forEach((c) => c.classList.remove("is-active"));
      if (!wasActive) chip.classList.add("is-active");
      exploreSelectedCategories = Array.from(chipsEl.querySelectorAll(".explore-category-chip.is-active")).map(
        (c) => c.dataset.category
      );
      exploreCurrentPage = 1;
      runExploreSearch();
    });
    chipsEl.appendChild(chip);
  });
}
renderExploreCategoryChips();

// 7-4: 페이지네이션 상태
// 4-1: 이전/다음 버튼만 있던 걸 번호 매김(1~10, 화살표로 다음 10개 묶음) 방식으로 교체
let exploreCurrentPage = 1;
let exploreTotalPages = 1;
const EXPLORE_PAGE_GROUP_SIZE = 10;
document.getElementById("explore-page-group-prev")?.addEventListener("click", () => {
  const groupStart = Math.floor((exploreCurrentPage - 1) / EXPLORE_PAGE_GROUP_SIZE) * EXPLORE_PAGE_GROUP_SIZE;
  if (groupStart <= 0) return;
  exploreCurrentPage = groupStart; // 이전 묶음의 마지막 페이지로 이동
  runExploreSearch();
});
document.getElementById("explore-page-group-next")?.addEventListener("click", () => {
  const groupStart = Math.floor((exploreCurrentPage - 1) / EXPLORE_PAGE_GROUP_SIZE) * EXPLORE_PAGE_GROUP_SIZE;
  const nextGroupFirstPage = groupStart + EXPLORE_PAGE_GROUP_SIZE + 1;
  if (nextGroupFirstPage > exploreTotalPages) return;
  exploreCurrentPage = nextGroupFirstPage;
  runExploreSearch();
});
function renderExplorePagination() {
  const wrap = document.getElementById("explore-pagination");
  const numbersEl = document.getElementById("explore-page-numbers");
  const prevGroupBtn = document.getElementById("explore-page-group-prev");
  const nextGroupBtn = document.getElementById("explore-page-group-next");
  if (!wrap || !numbersEl) return;
  wrap.hidden = exploreTotalPages <= 1;

  const groupStart = Math.floor((exploreCurrentPage - 1) / EXPLORE_PAGE_GROUP_SIZE) * EXPLORE_PAGE_GROUP_SIZE + 1;
  const groupEnd = Math.min(exploreTotalPages, groupStart + EXPLORE_PAGE_GROUP_SIZE - 1);

  numbersEl.innerHTML = "";
  for (let p = groupStart; p <= groupEnd; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "explore-page-num" + (p === exploreCurrentPage ? " is-active" : "");
    btn.textContent = String(p);
    btn.addEventListener("click", () => {
      if (p === exploreCurrentPage) return;
      exploreCurrentPage = p;
      runExploreSearch();
    });
    numbersEl.appendChild(btn);
  }

  if (prevGroupBtn) prevGroupBtn.disabled = groupStart <= 1;
  if (nextGroupBtn) nextGroupBtn.disabled = groupEnd >= exploreTotalPages;
}
exploreSearchInput?.addEventListener("input", () => {
  clearTimeout(exploreSearchTimer);
  exploreSearchTimer = setTimeout(() => {
    exploreCurrentPage = 1; // 새 검색어를 입력하면 1페이지부터 다시 봄
    runExploreSearch();
  }, 400); // 타이핑 멈추고 0.4초 후 검색
});
// 17차 신규: 정렬 기준 선택 (다운로드순 고정이었던 걸 골라서 바꿀 수 있게)
document.getElementById("explore-sort-select")?.addEventListener("change", () => {
  exploreCurrentPage = 1;
  runExploreSearch();
});
// 24-14차: "클라이언트 모드만 따로 볼 수 있게"
document.getElementById("explore-client-only-check")?.addEventListener("change", () => {
  exploreCurrentPage = 1;
  runExploreSearch();
});

// 모드를 설치하기 전에, 그 버전이 필요로 하는 하위 모드(dependency)가 있고 아직 안 깔려있으면
// 물어보고 같이 설치함 (Fabric API 같은 걸 깜빡해서 게임이 안 켜지는 상황 방지)
// 24-14차: "쉐이더 깔 때 필수인 모드 있으면 추가할 거냐고 메시지 주고 리소스팩도 필요한 게
// 있다면 해줘" - 예전엔 이 검사를 모드 설치할 때만 했음. 쉐이더/리소스팩 버전도 Modrinth에
// dependencies가 실려오면 똑같이 검사하도록 kind 제한을 없앰. 다만 실제로 필요한 하위 항목은
// (Iris/Optifine처럼) 거의 항상 "모드"라서, 검사/설치 대상 kind는 항상 "mods"로 고정함
// (원래 모드 설치 흐름에서는 kind가 이미 "mods"라 동작이 그대로임)
async function installWithDependencies(profile, kind, item, version) {
  const deps = version.dependencies || [];
  const depKind = "mods";
  const missing = [];
  for (const dep of deps) {
    const check = await window.luna.exploreCheckInstalled(profile.id, depKind, dep.projectId);
    if (!check.installed) missing.push(dep);
  }

  if (missing.length > 0) {
    const depProjects = await Promise.all(missing.map((d) => window.luna.exploreGetProject(d.projectId)));
    const names = depProjects.filter(Boolean).map((p) => p.title);
    if (names.length > 0) {
      const proceed = await showConfirm(
        `"${item.title}"에 필요한 하위 모드가 있어요: ${names.join(", ")}. 같이 다운로드할까요?`,
        "같이 설치",
        "이것만 설치"
      );
      if (proceed) {
        for (let i = 0; i < missing.length; i++) {
          const dep = missing[i];
          const proj = depProjects[i];
          if (!proj) continue;
          const depVersions = await window.luna.exploreGetVersions(dep.projectId, profile.mcVersion, "mod");
          const depVersion =
            (dep.versionId && depVersions.find((v) => v.id === dep.versionId)) ||
            depVersions.find((v) => v.versionType === "release") ||
            depVersions[0];
          if (!depVersion) continue;
          await window.luna.exploreInstall({
            profileId: profile.id,
            kind: depKind,
            fileUrl: depVersion.fileUrl,
            fileName: depVersion.fileName,
            projectId: dep.projectId,
            projectTitle: proj.title,
            icon: proj.icon,
            author: proj.author,
            versionId: depVersion.id,
            versionNumber: depVersion.versionNumber,
          });
        }
      }
    }
  }

  return window.luna.exploreInstall({
    profileId: profile.id,
    kind,
    fileUrl: version.fileUrl,
    fileName: version.fileName,
    projectId: item.id,
    projectTitle: item.title,
    icon: item.icon,
    author: item.author,
    versionId: version.id,
    versionNumber: version.versionNumber,
  });
}

async function runExploreSearch() {
  exploreResults.innerHTML = `<div style="color:var(--text-2); font-size:12.5px; padding:12px;">검색 중...</div>`;
  const pagEl = document.getElementById("explore-pagination");
  if (pagEl) pagEl.hidden = true;
  // 10차 신규(모드팩): 모드팩은 "이 프로필의 버전"이라는 기준이 없음 (설치하면 새 프로필이
  // 통째로 만들어지니까) - 검색할 때 버전 필터를 걸지 않고 전체를 보여줌
  const gameVersion = exploreCurrentType === "modpack" ? null : exploreCurrentProfile?.mcVersion || null;
  const sortValue = document.getElementById("explore-sort-select")?.value || "downloads";
  const clientOnly = exploreCurrentType === "mod" && !!document.getElementById("explore-client-only-check")?.checked;
  const res = await window.luna.exploreSearch(
    exploreSearchInput.value,
    exploreCurrentType,
    gameVersion,
    sortValue,
    exploreCurrentPage,
    exploreSelectedCategories,
    clientOnly
  );
  // main.js가 이제 {hits, page, totalPages} 형태로 반환함 (7-4 페이지네이션 추가)
  const results = res.hits || [];
  exploreCurrentPage = res.page || 1;
  exploreTotalPages = res.totalPages || 1;

  exploreResults.innerHTML = "";
  if (results.length === 0) {
    exploreResults.innerHTML = `<div style="color:var(--text-2); font-size:12.5px; padding:12px;">결과가 없어요</div>`;
    renderExplorePagination();
    return;
  }

  results.forEach((item, itemIndex) => {
    const row = document.createElement("div");
    row.className = "explore-item stagger-in";
    row.style.setProperty("--i", itemIndex);
    // 24-14차: "모드팩 이름 옆쪽에 마크 버전 뜨면 좋을 듯" - 모드팩 탭에서만 이름 옆에
    // 가장 최신 지원 버전을 작은 칩으로 붙임(검색 결과에 실려오는 versions 배열의 마지막 값)
    const modpackMcVersion = exploreCurrentType === "modpack" ? (item.gameVersions || []).slice(-1)[0] : null;
    row.innerHTML = `
      <img class="explore-item-icon" src="${item.icon || ""}" onerror="this.style.visibility='hidden'" />
      <div class="explore-item-info">
        <div class="explore-item-title"><span class="explore-item-title-text">${item.title}</span>${modpackMcVersion ? `<span class="explore-item-mc-version-chip">${escapeHtml(modpackMcVersion)}</span>` : ""} <span class="explore-item-author${item.author ? " author-page-link" : ""}">by ${item.author}</span></div>
        <div class="explore-item-desc">${item.description || ""}</div>
      </div>
      <div class="explore-item-actions">
        <div class="explore-item-stats">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v13m0 0 5-5m-5 5-5-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke-linecap="round"/></svg>
          ${formatDownloads(item.downloads)}
        </div>
        <div class="explore-item-buttons">
          <button class="icon-btn btn-explore-external" type="button" title="Modrinth 페이지 열기">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>
          </button>
          <button class="btn btn-ghost btn-small btn-explore-detail" type="button">보기</button>
          <button class="btn btn-fixed-green btn-small btn-explore-install" type="button">설치</button>
        </div>
      </div>
    `;
    // 10차: "모드 이름이나 블록 자체를 누르면 보기로 가지게 해줘" - 예전엔 "보기" 버튼만
    // 클릭 가능했음. 줄 전체를 클릭 가능하게 하고, 버튼들은 각자 stopPropagation으로
    // 줄 클릭과 안 겹치게 함
    row.addEventListener("click", () => openExploreDetail(item));
    // 20차: "컨텐츠 설치에서 모드 제작자 누르면 바로 제작자 프로필로 가게 해주고" - 상세
    // 화면(mod-detail-author)에는 이미 있던 제작자 클릭 이동을 목록에서도 그대로 씀
    if (item.author) {
      row.querySelector(".explore-item-author")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openAuthorPage(item.author);
      });
    }
    row.querySelector(".btn-explore-external").addEventListener("click", (e) => {
      e.stopPropagation();
      window.luna.openExternal?.(`https://modrinth.com/${exploreCurrentType}/${item.slug}`);
    });
    row.querySelector(".btn-explore-detail").addEventListener("click", (e) => {
      e.stopPropagation();
      openExploreDetail(item);
    });

    // 설치 버튼: 지금 위에서 고른 프로필에 원클릭으로 설치 (이미 설치돼있으면 제거로 바뀜)
    const installBtn = row.querySelector(".btn-explore-install");
    // 10차 신규(모드팩): 모드팩은 "지금 프로필에 설치"가 아니라 누르면 이 모드팩용 새
    // 프로필이 통째로 만들어짐 - 기존 설치/제거 로직과 완전히 분리된 별도 경로를 씀
    if (exploreCurrentType === "modpack") {
      installBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        withBusyButton(installBtn, "설치 중...", async () => {
          const versions = await window.luna.exploreGetVersions(item.id, null, "modpack");
          if (!versions || versions.length === 0) {
            showToast("설치할 수 있는 버전이 없어요", "error");
            return;
          }
          // 24-14차: "모드팩은 버전 고를 수 있다고 한 거 취소할게 바로 다운로드되게 해주고" -
          // 16차에 추가했던 "버전 여러 개면 상세 페이지에서 직접 고르기"를 되돌림. 버전이
          // 몇 개든 항상 바로 최신(release 우선) 버전을 설치함
          const latest = versions.find((v) => v.versionType === "release") || versions[0];
          await installModpackVersion(item, latest, installBtn);
        });
      });
      exploreResults.appendChild(row);
      return;
    }
    const kind = explKindOf(exploreCurrentType);
    if (exploreCurrentProfile) {
      window.luna.exploreCheckInstalled(exploreCurrentProfile.id, kind, item.id).then((check) => {
        // 16차: "모드 설치할 때 화면 새로고침 되는 거 없애줘" - 설치/제거가 끝날 때마다
        // 목록 전체를 다시 그리던(runExploreSearch) 걸 없애고, 이 버튼 하나만 그때그때
        // 상태를 바꿔줌(깜빡임/스크롤 초기화/등장 애니메이션 재생 방지). 클로저로 잡은
        // installedFileName을 계속 갱신해서 같은 버튼으로 설치<->제거를 오가게 함
        let installedFileName = check.installed ? check.fileName : null;
        syncInstallBtnState(installBtn, installedFileName);
        installBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          withBusyButton(installBtn, installedFileName ? "제거 중..." : "설치 중...", async () => {
            if (installedFileName) {
              // 22차: "모드 제거할 때 묻는 거 없애줘" - 되묻지 않고 바로 제거함
              const res = await window.luna.exploreUninstall(exploreCurrentProfile.id, kind, installedFileName);
              if (res.ok) {
                showToast("제거했어요");
                installedFileName = null;
                syncInstallBtnState(installBtn, installedFileName);
              }
              return;
            }
            const versions = await window.luna.exploreGetVersions(item.id, exploreCurrentProfile.mcVersion, exploreCurrentType);
            const latest = versions.find((v) => v.versionType === "release") || versions[0];
            if (!latest) {
              showToast("이 프로필 버전에 맞는 버전이 없어요", "error");
              return;
            }
            const res = await installWithDependencies(exploreCurrentProfile, kind, item, latest);
            if (res.ok) {
              showToast(`"${res.fileName}" 설치 완료!`);
              installedFileName = res.fileName;
              syncInstallBtnState(installBtn, installedFileName);
            } else {
              showToast(res.error || "설치 실패", "error");
            }
          });
        });
      });
    } else {
      installBtn.disabled = true;
      installBtn.title = "먼저 프로필을 골라주세요";
    }

    exploreResults.appendChild(row);
  });

  renderExplorePagination();
}

// 16차: Explore 목록 줄의 설치/제거 버튼 상태를 전체 재검색 없이 그 자리에서만 바꿔줌
function syncInstallBtnState(btn, installedFileName) {
  if (installedFileName) {
    btn.textContent = "제거";
    btn.classList.remove("btn-fixed-green");
    btn.classList.add("btn-danger-filled");
  } else {
    btn.textContent = "설치";
    btn.classList.remove("btn-danger-filled");
    btn.classList.add("btn-fixed-green");
  }
}

function formatDownloads(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + "KB";
  return bytes + "B";
}

// "2달 전" 같은 상대적인 날짜 표시 (Modrinth 버전 목록 리스트용)
function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}달 전`;
  return `${Math.floor(month / 12)}년 전`;
}

// ---- 모드 상세 + 설치 (모드린스로 안 나가고 앱 안에서 다 봄, 프로필은 이미 위에서 고른 것 그대로 씀) ----
// 9-1(4차): 텍스트 안의 URL을 안전하게 이스케이프한 뒤 클릭 가능한 링크(.ext-link)로 바꿔줌.
// 실제 <a href>로 열지 않고 클릭 시 openExternal IPC로 기본 브라우저에서 열리게 함
// (CSP가 외부 이동을 막아두었기 때문에 이렇게 해야 실제로 열림)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function linkifyText(text) {
  const escaped = escapeHtml(text || "");
  const urlRe = /(https?:\/\/[^\s<]+[^\s<.,:;!?)\]'"])/g;
  return escaped.replace(urlRe, (url) => `<a href="#" class="ext-link" data-url="${url}">${url}</a>`);
}
function bindExtLinks(container) {
  if (!container || container.dataset.extLinksBound) return;
  container.dataset.extLinksBound = "1";
  container.addEventListener("click", (e) => {
    const a = e.target.closest("a.ext-link");
    if (!a) return;
    e.preventDefault();
    window.luna.openExternal?.(a.dataset.url);
  });
}

// 9-2(4차): 모드 상세 갤러리 라이트박스
let modGalleryImages = [];
let modGalleryIndex = 0;
// 17차 신규: 모드 상세 설명 번역 상태
let modDetailOriginalBodyText = "";
let modDetailShowingTranslation = false;
function openModGalleryLightbox(index) {
  const lb = document.getElementById("mod-gallery-lightbox");
  if (!lb || !modGalleryImages.length) return;
  modGalleryIndex = ((index % modGalleryImages.length) + modGalleryImages.length) % modGalleryImages.length;
  const g = modGalleryImages[modGalleryIndex];
  document.getElementById("mod-gallery-lightbox-img").src = g.url;
  document.getElementById("mod-gallery-lightbox-caption").textContent = g.title || g.description || "";
  lb.hidden = false;
}
function closeModGalleryLightbox() {
  const lb = document.getElementById("mod-gallery-lightbox");
  if (lb) lb.hidden = true;
  // 라이트박스에서 이전/다음으로 넘겨보고 닫았을 때, 큰 사진/탭 강조도 마지막으로 본 것과 맞춰줌
  selectModGalleryTab(modGalleryIndex);
}
// 12차: 갤러리 탭에서 하나 고르면 큰 사진(mod-detail-gallery-main)을 바꾸고 그 탭만 강조함
function selectModGalleryTab(index) {
  if (!modGalleryImages.length) return;
  modGalleryIndex = ((index % modGalleryImages.length) + modGalleryImages.length) % modGalleryImages.length;
  const g = modGalleryImages[modGalleryIndex];
  const mainImg = document.getElementById("mod-detail-gallery-main");
  if (mainImg) {
    // 24-14차: 로드 실패한 큰 사진이 깨진 아이콘으로 남지 않도록 실패하면 숨김(다음 탭을
    // 고르면 onload로 다시 보임)
    mainImg.onerror = () => { mainImg.style.visibility = "hidden"; };
    mainImg.onload = () => { mainImg.style.visibility = "visible"; };
    mainImg.src = g.url;
    mainImg.alt = g.title || g.description || "";
  }
  document.querySelectorAll(".mod-detail-gallery-tab").forEach((tab) => {
    tab.classList.toggle("is-active", Number(tab.dataset.idx) === modGalleryIndex);
  });
}
function initModGalleryLightbox() {
  document.getElementById("btn-mod-gallery-close")?.addEventListener("click", closeModGalleryLightbox);
  document.getElementById("mod-gallery-lightbox")?.addEventListener("click", (e) => {
    if (e.target.id === "mod-gallery-lightbox") closeModGalleryLightbox();
  });
  document.getElementById("btn-mod-gallery-prev")?.addEventListener("click", () => openModGalleryLightbox(modGalleryIndex - 1));
  document.getElementById("btn-mod-gallery-next")?.addEventListener("click", () => openModGalleryLightbox(modGalleryIndex + 1));
}

// 20차: "스크린샷 박스가 있는 게 아니라 카테고리처럼 나뉘게 해달라했지" - 설명/스크린샷/버전을
// 진짜 탭으로 전환. 탭 버튼의 is-active와 패널(.mod-detail-tab-panel)의 hidden을 함께 맞춤
function selectModDetailTab(tab) {
  document.querySelectorAll("#mod-detail-tabs .mod-detail-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".mod-detail-tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
}
document.getElementById("mod-detail-tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".mod-detail-tab");
  if (!btn || btn.hidden) return;
  selectModDetailTab(btn.dataset.tab);
});

async function openExploreDetail(item) {
  // 10차 신규(모드팩): 모드팩은 미리 프로필을 고를 필요가 없음 (설치하면 새 프로필이
  // 통째로 만들어짐) - 이 경우에만 프로필 필수 체크를 건너뜀
  const isModpack = exploreCurrentType === "modpack";
  if (!isModpack && !exploreCurrentProfile) {
    showToast("먼저 프로필을 선택해주세요", "error");
    return;
  }
  exploreDetailItem = item;
  exploreListPanel.hidden = true;
  exploreDetailPanel.hidden = false;

  document.getElementById("mod-detail-icon").src = item.icon || "";
  document.getElementById("mod-detail-title").textContent = item.title;
  document.getElementById("mod-detail-meta").textContent = `by ${item.author} · ${formatDownloads(item.downloads)} 다운로드`;
  const descEl = document.getElementById("mod-detail-desc");
  descEl.innerHTML = linkifyText(item.description || "");
  bindExtLinks(descEl);
  document.getElementById("mod-install-target-name").textContent = isModpack
    ? window.NovaI18n?.t?.("explore_install_new_profile") || "새 프로필로 설치"
    : exploreCurrentProfile.name;
  document.getElementById("btn-mod-detail-external").onclick = () => {
    window.luna.openExternal?.(`https://modrinth.com/${exploreCurrentType}/${item.slug}`);
  };

  // 나머지(갤러리/본문/태그/지원버전/최근 업데이트)는 모드린스로 안 나가고 앱 안에서 프로젝트 상세 API로 채움
  const authorSideEl = document.getElementById("mod-detail-author");
  authorSideEl.textContent = item.author || "-";
  // 17차 신규: "제작자 누르면 그 제작자의 모드/리팩/쉐이더가 쫙 뜨게 해줘"
  authorSideEl.onclick = item.author ? () => openAuthorPage(item.author) : null;
  const galleryEl = document.getElementById("mod-detail-gallery");
  const bodyEl = document.getElementById("mod-detail-body");
  const versionsChipsEl = document.getElementById("mod-detail-versions-chips");
  const tagsEl = document.getElementById("mod-detail-tags");
  const updatedEl = document.getElementById("mod-detail-updated");
  galleryEl.innerHTML = "";
  bodyEl.textContent = "불러오는 중...";
  versionsChipsEl.innerHTML = "";
  tagsEl.innerHTML = "";
  updatedEl.textContent = "-";
  // 20차: 새 항목을 열 때마다 항상 "설명" 탭부터 보이게 하고, 스크린샷 탭은 실제로 갤러리
  // 데이터가 있는 게 확인될 때까지 숨겨둠(아래 exploreGetProject 콜백 참고)
  const galleryTabBtn = document.getElementById("mod-detail-tab-gallery");
  if (galleryTabBtn) galleryTabBtn.hidden = true;
  selectModDetailTab("desc");
  // 17차: 새 항목을 열 때마다 번역 상태/버튼 라벨을 초기화
  modDetailShowingTranslation = false;
  const translateBtn = document.getElementById("btn-mod-detail-translate");
  if (translateBtn) {
    translateBtn.textContent = "번역";
    translateBtn.disabled = false;
  }

  window.luna.exploreGetProject(item.id).then((project) => {
    if (!project || exploreDetailItem !== item) return; // 그 사이에 다른 항목을 열었으면 무시

    modDetailOriginalBodyText = project.body || item.description || "";
    bodyEl.innerHTML = linkifyText(modDetailOriginalBodyText);
    bindExtLinks(bodyEl);

    modGalleryImages = (project.gallery && project.gallery.length > 0) ? project.gallery : [];
    // 20차: 탭 버튼 자체는 갤러리 유무로만 보이고/숨겨지고, 실제 패널 표시는 탭 선택 상태로
    // 결정됨(selectModDetailTab) - 패널은 기본이 hidden이라 데이터가 없으면 탭도 안 보여서
    // 자연스럽게 선택할 수 없음
    if (galleryTabBtn) galleryTabBtn.hidden = modGalleryImages.length === 0;
    if (modGalleryImages.length > 0) {
      // 12차: 작은 그리드로 다 늘어놓는 대신, 큰 사진 하나 + 고를 수 있는 작은 탭 줄로 바꿈
      const tabsEl = document.getElementById("mod-detail-gallery-tabs");
      // 24-14차: "스크린샷이 안보여 버그인 듯" - 주소가 있어도 실제 로드가 실패하는 항목이
      // 섞여있으면 깨진 이미지 아이콘만 덩그러니 남았음. 실패하면 그 탭 자체를 숨김
      tabsEl.innerHTML = modGalleryImages
        .map((g, i) => `<button type="button" class="mod-detail-gallery-tab" data-idx="${i}"><img src="${g.url}" alt="${escapeHtml(g.title || "")}" loading="lazy" onerror="this.closest('.mod-detail-gallery-tab').style.display='none'" /></button>`)
        .join("");
      tabsEl.querySelectorAll(".mod-detail-gallery-tab").forEach((tab) => {
        tab.addEventListener("click", () => selectModGalleryTab(Number(tab.dataset.idx)));
      });
      selectModGalleryTab(0);
      const mainImg = document.getElementById("mod-detail-gallery-main");
      if (mainImg) mainImg.onclick = () => openModGalleryLightbox(modGalleryIndex);
    }

    // 스냅샷/프리릴리즈/RC(예: 25w14a, 1.21-rc1, 26.1-pre1) 다 빼고 정식 릴리즈만 보여줌 (예: 1.21.11, 26.1)
    const releaseVersions = (project.gameVersions || []).filter((v) => /^\d+\.\d+(\.\d+)?$/.test(String(v).trim()));
    const versions = releaseVersions.slice(-12); // 너무 많으면 최근 것 위주로만
    versionsChipsEl.innerHTML = versions.length
      ? versions.map((v) => `<span class="mod-detail-chip">${v}</span>`).join("")
      : `<span class="mod-detail-chip is-empty">정보 없음</span>`;

    const tags = project.categories || [];
    tagsEl.innerHTML = tags.length
      ? tags.map((t) => `<span class="mod-detail-chip">${t}</span>`).join("")
      : `<span class="mod-detail-chip is-empty">정보 없음</span>`;

    if (project.dateModified) {
      const d = new Date(project.dateModified);
      updatedEl.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    }
  });

  if (isModpack) {
    await loadModpackVersionsForInstall(item);
    await refreshModpackQuickInstallButton(item);
  } else {
    await loadModVersionsForProfile(item, exploreCurrentProfile);
    await refreshQuickInstallButton(item, exploreCurrentProfile);
  }
}

// 17차 신규: 모드 설명 번역 버튼 - 누르면 번역해서 보여주고, 다시 누르면 원문으로 되돌림
document.getElementById("btn-mod-detail-translate")?.addEventListener("click", async () => {
  const bodyEl = document.getElementById("mod-detail-body");
  const btn = document.getElementById("btn-mod-detail-translate");
  if (!bodyEl || !btn) return;
  if (modDetailShowingTranslation) {
    bodyEl.innerHTML = linkifyText(modDetailOriginalBodyText);
    bindExtLinks(bodyEl);
    modDetailShowingTranslation = false;
    btn.textContent = "번역";
    return;
  }
  // withBusyButton은 완료 후 버튼 텍스트를 클릭 전 상태로 되돌리는 헬퍼라(설치 버튼처럼
  // "항상 같은 라벨로 돌아가는" 경우엔 맞지만), 여기선 성공 시 라벨이 "원문 보기"로 바뀌어야
  // 하므로 직접 잠금/해제함
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = "번역 중...";
  try {
    const res = await window.luna.exploreTranslate?.(bodyEl.textContent || "");
    if (res?.ok) {
      bodyEl.textContent = res.text;
      modDetailShowingTranslation = true;
      btn.textContent = "원문 보기";
    } else {
      showToast(res?.error || "번역에 실패했어요", "error");
      btn.textContent = prevText;
    }
  } finally {
    btn.disabled = false;
  }
});

// 7-6: 상세 화면 위쪽의 원클릭 설치 버튼 - 버전 목록까지 내려가지 않고 최신(정식) 버전을
// 바로 설치함. 이미 설치돼 있으면 버튼을 "설치됨"으로 바꿔서 중복 설치를 막음
async function refreshQuickInstallButton(item, profile) {
  const btn = document.getElementById("btn-mod-quick-install");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "설치";

  const kind = explKindOf(exploreCurrentType);
  const installedCheck = await window.luna.exploreCheckInstalled(profile.id, kind, item.id);
  if (exploreDetailItem !== item) return; // 그 사이 다른 항목을 열었으면 무시

  if (installedCheck.installed) {
    btn.textContent = "설치됨";
    btn.disabled = true;
    btn.onclick = null;
    return;
  }

  btn.disabled = false;
  btn.onclick = () =>
    withBusyButton(btn, "설치 중...", async () => {
      const versions = await window.luna.exploreGetVersions(item.id, profile.mcVersion, exploreCurrentType);
      const latest = versions.find((v) => v.versionType === "release") || versions[0];
      if (!latest) {
        showToast("이 프로필 버전에 맞는 버전이 없어요", "error");
        return;
      }
      const res = await installWithDependencies(profile, kind, item, latest);
      if (res.ok) {
        showToast(`"${res.fileName}" 설치 완료!`);
        loadModVersionsForProfile(item, profile);
        refreshQuickInstallButton(item, profile);
      } else {
        showToast(res.error || "설치 실패", "error");
      }
    });
}

document.getElementById("mod-version-show-beta")?.addEventListener("change", (e) => {
  modVersionShowBeta = e.target.checked;
  if (modVersionListCtx.item && modVersionListCtx.profile) {
    loadModVersionsForProfile(modVersionListCtx.item, modVersionListCtx.profile);
  }
});

async function loadModVersionsForProfile(item, profile) {
  modVersionListCtx = { item, profile };
  const betaToggleEl = document.getElementById("mod-version-show-beta");
  if (betaToggleEl) betaToggleEl.checked = modVersionShowBeta;
  const kind = explKindOf(exploreCurrentType);
  const versionListEl = document.getElementById("mod-install-version-list");
  versionListEl.innerHTML = `<div style="color:var(--text-2); font-size:12px;">불러오는 중...</div>`;

  // 이미 이 프로필에 설치돼 있는지 확인
  const installedCheck = await window.luna.exploreCheckInstalled(profile.id, kind, item.id);

  // 프로필의 정확한 마인크래프트 버전에 맞는 버전만 가져옴
  const allVersions = await window.luna.exploreGetVersions(item.id, profile.mcVersion, exploreCurrentType);
  // 24-14차: 기본은 릴리스만, "베타 버전도 보기"를 켰을 때만 베타/알파도 같이 보여줌
  const versions = modVersionShowBeta ? allVersions : allVersions.filter((v) => v.versionType === "release");
  versionListEl.innerHTML = "";

  // 24-46차: Fabric API처럼 항상 자동으로 들어있는 항목(builtin)은 유저가 직접 설치한 게
  // 아니라 파일명/제거 버튼 자체가 없음 - 일반 "설치됨" 상태와 다르게, 삭제 불가 안내만 보여줌
  if (installedCheck.installed && installedCheck.builtin) {
    const row = document.createElement("div");
    row.className = "mod-version-row is-installed";
    row.innerHTML = `
      <div class="mod-version-row-main">
        <div class="mod-version-row-title">기본 포함됨</div>
        <div class="mod-version-row-file">모든 Fabric 프로필에 자동으로 들어있어요 (별도 삭제 불가)</div>
      </div>
    `;
    versionListEl.appendChild(row);
    return;
  }

  if (installedCheck.installed) {
    const row = document.createElement("div");
    row.className = "mod-version-row is-installed";
    row.innerHTML = `
      <div class="mod-version-row-main">
        <div class="mod-version-row-title">설치됨</div>
        <div class="mod-version-row-file">${installedCheck.fileName}</div>
      </div>
      <button class="btn btn-danger-filled btn-small mod-version-install-btn" type="button">제거</button>
    `;
    const removeBtn = row.querySelector("button");
    removeBtn.addEventListener("click", () =>
      // 22차: "모드 제거할 때 묻는 거 없애줘" - 되묻지 않고 바로 제거함
      withBusyButton(removeBtn, "제거 중...", async () => {
        const res = await window.luna.exploreUninstall(profile.id, kind, installedCheck.fileName);
        if (res.ok) {
          showToast("제거했어요");
          loadModVersionsForProfile(item, profile);
          refreshQuickInstallButton(item, profile);
        }
      })
    );
    versionListEl.appendChild(row);
    return;
  }

  if (versions.length === 0) {
    versionListEl.innerHTML =
      !modVersionShowBeta && allVersions.length > 0
        ? `<div style="color:var(--text-2); font-size:12px;">릴리스 버전이 없어요. 위에서 "베타 버전도 보기"를 켜보세요</div>`
        : `<div style="color:var(--text-2); font-size:12px;">이 프로필 버전(${profile.mcVersion})에 맞는 버전이 없어요</div>`;
    return;
  }

  const loaderLabel = kind === "mods" ? "Fabric" : kind === "shaderpacks" ? "Shader" : "";

  versions.forEach((v) => {
    const row = document.createElement("div");
    row.className = "mod-version-row";
    const mcVersionLabel = (v.gameVersions || [])[0] || profile.mcVersion;
    // 10차: "버전이랑 changelog 이런 거는 보기 안에서 또 분리해줘" - 버전 목록 줄과
    // 뒤섞지 않고, changelog가 있을 때만 토글 버튼으로 열어보는 별도 영역으로 분리함
    const hasChangelog = !!(v.changelog && v.changelog.trim());
    row.innerHTML = `
      <div class="mod-version-row-main">
        <div class="mod-version-row-title">${v.name || v.versionNumber}<span class="mod-version-badge badge-${v.versionType}">${v.versionType}</span></div>
        <div class="mod-version-row-file">${v.fileName || ""}</div>
      </div>
      <div class="mod-version-row-chips">
        <span class="mod-version-chip">${mcVersionLabel}</span>
        ${loaderLabel ? `<span class="mod-version-chip">${loaderLabel}</span>` : ""}
      </div>
      <!-- 24-14차: "모드 무게 있는 곳에 다운로드 수로 바꾸고 조금만 더 잘 보이게 해줘" -
           파일 용량(formatFileSize) 표시를 없애고, 그 자리를 차지하던 다운로드 수를
           mod-version-row-downloads 클래스로 강조함 -->
      <div class="mod-version-row-stats">
        <span class="mod-version-row-downloads">${formatDownloads(v.downloads || 0)} 다운로드</span>
        <span>${formatRelativeTime(v.datePublished)}</span>
      </div>
      <div class="mod-version-row-actions">
        ${
          hasChangelog
            ? `<button type="button" class="btn btn-ghost btn-small mod-version-changelog-toggle">변경사항</button>`
            : ""
        }
        <button class="btn btn-fixed-green btn-small mod-version-install-btn" type="button">설치</button>
      </div>
      ${hasChangelog ? `<div class="mod-version-changelog" hidden></div>` : ""}
    `;
    const installBtn = row.querySelector(".mod-version-install-btn");
    installBtn.addEventListener("click", () =>
      withBusyButton(installBtn, "설치 중...", async () => {
        const res = await installWithDependencies(profile, kind, item, v);
        if (res.ok) {
          showToast(`"${res.fileName}" 설치 완료!`);
          loadModVersionsForProfile(item, profile);
          refreshQuickInstallButton(item, profile);
        } else {
          showToast(res.error || "설치 실패", "error");
        }
      })
    );
    if (hasChangelog) {
      const toggleBtn = row.querySelector(".mod-version-changelog-toggle");
      const changelogEl = row.querySelector(".mod-version-changelog");
      toggleBtn.addEventListener("click", () => {
        const willOpen = changelogEl.hidden;
        if (willOpen && !changelogEl.dataset.filled) {
          changelogEl.innerHTML = linkifyText(v.changelog);
          bindExtLinks(changelogEl);
          changelogEl.dataset.filled = "1";
        }
        changelogEl.hidden = !willOpen;
        toggleBtn.classList.toggle("is-active", willOpen);
      });
    }
    versionListEl.appendChild(row);
  });
}

// ---- 10차 신규: 모드팩 상세/설치 -----------------------------------------------
// 모드/리소스팩/쉐이더와 달리 "지금 프로필에 추가"가 아니라 설치하면 이 모드팩용 새
// 프로필이 통째로 만들어짐. 그래서 위쪽의 loadModVersionsForProfile/refreshQuickInstallButton을
// 그대로 재사용하지 않고, "이미 설치돼있는지"라는 개념 자체가 없는 별도 경로로 구현함

// main.js가 modpack:install-progress로 보내는 진행 상황을 구독하는 곳들의 모음.
// 이 코드베이스엔 리스너 해제 구조가 없어서, 지금 진행 중인 설치가 있을 때만 콜백이 뭔가를 하도록
// 설치 함수 안에서 매번 새 함수를 만들어 등록/제거함
const modpackInstallProgressHandlers = new Set();
window.luna.onModpackInstallProgress?.((data) => {
  modpackInstallProgressHandlers.forEach((fn) => fn(data));
});

async function loadModpackVersionsForInstall(item) {
  const versionListEl = document.getElementById("mod-install-version-list");
  versionListEl.innerHTML = `<div style="color:var(--text-2); font-size:12px;">불러오는 중...</div>`;

  const versions = await window.luna.exploreGetVersions(item.id, null, "modpack");
  if (exploreDetailItem !== item) return; // 그 사이에 다른 항목을 열었으면 무시
  versionListEl.innerHTML = "";

  if (versions.length === 0) {
    versionListEl.innerHTML = `<div style="color:var(--text-2); font-size:12px;">설치할 수 있는 버전이 없어요</div>`;
    return;
  }

  versions.forEach((v) => {
    const row = document.createElement("div");
    row.className = "mod-version-row";
    const mcVersionLabel = (v.gameVersions || [])[0] || "";
    const hasChangelog = !!(v.changelog && v.changelog.trim());
    row.innerHTML = `
      <div class="mod-version-row-main">
        <div class="mod-version-row-title">${v.name || v.versionNumber}<span class="mod-version-badge badge-${v.versionType}">${v.versionType}</span></div>
        <div class="mod-version-row-file">${v.fileName || ""}</div>
      </div>
      <div class="mod-version-row-chips">
        ${mcVersionLabel ? `<span class="mod-version-chip">${mcVersionLabel}</span>` : ""}
        <span class="mod-version-chip">Fabric</span>
      </div>
      <div class="mod-version-row-stats">
        <span class="mod-version-row-downloads">${formatDownloads(v.downloads || 0)} 다운로드</span>
        <span>${formatRelativeTime(v.datePublished)}</span>
      </div>
      <div class="mod-version-row-actions">
        ${
          hasChangelog
            ? `<button type="button" class="btn btn-ghost btn-small mod-version-changelog-toggle">변경사항</button>`
            : ""
        }
        <button class="btn btn-fixed-green btn-small mod-version-install-btn" type="button">설치</button>
      </div>
      ${hasChangelog ? `<div class="mod-version-changelog" hidden></div>` : ""}
    `;
    const installBtn = row.querySelector(".mod-version-install-btn");
    installBtn.addEventListener("click", () => installModpackVersion(item, v, installBtn));
    if (hasChangelog) {
      const toggleBtn = row.querySelector(".mod-version-changelog-toggle");
      const changelogEl = row.querySelector(".mod-version-changelog");
      toggleBtn.addEventListener("click", () => {
        const willOpen = changelogEl.hidden;
        if (willOpen && !changelogEl.dataset.filled) {
          changelogEl.innerHTML = linkifyText(v.changelog);
          bindExtLinks(changelogEl);
          changelogEl.dataset.filled = "1";
        }
        changelogEl.hidden = !willOpen;
        toggleBtn.classList.toggle("is-active", willOpen);
      });
    }
    versionListEl.appendChild(row);
  });
}

// 상세 화면 위쪽의 원클릭 설치 버튼 - 최신(정식) 버전을 바로 설치함
async function refreshModpackQuickInstallButton(item) {
  const btn = document.getElementById("btn-mod-quick-install");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "설치";
  btn.onclick = () =>
    withBusyButton(btn, "설치 중...", async () => {
      const versions = await window.luna.exploreGetVersions(item.id, null, "modpack");
      const latest = versions.find((v) => v.versionType === "release") || versions[0];
      if (!latest) {
        showToast("설치할 수 있는 버전이 없어요", "error");
        return;
      }
      await installModpackVersion(item, latest, btn);
    });
}

// 모드팩 설치 - 다른 종류와 달리 "지금 프로필에 추가"가 아니라 새 프로필을 통째로 만듦.
// 아이콘도 이 모드팩의 아이콘을 그대로 씀 (사용자가 명시적으로 요청한 부분)
async function installModpackVersion(item, version, btn) {
  const confirmed = await showConfirm(
    `"${item.title}"로 새 프로필을 만들까요? 모드팩에 포함된 모드/설정이 전부 설치돼요.`,
    "설치",
    "취소"
  );
  if (!confirmed) return;

  const origText = btn ? btn.textContent : null;
  const progressHandler = (data) => {
    if (!btn || !data || !data.total) return;
    btn.textContent = `설치 중... (${data.current}/${data.total})`;
  };
  modpackInstallProgressHandlers.add(progressHandler);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "설치 중...";
  }

  try {
    const res = await window.luna.exploreInstallModpack({
      projectId: item.id,
      projectTitle: item.title,
      icon: item.icon,
      fileUrl: version.fileUrl,
    });
    if (res && res.ok) {
      showToast(`"${res.profile.name}" 프로필이 생성됐어요!`);
      // "Versions"에서 새 프로필을 만들 때와 같은 방식: 홈으로 이동하고 바로 그 프로필로 전환
      showAppPanel("view-home");
      setActiveSidebarIcon("launch");
      await window.luna.selectProfile(res.profile.id);
      if (profileChipName) profileChipName.textContent = res.profile.name;
      updateMcVersionLabel(res.profile.mcVersion);
      refreshChipActiveStates();
      // 17차 버그 수정: Install에서 만들 때와 같은 이유로, 모드팩으로 새 프로필을 만든
      // 직후에도 Play 화면 프로필 목록 캐시를 다시 불러와야 바로 나타남
      // 24-48차: 서버 목록도 같이 불러와서, 새 프로필로 자동 전환되며 풀린 서버 선택 표시를 정리
      await refreshLaunchTargetLists();
    } else {
      showToast((res && res.error) || "모드팩 설치 실패", "error");
    }
  } catch (err) {
    showToast(err?.message || "모드팩 설치 실패", "error");
  } finally {
    modpackInstallProgressHandlers.delete(progressHandler);
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText || "설치";
    }
  }
}

document.getElementById("btn-explore-detail-back")?.addEventListener("click", showExploreList);
initModGalleryLightbox();

// ---- Versions: 버전 골라서 새 프로필 만들기 -----------------------------------
const versionsOverlay = document.getElementById("view-versions");
const versionsListPanel = document.getElementById("versions-list-panel");
const versionsCreatePanel = document.getElementById("versions-create-panel");
const versionsList = document.getElementById("versions-list");

// 16차: "인스톨을 눌렀을 때랑 + 버튼 눌러서 하는 프로필 추가랑 반대로 됐잖아" - 15차에서는
// Install 사이드바 아이콘을 누르면 이 3가지 선택지 팝업(profile-add-overlay)이 먼저 떴는데,
// 그게 아니라 예전처럼 Install 아이콘은 바로 버전 목록(view-versions)으로 가야 하고, 이
// 팝업은 프로필 관리 화면의 "프로필 추가"(+) 카드를 눌렀을 때 떠야 함 - 아래
// profile-manage-grid의 addCard 클릭 핸들러 참고
document.querySelector('.sidebar-icon[data-panel="versions"]')?.addEventListener("click", async () => {
  if (isSidebarPanelAlreadyActive("versions")) return;
  setActiveSidebarIcon("versions");
  showAppPanel("view-versions");
  await openVersionsList();
});

const profileAddOverlay = document.getElementById("profile-add-overlay");

function openProfileAddOverlay() {
  if (!profileAddOverlay) return;
  profileAddOverlay.hidden = false;
}
function closeProfileAddOverlay() {
  if (profileAddOverlay) profileAddOverlay.hidden = true;
}
document.getElementById("btn-profile-add-close")?.addEventListener("click", closeProfileAddOverlay);
// 바깥(어두운 배경) 클릭하면 닫힘 - 설정 팝업 등 다른 오버레이와 동일한 관례
profileAddOverlay?.addEventListener("click", (e) => {
  if (e.target === profileAddOverlay) closeProfileAddOverlay();
});

// ---- 1) 커스텀 프로필 - 16차: "커스텀 프로필을 눌렀을 때 Install로 가지고" - 이 팝업
// 안에 따로 있던 아이콘/이름/버전/로더 입력 단계는 없애고, Install(버전 목록)으로 보내서
// 거기서 버전을 고르면 이어서 만들게 함(openCreateProfileForm 참고) ----
document.getElementById("profile-add-choice-custom")?.addEventListener("click", async () => {
  closeProfileAddOverlay();
  setActiveSidebarIcon("versions");
  showAppPanel("view-versions");
  await openVersionsList();
});

// ---- 2) 모드팩 찾기 - 16차: "모드팩 찾기는 Contents에 모드팩 찾기로 가야지" - Install이
// 아니라 Contents(Explore)의 모드팩 탭으로 이동함 ----
document.getElementById("profile-add-choice-modpack-find")?.addEventListener("click", async () => {
  closeProfileAddOverlay();
  await openExploreModpackTab();
});

// ---- 3) 모드팩 업로드 - 로컬에 이미 있는 .mrpack 파일을 직접 골라 설치 ----
document.getElementById("profile-add-choice-modpack-upload")?.addEventListener("click", async () => {
  const btn = document.getElementById("profile-add-choice-modpack-upload");
  if (!btn || btn.disabled) return;
  const original = btn.innerHTML;
  const progressHandler = (data) => {
    if (!data || !data.total) return;
    btn.textContent = `설치 중... (${data.current}/${data.total})`;
  };
  modpackInstallProgressHandlers.add(progressHandler);
  btn.disabled = true;
  btn.textContent = "파일 선택 중...";
  try {
    const res = await window.luna.installModpackFile();
    if (res.canceled) return;
    if (res.ok) {
      showToast(
        `"${res.profile.name}" 모드팩을 설치했어요` + (res.failedCount ? ` (${res.failedCount}개 파일은 실패)` : "")
      );
      closeProfileAddOverlay();
      showAppPanel("view-home");
      setActiveSidebarIcon("launch");
      await window.luna.selectProfile(res.profile.id);
      if (profileChipName) profileChipName.textContent = res.profile.name;
      updateMcVersionLabel(res.profile.mcVersion);
      refreshChipActiveStates();
      await refreshLaunchTargetLists(); // 24-48차: 서버 선택 표시도 같이 정리
    } else {
      showToast(res.error || "모드팩 설치 실패", "error");
    }
  } catch (err) {
    showToast(err?.message || "모드팩 설치 실패", "error");
  } finally {
    modpackInstallProgressHandlers.delete(progressHandler);
    if (document.body.contains(btn)) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
});

// 버전 문자열(예: "1.21.11")에서 메이저 버전(예: "1.21")만 뽑아냄
function getMajorVersionKey(v) {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? `${m[1]}.${m[2]}` : v;
}

// 버전 문자열끼리 숫자 단위로 비교 (예: "1.21.2" < "1.21.11")
function compareVersionStrings(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// 13차: "프리셋으로 만들기" 탭을 없애고 목록 화면에 인라인으로 합쳤으므로 별도 탭 pill은 더 이상 필요 없음

// 10차: 상점 상단 카테고리 탭(전체/테마 색상/테마/코스메틱/스페셜)에도 다른 탭 그룹과 같은 슬라이딩 하이라이트 적용
const shopCategoryPill = mountSlidingPill(document.querySelector(".shop-category-tabs"), "slide-pill-shop-category");
function updateShopCategoryPill(instant) {
  const active = document.querySelector(".shop-category-btn.is-active");
  shopCategoryPill.update(active, instant);
}

// null이면 메이저 버전 카드 목록, 문자열이면 그 메이저 버전 안의 상세(패치) 버전 목록
let versionsDrillMajor = null;

async function openVersionsList() {
  versionsCreatePanel.hidden = true;
  versionsListPanel.hidden = false;
  versionsDrillMajor = null;
  // 13차: Install 화면을 다시 열 때마다 항상 맨 위(버전 목록 + 인라인 프리셋 카테고리 + 공유 코드) 화면으로 초기화
  document.getElementById("versions-mode-preset-list").hidden = true;
  document.getElementById("versions-mode-preset-version").hidden = true;
  document.getElementById("versions-mode-version").hidden = false;
  await Promise.all([renderVersionsList(), renderPresetBrowseCategories()]);
}

async function renderVersionsList() {
  const versions = await window.luna.listAvailableVersions();
  versionsList.innerHTML = "";
  versionsList.classList.remove("versions-list-major");
  // 공유 코드 입력/인라인 프리셋 카테고리는 메이저 버전 목록(첫 화면)에서만 보이고, 세부 버전으로 들어가면 숨김
  const importSection = document.getElementById("versions-import-section");
  if (importSection) importSection.hidden = !!versionsDrillMajor;
  const presetInlineSection = document.getElementById("versions-preset-inline-section");
  if (presetInlineSection) presetInlineSection.hidden = !!versionsDrillMajor;

  if (!versions || versions.length === 0) {
    versionsList.innerHTML = `<div style="color:var(--text-2); font-size:12.5px; padding:12px; background:var(--bg-2); border-radius:var(--radius-md);">
      아직 준비된 버전이 없어요.<br/>
      런처 폴더 안 <b>mods/1.21.11/</b> 폴더가 있는지 확인해주세요.
    </div>`;
    return;
  }

  if (!versionsDrillMajor) {
    // 1단계: 메이저 버전 카드들 (예: 1.21, 1.20, 1.19 ...)
    const groups = new Map();
    versions.forEach((v) => {
      const key = getMajorVersionKey(v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    });

    versionsList.classList.add("versions-list-major");
    // 5-7(5차): "Install도 들어가면 버전들이 하나씩 올라오는 애니메이션 넣어줘" - 카드마다
    // animation-delay를 순서대로 늘려가며 줘서 위로 올라오며 순차적으로 나타나게 함
    let staggerIdx = 0;
    groups.forEach((patchVersions, majorKey) => {
      const item = document.createElement("div");
      item.className = "version-item version-item-major version-item-rise";
      item.style.animationDelay = `${staggerIdx * 40}ms`;
      staggerIdx++;
      // src/assets/version-bg/{메이저버전}.jpg 가 있으면 그걸 쓰고, 없으면 default.jpg로 대체
      item.style.setProperty(
        "--v-bg-image",
        `url("assets/version-bg/${majorKey}.jpg"), url("assets/version-bg/default.jpg")`
      );
      // "3개 버전" 대신 실제 지원 범위를 보여줌 (예: "1.21.0 ~ 1.21.11 · Fabric")
      const sorted = [...patchVersions].sort(compareVersionStrings);
      const lo = sorted[0];
      const hi = sorted[sorted.length - 1];
      const rangeLabel = lo === hi ? lo : `${lo} ~ ${hi}`;
      item.innerHTML = `<b>${majorKey}</b><span>${rangeLabel} · Nova</span>`;
      item.addEventListener("click", () => {
        versionsDrillMajor = majorKey;
        renderVersionsList();
      });
      versionsList.appendChild(item);
    });
  } else {
    // 2단계: 고른 메이저 버전 안의 상세 버전들
    const backItem = document.createElement("div");
    backItem.className = "version-back-item";
    backItem.textContent = "← 메이저 버전으로";
    backItem.addEventListener("click", () => {
      versionsDrillMajor = null;
      renderVersionsList();
    });
    versionsList.appendChild(backItem);

    let staggerIdx = 0;
    versions
      .filter((v) => getMajorVersionKey(v) === versionsDrillMajor)
      .forEach((v) => {
        const item = document.createElement("div");
        item.className = "version-item version-item-rise";
        item.style.animationDelay = `${staggerIdx * 40}ms`;
        staggerIdx++;
        item.innerHTML = `<b>${v}</b><span>Nova</span>`;
        item.addEventListener("click", () => openCreateProfileForm(v));
        versionsList.appendChild(item);
      });
  }
}

// 16-3(4차): presetPreselect가 있으면(=프리셋 브라우징 3단계에서 버전 카드를 클릭해서 들어온 경우)
// 프리셋 체크박스/선택 UI 대신 "이 프리셋으로 만들어요" 고정 안내만 보여주고, 실제 presetId는
// versionsCreatePanel.dataset.presetId에 저장해둠 (제출 시 이 값을 우선 사용)
// 16차: "커스텀 프로필을 눌렀을 때 Install로 가지고, 버전을 골랐을 때 뜨게 해줘야지, 버전
// 고르는 건 없애주고 고른 버전이 뜨게 해줘" - 예전엔 메모리/해상도/전체화면/JVM 인수까지
// 고르는 폼이었는데, 아이콘/이름/버전(고른 값 그대로 표시)/로더만 고르는 화면으로 바뀜.
// 프리셋을 쓰면(자동 선택이든 체크박스로 직접 골랐든) 서버가 로더를 강제로 fabric으로
// 맞추므로 로더 선택 UI 자체를 숨김
async function openCreateProfileForm(version, presetPreselect = null) {
  // 17차: "버전 눌렀을 때 작은 팝업창으로 떠야지" - 이제 목록 패널은 숨기지 않고 그대로 뒤에 남겨두고,
  // versionsCreatePanel을 CSS로 화면 중앙에 뜨는 작은 모달 오버레이로 보여줌 (style.css의
  // #versions-create-panel:not([hidden]) 규칙 참고)
  versionsCreatePanel.hidden = false;

  // 24-13차: "프리셋은 이름 정하기가 필요가 없다니까 빼" - 프리셋으로 만들 때는 이름 입력칸을
  // 아예 숨기지만(아래), 제출 버튼(btn-create-profile-submit)은 여전히 이 입력칸의 값을 그대로
  // 프로필 이름으로 씀 - 값 자체는 계속 채워둬야 하므로, 같은 프리셋으로 버전을 여러 개
  // 만들어도 이름이 겹치지 않게 버전까지 같이 넣어서 자동으로 정해줌
  document.getElementById("create-profile-name").value = presetPreselect
    ? `${presetPreselect.name} (${version})`
    : "";
  const descEl = document.getElementById("create-profile-description");
  if (descEl) descEl.value = "";
  const versionDisplay = document.getElementById("create-profile-version-display");
  if (versionDisplay) versionDisplay.textContent = version;

  createProfileIconTempPath = null;
  const iconImg = document.getElementById("create-profile-icon-img");
  const iconPlaceholder = document.getElementById("create-profile-icon-placeholder");
  if (iconImg) {
    iconImg.hidden = true;
    iconImg.src = "";
  }
  if (iconPlaceholder) iconPlaceholder.hidden = false;

  createProfileLoader = "fabric";
  document.querySelectorAll("#create-profile-loader-row .profile-add-loader-option").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.loader === "fabric");
  });
  updateVanillaLoaderWarning();

  const usePresetCheckbox = document.getElementById("create-profile-use-preset");
  const presetPicker = document.getElementById("create-profile-preset-picker");
  const presetSelect = document.getElementById("create-profile-preset-select");
  const presetRow = usePresetCheckbox?.closest(".setting-row");
  const loaderRow = document.getElementById("create-profile-loader-row");
  versionsCreatePanel.dataset.version = version;

  // 24-13차: "내가 프리셋은 페브릭 고정이라고 했지" - 로더 선택 버튼 자체는 예전부터 이미
  // presetPreselect일 때 hidden = true로 숨기고 있었는데, .profile-add-loader-row가
  // display:flex를 직접 지정해서 [hidden]보다 우선순위가 같아 이겨버리는(이 코드베이스에서
  // 반복돼온) 버그 때문에 실제로는 계속 보였음 - style.css에 명시적 override를 추가해서 고침
  // (JS 쪽은 원래도 맞는 로직이라 그대로 둠)
  //
  // "프리셋은 이름 아래 추가 부제목 쓰지마" - 프리셋으로 만들 때 보여주던 안내 문구
  // (create-profile-preset-preselect-note)를 완전히 없앰. 이미 프리셋 브라우징 단계에서
  // 어떤 프리셋/버전을 골랐는지 알고 들어온 화면이라 다시 알려줄 필요가 없었음
  const nameFieldEl = document.getElementById("create-profile-name");
  const presetNoteEl = document.getElementById("create-profile-preset-preselect-note");
  if (presetNoteEl) presetNoteEl.hidden = true;
  if (presetPreselect) {
    versionsCreatePanel.dataset.presetId = presetPreselect.id;
    if (presetRow) presetRow.hidden = true;
    if (presetPicker) presetPicker.hidden = true;
    if (loaderRow) loaderRow.hidden = true;
    if (nameFieldEl) nameFieldEl.hidden = true;
  } else {
    delete versionsCreatePanel.dataset.presetId;
    if (presetRow) presetRow.hidden = false;
    if (usePresetCheckbox) usePresetCheckbox.checked = false;
    if (presetPicker) presetPicker.hidden = true;
    if (loaderRow) loaderRow.hidden = false;
    if (nameFieldEl) nameFieldEl.hidden = false;

    // 이 버전에 맞는 프리셋만 골라서 옵션에 채워줌 (기존 방식 - 프리셋의 "원본 버전"과 정확히 같을 때만)
    if (presetSelect) {
      const presets = (await window.luna.listPresets()).filter((p) => p.mcVersion === version);
      presetSelect.innerHTML = presets.length
        ? presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
        : `<option value="">${window.NovaI18n?.t?.("preset_none_for_version") || "이 버전에 맞는 프리셋이 없어요"}</option>`;
    }
  }
}

document.getElementById("create-profile-use-preset")?.addEventListener("change", (e) => {
  const presetPicker = document.getElementById("create-profile-preset-picker");
  const loaderRow = document.getElementById("create-profile-loader-row");
  if (presetPicker) presetPicker.hidden = !e.target.checked;
  // 프리셋을 직접 골라 쓸 때도 프리셋 자동 선택 때와 마찬가지로 로더가 서버에서 fabric으로
  // 강제되므로, 체크한 동안은 로더 선택 UI를 같이 숨김
  if (loaderRow) loaderRow.hidden = e.target.checked;
});

// 16차: 아이콘 선택 + Vanilla/Fabric 로더 선택 (예전에 "프로필 추가" 팝업 안에 있던 걸
// Install의 버전-선택-후 화면으로 옮김)
let createProfileIconTempPath = null;
let createProfileLoader = "fabric";

document.getElementById("create-profile-icon-btn")?.addEventListener("click", async () => {
  const res = await window.luna.pickProfileIconTemp();
  if (!res || res.canceled || !res.ok) return;
  createProfileIconTempPath = res.filePath;
  const iconImg = document.getElementById("create-profile-icon-img");
  const iconPlaceholder = document.getElementById("create-profile-icon-placeholder");
  if (iconImg) {
    iconImg.src = res.previewUrl;
    iconImg.hidden = false;
  }
  if (iconPlaceholder) iconPlaceholder.hidden = true;
});

document.querySelectorAll("#create-profile-loader-row .profile-add-loader-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#create-profile-loader-row .profile-add-loader-option").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    createProfileLoader = btn.dataset.loader;
    updateVanillaLoaderWarning();
  });
});

// 24-43차 신규: "바닐라로 프로필 만들 때 초록색 경고문으로 Nova Client 기본 기능을 이용하실
// 수 없습니다 이런 거 작게띄워줘" - 로더로 Vanilla를 고른 동안에만 경고 배너를 보여주고,
// Fabric/Forge/NeoForge로 바꾸면 다시 숨김. 위 두 곳(패널 열릴 때 fabric으로 초기화될 때,
// 로더 버튼을 직접 클릭할 때)에서 호출함
function updateVanillaLoaderWarning() {
  const warningEl = document.getElementById("create-profile-vanilla-warning");
  if (warningEl) warningEl.hidden = createProfileLoader !== "vanilla";
}

// 24-13차: "다른 공간 눌러도 안꺼지잖아 창이" - 이 창(#versions-create-panel)이 어두운
// 배경 위에 뜨는 진짜 모달인데도, 그동안 "← 버전 목록으로" 버튼 말고는 닫을 방법이 없었음.
// 뒤로가기 버튼과 똑같은 로직을 함수로 빼서, 배경(카드 바깥) 클릭에도 같이 쓸 수 있게 함
function closeVersionsCreatePanel() {
  versionsCreatePanel.hidden = true;
  versionsListPanel.hidden = false;
  delete versionsCreatePanel.dataset.presetId;
  if (versionsCreatePanel.dataset.cameFromPresetBrowse === "1") {
    delete versionsCreatePanel.dataset.cameFromPresetBrowse;
    showPresetBrowseStep("version");
  } else {
    renderVersionsList();
  }
}
document.getElementById("btn-versions-back")?.addEventListener("click", closeVersionsCreatePanel);
// 카드(.versions-create-card) 바깥의 어두운 배경 부분을 직접 클릭했을 때만 닫음 - 카드 안쪽
// 클릭이 버블링돼서 올라온 경우(e.target이 카드 안의 자식 요소)는 무시해야 하므로 e.target이
// 패널 자기 자신일 때만(배경 자체를 클릭) 반응함
versionsCreatePanel?.addEventListener("click", (e) => {
  if (e.target === versionsCreatePanel) closeVersionsCreatePanel();
});

// ---- 16-3(4차): "프리셋으로 만들기" 브라우징 (카테고리 -> 프리셋 -> 버전, 참고 스크린샷 스타일) ----
let presetBrowseCategory = null;
let presetBrowsePreset = null;
let presetBrowseAllPresets = [];

// 13차: 카테고리 선택은 이제 versions-mode-version 화면 안에 인라인으로 있으므로,
// 여기서는 "list"(카테고리 안 프리셋 목록)/"version"(프리셋의 버전 목록) 두 단계만 다룸.
function showPresetBrowseStep(step) {
  document.getElementById("versions-mode-version").hidden = true;
  document.getElementById("versions-mode-preset-list").hidden = step !== "list";
  document.getElementById("versions-mode-preset-version").hidden = step !== "version";
  if (step === "list") renderPresetBrowseList();
  if (step === "version") renderPresetBrowseVersions();
}

async function renderPresetBrowseCategories() {
  const wrap = document.getElementById("preset-browse-category-list");
  wrap.classList.add("versions-list-major");
  presetBrowseAllPresets = await window.luna.listPresets();
  const categories = (await window.luna.presetCategories?.()) || ["PVP", "야생", "마인팜", "최적화", "낭만"];
  wrap.innerHTML = "";
  // 17차: "프리셋은 갯수가 아니야, 카테고리마다 그 프리셋 하나만 있어" - 카테고리 카드를 누르면
  // "프리셋 목록" 중간 단계 없이 바로 그 카테고리의 유일한 프리셋의 버전 선택 화면으로 이동함
  // 24-36차: "프로필 추가에서 프리셋도 애니메이션 좀 넣어줘" - renderVersionsList()에서 쓰는
  // 순차 페이드인(-rise 클래스 + 카드마다 늘어나는 animation-delay)을 여기(카테고리 카드
  // 목록)에도 똑같이 적용해서 프리셋 브라우징 화면도 버전 선택 화면과 동일하게 움직이게 함.
  let staggerIdx = 0;
  categories.forEach((cat) => {
    const preset = presetBrowseAllPresets.find((p) => p.category === cat) || null;
    const item = document.createElement("div");
    item.className = "version-item version-item-major version-item-rise";
    item.style.animationDelay = `${staggerIdx * 40}ms`;
    staggerIdx++;
    item.style.setProperty(
      "--v-bg-image",
      `url("assets/version-bg/${encodeURIComponent(cat)}.jpg"), url("assets/version-bg/default.jpg")`
    );
    const subLabel = preset
      ? escapeHtml(preset.name)
      : escapeHtml(window.NovaI18n?.t?.("preset_browse_none") || "아직 프리셋 없음");
    item.innerHTML = `<b>${escapeHtml(cat)}</b><span>${subLabel}</span>`;
    if (!preset) item.classList.add("is-disabled-soft");
    item.addEventListener("click", () => {
      if (!preset) {
        showToast("이 카테고리에는 아직 프리셋이 없어요.", "error");
        return;
      }
      presetBrowseCategory = cat;
      presetBrowsePreset = preset;
      showPresetBrowseStep("version");
    });
    wrap.appendChild(item);
  });
}

function renderPresetBrowseList() {
  document.getElementById("preset-browse-list-title").textContent =
    window.NovaI18n?.t?.("preset_browse_list_title", { category: presetBrowseCategory }) || `${presetBrowseCategory} 프리셋`;
  const wrap = document.getElementById("preset-browse-list");
  wrap.classList.remove("versions-list-major");
  const list = presetBrowseAllPresets.filter((p) => p.category === presetBrowseCategory);
  wrap.innerHTML = "";
  if (list.length === 0) {
    wrap.innerHTML = `<div class="mini-list-empty">${window.NovaI18n?.t?.("preset_browse_empty") || "이 카테고리에는 아직 프리셋이 없어요. 프리셋 관리 화면에서 먼저 만들어주세요."}</div>`;
    return;
  }
  // 24-36차: 위 카테고리 카드 목록과 동일한 순차 페이드인 적용
  let staggerIdx = 0;
  list.forEach((p) => {
    const item = document.createElement("div");
    item.className = "version-item version-item-rise";
    item.style.animationDelay = `${staggerIdx * 40}ms`;
    staggerIdx++;
    const n = (p.availableMcVersions || [p.mcVersion]).length;
    item.innerHTML = `<b>${escapeHtml(p.name)}</b><span>${n}개 버전</span>`;
    item.addEventListener("click", () => {
      presetBrowsePreset = p;
      showPresetBrowseStep("version");
    });
    wrap.appendChild(item);
  });
}

async function renderPresetBrowseVersions() {
  // 목록 화면에서 미리 받은 캐시가 최신이 아닐 수 있으니(생성 직후 백그라운드로 버전 계산이 끝났을
  // 수 있음) 다시 최신 목록을 받아와서 이 프리셋 항목만 갱신함
  const fresh = (await window.luna.listPresets()).find((p) => p.id === presetBrowsePreset.id);
  if (fresh) presetBrowsePreset = fresh;

  document.getElementById("preset-browse-version-title").textContent =
    window.NovaI18n?.t?.("preset_browse_version_title", { name: presetBrowsePreset.name }) || `"${presetBrowsePreset.name}" - 버전을 골라주세요`;
  const noteEl = document.getElementById("preset-browse-version-note");
  noteEl.textContent = presetBrowsePreset.versionGenerationNote || "";
  noteEl.hidden = !presetBrowsePreset.versionGenerationNote;

  const wrap = document.getElementById("preset-browse-version-list");
  wrap.innerHTML = "";
  const versions = presetBrowsePreset.availableMcVersions?.length
    ? presetBrowsePreset.availableMcVersions
    : [presetBrowsePreset.mcVersion];
  // 24-36차: 위 두 단계와 동일한 순차 페이드인 적용
  let staggerIdx = 0;
  versions.forEach((v) => {
    const item = document.createElement("div");
    item.className = "version-item version-item-major version-item-rise";
    item.style.animationDelay = `${staggerIdx * 40}ms`;
    staggerIdx++;
    item.style.setProperty(
      "--v-bg-image",
      `url("assets/version-bg/${v}.jpg"), url("assets/version-bg/default.jpg")`
    );
    // 24-11차: "자동 생성됨 문구 없애줘" - "원본 버전"/"자동 생성됨" 배지를 없애고
    // 다른 버전 카드들과 똑같이 심플하게 표시함
    item.innerHTML = `<b>${v}</b><span>Nova</span>`;
    item.addEventListener("click", async () => {
      versionsCreatePanel.dataset.cameFromPresetBrowse = "1";
      await openCreateProfileForm(v, { id: presetBrowsePreset.id, name: presetBrowsePreset.name, category: presetBrowsePreset.category });
    });
    wrap.appendChild(item);
  });
}

// 13차: "카테고리로" 버튼은 이제 별도 카테고리 화면이 아니라 맨 위(버전 목록 + 인라인 프리셋
// 카테고리 + 공유 코드) 화면으로 돌아감
document.getElementById("btn-preset-browse-back-category")?.addEventListener("click", () => {
  document.getElementById("versions-mode-preset-list").hidden = true;
  document.getElementById("versions-mode-preset-version").hidden = true;
  document.getElementById("versions-mode-version").hidden = false;
  renderPresetBrowseCategories();
});
// 17차: "list"(카테고리 안 프리셋 여러 개 목록) 단계는 이제 진입 경로가 없어졌으므로(카테고리당
// 프리셋이 하나뿐이라 카테고리 카드를 누르면 바로 버전 단계로 감), 버전 단계의 "뒤로" 버튼도
// 더 이상 존재하지 않는 목록 단계로 보내지 않고 카테고리 목록으로 바로 돌아가게 함.
document.getElementById("btn-preset-browse-back-list")?.addEventListener("click", () => {
  document.getElementById("versions-mode-preset-list").hidden = true;
  document.getElementById("versions-mode-preset-version").hidden = true;
  document.getElementById("versions-mode-version").hidden = false;
  renderPresetBrowseCategories();
});
// 17차: 공유 코드 입력창에 타이핑/붙여넣기할 때마다(디바운스) 미리보기를 먼저 보여주고,
// 미리보기가 성공했을 때만 "불러오기" 버튼을 드러냄. 코드가 바뀌면 이전 미리보기 결과는
// 즉시 무효화(importProfileLastPreviewedCode로 추적)해서 오래된 미리보기 상태로 잘못
// 불러오는 일이 없게 함.
let importProfileLastPreviewedCode = null;
let importProfilePreviewTimer = null;

function renderImportProfilePreview(res, code) {
  const wrap = document.getElementById("import-profile-preview");
  const btn = document.getElementById("btn-import-profile");
  if (!wrap || !btn) return;
  if (!res || !res.ok) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    btn.hidden = true;
    importProfileLastPreviewedCode = null;
    if (res && res.error && code) showToast(res.error, "error");
    return;
  }
  importProfileLastPreviewedCode = code;
  const fileCount = (res.modFiles?.length || 0) + (res.resourcepackFiles?.length || 0) + (res.shaderFiles?.length || 0);
  wrap.hidden = false;
  wrap.innerHTML = `
    ${res.iconUrl ? `<img src="${res.iconUrl}" class="shared-profile-inline-preview-icon" />` : `<div class="shared-profile-inline-preview-icon shared-profile-preview-icon-fallback">${escapeHtml((res.name || "?").slice(0, 1))}</div>`}
    <div class="shared-profile-inline-preview-info">
      <div class="shared-profile-inline-preview-name">${escapeHtml(res.name)}</div>
      <div class="shared-profile-inline-preview-meta">${escapeHtml(res.mcVersion)} · Nova · 파일 ${fileCount}개${res.author ? ` · by ${escapeHtml(res.author)}` : ""}</div>
    </div>
  `;
  btn.hidden = false;
}

document.getElementById("import-profile-code")?.addEventListener("input", (e) => {
  const code = e.target.value.trim();
  clearTimeout(importProfilePreviewTimer);
  if (!code || code.length < 4) {
    renderImportProfilePreview(null, null);
    return;
  }
  importProfilePreviewTimer = setTimeout(async () => {
    const stillCurrent = () => document.getElementById("import-profile-code")?.value.trim() === code;
    const res = await window.luna.previewSharedProfile(code);
    if (!stillCurrent()) return; // 그 사이 입력이 더 바뀌었으면 이 결과는 버림
    renderImportProfilePreview(res, code);
  }, 400);
});

document.getElementById("btn-import-profile")?.addEventListener("click", async () => {
  const code = document.getElementById("import-profile-code").value.trim();
  if (!code || code !== importProfileLastPreviewedCode) return;
  const res = await window.luna.importProfile(code);
  if (res.ok) {
    showToast(`"${res.profile.name}" 프로필을 불러왔어요`);
    document.getElementById("import-profile-code").value = "";
    renderImportProfilePreview(null, null);
    showAppPanel("view-home");
    setActiveSidebarIcon("launch");
    await window.luna.selectProfile(res.profile.id);
    if (profileChipName) profileChipName.textContent = res.profile.name;
    updateMcVersionLabel(res.profile.mcVersion);
    refreshChipActiveStates();
    await refreshLaunchTargetLists(); // 24-48차: 서버 선택 표시도 같이 정리
  } else {
    showToast(res.error || "불러오기 실패", "error");
  }
});
document.getElementById("btn-create-profile-submit")?.addEventListener("click", async () => {
  const version = versionsCreatePanel.dataset.version;
  const name = document.getElementById("create-profile-name").value.trim();
  if (!name) {
    showToast(window.NovaI18n?.t?.("toast_profile_name_required") || "프로필 이름을 입력해주세요", "error");
    return;
  }
  const usePreset = document.getElementById("create-profile-use-preset")?.checked;
  const presetId =
    versionsCreatePanel.dataset.presetId ||
    (usePreset ? document.getElementById("create-profile-preset-select")?.value || null : null);
  // 16차: 메모리/해상도/전체화면/JVM 인수는 이 화면에서 더는 고르지 않음 - main.js의
  // profiles:create가 생략된 값들에 알아서 기본값을 채워주고, 나중에 프로필 설정에서
  // 언제든 바꿀 수 있음
  const btn = document.getElementById("btn-create-profile-submit");
  await withBusyButton(btn, "만드는 중...", async () => {
    const res = await window.luna.createProfile({
      name,
      mcVersion: version,
      loader: createProfileLoader,
      iconTempPath: createProfileIconTempPath,
      presetId,
      // 17차: "프로필마다 만들 때 설명 적을 수 있게 해줘"
      description: document.getElementById("create-profile-description")?.value || "",
    });
    if (res.ok) {
      showToast(
        res.profile.fromPreset
          ? `"${res.profile.name}" 프로필을 프리셋으로 만들었어요`
          : `"${res.profile.name}" 프로필을 만들었어요 (모드/리소스팩은 직접 추가해주세요)`
      );
      showAppPanel("view-home");
      setActiveSidebarIcon("launch");
      // 만들자마자 바로 그 프로필로 전환
      await window.luna.selectProfile(res.profile.id);
      if (profileChipName) profileChipName.textContent = res.profile.name;
      updateMcVersionLabel(res.profile.mcVersion);
      refreshChipActiveStates();
      // 17차 버그 수정: "새로 만든 프로필이 Play에 바로 안 뜨고, 프로필을 한 번 전환해야만
      // 나타난다" - Play 화면의 프로필 목록(profile-list-items)은 lastProfilesData 캐시를
      // 다시 그리는 방식인데, 프로필을 새로 만든 직후엔 이 캐시를 다시 불러오는 코드가
      // 없어서 목록이 새 프로필 없이 예전 그대로 남아있었음 - 새로 만든 직후에도 다시 불러옴
      // 24-48차: 서버 목록도 같이 불러와서, 새 프로필로 자동 전환되며 풀린 서버 선택 표시를 정리
      await refreshLaunchTargetLists();
    } else {
      showToast(res.error || "프로필 생성 실패", "error");
    }
  });
});

// ---- 프로필 관리 화면 (목록 -> 편집 2단계) --------------------------------------
const profileManageOverlay = document.getElementById("view-profile-manage");
const profileListBody = document.getElementById("profile-list-body");
const profileEditBody = document.getElementById("profile-edit-body");
let managingProfileId = null;
// 5-10(7차): 헤더의 Play/설정(톱니바퀴)/⋮ 메뉴와 설정 모달/공유 모달이 다시 서버를 안 거치고
// 바로 쓸 수 있게, 지금 편집 중인 프로필 전체 객체를 캐시해둠 (openProfileEdit에서 최신으로 갱신)
let currentEditProfile = null;

let lastManageProfilesData = [];

// 24-2차 신규: Forge/NeoForge 지원 추가로 로더가 4가지가 됐으므로, 프로필의 loader 필드를
// 화면에 보여줄 이름으로 바꿔주는 공용 헬퍼 (기존 프로필처럼 loader 필드가 아예 없으면 Fabric)
function loaderDisplayName(loader) {
  if (loader === "vanilla") return "Vanilla";
  if (loader === "forge") return "Forge";
  if (loader === "neoforge") return "NeoForge";
  // 24-11차: "버전 옆에 Fabric 대신 Nova 브랜딩으로" - 런처 자체 프로필(Fabric 기반)
  // 표기를 "Nova"로 바꿈. 실제 Modrinth 모드 파일의 로더 호환 표시(Contents 화면 등)는
  // 그대로 "Fabric"을 씀 - 그건 실제 파일 호환성 정보라서 브랜딩과 무관함
  return "Nova";
}

function renderProfileManageGrid() {
  const query = (document.getElementById("profile-manage-search")?.value || "").trim().toLowerCase();
  const sortBtn = document.getElementById("profile-manage-sort-btn");
  const sortMode = sortBtn?.dataset.sort || "recent";

  let profiles = lastManageProfilesData.filter((p) => !query || p.name.toLowerCase().includes(query));
  profiles = profiles.slice().sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name, "ko");
    const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0;
    const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0;
    return bt - at;
  });

  const grid = document.getElementById("profile-manage-grid");
  grid.innerHTML = "";

  if (lastManageProfilesData.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; color:var(--text-2); font-size:12.5px;">아직 만든 프로필이 없어요. Install에서 먼저 만들어주세요.</div>`;
  } else if (profiles.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; color:var(--text-2); font-size:12.5px;">검색 결과가 없어요.</div>`;
  }
  profiles.forEach((p) => {
    const card = document.createElement("div");
    card.className = "profile-card";
    const iconHtml = p.iconUrl
      ? `<img class="profile-card-icon-img" src="${p.iconUrl}" alt="" />`
      : `<div class="profile-card-icon">${p.name.charAt(0).toUpperCase()}</div>`;
    card.innerHTML = `
      ${iconHtml}
      <div class="profile-card-name">${escapeHtml(p.name)}</div>
      <div class="profile-card-version">${escapeHtml(p.mcVersion)} · ${loaderDisplayName(p.loader)}</div>
    `;
    card.addEventListener("click", () => openProfileEdit(p.id));
    grid.appendChild(card);
  });

  // 마지막에 "+" 카드 - 16차: 이 카드가 "프로필 추가" 진입점이라, 3가지 선택지 팝업
  // (커스텀 프로필/모드팩 찾기/모드팩 업로드)이 여기서 떠야 함(Install 아이콘은 그냥
  // 바로 버전 목록으로 감 - 위 사이드바 클릭 핸들러 참고)
  const addCard = document.createElement("div");
  addCard.className = "profile-card profile-card-add";
  addCard.title = "프로필 추가";
  addCard.innerHTML = `
    <div class="profile-card-add-icon">+</div>
    <div class="profile-card-name">새 프로필</div>
  `;
  addCard.addEventListener("click", () => {
    openProfileAddOverlay();
  });
  grid.appendChild(addCard);
}

// 17차: "프로필 리스트 볼 때 박스 크기를 고를 수 있게 해줘" - 기본/갤러리/자세히보기 3가지
// 보기 방식. 서버까지 갈 일이 아니라 이 컴퓨터에서만 기억하면 되는 취향이라 localStorage에 저장
const PROFILE_VIEW_MODE_KEY = "novaClientProfileViewMode";
function getStoredProfileViewMode() {
  try {
    const v = localStorage.getItem(PROFILE_VIEW_MODE_KEY);
    return v === "gallery" || v === "list" ? v : "default";
  } catch {
    return "default";
  }
}
function applyProfileViewMode(mode) {
  const grid = document.getElementById("profile-manage-grid");
  if (grid) {
    grid.classList.toggle("view-gallery", mode === "gallery");
    grid.classList.toggle("view-list", mode === "list");
  }
  document.querySelectorAll(".profile-view-mode-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === mode);
  });
  try { localStorage.setItem(PROFILE_VIEW_MODE_KEY, mode); } catch {}
}
document.querySelectorAll(".profile-view-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyProfileViewMode(btn.dataset.view));
});
applyProfileViewMode(getStoredProfileViewMode());

document.getElementById("profile-manage-search")?.addEventListener("input", renderProfileManageGrid);
document.getElementById("profile-manage-sort-btn")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const next = btn.dataset.sort === "recent" ? "name" : "recent";
  btn.dataset.sort = next;
  btn.textContent = window.NovaI18n?.t?.(next === "recent" ? "sort_by_recent" : "sort_by_name") || (next === "recent" ? "최근 플레이순" : "이름순");
  renderProfileManageGrid();
});

// 9차: "내 프로필"/"프리셋 관리" 상위 탭에도 슬라이딩 하이라이트 적용
const profileToplevelPill = mountSlidingPill(document.querySelector(".profile-manage-toplevel-tabs"), "slide-pill-profile-toplevel");
function updateProfileToplevelPill(instant) {
  const active = document.querySelector(".profile-manage-toplevel-tab.is-active:not([hidden])");
  profileToplevelPill.update(active, instant);
}

async function openProfileList() {
  // 14차: "내 프로필" 탭과 같은 뜻을 반복하던 "Profile" 타이틀은 이 화면에선 아예 숨김
  document.getElementById("profile-manage-title").hidden = true;
  // 22차: 편집 화면에서 넘어올 때 숨겼던 상위 탭을 다시 보이게 함
  const toplevelTabsEl = document.querySelector(".profile-manage-toplevel-tabs");
  if (toplevelTabsEl) toplevelTabsEl.hidden = false;
  profileListBody.hidden = false;
  profileEditBody.hidden = true;
  document.getElementById("preset-manage-body").hidden = true;
  document.querySelectorAll(".profile-manage-toplevel-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.toplevel === "profiles"));
  requestAnimationFrame(() => updateProfileToplevelPill(true));

  // 프리셋은 관리자(개발자 계정)만 만들 수 있어서, "프리셋 관리" 탭 자체를 일반 유저에게는 숨김
  // (프리셋을 고르는 건 새 프로필 만들기 화면에서 계속 다 할 수 있음 - 여긴 "만들기" 전용 탭)
  const isAdminUser = !!(await window.luna.isAdmin?.());
  const presetTabBtn = document.querySelector('.profile-manage-toplevel-tab[data-toplevel="presets"]');
  if (presetTabBtn) presetTabBtn.hidden = !isAdminUser;
  // 24-11차: "이 화면 우측 상단에 '내 프로필' 표시가 왜 있는 거야" - 일반 유저는 "프리셋
  // 관리" 탭이 없어서 "내 프로필" 하나만 덩그러니 떠 있었음(이미 이 화면 자체가 "내
  // 프로필" 목록이라 의미 중복). 전환할 다른 탭이 있는 관리자만 이 탭 묶음을 보여줌
  if (toplevelTabsEl) toplevelTabsEl.hidden = !isAdminUser;

  lastManageProfilesData = await window.luna.listProfiles();
  renderProfileManageGrid();

  showAppPanel("view-profile-manage");
}

// ---- 16-2(4차): 독립된 "프리셋 관리" 화면 -------------------------------------
async function openPresetManage(preselectProfileId = null) {
  // 방어적 체크: 탭/버튼은 숨겨두지만, 혹시 모를 경로로 호출되더라도 관리자가 아니면
  // 여기서 한 번 더 막고 "내 프로필" 화면으로 되돌림
  if (!(await window.luna.isAdmin?.())) {
    showToast("프리셋 관리는 관리자만 사용할 수 있어요.");
    openProfileList();
    return;
  }

  // 14차: "프리셋 관리" 탭과 같은 뜻을 반복하던 타이틀도 이 화면에선 숨김
  document.getElementById("profile-manage-title").hidden = true;
  // 22차: 편집 화면에서 넘어올 때 숨겼던 상위 탭을 다시 보이게 함
  document.querySelector(".profile-manage-toplevel-tabs").hidden = false;
  profileListBody.hidden = true;
  profileEditBody.hidden = true;
  document.getElementById("preset-manage-body").hidden = false;
  document.querySelectorAll(".profile-manage-toplevel-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.toplevel === "presets"));
  requestAnimationFrame(() => updateProfileToplevelPill(true));

  const sourceSelect = document.getElementById("preset-create-source");
  const allProfiles = await window.luna.listProfiles();
  // 24-11차: "프리셋은 Fabric 프로필로만 만들 수 있어야지, 바닐라 같은 걸로 만들면 안 되지" -
  // 로더가 없으면(예전 프로필) Fabric으로 간주하고, 그 외 로더(Vanilla/Forge/NeoForge)
  // 프로필은 프리셋 소스 목록에서 아예 제외함
  const profiles = allProfiles.filter((p) => (p.loader || "fabric") === "fabric");
  sourceSelect.innerHTML = profiles.length
    ? profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.mcVersion)})</option>`).join("")
    : `<option value="">Fabric 프로필이 없어요 - 먼저 만들어주세요</option>`;
  if (preselectProfileId) sourceSelect.value = preselectProfileId;

  const catPicker = document.getElementById("preset-create-category-picker");
  const categories = (await window.luna.presetCategories?.()) || ["PVP", "야생", "마인팜", "최적화", "낭만"];
  catPicker.innerHTML = categories
    .map((c, i) => `<button type="button" class="preset-category-chip${i === 0 ? " is-active" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");
  catPicker.querySelectorAll(".preset-category-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      catPicker.querySelectorAll(".preset-category-chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
    });
  });

  document.getElementById("preset-create-name").value = "";
  document.getElementById("preset-create-include-resourcepack").checked = false;
  document.getElementById("preset-create-include-shader").checked = false;

  await renderPresetManageList();
  showAppPanel("view-profile-manage");
}

async function renderPresetManageList() {
  const listEl = document.getElementById("preset-manage-list");
  const presets = await window.luna.listPresets();
  listEl.innerHTML = "";
  if (presets.length === 0) {
    listEl.innerHTML = `<div class="mini-list-empty">아직 만든 프리셋이 없어요.</div>`;
    return;
  }
  presets.forEach((p) => {
    const row = document.createElement("div");
    row.className = "preset-manage-row";
    const n = (p.availableMcVersions || [p.mcVersion]).length;
    row.innerHTML = `
      <span class="preset-manage-row-category">${escapeHtml(p.category || "-")}</span>
      <div class="preset-manage-row-info">
        <div class="preset-manage-row-name">${escapeHtml(p.name)}</div>
        <div class="preset-manage-row-meta">원본 ${escapeHtml(p.mcVersion)} · ${n}개 버전 지원${(() => {
          const rp = p.includeResourcepack !== undefined ? p.includeResourcepack : p.includeOptional;
          const sh = p.includeShader !== undefined ? p.includeShader : p.includeOptional;
          const parts = [];
          if (rp) parts.push("리소스팩");
          if (sh) parts.push("쉐이더");
          return parts.length ? ` · ${parts.join("/")} 포함` : "";
        })()}</div>
      </div>
      <button type="button" class="btn btn-danger-filled btn-small">삭제</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const confirmed = await showConfirm(`"${p.name}" 프리셋을 삭제할까요?`, "삭제", "취소");
      if (!confirmed) return;
      const res = await window.luna.deletePreset(p.id);
      if (res.ok) {
        showToast("프리셋을 삭제했어요");
        renderPresetManageList();
      } else {
        showToast(res.error || "삭제 실패", "error");
      }
    });
    listEl.appendChild(row);
  });
}

document.getElementById("btn-preset-create-submit")?.addEventListener("click", async () => {
  const profileId = document.getElementById("preset-create-source").value;
  const name = document.getElementById("preset-create-name").value.trim();
  const category = document.getElementById("preset-create-category-picker").querySelector(".preset-category-chip.is-active")?.dataset.category;
  const includeResourcepack = document.getElementById("preset-create-include-resourcepack").checked;
  const includeShader = document.getElementById("preset-create-include-shader").checked;
  if (!profileId) {
    showToast("소스로 쓸 프로필이 없어요", "error");
    return;
  }
  if (!name) {
    showToast("프리셋 이름을 입력해주세요", "error");
    return;
  }
  const btn = document.getElementById("btn-preset-create-submit");
  await withBusyButton(btn, "만드는 중...", async () => {
    const res = await window.luna.createPreset(profileId, name, category, includeResourcepack, includeShader);
    if (res.ok) {
      showToast(`"${res.preset.name}" 프리셋을 만들었어요. 다른 버전용은 백그라운드에서 자동으로 계산돼요`);
      document.getElementById("preset-create-name").value = "";
      await renderPresetManageList();
    } else {
      showToast(res.error || "프리셋 생성 실패", "error");
    }
  });
});

document.querySelectorAll(".profile-manage-toplevel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.toplevel === "presets") openPresetManage();
    else openProfileList();
  });
});

async function openProfileEdit(profileId) {
  const profiles = await window.luna.listProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return;
  managingProfileId = profileId;
  currentEditProfile = profile;

  // 22차: "프로필 수정에서 이름이랑 이거(내 프로필/프리셋 관리 탭) 없애고 위로 올려" -
  // 14차 때는 이 타이틀이 "지금 어떤 프로필을 편집 중인지" 알려주는 유일한 표시였는데, 지금은
  // 히어로 행의 이름 입력칸(#manage-profile-name-input)이 이미 그 역할을 하고 있어서 중복임.
  // 목록/프리셋관리 화면과 공유하는 상위 탭도 편집 중엔 뜰 이유가 없으므로 같이 숨기고,
  // 그만큼 위쪽 여백도 접혀서(.modal-header:has 규칙, style.css) 본문이 위로 당겨짐
  const titleEl = document.getElementById("profile-manage-title");
  titleEl.hidden = true;
  titleEl.textContent = profile.name;
  document.querySelector(".profile-manage-toplevel-tabs").hidden = true;
  profileListBody.hidden = true;
  profileEditBody.hidden = false;
  document.getElementById("preset-manage-body").hidden = true;

  // "프리셋 관리에서 이 구성으로 만들기" 버튼도 프리셋 생성이 관리자 전용이라서 같이 숨김
  const gotoPresetBtn = document.getElementById("btn-manage-profile-goto-preset");
  if (gotoPresetBtn) gotoPresetBtn.hidden = !(await window.luna.isAdmin?.());

  const nameInputEl = document.getElementById("manage-profile-name-input");
  nameInputEl.value = profile.name;
  // 17차: "디폴트는 이름 변경 불가능하게 해줘" - main.js(profiles:update)가 이미 기본 프로필의
  // 이름 변경 요청을 조용히 무시하고 있었는데, 입력칸은 계속 수정 가능해 보여서 사용자가
  // 이름을 바꾸고 blur해도 왜 그대로인지 알 수 없었음. 아예 읽기 전용으로 잠그고 이유를 알려줌
  nameInputEl.readOnly = !!profile.isDefault;
  nameInputEl.title = profile.isDefault ? "기본 프로필은 이름을 바꿀 수 없어요" : "";
  document.getElementById("manage-profile-icon-preview").src = profile.iconUrl || "";

  // 5-10(7차): 참고 스크린샷처럼 부제 한 줄에 로더/버전 · 마지막 플레이를 같이 표시
  // (플레이타임은 아직 이 앱이 추적하는 데이터가 아니라서 뺌 - 보고서에 명시)
  // 15차: 프로필마다 로더(Vanilla/Fabric)를 고를 수 있게 되면서, 예전처럼 항상 "Fabric"으로
  // 고정 표시하지 않고 실제 프로필의 loader 값을 그대로 보여줌 (필드가 없는 옛날 프로필은
  // 하위호환으로 Fabric 취급)
  const isVanillaProfile = profile.loader === "vanilla";
  document.getElementById("manage-profile-version-label").textContent = `${loaderDisplayName(profile.loader)} · Minecraft ${profile.mcVersion}`;
  document.getElementById("manage-profile-lastplayed").textContent = profile.lastPlayedAt
    ? `· 마지막 플레이: ${formatRelativeTime(profile.lastPlayedAt)}`
    : "· 아직 플레이한 적 없어요";

  // 15차: "바닐라 프로필은 모드 추가에 안뜨게 해줘 리소스팩만 뜨게" - 모드/쉐이더팩 탭 자체를
  // 숨기고, 지금 그 탭이 활성 상태였으면 리소스팩 탭으로 강제 전환함
  const modsTabBtn = document.querySelector('.profile-file-tab[data-tab="mods"]');
  const shaderTabBtn = document.querySelector('.profile-file-tab[data-tab="shaderpacks"]');
  // 17차: 바닐라 프로필은 어차피 리소스팩밖에 없어서 "전체" 탭도 리소스팩 탭과 똑같아지므로 같이 숨김
  const allTabBtn = document.querySelector('.profile-file-tab[data-tab="all"]');
  if (modsTabBtn) modsTabBtn.hidden = isVanillaProfile;
  if (shaderTabBtn) shaderTabBtn.hidden = isVanillaProfile;
  if (allTabBtn) allTabBtn.hidden = isVanillaProfile;

  // Default 프로필은 삭제 불가 배지 표시 + 삭제 버튼 잠금
  const defaultBadge = document.getElementById("manage-profile-default-badge");
  const deleteBtn = document.getElementById("btn-manage-profile-delete");
  if (defaultBadge) defaultBadge.hidden = !profile.isDefault;
  if (deleteBtn) {
    deleteBtn.disabled = !!profile.isDefault;
    deleteBtn.textContent = profile.isDefault ? "Default 프로필은 삭제할 수 없어요" : "이 프로필 삭제";
  }

  // 2-4(7차): 공유받은(불러온) 프로필이면 "Made by {원작자}" 표시
  const importedBadge = document.getElementById("manage-profile-imported-badge");
  if (importedBadge) {
    if (profile.importedFrom && profile.importedAuthor) {
      importedBadge.hidden = false;
      importedBadge.textContent = `Made by ${profile.importedAuthor}`;
    } else {
      importedBadge.hidden = true;
      importedBadge.textContent = "";
    }
  }

  // 탭은 항상 "모드" 탭으로 초기화 (단, 바닐라 프로필은 모드 탭 자체가 없으니 리소스팩으로)
  setProfileFileTab(isVanillaProfile ? "resourcepacks" : "mods");

  await refreshProfileFileList("mods");
  await refreshProfileFileList("resourcepacks");
  await refreshProfileFileList("shaderpacks");
  await refreshModsUpdateIndicator();
}

// 1-11: 모드/리소스팩/쉐이더 탭 전환
function setProfileFileTab(tab) {
  document.querySelectorAll(".profile-file-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });
  // 17차: "전체" 탭 추가 - 다른 3개 종류 패널과 같은 방식으로 보이기/숨기기 토글
  ["all", "mods", "resourcepacks", "shaderpacks"].forEach((kind) => {
    const panel = document.getElementById(`profile-file-panel-${kind}`);
    if (panel) panel.hidden = kind !== tab;
  });
  // 14차: "파일 업로드/모드 추가는 검색 옆으로, 이름순/전체선택/새로고침은 탭 옆으로" -
  // 종류별 버튼 묶음을 패널 밖(검색줄/탭줄)으로 옮기면서, 패널과 같이 자동으로 숨겨지지
  // 않게 됐으므로 여기서 같이 토글해줌
  document.querySelectorAll(".manage-toolbar-kind-group").forEach((el) => {
    el.hidden = el.dataset.kind !== tab;
  });
  // 10차: 검색창이 탭 3개 공용이 됐으니, 탭을 바꿀 때 이전 탭에서 치던 검색어가 남아있지
  // 않게 비우고, placeholder만 지금 탭에 맞게 바꿔줌
  const sharedSearch = document.getElementById("manage-shared-search");
  if (sharedSearch) {
    sharedSearch.value = "";
    sharedSearch.placeholder = MANAGE_SEARCH_PLACEHOLDER_BY_KIND[tab] || "검색";
  }
  // 17차: "전체" 탭은 모드/리소스팩/쉐이더 3개 캐시를 합쳐서 그리는 별도 함수를 씀
  if (tab === "all") renderAllProfileFilesList();
  else renderProfileFileListFromCache(tab);
}
document.querySelectorAll(".profile-file-tab").forEach((btn) => {
  btn.addEventListener("click", () => setProfileFileTab(btn.dataset.tab));
});

// 1-14: 업데이트 가능한 모드가 있을 때만 "전체 업데이트" 버튼 자체를 보여줌
// 10차: 예전엔 버튼이 항상 떠 있고 초록 점만 붙었는데, "업데이트도 있을 때에만 뜨고"라는
// 피드백으로 없을 땐 버튼 자체를 숨김
async function refreshModsUpdateIndicator() {
  const btn = document.getElementById("btn-manage-mods-update");
  if (!btn) return;
  btn.hidden = true;
  try {
    const updates = await window.luna.exploreCheckUpdates(managingProfileId, "mods");
    if (updates.length > 0) btn.hidden = false;
  } catch (_) {}
}

document.getElementById("btn-profile-edit-back")?.addEventListener("click", openProfileList);

// 5-10(7차): 이름 입력창은 이제 헤더에 인라인으로만 있고 따로 "저장" 버튼이 없으므로,
// 포커스를 벗어날 때(blur) 바뀐 값만 조용히 저장함
document.getElementById("manage-profile-name-input")?.addEventListener("blur", async (e) => {
  const name = e.target.value.trim();
  if (!name || !managingProfileId || name === currentEditProfile?.name) return;
  const res = await window.luna.updateProfile({ id: managingProfileId, name });
  if (res.ok) {
    currentEditProfile = res.profile;
    document.getElementById("profile-manage-title").textContent = res.profile.name;
    if (profileChipName) {
      window.luna.listProfiles().then((profiles) => {
        const sel = profiles.find((p) => p.selected);
        if (sel && sel.id === managingProfileId) profileChipName.textContent = res.profile.name;
      });
    }
  } else {
    showToast(res.error || "이름 저장 실패", "error");
  }
});

// 14차: "프로필 수정에서 플레이 버튼 없애줘" - 헤더의 즉시 실행 버튼과 그 핸들러를 제거함
// (실행은 홈 화면의 서버/프로필 목록에서 하는 걸로 통일)

// ---- 5-10(7차): 헤더 ⋮ 메뉴 - 공유 / 폴더 열기 / 바로가기 만들기 --------------------------
const profileHeroKebabMenu = document.getElementById("profile-hero-kebab-menu");
document.getElementById("btn-profile-hero-kebab")?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.querySelectorAll(".dropdown-select-menu").forEach((m) => {
    if (m !== profileHeroKebabMenu) m.hidden = true;
  });
  if (profileHeroKebabMenu) profileHeroKebabMenu.hidden = !profileHeroKebabMenu.hidden;
});
document.addEventListener("click", (e) => {
  if (!profileHeroKebabMenu || profileHeroKebabMenu.hidden) return;
  if (!profileHeroKebabMenu.contains(e.target) && e.target !== document.getElementById("btn-profile-hero-kebab")) {
    profileHeroKebabMenu.hidden = true;
  }
});
document.getElementById("btn-hero-open-folder")?.addEventListener("click", () => {
  profileHeroKebabMenu.hidden = true;
  window.luna.openProfileFolder?.(managingProfileId);
});
document.getElementById("btn-hero-shortcut")?.addEventListener("click", async () => {
  profileHeroKebabMenu.hidden = true;
  const res = await window.luna.createProfileShortcut(managingProfileId);
  if (res.ok) {
    // 5-8(5차): 프로필 아이콘을 못 쓰고 기본 앱 아이콘으로 폴백한 경우(형식 문제/256px 초과 등)
    // 조용히 넘어가지 않고 이유를 같이 알려줌
    if (res.iconFallback) showToast(`바로가기를 만들었어요 (${res.iconFallback})`);
    else showToast("바탕화면에 바로가기를 만들었어요");
  } else {
    showToast(res.error || "바로가기 생성 실패", "error");
  }
});
document.getElementById("btn-hero-share")?.addEventListener("click", () => {
  profileHeroKebabMenu.hidden = true;
  openProfileShareModal();
});
// 22차: "프로필 그 ...에서 .mrpack으로 뽑는 모드팩 파일로 만드는 기능도 만들어줘" - 지금
// 프로필 구성을 표준 Modrinth 모드팩(.mrpack) 파일로 저장함
document.getElementById("btn-hero-export-modpack")?.addEventListener("click", async () => {
  profileHeroKebabMenu.hidden = true;
  const btn = document.getElementById("btn-hero-export-modpack");
  if (!managingProfileId) return;
  await withBusyButton(btn, "내보내는 중...", async () => {
    const res = await window.luna.exportModpack(managingProfileId);
    if (res.canceled) return;
    if (res.ok) {
      showToast(`모드팩으로 내보냈어요 (${res.linkedCount + res.bundledCount}개 파일)`);
    } else {
      showToast(res.error || "모드팩 내보내기 실패", "error");
    }
  });
});

// ---- 5-12(7차): 프로필 설정(톱니바퀴) 작은 모달 ----------------------------------------
const profileSettingsOverlay = document.getElementById("profile-settings-overlay");

// 23차: "설정처럼 해달라고" - 메인 설정 팝업(showSettingsCategory, 위 참고)과 똑같은
// 사이드바 카테고리 전환을 여기도 넣되, 클래스/함수 이름은 완전히 분리해서 서로 안 건드리게 함
const profileSettingsNavPill = mountSlidingPill(document.querySelector(".profile-settings-nav"), "slide-pill-profile-settings-nav");
function updateProfileSettingsNavPill() {
  const active = document.querySelector(".profile-settings-nav-item.is-active");
  profileSettingsNavPill.update(active, true);
}
function showProfileSettingsCategory(cat) {
  document.querySelectorAll(".profile-settings-nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.pcat === cat);
  });
  document.querySelectorAll(".profile-settings-panel-section").forEach((sec) => {
    sec.classList.toggle("is-active", sec.dataset.pcatPanel === cat);
  });
  updateProfileSettingsNavPill();
}
document.querySelectorAll(".profile-settings-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => showProfileSettingsCategory(btn.dataset.pcat));
});

async function openProfileSettingsModal() {
  if (!managingProfileId) return;
  const profile = currentEditProfile || (await window.luna.listProfiles()).find((p) => p.id === managingProfileId);
  if (!profile) return;
  currentEditProfile = profile;

  document.getElementById("manage-profile-memory").value = profile.memoryGB;
  document.getElementById("manage-profile-memory-value").textContent = profile.memoryGB + "GB";
  document.getElementById("manage-profile-width").value = profile.width;
  document.getElementById("manage-profile-height").value = profile.height;
  document.getElementById("manage-profile-fullscreen").checked = profile.fullscreen;
  document.getElementById("manage-profile-jvmargs").value = profile.jvmArgs || "";
  // 17차: "프로필마다 수정할 때 설명 적을 수 있게 해줘"
  const descEl = document.getElementById("manage-profile-description");
  if (descEl) descEl.value = profile.description || "";

  // 2-4(7차): 공유받은(불러온) 프로필에서만 "업데이트 연동" 토글 표시
  const syncRow = document.getElementById("manage-profile-updatesync-row");
  if (syncRow) syncRow.hidden = !profile.importedFrom;
  const syncCheckbox = document.getElementById("manage-profile-updatesync");
  if (syncCheckbox) syncCheckbox.checked = profile.updateSync !== false;

  // 2-5(7차): 공유 코드를 만든 원작자(shareCode가 있는 프로필)에서만 "프로필 갱신" 표시
  const refreshBtn = document.getElementById("btn-manage-profile-refresh-share");
  if (refreshBtn) refreshBtn.hidden = !profile.shareCode;

  // 7-2 자바 정보 재사용: 이 프로필 버전을 담당하는 자바 항목을 찾아서 읽기 전용으로 표시
  // 22차: "위치는 너무 길어서 뒤에는 그냥 ...으로 처리하고 복사되게 바꿔주고 너무 눈에
  // 띄면 안돼" - 실제 설치 경로가 있을 때만 클릭해서 복사할 수 있게 하고(.is-copyable),
  // 그 외(확인 중/정보 없음/설치 전) 상태는 그냥 평범한 읽기전용 텍스트로 둠
  const javaInfoEl = document.getElementById("manage-profile-java-info");
  if (javaInfoEl) {
    javaInfoEl.classList.remove("is-copyable");
    javaInfoEl.removeAttribute("title");
    delete javaInfoEl.dataset.copyValue;
    javaInfoEl.textContent = "확인하는 중...";
    window.luna.getJavaInfo().then((list) => {
      const entry = (list || []).find((e) => (e.mcVersions || []).includes(profile.mcVersion));
      if (!entry) {
        javaInfoEl.textContent = "정보 없음";
      } else if (!entry.installed) {
        javaInfoEl.textContent = `JRE ${entry.javaFeatureVersion} · 아직 설치 안 됨 (처음 실행할 때 자동 설치)`;
      } else {
        const label = `JRE ${entry.javaFeatureVersion} · ${entry.path}`;
        javaInfoEl.innerHTML = `<span>${label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>` +
          `<svg class="copyable-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round"/></svg>`;
        javaInfoEl.classList.add("is-copyable");
        javaInfoEl.title = `${label} (클릭해서 복사)`;
        javaInfoEl.dataset.copyValue = entry.path;
      }
    }).catch(() => { javaInfoEl.textContent = "정보를 불러오지 못했어요"; });
  }

  // 이 프로필 폴더만의 용량 (전체 설치 용량이 아니라 이 프로필 하나)
  const diskEl = document.getElementById("manage-profile-disk-usage");
  if (diskEl) {
    diskEl.textContent = "계산하는 중...";
    window.luna.getProfileFolderSize(managingProfileId).then((bytes) => {
      diskEl.textContent = formatBytes(bytes);
    }).catch(() => { diskEl.textContent = "계산 실패"; });
  }

  profileSettingsOverlay.hidden = false;
  // 23차: 팝업이 숨겨진 동안엔 .profile-settings-nav의 offsetWidth가 0이라 하이라이트
  // 위치를 정확히 잴 수 없으므로, 실제로 보이게 된 다음 프레임에 다시 계산함
  // (메인 설정 팝업의 테마 pill과 같은 이유, showSettingsCategory 근처 주석 참고)
  showProfileSettingsCategory("launch");
  requestAnimationFrame(() => updateProfileSettingsNavPill());
}
document.getElementById("manage-profile-java-info")?.addEventListener("click", async (e) => {
  const el = e.currentTarget;
  const value = el.dataset.copyValue;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("자바 경로를 복사했어요");
  } catch (_) {
    showToast("복사에 실패했어요, 직접 드래그해서 복사해주세요", "error");
  }
});
document.getElementById("btn-profile-hero-settings")?.addEventListener("click", openProfileSettingsModal);
document.getElementById("btn-profile-settings-close")?.addEventListener("click", () => { profileSettingsOverlay.hidden = true; });
document.getElementById("btn-profile-settings-cancel")?.addEventListener("click", () => { profileSettingsOverlay.hidden = true; });
document.getElementById("manage-profile-memory")?.addEventListener("input", (e) => {
  document.getElementById("manage-profile-memory-value").textContent = e.target.value + "GB";
});
document.getElementById("btn-profile-settings-save")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-profile-settings-save");
  await withBusyButton(btn, "저장 중...", async () => {
    const partial = {
      id: managingProfileId,
      memoryGB: Number(document.getElementById("manage-profile-memory").value),
      width: Number(document.getElementById("manage-profile-width").value),
      height: Number(document.getElementById("manage-profile-height").value),
      fullscreen: document.getElementById("manage-profile-fullscreen").checked,
      jvmArgs: document.getElementById("manage-profile-jvmargs").value,
      description: document.getElementById("manage-profile-description")?.value || "",
    };
    const syncCheckbox = document.getElementById("manage-profile-updatesync");
    if (syncCheckbox && !document.getElementById("manage-profile-updatesync-row").hidden) {
      partial.updateSync = syncCheckbox.checked;
    }
    const res = await window.luna.updateProfile(partial);
    if (res.ok) {
      currentEditProfile = res.profile;
      showToast("저장했어요");
      profileSettingsOverlay.hidden = true;
    } else {
      showToast(res.error || "저장 실패", "error");
    }
  });
});
document.getElementById("btn-manage-profile-refresh-share")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-manage-profile-refresh-share");
  await withBusyButton(btn, "갱신 중...", async () => {
    const res = await window.luna.refreshShareProfile(managingProfileId);
    if (res.ok) showToast("공유 코드에 지금 구성을 다시 올렸어요");
    else showToast(res.error || "갱신 실패", "error");
  });
});

// ---- 5-13(7차): 프로필 공유 - 작은 중앙 모달 -------------------------------------------
const profileShareOverlay = document.getElementById("profile-share-overlay");
async function openProfileShareModal() {
  if (!managingProfileId) return;
  const profile = currentEditProfile || (await window.luna.listProfiles()).find((p) => p.id === managingProfileId);
  const blockedNote = document.getElementById("profile-share-blocked-note");
  const loadingEl = document.getElementById("profile-share-loading");
  const bodyEl = document.getElementById("profile-share-body");
  profileShareOverlay.hidden = false;

  if (profile?.fromPreset) {
    blockedNote.textContent = "프리셋으로 만든 프로필은 공유할 수 없어요";
    blockedNote.hidden = false;
    loadingEl.hidden = true;
    bodyEl.hidden = true;
    return;
  }
  blockedNote.hidden = true;
  bodyEl.hidden = true;
  loadingEl.hidden = false;

  const res = await window.luna.shareProfile(managingProfileId);
  loadingEl.hidden = true;
  if (res.ok) {
    bodyEl.hidden = false;
    document.getElementById("profile-share-code").textContent = res.code;
    if (!res.reused) showToast("공유 코드를 만들었어요");
    if (currentEditProfile) currentEditProfile.shareCode = res.code;
  } else {
    blockedNote.hidden = false;
    blockedNote.textContent = res.error || "공유 코드를 만들지 못했어요";
  }
}
document.getElementById("btn-profile-share-close")?.addEventListener("click", () => { profileShareOverlay.hidden = true; });
document.getElementById("btn-profile-share-copy")?.addEventListener("click", async () => {
  const code = document.getElementById("profile-share-code").textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("코드를 복사했어요");
  } catch (_) {
    showToast("복사에 실패했어요, 직접 드래그해서 복사해주세요", "error");
  }
});

// 10-3: 바로가기로 앱이 켜지거나(이미 켜져 있는데 바로가기를 또 눌렀을 때) 프로필이 자동으로 바뀌면 화면도 맞춰줌
window.luna.onProfileSelectedExternally?.(async () => {
  // 24-48차: 여기는 원래 listProfiles()로 토스트 문구만 만들고 정작 홈 화면 서버/프로필
  // 목록(lastProfilesData/lastServersData)은 다시 안 그려서, 바로가기로 프로필이 바뀌어도
  // 목록의 선택 표시는 예전 그대로 남아있었음 - 다른 선택 경로들과 동일하게 양쪽 목록을 같이 새로고침
  await refreshLaunchTargetLists();
  const sel = lastProfilesData.find((p) => p.selected);
  if (sel) {
    if (profileChipName) profileChipName.textContent = sel.name;
    updateMcVersionLabel(sel.mcVersion);
  }
  refreshChipActiveStates();
  showToast(sel ? `"${sel.name}" 프로필로 전환됐어요` : "프로필이 전환됐어요");
});
document.getElementById("btn-manage-profile-icon")?.addEventListener("click", async () => {
  const res = await window.luna.setProfileIcon(managingProfileId);
  if (res.ok) {
    document.getElementById("manage-profile-icon-preview").src = res.iconUrl + "?t=" + Date.now(); // 캐시 무시하고 새로 불러오기
    showToast("아이콘을 바꿨어요");
  } else if (!res.canceled) {
    showToast(res.error || "아이콘 변경 실패", "error");
  }
});
// 17차 신규: 직접 고른 프로필 아이콘을 지워서 기본 아이콘으로 되돌림
document.getElementById("btn-manage-profile-icon-remove")?.addEventListener("click", async () => {
  if (!managingProfileId) return;
  const res = await window.luna.removeProfileIcon?.(managingProfileId);
  if (res?.ok) {
    document.getElementById("manage-profile-icon-preview").src = res.iconUrl + "?t=" + Date.now();
    showToast("기본 아이콘으로 되돌렸어요");
  } else if (res && !res.ok) {
    showToast(res.error || "되돌리기 실패", "error");
  }
});

const MODS_LIST_COLLAPSE_THRESHOLD = 6; // 항목이 이 개수를 넘으면 접어서 "더보기"로 표시
const manageFileSelection = { mods: new Set(), resourcepacks: new Set(), shaderpacks: new Set() };
const manageFileListCache = { mods: [], resourcepacks: [], shaderpacks: [] };

function manageListElIds(kind) {
  return {
    listElId: kind === "mods" ? "manage-mods-list" : kind === "resourcepacks" ? "manage-rp-list" : "manage-shader-list",
    countElId: kind === "mods" ? "manage-mods-count" : kind === "resourcepacks" ? "manage-rp-count" : "manage-shader-count",
    sortElId: kind === "mods" ? "manage-mods-sort" : kind === "resourcepacks" ? "manage-rp-sort" : "manage-shader-sort",
    selectAllElId: kind === "mods" ? "manage-mods-select-all" : kind === "resourcepacks" ? "manage-rp-select-all" : "manage-shader-select-all",
    bulkBarId: kind === "mods" ? "manage-mods-bulk-bar" : kind === "resourcepacks" ? "manage-rp-bulk-bar" : "manage-shader-bulk-bar",
  };
}

function sortManageFiles(files, sortMode) {
  const sorted = files.slice();
  if (sortMode === "recent") {
    sorted.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } else {
    sorted.sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName, "ko"));
  }
  return sorted;
}

// 22차: "나오고 사라지는 에니메이션도 좀 넣고" - 사라질 때는 hidden을 바로 주지 않고
// is-disappearing 애니메이션이 끝날 때까지 기다린 뒤 적용함(바 하나당 타이머 하나)
const manageBulkBarHideTimers = {};
function updateManageBulkBar(kind) {
  const { bulkBarId } = manageListElIds(kind);
  const bar = document.getElementById(bulkBarId);
  if (!bar) return;
  const shouldShow = manageFileSelection[kind].size > 0;
  if (manageBulkBarHideTimers[bulkBarId]) {
    clearTimeout(manageBulkBarHideTimers[bulkBarId]);
    manageBulkBarHideTimers[bulkBarId] = null;
  }
  if (shouldShow) {
    const wasHidden = bar.hidden;
    bar.hidden = false;
    bar.classList.remove("is-disappearing");
    if (wasHidden) {
      bar.classList.remove("is-appearing");
      void bar.offsetWidth;
      bar.classList.add("is-appearing");
    }
  } else if (!bar.hidden) {
    bar.classList.remove("is-appearing");
    bar.classList.add("is-disappearing");
    manageBulkBarHideTimers[bulkBarId] = setTimeout(() => {
      bar.hidden = true;
      bar.classList.remove("is-disappearing");
      manageBulkBarHideTimers[bulkBarId] = null;
    }, 140);
  }
}

// 10차: "카테고리(탭)가 검색 밑에 있어야지" - 탭마다 따로 있던 검색창 3개를 하나로 합치고
// 탭 위(예전엔 탭이 검색보다 위였음)가 아니라 탭 아래로 옮김. 검색창 자체는 이제 공용이라
// kind 인자와 무관하게 항상 같은 input을 가리킴(placeholder만 탭 전환 시 바뀜)
function manageSearchElId(_kind) {
  return "manage-shared-search";
}
const MANAGE_SEARCH_PLACEHOLDER_BY_KIND = { all: "전체 검색", mods: "모드 검색", resourcepacks: "리소스팩 검색", shaderpacks: "쉐이더팩 검색" };
// 17차: "전체" 탭에서 항목이 어떤 종류인지 구분해주는 작은 태그 라벨
const MANAGE_KIND_LABEL = { mods: "모드", resourcepacks: "리소스팩", shaderpacks: "쉐이더팩" };

async function refreshProfileFileList(kind) {
  const rawFiles = await window.luna.listProfileFiles(managingProfileId, kind);
  manageFileListCache[kind] = rawFiles;
  // 지워진 파일은 선택 상태에서도 같이 정리
  const validNames = new Set(rawFiles.map((f) => f.fileName));
  manageFileSelection[kind].forEach((n) => { if (!validNames.has(n)) manageFileSelection[kind].delete(n); });
  renderProfileFileListFromCache(kind);
}

// 5-11(7차): 검색어가 바뀔 때는 서버를 다시 부르지 않고, 이미 받아둔 캐시를 그대로 다시 그림
// 17차 신규: "모드 리스트에서 모드 이름 누르면 Contents에서 모드 보기로 가줘" - Contents(Explore)로
// 이동해서(기존 openExploreScopedToProfile 재사용, 지금 프로필/종류로 미리 필터링) 그 모드의
// 상세 화면을 바로 엶. 프로젝트 정보가 없는(수동으로 넣은) 파일은 애초에 링크로 안 만듦(위 렌더링 참고)
async function openModDetailFromProfileList(kind, file) {
  if (!file.projectId) return;
  await openExploreScopedToProfile(managingProfileId, kind);
  const project = await window.luna.exploreGetProject(file.projectId);
  if (!project) {
    showToast("모드 정보를 찾을 수 없어요", "error");
    return;
  }
  await openExploreDetail({
    id: project.id,
    slug: project.slug,
    title: project.title,
    icon: project.icon,
    author: file.author || "",
    downloads: project.downloads,
    description: project.description,
  });
}

// 17차 신규: "제작자" 페이지 - 프로필 수정(모드 이름 옆 제작자)/Contents 모드 상세 양쪽에서
// 재사용하는 공용 팝업. main.js의 explore:author-projects(Modrinth 계정 기준)를 그대로 씀
const AUTHOR_PAGE_TYPE_LABEL = { mod: "모드", resourcepack: "리소스팩", shader: "쉐이더", modpack: "모드팩", plugin: "플러그인", datapack: "데이터팩" };
async function openAuthorPage(authorUsername) {
  const uname = String(authorUsername || "").trim();
  if (!uname) return;
  const overlay = document.getElementById("author-page-overlay");
  const loadingEl = document.getElementById("author-page-loading");
  const bodyEl = document.getElementById("author-page-body");
  if (!overlay) return;
  overlay.hidden = false;
  loadingEl.hidden = false;
  bodyEl.hidden = true;

  const info = await window.luna.exploreAuthorProjects?.(uname);
  loadingEl.hidden = true;
  if (!info) {
    showToast("제작자 정보를 불러오지 못했어요", "error");
    overlay.hidden = true;
    return;
  }
  bodyEl.hidden = false;
  document.getElementById("author-page-avatar").src = info.avatar || "";
  document.getElementById("author-page-name").textContent = info.username || uname;
  const bioEl = document.getElementById("author-page-bio");
  bioEl.textContent = info.bio || "";
  bioEl.hidden = !info.bio;
  document.getElementById("author-page-project-count").textContent = info.projectCount || 0;
  document.getElementById("author-page-total-downloads").textContent = formatDownloads(info.totalDownloads || 0);

  const listEl = document.getElementById("author-page-project-list");
  const emptyEl = document.getElementById("author-page-empty");
  listEl.innerHTML = "";
  const projects = info.projects || [];
  emptyEl.hidden = projects.length > 0;
  projects.forEach((p) => {
    const row = document.createElement("div");
    row.className = "author-page-project-row";
    const iconHtml = p.icon
      ? `<img class="author-page-project-icon" src="${p.icon}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<span class="author-page-project-icon author-page-project-icon-fallback">${escapeHtml((p.title || "?").charAt(0).toUpperCase())}</span>`;
    row.innerHTML = `
      ${iconHtml}
      <span class="author-page-project-info">
        <span class="author-page-project-title">${escapeHtml(p.title || "")}</span>
        <span class="author-page-project-desc">${escapeHtml(p.description || "")}</span>
      </span>
      <span class="author-page-project-meta">
        <span class="author-page-project-type-tag">${escapeHtml(AUTHOR_PAGE_TYPE_LABEL[p.projectType] || p.projectType || "")}</span>
        <span class="author-page-project-downloads">${formatDownloads(p.downloads || 0)}</span>
      </span>
    `;
    row.addEventListener("click", async () => {
      // Contents(Explore)가 실제로 다루는 종류(모드/리소스팩/쉐이더/모드팩)만 상세로 이동함 -
      // 지금 프로필 관리 화면에서 열었으면 그 프로필로, 아니면 기존 Explore 프로필 선택을 그대로 씀
      const AUTHOR_PAGE_KIND_OF_TYPE = { mod: "mods", resourcepack: "resourcepacks", shader: "shaderpacks" };
      if (p.projectType === "modpack") {
        exploreCurrentType = "modpack";
      } else {
        const kindGuess = AUTHOR_PAGE_KIND_OF_TYPE[p.projectType];
        if (!kindGuess) {
          showToast("이 종류는 아직 지원하지 않아요", "error");
          return;
        }
        await openExploreScopedToProfile(managingProfileId, kindGuess);
      }
      overlay.hidden = true;
      await openExploreDetail({
        id: p.id,
        slug: p.slug,
        title: p.title,
        icon: p.icon,
        author: info.username || uname,
        downloads: p.downloads,
        description: p.description,
      });
    });
    listEl.appendChild(row);
  });
}
document.getElementById("btn-author-page-close")?.addEventListener("click", () => {
  document.getElementById("author-page-overlay").hidden = true;
});

function renderProfileFileListFromCache(kind) {
  const { listElId, countElId, sortElId, selectAllElId } = manageListElIds(kind);
  const listEl = document.getElementById(listElId);
  const rawFiles = manageFileListCache[kind] || [];

  const searchInput = document.getElementById(manageSearchElId(kind));
  const query = (searchInput?.value || "").trim().toLowerCase();
  const searched = query
    ? rawFiles.filter((f) => (f.title || f.fileName || "").toLowerCase().includes(query) || (f.author || "").toLowerCase().includes(query))
    : rawFiles;

  const sortSelect = document.getElementById(sortElId);
  const files = sortManageFiles(searched, sortSelect?.value || "name");

  document.getElementById(countElId).textContent = rawFiles.length;
  listEl.innerHTML = "";
  listEl.parentElement.querySelector(`.manage-list-more-btn[data-for="${listElId}"]`)?.remove();

  // 24-14차: "모드가 없으면 모드 추가하러 가기 뜨게 해주고 프로필 수정에서" - 모드 탭에 아직
  // 아무것도 없을 때(검색으로 걸러진 게 아니라 진짜로 0개일 때) Contents에서 모드를 바로
  // 추가하러 갈 수 있는 안내 버튼을 보여줌
  // 24-69차: "그리고 사진 보면 모드 보는 곳에 모드 없을 때 저런식으로 비어있는 거 말고
  // 옆 사진처럼 되면 좋을 듯" - 문구 한 줄 + 버튼 하나뿐이던 안내를 아이콘+제목+설명+버튼
  // 두 개(파일 업로드/모드 추가하러 가기) 구성으로 바꿈. 두 버튼은 새 로직을 만들지 않고
  // 위 툴바의 기존 버튼(btn-manage-mods-add/btn-manage-mods-browse)을 그대로 눌러서
  // 똑같은 동작을 재사용함
  if (kind === "mods" && rawFiles.length === 0 && !query) {
    listEl.innerHTML = `
      <div class="manage-list-empty-cta">
        <span class="manage-list-empty-cta-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/>
            <path d="M3 8.5 12 14l9-5.5"/>
            <path d="M12 14v7"/>
          </svg>
        </span>
        <span class="manage-list-empty-cta-title">아직 추가한 모드가 없어요</span>
        <span class="manage-list-empty-cta-subtitle">파일을 직접 추가하거나 Contents에서 찾아보세요</span>
        <span class="manage-list-empty-cta-actions">
          <button type="button" class="btn btn-ghost btn-small" id="btn-manage-mods-empty-add">파일 업로드</button>
          <button type="button" class="btn btn-fixed-green btn-small" id="btn-manage-mods-empty-browse">모드 추가하러 가기</button>
        </span>
      </div>
    `;
    listEl.querySelector("#btn-manage-mods-empty-add")?.addEventListener("click", () => {
      document.getElementById("btn-manage-mods-add")?.click();
    });
    listEl.querySelector("#btn-manage-mods-empty-browse")?.addEventListener("click", () => {
      document.getElementById("btn-manage-mods-browse")?.click();
    });
    return;
  }

  files.forEach((f, idx) => {
    const row = document.createElement("div");
    row.className = "resourcepack-item manage-file-row" + (f.enabled ? "" : " is-disabled");
    if (idx >= MODS_LIST_COLLAPSE_THRESHOLD) row.classList.add("is-collapsed-hidden");

    const iconHtml = f.icon
      ? `<img class="manage-file-icon" src="${f.icon}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<span class="manage-file-icon manage-file-icon-fallback">${escapeHtml((f.title || f.fileName).charAt(0).toUpperCase())}</span>`;
    const authorHtml = f.author ? `<span class="manage-file-author author-page-link">by ${escapeHtml(f.author)}</span>` : "";
    // 5-9(5차): 참고 스크린샷처럼 Project(아이콘+이름+제작자)/Version(버전 문자열+파일명) 두 열로
    // 정리하고, 활성화/비활성화는 버튼 대신 진짜 토글 스위치로 바꿈
    const versionLineHtml = f.versionNumber
      ? `<b class="manage-file-version-num">${escapeHtml(f.versionNumber)}</b>`
      : `<b class="manage-file-version-num manage-file-version-num-empty">-</b>`;

    row.innerHTML = `
      <input type="checkbox" class="manage-file-checkbox" ${manageFileSelection[kind].has(f.fileName) ? "checked" : ""} />
      <span class="manage-file-project">
        ${iconHtml}
        <span class="manage-file-info">
          <b class="manage-file-name${f.projectId ? " manage-file-name-link" : ""}" ${f.projectId ? 'title="Contents에서 보기"' : ""}>${escapeHtml(f.title || f.fileName)}</b>
          ${authorHtml}
        </span>
      </span>
      <span class="manage-file-version-cell">
        ${versionLineHtml}
        <span class="manage-file-filename">${escapeHtml(f.fileName)}</span>
      </span>
      <span class="manage-file-actions">
        ${f.projectId && kind === "mods" ? `<button type="button" class="icon-btn manage-file-pin${f.pinned ? " is-pinned" : ""}" title="${f.pinned ? "버전 고정 해제" : "버전 고정 (자동 업데이트 제외)"}">${MANAGE_ICON_PIN_SVG}</button>` : ""}
        ${f.projectId ? `<button type="button" class="icon-btn manage-file-version-btn" title="버전 변경">${MANAGE_ICON_VERSION_SVG}</button>` : ""}
        <label class="manage-toggle-switch" title="${f.enabled ? "비활성화" : "활성화"}">
          <input type="checkbox" class="manage-file-toggle-input" ${f.enabled ? "checked" : ""} />
          <span class="manage-toggle-slider"></span>
        </label>
        <button class="icon-btn manage-file-delete-btn" title="삭제">${MANAGE_ICON_DELETE_SVG}</button>
      </span>
    `;

    row.querySelector(".manage-file-checkbox").addEventListener("change", (e) => {
      if (e.target.checked) manageFileSelection[kind].add(f.fileName);
      else manageFileSelection[kind].delete(f.fileName);
      updateManageBulkBar(kind);
    });
    row.querySelector(".manage-file-delete-btn").addEventListener("click", async () => {
      const profileIdAtDelete = managingProfileId;
      await window.luna.removeProfileFile(profileIdAtDelete, kind, f.fileName);
      manageFileSelection[kind].delete(f.fileName);
      refreshProfileFileList(kind);
      if (kind === "mods") refreshModsUpdateIndicator();
      showUndoToast(`"${f.title || f.fileName}"을(를) 삭제했어요`, async () => {
        await window.luna.restoreProfileFile(profileIdAtDelete, kind, f.fileName);
        if (managingProfileId === profileIdAtDelete) {
          refreshProfileFileList(kind);
          if (kind === "mods") refreshModsUpdateIndicator();
        }
      });
    });
    row.querySelector(".manage-file-toggle-input").addEventListener("change", async (e) => {
      const wantEnabled = e.target.checked;
      const res = await window.luna.toggleProfileFile(managingProfileId, kind, f.fileName);
      if (res.ok) refreshProfileFileList(kind);
      else {
        e.target.checked = !wantEnabled; // 실패하면 스위치를 원래 상태로 되돌림
        showToast(res.error || "전환 실패", "error");
      }
    });
    row.querySelector(".manage-file-pin")?.addEventListener("click", async () => {
      const res = await window.luna.toggleProfileFilePin(managingProfileId, kind, f.fileName);
      if (res.ok) {
        showToast(res.pinned ? "버전을 고정했어요" : "버전 고정을 해제했어요");
        refreshProfileFileList(kind);
      } else {
        showToast(res.error || "고정 실패", "error");
      }
    });
    row.querySelector(".manage-file-version-btn")?.addEventListener("click", () => openModVersionPicker(kind, f));
    // 17차: "모드 이름 누르면 Contents에서 모드 보기로 가줘"
    row.querySelector(".manage-file-name-link")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openModDetailFromProfileList(kind, f);
    });
    // 17차 신규: "제작자 누르면 그 제작자의 모드/리팩/쉐이더가 쫙 뜨게 해줘"
    row.querySelector(".manage-file-author")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openAuthorPage(f.author);
    });
    listEl.appendChild(row);
  });

  const selectAllEl = document.getElementById(selectAllElId);
  if (selectAllEl) selectAllEl.checked = rawFiles.length > 0 && manageFileSelection[kind].size === rawFiles.length;
  updateManageBulkBar(kind);

  // 항목이 많으면 접었다 펼 수 있는 버튼 추가
  if (files.length > MODS_LIST_COLLAPSE_THRESHOLD) {
    const hiddenCount = files.length - MODS_LIST_COLLAPSE_THRESHOLD;
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "manage-list-more-btn";
    moreBtn.dataset.for = listElId;
    moreBtn.textContent = `더보기 (${hiddenCount}개 더)`;
    let expanded = false;
    moreBtn.addEventListener("click", () => {
      expanded = !expanded;
      listEl.querySelectorAll(".manage-file-row").forEach((row, idx) => {
        if (idx >= MODS_LIST_COLLAPSE_THRESHOLD) row.classList.toggle("is-collapsed-hidden", !expanded);
      });
      moreBtn.textContent = expanded ? "접기" : `더보기 (${hiddenCount}개 더)`;
    });
    listEl.insertAdjacentElement("afterend", moreBtn);
  }
}

// 17차: "이름순/최근순 전체 | 모드 | 리소스팩 | 쉐이더" - 3종류를 한 화면에서 같이 보는 "전체" 탭.
// 새로 서버에 물어보지 않고 이미 각 종류별로 받아둔 manageFileListCache를 그대로 합쳐서 그림.
// 일괄선택/일괄작업 바는 일부러 넣지 않음(종류가 섞여있어 복잡해지는 걸 피하려고 범위를 좁힘) -
// 대신 각 행의 고정/버전변경/토글/삭제/이름클릭 같은 개별 작업은 그대로 다 동작함(행마다 자기
// 종류(kind)를 기억해서 해당 종류의 API를 그대로 호출).
function renderAllProfileFilesList() {
  const listEl = document.getElementById("manage-all-list");
  if (!listEl) return;
  const allRaw = ["mods", "resourcepacks", "shaderpacks"].flatMap((kind) =>
    (manageFileListCache[kind] || []).map((f) => ({ ...f, __kind: kind }))
  );

  const searchInput = document.getElementById("manage-shared-search");
  const query = (searchInput?.value || "").trim().toLowerCase();
  const searched = query
    ? allRaw.filter((f) => (f.title || f.fileName || "").toLowerCase().includes(query) || (f.author || "").toLowerCase().includes(query))
    : allRaw;

  const sortSelect = document.getElementById("manage-all-sort");
  const files = sortManageFiles(searched, sortSelect?.value || "name");

  const countEl = document.getElementById("manage-all-count");
  if (countEl) countEl.textContent = allRaw.length;
  listEl.innerHTML = "";
  listEl.parentElement.querySelector(`.manage-list-more-btn[data-for="manage-all-list"]`)?.remove();

  files.forEach((f, idx) => {
    const kind = f.__kind;
    const row = document.createElement("div");
    row.className = "resourcepack-item manage-file-row" + (f.enabled ? "" : " is-disabled");
    if (idx >= MODS_LIST_COLLAPSE_THRESHOLD) row.classList.add("is-collapsed-hidden");

    const iconHtml = f.icon
      ? `<img class="manage-file-icon" src="${f.icon}" alt="" onerror="this.style.visibility='hidden'" />`
      : `<span class="manage-file-icon manage-file-icon-fallback">${escapeHtml((f.title || f.fileName).charAt(0).toUpperCase())}</span>`;
    const authorHtml = f.author ? `<span class="manage-file-author author-page-link">by ${escapeHtml(f.author)}</span>` : "";
    const kindTagHtml = `<span class="manage-file-kind-tag">${MANAGE_KIND_LABEL[kind] || kind}</span>`;
    const versionLineHtml = f.versionNumber
      ? `<b class="manage-file-version-num">${escapeHtml(f.versionNumber)}</b>`
      : `<b class="manage-file-version-num manage-file-version-num-empty">-</b>`;

    row.innerHTML = `
      <span class="manage-list-row-check-spacer"></span>
      <span class="manage-file-project">
        ${iconHtml}
        <span class="manage-file-info">
          <b class="manage-file-name${f.projectId ? " manage-file-name-link" : ""}" ${f.projectId ? 'title="Contents에서 보기"' : ""}>${escapeHtml(f.title || f.fileName)}</b>
          <span class="manage-file-meta-row">${kindTagHtml}${authorHtml}</span>
        </span>
      </span>
      <span class="manage-file-version-cell">
        ${versionLineHtml}
        <span class="manage-file-filename">${escapeHtml(f.fileName)}</span>
      </span>
      <span class="manage-file-actions">
        ${f.projectId && kind === "mods" ? `<button type="button" class="icon-btn manage-file-pin${f.pinned ? " is-pinned" : ""}" title="${f.pinned ? "버전 고정 해제" : "버전 고정 (자동 업데이트 제외)"}">${MANAGE_ICON_PIN_SVG}</button>` : ""}
        ${f.projectId ? `<button type="button" class="icon-btn manage-file-version-btn" title="버전 변경">${MANAGE_ICON_VERSION_SVG}</button>` : ""}
        <label class="manage-toggle-switch" title="${f.enabled ? "비활성화" : "활성화"}">
          <input type="checkbox" class="manage-file-toggle-input" ${f.enabled ? "checked" : ""} />
          <span class="manage-toggle-slider"></span>
        </label>
        <button class="icon-btn manage-file-delete-btn" title="삭제">${MANAGE_ICON_DELETE_SVG}</button>
      </span>
    `;

    row.querySelector(".manage-file-delete-btn").addEventListener("click", async () => {
      const profileIdAtDelete = managingProfileId;
      await window.luna.removeProfileFile(profileIdAtDelete, kind, f.fileName);
      manageFileSelection[kind].delete(f.fileName);
      await refreshProfileFileList(kind);
      renderAllProfileFilesList();
      if (kind === "mods") refreshModsUpdateIndicator();
      showUndoToast(`"${f.title || f.fileName}"을(를) 삭제했어요`, async () => {
        await window.luna.restoreProfileFile(profileIdAtDelete, kind, f.fileName);
        if (managingProfileId === profileIdAtDelete) {
          await refreshProfileFileList(kind);
          renderAllProfileFilesList();
          if (kind === "mods") refreshModsUpdateIndicator();
        }
      });
    });
    row.querySelector(".manage-file-toggle-input").addEventListener("change", async (e) => {
      const wantEnabled = e.target.checked;
      const res = await window.luna.toggleProfileFile(managingProfileId, kind, f.fileName);
      if (res.ok) {
        await refreshProfileFileList(kind);
        renderAllProfileFilesList();
      } else {
        e.target.checked = !wantEnabled; // 실패하면 스위치를 원래 상태로 되돌림
        showToast(res.error || "전환 실패", "error");
      }
    });
    row.querySelector(".manage-file-pin")?.addEventListener("click", async () => {
      const res = await window.luna.toggleProfileFilePin(managingProfileId, kind, f.fileName);
      if (res.ok) {
        showToast(res.pinned ? "버전을 고정했어요" : "버전 고정을 해제했어요");
        await refreshProfileFileList(kind);
        renderAllProfileFilesList();
      } else {
        showToast(res.error || "고정 실패", "error");
      }
    });
    row.querySelector(".manage-file-version-btn")?.addEventListener("click", () => openModVersionPicker(kind, f));
    row.querySelector(".manage-file-name-link")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openModDetailFromProfileList(kind, f);
    });
    // 17차 신규: "제작자 누르면 그 제작자의 모드/리팩/쉐이더가 쫙 뜨게 해줘"
    row.querySelector(".manage-file-author")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openAuthorPage(f.author);
    });
    listEl.appendChild(row);
  });

  // 항목이 많으면 접었다 펼 수 있는 버튼 추가 (다른 목록들과 동일한 패턴)
  if (files.length > MODS_LIST_COLLAPSE_THRESHOLD) {
    const hiddenCount = files.length - MODS_LIST_COLLAPSE_THRESHOLD;
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "manage-list-more-btn";
    moreBtn.dataset.for = "manage-all-list";
    moreBtn.textContent = `더보기 (${hiddenCount}개 더)`;
    let expanded = false;
    moreBtn.addEventListener("click", () => {
      expanded = !expanded;
      listEl.querySelectorAll(".manage-file-row").forEach((row, idx) => {
        if (idx >= MODS_LIST_COLLAPSE_THRESHOLD) row.classList.toggle("is-collapsed-hidden", !expanded);
      });
      moreBtn.textContent = expanded ? "접기" : `더보기 (${hiddenCount}개 더)`;
    });
    listEl.insertAdjacentElement("afterend", moreBtn);
  }
}

// 1-9: 최신 버전 말고 원하는 버전으로 직접 변경
async function openModVersionPicker(kind, file) {
  const profile = (await window.luna.listProfiles()).find((p) => p.id === managingProfileId);
  if (!profile) return;
  const overlay = document.getElementById("mod-version-overlay");
  const listEl = document.getElementById("mod-version-list");
  document.getElementById("mod-version-title").textContent = `${file.title || file.fileName} - 버전 선택`;
  listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">불러오는 중...</div>`;
  overlay.hidden = false;

  const projectType = kind === "mods" ? "mod" : kind === "shaderpacks" ? "shader" : "resourcepack";
  const versions = await window.luna.exploreGetVersions(file.projectId, profile.mcVersion, projectType);
  listEl.innerHTML = "";
  if (versions.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">이 마인크래프트 버전에 맞는 버전이 없어요</div>`;
    return;
  }
  versions.forEach((v) => {
    const row = document.createElement("div");
    row.className = "resourcepack-item";
    const isCurrent = v.fileName === file.fileName;
    row.innerHTML = `<span>${escapeHtml(v.versionNumber)} <span style="color:var(--text-2); font-size:11px;">${v.versionType}</span></span>${
      isCurrent
        ? `<span style="color:var(--accent); font-size:11px; font-weight:700;">현재 버전</span>`
        : `<button type="button" class="btn btn-primary btn-small">적용</button>`
    }`;
    if (!isCurrent) {
      row.querySelector("button").addEventListener("click", async () => {
        const res = await window.luna.exploreApplyUpdate({
          profileId: managingProfileId,
          kind,
          oldFileName: file.fileName,
          fileUrl: v.fileUrl,
          newFileName: v.fileName,
          projectId: file.projectId,
          projectTitle: file.title,
          icon: file.icon,
          author: file.author,
          versionId: v.id,
          versionNumber: v.versionNumber,
        });
        if (res.ok) {
          showToast(`"${file.title || file.fileName}" 버전을 ${v.versionNumber}(으)로 바꿨어요`);
          overlay.hidden = true;
          refreshProfileFileList(kind);
          if (kind === "mods") refreshModsUpdateIndicator();
        } else {
          showToast(res.error || "버전 변경 실패", "error");
        }
      });
    }
    listEl.appendChild(row);
  });
}
document.getElementById("btn-mod-version-close")?.addEventListener("click", () => {
  document.getElementById("mod-version-overlay").hidden = true;
});

// 17차: "전체" 탭 전용 정렬(#manage-all-sort) - 캐시를 다시 받아올 필요 없이 다시 그리기만 함
document.getElementById("manage-all-sort")?.addEventListener("change", () => renderAllProfileFilesList());

["mods", "resourcepacks", "shaderpacks"].forEach((kind) => {
  const { sortElId, selectAllElId, bulkBarId } = manageListElIds(kind);
  document.getElementById(sortElId)?.addEventListener("change", () => refreshProfileFileList(kind));
  document.getElementById(selectAllElId)?.addEventListener("change", (e) => {
    if (e.target.checked) {
      manageFileListCache[kind].forEach((f) => manageFileSelection[kind].add(f.fileName));
    } else {
      manageFileSelection[kind].clear();
    }
    refreshProfileFileList(kind);
  });

  const enableBtnId = kind === "mods" ? "btn-manage-mods-bulk-enable" : kind === "resourcepacks" ? "btn-manage-rp-bulk-enable" : "btn-manage-shader-bulk-enable";
  const disableBtnId = kind === "mods" ? "btn-manage-mods-bulk-disable" : kind === "resourcepacks" ? "btn-manage-rp-bulk-disable" : "btn-manage-shader-bulk-disable";
  const deleteBtnId = kind === "mods" ? "btn-manage-mods-bulk-delete" : kind === "resourcepacks" ? "btn-manage-rp-bulk-delete" : "btn-manage-shader-bulk-delete";

  // 14차: "여러개 선택했을 때 선택 비활성화는 있는데 선택 활성화는 어딨어" - 비활성화 버튼과
  // 대칭되는 일괄 활성화 버튼을 추가함(꺼져있는 것만 골라서 켜는 것도 disable과 동일한 패턴)
  document.getElementById(enableBtnId)?.addEventListener("click", async () => {
    const names = Array.from(manageFileSelection[kind]);
    for (const name of names) {
      const file = manageFileListCache[kind].find((f) => f.fileName === name);
      if (file && !file.enabled) await window.luna.toggleProfileFile(managingProfileId, kind, name);
    }
    showToast(`선택한 ${names.length}개를 활성화했어요`);
    refreshProfileFileList(kind);
  });
  document.getElementById(disableBtnId)?.addEventListener("click", async () => {
    const names = Array.from(manageFileSelection[kind]);
    for (const name of names) {
      const file = manageFileListCache[kind].find((f) => f.fileName === name);
      if (file?.enabled) await window.luna.toggleProfileFile(managingProfileId, kind, name);
    }
    showToast(`선택한 ${names.length}개를 비활성화했어요`);
    refreshProfileFileList(kind);
  });
  document.getElementById(deleteBtnId)?.addEventListener("click", async () => {
    const names = Array.from(manageFileSelection[kind]);
    const confirmed = await showConfirm(`선택한 ${names.length}개를 삭제할까요?`, "삭제", "취소");
    if (!confirmed) return;
    const profileIdAtDelete = managingProfileId;
    for (const name of names) {
      await window.luna.removeProfileFile(profileIdAtDelete, kind, name);
    }
    manageFileSelection[kind].clear();
    refreshProfileFileList(kind);
    if (kind === "mods") refreshModsUpdateIndicator();
    showUndoToast(`선택한 ${names.length}개를 삭제했어요`, async () => {
      for (const name of names) {
        await window.luna.restoreProfileFile(profileIdAtDelete, kind, name);
      }
      if (managingProfileId === profileIdAtDelete) {
        refreshProfileFileList(kind);
        if (kind === "mods") refreshModsUpdateIndicator();
      }
    });
  });
});

["mods", "resourcepacks", "shaderpacks"].forEach((kind) => {
  const btnId = kind === "mods" ? "btn-manage-mods-add" : kind === "resourcepacks" ? "btn-manage-rp-add" : "btn-manage-shader-add";
  document.getElementById(btnId)?.addEventListener("click", async () => {
    const res = await window.luna.addProfileFile(managingProfileId, kind);
    if (res.ok) {
      showToast("폴더를 열었어요. 파일을 넣고 나서 창을 다시 열면 목록에 반영돼요");
      refreshProfileFileList(kind);
    }
  });
});

// 5-11(7차): "Browse content" - Explore로 이동하되, 지금 이 프로필 + 지금 탭(종류)에 딱 맞게
// 미리 필터링해서 딜어감 (다른 프로필/다른 종류가 실수로 골라지지 않게)
["mods", "resourcepacks", "shaderpacks"].forEach((kind) => {
  const btnId = kind === "mods" ? "btn-manage-mods-browse" : kind === "resourcepacks" ? "btn-manage-rp-browse" : "btn-manage-shader-browse";
  document.getElementById(btnId)?.addEventListener("click", () => {
    openExploreScopedToProfile(managingProfileId, kind);
  });
});

// 5-11(7차): 새로고침 - 서버에 다시 물어보지 않고도(=업로드 등으로 로컬 파일이 바뀐 뒤) 목록을 다시 읽음
["mods", "resourcepacks", "shaderpacks"].forEach((kind) => {
  const btnId = kind === "mods" ? "btn-manage-mods-refresh" : kind === "resourcepacks" ? "btn-manage-rp-refresh" : "btn-manage-shader-refresh";
  document.getElementById(btnId)?.addEventListener("click", () => {
    refreshProfileFileList(kind);
    if (kind === "mods") refreshModsUpdateIndicator();
  });
});
// 17차: "전체" 탭 새로고침 - 3종류를 다 새로 읽어온 다음 합쳐서 다시 그림
document.getElementById("btn-manage-all-refresh")?.addEventListener("click", async () => {
  await Promise.all(["mods", "resourcepacks", "shaderpacks"].map((kind) => refreshProfileFileList(kind)));
  renderAllProfileFilesList();
  refreshModsUpdateIndicator();
});

// 5-11(7차): 검색어 입력 - refreshProfileFileList가 캐시를 다시 쓰므로 서버는 안 거치고 바로 필터링
// 10차: 검색창이 탭 3개 공용 하나로 합쳐져서, 지금 활성화된 탭 기준으로만 다시 그림
document.getElementById("manage-shared-search")?.addEventListener("input", () => {
  const activeTab = document.querySelector(".profile-file-tab.is-active")?.dataset.tab || "mods";
  if (activeTab === "all") renderAllProfileFilesList();
  else renderProfileFileListFromCache(activeTab);
});

// ---- 프로필 모드 전체 업데이트 확인 -------------------------------------------
const modsUpdateOverlay = document.getElementById("mods-update-overlay");
let modsUpdateList = [];

document.getElementById("btn-manage-mods-update")?.addEventListener("click", async () => {
  showToast("업데이트 확인 중...");
  modsUpdateList = await window.luna.exploreCheckUpdates(managingProfileId, "mods");
  const listEl = document.getElementById("mods-update-list");
  listEl.innerHTML = "";

  if (modsUpdateList.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-2); font-size:12.5px;">이미 다 최신 버전이에요</div>`;
  } else {
    modsUpdateList.forEach((u) => {
      const row = document.createElement("div");
      row.className = "resourcepack-item";
      row.innerHTML = `<span>${u.title} → ${u.newVersionNumber}</span><button type="button" class="btn btn-primary btn-small">업데이트</button>`;
      row.querySelector("button").addEventListener("click", async () => {
        const res = await window.luna.exploreApplyUpdate({
          profileId: managingProfileId,
          kind: "mods",
          oldFileName: u.fileName,
          fileUrl: u.fileUrl,
          newFileName: u.newFileName,
          projectId: u.projectId,
          projectTitle: u.title,
          icon: u.icon,
          versionId: u.newVersionId,
          versionNumber: u.newVersionNumber,
        });
        if (res.ok) {
          showToast(`"${u.title}" 업데이트 완료`);
          row.remove();
          refreshProfileFileList("mods");
          refreshModsUpdateIndicator();
        }
      });
      listEl.appendChild(row);
    });
  }
  modsUpdateOverlay.hidden = false;
});
document.getElementById("btn-mods-update-close")?.addEventListener("click", () => {
  modsUpdateOverlay.hidden = true;
});
document.getElementById("btn-mods-update-all")?.addEventListener("click", async () => {
  for (const u of modsUpdateList) {
    await window.luna.exploreApplyUpdate({
      profileId: managingProfileId,
      kind: "mods",
      oldFileName: u.fileName,
      fileUrl: u.fileUrl,
      newFileName: u.newFileName,
      projectId: u.projectId,
      projectTitle: u.title,
      icon: u.icon,
      versionId: u.newVersionId,
      versionNumber: u.newVersionNumber,
    });
  }
  showToast("전체 업데이트 완료");
  modsUpdateOverlay.hidden = true;
  refreshProfileFileList("mods");
  refreshModsUpdateIndicator();
});

// 프리셋으로 저장 (인라인으로 이름 입력창을 펼침)
// 16-2(4차): 프리셋 만들기를 프로필 편집에서 분리 - 여기서는 만들지 않고, 독립된
// "프리셋 관리" 탭으로 이동시키면서 지금 프로필을 소스로 미리 골라둠
document.getElementById("btn-manage-profile-goto-preset")?.addEventListener("click", () => {
  openPresetManage(managingProfileId);
});

document.getElementById("btn-manage-profile-delete")?.addEventListener("click", async () => {
  // 22차: "삭제할 때에는 재확인 메시지 대신 프로필 이름을 적는 걸로 하자" - 예/아니오를
  // 두 번 묻던 걸 프로필 이름을 정확히 입력해야 버튼이 눌리는 방식으로 교체
  const profileName = currentEditProfile?.name || document.getElementById("manage-profile-name-input")?.value || "";
  const confirmed = await showTypeToConfirm(
    "이 프로필을 정말 삭제할까요? 안에 있는 모드/리소스팩도 같이 삭제되고, 이 작업은 되돌릴 수 없어요. 공유 코드를 만들어뒀다면 그것도 같이 사라져요.",
    profileName,
    "완전히 삭제"
  );
  if (!confirmed) return;
  const res = await window.luna.deleteProfile(managingProfileId);
  if (res.ok) {
    showToast("프로필을 삭제했어요");
    if (profileChipName) profileChipName.textContent = "프로필 선택";
    refreshChipActiveStates();
    // 24-48차: 지금 켜져 있던 프로필을 지우면 main.js에서 launch_mode가 "server"로
    // 자동 되돌아가므로(profiles:delete 참고), 홈 화면 서버/프로필 목록도 같이 다시
    // 불러와서 선택 표시가 실제 상태와 어긋나지 않게 함
    await refreshLaunchTargetLists();
    // 10차: 삭제 버튼이 프로필 설정 모달 안으로 옮겨져서, 삭제 후에는 이 모달도 같이 닫아줘야 함
    const settingsOverlay = document.getElementById("profile-settings-overlay");
    if (settingsOverlay) settingsOverlay.hidden = true;
    openProfileList();
  }
});
// 5-13(7차): 프로필 공유 버튼/결과 박스는 헤더 ⋮ 메뉴 -> 작은 중앙 모달(openProfileShareModal)로 옮김
document.getElementById("sidebar-profile-btn")?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("profile")) return;
  setActiveSidebarIcon("profile");
  openProfileList();
});

// Launch 아이콘은 항상 기본 화면(현재 로그인/홈 화면)으로, 눌렀다는 표시만 갱신
document.querySelector('.sidebar-icon[data-panel="launch"]')?.addEventListener("click", () => {
  if (isSidebarPanelAlreadyActive("launch")) return;
  setActiveSidebarIcon("launch");
  showAppPanel("view-home");
});


// 메인 화면에서도 업데이트 내역 바로 열기
document.getElementById("btn-changelog")?.addEventListener("click", () => openUpdates());
document.getElementById("btn-last-update")?.addEventListener("click", () => openUpdates());

setSfxVolume?.addEventListener("input", () => {
  setSfxVolumeValue.textContent = setSfxVolume.value + "%";
});

btnSettingsSave?.addEventListener("click", saveSettingsAndClose);
document.getElementById("btn-settings-close")?.addEventListener("click", requestCloseSettings);
// 팝업 바깥(어두운 배경)을 클릭하면 같은 방식으로 닫음
settingsOverlay?.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) requestCloseSettings();
});

// ---- 스킨 관리 ---------------------------------------------------------------
const skinPreview = document.getElementById("skin-preview");
const setSkinVariant = document.getElementById("set-skin-variant");
const btnSkinPick = document.getElementById("btn-skin-pick");
const btnSkinApply = document.getElementById("btn-skin-apply");
const skinFileNameEl = document.getElementById("skin-file-name");
const skinErrorEl = document.getElementById("skin-error");
// 24-61차: 이 img가 뜨거나(성공/실패 상관없이) 나면 로딩 스피너를 지움 - 한 번만 연결해두면
// 아래에서 skinPreview.src를 몇 번을 새로 갈아끼워도(스킨 적용/변경 등) 계속 잘 동작함
bindSkinLoadingSpinner(skinPreview, document.getElementById("skin-preview-spinner"));

let pickedSkinPath = null;

// 18차: crafatar 이미지 -> (성공하면) skinview3d 3D 캔버스로 새로고침하는 로직이 직접 올리기/
// 기본 스킨 적용 두 군데서 똑같이 반복돼서 공용 함수로 뽑음 (9차 방식 그대로 유지)
function refreshSkinPreviewImage() {
  if (!currentProfile?.uuid || !skinPreview) return;
  const skinPreview3dEl = document.getElementById("skin-preview-3d");
  skinPreview.hidden = false;
  if (skinPreview3dEl) skinPreview3dEl.hidden = true;
  // 24-61차: 새 요청을 시작하는 시점에 스피너를 다시 보여줌(이전 이미지가 남아있는 채로
  // 새로고침되는 거라, load 이벤트가 다시 뜰 때까지는 스피너로 "갱신 중"임을 알림)
  showSkinLoadingSpinner(document.getElementById("skin-preview-spinner"));
  skinPreview.src = `https://crafatar.com/renders/body/${currentProfile.uuid}?overlay&t=${Date.now()}`;
  mountSkinViewer(skinPreview3dEl, skinPreview, currentProfile.uuid, { w: 100, h: 160 });
}

async function loadSkinSection() {
  skinErrorEl.textContent = "";
  skinFileNameEl.textContent = "";
  pickedSkinPath = null;
  btnSkinApply.disabled = true;

  // 5-1: 얼굴만 잘라 보여주는 mc-heads "avatar"(얼굴 크롭) 대신 전신 스킨 렌더를 보여줌.
  // 다른 화면(포럼 프로필 팝업 등)에서 쓰는 crafatar 전신 렌더와 형식을 맞춤 + 매번 캐시 무효화용
  // 타임스탬프를 붙여서, Mojang에 새 스킨을 올린 직후에도 캐시된 옛날 스킨이 아니라 최신 스킨이 보이게 함
  refreshSkinPreviewImage();

  const current = await window.luna.getCurrentSkin();
  if (current?.variant) setSkinVariant.value = current.variant;

  loadCustomSkinsList();
  loadSkinHistoryList();
}

// 24-53차: 스킨 목록(내가 추가한 스킨/변경 기록) 행에 붙는 "공유" 버튼을 누르면 친구 목록을
// 불러와서 이름을 고를 수 있는 작은 인라인 드롭다운을 그 자리에서 펼침 - 별도 팝업/모달 없이
// 행 하나 안에서 바로 고르고 보낼 수 있게 함. 친구가 하나도 없으면 그냥 안내만 하고 끝
async function openSkinSharePicker(anchorRow, entry) {
  anchorRow.querySelectorAll(".skin-share-picker").forEach((el) => el.remove());
  const { friends } = await window.luna.friendsList();
  const picker = document.createElement("div");
  picker.className = "skin-share-picker";
  if (!friends?.length) {
    picker.innerHTML = `<span class="skin-share-picker-empty">공유할 친구가 없어요</span>`;
    anchorRow.appendChild(picker);
    return;
  }
  picker.innerHTML = `
    <select class="skin-share-picker-select">
      ${friends.map((f) => `<option value="${escapeHtml(f.uuid)}">${escapeHtml(f.name)}</option>`).join("")}
    </select>
    <button type="button" class="btn btn-primary btn-small skin-share-picker-send" data-i18n="btn_send_short">보내기</button>
  `;
  picker.querySelector(".skin-share-picker-send")?.addEventListener("click", async () => {
    const sendBtn = picker.querySelector(".skin-share-picker-send");
    const toUuid = picker.querySelector(".skin-share-picker-select").value;
    sendBtn.disabled = true;
    const res = await window.luna.whisperSendSkin(toUuid, entry.filePath, entry.name, entry.variant);
    if (res.ok) {
      showToast("귓속말로 스킨을 공유했어요");
      picker.remove();
    } else {
      showToast(res.error || "스킨 공유에 실패했어요", "error");
      sendBtn.disabled = false;
    }
  });
  anchorRow.appendChild(picker);
}

// 24-53차: "내가 파일로 추가한 스킨은... 리스트에서 스킨 제거도 가능하게 해주고 파일
// 다운로드도 되게 해주고 친구한테 스킨 파일 공유하기 기능도" - 기존 적용/삭제 버튼에
// 다운로드/공유 버튼을 추가. 아이콘 버튼 마크업을 목록/기록 두 곳에서 같이 쓰기 위해 뽑아냄
function skinItemActionIconsHtml() {
  return `
    <button type="button" class="icon-btn skin-item-download-btn" title="다운로드" data-i18n-title="btn_download">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button type="button" class="icon-btn skin-item-share-btn" title="친구에게 귓속말로 공유" data-i18n-title="btn_share_whisper">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;
}

// 19차: "내가 추가한 스킨들은 바뀌기만 하지 말고 리스트에 추가해줘 여러개 스위치할 수 있게" -
// 직접 올려서 적용했던 스킨들을 목록으로 보여주고, 클릭 한 번으로 다시 전환하거나 삭제할 수 있게 함
async function loadCustomSkinsList() {
  const listEl = document.getElementById("skin-custom-list");
  if (!listEl) return;
  disposeSkinViewersIn(listEl);
  listEl.innerHTML = `<div class="skin-preset-empty">불러오는 중...</div>`;

  const res = await window.luna.listCustomSkins?.();
  if (!res?.ok || !res.list?.length) {
    listEl.innerHTML = `<div class="skin-preset-empty" data-i18n="settings_skin_custom_empty">아직 직접 추가한 스킨이 없어요</div>`;
    return;
  }

  listEl.innerHTML = "";
  res.list.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "skin-custom-item";
    row.innerHTML = `
      <canvas class="skin-custom-item-face" width="76" height="104"></canvas>
      <span class="skin-custom-item-name">${escapeHtml(entry.name)}</span>
      <div class="skin-custom-item-actions">
        <button type="button" class="btn btn-ghost btn-small skin-custom-switch-btn" data-i18n="btn_apply">적용</button>
        ${skinItemActionIconsHtml()}
        <button type="button" class="icon-btn skin-custom-remove-btn" title="삭제" data-i18n-title="btn_delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    mountSkinPresetViewer(row.querySelector(".skin-custom-item-face"), entry.dataUrl, entry.variant);

    row.querySelector(".skin-custom-switch-btn")?.addEventListener("click", async () => {
      skinErrorEl.textContent = "";
      const applyRes = await window.luna.uploadSkin(entry.filePath, entry.variant);
      if (applyRes.ok) {
        setSkinVariant.value = entry.variant;
        listEl.querySelectorAll(".skin-custom-item").forEach((r) => r.classList.remove("is-active"));
        row.classList.add("is-active");
        skinFileNameEl.textContent = `${entry.name} 스킨으로 적용 완료!`;
        refreshSkinPreviewImage();
        loadSkinHistoryList();
      } else {
        skinErrorEl.textContent = "스킨 적용 실패: " + (applyRes.error || "알 수 없는 오류");
      }
    });
    row.querySelector(".skin-custom-remove-btn")?.addEventListener("click", async () => {
      await window.luna.removeCustomSkin?.(entry.id);
      loadCustomSkinsList();
    });
    row.querySelector(".skin-item-download-btn")?.addEventListener("click", async () => {
      const res2 = await window.luna.downloadSkinFile(entry.filePath, entry.name);
      if (res2.ok) showToast("스킨 파일을 저장했어요");
      else if (!res2.canceled) showToast(res2.error || "다운로드에 실패했어요", "error");
    });
    row.querySelector(".skin-item-share-btn")?.addEventListener("click", () => openSkinSharePicker(row, entry));

    listEl.appendChild(row);
  });
}

// 24-53차 신규: "여태까지 바꿨던 거 로그 있어서 되돌리기 기능도 있으면 좋겠고" - 최근 적용한
// 스킨들을 시간 역순으로 보여주고 눌러서 그 시점 스킨으로 되돌릴 수 있게 함
async function loadSkinHistoryList() {
  const listEl = document.getElementById("skin-history-list");
  if (!listEl) return;
  disposeSkinViewersIn(listEl);
  listEl.innerHTML = `<div class="skin-preset-empty">불러오는 중...</div>`;

  const res = await window.luna.getSkinHistory?.();
  if (!res?.ok || !res.list?.length) {
    listEl.innerHTML = `<div class="skin-preset-empty" data-i18n="settings_skin_history_empty">아직 변경 기록이 없어요</div>`;
    return;
  }

  listEl.innerHTML = "";
  res.list.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "skin-custom-item skin-history-item";
    const when = new Date(entry.appliedAt);
    const whenText = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    row.innerHTML = `
      <canvas class="skin-custom-item-face" width="76" height="104"></canvas>
      <span class="skin-custom-item-name">${escapeHtml(entry.name)}<span class="skin-history-item-when">${whenText}</span></span>
      <div class="skin-custom-item-actions">
        <button type="button" class="btn btn-ghost btn-small skin-history-revert-btn" data-i18n="btn_revert">되돌리기</button>
        ${skinItemActionIconsHtml()}
      </div>
    `;
    mountSkinPresetViewer(row.querySelector(".skin-custom-item-face"), entry.dataUrl, entry.variant);

    row.querySelector(".skin-history-revert-btn")?.addEventListener("click", async () => {
      skinErrorEl.textContent = "";
      const applyRes = await window.luna.revertSkin(entry.id);
      if (applyRes.ok) {
        setSkinVariant.value = entry.variant;
        skinFileNameEl.textContent = `${entry.name} 스킨으로 되돌렸어요!`;
        refreshSkinPreviewImage();
        loadSkinHistoryList();
      } else {
        skinErrorEl.textContent = "되돌리기 실패: " + (applyRes.error || "알 수 없는 오류");
      }
    });
    row.querySelector(".skin-item-download-btn")?.addEventListener("click", async () => {
      const res2 = await window.luna.downloadSkinFile(entry.filePath, entry.name);
      if (res2.ok) showToast("스킨 파일을 저장했어요");
      else if (!res2.canceled) showToast(res2.error || "다운로드에 실패했어요", "error");
    });
    row.querySelector(".skin-item-share-btn")?.addEventListener("click", () => openSkinSharePicker(row, entry));

    listEl.appendChild(row);
  });
}

btnSkinPick?.addEventListener("click", async () => {
  const filePath = await window.luna.pickSkinFile();
  if (!filePath) return;
  pickedSkinPath = filePath;
  skinFileNameEl.textContent = filePath.split(/[\\/]/).pop();
  btnSkinApply.disabled = false;
});

btnSkinApply?.addEventListener("click", async () => {
  if (!pickedSkinPath) return;
  skinErrorEl.textContent = "";
  btnSkinApply.disabled = true;
  btnSkinApply.textContent = "적용 중...";

  // 19차: "내가 추가한 스킨들은 바뀌기만 하지 말고 리스트에 추가해줘" - 직접 고른 파일을
  // 적용할 때는 saveToList:true로 넘겨서 "내가 추가한 스킨" 목록에도 같이 저장되게 함
  const pickedName = pickedSkinPath.split(/[\\/]/).pop()?.replace(/\.png$/i, "") || "커스텀 스킨";
  const res = await window.luna.uploadSkin(pickedSkinPath, setSkinVariant.value, { saveToList: true, name: pickedName });

  btnSkinApply.textContent = "적용";
  if (res.ok) {
    skinFileNameEl.textContent = "적용 완료!";
    pickedSkinPath = null;
    document.querySelectorAll(".skin-preset-btn.is-active, .skin-custom-item.is-active").forEach((b) => b.classList.remove("is-active"));
    refreshSkinPreviewImage();
    loadCustomSkinsList();
    loadSkinHistoryList();
  } else {
    skinErrorEl.textContent = "스킨 적용 실패: " + (res.error || "알 수 없는 오류");
    btnSkinApply.disabled = false;
  }
});

// 24-58차: "배경음악 설정이랑 음악 아예 전부 삭제하자" - 여기 있던 런처 배경음악 재생
// 시스템(여러 곡 순환 반복 재생) 전체를 제거함. 아래 코인/프로필 전환 효과음(sfx)은
// 배경음악과 무관한 별개 기능이라 그대로 유지함

// ---- 코인 효과음 -----------------------------------------------------------
const sfxCoin = document.getElementById("sfx-coin");
let sfxCoinReady = false;

(async () => {
  const path = await window.luna.getCoinSfx?.();
  if (path && sfxCoin) {
    sfxCoin.src = "file://" + path;
    sfxCoinReady = true;
  }
})();

async function playCoinSfx() {
  if (!sfxCoinReady || !sfxCoin) return;
  try {
    const s = await window.luna.getSettings();
    sfxCoin.volume = Math.max(0, Math.min(100, s.sfxVolume)) / 100;
    sfxCoin.currentTime = 0;
    sfxCoin.play().catch(() => {});
  } catch (_) {
    /* 무시 */
  }
}

// ---- 24-15차: 프로필 전환 효과음 --------------------------------------------
// "프로필 바꿀때 띠링 소리 같은 거 나게 해줘 효과음으로" - 위 코인 효과음(sfxCoin)처럼 mp3
// 파일을 재생하는 방식 대신, 짧은 "띠링" 벨 소리를 Web Audio API로 그 자리에서 직접
// 합성해서 재생함. 패키징할 때 sfx 폴더에 별도 파일을 챙겨넣을 필요 없이 항상 재생되고,
// 기존 효과음 볼륨 설정(sfxVolume, 코인 효과음과 공용)도 그대로 반영함
let profileSwitchAudioCtx = null;
async function playProfileSwitchDing() {
  try {
    const s = await window.luna.getSettings();
    const vol = Math.max(0, Math.min(100, s.sfxVolume)) / 100;
    if (vol <= 0) return;
    if (!profileSwitchAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      profileSwitchAudioCtx = new Ctx();
    }
    const ctx = profileSwitchAudioCtx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // "띠" - "링" 두 음을 살짝 겹쳐서 짧은 벨 느낌을 냄(높은 음 -> 조금 더 높은 음)
    [
      { freq: 1318.5, start: 0, dur: 0.28 },
      { freq: 1760, start: 0.06, dur: 0.32 },
    ].forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol * 0.35, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch (_) {
    /* 효과음 재생 실패는 조용히 넘어감 - 프로필 전환 자체는 이미 끝난 뒤라 사용자 흐름을 막을 이유가 없음 */
  }
}

// 24-58차: 위 배경음악 재생 함수(playCurrentTrack)/재생목록 순환(ended 리스너)/
// 최소화·복원·블러·포커스 연동(onMusicPause/onMusicResume)/시작 시 재생 트리거(IIFE) -
// 이 자리에 있던 런처 배경음악 재생 시스템 전체를 제거함(main.js의 music:list 핸들러 및
// 관련 IPC 제거와 짝을 이룸). music/ 폴더의 mp3 파일 자체는 남아있으니 편하실 때
// 직접 지워주셔도 됩니다.

// ---- 디스코드 버튼 -----------------------------------------------------------
document.getElementById("btn-discord")?.addEventListener("click", () => {
  window.luna.openDiscord();
});

// ---- 홈 화면 스크린샷 슬라이드쇼 ----------------------------------------------
(async () => {
  try {
    const files = await window.luna.getScreenshots();
    if (!files || files.length === 0) return;

    const container = document.getElementById("screenshot-slideshow");
    const imgA = document.getElementById("ss-img-a");
    const imgB = document.getElementById("ss-img-b");
    if (!container || !imgA || !imgB) return;

    container.hidden = false;

    let index = 0;
    let showingA = true;
    imgA.src = "file://" + files[0];

    if (files.length === 1) return; // 사진이 1장뿐이면 그냥 고정

    setInterval(() => {
      index = (index + 1) % files.length;
      const next = showingA ? imgB : imgA;
      const current = showingA ? imgA : imgB;
      next.src = "file://" + files[index];
      next.classList.add("is-active");
      current.classList.remove("is-active");
      showingA = !showingA;
    }, 6000);
  } catch (_) {
    /* 스크린샷 없어도 무시 */
  }
})();

// ---- 유저가 직접 추가하는 리소스팩 -------------------------------------------
const btnResourcepackAdd = document.getElementById("btn-resourcepack-add");
const resourcepackStatus = document.getElementById("resourcepack-status");
const resourcepackUserList = document.getElementById("resourcepack-user-list");

async function loadUserResourcePacks() {
  if (!resourcepackUserList) return;
  const list = await window.luna.listUserResourcePacks();
  resourcepackUserList.innerHTML = "";
  (list || []).forEach((fileName) => {
    const row = document.createElement("div");
    row.className = "resourcepack-item";
    row.innerHTML = `<span>${fileName}</span><button type="button">삭제</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      await window.luna.removeUserResourcePack(fileName);
      loadUserResourcePacks();
    });
    resourcepackUserList.appendChild(row);
  });
}

btnResourcepackAdd?.addEventListener("click", async () => {
  if (resourcepackStatus) resourcepackStatus.textContent = "추가하는 중...";
  const res = await window.luna.addResourcePack();
  if (!res) {
    if (resourcepackStatus) resourcepackStatus.textContent = "";
    return;
  }
  if (res.canceled) {
    if (resourcepackStatus) resourcepackStatus.textContent = "";
    return;
  }
  if (res.ok) {
    if (resourcepackStatus) resourcepackStatus.textContent = `추가됨: ${res.fileName} (다음 실행부터 적용)`;
    loadUserResourcePacks();
  } else {
    if (resourcepackStatus) resourcepackStatus.textContent = "추가 실패: " + (res.error || "알 수 없는 오류");
  }
});

// ---- 테마 색상(구매한 색으로 액센트 컬러 변경) --------------------------------
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  return rgbToHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}
// 17차: "테마모드(다크/화이트)랑 색상 스와치를 동시에 착용할 수 있게 해줘" - 예전엔 인자
// 하나(색상이든 완전테마든 그 하나)만 받았는데, 이제 색상(colorItem)과 완전 테마(modeItem)가
// 서로 다른 착용 슬롯이라 둘 다 동시에 켜져 있을 수 있어서 인자를 두 개로 나눔
// colorItem: 상점에서 산 "색상"(category: theme 등) 아이템 객체 또는 null
// modeItem: 상점에서 산 "완전 테마"(category: fulltheme, 배경까지 바뀜) 아이템 객체 또는 null
//   - modeItem이 있으면 body[data-color-theme="..."] 규칙이 배경/글자색 + 기본 포인트색까지 켜줌
//   - colorItem이 있으면 그 기본 포인트색을 사용자가 고른 색으로 다시 덮어씀(모드와 무관하게 항상 우선)
function applyThemeColor(colorItem, modeItem) {
  const root = document.documentElement;
  const body = document.body;
  const hex = typeof colorItem === "string" ? colorItem : colorItem?.hex;

  // 5-3차: 라이트 테마에서는 body[data-theme="light"] 규칙이 --accent 등을 body
  // 엘리먼트에 "직접" 다시 선언해버려서, html(documentElement)에만 인라인으로 걸어둔
  // 커스텀 색이 상속으로 내려오다가 body에서 덮어써지는 문제가 있었음(같은 엘리먼트가
  // 아니면 인라인이라도 상속값은 그 엘리먼트의 명시적 규칙에 밀림). body에도 똑같이
  // 인라인으로 걸어서 라이트/다크 어느 테마에서든 구매한 색이 항상 이기도록 함.
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-strong");
  root.style.removeProperty("--accent-dim");
  root.style.removeProperty("--accent-ink");
  body.style.removeProperty("--accent");
  body.style.removeProperty("--accent-strong");
  body.style.removeProperty("--accent-dim");
  body.style.removeProperty("--accent-ink");

  if (modeItem?.mode) document.body.dataset.colorTheme = modeItem.mode;
  else delete document.body.dataset.colorTheme;

  // colorItem이 있으면 완전 테마가 켜져 있든 아니든 항상 그 위에 포인트색을 덮어씀
  if (hex) {
    const strong = shade(hex, 0.25);
    const dim = shade(hex, -0.45);
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--accent-strong", strong);
    root.style.setProperty("--accent-dim", dim);
    body.style.setProperty("--accent", hex);
    body.style.setProperty("--accent-strong", strong);
    body.style.setProperty("--accent-dim", dim);
  }
}

// ---- 코인 -----------------------------------------------------------------
async function refreshCoins() {
  const status = await window.luna.getRewardStatus();
  const coinAmount = document.getElementById("coin-amount");
  const shopCoins = document.getElementById("shop-coins");
  // 24-14차: "출첵에서도 코인 보이게 하기"
  const attendanceCoins = document.getElementById("attendance-coins");
  const inventoryDot = document.getElementById("inventory-notif-dot");
  // 14차: "인벤토리 들어갔을 때 출석체크 글에도 빨간색 뜨게" - 사이드바 아이콘 점과 같은
  // 조건(canClaimToday)으로, 인벤토리 안 "출석체크" 탭 라벨 옆 점도 같이 켬/끔
  const attendanceTabDot = document.getElementById("inventory-attendance-tab-dot");
  if (coinAmount) coinAmount.textContent = status.coins;
  if (shopCoins) shopCoins.textContent = status.coins;
  if (attendanceCoins) attendanceCoins.textContent = status.coins;
  if (inventoryDot) inventoryDot.hidden = !status.canClaimToday;
  if (attendanceTabDot) attendanceTabDot.hidden = !status.canClaimToday;
  return status;
}

// ---- 출석체크 (달력 형식, 매월 1일 초기화, 토요일마다 보너스) ---------------------
const attendanceCalendarEl = document.getElementById("attendance-calendar");
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

async function refreshAttendanceCalendar() {
  const status = await refreshCoins();
  if (!attendanceCalendarEl) return;

  const monthLabel = document.getElementById("attendance-month-label");
  if (monthLabel) monthLabel.textContent = status.monthKey;

  attendanceCalendarEl.innerHTML = "";

  // 요일 헤더
  WEEKDAY_LABELS.forEach((w, i) => {
    const head = document.createElement("div");
    head.className = "attendance-day is-empty";
    head.innerHTML = `<span class="ad-num" style="font-size:11px;color:${i === 6 ? "var(--accent)" : "var(--text-2)"};">${w}</span>`;
    attendanceCalendarEl.appendChild(head);
  });

  // 1일이 시작하는 요일만큼 빈 칸
  for (let i = 0; i < status.firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "attendance-day is-empty";
    attendanceCalendarEl.appendChild(empty);
  }

  for (let day = 1; day <= status.daysInMonth; day++) {
    const claimed = status.claimedDays.includes(day);
    const isToday = day === status.today; // 받았든 안 받았든 항상 "오늘"은 오늘로 보여줌
    const isBonus = status.saturdays.includes(day);
    const canClaimNow = isToday && status.canClaimToday;

    const el = document.createElement("div");
    el.className =
      "attendance-day" +
      (claimed ? " is-claimed" : "") +
      (isToday ? " is-today" : "") +
      (isBonus ? " is-bonus" : "");
    el.innerHTML = `
      ${isBonus ? `<span class="ad-star"></span>` : ""}
      <span class="ad-num">${day}</span>
      <span class="ad-reward">${claimed ? "✓" : `+${status.dailyAmount}`}</span>
      ${isBonus ? `<span class="ad-bonus-tag">+${status.saturdayBonus}</span>` : ""}
    `;
    if (canClaimNow) {
      el.title = `${day}일 출석 받기${isBonus ? " (토요일 보너스!)" : ""}`;
      el.addEventListener("click", async () => {
        const res = await window.luna.claimReward(day);
        if (res.ok) {
          showToast(`${res.day}일 출석! +${res.amount} 코인 획득!`);
          playCoinSfx();
          if (res.bonus > 0) {
            setTimeout(() => showToast(`토요일 보너스! +${res.bonus} 코인!`), 500);
          }
          // 24-48차: "출석 받았는데 계속 빨간 점이 떠 있다가 다른 거 눌러야 사라짐" - 알림
          // 점을 refreshAttendanceCalendar()가 서버 상태를 다시 받아와 갱신해줄 때까지
          // 기다리지 않고, 방금 받기에 성공한 게 확실하므로 그 자리에서 바로 꺼줌(코인
          // 갱신 때 이미 쓰고 있는 것과 같은 낙관적 갱신 패턴) - 아래 refreshAttendanceCalendar()가
          // 그대로 다시 한번 정확한 상태로 맞춰줌
          // 24-51차: "출첵 받아도 빨간색이 아직도 떠" - 24-48차로도 재지적이 계속돼서, 원인을
          // 하나로 확정하지 못한 채로도 확실히 막기 위해 refreshAttendanceCalendar()(안에서
          // 서버 상태를 다시 조회해 점을 갱신함)가 끝나길 기다렸다가 "방금 성공적으로 받았다"는
          // 확실한 사실(res.ok)을 기준으로 한 번 더 강제로 꺼줌 - 재조회 결과가 뭐라 나오든
          // 이 클릭 흐름의 맨 마지막엔 항상 꺼진 상태로 확정됨
          const inventoryDot = document.getElementById("inventory-notif-dot");
          const attendanceTabDot = document.getElementById("inventory-attendance-tab-dot");
          if (inventoryDot) inventoryDot.hidden = true;
          if (attendanceTabDot) attendanceTabDot.hidden = true;
          await refreshAttendanceCalendar();
          if (inventoryDot) inventoryDot.hidden = true;
          if (attendanceTabDot) attendanceTabDot.hidden = true;
        } else {
          showToast(res.error || "받을 수 없어요", "error");
        }
      });
    } else if (claimed) {
      el.title = isToday ? "오늘 출석을 이미 받았어요" : "이미 받았어요";
    } else if (isToday) {
      el.title = "오늘이에요";
    } else {
      el.title = "아직 받을 수 없어요";
    }
    attendanceCalendarEl.appendChild(el);
  }

  loadQuests();
}

// ---- 15차 신규: 퀘스트 (일일 1/3/6시간, 주간 10/30/60시간 플레이타임) --------------
function formatQuestHours(seconds) {
  const h = seconds / 3600;
  // 소수점 하나까지만 보여줌 (예: 2.3시간) - 초 단위까지 보이면 번잡스러움
  return (Math.round(h * 10) / 10).toString();
}

function renderQuestList(containerId, tiers, playSeconds, onClaim, lockedNote) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  tiers.forEach((tier) => {
    const el = document.createElement("div");
    el.className = "quest-item" + (tier.claimed ? " is-claimed" : "");
    const progressPct = Math.min(100, Math.round((playSeconds / (tier.hours * 3600)) * 100));
    let btnLabel = "받기";
    if (tier.claimed) btnLabel = "받음";
    else if (!tier.reached) btnLabel = `${formatQuestHours(playSeconds)}/${tier.hours}시간`;
    else if (lockedNote && !tier.claimable) btnLabel = "잠김";

    el.innerHTML = `
      <div class="quest-item-main">
        <div class="quest-item-name">${tier.hours}시간 플레이</div>
        <div class="quest-item-progress-track"><div class="quest-item-progress-fill" style="width:${progressPct}%"></div></div>
      </div>
      <div class="quest-item-reward"><span class="coin-icon">🪙</span> ${tier.reward}</div>
      <button type="button" class="quest-item-claim-btn" ${tier.claimed || !tier.claimable ? "disabled" : ""}>${btnLabel}</button>
    `;
    if (tier.reached && !tier.claimed && !tier.claimable && lockedNote) {
      el.title = lockedNote;
    }
    if (tier.claimable) {
      el.querySelector(".quest-item-claim-btn").addEventListener("click", () => onClaim(tier.hours));
    }
    container.appendChild(el);
  });
}

async function loadQuests() {
  const status = await window.luna.getQuestStatus?.();
  if (!status) return;
  renderQuestList(
    "quest-daily-list",
    status.dailyTiers,
    status.dailyPlaySeconds,
    async (hours) => {
      const res = await window.luna.claimDailyQuest(hours);
      if (res.ok) {
        showToast(`일일 퀘스트 완료! +${res.amount} 코인 획득!`);
        playCoinSfx();
        refreshCoins();
        loadQuests();
      } else {
        showToast(res.error || "받을 수 없어요", "error");
      }
    },
    status.attendanceDoneToday ? null : "오늘 출석체크를 먼저 해주세요"
  );
  renderQuestList(
    "quest-weekly-list",
    status.weeklyTiers,
    status.weekPlaySeconds,
    async (hours) => {
      const res = await window.luna.claimWeeklyQuest(hours);
      if (res.ok) {
        showToast(`주간 퀘스트 완료! +${res.amount} 코인 획득!`);
        playCoinSfx();
        refreshCoins();
        loadQuests();
      } else {
        showToast(res.error || "받을 수 없어요", "error");
      }
    },
    null
  );
}

// ---- 코인 내역 ----------------------------------------------------------
function formatLogDate(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch (_) {
    return "";
  }
}

async function loadCoinLog(listId = "coin-log-list") {
  const list = document.getElementById(listId);
  if (!list) return;
  const log = await window.luna.getCoinLog();
  list.innerHTML = "";
  if (!log || log.length === 0) {
    list.innerHTML = `<div class="coin-log-empty">아직 내역이 없어요</div>`;
    return;
  }
  log.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "coin-log-item";
    const positive = entry.amount >= 0;
    row.innerHTML = `
      <span class="cl-reason">${entry.reason || "코인 변동"} · ${formatLogDate(entry.date)}</span>
      <span class="cl-amount ${positive ? "is-positive" : "is-negative"}">${positive ? "+" : ""}${entry.amount}</span>
    `;
    list.appendChild(row);
  });
}

// 상점 화면 안 코인 뱃지에서 코인 내역을 보여줌
const shopCoinBadge = document.getElementById("shop-coin-badge");
const shopCoinLogPanel = document.getElementById("shop-coin-log-panel");
// 5-4: 이 드롭다운이 상점 모달 안(overflow-y:auto로 스크롤되는 .modal-body) 구석에 있어서
// 잘려서 보이던 문제 - absolute 대신 position:fixed로 바꾸고 버튼 위치를 기준으로 좌표를
// 직접 계산해서, 스크롤/오버플로우 조상 요소에 더 이상 잘리지 않게 함
shopCoinBadge?.addEventListener("click", async (e) => {
  e.stopPropagation();
  const willShow = shopCoinLogPanel.hidden;
  if (willShow) {
    await loadCoinLog("shop-coin-log-list");
    const rect = shopCoinBadge.getBoundingClientRect();
    shopCoinLogPanel.style.position = "fixed";
    shopCoinLogPanel.style.top = rect.bottom + 6 + "px";
    shopCoinLogPanel.style.left = "auto";
    shopCoinLogPanel.style.right = Math.max(8, window.innerWidth - rect.right) + "px";
  }
  shopCoinLogPanel.hidden = !willShow;
});
document.addEventListener("click", (e) => {
  if (!shopCoinLogPanel || shopCoinLogPanel.hidden) return;
  if (!shopCoinLogPanel.contains(e.target) && e.target !== shopCoinBadge && !shopCoinBadge.contains(e.target)) {
    shopCoinLogPanel.hidden = true;
  }
});

// ---- 공통 토스트 알림 (성공/에러 둘 다 이걸로 통일) ---------------------------
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = "coin-toast" + (type === "error" ? " coin-toast-error" : "");
  // 24-70차: "업데이트 확인 오류 뭐야 이거?" - 외부 라이브러리(electron-updater 등)가 던진
  // 원본 에러 메시지가 실수로 그대로 흘러들어오면(응답 헤더까지 통째로 포함된 매우 긴 문자열
  // 등) 화면 위쪽에 알아볼 수 없는 텍스트 덩어리가 떴던 적이 있었음. 근본 원인(app:check-update-now)은
  // 따로 고쳤지만, 앞으로 비슷한 실수가 또 생겨도 화면이 깨지지 않도록 여기서도 길이를 한 번
  // 잘라줌 - 정상적인 짧은 안내 문구는 전혀 영향 없음
  const text = String(message ?? "");
  toast.textContent = text.length > 120 ? text.slice(0, 120) + "…" : text;
  // 스크롤 위치나 어떤 화면이 열려있든 항상 창 위쪽 가운데 고정으로 보이게 함
  document.body.appendChild(toast);
  // 24-12차: "코인 부족하면 부족하다고 해야지" - 실패 이유를 읽기도 전에 사라진다는 지적으로,
  // 오류 토스트는 성공 토스트보다 더 오래(2.2초→3.6초) 떠 있도록 함(읽고 판단할 시간을 더 줌)
  setTimeout(() => toast.remove(), type === "error" ? 3600 : 2200);
}

// 10-2: 모드/리소스팩/쉐이더를 지운 직후 "실행취소"할 수 있는 토스트 (조금 더 오래 떠 있음)
function showUndoToast(message, onUndo) {
  const toast = document.createElement("div");
  toast.className = "coin-toast coin-toast-undo";
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "coin-toast-undo-btn";
  undoBtn.textContent = "실행취소";
  undoBtn.addEventListener("click", async () => {
    toast.remove();
    await onUndo();
  });
  toast.appendChild(undoBtn);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

// ---- 상점 -------------------------------------------------------------------
let shopLoaded = false;
let shopCatalogCache = null;
let shopStateCache = null;
let shopCurrentCategory = "all";

// 13-4(4차): "전체" 탭 좌/우 메인 상품 카드 하나를 그려주는 공용 함수.
// item이 없으면 꾸며내지 않고 정직하게 "없음" 빈 상태를 보여줌
// 9차: 상점의 원형 스와치만 봐서는 "테마 색상"(포인트 색만 바뀜)인지 "테마"(배경/글자색까지
// 전부 바뀌는 테마 프리셋)인지 구분이 안 간다는 피드백 - 카테고리 탭에서 쓰는 것과 같은
// 격자 아이콘 배지를 원 모서리에 작게 붙여서 "테마" 상품만 한눈에 구분되게 함
function shopItemBadge(item) {
  if (item.category !== "fulltheme") return "";
  return `<span class="shop-swatch-fulltheme-badge" title="테마 프리셋 (배경/글자색까지 전부 바뀌어요)">
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M3.5 15h17M9 3.5v17" stroke-linecap="round"/></svg>
  </span>`;
}

// 24-14차 신규: "상점에 상품들 바로 구매 말고 상품 보기 해서 창 띄우고 그 색이 입혀진 클라이언트
// 사진을 앞에 보여주고 구매할지 고르게 하고 x 버튼으로 나갈 수도 있게 하고" - 캐러셀/그리드의
// 구매 버튼을 눌러도 곧장 구매하지 않고 이 미리보기 창을 먼저 띄움. 실제 구매(luna.buyColor
// 호출 + 토스트 + 상점 새로고침)는 원래 각 버튼 핸들러에 있던 걸 여기 "구매하기" 버튼으로 그대로
// 옮겨옴. 실제 스크린샷이 없어서 설정 > 테마 갤러리와 같은 .theme-gallery-preview 미니 목업을
// 재사용해 "이 색이 클라이언트에 입혀지면 이런 느낌"을 보여줌
function openShopPreview(item) {
  const overlay = document.getElementById("shop-preview-overlay");
  const mockup = document.getElementById("shop-preview-mockup");
  const nameEl = document.getElementById("shop-preview-name");
  const priceEl = document.getElementById("shop-preview-price");
  const buyBtn = document.getElementById("btn-shop-preview-buy");
  if (!overlay || !mockup || !nameEl || !priceEl || !buyBtn) return;
  const t = window.NovaI18n?.t;

  // 24-66차 신규: hex가 없는 소모품(닉네임 변경권 등)은 icon만 있음 - 배경 대신 아이콘만 표시
  mockup.style.background = item.hex || (item.icon ? "var(--surface-2, #2a2a2e)" : "");
  mockup.querySelectorAll(".shop-preview-plate, .shop-preview-icon").forEach((el) => el.remove());
  if (item.plateColor) {
    const plate = document.createElement("div");
    plate.className = "shop-preview-plate";
    plate.style.background = item.plateColor;
    mockup.appendChild(plate);
  } else if (!item.hex && item.icon) {
    const iconEl = document.createElement("div");
    iconEl.className = "shop-preview-icon";
    iconEl.textContent = item.icon;
    mockup.appendChild(iconEl);
  }

  nameEl.textContent = item.name || "";
  const hasDiscount = item.originalPrice && item.originalPrice > item.price;
  priceEl.innerHTML = `${hasDiscount ? `<span class="shop-swatch-price-original">🪙 ${item.originalPrice}</span>` : ""}<span class="coin-icon">🪙</span> ${item.price}`;

  buyBtn.disabled = false;
  buyBtn.textContent = t?.("shop_buy_now") || "구매하기";
  buyBtn.onclick = () =>
    withBusyButton(buyBtn, t?.("shop_buying") || "구매 중...", async () => {
      const res = await window.luna.buyColor(item.id);
      if (!res.ok) {
        showToast(res.error || t?.("shop_buy_fail") || "구매 실패", "error");
        return;
      }
      // 24-66차 신규: 소모품은 "착용" 개념이 아니라 "내 프로필에서 사용" 개념이라 안내 문구를 분기
      showToast(
        item.consumable
          ? t?.("shop_buy_success_consumable", { name: item.name }) ||
              `${item.name} 구매 완료! 내 프로필 화면에서 사용할 수 있어요`
          : t?.("shop_buy_success", { name: item.name }) || `${item.name} 구매 완료! 보관함에서 착용할 수 있어요`
      );
      shopLoaded = false;
      closeShopPreview();
      await loadShop();
    });

  overlay.hidden = false;
}
function closeShopPreview() {
  const overlay = document.getElementById("shop-preview-overlay");
  if (overlay) overlay.hidden = true;
}
document.getElementById("btn-shop-preview-close")?.addEventListener("click", closeShopPreview);
document.getElementById("btn-shop-preview-cancel")?.addEventListener("click", closeShopPreview);
document.getElementById("shop-preview-overlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeShopPreview();
});

// 17차 신규: 상점 상단 "메인 상품" 자리를 고정 2카드(ㄴ자) 대신, 일정 시간마다 옆으로
// 넘어가는 캐러셀로 재작업. featuredMain/featuredSub 아이템(+featuredPairColorId로 지정된
// 짝꿍 단색)을 한 슬라이드씩 큼직하게 보여줌. 사진 대신, 그 아이템의 색을 흐릿하게 겹친
// 그라데이션 블록으로 "느낌만" 주고(글씨 없음) 이름/가격/버튼은 사진 밖에 따로 둠
let shopCarouselTimer = null;
let shopCarouselIndex = 0;
let shopCarouselDragCleanup = null;
// 24-2차: "메인상품이 아직도 잘 안돌아가 옆으로 그리고 취소될 때 에니메이션도 안나오고" -
// 19~23차 내내 네이티브 가로 스크롤(overflow-x:auto + scrollLeft 직접 조작)을 붙잡고
// 문턱/애니메이션 방식을 계속 고쳤는데도 매번 다르게 고장나 보였던 진짜 원인 두 가지를
// 이번에 찾음: (1) 브라우저의 scroll-snap/스크롤 관성이 우리 requestAnimationFrame
// 애니메이션과 타이밍이 계속 미묘하게 충돌했고, (2) 드래그 방향 판정 부호가 실제로
// 거꾸로였음(draggedBy = startScroll - scrollLeft로 계산했는데, 왼쪽으로 끌어서 "다음"
// 상품이 보이게 만들어도 손을 떼면 반대로 "이전" 상품 쪽으로 튕겨나가고 있었음 - 살짝만
// 건드려도 이상하게 튀는 것처럼 느껴진 원인). 스크롤 자체를 걷어내고 track은
// 뷰포트(overflow:hidden)로만 두고, 실제 이동은 안쪽 레일(.shop-carousel-rail)의
// transform:translateX만으로 처리하도록 전면 교체 - 브라우저 스크롤 동작이 전혀 개입하지
// 않으니 넘어갈 때도 취소돼서 되돌아갈 때도 항상 우리가 그린 애니메이션 그대로 보임
let shopCarouselScrollToken = 0;
function renderShopCarousel(catalog, state) {
  const track = document.getElementById("shop-carousel-track");
  const dotsWrap = document.getElementById("shop-carousel-dots");
  const wrap = document.getElementById("shop-carousel");
  if (!track || !dotsWrap || !wrap) return;

  const slideDefs = [catalog.find((c) => c.featuredMain), catalog.find((c) => c.featuredSub)].filter(Boolean);
  if (shopCarouselTimer) { clearInterval(shopCarouselTimer); shopCarouselTimer = null; }
  if (shopCarouselDragCleanup) { shopCarouselDragCleanup(); shopCarouselDragCleanup = null; }

  if (slideDefs.length === 0) {
    wrap.classList.add("is-empty");
    track.innerHTML = `<div class="shop-carousel-slide"><div class="shop-featured-empty">${window.NovaI18n?.t?.("shop_no_item") || "상품 없음"}</div></div>`;
    dotsWrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("is-empty");
  const t = window.NovaI18n?.t;

  // 19차: "중간에 그라데이션 끊긴 거 없애고 ... 연결되었지만 다른 화면에 보이게 해줘" -
  // 슬라이드마다 따로 그리던 배경 대신, 전체 슬라이드 폭에 걸쳐 이어지는 그라데이션 한 장을
  // 만들고(각 상품의 색이 이어지는 지점에서 자연스럽게 섞임) 그 위에 정보만 슬라이드별로
  // 번갈아(블랙앤화이트=오른쪽, 핑크=왼쪽) 배치함
  // 20차: "블랙앤화이트 부분에 검정색느낌이 하나도 없고 핑크가 너무 많아 가운데만 조금
  // 있어야지" - 예전엔 2-스탑 그라데이션이 전체 폭에 걸쳐 쭉 섞여서, 각 슬라이드 자기 구간
  // 안에서도 이미 절반쯤 옆 색으로 물들어 보였음. 이제 각 슬라이드 구간(1/n)의 대부분은
  // 자기 색으로 고정하고, 슬라이드끼리 맞닿는 이음매(seam) 근처에서만 짧게(blend폭) 섞이게 함
  const shopBgBlend = 6;
  const bgStops = slideDefs
    .map((item, i) => {
      const start = (i / slideDefs.length) * 100;
      const end = ((i + 1) / slideDefs.length) * 100;
      const innerStart = i === 0 ? start : start + shopBgBlend;
      const innerEnd = i === slideDefs.length - 1 ? end : end - shopBgBlend;
      return `${item.hex} ${innerStart}%, ${item.hex} ${innerEnd}%`;
    })
    .join(", ");
  const bgHtml = `<div class="shop-carousel-bg" style="width:${slideDefs.length * 100}%; background: linear-gradient(90deg, ${bgStops});"></div>`;

  // 24-2차: 슬라이드 폭(flex-basis)을 슬라이드 개수 기준으로 인라인 지정 - 레일 폭이
  // 슬라이드 수 × 100%라, 슬라이드 하나는 그 1/n이어야 뷰포트 폭과 정확히 맞음
  const slideBasis = 100 / slideDefs.length;
  const slidesHtml = slideDefs
    .map((item, i) => {
      const pair = catalog.find((c) => c.id === item.featuredPairColorId);
      const owned = state.owned.includes(item.id);
      const hasDiscount = item.originalPrice && item.originalPrice > item.price;
      const reversed = i % 2 === 1;
      return `
        <div class="shop-carousel-slide${reversed ? " is-reversed" : ""}" style="flex:0 0 ${slideBasis}%;">
          <div class="shop-carousel-info">
            <div class="shop-carousel-name">${item.name}${pair ? ` <span class="shop-carousel-pair-dot" style="background:${pair.hex}" title="${pair.name}"></span>` : ""}</div>
            <div class="shop-carousel-price-row">
              ${hasDiscount ? `<span class="shop-carousel-discount-badge">${item.discountPercent || 30}% OFF</span>` : ""}
              ${hasDiscount ? `<span class="shop-carousel-price-original">🪙 ${item.originalPrice}</span>` : ""}
              <span class="shop-carousel-price-now">🪙 ${item.price}</span>
            </div>
            <button type="button" class="shop-carousel-buy" data-item-id="${item.id}" ${owned ? "disabled" : ""}>
              ${owned ? t?.("shop_owned") || "구매함" : t?.("shop_buy_now") || "바로 구매하기"}
            </button>
          </div>
        </div>`;
    })
    .join("");

  track.innerHTML = bgHtml + `<div class="shop-carousel-rail" style="width:${slideDefs.length * 100}%;">${slidesHtml}</div>`;
  const bgEl = track.querySelector(".shop-carousel-bg");
  const railEl = track.querySelector(".shop-carousel-rail");

  // 24-14차: "상품들 바로 구매 말고 상품 보기 해서 창 띄우고" - 눌러도 바로 구매하지 않고
  // 미리보기 창(openShopPreview)을 먼저 띄움. 실제 구매는 그 창의 구매 버튼에서 일어남
  track.querySelectorAll(".shop-carousel-buy").forEach((buyBtn) => {
    if (buyBtn.disabled) return;
    buyBtn.addEventListener("click", () => {
      const item = catalog.find((c) => c.id === buyBtn.dataset.itemId);
      if (item) openShopPreview(item);
    });
  });

  dotsWrap.innerHTML = slideDefs.map((_, i) => `<button type="button" class="shop-carousel-dot" data-index="${i}"></button>`).join("");

  // 24-2차: 지금 실제로 화면에 적용된 translateX 값(px) - 드래그/애니메이션 모두 이 값을
  // 갱신하며, .shop-carousel-bg는 기존 scale(1.08) 장식을 유지한 채 translateX만 같이 더함
  let liveX = 0;
  function setTransform(x) {
    liveX = x;
    railEl.style.transform = `translateX(${x}px)`;
    bgEl.style.transform = `translateX(${x}px) scale(1.08)`;
  }
  function targetXFor(index) {
    return -index * (track.clientWidth || 1);
  }
  function animateTo(targetX, duration = 260) {
    const myToken = ++shopCarouselScrollToken;
    const startX = liveX;
    const delta = targetX - startX;
    if (Math.abs(delta) < 0.5) {
      setTransform(targetX);
      return;
    }
    const startTime = performance.now();
    const easeOutCubic = (tt) => 1 - Math.pow(1 - tt, 3);
    function step(now) {
      if (myToken !== shopCarouselScrollToken) return; // 그 사이 새 드래그/이동이 시작되면 중단
      const elapsed = now - startTime;
      const tt = Math.min(1, elapsed / duration);
      setTransform(startX + delta * easeOutCubic(tt));
      if (tt < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function updateActiveDot() {
    dotsWrap.querySelectorAll(".shop-carousel-dot").forEach((d, i) => d.classList.toggle("is-active", i === shopCarouselIndex));
  }
  function goTo(index, instant) {
    shopCarouselIndex = ((index % slideDefs.length) + slideDefs.length) % slideDefs.length;
    const targetX = targetXFor(shopCarouselIndex);
    if (instant) {
      shopCarouselScrollToken++; // 진행 중이던 애니메이션이 있다면 취소
      setTransform(targetX);
    } else {
      animateTo(targetX);
    }
    updateActiveDot();
  }
  dotsWrap.querySelectorAll(".shop-carousel-dot").forEach((d) => d.addEventListener("click", () => { goTo(Number(d.dataset.index)); }));
  goTo(0, true);

  // 19차: "메인 상품 드래그로도 옆으로 움직일 수 있게 해주고" - 마우스로 눌러서 끌면 레일을
  // 직접 translateX로 옮기는 드래그. 드래그 중 클릭이 그대로 "구매" 버튼 등으로 새는 걸
  // 막기 위해, 실제로 움직였을 때만 짧게 클릭을 가로챔
  // 24-2차: draggedBy는 이제 "드래그로 실제 옮겨진 픽셀"(dx) 그 자체라 부호가 직관적임 -
  // 왼쪽으로 끌면(draggedBy<0) 다음 상품(+1), 오른쪽으로 끌면(draggedBy>0) 이전 상품(-1).
  // (예전 scrollLeft 기반 계산은 이 부호가 거꾸로 뒤집혀 있던 버그가 있었음 - 위 주석 참고)
  let drag = null;
  let wasDragging = false;
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    shopCarouselScrollToken++; // 진행 중이던 스냅 애니메이션이 있으면 새 드래그가 우선하도록 취소
    drag = { startX: e.clientX, startLiveX: liveX, moved: false };
    track.classList.add("is-dragging");
    if (shopCarouselTimer) { clearInterval(shopCarouselTimer); shopCarouselTimer = null; }
    track.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    setTransform(drag.startLiveX + dx);
  };
  const onPointerUp = () => {
    if (!drag) return;
    track.classList.remove("is-dragging");
    if (drag.moved) {
      wasDragging = true;
      const draggedBy = liveX - drag.startLiveX;
      const threshold = 12;
      const targetIndex = Math.abs(draggedBy) > threshold
        ? shopCarouselIndex + (draggedBy < 0 ? 1 : -1)
        : shopCarouselIndex;
      goTo(targetIndex);
      setTimeout(() => { wasDragging = false; }, 60);
    }
    drag = null;
  };
  const onClickCapture = (e) => {
    if (wasDragging) { e.preventDefault(); e.stopPropagation(); }
  };
  // 24-2차: 픽셀 기준 transform이라 창을 최대화/복원(23차부터 가능)해서 track 폭이 바뀌면
  // 예전 픽셀 위치가 슬라이드 경계와 안 맞게 됨 - 드래그 중이 아닐 때만 지금 인덱스 자리로
  // 애니메이션 없이 다시 맞춰줌
  const onResize = () => { if (!drag) setTransform(targetXFor(shopCarouselIndex)); };
  track.addEventListener("pointerdown", onPointerDown);
  track.addEventListener("pointermove", onPointerMove);
  track.addEventListener("pointerup", onPointerUp);
  track.addEventListener("pointerleave", onPointerUp);
  track.addEventListener("click", onClickCapture, true);
  window.addEventListener("resize", onResize);
  shopCarouselDragCleanup = () => {
    track.removeEventListener("pointerdown", onPointerDown);
    track.removeEventListener("pointermove", onPointerMove);
    track.removeEventListener("pointerup", onPointerUp);
    track.removeEventListener("pointerleave", onPointerUp);
    track.removeEventListener("click", onClickCapture, true);
    window.removeEventListener("resize", onResize);
  };

  if (slideDefs.length > 1) {
    shopCarouselTimer = setInterval(() => goTo(shopCarouselIndex + 1), 4500);
  }
}

// 24-14차: renderShopFeaturedCard()는 17차 캐러셀 개편 이후로 아무 데서도 호출되지 않는
// 죽은 코드였음(index.html에 이 함수가 찾는 shop-featured-main/shop-featured-sub 같은
// id 자체가 없음) - 정리 차원에서 제거함. 실제로 쓰이는 메인상품 렌더링은 renderShopCarousel().

function renderShopGrid() {
  if (!shopCatalogCache || !shopStateCache) return;
  const catalog = shopCatalogCache;
  const state = shopStateCache;

  // ---- 상점 그리드: 구매만 가능 (이미 산 건 "보유 중"만 표시, 착용은 보관함에서) ----
  const grid = document.getElementById("shop-grid");
  grid.innerHTML = "";

  // 13-4(4차): "전체" 탭은 이제 일부(번들)만이 아니라 카탈로그 전체를 "좌라라락" 진열함.
  // 다른 카테고리 탭은 기존처럼 그 카테고리만 필터링
  // 24-14차: "메인상품이 왜 도대체 한 화면에 다 있는 거야" - "전체" 탭 그리드가 캐러셀에
  // 이미 크게 떠 있는 메인/서브 메인 상품(featuredMain/featuredSub)까지 그대로 다시 진열하고
  // 있어서, 같은 상품이 위(캐러셀)/아래(그리드)에 중복으로 보이고 있었음. "전체" 탭에서만
  // 그 둘을 그리드에서 제외함(전용 "테마" 카테고리 탭에서는 여전히 보임)
  const filtered =
    shopCurrentCategory === "all"
      ? catalog.filter((c) => !c.featuredMain && !c.featuredSub)
      : catalog.filter((c) => (c.category || "theme") === shopCurrentCategory);

  // 13-2/13-3(4차): 메인/서브 메인 상품 카드 + 전체 카탈로그 진열은 "전체" 탭에서만 보임
  const featuredWrap = document.getElementById("shop-featured");
  if (featuredWrap) featuredWrap.hidden = shopCurrentCategory !== "all";
  const redeemSection = document.querySelector(".shop-redeem-section");
  if (redeemSection) redeemSection.hidden = shopCurrentCategory !== "all"; // 12-5(4차)

  const tShop = window.NovaI18n?.t;
  const hasDiscountFn = (c) => c.originalPrice && c.originalPrice > c.price;
  // 24-11차: "할인 상품이 가운데(검정 근처)로 몰려있다, 원래처럼 양 끝에 있어야지" -
  // "전체" 탭에서만 할인 상품을 목록 맨 앞/맨 뒤로 나눠 배치함(카테고리별 탭은 원래
  // 카탈로그 순서를 그대로 씀)
  let ordered = filtered;
  if (shopCurrentCategory === "all") {
    const discounted = filtered.filter(hasDiscountFn);
    const rest = filtered.filter((c) => !hasDiscountFn(c));
    const front = discounted.filter((_, i) => i % 2 === 0);
    const back = discounted.filter((_, i) => i % 2 === 1);
    ordered = [...front, ...rest, ...back];
  }
  if (ordered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; color:var(--text-2); font-size:12px; padding:30px 0; text-align:center;">${tShop?.("shop_empty_category") || "이 카테고리는 곧 채워질 예정이에요!"}</div>`;
  } else {
    ordered.forEach((color) => {
      // 24-66차 신규: 소모품(닉네임 변경권 등)은 "한 번만 살 수 있음"(ownedColors) 규칙이 아니라
      // 살 때마다 개수가 쌓이는 방식이라, owned 판정에서 제외하고 대신 보유 개수를 따로 계산함
      const owned = !color.consumable && state.owned.includes(color.id);
      const ownedCount = color.consumable ? (state.consumables?.[color.consumableField || color.id] || 0) : 0;
      const hasDiscount = hasDiscountFn(color);
      // 24-66차 신규: hex가 없는 소모품은 스와치 배경을 중립 색으로 깔고 그 위에 icon을 얹음
      const swatchBg = color.hex || "var(--surface-2, #2a2a2e)";

      const el = document.createElement("div");
      el.className = "shop-swatch";
      el.innerHTML = `
        <div class="shop-swatch-color" style="background:${swatchBg}">${color.plateColor ? `<div class="shop-swatch-plate" style="background:${color.plateColor}"></div>` : ""}${color.icon ? `<span class="shop-swatch-icon">${color.icon}</span>` : ""}${shopItemBadge(color)}${hasDiscount ? `<span class="shop-swatch-discount-badge">${color.discountPercent || 30}%</span>` : ""}${ownedCount > 0 ? ` <span class="shop-swatch-owned-count">×${ownedCount}</span>` : ""}</div>
        <div class="shop-swatch-price">${color.name}</div>
        <button type="button" class="${owned ? "equipped" : "buy"}" ${owned ? "disabled" : ""}>
          ${owned
            ? tShop?.("shop_owned") || "구매함"
            : `${hasDiscount ? `<span class="shop-swatch-price-original">🪙 ${color.originalPrice}</span>` : ""}<span class="coin-icon">🪙</span> ${color.price}`}
        </button>
      `;
      if (!owned) {
        // 24-14차: 그리드도 캐러셀과 동일하게 바로 구매 대신 미리보기 창을 먼저 띄움
        const buyBtn = el.querySelector("button");
        buyBtn.addEventListener("click", () => openShopPreview(color));
      }
      grid.appendChild(el);
    });
  }

  // 13-2/13-3(4차): "메인 상품"(좌) / "서브 메인 상품"(우) - main.js 카탈로그에 featuredMain /
  // featuredSub 플래그가 붙은 아이템이 있을 때만 실데이터로 보여주고, 없으면 꾸며내지 않고
  // "없음" 빈 상태를 그대로 보여줌 (사용자 지시: "없으면 없다고 뜨고 함부로 넣지마")
  renderShopCarousel(catalog, state);
}

async function loadShop() {
  await refreshCoins();
  loadRedeemDevPanel();
  if (!shopLoaded) {
    const [catalog, state] = await Promise.all([window.luna.getShopCatalog(), window.luna.getShopState()]);
    shopCatalogCache = catalog;
    shopStateCache = state;
    shopLoaded = true;
  }
  renderShopGrid();
  requestAnimationFrame(() => updateShopCategoryPill(true));
}

// ---- 보관함: 구매한 아이템 착용/해제 (Shop과 별도 화면) --------------------------
// 5-4(5차): "테마 색상은 설정에서 설정 못하게 해줘" - 착용은 보관함(인벤토리)에서만
// 가능하도록 설정 > 화면 탭에 있던 착용 그리드를 제거함. 이 함수 자체는 보관함에서만
// 호출됨 (gridId/defaultBtnId 인자는 남겨뒀지만 실제 호출부는 inventory-grid 하나뿐)
// 17차: 밝기를 대충 계산해서, 색이 밝으면 검은 글씨/어두우면 흰 글씨를 씀(가독성 확보)
function readableTextColorFor(hex) {
  const h = (hex || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#151515" : "#ffffff";
}
const INVENTORY_CATEGORY_LABELS = { theme: "색상", fulltheme: "테마", cosmetic: "꾸미기", special: "스페셜" };

async function renderEquipGrid(gridId, defaultBtnId, onChanged) {
  const [catalog, state] = await Promise.all([window.luna.getShopCatalog(), window.luna.getShopState()]);

  const invGrid = document.getElementById(gridId);
  if (!invGrid) return;
  invGrid.innerHTML = "";

  const ownedColors = catalog.filter((c) => state.owned.includes(c.id));
  if (ownedColors.length === 0) {
    // 9차: 그냥 안내 문구만 있어서 상점까지 직접 찾아가야 했는데, 바로 이동하는 버튼을 추가함
    invGrid.innerHTML = `
      <div class="inventory-empty" style="grid-column:1/-1;">
        <div style="color:var(--text-2); font-size:12px;">${window.NovaI18n?.t?.("inventory_empty") || "아직 구매한 아이템이 없어요. 상점에서 먼저 구매해주세요."}</div>
        <button type="button" id="btn-inventory-goto-shop" class="btn btn-primary btn-small" style="margin-top:10px;">${window.NovaI18n?.t?.("btn_go_to_shop") || "상점으로 가기"}</button>
      </div>
    `;
    document.getElementById("btn-inventory-goto-shop")?.addEventListener("click", () => {
      document.querySelector('.sidebar-icon[data-panel="shop"]')?.click();
    });
    return;
  }

  // 17차: "구매한 아이템도 카테고리별로 나눠줘" - fulltheme/theme(+미래의 cosmetic/special)별로 섹션 헤더를 붙여서 그림
  const byCategory = {};
  ownedColors.forEach((c) => {
    const cat = c.category || "theme";
    (byCategory[cat] = byCategory[cat] || []).push(c);
  });
  // fulltheme(완전 테마)을 먼저 보여줌 - 상점과 동일한 우선순위
  const categoryOrder = ["fulltheme", "theme", "cosmetic", "special"].filter((c) => byCategory[c]?.length);

  categoryOrder.forEach((cat) => {
    const section = document.createElement("div");
    section.className = "inventory-category-section";
    section.style.gridColumn = "1/-1";
    section.innerHTML = `<div class="inventory-category-title">${INVENTORY_CATEGORY_LABELS[cat] || cat}</div>`;
    const sectionGrid = document.createElement("div");
    sectionGrid.className = "shop-grid inventory-category-grid";
    section.appendChild(sectionGrid);
    invGrid.appendChild(section);

    byCategory[cat].forEach((color) => {
      // 17차: "테마모드(다크/화이트)랑 색상을 동시에 착용할 수 있게 해줘" - 착용 슬롯이
      // 이제 색상(equippedColor)/완전 테마(equippedMode) 둘로 나뉘어 있어서, 카테고리에 따라
      // 서로 다른 슬롯과 비교해야 함
      const equipped = cat === "fulltheme" ? state.equippedMode === color.id : state.equipped === color.id;
      // 17차: "구매한 테마 버튼은 그 테마 색상으로 해줘" - 착용하기 버튼 자체를 그 아이템의 실제 색으로 물들임
      const textColor = readableTextColorFor(color.hex);

      const el = document.createElement("div");
      el.className = "shop-swatch";
      el.dataset.colorId = color.id;
      el.innerHTML = `
        <div class="shop-swatch-color" style="background:${color.hex}">${shopItemBadge(color)}</div>
        <div class="shop-swatch-price">${color.name}</div>
        <button type="button" class="${equipped ? "equipped" : "equip"} is-color-tinted" ${equipped ? "disabled" : ""}
          style="background:${color.hex}; border-color:${color.hex}; color:${textColor};">${window.NovaI18n?.t?.(equipped ? "equip_equipped" : "equip_wear") || (equipped ? "착용 중" : "착용하기")}</button>
      `;
      if (!equipped) {
        el.querySelector("button").addEventListener("click", async () => {
          const res = await window.luna.equipColor(color.id);
          if (res.ok) {
            const equippedColorItem = res.equipped ? catalog.find((c) => c.id === res.equipped) : null;
            const equippedModeItem = res.equippedMode ? catalog.find((c) => c.id === res.equippedMode) : null;
            applyThemeColor(equippedColorItem, equippedModeItem);
            // 24-69차: "보관함에서 테마 바꾸면 장착중이 빠뀌여야 하는데 안바뀌여" - 예전엔
            // 착용 API만 부르고 방금 누른 버튼에만 팝 애니메이션을 붙였을 뿐, 그리드 자체를
            // 다시 그리지 않아서 이전에 "장착 중"이던 다른 스와치가 그대로 "장착 중"으로
            // 남아있고 방금 누른 것도 "착용하기" 상태 그대로였음. 그리드를 새 착용 상태
            // 기준으로 통째로 다시 그려서 모든 스와치의 라벨/비활성 상태가 즉시 반영되게 함
            await renderEquipGrid(gridId, defaultBtnId, onChanged);
            // 14차: "구매한 아이템 착용할 때 모션 좀 넣어줘" - 다시 그린 그리드에서 방금
            // 착용한 항목을 색상 id로 정확히 다시 찾아서 잠깐 팝(pop) 애니메이션 클래스를 붙였다가 뗌
            const justEquippedEl = document.getElementById(gridId)?.querySelector(`.shop-swatch[data-color-id="${CSS.escape(color.id)}"]`);
            if (justEquippedEl) {
              justEquippedEl.classList.add("is-just-equipped");
              setTimeout(() => justEquippedEl.classList.remove("is-just-equipped"), 500);
            }
            if (onChanged) onChanged();
          }
        });
      }
      sectionGrid.appendChild(el);
    });
  });

  // 기본 테마가 이미 적용 중이면 "적용" 버튼을 눌린 상태처럼 보여줌 (색상/완전테마 둘 다 없을 때만)
  const isDefault = (!state.equipped || state.equipped === "default") && !state.equippedMode;
  const defaultBtn = document.getElementById(defaultBtnId);
  if (defaultBtn) {
    defaultBtn.disabled = isDefault;
    defaultBtn.textContent = isDefault ? "적용 중" : "적용";
    defaultBtn.classList.toggle("equipped", isDefault);
  }
}

async function loadInventory() {
  await refreshAttendanceCalendar();
  await renderEquipGrid("inventory-grid", "btn-shop-default");
}

document.querySelectorAll(".shop-category-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".shop-category-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    updateShopCategoryPill();
    shopCurrentCategory = btn.dataset.category;
    renderShopGrid();
  });
});

document.getElementById("btn-shop-default")?.addEventListener("click", async () => {
  // 24-54차: "기존 초록 테마로 돌리기가 아니라 기존 색상으로 변경하기고 테마는 바뀌면 안되지" -
  // 예전엔 shop:equip("default")를 써서 색상/완전 테마 슬롯을 둘 다 초기화했는데, 이제 이
  // 버튼은 "색상" 슬롯만 초기화하고 착용 중인 완전 테마는 그대로 유지해야 함. 이미 있던
  // shop:unequip-category 핸들러(한 슬롯만 해제)를 대신 씀
  const res = await window.luna.unequipShopCategory("theme");
  if (res.ok) {
    await applyEquippedShopTheme(); // 실제 남아있는 착용 상태(완전 테마 포함)를 다시 조회해서 반영
    shopLoaded = false;
    await loadInventory();
  }
});
// ---- 리딤 코드 ---------------------------------------------------------------
const redeemInput = document.getElementById("redeem-input");
const redeemMessage = document.getElementById("redeem-message");

document.getElementById("btn-redeem")?.addEventListener("click", async () => {
  const code = redeemInput.value;

  const res = await window.luna.submitRedeemCode(code);
  if (res.ok) {
    showToast(`+${res.amount} 코인 획득!`);
    playCoinSfx();
    redeemInput.value = "";
    refreshCoins();
  } else {
    showToast(res.error || "사용할 수 없는 코드예요.", "error");
  }
});
redeemInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-redeem")?.click();
});

async function loadRedeemDevPanel() {
  const panel = document.getElementById("redeem-dev-panel");
  const list = document.getElementById("redeem-dev-list");
  if (!panel || !list) return;

  const codes = await window.luna.getRedeemCodesDev?.();
  if (!codes || codes.length === 0) {
    panel.hidden = true;
    return;
  }

  list.innerHTML = "";
  codes.forEach(({ label, amount }) => {
    const row = document.createElement("div");
    row.className = "redeem-dev-item";
    row.innerHTML = `<span>${label}</span><b>${amount} 코인</b>`;
    list.appendChild(row);
  });
  panel.hidden = false;
}

// ---- 시작할 때 코인/선물상자/적용된 테마 색상 반영 ------------------------------
// 24-54차: 위 siteAccountReadyPromise(사이트 계정 검증)가 끝나기 전에 refreshCoins()를
// 부르면 메인 프로세스가 아직 "연동 안 됨"으로 보고 로컬 데이터를 보는 바람에 출석체크
// 상태가 잘못 계산될 수 있었음 - 그 확인이 끝난 뒤에만 진행하도록 기다림
(async () => {
  await siteAccountReadyPromise;
  const state = await window.luna.getShopState();
  // 17차: 색상/완전 테마가 서로 다른 슬롯이라 둘 다 따로 찾아서 동시에 적용해야 함
  if (state.equipped || state.equippedMode) {
    const catalog = await window.luna.getShopCatalog();
    const color = state.equipped ? catalog.find((c) => c.id === state.equipped) : null;
    const mode = state.equippedMode ? catalog.find((c) => c.id === state.equippedMode) : null;
    applyThemeColor(color, mode);
  }
  refreshCoins();
})();

// ---- 계정 전환 / 로그아웃 (프로필 클릭으로 열림) ------------------------------
const profileTrigger = document.getElementById("profile-trigger");
const accountMenu = document.getElementById("account-menu");
const accountMenuList = document.getElementById("account-menu-list");
const btnAccountAdd = document.getElementById("btn-account-add");

async function openAccountMenu() {
  const accounts = await window.luna.listAccounts();
  accountMenuList.innerHTML = "";
  accounts.forEach((a) => {
    const item = document.createElement("div");
    item.className = "account-menu-item" + (a.active ? " is-active" : "");
    item.textContent = a.active ? `${a.name} (현재)` : a.name;
    if (!a.active) {
      item.addEventListener("click", async () => {
        accountMenu.hidden = true;
        const res = await window.luna.switchAccount(a.uuid);
        if (res.ok) {
          // 24-30차: 착용 테마 재적용은 이제 showHome() 안의 applyEquippedShopTheme()가
          // 항상 같이 해주므로(앱 첫 진입 시에도 빠지지 않게 하려고 그쪽으로 옮김) 여기서
          // 따로 다시 부를 필요 없음 - 중복 호출만 없앤 것이고 동작은 그대로임
          showHome(res.profile);
          showToast(`${res.profile.name}(으)로 전환했어요`);
          await refreshSiteLinkStateAfterMcLogin(res);
          refreshCoins();
        } else {
          showToast(res.error || "전환 실패", "error");
        }
      });
    }
    accountMenuList.appendChild(item);
  });
  accountMenu.hidden = false;
  // 24-24차: 목록이 hidden이던 동안엔 scrollHeight/clientHeight를 정확히 못 재서(둘 다 0),
  // 계정이 많아 스크롤이 필요한 상태로 처음 열려도 페이드/화살표 판정이 항상 "더 없음"으로
  // 나왔음 - 실제로 화면에 나타나는 이 시점에 한 번 더 계산해줌(profile-list-items와 동일한 패턴)
  requestAnimationFrame(() => updateHeroListScrollFade(accountMenuList));
}

profileTrigger?.addEventListener("click", async (e) => {
  e.stopPropagation();
  // 24-15차: "마크 로그인이 마크 계정 추가에만 있어야 한다" - 프로필 아이콘을 눌렀을 때
  // 곧바로 마이크로소프트 로그인 창이 뜨던 흐름을 없앰. 이 아이콘은 이제 홈 화면(연동된
  // 마인크래프트 계정이 있어야만 보임)에서만 눌리므로 이 분기는 실제로는 거의 발생하지
  // 않지만, 혹시 연동이 안 된 채로 눌리면 연동 화면으로 보내기만 함
  // 24-22차: view-mc-gate를 직접 요청 - 24-18차의 "이미 인증된 화면 보호" 안전장치가
  // view-home→view-mc-gate 전환을 막지 않도록 함(위 24-22차 다른 두 곳과 같은 이유)
  if (!hasLinkedMcAccount()) {
    showAppPanel("view-mc-gate");
    return;
  }
  // 24-14차: "프로필 아이콘 누르면 다시 프로필 원래 창으로 돌아가게 해줘" - 상점/모드 관리/
  // 프로필 편집 등 다른 화면을 보던 중에 프로필 아이콘을 눌러도 계정 메뉴만 뜨고 화면은 그대로
  // 였음. 이제 계정 메뉴를 여닫는 것과 별개로, 항상 먼저 홈(프로필) 화면으로 돌아감
  showAppPanel("view-home");
  if (accountMenu.hidden) openAccountMenu();
  else accountMenu.hidden = true;
});
document.addEventListener("click", (e) => {
  if (!accountMenu || accountMenu.hidden) return;
  if (!accountMenu.contains(e.target) && e.target !== profileTrigger && !profileTrigger.contains(e.target)) {
    accountMenu.hidden = true;
  }
});
// 24-15차: "한 계정에만 등록되게 하고" - 사이트 계정 하나에 마인크래프트 계정을 여러 개
// 추가해서 자유롭게 바꿔 끼우던 "다른 계정 추가" 기능은 이제 원칙과 맞지 않아 없앰. 이
// 버튼은 계정 연동을 실제로 관리하는(연동/해제) 설정 > 사이트 계정 패널을 여는 바로가기로
// 바뀜 - 마이크로소프트 로그인은 여기서 다시 직접 트리거하지 않음(view-mc-gate와 그
// 패널 안 버튼, 두 곳에서만 시작됨)
// 24-24차: 사이트 계정 패널이 설정 > 클라이언트에서 설정 > 내 프로필로 옮겨가서, 이
// 바로가기도 같이 "profile" 탭을 열도록 따라옴
btnAccountAdd?.addEventListener("click", () => {
  accountMenu.hidden = true;
  openSettings();
  document.querySelector('.settings-nav-item[data-cat="profile"]')?.click();
});

// ---- 공지사항 (Launch 화면, PLAY 영역과 업데이트 영역 사이에 카드로 항상 보임) -------
// 17차: "공지사항을 따로 올리지 말고 커뮤니티 게시판의 '공지사항' 말머리 글을 그대로
// 홈 화면에 끌어와줘, 누르면 그 글로 이동, 안 읽었으면 점도 보여줘" - 예전엔 별도로
// (포럼과 무관하게) 관리자가 올리는 announcement 시스템이었는데, 이제 포럼 "공지사항"
// 카테고리의 최신 글을 그대로 보여줌
const announcementCard = document.getElementById("home-announcement-card");
const announcementText = document.getElementById("home-announcement-text");
let currentHomeNotice = null;

function applyHomeForumNotice(notice) {
  currentHomeNotice = notice;
  if (!announcementCard || !announcementText) return;

  if (!notice) {
    announcementCard.hidden = true;
    return;
  }
  announcementText.textContent = notice.title;
  announcementCard.hidden = false;
  announcementCard.classList.toggle("has-unread-dot", !notice.seen);
}

async function refreshHomeForumNotice() {
  const notice = await window.luna.getLatestForumNotice?.();
  applyHomeForumNotice(notice);
}
refreshHomeForumNotice();

announcementCard?.addEventListener("click", () => {
  if (!currentHomeNotice) return;
  if (!currentHomeNotice.seen) {
    window.luna.dismissForumNotice?.(currentHomeNotice.id);
    announcementCard.classList.remove("has-unread-dot");
  }
  showAppPanel("view-forum");
  setActiveSidebarIcon("forum");
  showForumList();
  openForumDetail(currentHomeNotice.id);
});

// ---- 점검모드 / 강제 업데이트 -------------------------------------------------
const forceUpdateBanner = document.getElementById("force-update-banner");
let isMaintenance = false;
let isForceUpdate = false;

function updatePlayLockState() {
  const locked = isMaintenance || isForceUpdate;
  btnPlay.disabled = locked || btnPlay.classList.contains("is-downloading");
  if (locked && !btnPlay.classList.contains("is-downloading")) {
    btnPlayLabel.textContent = isMaintenance ? "점검 중" : "업데이트 필요";
  } else if (!locked && !btnPlay.classList.contains("is-downloading")) {
    btnPlayLabel.textContent = playIdleLabel();
  }
}

window.luna.onStatusUpdate?.(({ maintenance, maintenanceMessage, forceUpdate }) => {
  isMaintenance = !!maintenance;
  isForceUpdate = !!forceUpdate;

  if (forceUpdateBanner) {
    forceUpdateBanner.hidden = !isForceUpdate;
    if (isForceUpdate) {
      forceUpdateBanner.querySelector("span").textContent =
        "이 버전은 너무 오래됐어요. 업데이트가 필요해요.";
    }
  }
  if (isMaintenance && !isForceUpdate) {
    showToast(maintenanceMessage || "점검 중이에요.", "error");
  }
  updatePlayLockState();
});

document.getElementById("btn-force-update")?.addEventListener("click", () => {
  window.luna.openReleases?.();
});

// ---- 재접속 배너 --------------------------------------------------------------
const reconnectBanner = document.getElementById("reconnect-banner");
// 24-14차: "다시 들어가시겠습니까? 메시지 시간초를 둬서 사라지게 하고" - 계속 떠있던 배너가
// 일정 시간(15초) 뒤엔 자동으로 사라지도록 타이머를 둠
let reconnectPromptTimer = null;

function startReconnectPrompt() {
  if (!reconnectBanner) return;
  const textEl = document.getElementById("reconnect-text");
  reconnectBanner.hidden = false;
  textEl.textContent = "게임이 종료됐어요. 다시 접속할까요?";
  if (reconnectPromptTimer) clearTimeout(reconnectPromptTimer);
  reconnectPromptTimer = setTimeout(() => {
    reconnectPromptTimer = null;
    cancelReconnectPrompt();
  }, 15000);
}
function cancelReconnectPrompt() {
  if (reconnectPromptTimer) {
    clearTimeout(reconnectPromptTimer);
    reconnectPromptTimer = null;
  }
  if (reconnectBanner) reconnectBanner.hidden = true;
}
document.getElementById("btn-reconnect-now")?.addEventListener("click", () => {
  cancelReconnectPrompt();
  btnPlay.click();
});
document.getElementById("btn-reconnect-cancel")?.addEventListener("click", cancelReconnectPrompt);

// ---- 크래시 리포트 -----------------------------------------------------------
const crashBanner = document.getElementById("crash-banner");
let lastCrashText = "";

window.luna.onGameCrashed?.(({ text }) => {
  lastCrashText = text || "";
  if (crashBanner) crashBanner.hidden = false;
});

document.getElementById("btn-crash-copy")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastCrashText);
    showToast("크래시 로그를 복사했어요");
  } catch (_) {
    showToast("복사 실패, 다시 시도해주세요", "error");
  }
});
document.getElementById("btn-crash-close")?.addEventListener("click", () => {
  if (crashBanner) crashBanner.hidden = true;
});

// ---- 마우스 커서 네온 잔상 -----------------------------------------------------
(() => {
  const canvas = document.getElementById("cursor-trail");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let points = []; // {x, y, life}
  let mouseX = null;
  let mouseY = null;
  let drawX = null; // 화면에 실제로 그릴 위치 (마우스를 부드럽게 뒤쫓아감)
  let drawY = null;

  // 6차: "잔상 색이 하드코딩된 초록이라 테마/구매한 색상을 안 따라간다" - 실제로 값을
  // 보면 rgba(95,224,102,..)=#5fe066(기본 --accent), rgba(123,255,130,..)=#7bff82(기본
  // --accent-strong)로, 기본 다크 테마 값을 그대로 박아둔 것이었음. 캔버스는 CSS로 색을
  // 못 입히니, 매 프레임 대신 주기적으로 getComputedStyle로 지금 활성화된 --accent /
  // --accent-strong(라이트 테마에서도 정확히 맞으려면 documentElement가 아니라 body에서
  // 읽어야 함 - 5-3차 body 인라인 우선 이슈와 동일한 이유)을 읽어와 그 값으로 그림.
  // "은은한 초록 회색 배경색"(--bg-2/--bg-3)은 잔상 뒤쪽에 옅게 깔리는 보조 글로우 색으로 씀.
  function parseColorToRgb(raw, fallback) {
    const val = String(raw || "").trim();
    if (!val) return fallback;
    if (val[0] === "#") {
      const h = val.slice(1);
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      const r = parseInt(full.substring(0, 2), 16);
      const g = parseInt(full.substring(2, 4), 16);
      const b = parseInt(full.substring(4, 6), 16);
      if ([r, g, b].some((n) => Number.isNaN(n))) return fallback;
      return { r, g, b };
    }
    const m = val.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]) };
    return fallback;
  }
  let trailAccent = { r: 95, g: 224, b: 102 };
  let trailAccentStrong = { r: 123, g: 255, b: 130 };
  let trailBg = { r: 36, g: 36, b: 36 };
  function refreshTrailColors() {
    const cs = getComputedStyle(document.body);
    trailAccent = parseColorToRgb(cs.getPropertyValue("--accent"), trailAccent);
    trailAccentStrong = parseColorToRgb(cs.getPropertyValue("--accent-strong"), trailAccentStrong);
    trailBg = parseColorToRgb(cs.getPropertyValue("--bg-3"), trailBg);
  }
  refreshTrailColors();
  let trailColorRefreshCounter = 0;

  // 부모 요소의 레이아웃 계산 타이밍에 기대지 않고, 창 전체 크기를 직접 기준으로 삼음
  // (이전에 getBoundingClientRect()로 부모 크기를 재던 방식은 타이밍에 따라
  //  작은 영역으로만 잡히는 문제가 있었음)
  // 단, 캔버스가 position:absolute라 뷰포트 기준(clientX/Y) 좌표와 캔버스 자체 좌표계 사이에
  // 오프셋(카드 프레임 여백만큼)이 생길 수 있어서, 그 오프셋을 따로 구해서 보정해줌
  let offsetX = 0;
  let offsetY = 0;
  function resize() {
    canvas.width = Math.max(1, Math.round(window.innerWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(window.innerHeight * devicePixelRatio));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const rect = canvas.getBoundingClientRect();
    offsetX = rect.left;
    offsetY = rect.top;
  }
  resize();
  window.addEventListener("resize", resize);

  // 마우스가 실제로 움직인 프레임에만 true - 이게 없으면 마우스가 멈춘 뒤에도
  // drawX/drawY가 목표 지점으로 서서히(비선형적으로) 다가가는 동안 계속 점을 새로 찍어서,
  // 멈춘 자리에 점들이 겹겹이 쌓여 밝은 점 하나가 잔상 가운데 남아있는 것처럼 보였음
  let hasMouseMovedThisFrame = false;

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX - offsetX;
    mouseY = e.clientY - offsetY;
    hasMouseMovedThisFrame = true;
    if (drawX === null) {
      drawX = mouseX;
      drawY = mouseY;
    }
  });

  function frame() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 매 프레임 getComputedStyle을 부르는 대신(불필요한 비용) 대략 0.5초(30프레임)마다만
    // 다시 읽어와서, 테마/색상을 바꾼 뒤 다음 잔상부터 곧바로 새 색이 반영되게 함
    trailColorRefreshCounter++;
    if (trailColorRefreshCounter >= 30) {
      trailColorRefreshCounter = 0;
      refreshTrailColors();
    }

    if (mouseX !== null) {
      // 마우스 위치로 한 번에 점프하지 않고, 부드럽게 뒤따라가게(끊김 방지)
      drawX += (mouseX - drawX) * 0.35;
      drawY += (mouseY - drawY) * 0.35;

      // 실제로 마우스가 움직인 프레임에만 새 점을 추가함 (멈춘 뒤 이징만 되는 동안엔 추가 안 함)
      if (hasMouseMovedThisFrame) {
        const last = points[points.length - 1];
        if (!last || Math.hypot(drawX - last.x, drawY - last.y) > 2) {
          // 10차 버그 수정: 마우스를 아주 느리게 움직이거나 좁은 범위에서 살짝씩 떨듯이
          // 움직이면, 같은 자리 근처에 옛날 점들이 계속 남아있는 채로 새 점이 또 찍혀서
          // 반투명 곡선들이 그 좁은 자리에서만 겹겹이 겹쳐 그려짐 - 겹친 반투명 선은
          // 합성될 때마다 밝아지므로, 결국 잔상 가운데(자주 지나간 자리)에 유독 밝은
          // 점 하나가 남아있는 것처럼 보였음. 새 점을 찍을 때 방금 막 찍힌 점이 아니면서
          // 그 근처(6px 이내)에 있는 오래된 점들을 먼저 솎아내서 한 자리에 겹치는 걸 줄임
          points = points.filter((p) => p.life > 0.9 || Math.hypot(p.x - drawX, p.y - drawY) > 6);
          points.push({ x: drawX, y: drawY, life: 1 });
        }
      }
    }
    hasMouseMovedThisFrame = false;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(${trailAccentStrong.r}, ${trailAccentStrong.g}, ${trailAccentStrong.b}, 0.6)`;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.6;

    // 점들 사이를 끊김 없이 이어지는 부드러운 곡선으로 그림
    // (각 구간의 시작/끝점이 이웃 구간과 정확히 맞물리게 계산해서 틈이 안 생기게 함)
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];
      const startX = (prev.x + curr.x) / 2;
      const startY = (prev.y + curr.y) / 2;
      const endX = (curr.x + next.x) / 2;
      const endY = (curr.y + next.y) / 2;
      const alpha = curr.life * 0.35; // 아주 옅게 (시야 방해 최소화)

      // 선 안쪽(코어)은 accent, 아주 끝자락(life가 거의 다한 부분)은 은은한 초록회색
      // 배경톤(--bg-3)쪽으로 옅게 섞여 사라지도록 함 - 순수 accent 한 색으로만 칠할 때보다
      // 테마의 무채색 배경과 자연스럽게 어우러짐
      const mixT = Math.max(0, 1 - curr.life); // 0(방금 찍힘)~1(거의 사라짐)
      const r = trailAccent.r + (trailBg.r - trailAccent.r) * mixT * 0.5;
      const g = trailAccent.g + (trailBg.g - trailAccent.g) * mixT * 0.5;
      const b = trailAccent.b + (trailBg.b - trailAccent.b) * mixT * 0.5;

      ctx.strokeStyle = `rgba(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
      ctx.stroke();
    }

    // 잔상이 서서히 옅어지다 사라지게 (프레임마다 조금씩)
    points.forEach((p) => (p.life -= 0.03));
    points = points.filter((p) => p.life > 0);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();



