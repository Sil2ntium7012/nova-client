// ============================================================================
//  Nova Client - main.js (Electron Main Process)
//  여러 마인크래프트 서버를 골라 접속할 수 있는 커스텀 런처
// ============================================================================
"use strict";

// ────────────────────────────────────────────────────────────────────────────
// 24-179차: "EMFILE: too many open files" 로 런처가 통째로 죽던 문제
//
// mclc 의 getAssets() 는 에셋 목록 전체를 Promise.all 로 한꺼번에 돌린다(동시 개수 제한이
// 아예 없다 - node_modules/minecraft-launcher-core/components/handler.js 참고). 요즘 버전은
// 에셋이 4000~6000개라, 파일 핸들을 그만큼 한 번에 열려다 윈도우 한도에 걸린다.
// 이미 받은 파일도 checkSum 으로 전부 열어보기 때문에 두 번째 실행에서도 터질 수 있다.
//
// graceful-fs 는 fs 모듈 자체를 감싸서 EMFILE 이 나면 **큐에 넣고 자동으로 다시 시도**한다.
// 라이브러리를 고치지 않고 해결하는 표준적인 방법이라 이걸 쓴다.
// ⚠️ mclc 보다 반드시 먼저 불러야 한다 - 그래야 mclc 가 쓰는 fs 도 같이 감싸진다.
// npm install 을 아직 안 한 상태에서도 런처가 아예 안 켜지는 일은 없게 감싸둔다
try {
  require("graceful-fs").gracefulify(require("fs"));
} catch (_) {
  console.warn("[Nova] graceful-fs 없음 - npm install 후 다시 빌드하세요(에셋 다운로드가 EMFILE 로 실패할 수 있음)");
}
// ────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, shell, session, dialog, nativeTheme, Tray, Menu, nativeImage, screen, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const { spawn, exec } = require("child_process");
const fetch = require("node-fetch");
const extractZip = require("extract-zip");
const tar = require("tar");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const dnsPromises = require("dns").promises; // 24-177차: 서버 주소의 SRV 레코드 조회
const dgram = require("dgram"); // 24-197차: 공유기(UPnP) 찾기 - SSDP 멀티캐스트
const Store = require("electron-store");

// 24-179차: 다운로드 한 번 삐끗했다고 런처가 통째로 죽지 않게.
// 예전엔 main 프로세스에서 잡히지 않은 예외가 나면 일렉트론 기본 동작대로
// "A JavaScript error occurred in the main process" 창이 뜨고 앱이 끝나버렸다.
// 실제로 EMFILE 하나 때문에 설치가 중간에 통째로 날아갔다. 중요한 작업은 전부 각자
// try/catch 로 감싸져 있으므로, 여기서는 기록만 남기고 화면에 짧게 알린 뒤 계속 살려둔다.
// 24-180차: 24-179차의 이 가드가 "오류 하나 = 토스트 하나"였는데, 에셋이 수천 개라
// EMFILE 이 날 때마다 경고가 끝없이 떴다. 아래 두 가지로 조용하게 만든다.
//  ① 잠깐 났다가 알아서 낫는 오류(파일 핸들 부족, 네트워크 끊김 등)는 화면에 안 띄운다 -
//     graceful-fs 가 다시 시도해주고 있어서 사용자가 할 수 있는 일이 없다.
//  ② 그 외 오류도 같은 종류면 1분에 한 번, 전체로도 5초에 한 번만 띄운다.
// 기록(로그)은 남기되, 같은 오류가 폭주하면 앞 3번과 100번째마다만 적어서 로그가
// 수십 MB 로 불어나는 것도 막는다.
const QUIET_ERROR_CODES = new Set([
  "EMFILE", "ENFILE", "EAGAIN", "EBUSY",
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "ECONNABORTED", "ECONNREFUSED",
]);
const errorSeenCount = new Map();
let lastNoticeKey = "";
let lastNoticeAt = 0;

function reportBackgroundError(label, err) {
  const code = String(err?.code || "");
  const key = code || String(err?.message || err).slice(0, 60);

  const n = (errorSeenCount.get(key) || 0) + 1;
  errorSeenCount.set(key, n);
  if (n <= 3 || n % 100 === 0) {
    try {
      logToFile(`${label}${n > 1 ? ` (${n}번째)` : ""} ` + (err?.stack || String(err)));
    } catch (_) {}
  }

  if (QUIET_ERROR_CODES.has(code)) return; // 기록만 하고 화면에는 안 띄움

  const now = Date.now();
  if (key === lastNoticeKey && now - lastNoticeAt < 60000) return;
  if (now - lastNoticeAt < 5000) return;
  lastNoticeKey = key;
  lastNoticeAt = now;
  try {
    notifyRenderer(`문제가 생겼어요: ${String(err?.message || err).slice(0, 90)}`, "error");
  } catch (_) {}
}

process.on("uncaughtException", (err) => reportBackgroundError("[치명적이지 않은 예외]", err));
process.on("unhandledRejection", (reason) => reportBackgroundError("[처리 안 된 거부]", reason));

const { Auth, tokenUtils } = require("msmc");
const { Client } = require("minecraft-launcher-core");
// 10-6(7차): 실제 게임을 켜지 않고 다운로드만(에셋/라이브러리/클라이언트 jar) 미리 받아두려고,
// mclc가 launch() 내부에서만 만드는 Handler를 직접 가져와서 씀 (launch()가 하는 일 중
// checkJava/실행 인자 조립/실제 프로세스 spawn만 빼고 getVersion/getNatives/getJar/getClasses/getAssets를
// 그대로 재사용 - mclc가 "다운로드만" 하는 공식 API를 따로 export하지 않아서 이 방법이 가장 안전함)
const MclcHandler = require("minecraft-launcher-core/components/handler");

// ────────────────────────────────────────────────────────────────────────────
// 24-181차: EMFILE 을 "삼키는" 게 아니라 **애초에 안 나게** 한다.
//
// mclc 의 handler.js 는 여섯 군데에서 Promise.all 을 동시 개수 제한 없이 돌린다
// (에셋 4000~6000개, 라이브러리, 네이티브…). 그래서 파일 핸들을 수천 개 한꺼번에 열려다
// 윈도우 한도에 걸리고, 그 오류가 스트림에서 튀어나와 런처를 통째로 죽였다.
// 24-179/180차의 graceful-fs 와 예외 가드는 증상 완화였을 뿐 근본 원인은 그대로였다.
//
// 라이브러리를 고치거나 getAssets 를 통째로 베껴 쓰는 대신, **모든 다운로드/해시검사가
// 반드시 거쳐가는 길목 두 개**(downloadAsync, checkSum)에 동시 실행 제한을 건다.
// 이 두 개만 막으면 위 여섯 군데가 전부 같이 제한된다 - 고칠 코드가 가장 적고 가장 안전하다.
//
// ⚠️ 재시도 주의: downloadAsync 는 실패하면 자기 자신을 retry=false 로 다시 부른다.
//    그 중첩 호출까지 슬롯을 기다리게 하면 슬롯을 쥔 채로 슬롯을 기다려 교착에 빠진다.
//    바깥에서 부르는 곳은 전부 retry=true 를 넘기므로, true 일 때만 제한한다.
const MCLC_MAX_PARALLEL = 12;
let mclcActive = 0;
const mclcWaiting = [];

function mclcAcquire() {
  if (mclcActive < MCLC_MAX_PARALLEL) {
    mclcActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => mclcWaiting.push(resolve));
}
function mclcRelease() {
  const next = mclcWaiting.shift();
  if (next) next();          // 슬롯을 그대로 넘겨줌(active 유지)
  else mclcActive--;
}

const mclcOrigDownloadAsync = MclcHandler.prototype.downloadAsync;
MclcHandler.prototype.downloadAsync = async function (url, directory, name, retry, type) {
  if (retry !== true) {
    // 실패 후 재시도 - 이미 슬롯을 쥐고 있으므로 그냥 통과시킨다
    return mclcOrigDownloadAsync.call(this, url, directory, name, retry, type);
  }
  await mclcAcquire();
  try {
    return await mclcOrigDownloadAsync.call(this, url, directory, name, retry, type);
  } finally {
    mclcRelease();
  }
};

// 이미 받아둔 파일을 확인할 때도 파일을 연다. 두 번째 실행에서 터지던 게 이것 때문이다.
const mclcOrigCheckSum = MclcHandler.prototype.checkSum;
MclcHandler.prototype.checkSum = async function (hash, file) {
  await mclcAcquire();
  try {
    return await mclcOrigCheckSum.call(this, hash, file);
  } finally {
    mclcRelease();
  }
};
// ────────────────────────────────────────────────────────────────────────────
const EventEmitter = require("events");
const { autoUpdater } = require("electron-updater");
// 24-110차: "그냥 클라이언트 디스코드 연동 없애줘 일단은" - 런처의 디스코드 Rich Presence
// (discord-rpc로 "Nova Client 실행중"을 띄우던 기능)를 통째로 제거함. 게임 안 Nova-Mod의
// 디스코드 표시(49-125차, .nova-discord.json)는 모드 쪽 기능이라 그대로 둠.
// 설정 > 커뮤니티의 "디스코드"(초대 링크 열기) 버튼도 연동이 아니라 링크라서 그대로 둠.

// 10-3: 프로필 바탕화면 바로가기로 실행하면 --nova-profile=<id> 인수가 붙어서 들어옴 -
// 그 프로필을 자동으로 선택해둠 (바로 실행까지는 안 하고, 켰을 때 그 프로필이 골라져 있게만)
function applyProfileArgFromArgv(argv) {
  const arg = (argv || []).find((a) => a.startsWith("--nova-profile="));
  if (!arg) return false;
  const profileId = arg.slice("--nova-profile=".length);
  if (profileId && findProfile(profileId)) {
    store.set("selected_profile_id", profileId);
    store.set("launch_mode", "profile");
    return true;
  }
  return false;
}

// 24-115차: Windows 작업표시줄이 이 앱을 무엇으로 볼지(아이콘·그룹·알림) 정하는 id.
// 안 정해주면 개발 실행/알림에서 Electron 기본 아이콘으로 보일 수 있음.
// ⚠️ package.json의 appId(kr.novaclient.launcher)와 반드시 같아야 함 - 둘이 다르면 작업표시줄
// 그룹화와 알림이 어긋난다. 24-176차에 kr.lunarworld.launcher 에서 옛 이름(luna)을 걷어내며 바꿨다.
// 설정/프로필은 %APPDATA%/NovaClient 에 있고 appId 와 무관하므로 이 변경으로 날아가지 않는다.
if (process.platform === "win32") {
  try { app.setAppUserModelId("kr.novaclient.launcher"); } catch (_) {}
}

// 업데이트로 새 창이 뜨면서 예전 창이 같이 남아있는 문제 방지 (중복 실행 방지)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    // 24-66차 신규: 강제 업데이트 중엔 바탕화면 아이콘을 다시 눌러도 메인 창을 꺼내지 않고
    // 업데이트 진행 창만 앞으로 가져옴("백그라운드에 남아있는 문제 없도록 철저하게 막아줘")
    if (isForcedUpdating) {
      if (updateWindow && !updateWindow.isDestroyed()) {
        updateWindow.show();
        updateWindow.focus();
      }
      return;
    }
    const switched = applyProfileArgFromArgv(commandLine);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (switched) mainWindow.webContents.send("profiles:selected-externally");
    }
  });
}

// 앱 전체 언어를 한국어로 지정 -> 마이크로소프트 로그인 창도 대부분 한국어로 표시됨
app.commandLine.appendSwitch("lang", "ko-KR");

// ----------------------------------------------------------------------------
// 꾸미기 상점: 색상 팔레트 (무지개 + 사이사이 디테일한 색 + 흑백회색)
// ----------------------------------------------------------------------------
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) =>
    Math.round(255 * f(x))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

const HUE_NAMES = [
  "레드", "코럴레드", "오렌지", "골드", "옐로우", "라임옐로우",
  "라임", "그린라임", "그린", "에메랄드", "민트", "스프링그린",
  "틸그린", "시안", "스카이블루", "블루", "코발트블루", "인디고",
  "바이올렛", "퍼플", "마젠타퍼플", "마젠타", "핑크", "로즈",
];
const SHOP_COLORS = [];
// 5-2: "전체" 탭에는 상품 전부가 아니라 추천/인기 상품만 보여야 해서, 색상 12개 중 일부에만
// recommended 표시를 달아둠 (45도 간격 = 8개, 무지개 전체를 고르게 대표하도록)
for (let h = 0; h < 360; h += 15) {
  SHOP_COLORS.push({
    id: `hue-${h}`,
    name: HUE_NAMES[h / 15],
    hex: hslToHex(h, 72, 56),
    price: 1200, // 24-43차: "색상 가격 1,200원 테마 2900원으로 고정시켜주고" (기존 2200, 17차 값)
    category: "theme",
    recommended: h % 45 === 0,
  });
}
// 6-2: "전체" 탭은 그냥 추천 상품이 아니라 번들/할인/이벤트 성격의 상품만 보여야 해서,
// recommended와는 별개로 isBundle 플래그를 새로 둠. 기존 카탈로그가 단순 색상/테마뿐이라
// 진짜 번들 상품을 새로 만드는 대신, 이미 있던 상품 중 대표적인 몇 개를
// "런칭 기념 번들"로 묶어서 전체 탭에 노출함 (가격/데이터는 새로 지어내지 않음)
// 12-1(4차) 버그 수정: "블랙"이 오늘의 추천/번들에 갑자기 나타나는 문제 - 이전 라운드에서
// 실수로 recommended/isBundle 플래그가 붙었던 걸 뗌. 그냥 평범한 카탈로그 상품으로만 존재해야 함
// (다른 색상 상품들과 동일하게 "테마" 카테고리에서만 보이고, 추천/번들에는 안 뜸)
// 24-43차: 일반 색상 상품은 전부 1,200원으로 고정(기존 2200, 17차 값)
SHOP_COLORS.push({ id: "mono-black", name: "블랙", hex: "#3a3a3a", price: 1200, category: "theme" });
SHOP_COLORS.push({ id: "mono-white", name: "화이트", hex: "#f2f2f2", price: 1200, category: "theme" });
SHOP_COLORS.push({ id: "mono-gray", name: "그레이", hex: "#9aa0a6", price: 1200, category: "theme" });

// 위의 "테마 색상"은 포인트 색(accent)만 바꾸는 스와치들이고, 아래 둘은 배경/글자까지 전부 바뀌는
// 완전히 다른 테마 프리셋임 - 그래서 상점 카테고리를 따로 "테마"(fulltheme)로 분리해서 팜
// mode 값은 style.css의 body[data-color-theme="..."] 블록과 짝이 맞아야 함
SHOP_COLORS.push({
  id: "theme-pure-black",
  // 6-3: 스와치 미리보기 색을 이 테마의 accent(밝은 회색/흰색)로 잘못 넣어서 하얗게 보이던 버그.
  // "완전 블랙" 테마를 대표하는 색은 accent가 아니라 배경색(--bg-0: #000000)이어야 함
  // 14차: "완전 블랙을 블랙&화이트로 하자" - 실제로 accent가 흰색/회색 계열이라 색이 아예
  // 없는 흑백(모노톤) 컨셉이었는데 이름이 "완전 블랙"이라 그냥 새까맣기만 한 테마처럼
  // 오해되고 있었음. 실제 컨셉에 맞게 이름만 바꿈(색상값은 그대로)
  name: "블랙 & 화이트",
  hex: "#000000",
  // 24-14차: "블랙앤 화이트는 검정 바탕에 흰색 상점 플레이트, 핑크는 핑크에 보라색 플레이트로" -
  // hex는 배경(스와치 바탕) 색으로 계속 쓰고, plateColor는 그 위에 놓이는 "상점 플레이트"
  // 전용 색상으로 새로 추가함(렌더러/CSS에서 배경과 플레이트를 따로 칠할 때 사용)
  plateColor: "#ffffff",
  // 24-43차: "테마 2900원으로 고정시켜주고 할인에도 적용해줘" - 정가(originalPrice)를
  // 2,900원으로 고정하고, 기존 30% 할인을 이 새 정가 기준으로 재계산(2900 * 0.7 = 2030)
  // (originalPrice가 정가, price가 실제 결제가 - 렌더러에서 할인 배지/취소선에 사용)
  price: 2900, // 24-246차: "테마 할인도 다 왜 달려있어 메인상품만" - 할인은 메탈(메인 상품)만
  category: "fulltheme",
  mode: "pure-black",
  recommended: true,
  isBundle: true,
});
SHOP_COLORS.push({
  id: "theme-cute",
  // 16차: "큐티핑크 말고 그냥 핑크로 바꿔줘" - 표시 이름만 수정(id/mode/색상값은 그대로)
  name: "핑크",
  hex: "#ff7fb0",
  // 24-14차: 핑크 테마의 상점 플레이트는 보라색으로
  plateColor: "#9d4edd",
  // 24-43차: "테마 2900원으로 고정시켜주고 할인에도 적용해줘" - 정가를 2,900원으로 고정,
  // 기존 30% 할인을 이 새 정가 기준으로 재계산(2900 * 0.7 = 2030)
  price: 2900, // 24-246차: "테마 할인도 다 왜 달려있어 메인상품만" - 할인은 메탈(메인 상품)만
  category: "fulltheme",
  mode: "cute",
  recommended: true,
  isBundle: true,
  // 24-224차: 메인 상품은 메탈 하나로(미리보기를 크게 보여주려고 한 상품만 띄운다)
});

// 24-151차 신규: "테마중에 블랙+핑크 하나 추가해줘" - 위의 "핑크"는 밝은 파스텔 배경이라,
// 같은 핑크라도 정반대인 칠흑 배경 + 네온 핑크 발광 테마를 따로 둠.
// 가격 구조는 기존 완전 테마 4종과 동일(정가 2,900원 / 30% 할인).
// mode 값은 style.css 의 body[data-color-theme="black-pink"] 와 짝이 맞아야 함
SHOP_COLORS.push({
  id: "theme-black-pink",
  name: "블랙 & 핑크",
  // 24-153차: 테마 색을 "밝은 핑크 + 어두운 검정"으로 다시 맞추면서 상점 스와치도 같이 갱신
  hex: "#3a1226",        // 24-154차: 보관함/상점 스와치가 그냥 검정으로 보여서 어두운 핑크로
  plateColor: "#ff2e8b", // 그 위에 놓이는 상점 플레이트 = 포인트색
  price: 2900, // 24-246차: "테마 할인도 다 왜 달려있어 메인상품만" - 할인은 메탈(메인 상품)만
  category: "fulltheme",
  mode: "black-pink",
  recommended: true,
});

// 24-68차 신규: "테마 하나 더 추가하자 아쿠아랑 스카이로 할건데" - 배경이 그라데이션이고
// 오브제(달/별, 바다에 있는 무언가)가 있고 UI 뒤에 그림자로 입체감을 주는 완전 테마 2종.
// 가격 구조는 기존 블랙&화이트/핑크와 동일하게 맞춤(24-43차 고정가+30% 할인 규칙 재사용).
SHOP_COLORS.push({
  id: "theme-aqua",
  name: "아쿠아",
  hex: "#14c8a0",
  plateColor: "#0a3a4d",
  price: 2900, // 24-246차: "테마 할인도 다 왜 달려있어 메인상품만" - 할인은 메탈(메인 상품)만
  category: "fulltheme",
  mode: "aqua",
});
SHOP_COLORS.push({
  id: "theme-sky",
  name: "스카이",
  hex: "#8f7bea",
  plateColor: "#1b1140",
  price: 2900, // 24-246차: "테마 할인도 다 왜 달려있어 메인상품만" - 할인은 메탈(메인 상품)만
  category: "fulltheme",
  mode: "sky",
});

// 24-218차: "마인크래프트 테마 삭제해주고" - 상품 자체를 카탈로그에서 뺐다.
// (이미 착용 중이던 사용자는 카탈로그 조회가 실패하면서 기본 테마로 안전하게 돌아간다 -
//  꿀벌 테마를 뺐을 때(24-78차)와 같은 방식이라 따로 손댈 게 없다.)

// 24-78차 신규: "약간 탄소섬유나 은색 느낌의 테마도 하나 만들어주는데 약간 철의 느낌이라고
// 보면 돼" - 탄소섬유 직조 무늬 + 브러시드 메탈(금속을 결대로 갈아낸) 광택을 입힌 완전 테마.
// 질감 중심이라 마인크래프트와 같은 등급(2,730원)으로 맞춤 - style.css의
// body[data-color-theme="metal"] 참고
SHOP_COLORS.push({
  id: "theme-metal",
  name: "메탈",
  // 24-87차: 테마를 은색 무채색 -> "어두운 보랏빛 검정 + 청록 발광"으로 바꾸면서 상점
  // 스와치도 같이 맞춤(바탕 = 갑옷 색, 플레이트 = 발광 라인 색)
  hex: "#181a28",
  plateColor: "#5cc6da",
  // 24-224차: "상점 메인 상품 메탈로 바꾸고 가격 할인도 싹 바꾸고"
  // 메인 상품이 된 만큼 할인 폭을 제일 크게 잡았다(3,900 → 1,950, 50%).
  price: 1950,
  originalPrice: 3900,
  discountPercent: 50,
  category: "fulltheme",
  mode: "metal",
  recommended: true,
  featuredMain: true, // 상점 메인 캐러셀 1번 슬라이드
  featuredPairColorId: "mono-black",
});
// 13-2/13-3(4차): "메인 상품" 카드용 플래그. 17차부터는 이 두 featuredMain/featuredSub
// 아이템(블랙&화이트, 핑크)이 상점 상단의 캐러셀(자동 슬라이드) 2개 슬라이드로 표시됨.
// featuredPairColorId는 그 슬라이드에 같이 그려질 짝꿍 단색 색상 상품의 id.

// 24-66차 신규: "상점에서 기타 카테고리 만들어서 닉네임 변경권 100원에 팔아주고" - 색상/테마
// 스와치(hex)와 달리 이 상품은 hex가 없고 icon으로 표시됨. 한 번 사면 계속 갖고 있는 게 아니라
// (ownedColors) 살 때마다 개수가 쌓이는 "소모품"이라 consumable/consumableField로 표시함 -
// shop:buy가 이 플래그를 보고 코인 차감 후 consumables[consumableField] 개수를 올려줌.
SHOP_COLORS.push({
  id: "ticket-nickname-change",
  name: "닉네임 변경권",
  icon: "🏷️",
  price: 100,
  category: "misc",
  consumable: true,
  consumableField: "nicknameChangeTickets",
  description: "닉네임(로그인 아이디)을 한 번 바꿀 수 있어요. 내 프로필 화면에서 사용해요.",
});

// 24-229차: "상점에 프로필 테두리 팔아줘" - 프로필 사진 둘레 링. 착용 칸(equippedFrame)이
// 색상/테마와 따로라 같이 쓸 수 있다. frame 값이 style.css 의 .frame-<값> 과 짝이다.
[
  // 24-234차: "테두리 가격 전부 절반으로 ... 50원들은 짤라내거나 올려" - 반값에서 100원 단위로 맞춤
  { id: "frame-silver", name: "실버 테두리", frame: "silver", price: 300 },
  { id: "frame-gold", name: "골드 테두리", frame: "gold", price: 400 },
  { id: "frame-neon", name: "네온 테두리", frame: "neon", price: 600 },
  { id: "frame-aurora", name: "오로라 테두리", frame: "aurora", price: 700 },
  { id: "frame-diamond", name: "다이아 테두리", frame: "diamond", price: 900 },
].forEach((f) => SHOP_COLORS.push({ ...f, hex: "#1b1e2c", category: "cosmetic" }));

// 24-229차: 서버 슬롯 +1 - 티어 기본 개수에 더해진다(중첩). 계정당 1개까지.
SHOP_COLORS.push({
  id: "ticket-server-slot",
  name: "서버 슬롯 +1",
  icon: "🖥️",
  price: 1900,
  category: "misc",
  consumable: true,
  consumableField: "serverSlots",
  maxCount: 1,
});

// 리딤 코드 목록 (코드는 대소문자 구분 없이 비교, 새 코드는 여기에 추가하면 됨)
// 리딤 코드는 원문이 아니라 "해시값"으로 저장해요. 이러면 나중에 파일을 열어봐도
// 실제 코드 문자열은 절대 안 보이고(해시만 보임), 입력한 코드가 맞는지 확인만 가능해요.
// label은 원문이 아니라 "이 코드가 뭔지 알아보기 위한 메모"예요 (개발자 목록에 표시됨).
// 24-143차: hint 필드를 넣으면 개발자 목록에 같이 보여요(예: hint: "Luna-로 시작"). 원문을
// 그대로 적으면 설치 파일을 뜯은 사람도 볼 수 있으니, 본인만 알아볼 정도로만 적는 걸 권해요.
//
// 새 코드를 추가하는 법: 아래처럼 터미널에서 해시를 만들어서 넣으면 돼요.
// node -e "console.log(require('crypto').createHash('sha256').update('원하는코드'.toLowerCase()).digest('hex'))"
const REDEEM_CODES = [
  // 예시: { hash: "970ec274...", amount: 200, label: "런칭 기념 코드" },
  // 24-134차: 선물 코드 1개 추가(8000 코인). 대소문자는 구분하지 않음.
  // 코드 원문은 여기 적지 않음 - 해시로만 저장하는 이유가 파일을 열어도 코드를 알 수 없게
  // 하기 위함이라, 주석이나 label 에 원문/힌트를 남기면 그 의미가 사라짐
  { hash: "5ee110dfb4806ff4f5515db5b73e959f6695e1b4e9be08d101bd4f07445f5300", amount: 8000, label: "선물 코드" },
];

function hashCode(rawCode) {
  return require("crypto").createHash("sha256").update(rawCode.toLowerCase()).digest("hex");
}

// ----------------------------------------------------------------------------
// 설정값 (여기만 바꾸면 버전/서버 등을 조정할 수 있습니다)
// ----------------------------------------------------------------------------
const CONFIG = {
  LOADER: "fabric",                // 서버에 loader가 안 적혀 있을 때 쓰는 기본 로더
  // 여러 서버 중 골라서 들어갈 수 있음. 서버마다 마인크래프트 버전을 고정할 수 있음
  // (플레이어가 버전을 정하는 게 아니라, 서버마다 정해진 버전으로 자동 실행됨)
  //
  // 24-94차: 서버는 "주소와 버전"만 들고 있음. 예전의 loader/minMemoryGB/modpack(런처가
  // 서버용 모드팩을 공용 폴더에 깔아주던 방식)은 없어졌고, 서버마다 유저가 고른 "같은 버전의
  // 프로필"(store.server_profiles)로 그대로 켠 뒤 그 서버로 바로 접속함. version은 그 프로필을
  // 거르는 기준으로만 씀. 하이의 놀이터(hisunlit)는 삭제.
  // 24-120차: Society: Sunlit Valley 팩도 삭제 - 모드팩 관련 설명/필드는 전부 걷어냄.
  // 24-241차: "우리 클라이언트는 총 너굴마을, 하이픽셀, 온리소드" - 이 순서대로. 직접 추가한 서버는 그 위에.
  //  · versionMin/versionMax 가 있으면 여러 버전으로 들어갈 수 있는 서버 - 화면엔 "1.8.9~26.2" 로 보이고
  //    그 범위 안의 어떤 버전 프로필로도 들어갈 수 있다. version 은 새 프로필을 만들 때 쓰는 기본(최신) 버전.
  //  · useSrv: 상태 확인 때 _minecraft._tcp SRV 레코드를 따라간다(주소만 공개하고 포트를 숨긴 서버).
  SERVERS: [
    {
      id: "nugulmaeul",
      name: "너굴마을",
      host: "mcng.kr",
      port: "25565", // mcng.kr에 SRV 레코드가 없어서 기본 포트
      version: "26.1.2",
    },
    {
      id: "hypixel",
      name: "하이픽셀",
      host: "mc.hypixel.net",
      port: "25565",
      version: "26.2",
      versionMin: "1.8.9",
      versionMax: "26.2",
      useSrv: true,
    },
    {
      id: "onlysword",
      name: "온리소드",
      host: "onlysword.xyz",
      port: "25565",
      version: "26.2",
      versionMin: "1.20",
      versionMax: "26.2",
      useSrv: true,
    },
  ],
  INSTANCE_NAME: "NovaClient",     // 실제 .minecraft 와 분리된 독립 인스턴스 폴더명
  CREATOR_NAME: "망고",            // 화면에 표시할 제작자 이름
  DEV_ACCOUNT_NAME: "LNR_Sil2ntium", // 이 계정으로 로그인했을 때만 리딤 코드 목록을 볼 수 있음
  // 24-66차 신규: 이 이메일로 가입/로그인된 사이트 계정은 닉네임과 무관하게 항상 관리자로 인정
  ADMIN_EMAILS: ["a01051242995@gmail.com"],
  DISCORD_URL: "https://discord.gg/PVkq8jQdeF", // 24-31차: 디스코드 초대 링크 갱신
  GITHUB_RELEASES_URL: "https://github.com/Sil2ntium7012/nova-client/releases", // 버전 클릭 시 이동
  WEBSITE_URL: "https://nova-site-xi.vercel.app/", // 24-31차: 설정 > "Nova Client 사이트" 버튼 - 실제 Nova Site 주소로 갱신
  // 24-31차 신규: 설정 > 정보 > 커뮤니티의 "상점" 버튼 - 코인 구매(충전) 페이지로 바로 이동
  COINS_BUY_URL: "https://nova-site-xi.vercel.app/coins/buy",
  // 24-174차: "이용약관에 알려야 할 것들 깔끔한 정리" - 약관 화면 아래 "라이선스" 칸에
  // 그대로 뿌려지는 글. 기본 포함 모드의 라이선스는 각 jar 안의 fabric.mod.json 에 적힌
  // 값을 그대로 옮겨 적은 것이다(지어내지 않음). 모드를 추가/교체하면 이 목록도 같이 고칠 것.
  // 24-175차: 앞선 24-174차에서 "기본 포함 모드 목록"을 잔뜩 적었는데, 확인해보니 런처는
  // 그 모드들을 쓰지 않는다 - 24-94차에 syncMods/syncResourcePacks 가 빠지면서 mods/ 폴더는
  // 아무도 안 읽는 죽은 폴더가 됐다(package.json extraResources 에만 남아 있었다).
  // 모드는 전부 Modrinth 에서 유저가 고른 걸 그때그때 받는다. 그래서 목록을 걷어내고,
  // 런처가 실제로 쓰는 것만 적는다.
  // 24-225차: "라이센스에 모드린스 방식이나 이딴 거 적지좀 마 문장으로 적지 말고 필요한 것만"
  // 설명 문장은 전부 빼고, 꼭 표시해야 하는 저작권/상표 고지와 오픈소스 라이선스 목록만 남겼다.
  LICENSE_TEXT: [
    "© Nova Client",
    "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.",
    "",
    "── 오픈소스 ──",
    "Electron · electron-builder · electron-updater · electron-store — MIT",
    "minecraft-launcher-core · msmc · adm-zip · node-fetch · rcedit — MIT",
    "extract-zip — BSD-2-Clause",
    "tar — ISC",
    "skinview3d · three.js — MIT",
    "SUIT — SIL OFL 1.1",
    "NSIS — zlib/libpng",
  ].join("\n"),
  // 17차 신규: "수익 창출할 예정이니 필요한 라이선스/정보는 꼭 적어야 한다" - 상점에서 실제 결제(코인 구매)가
  // 이뤄지는 앱이라, 한국에서는 통신판매업 신고번호/사업자등록번호/대표자명/주소/연락처/환불정책 등을
  // 어딘가엔 표시해야 함(전자상거래법). 아래는 자리만 잡아둔 값(전부 "미기재")이라 실제 배포 전에
  // 반드시 사업자 본인이 정확한 값으로 채워넣어야 함 - 이 값들은 지어낼 수 없어서 그대로 뒀음
  BUSINESS_INFO: {
    businessName: "미기재", // 상호명
    representativeName: "미기재", // 대표자명
    businessRegNo: "미기재", // 사업자등록번호
    mailOrderRegNo: "미기재", // 통신판매업 신고번호
    address: "미기재", // 사업장 주소
    contactEmail: "미기재", // 고객문의 이메일
    refundPolicy: "코인/아이템은 결제 즉시 지급되는 디지털 상품 특성상 원칙적으로 환불이 제한될 수 있어요. 자세한 환불 절차는 고객문의로 문의해주세요.",
  },
  ANNOUNCEMENT_URL:
    "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/announcement.json",
  STATUS_URL:
    "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/status.json",
  // 19차 신규: "소식은 포럼이 아니야 내가 올리는 완전 이벤트나 이런 거야, 소식에는 여러
  // 박스로 올라갈 거야" - 위 ANNOUNCEMENT_URL(배너 문구 1개짜리)와 같은 방식으로, GitHub
  // 저장소에 이 파일(news.json)을 만들고 그 안 items 배열에 이벤트/소식을 추가/수정하면
  // 앱 업데이트 없이 바로 반영됨. 형식: { "items": [ { "id", "title", "description",
  // "date", "tag", "color" }, ... ] } (오래된 순 상관없이 그대로 배열 순서대로 보여줌)
  NEWS_URL:
    "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/news.json",
  SUPABASE_URL: "https://zrqlvhhruuuaphexztee.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycWx2aGhydXV1YXBoZXh6dGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODk1MzgsImV4cCI6MjEwMjQ2NTUzOH0.U7MwqPCrfPHHlPLqcryCfZhhXPcDJidxjCG07mF1svw",
  // 24-10차: 진짜 계정 통합 - "런처/사이트 전용 계정" 자체는 이제 Nova Site(웹사이트)가
  // 서버 API로 직접 처리함(Nova Client가 Supabase를 직접 두드리던 site_accounts RPC는 폐기).
  // 아래 주소가 그 API가 배포된 실제 도메인.
  NOVA_SITE_API_BASE: "https://nova-site-xi.vercel.app",
};

// 업데이트 내역 (새 버전 배포할 때마다 위에 추가해주세요 — 오래된 순 -> 최신 순)
// 24-59차: "클라이언트 버전 싹다 없앨 거거든? 버전 싹 초기화하고 1.0.0부터 하고 업뎃 기록
// 싹다 없애고 시작하게 해줘" - 여기 쌓여있던 기존 업데이트 내역(출시 1.0.0 ~ 그동안의 모든
// 버전)을 전부 지우고 1.0.0부터 새로 시작함. package.json 버전도 같이 1.0.0으로 되돌림
const CHANGELOG = [
  // 24-119차: "그냥 내가 전부 다 지울테니까 1.0.0으로 초기화하고 지우고 깔께" -
  // 24-59차 버전 초기화 때 깃 태그/릴리스(v1.1.0~v1.8.0)를 안 지워서 24-116차에 올린
  // 1.1.0이 옛 릴리스와 충돌했고, 그게 Latest로 잡히는 바람에 자동 업데이트가 아예
  // 안 떴음. 릴리스와 태그를 전부 지우고 1.0.0부터 다시 시작하기로 함.
  //
  // 24-178차: "모든 걸 1.0.0으로 하자 이제 다시 배포할 거야 다 지우고" - 아직 1.0.0/1.0.1을
  // 실제로 게시한 적이 없고, 그 사이 appId가 kr.novaclient.launcher로 바뀌어(24-176차)
  // 설치 파일 신원 자체가 새것이 됐으므로 다시 한 번 깨끗하게 초기화함. 1.0.1에 적어뒀던
  // 항목들은 "이전 버전에서 고친 것"이 아니라 그냥 첫 배포에 들어가는 기능이라, 1.0.0
  // 하나로 합치고 그동안 만든 것(서버 직접 추가 등)까지 같이 넣었다. 목록은 계속
  // 한 줄씩 짧게.
  {
    version: "1.0.0",
    date: "2026-09-30",
    items: [
      "Nova Client를 새롭게 시작합니다",
      "## 주요 기능",
      "홈 화면에서 PLAY 한 번으로 바로 접속, 오른쪽에 서버·프로필 목록 표시",
      "서버 카드에 서버 아이콘·소개·접속 인원·응답 속도·접속 프로필 표시",
      "서버 직접 추가 - 주소만 넣으면 포트와 버전은 런처가 알아서 찾아요",
      "서버마다 접속에 쓸 프로필을 따로 지정 가능(서버 카드의 톱니 버튼)",
      "서버 목록 - 너굴마을(mcng.kr, 26.1.2)",
      "프로필별 모드·리소스팩·쉐이더팩 관리, 모드는 버전 고정과 일괄 업데이트 지원",
      "콘텐츠 설치에서 모드·리소스팩·쉐이더팩 검색 및 설치(Fabric API와 Mod Menu는 자동으로 같이 설치)",
      "콘텐츠 설치에 리소스팩·폰트 만들기 - 폰트를 넣으면 리소스팩으로, 리소스팩은 프로필 버전에 맞게 변환",
      "프로필 공유 - 코드 하나로 모드·리소스팩·쉐이더팩은 물론 노바 모드 설정과 컨피그 파일까지 함께 공유",
      "공유한 프로필을 수정하면 받은 사람에게 업데이트 알림, 받는 쪽은 업데이트할지 직접 선택(직접 넣은 모드는 유지)",
      "프로필별 바탕화면 바로가기 만들기(프로필 아이콘 적용)",
      "친구 추가·귓속말·접속 중인 서버 표시",
      "상점에서 포인트색과 완전 테마 구매(마인크래프트/아쿠아/스카이/메탈 등)",
      "색·테마를 고를 때 실제 메인화면 모습으로 미리보기",
      "가입 축하 선물 - 테마 1개와 색 1개를 무료로 고르고 닉네임 변경권 1개 지급",
      "로그인 화면에서 아이디/비밀번호 찾기 - 아이디는 연동해둔 마인크래프트 계정으로, 비밀번호는 가입한 이메일로 인증 코드를 받아서",
      "설정 > 폰트에서 런처 글꼴 선택과 크기 조절(0.5~2배)",
      "설정 > 클라이언트에서 Nova Client 삭제 - 프로필·모드·설정은 그대로 남아요",
      "한국어·영어 지원, 바꾸면 다시 켜지 않아도 바로 반영",
      "마인크래프트 계정은 한 기기에서만 로그인 유지(다른 기기에서 로그인하면 이전 기기는 자동 로그아웃), 사이트 계정은 여러 기기 동시 로그인 가능",
      "설치 프로그램을 Nova 화면 하나로 새로 만듦 - 받기부터 설치, 실행까지 창 하나로 끝나요",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-09-30",
    items: [
      "## 수정",
      "서버에 처음 접속할 때 \"too many open files\" 오류로 런처가 꺼지던 문제 수정 - 게임 파일을 한꺼번에 수천 개씩 받던 걸 12개씩 나눠 받도록 바꿨어요",
      "이미 받아둔 파일을 확인할 때도 같은 문제가 나던 것 수정 - 두 번째 실행부터도 안전해요",
      "다운로드 중에 생긴 오류 하나로 런처가 통째로 종료되지 않도록 변경",
      "## 추가",
      "서버로 접속하면 게임 안 멀티 목록에도 그 서버가 등록되고, 서버 리소스팩은 자동 사용으로 설정돼요",
      "너굴마을은 모드체커가 항상 자동으로 들어가고, 런처가 넣은 모드는 꺼지지 않아요",
      "너굴마을 프로필로 콘텐츠 설치를 열면 서버에서 허용한 모드만 목록에 떠요",
      "친구 요청과 귓속말이 오면 바로 알림이 뜨고 목록도 그 자리에서 새로고침돼요",
      "프로필 수정에서 이름 옆에 연필을 붙여 이름을 바꿀 수 있다는 걸 알 수 있게 했어요",
      "메인 화면 그림자를 여러 겹으로 나누고 살짝 대각으로 줘서 끝이 뚝 끊기지 않게 다듬었어요",
      "Nova 전용 모드는 이제 런처를 업데이트하지 않아도 항상 최신 버전을 받아와요",
      "프로필로 게임을 켜둔 채 서버 칸으로 바꾸면 PLAY 버튼이 정지 모양으로 바뀌던 문제 수정",
      "서버 설정에서 연결해둔 프로필을 해제할 수 있어요 - 예전엔 해제할 방법이 아예 없었어요",
      "추천인 시스템 - 가입 축하 선물에서 추천인 닉네임을 넣으면 나와 추천인 모두 200코인을 받아요",
      "게임이 켜져 있을 땐 런처 X 버튼이 완전 종료가 아니라 창 숨기기로 바뀌어요 - 트레이나 바탕화면 아이콘으로 다시 열려요",
      "마인크래프트를 끄면 숨겨둔 런처 창이 다시 떠요",
      "서버·프로필 목록에서 지금 플레이 중인 줄에 \"플레이 중\" 표시가 붙어요 (여러 개 켜두면 개수도 같이)",
      "메인 화면 그림자를 사방으로 깔리게 다시 손봤어요 - 아래로만 흐르지 않고, 그림자가 빠져 있던 카드들에도 생겼어요",
      "## 추가",
      "내 컴퓨터로 서버 열기 - 서버 칸의 서버 아이콘을 누르면 Fabric/바닐라 서버를 바로 만들고 켤 수 있어요 (콘솔·명령어 포함)",
      "서버를 만들 때 EULA 동의를 한 번만 받고 바로 처리해요 - 파일을 직접 고칠 일이 없어요",
      "난이도·PvP·시야 거리 같은 서버 설정을 창에서 바로 고칠 수 있어요",
      "공유기 포트 자동 열기(UPnP) - 밖에 있는 친구도 들어올 수 있게 런처가 공유기에 직접 요청해요",
      "서버 주소 - 이름만 정하면 그 주소로 들어올 수 있어요. 집 IP가 바뀌어도 런처가 알아서 맞춰줘요",
      "그 주소는 포트까지 포함해서 안내돼요 - 친구는 포트를 몰라도 주소만 치면 들어와요",
      "## 수정",
      "서버를 목록에서 지우면 거기 붙어 있던 주소도 같이 떼어져요",
      "주소를 새로 만들면 그 서버에 붙어 있던 옛 주소는 자동으로 떼어져요",
      "서버가 꺼져 있어도 붙여둔 주소를 복사할 수 있어요",
      "주소에 쓰는 도메인을 런처에 박아두지 않고 서버가 알려주도록 바꿨어요",
      "## 추가",
      "프로필 위에 알림함이 생겼어요 - 받을 보상·친구 요청·안 읽은 귓속말·새 공지를 한 곳에서 봐요",
      "소식 화면에 마인크래프트 공식 소식이 한국어 번역과 원문 링크로 같이 떠요",
      "업데이트 로그를 설정 > 클라이언트로 옮겼어요",
      "알림/선물함 - 사이드바 프로필 아이콘 위에 생겼어요. 누르면 화면 가운데에 창이 떠요 (알림·선물함 탭)",
      "## 수정",
      "모드 설명을 번역할 때 링크 주소까지 번역돼 깨지던 문제 수정 - 주소는 원문 그대로 둬요",
      "우리가 올린 소식이 없으면 마인크래프트 공식 소식도 같이 안 뜨던 문제 수정",
      "## 변경",
      "설정 정리 - 소리·화면을 \"비디오/오디오\"로, 폰트를 \"언어/글꼴\"로 합쳤어요",
      "게임 실행 시 동작·자동 실행·상태 공유·팩 자동 적용을 비디오/오디오 아래 \"플레이\"로 옮겼어요",
      "설정 > 정보의 라이선스를 문단과 소제목이 보이게 정리했어요",
      "프로필 사진은 버튼 대신 사진을 눌러서 바꿔요 (오른쪽 위 연필 표시)",
      "서버 열기를 사이드바 더보기로 옮겼어요",
      "## 수정",
      "서버 열기 창에서 \"새 서버 만들기\" 폼과 서버 조작판이 동시에 보이던 문제 수정",
      "서버를 켜면 공유기 포트를 자동으로 열어요 - 따로 누를 필요 없어요",
      "서버 주소 칸에 뒤에 붙는 도메인이 보이고, 입력하는 동안 완성될 주소를 미리 보여줘요",
      "서버 만들기에서 마인크래프트 버전을 목록에서 고르게 바꿨어요",
      "꼭 채워야 하는 칸에 빨간 * 표시를 넣었어요",
      "서버 열기 창에서 주소가 \"접속 주소\"와 \"서버 주소\" 두 칸으로 갈라져 같은 값이 두 번 보이던 걸 한 칸으로 합쳤어요",
      "\"공유기 포트 열기\" 버튼을 없앴어요 - 서버를 켜면 런처가 알아서 하고, 안 되면 그때만 알려줘요",
      "알림/선물함 창을 업데이트 로그 창과 같은 크기로 맞췄어요",
      "서버 설정에 네더 허용·몬스터/동물 생성·하드코어·시드·월드 종류 등을 더 넣었어요",
      "서버 열기 화면을 열면 불러오는 동안 로딩 표시가 떠요",
      "상점에서 마인크래프트 테마를 뺐어요",
      "커뮤니티에서 작성자 이름 옆에 프로필 사진이 떠요 (목록·글·답글)",
      "글을 읽다가 작성자 이름 옆 버튼으로 바로 구독할 수 있어요",
      "프로필 공유 - 설정을 바꾸면 새 코드가 나오고 옛 코드는 막혀요. 공유 끄기도 생겼어요",
      "프로필 공유의 \"모드 설정\"이 저니맵 같은 다른 모드 설정을 말하도록 정리했어요",
      "오른쪽 위 프로필에 올린 사진이 안 보이던 문제 수정",
      "메인 화면 그림자를 모두 오른쪽 아래로 맞췄어요",
      "서버 열기에서 처음엔 아무 서버도 고르지 않아요",
      "티어 칸이 보관함에 생겼어요 - 지금 티어·다음 티어까지·티어별 혜택을 볼 수 있어요",
      "출석 코인이 티어를 따라가요 (아이언 1 → 다이아 6). 토요일 보너스는 없앴어요",
      "티어별로 하루 글·댓글 수가 달라지고, 주간 퀘스트는 브론즈부터 열려요",
      "커뮤니티 프로필 사진이 마크 얼굴이 아니라 클라이언트에 올린 사진으로 바뀌었어요",
      "서버 설정의 난이도·게임 모드·월드 종류를 한글로 바꿨어요",
      "시드와 월드 종류는 서버를 만들 때만 정해요 (만든 뒤엔 바꿔도 적용되지 않아서)",
      "서버 열기 화면에서 다 불러오고도 목록이 안 보이던 문제 수정",
      "친구를 끌어다 폴더에 넣을 수 있어요",
      "상점 메인 상품을 메탈로 바꾸고, 미리보기를 크게(7:3) 보여줘요. 완전 테마 할인도 다시 매겼어요",
      "친구창에 검색칸이 생겼어요 - 이름으로 바로 찾을 수 있어요",
      "친구 폴더 - 친구창에서 폴더를 만들어 친구를 묶어둘 수 있어요 (우클릭 → 폴더로 옮기기)",
      "구독을 취소하면 한 번 더 확인하고, 같은 사람은 5시간 뒤에 다시 구독할 수 있어요",
      "커뮤니티에 구독 칸이 생겼어요 - 내가 구독한 사람·나를 구독한 사람 목록을 보고, 구독한 사람들의 글만 모아볼 수 있어요",
      "누가 나를 구독하면 알림함에 떠요",
      "커뮤니티 목록에서 글마다 있던 박스 배경을 걷어내고 줄 목록으로 바꿨어요",
      "티어 배지를 육각 앰블럼으로 바꾸고 이름과 높이를 맞췄어요",
      "멤버 구독 - 사람을 구독해두면 그 사람이 새 글을 올렸을 때 알림함에 떠요",
      "메인 위쪽 환영 띠를 없애고, 그 자리만큼 서버·프로필 목록을 키워 한 번에 3개씩 보여줘요",
      "티어 - 게시글·댓글·런처를 켜 둔 시간으로 아이언 → 브론즈 → 실버 → 골드 → 플래티넘 → 다이아몬드까지 올라가요 (친구창·게시판·프로필에 표시)",
      "모드 설명의 **굵게** 같은 마크다운 표기를 제대로 보여줘요",
      "새 공지사항이 올라오면 커뮤니티 아이콘에 빨간 점이 떠요",
      "오른쪽 위 프로필에 닉네임 대신 \"플레이어\"가 뜨던 문제 수정",
      "주소를 만들면 바로 연결돼요 - 예전엔 서버를 한 번 켜야 주소가 생겨서 그 전에는 \"주소 없음\"이 떴어요",
      "주소 확인 - 주소로 못 들어올 때 무엇이 문제인지(서버 꺼짐 / 주소 퍼지는 중 / 옛 IP / 포트) 짚어줘요",
      "주소를 떼는 대신 연필 버튼으로 고칠 수 있어요",
      "서버 아이콘을 고를 수 있어요 - 어떤 그림이든 64x64 PNG로 바꿔서 넣어줘요",
      "서버 소개(MOTD)에 색과 그라데이션을 넣을 수 있어요",
      "서버 열기 화면의 군더더기 안내 문구를 걷어냈어요",
      "화이트리스트 - 서버 설정 아래에서 들어올 사람을 닉네임으로 넣고 뺄 수 있어요 (목록도 같이 보여요)",
      "모드팩(.mrpack / 서버 팩 zip)을 넣으면 알아서 풀어서 모드팩 서버로 만들어줘요",
      "서버 설정 화면을 다시 정리했어요 - 서버를 켜기 전에는 설정을 크게 보고, 켜면 설정 대신 서버 정보와 로그가 떠요",
      "서버 설정의 켜고 끄는 항목을 보기 좋은 스위치로 바꿨어요",
      "서버 목록에서 포트를 빼고 버전과 종류만 보여줘요",
      "서버 열기와 알림/선물함을 창이 아니라 소식·보관함처럼 화면 하나로 열어요 - 아래쪽이 잘려서 안 보이던 설정과 지우기 버튼도 제대로 보여요",
      "서버 상태 뱃지에 host_state_stopped 같은 글자가 그대로 뜨던 문제 수정",
      "서버를 눌렀을 때 조작판이 안 뜨던 문제 수정",
      "서버 이름·메모리·포트를 창에서 바로 고칠 수 있어요",
      "같은 포트로도 서버를 여러 개 만들 수 있어요",
      "서버 자동 리소스팩을 설정할 수 있어요 (주소·SHA-1·필수 여부)",
      "런처를 꺼도 켜 둔 서버는 계속 돌아가요 - 끄려면 \"서버 끄기\"를 누르세요",
      "서버 설명을 버전과 Fabric/바닐라만 보이게 줄였어요",
      "서버 세부 설정 한글 표시",
      "프로필 공유에서 노바 모드 설정 제거",
      "상점 메탈 배경색 수정",
      "서버 목록·설정 높이 맞춤",
      "설정 안내 문구 제거",
      "프로필 사진 원형 표시",
      "커뮤니티 프로필 사진 표시 수정",
      "메인화면 그림자 잘림 수정",
      "상점 프로필 테두리",
      "상점 서버 슬롯 +1",
      "티어별 서버 개수 (아이언~골드 2 · 플래티넘 이상 3)",
      "티어 혜택 화면 개편",
      "친구 메모",
      "친구 이름에 마우스를 올리면 프로필 카드",
      "내장 모드를 Luna's Light 로만 사용 (옛 노바 모드 삭제)",
      "커뮤니티 답글 새 모양 (@이름 답글 · 작성 시각)",
      "커뮤니티 작성자 사진·이름 크게",
      "플레이 중 표시 짧게",
      "서버 경고 문구를 새 서버 버튼 아래로",
      "서버 화면 보조 버튼을 배경 없는 글자로",
      "프로필 테두리 가격 절반 · 테두리를 사진 바깥에",
      "메인화면 프로필 사진 크게",
      "티어 기준 상향 · 접속 1시간 1점",
      "티어 기준 추가 상향",
      "사진 없는 사람은 회색 사람 모양",
      "커뮤니티 모든 사진에 프로필 테두리",
      "친구 카드에 플레이 중인 서버·프로필 아이콘",
      "친구 목록 온라인 점 위치·간격 정리",
      "목록으로 버튼 배경 제거",
      "회원가입 이메일 인증",
      "추천인은 이메일 인증 + 연동된 마크 계정이 있어야 가능 (같은 이메일·마크 계정은 한 번만)",
      "마크가 없는 마이크로소프트 계정은 로그인 막기",
      "커뮤니티 제재 창 정리 · 구독 버튼 · 날짜/조회수 정리",
      "이메일 인증이 안 된 계정은 접속할 때 인증 창",
      "기본 서버: 너굴마을 · 하이픽셀 · 온리소드",
      "여러 버전 서버는 1.8.9~26.2 처럼 표시, 범위 안 아무 버전 프로필로 접속",
      "서버·프로필 목록 끌어서 순서 바꾸기",
      "프로필 선택 표시 정리",
      "친구 카드: 서버·프로필 아이콘 표시 제거",
      "할인은 상점 메인 상품(메탈)만 - 다른 테마는 정가 2,900",
      "마우스 잔상이 커서와 떨어져 보이던 문제 수정",
      "구독 취소가 안 되던 문제 수정",
      "업데이트가 생기면 윈도우 알림",
      "업데이트가 설치되지 않던 문제 수정 · 업데이트 때 실행 로딩 숨김",
      "구독한 멤버가 새 글을 올리면 커뮤니티 빨간 점 + 알림",
      "화면 제목 한글로 (설치 · 콘텐츠 · 상점 · 설정 · 업데이트), 컨텐츠 → 콘텐츠",
    ],
  },
];

// 사용자가 설정 화면에서 바꿀 수 있는 값들의 기본값
const DEFAULT_SETTINGS = {
  memoryGB: 4,             // 마인크래프트에 할당할 메모리(GB)
  // 24-58차: "배경음악 설정이랑 음악 아예 전부 삭제하자" - 런처 배경음악 기능 자체를
  // 통째로 없애면서 이 설정값도 같이 제거함(효과음 설정(sfxVolume)은 별개 기능이라 유지)
  sfxVolume: 50,           // 코인 등 효과음 볼륨(0~100)
  mcFullscreen: false,     // 마인크래프트를 전체화면으로 실행할지
  // 24-24차 신규: 설정 화면에서 직접 바꿀 수 있는 실행 해상도(서버 모드 전용 - 프로필
  // 모드는 프로필 자체의 width/height/fullscreen을 씀). 예전엔 서버 모드가 1280x720으로
  // 고정돼 있었음
  mcResolutionWidth: 1280,
  mcResolutionHeight: 720,
  theme: "dark",           // "dark" | "light" | "system"
  language: "system",      // 7-1: "system" | "ko" | "en" - system이면 OS 언어를 따라감
  // 17차 신규
  onLaunchBehavior: "stay",   // 마크를 켰을 때 런처가 어떻게 될지: "stay"(그대로 유지) | "background"(트레이로 숨김) | "quit"(런처 완전 종료)
  autostartMode: "no",        // 컴퓨터 시작 시 자동 실행: "yes"(창 열림) | "background"(트레이로 시작) | "no"
  hidePresence: false,        // 친구에게 내가 지금 뭘 플레이 중인지 공유 안 함(온라인 여부만 보임)
  // 24-83차 신규: 런처 화면에 쓸 글꼴. "default"면 지금까지 쓰던 SUIT을 그대로 씀.
  // 직접 추가한 폰트는 uiFontPath(앱 데이터 폴더 안으로 복사해둔 실제 파일 경로)와
  // uiFontName(화면에 보여줄 이름)에 담김 - 원본 파일이 나중에 지워지거나 옮겨져도
  // 런처가 계속 쓸 수 있도록 고르는 순간 복사해둠
  uiFont: "default",          // "default" | "custom"
  uiFontPath: "",
  uiFontName: "",
  // 24-136차: "클라이언트 폰트 0.5~2배까지 조절 가능하게 0.1씩 해줘 커스텀 폰트는"
  // 직접 추가한 글꼴은 서체마다 같은 px에서도 크게/작게 보여서 배율이 필요함.
  // @font-face 의 size-adjust 로 "글자 크기만" 키우고 줄임(레이아웃 px 값은 그대로라
  // 버튼/칸 크기는 안 흔들림). 0.5 ~ 2.0, 0.1 단위
  uiFontScale: 1,
  // 24-147차: "리소스팩이랑 쉐이더는 설정에서 시작시 자동으로 적용되게 할지 하는 설정을
  // 만들고 활성화 비활성화를 대신해서 그 자리에 해줘"
  // 지금까지 목록의 "활성화"는 파일 이름에서 .disabled 를 떼는 것뿐이라, 게임에는 그냥
  // 폴더에 파일이 보이기만 하고 실제로 켜지지는 않았음(게임 안에서 또 골라야 했음).
  // 이 설정을 켜두면 게임을 켤 때 "활성화된 리소스팩/쉐이더팩"을 options.txt(와 Iris 설정)에
  // 직접 적어줘서, 목록의 활성화가 곧 "게임에서 켜짐"이 됨.
  autoApplyPacks: true,
  // 24-147차: 리소스팩/쉐이더팩 안내를 이미 봤는지(딱 한 번만 띄우기 위함)
  packNoticeSeen: false,
};

// electron-store는 기본적으로 "제품 이름" 기준 폴더에 저장되는데, 이러면 나중에
// 이름이 또 바뀔 때마다 코인/계정 데이터가 날아갈 위험이 있어서, 이름과 무관한
// 우리 전용 인스턴스 폴더(instanceRoot) 안에 저장하도록 고정했습니다.
//
// 개발 중(npm start, app.isPackaged === false)에는 폴더 이름 뒤에 "-Dev"를 붙여서,
// 실제로 설치된 정식 프로그램과 로그인/코인/설정 데이터가 절대 섞이지 않게 분리했습니다.
// (모드/버전/자바 런타임 같은 용량 큰 마인크래프트 파일은 getRoot()를 그대로 써서 계속
//  공유하니, 테스트할 때마다 다시 다운로드하지 않아도 됩니다)
const instanceFolderName = app.isPackaged ? CONFIG.INSTANCE_NAME : `${CONFIG.INSTANCE_NAME}-Dev`;
const instanceRootForStore = path.join(app.getPath("appData"), instanceFolderName);
fs.mkdirSync(instanceRootForStore, { recursive: true });

// Luna Client -> Nova Client로 이름이 바뀌면서, 예전 기본 위치에 있던 설정/코인
// 데이터를 한 번만 새 위치로 옮겨줍니다 (이미 옮겨졌으면 아무 일도 안 함).
// 개발용(-Dev) 폴더에는 이 마이그레이션을 적용하지 않습니다 (실제 배포본에서만 의미 있음).
if (app.isPackaged) {
  (function migrateStoreLocationOnce() {
    const newConfigPath = path.join(instanceRootForStore, "config.json");
    if (fs.existsSync(newConfigPath)) return; // 이미 새 위치에 있으면 끝

    const oldConfigPath = path.join(app.getPath("appData"), "Luna Client", "config.json");
    if (fs.existsSync(oldConfigPath)) {
      try {
        fs.copyFileSync(oldConfigPath, newConfigPath);
      } catch (_) {
        /* 실패해도 그냥 새 설정으로 시작함 */
      }
    }
  })();
}

const store = new Store({ cwd: instanceRootForStore });

// 예전 마인크래프트 인스턴스 폴더(LunaClient)가 있으면 새 이름(NovaClient)으로 한 번 이전
if (CONFIG.INSTANCE_NAME === "NovaClient") {
  const oldRoot = path.join(app.getPath("appData"), "LunaClient");
  const newRoot = instanceRootForStore;
  const alreadyHasFiles = fs.existsSync(path.join(newRoot, "mods")) || fs.existsSync(path.join(newRoot, "versions"));
  if (!alreadyHasFiles && fs.existsSync(oldRoot)) {
    try {
      fs.cpSync(oldRoot, newRoot, { recursive: true });
      logToFile("예전 LunaClient 인스턴스 폴더를 NovaClient로 이전함");
    } catch (err) {
      logToFile("인스턴스 폴더 이전 실패: " + (err?.message || err));
    }
  }
}

// ----------------------------------------------------------------------------
// 서버 선택 (여러 서버 중 유저가 고른 서버 - 마인크래프트 버전은 서버가 고정함)
// ----------------------------------------------------------------------------
function getSelectedServer() {
  const selectedId = store.get("selected_server_id");
  const found = getAllServers().find((s) => s.id === selectedId);
  return found || CONFIG.SERVERS[0];
}

// 마인크래프트 버전에 맞는 자바 버전을 자동으로 계산 (버전마다 필요한 자바가 다름)
//
// 24-79차: loader 인자 추가. 내장 Nova 모드는 공유 소스가 record·switch 식을 써서 자바 16
// 미만으로는 아예 컴파일이 안 된다(Nova-Mod 49-31차 실측: --release 16 0오류 / 8 406오류).
// 그래서 1.15.2~1.16.5를 예전처럼 자바 8로 켜면 그 버전들만 내장 모드가 로드되지 않았다.
// Fabric은 1.15/1.16에서도 자바 17로 도는 반면 Forge 1.16.5는 자바 8이 필수라, 로더로 갈라
// Fabric·순정일 때만 17을 준다. 되돌리려면 isLegacyFabric 분기만 지우면 된다.
function getJavaFeatureVersionFor(mcVersion, loader) {
  const [major, minor] = String(mcVersion).split(".").map((n) => parseInt(n, 10) || 0);
  // 26.x 이상(2026 새 버전 체계, 예: 26.1.2 · 26.2) -> Java 25
  //  ↳ 이게 없어서 새 프로필(mc26.x)이 major===1 분기를 전부 건너뛰고 맨 아래 Java 8로 떨어졌다.
  //    Fabric 로더가 "OpenJDK ... 25 이상 필요하지만 8이 있습니다"로 실행을 막던 원인.
  if (major >= 26) return 25;
  // 1.21.x / 1.20.5 이상 -> Java 21
  if (major === 1 && (minor > 20 || (minor === 20 && String(mcVersion).split(".")[2] >= "5"))) {
    return 21;
  }
  // 1.17 ~ 1.20.4 -> Java 17
  if (major === 1 && minor >= 17) return 17;
  // 1.15 ~ 1.16 의 Fabric/순정 -> Java 17 (내장 모드가 로드되게)
  // 49-171차: 값이 "Fabric"처럼 대소문자가 다르거나 모르는 값이어도 Forge/NeoForge가 아니면 Fabric으로 본다.
  const loaderKey = String(loader || "fabric").toLowerCase();
  const isLegacyFabric = loaderKey !== "forge" && loaderKey !== "neoforge";
  // 49-158차·49-171차: 1.14.4 Fabric도 추가(Nova 모드가 Java 16 대상). 49-159차 커밋 때 >=15로 되돌아가 있었다.
  if (major === 1 && minor >= 14 && isLegacyFabric) return 17;
  // 그 밖의 1.16 이하(Forge/NeoForge) -> Java 8
  return 8;
}

// ────────────────────────────────────────────────────────────────────────────
// 24-177차: "서버 자기가 직접 추가할 수 있게 해줘 주소 입력하면 나머지는 클라쪽에서 알아서"
//
// 기본 서버(CONFIG.SERVERS)는 코드에 박혀 있고, 유저가 추가한 서버는 store.user_servers 에
// 쌓인다. 목록을 읽는 모든 곳은 이제 getAllServers() 하나만 보면 된다.
// 유저 서버에는 custom:true 가 붙어서 화면에서 "삭제" 버튼을 띄울 수 있다.
// ────────────────────────────────────────────────────────────────────────────
function getUserServers() {
  const list = store.get("user_servers");
  return Array.isArray(list) ? list.map((s) => ({ ...s, custom: true })) : [];
}
function saveUserServers(list) {
  store.set("user_servers", list.map(({ custom, ...rest }) => rest));
}
// 24-241차: 직접 추가한 서버가 맨 위(최근 추가 순), 그 아래 기본 서버(CONFIG 순서).
// 끌어서 순서를 바꿨으면(store.server_order) 그 순서를 따르고, 거기 없는 새 서버는 맨 위.
function getAllServers() {
  const base = [...getUserServers().reverse(), ...(CONFIG.SERVERS || [])];
  const order = store.get("server_order");
  if (!Array.isArray(order) || !order.length) return base;
  const at = new Map(order.map((id, i) => [id, i]));
  return base
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ra = at.has(a.s.id) ? at.get(a.s.id) : a.s.custom ? -1 : 1e6;
      const rb = at.has(b.s.id) ? at.get(b.s.id) : b.s.custom ? -1 : 1e6;
      return ra - rb || a.i - b.i;
    })
    .map((x) => x.s);
}

// 24-241차: 마인크래프트 버전 비교(1.8.9 < 1.20 < 1.21.11 < 26.1 < 26.2)
function mcVerCmp(a, b) {
  const pa = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
// 화면에 보이는 버전 - 여러 버전 서버는 "1.8.9~26.2"
function serverVersionLabel(s) {
  if (s && s.versionMin && s.versionMax && s.versionMin !== s.versionMax) return `${s.versionMin}~${s.versionMax}`;
  return s ? s.version : "";
}
// 서버 이름표에 실린 버전들("Requires MC 1.8 / 1.21", "Velocity 1.20-26.2" 등)을 범위로
function extractMcVersionRange(versionName) {
  const all = (String(versionName || "").match(/\d+\.\d+(?:\.\d+)?/g) || []).filter((v) => {
    const major = parseInt(v, 10);
    return major === 1 || major >= 26;
  });
  if (all.length < 2) return null;
  const sorted = [...new Set(all)].sort(mcVerCmp);
  if (sorted.length < 2) return null;
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

// 24-241차: SRV 를 따라가야 하는 서버의 실제 접속 위치(10분 기억)
const srvTargetCache = new Map();
async function serverPingTarget(server) {
  if (!server?.useSrv) return { host: server.host, port: server.port };
  const hit = srvTargetCache.get(server.id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.target;
  let target = { host: server.host, port: server.port };
  try {
    const r = await resolveServerAddress(server.host);
    if (r.ok) target = { host: r.host, port: r.port };
  } catch (_) {}
  srvTargetCache.set(server.id, { at: Date.now(), target });
  return target;
}

ipcMain.handle("servers:reorder", (_e, ids) => {
  if (!Array.isArray(ids)) return { ok: false };
  store.set("server_order", ids.map(String).slice(0, 200));
  return { ok: true };
});
ipcMain.handle("profiles:reorder", (_e, ids) => {
  if (!Array.isArray(ids)) return { ok: false };
  store.set("profile_order", ids.map(String).slice(0, 500));
  return { ok: true };
});

// "mc.example.com", "mc.example.com:25566", "https://mc.example.com" 같은 입력을 정리한다.
// 포트를 안 적었으면 마인크래프트 규칙대로 _minecraft._tcp SRV 레코드를 먼저 찾아본다
// (대부분의 서버가 25565 가 아닌 포트를 SRV 로 숨기고 있어서, 이걸 안 하면 "주소만 적으면
//  되는" 경험이 안 나온다). SRV 가 없으면 기본 포트 25565.
async function resolveServerAddress(input) {
  let raw = String(input || "").trim();
  if (!raw) return { ok: false, error: "서버 주소를 입력해주세요." };
  raw = raw.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!raw) return { ok: false, error: "서버 주소를 입력해주세요." };

  let host = raw;
  let port = null;
  const colon = raw.lastIndexOf(":");
  if (colon > 0 && !raw.includes("]")) {
    const maybePort = raw.slice(colon + 1);
    if (/^\d{1,5}$/.test(maybePort)) {
      host = raw.slice(0, colon);
      port = Number(maybePort);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return { ok: false, error: "주소 형식이 올바르지 않아요." };
  if (port !== null && (port < 1 || port > 65535)) return { ok: false, error: "포트 번호가 올바르지 않아요." };

  let srvUsed = false;
  if (port === null) {
    try {
      const recs = await dnsPromises.resolveSrv(`_minecraft._tcp.${host}`);
      if (recs && recs.length) {
        const best = recs.slice().sort((a, b) => (a.priority - b.priority) || (b.weight - a.weight))[0];
        host = String(best.name).replace(/\.$/, "");
        port = Number(best.port);
        srvUsed = true;
      }
    } catch (_) {
      // SRV 가 없는 게 정상인 서버가 훨씬 많다 - 조용히 기본 포트로 간다
    }
  }
  if (port === null) port = 25565;
  return { ok: true, host, port: String(port), srvUsed };
}

// 상태 조회 응답에서 마인크래프트 버전만 뽑는다. version.name 은 "Paper 1.21.4",
// "Velocity 1.7.2-1.21.11" 처럼 서버 소프트웨어 이름이 섞여 오는 경우가 많아서
// 맨 뒤에 있는 x.y(.z) 를 고른다(프록시는 지원 범위를 앞뒤로 같이 적는 일이 잦다).
function extractMcVersion(versionName) {
  const all = String(versionName || "").match(/\d+\.\d+(?:\.\d+)?/g);
  return all && all.length ? all[all.length - 1] : null;
}

// 주소를 받아 실제로 한 번 찔러보고 알아낸 것들을 돌려준다(추가하기 전 미리보기).
ipcMain.handle("servers:probe", async (_e, address) => {
  const addr = await resolveServerAddress(address);
  if (!addr.ok) return addr;
  try {
    const { json, pingMs } = await queryServerDirect(addr.host, addr.port, 5000);
    const motd = firstMotdLine({ clean: flattenMcText(json.description).split("\n") });
    return {
      ok: true,
      host: addr.host,
      port: addr.port,
      srvUsed: addr.srvUsed,
      pingMs,
      motd,
      versionName: json.version?.name || "",
      version: extractMcVersion(json.version?.name),
      playersOnline: json.players?.online,
      playersMax: json.players?.max,
      icon: typeof json.favicon === "string" && json.favicon.startsWith("data:image/") ? json.favicon : null,
    };
  } catch (err) {
    logToFile(`[서버 추가] 조회 실패 ${addr.host}:${addr.port} - ${err?.message || err}`);
    return { ok: false, host: addr.host, port: addr.port, error: "서버에 연결하지 못했어요. 주소와 포트를 확인해주세요." };
  }
});

ipcMain.handle("servers:add", async (_e, { address, name, version } = {}) => {
  const addr = await resolveServerAddress(address);
  if (!addr.ok) return addr;

  const all = getAllServers();
  if (all.some((s) => s.host === addr.host && String(s.port) === String(addr.port))) {
    return { ok: false, error: "이미 목록에 있는 서버예요." };
  }

  // 버전은 화면에서 고친 값을 그대로 믿되(프록시 서버는 자동 인식이 어긋날 수 있어서),
  // 안 넘어왔으면 한 번 더 찔러서 알아낸다. 그래도 모르면 저장하지 않는다 -
  // 버전이 있어야 어떤 프로필로 들어갈지 고를 수 있기 때문(profileFitsServer).
  let mcVersion = String(version || "").trim();
  if (!mcVersion) {
    try {
      const { json } = await queryServerDirect(addr.host, addr.port, 5000);
      mcVersion = extractMcVersion(json.version?.name) || "";
    } catch (_) {}
  }
  // 24-241차: "하이픽셀같이 버전이 여러개 가능한 것은 여러개 인식" - 서버 이름표에 버전이 여럿이면 범위로
  let range = null;
  try {
    const { json } = await queryServerDirect(addr.host, addr.port, 5000);
    range = extractMcVersionRange(json.version?.name);
  } catch (_) {}
  if (!mcVersion && range) mcVersion = range.max;
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(mcVersion)) {
    return { ok: false, error: "마인크래프트 버전을 알아내지 못했어요. 버전을 직접 입력해주세요." };
  }

  const label = String(name || "").trim().slice(0, 40) || addr.host;
  const server = {
    id: "custom_" + crypto.randomUUID().slice(0, 8),
    name: label,
    host: addr.host,
    port: String(addr.port),
    version: mcVersion,
    ...(range && mcVerCmp(range.min, range.max) < 0 ? { versionMin: range.min, versionMax: range.max } : {}),
  };
  const list = getUserServers();
  list.push(server);
  saveUserServers(list);
  // 24-241차: 순서를 바꿔둔 적이 있어도 새로 추가한 서버는 맨 위
  const order = store.get("server_order");
  if (Array.isArray(order) && order.length) store.set("server_order", [server.id, ...order.filter((id) => id !== server.id)]);
  logToFile(`[서버 추가] ${label} (${addr.host}:${addr.port}, ${mcVersion})`);
  // 방금 추가한 서버 상태를 바로 채워서 카드가 "확인 중"으로 오래 남지 않게 함
  checkAllServersStatus();
  return { ok: true, server: { ...server, custom: true } };
});

// ────────────────────────────────────────────────────────────────────────────
// 24-183차: "그 서버로 들어가면 멀티에도 서버 있게 해줘야 해, 리소스팩은 무조건 사용으로"
//
// 마인크래프트의 멀티플레이 서버 목록은 게임 폴더의 servers.dat 에 NBT 형식으로 들어있다.
// 런처로 서버에 접속할 때 그 서버를 이 목록에도 넣어주면, 게임 안 "멀티플레이"에서도
// 그대로 보이고 다음부터 직접 들어갈 수 있다.
// 각 서버 항목의 acceptTextures 를 1 로 적어두면 "서버 리소스팩 사용함"으로 고정돼서,
// 들어갈 때마다 쓸지 말지 묻는 창이 뜨지 않는다. (0=안 씀, 값이 없으면=매번 물어봄)
//
// NBT 라이브러리를 새로 넣지 않고 최소한으로 직접 다룬다. 태그 종류는 전부 지원하므로
// 우리가 모르는 필드(유저가 게임 안에서 넣어둔 서버의 아이콘 등)도 그대로 보존된다 -
// 실제 servers.dat 로 "읽었다 그대로 쓰면 바이트가 똑같은지"까지 확인했다.
// servers.dat 는 보통 압축이 안 돼 있지만(level.dat 과 다름), 혹시 gzip 이어도 읽히게 해뒀다.
// ────────────────────────────────────────────────────────────────────────────
const NBT_END = 0, NBT_BYTE = 1, NBT_SHORT = 2, NBT_INT = 3, NBT_LONG = 4, NBT_FLOAT = 5,
      NBT_DOUBLE = 6, NBT_BYTE_ARRAY = 7, NBT_STRING = 8, NBT_LIST = 9, NBT_COMPOUND = 10,
      NBT_INT_ARRAY = 11, NBT_LONG_ARRAY = 12;

function nbtRead(buf) {
  let o = 0;
  const u1 = () => buf.readUInt8(o++);
  const i4 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString("utf8", o, o + n); o += n; return s; };
  const payload = (t) => {
    switch (t) {
      case NBT_BYTE: return buf.readInt8(o++);
      case NBT_SHORT: { const v = buf.readInt16BE(o); o += 2; return v; }
      case NBT_INT: return i4();
      case NBT_LONG: { const v = buf.readBigInt64BE(o); o += 8; return v; }
      case NBT_FLOAT: { const v = buf.readFloatBE(o); o += 4; return v; }
      case NBT_DOUBLE: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case NBT_BYTE_ARRAY: { const n = i4(); const v = buf.slice(o, o + n); o += n; return v; }
      case NBT_STRING: return str();
      case NBT_LIST: { const et = u1(); const n = i4(); const items = []; for (let i = 0; i < n; i++) items.push(payload(et)); return { __list: true, type: et, items }; }
      case NBT_COMPOUND: { const entries = []; for (;;) { const tt = u1(); if (tt === NBT_END) break; const name = str(); entries.push({ type: tt, name, value: payload(tt) }); } return { __compound: true, entries }; }
      case NBT_INT_ARRAY: { const n = i4(); const a = []; for (let i = 0; i < n; i++) a.push(i4()); return { __intArray: true, items: a }; }
      case NBT_LONG_ARRAY: { const n = i4(); const a = []; for (let i = 0; i < n; i++) { a.push(buf.readBigInt64BE(o)); o += 8; } return { __longArray: true, items: a }; }
      default: throw new Error("알 수 없는 NBT 태그: " + t);
    }
  };
  if (u1() !== NBT_COMPOUND) throw new Error("servers.dat 형식이 아니에요");
  const rootName = str();
  return { name: rootName, root: payload(NBT_COMPOUND) };
}

function nbtWrite(doc) {
  const parts = [];
  const u1 = (v) => { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff); parts.push(b); };
  const i4 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  const str = (s) => { const sb = Buffer.from(String(s), "utf8"); const b = Buffer.alloc(2); b.writeUInt16BE(sb.length); parts.push(b, sb); };
  const payload = (t, v) => {
    switch (t) {
      case NBT_BYTE: { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); return; }
      case NBT_SHORT: { const b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); return; }
      case NBT_INT: return i4(v);
      case NBT_LONG: { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); return; }
      case NBT_FLOAT: { const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b); return; }
      case NBT_DOUBLE: { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); return; }
      case NBT_BYTE_ARRAY: { i4(v.length); parts.push(Buffer.from(v)); return; }
      case NBT_STRING: return str(v);
      case NBT_LIST: { u1(v.type); i4(v.items.length); for (const it of v.items) payload(v.type, it); return; }
      case NBT_COMPOUND: { for (const e of v.entries) { u1(e.type); str(e.name); payload(e.type, e.value); } u1(NBT_END); return; }
      case NBT_INT_ARRAY: { i4(v.items.length); for (const n of v.items) i4(n); return; }
      case NBT_LONG_ARRAY: { i4(v.items.length); for (const n of v.items) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); parts.push(b); } return; }
      default: throw new Error("알 수 없는 NBT 태그: " + t);
    }
  };
  u1(NBT_COMPOUND); str(doc.name || ""); payload(NBT_COMPOUND, doc.root);
  return Buffer.concat(parts);
}

function nbtFind(compound, name) {
  return compound.entries.find((e) => e.name === name) || null;
}
function nbtSet(compound, type, name, value) {
  const e = nbtFind(compound, name);
  if (e) { e.type = type; e.value = value; }
  else compound.entries.push({ type, name, value });
}

// 실행할 게임 폴더의 servers.dat 에 이 서버를 넣거나 갱신한다.
// 같은 주소가 이미 있으면 그 항목을 고치고(중복을 안 만든다), 없으면 맨 위에 추가한다.
function upsertServerInDat(runRoot, server) {
  if (!runRoot || !server?.host) return;
  const datPath = path.join(runRoot, "servers.dat");
  const ip = String(server.port) && String(server.port) !== "25565"
    ? `${server.host}:${server.port}`
    : String(server.host);
  try {
    let doc;
    try {
      let raw = fs.readFileSync(datPath);
      if (raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b) raw = require("zlib").gunzipSync(raw);
      doc = nbtRead(raw);
    } catch (_) {
      doc = { name: "", root: { __compound: true, entries: [] } }; // 아직 파일이 없으면 새로 만든다
    }

    let servers = nbtFind(doc.root, "servers");
    if (!servers || !servers.value?.__list) {
      servers = { type: NBT_LIST, name: "servers", value: { __list: true, type: NBT_COMPOUND, items: [] } };
      doc.root.entries.push(servers);
    }
    if (servers.value.items.length === 0) servers.value.type = NBT_COMPOUND;

    const wanted = [ip.toLowerCase(), String(server.host).toLowerCase(), `${server.host}:25565`.toLowerCase()];
    let entry = servers.value.items.find((c) => {
      const e = c && c.__compound ? nbtFind(c, "ip") : null;
      return e && wanted.includes(String(e.value).trim().toLowerCase());
    });
    if (!entry) {
      entry = { __compound: true, entries: [] };
      servers.value.items.unshift(entry);
    }
    nbtSet(entry, NBT_STRING, "name", server.name || server.host);
    nbtSet(entry, NBT_STRING, "ip", ip);
    nbtSet(entry, NBT_BYTE, "acceptTextures", 1); // 리소스팩은 묻지 말고 무조건 사용

    fs.mkdirSync(path.dirname(datPath), { recursive: true });
    fs.writeFileSync(datPath, nbtWrite(doc));
    logToFile(`[멀티 목록] ${server.name || ip} 를 servers.dat 에 반영 (리소스팩 자동 사용)`);
  } catch (err) {
    // 목록에 못 넣어도 접속 자체는 되므로 실행을 막지 않는다
    logToFile("[멀티 목록] servers.dat 기록 실패(무시): " + (err?.message || err));
  }
}

ipcMain.handle("servers:remove", (_e, serverId) => {
  const list = getUserServers();
  const idx = list.findIndex((s) => s.id === serverId);
  if (idx < 0) return { ok: false, error: "기본 서버는 삭제할 수 없어요." };
  const [removed] = list.splice(idx, 1);
  saveUserServers(list);

  // 이 서버에 걸려 있던 프로필 연결과 선택 상태도 같이 정리
  const m = getServerProfileMap();
  if (m[serverId]) { delete m[serverId]; store.set("server_profiles", m); }
  if (store.get("selected_server_id") === serverId) store.delete("selected_server_id");
  const lastPlayed = store.get("server_last_played") || {};
  if (lastPlayed[serverId]) { delete lastPlayed[serverId]; store.set("server_last_played", lastPlayed); }

  logToFile(`[서버 삭제] ${removed?.name || serverId}`);
  return { ok: true };
});

ipcMain.handle("servers:list", () => {
  const mode = store.get("launch_mode") || "server";
  const selected = getSelectedServer();
  const serverLastPlayed = store.get("server_last_played") || {};
  return getAllServers().map((s) => ({
    ...s,
    versionLabel: serverVersionLabel(s), // 24-241차
    selected: mode === "server" && s.id === selected.id,
    lastPlayedAt: serverLastPlayed[s.id] || null,
    // 24-94/95차: 서버 카드에 보여줄 연결 프로필(없거나 무효면 null)
    ...(() => {
      const lp = getLinkedProfileForServer(s);
      return {
        linkedProfileId: lp ? lp.id : null,
        linkedProfileName: lp ? lp.name : null,
        linkedProfileIconUrl: lp ? getProfileIconUrl(lp.id) : null,
      };
    })(),
  }));
});

ipcMain.handle("servers:select", (_e, serverId) => {
  const found = getAllServers().find((s) => s.id === serverId);
  if (!found) return { ok: false, error: "존재하지 않는 서버예요." };
  store.set("selected_server_id", serverId);
  store.set("launch_mode", "server"); // 서버를 고르면 프로필 선택은 자동으로 풀림
  return { ok: true, server: found };
});

// ----------------------------------------------------------------------------
// 24-94차: 서버별 "들어갈 프로필" 연결 - store.server_profiles = { 서버 id: 프로필 id }
// (24-98차 복구: 다른 작업 세션의 병행 저장으로 이 블록이 통째로 유실됐었음 - 지우면 안 됨.
//  렌더러/preload가 servers:profile-options · servers:set-profile을 부르므로 없으면 홈이 깨짐)
// ----------------------------------------------------------------------------
function getServerProfileMap() {
  const m = store.get("server_profiles");
  return m && typeof m === "object" ? m : {};
}
// 서버 버전과 프로필 버전이 정확히 같아야 연결 가능
function profileFitsServer(profile, server) {
  if (!profile || !server) return false;
  // 24-241차: 여러 버전 서버는 범위 안이면 된다
  if (server.versionMin && server.versionMax) {
    return mcVerCmp(profile.mcVersion, server.versionMin) >= 0 && mcVerCmp(profile.mcVersion, server.versionMax) <= 0;
  }
  return String(profile.mcVersion) === String(server.version);
}
// 연결은 읽을 때마다 유효성을 확인함: 프로필이 지워졌거나 버전이 바뀌었으면 "연결 안 됨"
// (엉뚱한 버전으로 조용히 켜지지 않게)
function getLinkedProfileForServer(server) {
  if (!server) return null;
  const id = getServerProfileMap()[server.id];
  if (!id) return null;
  const p = findProfile(id);
  return profileFitsServer(p, server) ? p : null;
}
// 프로필을 삭제할 때 그 프로필을 가리키던 연결도 같이 지움
function unlinkProfileFromServers(profileId) {
  const m = getServerProfileMap();
  let changed = false;
  for (const k of Object.keys(m)) {
    if (m[k] === profileId) { delete m[k]; changed = true; }
  }
  if (changed) store.set("server_profiles", m);
}

ipcMain.handle("servers:profile-options", (_e, serverId) => {
  const server = getAllServers().find((s) => s.id === serverId);
  if (!server) return { ok: false, error: "존재하지 않는 서버예요." };
  const linked = getLinkedProfileForServer(server);
  const options = getProfiles()
    .filter((p) => profileFitsServer(p, server))
    .map((p) => ({
      id: p.id,
      name: p.name,
      mcVersion: p.mcVersion,
      loader: p.loader || "fabric",
      lastPlayedAt: p.lastPlayedAt || null,
      iconUrl: getProfileIconUrl(p.id),
    }));
  return {
    ok: true,
    // 24-241차: version 은 화면용("1.8.9~26.2"), createVersion 은 새 프로필을 만들 버전
    server: { id: server.id, name: server.name, version: serverVersionLabel(server), createVersion: server.version },
    linkedProfileId: linked ? linked.id : null,
    options,
  };
});

ipcMain.handle("servers:set-profile", (_e, { serverId, profileId } = {}) => {
  const server = getAllServers().find((s) => s.id === serverId);
  if (!server) return { ok: false, error: "존재하지 않는 서버예요." };
  const m = getServerProfileMap();
  if (!profileId) {
    delete m[server.id];
    store.set("server_profiles", m);
    return { ok: true };
  }
  const p = findProfile(profileId);
  if (!p) return { ok: false, error: "프로필을 찾을 수 없어요." };
  // 화면을 우회해도 버전을 다시 확인
  if (!profileFitsServer(p, server)) {
    return { ok: false, error: `${server.name}에는 ${serverVersionLabel(server)} 프로필만 쓸 수 있어요.` };
  }
  m[server.id] = p.id;
  store.set("server_profiles", m);
  return { ok: true };
});

// ----------------------------------------------------------------------------
// 프로필 (유저가 직접 만드는 인스턴스 - 서버와는 별개로 자기만의 모드/리소스팩/쉐이더 구성)
// ----------------------------------------------------------------------------
function getProfilesDir() {
  return path.join(getRoot(), "profiles");
}
function getProfileRoot(profileId) {
  const p = findProfile(profileId);
  return path.join(getProfilesDir(), p ? currentProfileFolder(p) : profileId);
}
function getProfiles() {
  return store.get("profiles") || [];
}
function saveProfiles(list) {
  store.set("profiles", list);
}
function generateProfileId() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function findProfile(profileId) {
  return getProfiles().find((p) => p.id === profileId) || null;
}

// ----------------------------------------------------------------------------
// 24-93차: "우리 클라이언트 프로필 파일 이름 막 짓지 말고 프로필 이름으로 해주라"
//
// 프로필 폴더를 p_mu80ojguh6xg09 같은 무작위 id 대신 **프로필 이름**으로 둡니다.
//
// id 자체는 그대로 둡니다. 선택 상태·바탕화면 바로가기(--profile=<id>)·공유 코드·
// 아이콘 등이 전부 id로 이어져 있어서 id를 바꾸면 그게 다 끊깁니다. 대신 프로필에
// folder 필드를 하나 두고 getProfileRoot()가 그걸 보게 했습니다 - 프로필 폴더 경로는
// 전부 이 함수 하나를 거치므로(39곳) 나머지 코드는 손댈 필요가 없습니다.
// folder가 아직 없는 프로필은 예전처럼 id 폴더를 그대로 씁니다.
//
// 폴더 이름을 실제로 옮기는 건 "안전한 순간"에만 합니다.
//   · 프로필을 새로 만든 직후 - 막 만든 폴더라 아무것도 열려 있지 않음
//   · 이름을 바꿨을 때 - 그 프로필로 게임이 켜져 있으면 건너뜀
//   · 앱을 켤 때 - 예전 p_ 폴더를 이름으로 옮김(실패하면 다음에 켤 때 다시 시도)
// saveProfiles()를 부를 때마다 옮기지 않는 이유: 게임 실행 도중(예: 마지막 플레이 시각
// 저장)에 폴더가 움직이면, 이미 계산해둔 경로로 켜지던 게임이 깨지기 때문입니다.
// Default 프로필은 폴더 이름("default")을 그대로 둡니다.
// ----------------------------------------------------------------------------
const WINDOWS_RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function currentProfileFolder(profile) {
  const f = profile && profile.folder;
  // 저장된 값이 이상하면(경로 구분자, ".", "..") 절대 쓰지 않음 - 삭제할 때 엉뚱한 곳을
  // 지우는 사고를 원천 차단하기 위함
  if (typeof f === "string" && f && f !== "." && f !== ".." && !/[\\/]/.test(f)) return f;
  return profile ? profile.id : "";
}

// 프로필 이름 -> Windows에서 쓸 수 있는 폴더 이름
// 한글은 그대로 둡니다(설치 경로 자체가 이미 C:\Users\<한글 이름>\... 이라 문제없음).
function profileFolderBaseName(name) {
  let s = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "") // Windows 파일 이름에 못 쓰는 문자
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // 끝의 점/공백은 Windows가 조용히 잘라버려서 이름이 어긋남
  if (s.length > 60) s = s.slice(0, 60).replace(/[. ]+$/, "");
  if (!s) s = "프로필";
  if (WINDOWS_RESERVED_FILE_NAMES.test(s)) s += "_"; // CON, NUL 같은 예약어는 폴더로 못 만듦
  return s;
}

// 다른 프로필의 폴더, 디스크에 이미 있는 폴더와 겹치지 않도록 " (2)", " (3)"... 을 붙임.
// Windows는 대소문자를 구분하지 않으므로 비교도 소문자로 합니다.
function allocateProfileFolder(name, list, selfId) {
  const base = profileFolderBaseName(name);
  const self = list.find((p) => p.id === selfId) || null;
  const selfFolder = self ? currentProfileFolder(self).toLowerCase() : null;
  const taken = new Set(
    list.filter((p) => p.id !== selfId).map((p) => currentProfileFolder(p).toLowerCase())
  );
  taken.add(DEFAULT_PROFILE_ID); // 기본 프로필 폴더 이름은 다른 프로필이 가져가면 안 됨
  let onDisk = [];
  try {
    onDisk = fs.readdirSync(getProfilesDir()).map((n) => n.toLowerCase());
  } catch (_) {}
  const isFree = (candidate) => {
    const k = candidate.toLowerCase();
    if (taken.has(k)) return false;
    return k === selfFolder || !onDisk.includes(k);
  };
  if (isFree(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (isFree(candidate)) return candidate;
  }
  return null;
}

// 프로필 폴더를 이름에 맞게 옮기고 profile.folder를 갱신합니다(저장은 부른 쪽에서).
// 실패하면 원래 폴더를 그대로 쓰고 false를 돌려줍니다 - 절대 예외를 던지지 않음.
function applyProfileFolderName(profile, list) {
  if (!profile || profile.isDefault || profile.id === DEFAULT_PROFILE_ID) return false;
  const fromName = currentProfileFolder(profile);
  const target = allocateProfileFolder(profile.name, list, profile.id);
  if (!target || target === fromName) return false;

  const fromPath = path.join(getProfilesDir(), fromName);
  const toPath = path.join(getProfilesDir(), target);

  // 게임을 켜는 중이거나 켜져 있으면 옮기지 않음(앱을 다음에 켤 때 다시 시도됨)
  if (isProfileFolderBusy()) {
    logToFile(`[프로필 폴더] "${profile.name}"은(는) 게임 실행 중이라 폴더 이름 변경을 미룸`);
    return false;
  }

  try {
    // 폴더가 아직 없으면 옮길 것도 없음 - 이름만 기록해두면 처음 쓸 때 그 이름으로 만들어짐
    if (fs.existsSync(fromPath)) fs.renameSync(fromPath, toPath);
    profile.folder = target;
    logToFile(`[프로필 폴더] ${fromName} -> ${target}`);
    return true;
  } catch (err) {
    // Windows는 안의 파일이 하나라도 열려 있으면 폴더 이름을 못 바꿈(EBUSY/EPERM) -
    // 그대로 두면 다음 기회에 다시 시도됨
    logToFile(`[프로필 폴더] "${profile.name}" 폴더 이름 변경 실패(기존 폴더 유지): ${err?.message || err}`);
    return false;
  }
}

// 앱을 켤 때: 아직 무작위 이름인 폴더들을 프로필 이름으로 옮김.
// "한 번만" 플래그를 두지 않는 이유 - 실패한 건(게임이 켜져 있었다든지) 다음에 다시 시도돼야 함.
function migrateProfileFoldersToNames() {
  try {
    const list = getProfiles();
    let changed = false;
    for (const p of list) {
      if (applyProfileFolderName(p, list)) changed = true;
    }
    if (changed) saveProfiles(list);
  } catch (err) {
    logToFile("[프로필 폴더] 이름 맞추기 실패(그대로 진행): " + (err?.message || err));
  }
}

// 기본(Default) 프로필: 앱을 처음 켰을 때 무조건 하나 존재하고, 삭제할 수 없음.
// 아이콘은 따로 지정 안 하면 Nova 앱 아이콘을 그대로 사용함.
const DEFAULT_PROFILE_ID = "default";
// 24-76차: "디폴트 버전이 왜 1.20.1로 내려간 거야?" - Default 프로필의 마인크래프트 버전이
// 고정값이 아니라 CONFIG.SERVERS[0].version(=서버 목록 첫 번째 서버)을 따라가고 있었음.
// 24-59차에서 "그 외의 서버들은 다 없애주고"로 서버를 하나만 남기면서 그게 "하이의 놀이터"
// (1.20.1/Forge)가 됐고, 그 뒤로 새로 만들어지는 Default 프로필이 전부 1.20.1이 된 것.
// (기존 프로필은 ensureDefaultProfile이 "없을 때만" 만들기 때문에 영향 없음 - 재설치처럼
//  프로필이 새로 생기는 경우에만 드러났음)
// 이제 서버 목록과 분리해서 고정 버전으로 시작함. 서버를 추가/삭제해도 안 흔들림.
// 24-133차: "프로필 디폴트 1.21.11 이라니까 왜 1.20.1이야" - 코드 값은 26.2 였는데 화면에는
// 1.20.1 이 떴음. 원인은 두 가지가 겹친 것: (1) ensureDefaultProfile 은 "Default 가 없을 때만"
// 만들기 때문에, 옛 빌드(1.0.7)가 만들어 둔 1.20.1 짜리 Default 가 %APPDATA%\NovaClient 에
// 그대로 남아 재설치해도 계속 쓰였음. (2) 값 자체도 요청과 달랐음. 이제 1.21.11 로 고정.
// ⚠️ 새 마인크래프트 정식 버전이 나오면 이 값을 올려주세요. 값을 올릴 땐 novamod/ 폴더에
//    그 버전용 novaclient-mod-*+mc<버전>.jar 이 있는지도 같이 확인해주세요(없으면 노바 내장
//    모드가 그 버전에서 조용히 빠집니다 - syncNovaMod 주석 참고).
const DEFAULT_PROFILE_MC_VERSION = "1.21.11";
// 24-27차: "계정을 바꾸면 원래 설정으로 돌아가고 처음 앱을 들어갔을 때 설정 적용이
// 안돼있는 듯?" - 실제 원인은 계정이 아니라 "프로필"이었음. 서버 모드는 실행할 때마다
// getSettings()(설정 화면의 해상도/전체화면)를 그대로 씀. 그런데 프로필 모드는 그 설정을
// 아예 안 보고, 프로필 자신이 만들어질 때 한 번 저장해둔 값(profile.width/height/
// fullscreen/memoryGB)만 씀 - 그게 지금까지 항상 1280/720/false/4로 하드코딩돼 있어서,
// 설정 화면에서 해상도를 아무리 바꿔도 프로필로 실행할 땐 전혀 반영 안 되고 매번 그
// 하드코딩된 값(=사용자 입장에선 "원래 설정")으로 돌아간 것처럼 보였던 것. 이제 이
// 기본값을 하드코딩 대신 지금 저장된 설정 화면 값으로 채움 - 새로 만드는 프로필도, 앱을
// 처음 켤 때 자동으로 만들어지는 이 Default 프로필도 전부 설정 화면과 같은 값으로 시작함
function ensureDefaultProfile() {
  const list = getProfiles();
  if (list.some((p) => p.id === DEFAULT_PROFILE_ID)) {
    ensureFirstRunSelection();
    return;
  }
  const fallbackVersion = DEFAULT_PROFILE_MC_VERSION;
  const s = getSettings();
  const profile = {
    id: DEFAULT_PROFILE_ID,
    name: "Default",
    mcVersion: fallbackVersion,
    memoryGB: Math.max(1, Math.min(32, Number(s.memoryGB) || 4)),
    width: Math.max(640, Math.min(7680, Number(s.mcResolutionWidth) || 1280)),
    height: Math.max(480, Math.min(4320, Number(s.mcResolutionHeight) || 720)),
    fullscreen: !!s.mcFullscreen,
    isDefault: true,
    createdAt: new Date().toISOString(),
  };
  list.unshift(profile);
  saveProfiles(list);
  try {
    fs.mkdirSync(path.join(getProfileRoot(DEFAULT_PROFILE_ID), "mods"), { recursive: true });
    fs.mkdirSync(path.join(getProfileRoot(DEFAULT_PROFILE_ID), "resourcepacks"), { recursive: true });
    fs.mkdirSync(path.join(getProfileRoot(DEFAULT_PROFILE_ID), "shaderpacks"), { recursive: true });
  } catch (_) {}
  ensureFirstRunSelection();
}

// 24-134차: "클라 처음키면 디폴트 골라지게 해주고 / 전에 내가 고른 프로필이 있는 상태로
// 껐다키면 그걸로 자동 선택"
// launch_mode 와 selected_profile_id 는 원래부터 electron-store 에 저장돼서 껐다 켜도
// 그대로 유지됨(= 마지막에 고른 게 자동 선택됨). 문제는 "한 번도 고른 적이 없는" 새 설치에서
// launch_mode 가 비어 있어 기본값 "server" 로 떨어졌다는 것. 그래서 처음 켰을 때는 서버가
// 골라진 상태로 시작했음. 이제 아직 아무것도 고른 적이 없을 때만 Default 프로필을 골라준다
// (한 번이라도 고른 적이 있으면 이 함수는 아무 일도 안 함 - 사용자의 선택이 항상 우선).
function ensureFirstRunSelection() {
  if (store.get("launch_mode") !== undefined) return;
  store.set("launch_mode", "profile");
  store.set("selected_profile_id", DEFAULT_PROFILE_ID);
  logToFile("[첫 실행] Default 프로필을 선택된 상태로 시작합니다");
}

// 24-135차: "그리고 아직도 디폴트가 1.20.1이잖아"
// ensureDefaultProfile()은 "Default 가 없을 때만" 만들기 때문에, 코드의
// DEFAULT_PROFILE_MC_VERSION 을 고쳐도 이미 저장돼 있던 Default 기록(%APPDATA%/NovaClient/
// config.json)은 그대로 남았음. 실제로 사용자 PC의 Default 는 1.0.7 시절(2026-09-08)에
// 1.20.1 로 만들어진 것이 재설치를 거쳐도 계속 쓰이고 있었음.
// 그래서 한 번만 돌면서 Default 프로필의 버전을 지금 기준값으로 맞춰줌.
//  · 딱 한 번만 실행됨(store 플래그) -> 그 뒤에 사용자가 Default 버전을 직접 바꾸면 그대로 존중
//  · Default 가 아닌 프로필은 건드리지 않음
const DEFAULT_PROFILE_VERSION_FIX_KEY = "default_profile_version_fixed_to_" + DEFAULT_PROFILE_MC_VERSION;
function migrateDefaultProfileVersion() {
  try {
    if (store.get(DEFAULT_PROFILE_VERSION_FIX_KEY)) return;
    store.set(DEFAULT_PROFILE_VERSION_FIX_KEY, true);

    const list = getProfiles();
    const idx = list.findIndex((p) => p.id === DEFAULT_PROFILE_ID);
    if (idx < 0) return;
    const before = list[idx].mcVersion;
    if (String(before) === String(DEFAULT_PROFILE_MC_VERSION)) return;

    list[idx] = { ...list[idx], mcVersion: DEFAULT_PROFILE_MC_VERSION };
    saveProfiles(list);
    logToFile(`[Default 프로필] 버전 보정: ${before} -> ${DEFAULT_PROFILE_MC_VERSION}`);
    notifyRenderer(
      `Default 프로필 버전을 ${DEFAULT_PROFILE_MC_VERSION}로 맞췄어요.`,
      "info"
    );
  } catch (err) {
    logToFile("[Default 프로필] 버전 보정 실패: " + (err?.message || err));
  }
}

// 지원 버전 목록 (mods/resourcepacks 폴더 안에 실제로 존재하는 버전 폴더 기준)
// 프로필은 로컬에 미리 준비된 모드 폴더가 있어야만 만들 수 있는 게 아니라,
// Fabric이 실제로 지원하는 마인크래프트 버전이면 뭐든 골라서 만들 수 있어야 해요.
// (모드는 프로필 만든 다음 Explore에서 직접 찾아서 넣는 방식)
let cachedFabricVersions = null;
async function fetchFabricSupportedVersions() {
  if (cachedFabricVersions) return cachedFabricVersions;
  try {
    const res = await fetch("https://meta.fabricmc.net/v2/versions/game");
    if (!res.ok) throw new Error("Fabric 버전 목록 조회 실패");
    const list = await res.json();
    // 24-11차: "프리셋 만들 때 고를 수 있는 버전이 너무 적다" - 정식 릴리즈만 걸러내는 건
    // 그대로 두되(스냅샷 등은 제외), 최신 40개로 자르던 걸 120개로 대폭 늘림
    cachedFabricVersions = list
      .filter((v) => v.stable)
      .map((v) => v.version)
      .slice(0, 120);
    return cachedFabricVersions;
  } catch (err) {
    logToFile("Fabric 버전 목록 조회 실패: " + (err?.message || err));
    return null;
  }
}

ipcMain.handle("profiles:list-available-versions", async () => {
  const fabricVersions = await fetchFabricSupportedVersions();
  if (fabricVersions && fabricVersions.length > 0) return fabricVersions;

  // 인터넷이 안 되거나 실패하면, 로컬에 준비된 모드 폴더 이름이라도 보여줌 (최소한의 대비)
  const modsDir = app.isPackaged ? path.join(process.resourcesPath, "mods") : path.join(__dirname, "mods");
  if (!fs.existsSync(modsDir)) return [];
  const entries = await fsp.readdir(modsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
});

ipcMain.handle("profiles:list", () => {
  ensureDefaultProfile();
  const selectedProfileId = store.get("selected_profile_id");
  const mode = store.get("launch_mode") || "server";
  // 24-241차: 끌어서 바꾼 순서(store.profile_order). 거기 없는 새 프로필은 맨 위
  const order = store.get("profile_order");
  const at = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
  const list = getProfiles().map((p, i) => ({ p, i }));
  if (at.size) list.sort((a, b) => (at.has(a.p.id) ? at.get(a.p.id) : -1) - (at.has(b.p.id) ? at.get(b.p.id) : -1) || a.i - b.i);
  return list.map(({ p }) => ({
    ...p,
    selected: mode === "profile" && p.id === selectedProfileId,
    iconUrl: getProfileIconUrl(p.id),
  }));
});

// 프로필 아이콘 파일(있으면)을 찾아서 실제 경로+확장자를 알려줌 (공유 코드에도 쓰임)
function findProfileIconFile(profileId) {
  const dir = getProfileRoot(profileId);
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const p = path.join(dir, `icon.${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

// 프로필 아이콘 파일(있으면)을 앱에서 바로 쓸 수 있는 file:// 경로로 변환
function getProfileIconUrl(profileId) {
  const found = findProfileIconFile(profileId);
  if (found) return "file://" + found.path.replace(/\\/g, "/");
  // 17차: "프로필 사진이 설정 안 되어 있을 때 내 아이콘으로 고정해줘" - 예전엔 기본/프리셋
  // 프로필만 Nova 아이콘으로 대체하고, 일반 커스텀 프로필은 null(빈 이미지)이었음.
  // 이제 아이콘을 안 고른 프로필은 전부 예외 없이 Nova 앱 아이콘을 기본값으로 씀
  // (findProfileIconFile이 위에서 먼저 걸러주므로, 유저가 직접 아이콘을 고르면 그 파일이 항상 우선함)
  return "file://" + path.join(__dirname, "build", "icon.png").replace(/\\/g, "/");
}

// 프로필 아이콘 고르기 (파일 선택 -> 프로필 폴더에 icon.확장자로 복사)
ipcMain.handle("profiles:set-icon", async (_e, profileId) => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "프로필 아이콘 선택",
    // 11차: "파일 추가할 때 폴더 열리는 게 다운로드로 가게 해줘" - 기본으로 열리는 위치를 다운로드 폴더로 통일
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const dir = getProfileRoot(profileId);
    await fsp.mkdir(dir, { recursive: true });

    // 예전에 다른 확장자로 저장된 아이콘이 있으면 지움 (아이콘은 하나만 유지)
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      await fsp.unlink(path.join(dir, `icon.${ext}`)).catch(() => {});
    }

    const srcPath = result.filePaths[0];
    const ext = path.extname(srcPath).replace(".", "").toLowerCase() || "png";
    const destPath = path.join(dir, `icon.${ext}`);
    await fsp.copyFile(srcPath, destPath);

    return { ok: true, iconUrl: "file://" + destPath.replace(/\\/g, "/") };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 17차 신규: "프로필 사진 없앨 수 있게 해줘" - 직접 고른 아이콘 파일을 지워서 기본(Nova) 아이콘으로 되돌림
ipcMain.handle("profiles:remove-icon", async (_e, profileId) => {
  try {
    const dir = getProfileRoot(profileId);
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      await fsp.unlink(path.join(dir, `icon.${ext}`)).catch(() => {});
    }
    return { ok: true, iconUrl: getProfileIconUrl(profileId) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 15차: 새 프로필 만들기(커스텀 프로필) 화면에서 프로필이 생기기도 전에 아이콘부터 미리
// 고를 수 있게, 파일 선택만 해서 경로를 돌려주고 실제 복사는 profiles:create에서 함
ipcMain.handle("profiles:pick-icon-temp", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "프로필 아이콘 선택",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  return { ok: true, filePath, previewUrl: "file://" + filePath.replace(/\\/g, "/") };
});

ipcMain.handle("profiles:select", (_e, profileId) => {
  const found = findProfile(profileId);
  if (!found) return { ok: false, error: "존재하지 않는 프로필이에요." };
  store.set("selected_profile_id", profileId);
  store.set("launch_mode", "profile"); // 프로필을 고르면 서버 선택은 자동으로 풀림
  return { ok: true, profile: found };
});

ipcMain.handle("launch:get-mode", () => store.get("launch_mode") || "server");

ipcMain.handle("profiles:create", async (_e, { name, mcVersion, memoryGB, width, height, fullscreen, jvmArgs, loader, iconTempPath, description }) => {
  try {
    const id = generateProfileId();
    const profileRoot = getProfileRoot(id);
    await fsp.mkdir(path.join(profileRoot, "mods"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "resourcepacks"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "shaderpacks"), { recursive: true });

    // 15차: 새 프로필 만들기 화면에서 미리 골라둔 아이콘이 있으면(profiles:pick-icon-temp)
    // 여기서 profiles:set-icon과 같은 방식으로 프로필 폴더에 복사해둠
    if (iconTempPath) {
      try {
        const ext = path.extname(iconTempPath).replace(".", "").toLowerCase() || "png";
        await fsp.copyFile(iconTempPath, path.join(profileRoot, `icon.${ext}`));
      } catch (err) {
        logToFile("새 프로필 아이콘 복사 실패: " + (err?.message || err));
      }
    }

    // 프로필은 완전히 빈 상태로 시작함. 서버 전용 모드/리소스팩(예: 너굴마을)은
    // 서버 접속 모드에서만 자동 적용되고, 프로필에는 절대 섞여 들어가지 않음
    // (같은 버전으로 프로필을 여러 개 만들 수 있으니, 서버용 모드가 매번 자동으로
    //  끼어들면 프로필들이 서로 의도치 않게 얽히게 됨). 모드/리소스팩/쉐이더는
    // 유저가 "파일에서 추가" 버튼으로 직접 넣어야 함 - 단, 프리셋을 골랐으면 예외.

    // 15차: "바닐라로 할건지 패브릭으로 할 건지" - 프로필별로 로더를 고를 수 있게 됨.
    // 기존 프로필들(loader 필드가 아예 없음)은 예전 그대로 항상 Fabric으로 취급됨
    // (launch:start에서 loader === "vanilla"일 때만 Fabric 준비 단계를 건너뜀)
    // 24-2차: Forge/NeoForge 지원 추가 - loader가 4개 값 중 하나인지 확인(화이트리스트),
    // 알 수 없는 값이면 예전처럼 안전하게 fabric으로 처리
    const validLoaders = ["vanilla", "fabric", "forge", "neoforge"];
    // 24-27차: 이 화면(새 프로필 만들기)은 메모리/해상도/전체화면을 안 물어봐서 매번
    // width/height/fullscreen/memoryGB가 undefined로 들어옴 - 예전엔 그래서 항상
    // 1280/720/false/4로 하드코딩된 기본값을 썼는데, 그게 설정 화면 값과 무관하게 고정돼
    // 있어서 "설정을 바꿔도 프로필로 실행하면 반영이 안 된다"는 원인이었음. 값이 안 왔을
    // 때의 기본값을 설정 화면(getSettings())에서 가져오도록 바꿔서, 새로 만드는 프로필은
    // 항상 지금 설정 화면과 같은 값으로 시작하게 함(위 ensureDefaultProfile과 동일한 이유)
    const settingsForDefaults = getSettings();
    const profile = {
      id,
      name: name?.trim() || "새 프로필",
      mcVersion,
      loader: validLoaders.includes(loader) ? loader : "fabric",
      memoryGB: Math.max(1, Math.min(32, Number(memoryGB) || Number(settingsForDefaults.memoryGB) || 4)),
      width: Math.max(640, Math.min(7680, Number(width) || Number(settingsForDefaults.mcResolutionWidth) || 1280)),
      height: Math.max(480, Math.min(4320, Number(height) || Number(settingsForDefaults.mcResolutionHeight) || 720)),
      fullscreen: fullscreen !== undefined ? !!fullscreen : !!settingsForDefaults.mcFullscreen,
      jvmArgs: String(jvmArgs || "").trim(),
      description: String(description || "").slice(0, 300), // 17차 신규
      createdAt: new Date().toISOString(),
    };

    // 24-94차: 프리셋 기능 삭제 - 여기 있던 "프리셋 파일 복사/버전 변환" 분기를 뺌.
    // (예전에 프리셋으로 만든 프로필의 fromPreset 공유 제한 규칙은 그대로 둠)

    const list = getProfiles();
    list.push(profile);
    // 24-93차: 방금 만든 p_... 폴더를 프로필 이름으로 옮김(applyProfileFolderName 주석 참고)
    applyProfileFolderName(profile, list);
    saveProfiles(list);

    // 10-5: 앱 시작 때 하던 것처럼, 새 프로필을 만들 때도 그 버전에 맞는 자바를
    // 조용히 미리 받아둠 (실행 버튼을 눌렀을 때 처음부터 기다리지 않도록). 실패해도
    // 실제 실행 시 다시 시도되니 결과를 기다리지 않고 그냥 백그라운드로 흘려보냄
    prefetchAssetsForProfile(profile).catch((err) => {
      logToFile("새 프로필 자바 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
    });

    return { ok: true, profile };
  } catch (err) {
    logToFile("프로필 생성 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("profiles:update", (_e, { id, ...partial }) => {
  const list = getProfiles();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "존재하지 않는 프로필이에요." };

  // 17차: "디폴트는 이름 변경 불가능하게 해줘" - 기본 프로필의 이름만 수정 시도를 조용히 무시
  if (partial.name !== undefined && !list[idx].isDefault) {
    const before = list[idx].name;
    list[idx].name = String(partial.name).trim() || list[idx].name;
    // 24-93차: 이름이 바뀌면 폴더 이름도 따라감(게임 실행 중이면 다음 기회로 미룸)
    if (list[idx].name !== before) applyProfileFolderName(list[idx], list);
  }
  if (partial.memoryGB !== undefined) list[idx].memoryGB = Math.max(1, Math.min(32, Number(partial.memoryGB) || 4));
  if (partial.width !== undefined) list[idx].width = Number(partial.width) || 1280;
  if (partial.height !== undefined) list[idx].height = Number(partial.height) || 720;
  if (partial.fullscreen !== undefined) list[idx].fullscreen = !!partial.fullscreen;
  if (partial.jvmArgs !== undefined) list[idx].jvmArgs = String(partial.jvmArgs || "").trim();
  // 2-4(7차): 공유받은(불러온) 프로필의 "업데이트 연동" 켜기/끄기
  if (partial.updateSync !== undefined) list[idx].updateSync = !!partial.updateSync;
  // 17차 신규: 프로필 설명(자유 텍스트, 만들 때/수정할 때 모두 입력 가능)
  if (partial.description !== undefined) list[idx].description = String(partial.description || "").slice(0, 300);

  saveProfiles(list);
  return { ok: true, profile: list[idx] };
});

// 5-12(7차): 프로필 설정 모달의 "용량" - 이 프로필 폴더 하나만의 용량 (전체 설치 용량과는 다름,
// getFolderSize/getRoot는 이미 "설치 용량" 기능(app:get-installed-size)에서 쓰던 걸 그대로 재사용)
ipcMain.handle("profiles:get-folder-size", async (_e, id) => {
  try {
    return await getFolderSize(getProfileRoot(id));
  } catch (err) {
    logToFile("프로필 용량 계산 실패: " + (err?.message || err));
    return 0;
  }
});

ipcMain.handle("profiles:delete", async (_e, id) => {
  if (id === DEFAULT_PROFILE_ID) {
    return { ok: false, error: "Default 프로필은 삭제할 수 없어요." };
  }
  const list = getProfiles();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: "존재하지 않는 프로필이에요." };
  const profile = list[idx];
  // 24-93차: 폴더 경로는 목록에서 빼기 **전에** 구해둬야 함. 빼고 나서 getProfileRoot(id)를
  // 부르면 이 프로필을 못 찾아 id 폴더(p_...)를 가리키게 되고, 이름으로 된 진짜 폴더는
  // 지워지지 않고 그대로 남아버림.
  const profileDir = path.join(getProfilesDir(), currentProfileFolder(profile));

  list.splice(idx, 1);
  saveProfiles(list);
  unlinkProfileFromServers(id); // 24-94차: 이 프로필로 들어가던 서버 연결도 해제

  if (store.get("selected_profile_id") === id) {
    store.delete("selected_profile_id");
    store.set("launch_mode", "server");
  }

  // 공유 코드를 만든 적이 있으면, 서버에 남은 코드/파일도 같이 정리함 (실패해도 삭제 자체는 진행)
  if (profile.shareCode) {
    try {
      const code = profile.shareCode;
      // 실제로 올라간 파일 경로들을 정확히 알아야 지울 수 있어서, 먼저 행을 조회함
      const rows = await supabaseFetch(`/shared_profiles?code=eq.${code}&select=*`);
      const shared = rows[0];
      if (shared) {
        const paths = [];
        for (const kind of ["mods", "resourcepacks", "shaderpacks"]) {
          const kindKey = kind === "mods" ? "mod_files" : kind === "resourcepacks" ? "resourcepack_files" : "shader_files";
          for (const f of shared[kindKey] || []) paths.push(`${code}/${kind}/${f}`);
        }
        if (shared.icon_file) paths.push(`${code}/${shared.icon_file}`);
        // 24-100차: 설정 묶음(zip)과 meta도 같이 정리
        const meta = await fetchShareMeta(code);
        if (meta?.novaSettings?.file) paths.push(`${code}/${meta.novaSettings.file}`);
        if (meta?.configs?.file) paths.push(`${code}/${meta.configs.file}`);
        paths.push(`${code}/${SHARE_META_FILE}`);
        if (paths.length > 0) {
          await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/shared-profile-files`, {
            method: "DELETE",
            headers: supabaseHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ prefixes: paths }),
          });
        }
      }
      await supabaseFetch(`/shared_profiles?code=eq.${code}`, { method: "DELETE" });
    } catch (err) {
      logToFile("공유 코드/파일 삭제 실패: " + (err?.message || err));
    }
  }

  try {
    // 안전장치: profiles 폴더 자체나 Default 폴더는 절대 지우지 않음
    const profilesDir = path.resolve(getProfilesDir());
    const target = path.resolve(profileDir);
    if (
      path.dirname(target) === profilesDir &&
      path.basename(target).toLowerCase() !== DEFAULT_PROFILE_ID
    ) {
      await fsp.rm(target, { recursive: true, force: true });
    } else {
      logToFile("프로필 폴더 삭제 건너뜀(안전장치): " + target);
    }
  } catch (err) {
    logToFile("프로필 폴더 삭제 실패: " + (err?.message || err));
  }
  return { ok: true };
});

ipcMain.handle("profiles:open-folder", (_e, id) => {
  const dir = getProfileRoot(id);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});

// 5-8(5차): "아이콘 설정돼있으면 그걸로 해줘" - Windows 바로가기는 .ico(또는 exe/dll) 경로만
// 아이콘으로 받아줘서, 프로필 아이콘이 보통 png/jpg/webp로 저장돼 있는 것과 맞지 않음.
// 여기서는 무거운 이미지 변환 라이브러리를 새로 추가하지 않고, "최신 ICO 컨테이너는 이미지
// 하나를 PNG 그대로(압축된 채) 담을 수 있다"는 ICO 포맷 자체의 특성을 이용해서 PNG를 그대로
// ICO로 감싸는 방식으로 진짜 변환을 함(리사이즈는 아니고 컨테이너 포맷만 바꾸는 것).
// - PNG가 아니면(jpg/webp) 이 방식으로 감쌀 수 없으므로 변환 안 함
// - width/height가 256을 넘으면(ICO 헤더가 크기를 1바이트로만 표현해서 0=256이 최대) 안전하게
//   변환을 포기함 - 리사이즈까지 하려면 이미지 처리 라이브러리가 필요해서(sharp 등) 이번엔 안 함
// 두 경우 다 앱 기본 아이콘으로 조용히 폴백하고, 결과 객체에 iconFallback 사유를 같이 내려줌
// 24-109차: "바탕화면 바로가기 아이콘이 제대로 적용이 안됨"
// 예전 방식의 문제 3가지:
//  1) PNG를 그대로 ICO 컨테이너에 감싸기만 했음 - Windows 탐색기는 ICO 안의 PNG가 32비트(RGBA)일
//     때만 제대로 그리고, 팔레트/회색조 PNG는 빈 아이콘으로 보이는 일이 있음.
//  2) png가 아닌 아이콘(jpg/webp)이나 256px 초과 이미지는 아예 변환을 포기하고 기본 아이콘으로 폴백.
//  3) 같은 파일 이름(<프로필id>.ico)에 덮어써서, 아이콘을 바꿔도 Windows 아이콘 캐시가 예전
//     그림을 계속 보여줌.
// 이제 nativeImage로 어떤 형식이든 읽어 여러 크기(256/128/64/48/32/16)로 줄인 뒤, 32비트 BMP(DIB)
// 형식으로 직접 ICO를 만든다(추가 라이브러리 없음). 파일 이름에는 내용 해시를 넣어 캐시를 피하고
// 그 프로필의 옛 .ico는 지운다.
const SHORTCUT_ICON_SIZES = [256, 128, 64, 48, 32, 16];

// nativeImage(BGRA 픽셀) 하나를 ICO 안에 들어가는 32비트 DIB 한 덩어리로
function bgraToIcoDib(bitmap, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);        // biSize
  header.writeInt32LE(size, 4);       // biWidth
  header.writeInt32LE(size * 2, 8);   // biHeight (XOR + AND 마스크라 2배로 적는 것이 ICO 규칙)
  header.writeUInt16LE(1, 12);        // biPlanes
  header.writeUInt16LE(32, 14);       // biBitCount
  header.writeUInt32LE(0, 16);        // biCompression = BI_RGB
  const rowBytes = size * 4;
  const xor = Buffer.alloc(rowBytes * size);
  // DIB은 아래에서 위로 쌓이므로 행 순서를 뒤집어 넣음
  for (let y = 0; y < size; y++) {
    bitmap.copy(xor, (size - 1 - y) * rowBytes, y * rowBytes, (y + 1) * rowBytes);
  }
  const maskRow = Math.ceil(size / 32) * 4; // AND 마스크는 1bpp, 행마다 4바이트 정렬
  const mask = Buffer.alloc(maskRow * size); // 전부 0 = 알파 채널을 그대로 씀
  header.writeUInt32LE(xor.length + mask.length, 20); // biSizeImage
  return Buffer.concat([header, xor, mask]);
}

// 아이콘 이미지 파일(png/jpg/webp 무엇이든) → 여러 크기가 들어간 ICO 버퍼
function buildIcoFromImageFile(imagePath) {
  const img = nativeImage.createFromPath(imagePath);
  if (!img || img.isEmpty()) return null;
  const images = [];
  for (const size of SHORTCUT_ICON_SIZES) {
    const resized = img.resize({ width: size, height: size, quality: "best" });
    const bitmap = resized.toBitmap(); // BGRA
    if (!bitmap || bitmap.length < size * size * 4) continue;
    images.push({ size, data: bgraToIcoDib(bitmap, size) });
  }
  if (!images.length) return null;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);             // type: 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const im of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(im.size === 256 ? 0 : im.size, 0); // 256은 0으로 적는 것이 규칙
    e.writeUInt8(im.size === 256 ? 0 : im.size, 1);
    e.writeUInt8(0, 2);                 // 팔레트 색 수
    e.writeUInt8(0, 3);                 // reserved
    e.writeUInt16LE(1, 4);              // planes
    e.writeUInt16LE(32, 6);             // bpp
    e.writeUInt32LE(im.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += im.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((im) => im.data)]);
}

// 프로필 아이콘을 바로가기용 .ico로 만들어 경로를 돌려줌. 못 만들면 null + 사유
function makeShortcutIconForProfile(profileId) {
  const found = findProfileIconFile(profileId);
  // 24-143차: "프로필 설정 안해서 기본 로고일 때 바로가기 아이콘이 적용이 안되고"
  // 예전엔 사진을 안 넣은 프로필이면 여기서 그냥 손을 떼고, 바로가기 아이콘을
  // process.execPath(런처 exe에 박힌 아이콘)에 맡겼음. 그런데 탐색기는 exe 경로 기준으로
  // 아이콘을 캐시해서, 한 번 엉뚱하게 잡히면 계속 그 그림을 씀(= 아이콘이 안 바뀜).
  // 이제 사진이 없으면 런처 화면이 쓰는 것과 같은 기본 로고(build/icon.png)를 ico 로 구워서
  // 프로필 아이콘과 똑같은 경로(내용 해시 파일명)로 넘김 - 캐시 문제도 같이 사라짐.
  const sourceIconPath = found ? found.path : path.join(__dirname, "build", "icon.png");
  const isDefaultLogo = !found;
  try {
    if (!fs.existsSync(sourceIconPath)) return { icoPath: null, reason: null };
    const icoBuf = buildIcoFromImageFile(sourceIconPath);
    if (!icoBuf) {
      return {
        icoPath: null,
        reason: isDefaultLogo ? null : "프로필 아이콘 이미지를 읽지 못해서 기본 아이콘으로 만들었어요",
      };
    }
    const icoDir = path.join(app.getPath("userData"), "shortcut-icons");
    fs.mkdirSync(icoDir, { recursive: true });
    // 내용 해시를 파일 이름에 넣음 - 같은 이름에 덮어쓰면 Windows 아이콘 캐시가 옛 그림을 계속 씀
    const hash = crypto.createHash("sha1").update(icoBuf).digest("hex").slice(0, 8);
    // 기본 로고는 어느 프로필이든 같은 그림이라 프로필별로 따로 굽지 않고 하나를 같이 씀.
    // ⚠️ 이름을 "default-..." 로 하면 안 됨 - 기본 프로필의 id 가 실제로 "default" 라서,
    //    아래 "이 프로필의 옛 아이콘 정리" 루프(`${profileId}-` 로 시작하는 파일 삭제)가
    //    다른 프로필들이 같이 쓰는 이 공용 아이콘을 지워버림. 프로필 id 와 안 겹치는
    //    이름("_logo-")을 씀
    const icoPath = path.join(icoDir, isDefaultLogo ? `_logo-${hash}.ico` : `${profileId}-${hash}.ico`);
    if (!fs.existsSync(icoPath)) fs.writeFileSync(icoPath, icoBuf);
    // 이 프로필의 옛 아이콘 파일 정리
    for (const f of fs.readdirSync(icoDir)) {
      if (f.startsWith(`${profileId}-`) && f !== path.basename(icoPath)) {
        try { fs.unlinkSync(path.join(icoDir, f)); } catch (_) {}
      }
      if (f === `${profileId}.ico`) { try { fs.unlinkSync(path.join(icoDir, f)); } catch (_) {} } // 옛 방식 파일
    }
    return { icoPath, reason: null };
  } catch (err) {
    return { icoPath: null, reason: `아이콘 변환 중 오류: ${String(err?.message || err)}` };
  }
}

// 10-3: 바탕화면에 이 프로필로 바로 켜지는 바로가기 생성 (Windows 전용 - Electron API 자체가 그렇게 돼있음)
ipcMain.handle("profiles:create-shortcut", (_e, id) => {
  if (process.platform !== "win32") {
    return { ok: false, error: "바탕화면 바로가기는 지금 Windows에서만 만들 수 있어요." };
  }
  const profile = findProfile(id);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  try {
    const desktopDir = app.getPath("desktop");
    const safeName = profile.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "프로필";
    const shortcutPath = path.join(desktopDir, `Nova Client - ${safeName}.lnk`);
    const { icoPath, reason: iconFallback } = makeShortcutIconForProfile(id);
    // 24-109차: 같은 자리에 덮어쓰면 탐색기가 예전 아이콘을 그대로 들고 있는 일이 있어서,
    // 이미 있으면 지우고 새로 만듦
    try { if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath); } catch (_) {}
    const ok = shell.writeShortcutLink(shortcutPath, "create", {
      target: process.execPath,
      args: `--nova-profile=${id}`,
      description: `Nova Client - ${profile.name} 프로필로 실행`,
      icon: icoPath || process.execPath,
      iconIndex: 0,
    });
    if (!ok) throw new Error("바로가기 파일을 쓰지 못했어요.");
    return { ok: true, path: shortcutPath, usedCustomIcon: !!icoPath, iconFallback };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 프로필 안 모드/리소스팩/쉐이더 목록 (유저가 직접 넣은 것도 자동으로 다 보임)
// 각 항목에 이름/활성화 여부/제작자/아이콘/버전 고정 여부/수정 시각까지 같이 내려줌
// (비활성화된 파일은 확장자 뒤에 ".disabled"가 붙은 채로 폴더에 남아있는 방식)
ipcMain.handle("profiles:list-files", async (_e, { id, kind }) => {
  const dir = path.join(getProfileRoot(id), kind); // kind: "mods" | "resourcepacks" | "shaderpacks"
  if (!fs.existsSync(dir)) return [];
  const ext = kind === "mods" ? ".jar" : ".zip";
  // 24-150차: 팩은 .disabled 이름 대신 .nova-packs-off.json 으로 관리 - 옛날 파일은 여기서 옮김
  const profileRoot = getProfileRoot(id);
  await migratePackDisabledNames(profileRoot, kind);
  const packOff = PACK_KINDS.has(kind) ? await getPackOffList(profileRoot, kind) : null;
  // 24-161차: 너굴마을 프로필이면 허용 목록에 없는 모드를 목록에서도 표시해줌
  const neogulProfile = kind === "mods" && isProfileLinkedToNeogul(id);
  const rawFiles = await fsp.readdir(dir);
  const meta = await readModMeta(getProfileRoot(id), kind);

  const results = [];
  for (const f of rawFiles) {
    // 25차: 노바 내장 모드 / 24-46차: 자동 주입되는 Fabric API - 둘 다 유저가 관리하는
    // 모드가 아니므로 관리 화면 목록에서 숨김
    if (kind === "mods" && isHiddenModFileName(f)) continue;
    const lower = f.toLowerCase();
    let enabled, baseExtMatches;
    if (lower.endsWith(ext + ".disabled")) {
      enabled = false;
      baseExtMatches = true;
    } else if (lower.endsWith(ext)) {
      enabled = true;
      baseExtMatches = true;
    } else {
      baseExtMatches = false;
    }
    if (!baseExtMatches) continue;
    // 24-150차: 팩은 파일 이름이 아니라 끈 목록으로 판정(끄더라도 게임 목록에는 계속 보임)
    if (packOff) enabled = !packOff.includes(f);

    let mtimeMs = 0;
    try {
      mtimeMs = (await fsp.stat(path.join(dir, f))).mtimeMs;
    } catch (_) {}

    const m = meta[f] || null;
    results.push({
      fileName: f,
      enabled,
      mtimeMs,
      title: m?.title || null,
      author: m?.author || null,
      icon: m?.icon || null,
      projectId: m?.projectId || null,
      pinned: !!m?.pinned,
      // 5-9(5차): 관리 화면 표 재구성에서 "버전" 열에 실제 버전 문자열을 보여주기 위함
      versionNumber: m?.versionNumber || null,
      // 24-161차: 너굴마을 허용 목록에 없어서 켤 수 없는 모드
      neogulBlocked: neogulProfile ? !isNeogulAllowedMod(f, m) : false,
    });
  }
  return results;
});

// "직접 추가" 버튼: 파일 선택 대화상자로 복사해오는 대신, 그 종류(모드/리소스팩/쉐이더)
// 폴더를 탐색기로 바로 열어줘서 유저가 원하는 파일을 자유롭게 넣었다 뺐다 할 수 있게 함
ipcMain.handle("profiles:add-file", async (_e, { id, kind }) => {
  const destDir = path.join(getProfileRoot(id), kind); // kind: "mods" | "resourcepacks" | "shaderpacks"
  await fsp.mkdir(destDir, { recursive: true });
  shell.openPath(destDir);
  return { ok: true, opened: true };
});

// ----------------------------------------------------------------------------
// 24-83차 신규: 런처 UI 글꼴 (설정 > 폰트)
// "그 설정에서 폰트란 하나 만들어줘서 거기에 폰트 고를 수 있게 해주고"
// 고른 폰트 파일은 앱 데이터 폴더(fonts/)로 복사해둠 - 원본을 지우거나 옮겨도 런처가
// 계속 그 글꼴을 쓸 수 있게 하려는 것(바탕화면에 있던 파일을 고르는 경우가 많아서).
// ----------------------------------------------------------------------------
function getUiFontsDir() {
  return path.join(app.getPath("userData"), "fonts");
}

ipcMain.handle("settings:pick-ui-font", async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "런처에서 쓸 글꼴 고르기",
      properties: ["openFile"],
      filters: [{ name: "폰트", extensions: ["ttf", "otf", "woff", "woff2"] }],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false };

    const srcPath = res.filePaths[0];
    const dir = getUiFontsDir();
    await fsp.mkdir(dir, { recursive: true });
    const destPath = path.join(dir, path.basename(srcPath));
    await fsp.copyFile(srcPath, destPath);

    const merged = setSettings({
      uiFont: "custom",
      uiFontPath: destPath,
      uiFontName: path.parse(srcPath).name,
    });
    logToFile(`[글꼴] 사용자 글꼴로 변경: ${merged.uiFontName}`);
    return { ok: true, settings: merged };
  } catch (err) {
    logToFile("[글꼴] 고르기 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 기본 글꼴(SUIT)로 되돌리기 - 복사해둔 파일은 굳이 지우지 않음(다시 고르면 그대로 재사용)
ipcMain.handle("settings:use-default-ui-font", async () => {
  const merged = setSettings({ uiFont: "default" });
  return { ok: true, settings: merged };
});

// ----------------------------------------------------------------------------
// 24-83차 신규: 리소스팩/폰트 만들기
// "내가 만약 폰트를 넣으면 그 폰트를 리소스팩으로 만들어서 그 프로필에 넣어주고 리소스팩을
//  넣으면 그 프로필에 맞는 버전, 파일 형식으로 바꿔서 넣어주는 걸 만들어줘"
//
// 마인크래프트 리소스팩은 zip 안에 pack.mcmeta(JSON)가 있어야 하고, 그 안의 pack_format
// 숫자가 그 마인크래프트 버전과 맞아야 게임이 "호환됨"으로 인식합니다(안 맞으면 목록에서
// 빨간 경고와 함께 "구버전/신버전 팩"으로 뜸). 이 숫자는 버전마다 다릅니다.
// ----------------------------------------------------------------------------

// 마인크래프트 버전 -> "리소스팩" pack_format.
// ⚠️ 데이터팩(datapack) 형식 번호와는 완전히 다른 표입니다. 둘을 섞으면 게임이 팩을
//    "이 버전용이 아님"으로 보고 빨간 경고를 띄웁니다.
// 큰 버전부터 내려가며 처음 매칭되는 걸 씀(표에 딱 맞는 줄이 없으면 가장 가까운 하위 값).
const RESOURCE_PACK_FORMATS = [
  // [비교용 시작 버전, 리소스팩 pack_format] - 버전 비교는 아래 compareMcVersions로 함
  ["26.2", 88],
  ["26.1", 84],
  ["1.21.11", 75],
  ["1.21.9", 69],
  ["1.21.7", 64],
  ["1.21.6", 63],
  ["1.21.5", 55],
  ["1.21.4", 46],
  ["1.21.2", 42],
  ["1.21", 34],
  ["1.20.5", 32],
  ["1.20.3", 22],
  ["1.20.2", 18],
  ["1.20", 15],
  ["1.19.4", 13],
  ["1.19.3", 12],
  ["1.19", 9],
  ["1.18", 8],
  ["1.17", 7],
  ["1.16.2", 6],
  ["1.15", 5],
  ["1.13", 4],
  ["1.11", 3],
  ["1.9", 2],
  ["1.6", 1],
];

// 1.21.9(리소스팩 형식 69)부터 pack.mcmeta 구조가 바뀌었습니다.
//  - min_format / max_format 이 필수가 됨(정수 또는 [major, minor] 배열)
//  - pack_format 은 선택이 되었고, 65 미만의 옛 형식까지 함께 지원한다고 적을 때만 남김
//  - 1.20.2에 생겼던 supported_formats 는 1.21.9에서 없어짐
// 그래서 목표 버전에 따라 두 가지 모양 중 하나로 씁니다.
const MODERN_PACK_META_FROM = 65;

function isModernPackMeta(packFormat) {
  return packFormat >= MODERN_PACK_META_FROM;
}

// pack.mcmeta 안의 "pack" 객체를 만듦.
// basePack을 주면(리소스팩 변환) 원본의 다른 항목(filter, overlays 등)은 그대로 두고
// 형식/설명 관련 항목만 갈아끼웁니다.
function buildPackMetaPack(packFormat, description, basePack) {
  const pack = { ...(basePack || {}) };
  delete pack.pack_format;
  delete pack.supported_formats;
  delete pack.min_format;
  delete pack.max_format;

  if (isModernPackMeta(packFormat)) {
    // 24-91차: [형식, 0] 으로 적으면 "마이너 0만" 이라는 뜻이라, 같은 버전의 자잘한 갱신
    // (75.1 등)에서 "옛 버전용 팩" 경고가 뜹니다. 정수로 적으면 min은 [형식, 0],
    // max는 그 형식의 모든 마이너로 해석돼서 딱 원하는 범위가 됩니다.
    pack.min_format = packFormat;
    pack.max_format = packFormat;
  } else {
    pack.pack_format = packFormat;
  }
  pack.description = description;
  return pack;
}

// "1.21.10" 같은 버전 문자열을 숫자 배열로 바꿔 비교(1.21.10 > 1.21.9 가 되도록 - 문자열
// 비교로는 "1.21.10" < "1.21.9"가 되어버림)
function compareMcVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function packFormatForMcVersion(mcVersion) {
  const v = String(mcVersion || "").trim();
  if (!v) return 15; // 버전을 못 읽으면 1.20 기준으로 둠
  for (const [from, fmt] of RESOURCE_PACK_FORMATS) {
    if (compareMcVersions(v, from) >= 0) return fmt;
  }
  return 1;
}

// 1.20(23w17a)부터 폰트 정의에서 "reference" 제공자로 바닐라 글리프를 그대로 끌어올 수 있음.
// 그 전 버전에는 이 기능이 없어서, 커스텀 TTF만 넣으면 그 폰트에 없는 문자는 안 나옴.
function fontPackSupportsReference(mcVersion) {
  return compareMcVersions(mcVersion, "1.20") >= 0;
}

// 24-91차 버그 수정: "리소스팩 폰트 만들기가 폰트가 제대로 안나오는데??"
//
// 마인크래프트의 리소스 위치(ResourceLocation)는 **[a-z0-9/._-] 만** 허용합니다.
// 그런데 폰트 파일 이름을 사용자가 고른 그대로 썼기 때문에, 한글이나 대문자가 들어간
// 파일(예: "허니볼드MongHoneyB.ttf")이면 default.json을 읽는 순간 예외가 나면서
// 폰트 정의가 통째로 버려졌습니다 = 아무리 만들어도 글꼴이 안 바뀜.
// 그래서 zip에 넣을 때 이름을 허용 문자만 남기고 바꾸고, default.json도 그 이름을 가리킵니다.
function safeFontResourceName(fileName) {
  const raw = String(fileName || "");
  const ext = (path.extname(raw).toLowerCase() || ".ttf").replace(/[^a-z0-9.]/g, "");
  const base = path
    .basename(raw, path.extname(raw))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_") // 한글·공백·대문자 등 허용되지 않는 문자는 전부 _
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return (base || "nova_font") + (ext || ".ttf");
}

// 파일 이름으로 쓸 수 없는 문자 정리(사용자가 입력한 팩 이름을 파일명으로 쓰기 때문)
// 24-143차: "폰트 리소스팩 제작 같은 이름으로 하면 안되는 거 같은데 확인좀 해주고"
// 확인해보니 정말 문제였음 - 만들어진 zip 을 resourcepacks/<이름>.zip 에 그냥 쓰는데
// 존재 확인이 없어서 AdmZip.writeZip 이 기존 파일을 통째로 덮어썼음. 이름을 비워두면
// 매번 "Nova Pack.zip" 이라 더 쉽게 겹쳤고, 직접 넣어둔 같은 이름의 리소스팩까지 날아갔음.
// 이제 이미 있으면 "이름 (2).zip", "이름 (3).zip" 으로 비켜서 저장함.
function uniquePackPath(destDir, baseName) {
  let candidate = path.join(destDir, baseName + ".zip");
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    candidate = path.join(destDir, `${baseName} (${i}).zip`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  // 극단적인 경우엔 시각을 붙여서라도 겹치지 않게
  return path.join(destDir, `${baseName} ${Date.now().toString(36)}.zip`);
}

function safePackFileName(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Nova Pack";
}

// 폰트 파일 하나로 "그 폰트를 쓰는 리소스팩" zip을 만들어 프로필에 넣음
async function buildFontResourcePack({ profile, sourcePath, name, description, iconPath, fontSize }) {
  const mcVersion = profile.mcVersion;
  const packFormat = packFormatForMcVersion(mcVersion);
  const fontFileName = path.basename(sourcePath);
  const ext = path.extname(fontFileName).toLowerCase();
  if (![".ttf", ".otf"].includes(ext)) {
    return { ok: false, error: "폰트는 .ttf 또는 .otf 파일만 넣을 수 있어요." };
  }

  const zip = new AdmZip();

  // pack.mcmeta - 설명은 사용자가 적은 걸 그대로 씀
  zip.addFile(
    "pack.mcmeta",
    Buffer.from(
      JSON.stringify(
        { pack: buildPackMetaPack(packFormat, String(description || name || "Nova 폰트 팩")) },
        null,
        2
      ),
      "utf-8"
    )
  );

  // 아이콘(선택) - 마인크래프트는 팩 목록에서 pack.png를 아이콘으로 보여줌
  if (iconPath) {
    try {
      zip.addFile("pack.png", await fsp.readFile(iconPath));
    } catch (err) {
      logToFile("[팩 만들기] 아이콘을 읽지 못해 건너뜀: " + (err?.message || err));
    }
  }

  // 폰트 파일 자체: assets/minecraft/font/ 아래에 둠.
  // 24-91차: 이름은 리소스 위치 규칙([a-z0-9/._-])에 맞게 바꿔서 넣습니다(위 함수 설명 참고).
  const fontResourceName = safeFontResourceName(fontFileName);
  zip.addFile(`assets/minecraft/font/${fontResourceName}`, await fsp.readFile(sourcePath));

  // 기본 글꼴 정의를 이 폰트로 덮어씀.
  // providers는 앞에 있는 게 우선이라 [내 폰트] -> [바닐라 글리프들] 순으로 둠.
  // reference의 id를 "minecraft:default"로 쓰면 지금 덮어쓰는 중인 자기 자신을 부르는 꼴이라
  // 안 되고, 바닐라가 따로 제공하는 include/* 를 써야 함. 아래 세 줄은 바닐라 default.json의
  // 내용 그대로(띄어쓰기 / 기본 글리프 / 유니폰트 폴백)라, 고른 폰트에 없는 글자는 바닐라와
  // 똑같이 나옴.
  // size는 마인크래프트가 이 TTF를 몇 픽셀 높이로 그릴지(바닐라 기본 글꼴 느낌이 11).
  // 폰트마다 실제 글자가 차지하는 비율이 달라서 사용자가 6~16 사이로 조절할 수 있게 함.
  //
  // ⚠️ 24-91차 버그 수정: file 값에 "font/"를 붙이면 안 됩니다.
  // 마인크래프트의 ttf 제공자는 받은 값 앞에 **스스로 "font/"를 붙여서** 찾습니다
  // (1.21.11 클라이언트 jar의 ttf 정의 클래스 안에 "font/" 문자열이 그대로 들어있는 것을
  //  확인했습니다). 그래서 "minecraft:font/xxx.ttf"라고 적으면 실제로는
  //  assets/minecraft/font/**font/**xxx.ttf 를 찾게 되어 영영 못 찾습니다.
  // 올바른 값은 "minecraft:xxx.ttf" 이고, 파일은 assets/minecraft/font/xxx.ttf 에 둡니다.
  const ttfSize = Math.min(16, Math.max(6, Number(fontSize) || 11));
  const providers = [
    { type: "ttf", file: `minecraft:${fontResourceName}`, size: ttfSize, oversample: 2, shift: [0, 0] },
  ];
  if (fontPackSupportsReference(mcVersion)) {
    providers.push({ type: "reference", id: "minecraft:include/space" });
    providers.push({ type: "reference", id: "minecraft:include/default" });
    providers.push({ type: "reference", id: "minecraft:include/unifont" });
  }
  zip.addFile(
    "assets/minecraft/font/default.json",
    Buffer.from(JSON.stringify({ providers }, null, 2), "utf-8")
  );

  const destDir = path.join(getProfileRoot(profile.id), "resourcepacks");
  await fsp.mkdir(destDir, { recursive: true });
  const destPath = uniquePackPath(destDir, safePackFileName(name));
  zip.writeZip(destPath);

  return {
    ok: true,
    fileName: path.basename(destPath),
    packFormat,
    keptVanillaGlyphs: fontPackSupportsReference(mcVersion),
  };
}

// 이미 있는 리소스팩 zip을 "이 프로필의 버전에 맞게" 고쳐서 넣음.
// 실제로 하는 일:
//  1) pack.mcmeta의 pack_format을 이 프로필 버전 값으로 교체(호환 경고가 사라지는 핵심)
//  2) 팩이 zip 안의 하위 폴더 한 겹에 들어가 있는 흔한 형태를 루트로 펴줌
//     (이러면 마인크래프트가 아예 팩으로 인식조차 못 하는데, 실제로 정말 자주 있는 문제)
//  3) 사용자가 이름/설명/아이콘을 새로 적었으면 그것도 반영
// ⚠️ 버전별로 텍스처 경로/이름이 바뀐 것(예: 1.13 평탄화)까지 바꿔주지는 않음 - 그건 팩 내용
//    자체를 다시 만드는 일이라 자동화 범위 밖. 아래 note로 사용자에게 그대로 알려줌.
async function convertResourcePack({ profile, sourcePath, name, description, iconPath }) {
  const packFormat = packFormatForMcVersion(profile.mcVersion);
  let zip;
  try {
    zip = new AdmZip(sourcePath);
  } catch (err) {
    return { ok: false, error: "리소스팩 zip 파일을 열지 못했어요." };
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0) return { ok: false, error: "zip 안이 비어 있어요." };

  // pack.mcmeta가 루트에 없고 한 겹 안에 있으면, 그 폴더를 루트로 삼음
  let rootPrefix = "";
  const hasRootMeta = entries.some((e) => e.entryName === "pack.mcmeta");
  if (!hasRootMeta) {
    const metaEntry = entries.find((e) => e.entryName.endsWith("/pack.mcmeta"));
    if (metaEntry) {
      rootPrefix = metaEntry.entryName.slice(0, -"pack.mcmeta".length);
    } else {
      return { ok: false, error: "이 zip 안에 pack.mcmeta가 없어요. 리소스팩 파일이 맞는지 확인해주세요." };
    }
  }

  const out = new AdmZip();
  let originalDescription = "";
  for (const e of entries) {
    if (rootPrefix && !e.entryName.startsWith(rootPrefix)) continue;
    const rel = rootPrefix ? e.entryName.slice(rootPrefix.length) : e.entryName;
    if (!rel) continue;
    if (rel === "pack.mcmeta") continue; // 아래에서 새로 씀
    if (rel === "pack.png" && iconPath) continue; // 새 아이콘으로 교체할 거면 원본은 버림
    out.addFile(rel, e.getData());
  }

  // 원본 pack.mcmeta를 읽어둠
  //  - 설명: 사용자가 설명을 비워두면 원본을 그대로 살림
  //  - 나머지 항목(filter, overlays, 최상위 language 등): 팩이 실제로 쓰는 설정이므로 보존.
  //    (여기서 통째로 새로 쓰면 언어 정의가 있는 팩 등이 조용히 망가짐)
  let originalMeta = null;
  try {
    const metaEntry = entries.find((e) => e.entryName === rootPrefix + "pack.mcmeta");
    originalMeta = JSON.parse(metaEntry.getData().toString("utf-8"));
    const d = originalMeta?.pack?.description;
    originalDescription = typeof d === "string" ? d : "";
  } catch (_) {
    /* 원본 mcmeta를 못 읽어도(깨진 JSON 등) 새로 써서 계속 진행 */
  }

  const newMeta = { ...(originalMeta && typeof originalMeta === "object" ? originalMeta : {}) };
  newMeta.pack = buildPackMetaPack(
    packFormat,
    // 원본 description이 문자열이 아니라 JSON 텍스트 컴포넌트(배열/객체)인 팩도 있음 -
    // 사용자가 새 설명을 안 적었으면 그 원본 값을 형태 그대로 살림
    description || originalDescription || originalMeta?.pack?.description || name || "Nova 리소스팩",
    originalMeta?.pack
  );

  out.addFile("pack.mcmeta", Buffer.from(JSON.stringify(newMeta, null, 2), "utf-8"));

  if (iconPath) {
    try {
      out.addFile("pack.png", await fsp.readFile(iconPath));
    } catch (err) {
      logToFile("[팩 만들기] 아이콘을 읽지 못해 건너뜀: " + (err?.message || err));
    }
  }

  const destDir = path.join(getProfileRoot(profile.id), "resourcepacks");
  await fsp.mkdir(destDir, { recursive: true });
  const destPath = uniquePackPath(destDir, safePackFileName(name || path.parse(sourcePath).name));
  out.writeZip(destPath);

  return { ok: true, fileName: path.basename(destPath), packFormat, flattened: !!rootPrefix };
}

// 화면에 "이 프로필이면 pack_format 몇으로 만들어져요"를 미리 보여주기 위한 조회.
// (표를 renderer 쪽에 한 벌 더 두면 나중에 새 마인크래프트 버전이 나올 때 두 군데를 고쳐야
//  해서, 표는 여기 하나만 두고 물어보는 방식으로 함)
ipcMain.handle("packmaker:pack-format", (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false };
  return {
    ok: true,
    mcVersion: profile.mcVersion,
    packFormat: packFormatForMcVersion(profile.mcVersion),
    supportsReference: fontPackSupportsReference(profile.mcVersion),
  };
});

// 만들 원본(폰트 또는 리소스팩 zip) 고르기
ipcMain.handle("packmaker:pick-source", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "폰트 또는 리소스팩 고르기",
    properties: ["openFile"],
    filters: [
      { name: "폰트 또는 리소스팩", extensions: ["ttf", "otf", "zip"] },
      { name: "폰트", extensions: ["ttf", "otf"] },
      { name: "리소스팩", extensions: ["zip"] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  const filePath = res.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  return {
    ok: true,
    filePath,
    fileName: path.basename(filePath),
    kind: ext === ".zip" ? "resourcepack" : "font",
  };
});

// 팩 아이콘(pack.png) 고르기
ipcMain.handle("packmaker:pick-icon", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "팩 아이콘 고르기 (png)",
    properties: ["openFile"],
    filters: [{ name: "이미지", extensions: ["png"] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  return {
    ok: true,
    filePath: res.filePaths[0],
    fileName: path.basename(res.filePaths[0]),
    // 프로필 아이콘 고르기(profiles:pick-icon-temp)와 같은 방식의 미리보기 URL
    previewUrl: "file://" + res.filePaths[0].replace(/\\/g, "/"),
  };
});

ipcMain.handle("packmaker:create", async (_e, { profileId, sourcePath, kind, name, description, iconPath, fontSize }) => {
  try {
    const profile = findProfile(profileId);
    if (!profile) return { ok: false, error: "프로필을 찾지 못했어요." };
    if (!sourcePath) return { ok: false, error: "폰트나 리소스팩 파일을 먼저 골라주세요." };

    const result =
      kind === "font"
        ? await buildFontResourcePack({ profile, sourcePath, name, description, iconPath, fontSize })
        : await convertResourcePack({ profile, sourcePath, name, description, iconPath });

    if (result.ok) {
      logToFile(
        `[팩 만들기] ${kind === "font" ? "폰트 팩" : "리소스팩 변환"} 완료: ${result.fileName} ` +
          `(프로필 ${profile.name} / ${profile.mcVersion} / pack_format ${result.packFormat})`
      );
    }
    return { ...result, mcVersion: profile.mcVersion };
  } catch (err) {
    logToFile("[팩 만들기] 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 10-2: 삭제는 바로 완전히 지우지 않고 .trash 폴더로 옮겨둬서 "실행취소"가 가능하게 함
ipcMain.handle("profiles:remove-file", async (_e, { id, kind, fileName }) => {
  try {
    const profileRoot = getProfileRoot(id);
    const trashDir = path.join(profileRoot, ".trash", kind);
    await fsp.mkdir(trashDir, { recursive: true });
    await fsp.rename(path.join(profileRoot, kind, fileName), path.join(trashDir, fileName));

    // Explore 쪽에서도 "설치 안 됨"으로 바로 반영되도록 메타데이터도 같이 지움
    // (이게 빠져있어서, 관리 화면에서 지운 모드가 Explore에는 여전히 설치된 것처럼 남는 버그가 있었음)
    const meta = await readModMeta(profileRoot, kind);
    if (meta[fileName]) {
      const trashMetaPath = path.join(trashDir, ".nova-trash-meta.json");
      let trashMeta = {};
      try { trashMeta = JSON.parse(await fsp.readFile(trashMetaPath, "utf-8")); } catch (_) {}
      trashMeta[fileName] = meta[fileName];
      await fsp.writeFile(trashMetaPath, JSON.stringify(trashMeta, null, 2), "utf-8");

      delete meta[fileName];
      await writeModMeta(profileRoot, kind, meta);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 10-2: 방금 지운 모드/리소스팩/쉐이더를 되돌림 (실행취소)
ipcMain.handle("profiles:restore-file", async (_e, { id, kind, fileName }) => {
  try {
    const profileRoot = getProfileRoot(id);
    const trashDir = path.join(profileRoot, ".trash", kind);
    await fsp.rename(path.join(trashDir, fileName), path.join(profileRoot, kind, fileName));

    const trashMetaPath = path.join(trashDir, ".nova-trash-meta.json");
    try {
      const trashMeta = JSON.parse(await fsp.readFile(trashMetaPath, "utf-8"));
      if (trashMeta[fileName]) {
        const meta = await readModMeta(profileRoot, kind);
        meta[fileName] = trashMeta[fileName];
        await writeModMeta(profileRoot, kind, meta);
        delete trashMeta[fileName];
        await fsp.writeFile(trashMetaPath, JSON.stringify(trashMeta, null, 2), "utf-8");
      }
    } catch (_) {}

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 24-161차: "너굴마을에 등록할 프로필에 위키에 허용된 모드들 아니면 자동으로 꺼지게 해주고,
//            키려고 하면 '너굴마을에 등록된 프로필은 해당 모드가 사용 불가능합니다' 라고 하자"
//
// 출처: https://mcng.kr/wiki (첫걸음 > 모드설치 > 허용모드)
// 너굴마을 서버는 허용 목록에 없는 모드가 깔려 있으면 아예 입장을 막는다. 그래서 그 서버에
// 연결해둔 프로필에서는
//   · 실행할 때  : 허용 목록에 없는 모드를 자동으로 꺼둔다(.disabled)
//   · 켜려고 할 때: 아래 문구로 막는다
//   · 목록에서   : 막힌 모드임을 표시한다(neogulBlocked)
// 자동 주입되는 Nova 모드 / Fabric API / Mod Menu 는 애초에 목록에서 숨겨진 항목이라 건드리지
// 않는다(isHiddenModFileName).
// ────────────────────────────────────────────────────────────────────────────
const NEOGUL_SERVER_ID = "nugulmaeul";
const NEOGUL_BLOCK_MESSAGE = "너굴마을에 등록된 프로필은 해당 모드가 사용 불가능합니다";

// 위키의 허용 목록 그대로. 괄호 안 별칭(REI, ETF 등)과 "·"로 묶인 항목은 아래에서 각각
// 별도 키로 쪼개진다. 런처/로더(Feather, Lunar, Prism 등)는 모드가 아니라서 뺐다.
const NEOGUL_ALLOWED_MOD_NAMES = [
  // 최적화
  "Sodium", "Sodium Extra", "Reese's Sodium Options", "Lithium", "Entity Culling",
  "ImmediatelyFast", "FerriteCore", "Indium", "Krypton", "C2ME", "Nvidium", "More Culling",
  "ModernFix", "BadOptimizations", "Cull Less Leaves", "Enhanced Block Entities",
  "Better Block Entities", "Neruina", "Ixeris", "Greenlight", "Dynamic FPS", "LazyDFU",
  "Memory Leak Fix", "Debugify", "Smooth Boot", "Force Close Loading Screen", "FastQuit",
  "Model Gap Fix", "Nolijium", "Particle Core", "TexTrue's Embeddium Options",
  // 그래픽 · 셰이더 · 외형
  "Iris Shaders", "Distant Horizons", "Bobby", "Continuity", "LambDynamicLights",
  "LambdaBetterGrass", "Polytone", "Blur", "FabricSkyBoxes", "Entity Texture Features (ETF)",
  "Entity Model Features (EMF)", "Cubes Without Borders", "Borderless Mining",
  "Borderless Fullscreen", "Not Enough Animations", "3D Skin Layers", "Ears", "Capes",
  "Wavey Capes", "Better Third Person", "Boat Camera", "Pride",
  // UI · HUD · 편의
  "Mod Menu", "BetterF3", "Zoomify", "OK Zoomer", "Just Zoom", "Zume", "Xaero's Minimap",
  "Xaero's World Map", "JourneyMap", "AppleSkin", "Mouse Tweaks", "Inventory Profiles Next",
  "Inventory Tabs", "Inventory HUD+", "Shulker Box Tooltip", "Litematica",
  "Roughly Enough Items (REI)", "Just Enough Items (JEI)", "EMI", "Jade", "Loot Beams",
  "Scoreboard Tweaks", "AutoDrop", "Fabrishot", "Screenshot to Clipboard", "Language Reload",
  "Load My Resources", "Resourcify", "Server Pack Unlocker", "Amecs", "Enhanced Keybinds",
  "Controlling", "Thorough Keybindings", "Keybind Bug Fixes", "KeyBindProfiles",
  "KeybindsPurger", "KeybindHider", "Show Keybinds", "Hotbar Keybinds", "KeybindsGalore Plus",
  "Not Enough Keybinds", "Simple Keybinds", "Just Universal Keybinds", "Toggle Keybinds",
  "Quacky's Better Keybinds", "Drop Stack Keybind Modifier", "Vanilla Keybind Manager",
  "Macro Keybinds", "CommandKeys",
  // 채팅
  "No Chat Reports", "Chat Heads", "Chat Patches", "CaramelChat", "Korean Chat Patch", "Koreanify",
  // 소리 · 음성
  "Sound Physics Remastered", "AmbientSounds", "Presence Footsteps", "Extreme Sound Muffler",
  "Simple Voice Chat", "Quiet Fishing",
  // 컨트롤러
  "Controlify", "MidnightControls",
  // 라이브러리
  "Reflect", "TwelveMonkeys ImageIO", "TRansition", "TRender", "Conditional Mixin",
  "Velocity Native", "Battery", "Dynamic FPS Common", "MaliLib", "XaeroLib", "Cloth Config",
  "Fabric Language Kotlin", "YACL (Yet Another Config Lib)", "Architectury", "owo-lib",
  "MidnightLib", "Puzzle", "SpruceUI", "Satin", "CICADA", "CreativeCore", "Konkrete", "libIPN",
  "Fabric Permissions API", "Placeholder API", "Searchables", "ConfigAPI", "Balm", "Kuma API",
  "LiteConfig", "Configurable", "GitHub API", "Apache HttpComponents", "Night Config",
  "AutoService",
  // 런처가 항상 넣어주는 것들(목록에선 숨겨지지만 방어적으로 같이 허용)
  "Fabric API", "Fabric Resource Loader",
  // 24-185차: "너굴마을인데 왜 모드체커 모드가 비활성화되는 거야"
  // 너굴마을 전용 모드체커는 그 서버의 필수 모드인데 허용 목록에 없어서, 유저가 직접 깔아둔
  // 것이 실행 직전에 꺼지고 있었다. 런처가 넣는 사본(novaclient-ngmodchecker-)은 숨김 처리라
  // 애초에 검사를 안 거치지만, 직접 깐 ng-modchecker.jar 는 이 줄이 있어야 살아남는다.
  "NG ModChecker",
];

// 이름/파일명을 비교용 키로 정규화한다.
//  · 소문자 + 영숫자만 남김
//  · "sodium-fabric-0.5.8+mc1.20.4.jar" 처럼 버전처럼 생긴 토큰부터는 잘라냄
function normalizeModKey(raw) {
  let t = String(raw || "").toLowerCase().trim();
  t = t.replace(/\.disabled$/, "").replace(/\.jar$/, "");
  const parts = t.split(/[-_+ .]+/).filter(Boolean);
  const kept = [];
  for (const p of parts) {
    if (/^v?\d/.test(p)) break;   // 1.2.3 / v2 / 0.5.8
    if (/^mc\d/.test(p)) break;   // mc1.20.4
    kept.push(p);
  }
  const base = (kept.length ? kept : parts).join("");
  return base.replace(/[^a-z0-9]/g, "");
}

// 허용 목록 -> 키 집합 (괄호 별칭/"·" 분리 포함)
const NEOGUL_ALLOWED_KEYS = (() => {
  const set = new Set();
  for (const raw of NEOGUL_ALLOWED_MOD_NAMES) {
    for (const piece of String(raw).split("·")) {
      const m = piece.match(/^([^()]+)(?:\(([^)]*)\))?/);
      if (!m) continue;
      const main = normalizeModKey(m[1]);
      if (main.length >= 2) set.add(main);
      const alias = m[2] ? normalizeModKey(m[2]) : "";
      // 한글 설명 괄호("애드온 포함" 등)는 정규화하면 빈 문자열이 되어 자동으로 걸러짐
      if (alias.length >= 2) set.add(alias);
    }
  }
  return set;
})();

// 이름이 조금 달라도 같은 모드로 보는 접미사(파일명에 흔히 붙는 것들)
const NEOGUL_NAME_SUFFIXES = [
  "", "fabric", "fabricmc", "forge", "quilt", "neoforge", "mod", "mods", "client",
  "reforged", "remastered", "shaders", "shader", "continued", "plus", "api", "lib", "kr",
];

function neogulKeyMatches(candidate, key) {
  if (!candidate || !key) return false;
  if (candidate === key) return true;
  const [long, short] = candidate.length >= key.length ? [candidate, key] : [key, candidate];
  if (!long.startsWith(short)) return false;
  if (short.length < 4) return false; // "ears" 처럼 짧은 이름이 아무 데나 걸리지 않게
  return NEOGUL_NAME_SUFFIXES.includes(long.slice(short.length));
}

// 이 모드가 너굴마을에서 허용되는가. 파일명과 (Explore로 깐 경우) 메타 제목을 둘 다 본다.
function isNeogulAllowedMod(fileName, meta) {
  if (isHiddenModFileName(String(fileName || ""))) return true; // 런처가 넣는 것들
  const candidates = [normalizeModKey(fileName)];
  if (meta?.title) candidates.push(normalizeModKey(meta.title));
  for (const cand of candidates) {
    if (!cand) continue;
    for (const key of NEOGUL_ALLOWED_KEYS) {
      if (neogulKeyMatches(cand, key)) return true;
    }
  }
  return false;
}

// 이 프로필이 너굴마을 서버에 연결돼 있는가
function isProfileLinkedToNeogul(profileId) {
  if (!profileId) return false;
  return getServerProfileMap()[NEOGUL_SERVER_ID] === profileId;
}

// 실행 직전에 허용 목록에 없는 모드를 꺼둔다(.disabled). 끈 모드 이름 목록을 돌려준다.
async function enforceNeogulModPolicy(profileId) {
  if (!isProfileLinkedToNeogul(profileId)) return [];
  const profileRoot = getProfileRoot(profileId);
  const dir = path.join(profileRoot, "mods");
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch (_) {
    return [];
  }
  const meta = await readModMeta(profileRoot, "mods");
  const turnedOff = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".jar")) continue; // 이미 꺼진 것(.disabled)은 그대로 둠
    // 24-184차: 런처가 스스로 넣는 모드(노바 모드 / Fabric API / Mod Menu / 너굴 모드체커)는
    // 유저가 깐 게 아니라 클라이언트 기능이라 절대 건드리지 않는다. 예전엔 이 검사가 없어서
    // 두 번째 실행부터 허용 목록에 없다는 이유로 조용히 꺼질 수 있었다.
    if (isHiddenModFileName(f)) continue;
    // 49-204차(너굴마을 운영진: "노바를 쓰면 모드체커가 모드 목록을 못 보낸다"): 9-29, 9-30에 예전 런처가 직접 깐
    // ng-modchecker-1.3.0.jar를 "허용되지 않은 모드"로 꺼서 모드체커 없이 접속된 적이 있다. 파일 이름이나 제목이
    // 어떻게 바뀌어도 모드 id가 모드체커면 절대 끄지 않는다.
    if (readFabricModId(path.join(dir, f)) === "ng_modchecker") continue;
    if (isNeogulAllowedMod(f, meta[f])) continue;
    try {
      const to = f + ".disabled";
      await fsp.rename(path.join(dir, f), path.join(dir, to));
      if (meta[f]) {
        meta[to] = meta[f];
        delete meta[f];
      }
      turnedOff.push(meta[to]?.title || f.replace(/\.jar$/i, ""));
      logToFile(`[너굴마을] 허용되지 않은 모드를 껐어요: ${f}`);
    } catch (err) {
      logToFile("[너굴마을] 모드 끄기 실패: " + (err?.message || err));
    }
  }
  if (turnedOff.length) await writeModMeta(profileRoot, "mods", meta);
  return turnedOff;
}

// 모드 활성화 ↔ 비활성화 전환 (확장자 뒤에 .disabled 를 붙였다 뗐다 함)
// 24-150차: 리소스팩/쉐이더팩은 파일 이름을 건드리지 않는다. 이름을 바꾸면 마인크래프트가
// 파일 자체를 못 봐서 게임 안 리소스팩 목록에서도 사라져버리기 때문(유저 제보).
// 대신 프로필 폴더의 .nova-packs-off.json 에 "끈 팩" 이름만 적어두고, 자동 적용
// (applyEnabledPacks -> options.txt / iris.properties)에서만 빼준다.
ipcMain.handle("profiles:toggle-file", async (_e, { id, kind, fileName }) => {
  try {
    if (PACK_KINDS.has(kind)) {
      const profileRoot = getProfileRoot(id);
      const off = await getPackOffList(profileRoot, kind);
      const idx = off.indexOf(fileName);
      const nowEnabled = idx >= 0;
      if (nowEnabled) off.splice(idx, 1);
      else off.push(fileName);
      await setPackOffList(profileRoot, kind, off);
      return { ok: true, fileName, enabled: nowEnabled };
    }
    const dir = path.join(getProfileRoot(id), kind);
    const disabled = fileName.toLowerCase().endsWith(".disabled");
    // 24-161차: 너굴마을에 연결된 프로필은 위키 허용 목록에 없는 모드를 켤 수 없다
    if (kind === "mods" && disabled && isProfileLinkedToNeogul(id)) {
      const metaForCheck = await readModMeta(getProfileRoot(id), "mods");
      const base = fileName.slice(0, -".disabled".length);
      if (!isNeogulAllowedMod(base, metaForCheck[fileName] || metaForCheck[base])) {
        return { ok: false, error: NEOGUL_BLOCK_MESSAGE, neogulBlocked: true };
      }
    }
    const newName = disabled ? fileName.slice(0, -".disabled".length) : fileName + ".disabled";
    await fsp.rename(path.join(dir, fileName), path.join(dir, newName));

    // 메타데이터도 파일 이름이 바뀐 만큼 키를 옮겨줌
    const profileRoot = getProfileRoot(id);
    const meta = await readModMeta(profileRoot, kind);
    if (meta[fileName]) {
      meta[newName] = meta[fileName];
      delete meta[fileName];
      await writeModMeta(profileRoot, kind, meta);
    }

    return { ok: true, fileName: newName, enabled: disabled };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 모드 버전 고정 ↔ 해제 (고정된 모드는 "전체 업데이트 확인"에서 제외됨)
ipcMain.handle("profiles:toggle-pin", async (_e, { id, kind, fileName }) => {
  try {
    const profileRoot = getProfileRoot(id);
    const meta = await readModMeta(profileRoot, kind);
    if (!meta[fileName]) return { ok: false, error: "Explore로 설치한 항목만 고정할 수 있어요." };
    meta[fileName].pinned = !meta[fileName].pinned;
    await writeModMeta(profileRoot, kind, meta);
    return { ok: true, pinned: meta[fileName].pinned };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-94차: 프리셋 기능 삭제 - 프리셋 목록/카테고리/만들기/삭제 IPC 4개와 버전 계산 로직을 뺌.

// ----------------------------------------------------------------------------
// Explore (Modrinth에서 Fabric 클라이언트 모드/리소스팩 검색 + 설치)
// ----------------------------------------------------------------------------
const MODRINTH_API = "https://api.modrinth.com/v2";
// 24-175차: Modrinth 는 "누가 부르는지 알아볼 수 있는 User-Agent 를 반드시 보내라"고 요구한다
// (https://docs.modrinth.com/api/ - 없거나 기본 HTTP 라이브러리 이름이면 차단될 수 있음).
// 연락처까지 같이 적어두는 걸 권장해서 저장소 주소를 넣는다. 한도는 분당 300회.
const MODRINTH_UA = "Sil2ntium7012/nova-client/" + app.getVersion() + " (https://github.com/Sil2ntium7012/nova-client)";
function mrFetch(url, opts) {
  return fetch(url, { ...(opts || {}), headers: { "User-Agent": MODRINTH_UA, ...((opts || {}).headers || {}) } });
}

// 프로필 안 mods/resourcepacks/shaderpacks 폴더에는, 어떤 파일이 Modrinth의 어느
// 프로젝트/버전에서 설치됐는지 기록해두는 숨김 메타 파일(.nova-meta.json)이 같이 있어요.
// 이게 있어야 나중에 "이미 설치돼 있나?", "새 버전 나왔나?" 를 알 수 있어요.
function getMetaPath(profileRoot, kind) {
  return path.join(profileRoot, kind, ".nova-meta.json");
}
async function readModMeta(profileRoot, kind) {
  try {
    const text = await fsp.readFile(getMetaPath(profileRoot, kind), "utf-8");
    return JSON.parse(text);
  } catch (_) {
    return {}; // fileName -> { projectId, versionId, title, icon }
  }
}
async function writeModMeta(profileRoot, kind, meta) {
  await fsp.mkdir(path.join(profileRoot, kind), { recursive: true });
  await fsp.writeFile(getMetaPath(profileRoot, kind), JSON.stringify(meta, null, 2), "utf-8");
}

// 7-4: 30개로 캡되고 더 볼 방법이 없던 문제 -> page(1부터 시작)를 받아서 offset으로 변환
// 7-7: 모드/샤더/리소스팩 카테고리 칩 필터 -> categories 배열을 받아서 facets에 OR로 추가
const EXPLORE_PAGE_SIZE = 30;
// 24-186차: 너굴마을 전용 목록용 - 인기순 상위 몇 페이지(100개씩)까지 훑어서 거를지
const NEOGUL_EXPLORE_SCAN_PAGES = 3;
const NEOGUL_EXPLORE_TTL = 5 * 60 * 1000;
const neogulExploreCache = new Map();
ipcMain.handle("explore:search", async (_e, { query, projectType, gameVersion, sort, page, categories, clientOnly, profileId }) => {
  try {
    const facets = [[`project_type:${projectType}`]];
    // 10차 신규(모드): 개별 모드는 이 앱이 프로필 "모드" 탭에서 Fabric 모드만 다루므로 Fabric용만 보여줌
    // 24-2차: 모드팩은 이제 Forge/NeoForge도 설치할 수 있게 됐으므로 Fabric 제한을 풀어줌
    // (모드팩 안에 어떤 로더가 들어있는지는 explore:install-modpack에서 실제로 감지함)
    if (projectType === "mod") facets.push(["categories:fabric"]);
    // ── "클라이언트 모드만 보기" (24-14차 / 24-155차 / 24-159차) ──────────────
    // 24-159차: 24-155차에서 client_side 만 보고 걸렀더니, VeinMiner·Nature's Compass·
    // Immersive Aircraft 처럼 "서버에도 같이 깔아야 동작하는" 모드가 그대로 남아 있었다.
    // (그 모드들은 client_side 가 required/optional 이지만 server_side 도 required 다)
    // 클라 혼자 돌릴 수 있는 모드의 조건은 두 가지를 모두 만족하는 것:
    //   · client_side : required | optional  (클라에서 동작함)
    //   · server_side : unsupported | optional  (서버에 없어도 됨)
    // 페이셋과 결과 필터를 "둘 다" 적용한다. 페이셋이 먹으면 페이지가 꽉 차서 좋고,
    // 모드린스가 페이셋을 거부하면(24-155차에 결과가 0이 됐던 그 증상) 아래에서 페이셋 없이
    // 한 번 더 요청해 결과 필터로 걸러낸다.
    const wantClientOnly = projectType === "mod" && !!clientOnly;
    if (wantClientOnly) {
      facets.push(["client_side:required", "client_side:optional"]);
      facets.push(["server_side:unsupported", "server_side:optional"]);
    }
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (Array.isArray(categories) && categories.length > 0) {
      // 같은 facet 그룹 안에 여러 값을 넣으면 Modrinth 쪽에서 OR로 처리됨
      facets.push(categories.map((c) => `categories:${c}`));
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const offset = (pageNum - 1) * EXPLORE_PAGE_SIZE;

    // 한 번 요청해서 hits 를 받아온다(페이셋 거부 시 재시도 포함)
    const fetchHits = async (limit, off) => {
      const params = new URLSearchParams({
        query: query || "",
        index: sort || "downloads", // 항상 인기순/다운로드순 기본
        limit: String(limit),
        offset: String(off),
        facets: JSON.stringify(facets),
      });
      let res = await mrFetch(`${MODRINTH_API}/search?${params.toString()}`);
      // 24-159차: 모드린스가 client_side/server_side 페이셋을 거부하는 경우가 있다(24-155차에
      // 결과가 통째로 0이 됐던 원인). 그때는 그 두 페이셋만 빼고 한 번 더 요청하고, 걸러내는
      // 일은 아래 결과 필터가 그대로 해준다.
      if (!res.ok && wantClientOnly) {
        logToFile(`[Explore] 클라 전용 페이셋 거부됨(${res.status}) - 페이셋 없이 재시도`);
        const plain = facets.filter(
          (g) => !g.some((v) => v.startsWith("client_side:") || v.startsWith("server_side:"))
        );
        params.set("facets", JSON.stringify(plain));
        res = await mrFetch(`${MODRINTH_API}/search?${params.toString()}`);
      }
      if (!res.ok) throw new Error("Modrinth 검색 실패");
      return await res.json();
    };

    // ── 24-186차: "너굴마을이 적용된 프로필은 전용 모드들 리스트만 쫙 뜨게" ─────────
    // 너굴마을에 연결된 프로필을 고른 채로 모드를 찾으면, 어차피 설치해도 실행 직전에
    // 꺼질 모드까지 잔뜩 보여줄 이유가 없다. 허용 목록(위키 기준)에 있는 것만 남긴다.
    // 한 페이지(30개)를 받아 거르면 몇 개 안 남아 페이지가 휑해지므로, 인기순 상위
    // 300개를 한 번에 받아서 거른 뒤 그걸 페이지로 나눈다. 허용 목록 모드는 전부 인기
    // 모드라 이 범위 안에 사실상 다 들어온다. 같은 조건이면 5분간 다시 받지 않는다.
    const neogulOnly = projectType === "mod" && isProfileLinkedToNeogul(profileId);
    let data;
    let neogulFiltered = null;
    if (neogulOnly) {
      const cacheKey = JSON.stringify([query || "", gameVersion || "", sort || "downloads", categories || [], !!clientOnly]);
      const cached = neogulExploreCache.get(cacheKey);
      if (cached && Date.now() - cached.at < NEOGUL_EXPLORE_TTL) {
        neogulFiltered = cached.items;
      } else {
        const all = [];
        for (let i = 0; i < NEOGUL_EXPLORE_SCAN_PAGES; i++) {
          const part = await fetchHits(100, i * 100);
          const got = part.hits || [];
          all.push(...got);
          if (got.length < 100) break; // 더 없음
        }
        neogulFiltered = all.filter((h) => isNeogulAllowedMod(h.slug || h.title, { title: h.title }));
        neogulExploreCache.set(cacheKey, { at: Date.now(), items: neogulFiltered });
        logToFile(`[Explore] 너굴마을 전용: 상위 ${all.length}개 중 허용 ${neogulFiltered.length}개`);
      }
      data = { hits: neogulFiltered.slice(offset, offset + EXPLORE_PAGE_SIZE), total_hits: neogulFiltered.length };
    } else {
      data = await fetchHits(EXPLORE_PAGE_SIZE, offset);
    }

    // 24-46차: Fabric API는 이제 모든 Fabric 프로필에 항상 자동으로 들어있어서 유저가
    // Explore에서 따로 찾아 설치/관리할 대상이 아님 - 검색 결과(모드 검색일 때만)에서 빼서
    // "모드 까는 곳"에 별도로 뜨지 않게 함. 24-50차: Mod Menu도 같은 이유로 같이 뺌.
    const hits = (data.hits || [])
      .filter(
        (h) =>
          !(
            projectType === "mod" &&
            (h.project_id === FABRIC_API_PROJECT_ID || h.project_id === MOD_MENU_PROJECT_ID)
          )
      )
      // 24-159차: 클라 혼자 돌릴 수 있는 모드만 남긴다.
      //   client_side 가 unsupported 면 제외(클라에서 안 돎)
      //   server_side 가 required 면 제외(서버에도 깔아야 함 - VeinMiner, Nature's Compass 등)
      // 소듐(client required / server unsupported)은 그대로 통과한다.
      .filter((h) => {
        if (!wantClientOnly) return true;
        const c = String(h.client_side || "").toLowerCase();
        const sv = String(h.server_side || "").toLowerCase();
        if (c === "unsupported") return false;
        if (sv === "required") return false;
        return true;
      });

    if (wantClientOnly) {
      const raw = (data.hits || []).length;
      const sideKnown = (data.hits || []).filter((h) => h.server_side).length;
      logToFile(`[Explore] 클라 전용 필터: 원본 ${raw}개 -> ${hits.length}개 (server_side 값이 실린 항목 ${sideKnown}개)`);
    }

    return {
      hits: hits.map((h) => ({
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        icon: h.icon_url,
        author: h.author,
        downloads: h.downloads,
        follows: h.follows,
        // 24-14차: "모드팩 이름 옆쪽에 마크 버전 뜨면 좋을 듯" - Modrinth 검색 결과 hit에
        // 이미 실려오는 지원 버전 목록(오래된->최신 순)을 그대로 넘겨줌
        gameVersions: h.versions || [],
        clientSide: h.client_side || null, // 24-155차: 목록에서도 클라/서버 지원 여부를 알 수 있게
        serverSide: h.server_side || null,
      })),
      page: pageNum,
      totalHits: data.total_hits || 0,
      totalPages: Math.max(1, Math.ceil((data.total_hits || 0) / EXPLORE_PAGE_SIZE)),
      neogulOnly, // 24-186차: 화면에 "너굴마을 허용 모드만 보여요" 안내를 띄우기 위한 표시
    };
  } catch (err) {
    logToFile("Modrinth 검색 실패: " + (err?.message || err));
    return { hits: [], page: 1, totalHits: 0, totalPages: 1 };
  }
});

// 17차 신규: 모드 상세 설명이 대부분 영어라, 구글 번역(비공식 무료 엔드포인트, API 키 불필요)로
// 그 자리에서 한국어로 바꿔볼 수 있게 함. 원문이 너무 길면 한 번에 다 못 보내니 앞부분만 잘라서 보냄
// ----------------------------------------------------------------------------
// 24-201차: "모드 번역 오류는 그 링크만 번역 안되게 해줘"
//
// 모드 설명을 통째로 번역기에 넣으면 주소까지 같이 번역된다. 번역기는 URL 을 문장으로
// 보고 경로를 한국어로 바꾸거나 중간에 띄어쓰기를 넣어버려서, 번역 뒤에는 링크가 전부
// 깨진다(Modrinth 설명은 배지 이미지·문서 링크가 수십 개씩 들어 있어서 특히 심하다).
//
// 그래서 번역 전에 주소를 꺼내서 기호 자리표(⟪0⟫)로 바꿔 두고, 번역이 끝난 뒤 그 자리에
// 원래 주소를 그대로 돌려놓는다. 자리표는 글자가 없어서 번역기가 건드릴 게 없다. 그래도
// 번역기가 자리표 주변에 공백을 끼워 넣는 경우가 있어서, 되돌릴 때 공백을 허용해 찾는다.
// ----------------------------------------------------------------------------
const TRANSLATE_URL_RE = /(?:https?:\/\/|www\.)[^\s)\]<>"']+/gi;

function maskUrlsForTranslate(text) {
  const urls = [];
  const masked = String(text).replace(TRANSLATE_URL_RE, (m) => {
    urls.push(m);
    return `\u27ea${urls.length - 1}\u27eb`;
  });
  return { masked, urls };
}

function unmaskUrlsAfterTranslate(text, urls) {
  if (!urls.length) return text;
  // 번역기가 자리표 안팎에 공백을 넣을 수 있어서 넉넉하게 찾는다
  return String(text).replace(/\u27ea\s*(\d+)\s*\u27eb/g, (whole, idx) => {
    const url = urls[Number(idx)];
    return url === undefined ? whole : url;
  });
}

ipcMain.handle("explore:translate", async (_e, text) => {
  if (!text || !text.trim()) return { ok: false, error: "번역할 내용이 없어요." };
  try {
    const { masked, urls } = maskUrlsForTranslate(text.slice(0, 4500));
    const params = new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: "ko",
      dt: "t",
      q: masked,
    });
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
    if (!res.ok) throw new Error("번역 요청 실패");
    const data = await res.json();
    const translated = (data[0] || []).map((seg) => seg[0]).join("");
    return { ok: true, text: unmaskUrlsAfterTranslate(translated, urls) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 프로젝트 상세 정보 (앱 안에서 설명을 보여주기 위함 - Modrinth 페이지로 안 나가도 됨)
ipcMain.handle("explore:get-project", async (_e, projectId) => {
  try {
    const res = await mrFetch(`${MODRINTH_API}/project/${projectId}`);
    if (!res.ok) throw new Error("프로젝트 정보를 가져오지 못했습니다.");
    const p = await res.json();
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      body: p.body, // 마크다운 원문 - 간단히 텍스트로만 보여줄 예정
      icon: p.icon_url,
      downloads: p.downloads,
      categories: p.categories,
      // 24-14차: "모드 보기에서 스크린샷이 안보여 버그인 듯" - Modrinth 응답에서 g.url이
      // 비어있는데 g.raw_url만 있는 항목이 있거나, 라벨이 title 대신 name으로 오는 경우가
      // 있어서(API 버전에 따라 필드명이 다를 수 있음) 둘 다 대비하고, 그래도 쓸 수 있는
      // 주소가 없는 항목은 아예 빼서 화면에 깨진 이미지가 뜨지 않게 함
      gallery: (p.gallery || [])
        .map((g) => ({ url: g.url || g.raw_url || "", title: g.title || g.name || "" }))
        .filter((g) => g.url),
      gameVersions: p.game_versions || [],
      clientSide: p.client_side,
      serverSide: p.server_side,
      dateModified: p.updated,
    };
  } catch (err) {
    logToFile("Modrinth 프로젝트 조회 실패: " + (err?.message || err));
    return null;
  }
});

// 17차 신규: "제작자" 페이지 - 그 제작자(Modrinth 계정)의 모드/리소스팩/쉐이더 전부 +
// 프로젝트 개수 + 전체 다운로드 수 + 자기소개까지 한 번에 보여줌 (프로필 수정/모드설치 양쪽에서 재사용)
ipcMain.handle("explore:author-projects", async (_e, authorUsername) => {
  const uname = String(authorUsername || "").trim();
  if (!uname) return null;
  try {
    const [userRes, projectsRes] = await Promise.all([
      mrFetch(`${MODRINTH_API}/user/${encodeURIComponent(uname)}`),
      mrFetch(`${MODRINTH_API}/user/${encodeURIComponent(uname)}/projects`),
    ]);
    const user = userRes.ok ? await userRes.json() : null;
    const projects = projectsRes.ok ? await projectsRes.json() : [];
    const totalDownloads = (projects || []).reduce((sum, p) => sum + (p.downloads || 0), 0);
    return {
      username: user?.username || uname,
      bio: user?.bio || "",
      avatar: user?.avatar_url || "",
      projectCount: (projects || []).length,
      totalDownloads,
      projects: (projects || []).map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        icon: p.icon_url,
        downloads: p.downloads,
        projectType: p.project_type, // "mod" | "resourcepack" | "shader" 등
      })),
    };
  } catch (err) {
    logToFile("제작자 정보 조회 실패: " + (err?.message || err));
    return null;
  }
});

// 특정 프로젝트의 설치 가능한 버전들 - 반드시 "그 프로필의 정확한 마인크래프트 버전"에
// 맞는 것만 보여줌 (일반적인 게임 버전 목록이 아니라 프로필 기준)
// 15-3(4차): 프리셋 자동 버전 생성 로직에서도 그대로 재사용할 수 있도록 IPC 핸들러 몸통을
// 순수 함수로 뽑아냄 (explore:get-versions 핸들러도 이 함수를 그대로 씀)
async function fetchModVersionsForGame(projectId, gameVersion, projectType) {
  try {
    const params = new URLSearchParams();
    // 10차 신규(모드팩): 모드팩은 "이 프로필의 버전"이라는 게 아직 없는 상태에서 고르는
    // 거라 gameVersion을 안 넘길 수도 있음 - 그럴 땐 필터 없이 이 프로젝트의 모든 버전을 보여줌
    if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
    if (projectType === "mod" || projectType === "modpack") params.set("loaders", JSON.stringify(["fabric"]));

    const res = await mrFetch(`${MODRINTH_API}/project/${projectId}/version?${params.toString()}`);
    if (!res.ok) throw new Error("버전 목록을 가져오지 못했습니다.");
    const versions = await res.json();

    return versions.map((v) => ({
      id: v.id,
      name: v.name,
      versionNumber: v.version_number,
      versionType: v.version_type, // release | beta | alpha
      datePublished: v.date_published,
      downloads: v.downloads,
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      fileUrl: v.files?.[0]?.url,
      fileName: v.files?.[0]?.filename,
      fileSize: v.files?.[0]?.size || 0,
      // 10차: "버전이랑 changelog 이런 거는 보기 안에서 또 분리해줘" - 버전별 변경사항을
      // 따로 보여주려면 원본이 필요해서, Modrinth가 버전마다 주는 changelog(마크다운 텍스트)를 그대로 넘김
      changelog: v.changelog || "",
      // 이 버전을 쓰려면 같이 있어야 하는 다른 모드(하위 모드) 목록
      dependencies: (v.dependencies || [])
        .filter((d) => d.dependency_type === "required" && d.project_id)
        .map((d) => ({ projectId: d.project_id, versionId: d.version_id || null })),
    }));
  } catch (err) {
    logToFile("Modrinth 버전 조회 실패: " + (err?.message || err));
    return [];
  }
}

ipcMain.handle("explore:get-versions", async (_e, { projectId, gameVersion, projectType }) => {
  return fetchModVersionsForGame(projectId, gameVersion, projectType);
});

// 이 프로필에 이 프로젝트가 이미 설치돼 있는지 확인 (버튼을 설치/제거로 구분하기 위함)
ipcMain.handle("explore:check-installed", async (_e, { profileId, kind, projectId }) => {
  // 24-46차: Fabric API는 Fabric 프로필에 항상 자동으로 들어있음 - 다른 모드를 설치할 때
  // "하위 모드로 같이 설치할까요?"라고 또 물어보거나, 상세 화면에서 "설치 안 됨"으로 잘못
  // 나오지 않도록 항상 설치된 것으로 처리함(meta.json엔 이 항목을 안 남기므로 직접 조회 없이 처리)
  // 24-50차: Mod Menu도 같은 이유로 같이 처리함
  if (kind === "mods" && (projectId === FABRIC_API_PROJECT_ID || projectId === MOD_MENU_PROJECT_ID)) {
    const profile = findProfile(profileId);
    if (!profile || (profile.loader || "fabric") === "fabric") {
      return { installed: true, builtin: true };
    }
  }
  const meta = await readModMeta(getProfileRoot(profileId), kind);
  const found = Object.entries(meta).find(([, m]) => m.projectId === projectId);
  return found ? { installed: true, fileName: found[0], meta: found[1] } : { installed: false };
});

// 15-3(4차): 위와 마찬가지로 다운로드+설치 로직도 순수 함수로 뽑아서 프리셋 자동 생성에서도 씀
async function downloadAndInstallModFile(profileRoot, kind, { fileUrl, fileName, projectId, projectTitle, icon, author, versionId, versionNumber }) {
  if (!fileUrl || !fileName) throw new Error("설치할 파일 정보가 없어요.");
  const destDir = path.join(profileRoot, kind);
  await fsp.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);

  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error("파일 다운로드 실패");
  const buffer = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buffer);

  if (projectId) {
    const meta = await readModMeta(profileRoot, kind);
    meta[fileName] = { projectId, versionId, versionNumber: versionNumber || null, title: projectTitle, icon, author };
    await writeModMeta(profileRoot, kind, meta);
  }
  return fileName;
}

// 고른(또는 정식 최신) 버전을 실제로 다운로드해서 프로필 폴더에 설치하고, 메타데이터도 기록
ipcMain.handle("explore:install", async (_e, { profileId, kind, fileUrl, fileName, projectId, projectTitle, icon, author, versionId, versionNumber }) => {
  try {
    const profileRoot = getProfileRoot(profileId);
    const savedName = await downloadAndInstallModFile(profileRoot, kind, { fileUrl, fileName, projectId, projectTitle, icon, author, versionId, versionNumber });
    // 24-161차: 너굴마을에 연결된 프로필에 허용되지 않은 모드를 깔면, 설치는 하되 바로 꺼둔다
    // (서버가 입장을 막는 모드라서 켜진 채로 두면 다음 실행에서 못 들어감)
    if (kind === "mods" && isProfileLinkedToNeogul(profileId) && !isNeogulAllowedMod(savedName, { title: projectTitle })) {
      const turnedOff = await enforceNeogulModPolicy(profileId);
      if (turnedOff.length) {
        return {
          ok: true,
          fileName: savedName + ".disabled",
          neogulBlocked: true,
          notice: `${projectTitle || savedName} 은(는) ${NEOGUL_BLOCK_MESSAGE.replace("해당 모드가 ", "")} - 설치는 했지만 꺼둔 상태예요`,
        };
      }
    }
    return { ok: true, fileName: savedName };
  } catch (err) {
    logToFile("Modrinth 설치 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// ----------------------------------------------------------------------------
// 10차 신규: 모드팩(Modrinth .mrpack) 설치
// 개별 모드/리소스팩/쉐이더처럼 "지금 고른 프로필에 추가"가 아니라, 모드팩은 그 자체로
// 새 프로필을 통째로 만들어서 그 안에 구성을 그대로 풀어넣는 방식으로 동작함
// (요청: "모드팩은 추가하면 아이콘도 그 모드팩 아이콘으로 하고 프로필 자체를 새로 만들어지는
// 걸로 해줘"). 이 앱은 항상 Fabric 로더로만 실행하므로(프로필마다 로더를 따로 고르는 개념이
// 없음), 검색/버전 조회 단계에서 이미 Fabric 카테고리/로더로 걸러진 모드팩만 다룸.
// ----------------------------------------------------------------------------

// Modrinth CDN 다운로드 URL은 보통
// https://cdn.modrinth.com/data/{projectId}/versions/{versionId}/{fileName} 형태라서,
// 모드팩 안에 들어있는 개별 모드 파일도 이 패턴에서 projectId/versionId를 되짚어내면
// 낱개로 설치했을 때와 똑같이 프로필의 "모드 관리" 화면에서 알아보고(이름/업데이트 확인 등)
// 관리할 수 있게 됨 - 실패해도(패턴이 안 맞아도) 파일 설치 자체는 그대로 진행됨
function tryParseModrinthCdnUrl(url) {
  const m = /^https:\/\/cdn\.modrinth\.com\/data\/([^/]+)\/versions\/([^/]+)\/([^/?]+)/.exec(url || "");
  if (!m) return null;
  try {
    return { projectId: m[1], versionId: m[2], fileName: decodeURIComponent(m[3]) };
  } catch (_) {
    return { projectId: m[1], versionId: m[2], fileName: m[3] };
  }
}

// 프로필 아이콘을 "파일 선택 대화상자"가 아니라 원격 URL(모드팩 프로젝트 아이콘)에서 받아와 지정
async function setProfileIconFromUrl(profileId, iconUrl) {
  if (!iconUrl) return;
  try {
    const res = await fetch(iconUrl);
    if (!res.ok) return;
    const buffer = Buffer.from(await res.arrayBuffer());
    const dir = getProfileRoot(profileId);
    await fsp.mkdir(dir, { recursive: true });
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      await fsp.unlink(path.join(dir, `icon.${ext}`)).catch(() => {});
    }
    let ext = "png";
    try {
      ext = (path.extname(new URL(iconUrl).pathname).replace(".", "") || "png").toLowerCase();
    } catch (_) {}
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) ext = "png";
    await fsp.writeFile(path.join(dir, `icon.${ext}`), buffer);
  } catch (err) {
    logToFile("모드팩 아이콘 다운로드 실패: " + (err?.message || err));
  }
}

// 24-2차 신규: modrinth.index.json의 dependencies 키를 보고 이 모드팩이 실제로 어떤 로더를
// 쓰는지 감지함(Modrinth 모드팩은 "forge"/"neoforge"/"fabric-loader" 중 하나를 dependencies에
// 담고 있음). 옛날 방식 팩이라 dependencies에 아무 로더 키도 없으면 예전처럼 fabric으로 취급
function detectModpackLoader(index) {
  const deps = index?.dependencies || {};
  if (deps.neoforge) return "neoforge";
  if (deps.forge) return "forge";
  if (deps["fabric-loader"]) return "fabric";
  return "fabric";
}

ipcMain.handle("explore:install-modpack", async (_e, { projectId, projectTitle, icon, fileUrl }) => {
  if (!fileUrl) return { ok: false, error: "설치할 모드팩 파일 정보가 없어요." };
  const tempDir = path.join(getRoot(), "temp");
  const tempPath = path.join(tempDir, `modpack-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.mrpack`);

  try {
    await fsp.mkdir(tempDir, { recursive: true });
    await downloadFileWithProgress(fileUrl, tempPath, undefined, () => {});

    const zip = new AdmZip(tempPath);
    const indexEntry = zip.getEntry("modrinth.index.json");
    if (!indexEntry) throw new Error("올바른 모드팩 파일(.mrpack)이 아니에요.");
    const index = JSON.parse(zip.readAsText(indexEntry));

    const mcVersion = index.dependencies?.minecraft;
    if (!mcVersion) throw new Error("모드팩에 마인크래프트 버전 정보가 없어요.");

    // ---- 새 프로필 생성: profiles:create와 같은 구조로 완전히 빈 상태에서 시작 ----
    const id = generateProfileId();
    const profileRoot = getProfileRoot(id);
    await fsp.mkdir(path.join(profileRoot, "mods"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "resourcepacks"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "shaderpacks"), { recursive: true });

    const profile = {
      id,
      name: (projectTitle || index.name || "새 모드팩").toString().trim() || "새 모드팩",
      mcVersion,
      loader: detectModpackLoader(index), // 24-2차: 실제 팩에 들어있는 로더를 감지해서 사용(Forge/NeoForge 지원)
      memoryGB: 4,
      width: 1280,
      height: 720,
      fullscreen: false,
      jvmArgs: "",
      createdAt: new Date().toISOString(),
      // 프로필 목록/카드에서 "모드팩으로 만들어진 프로필"임을 나중에 구분하고 싶을 때 쓸 수 있는 표시
      fromModpack: true,
      modpackProjectId: projectId || null,
      modpackName: index.name || projectTitle || null,
    };

    // ---- modrinth.index.json의 files[]: 각 파일을 다운로드해서 지정된 경로(mods/,
    // resourcepacks/, config/ 등)에 그대로 배치. env.client가 "unsupported"인 서버 전용
    // 파일은 건너뜀 ----
    const files = Array.isArray(index.files) ? index.files : [];
    const total = files.length;
    let done = 0;
    let failed = 0;
    const modMetaByKind = { mods: {}, resourcepacks: {}, shaderpacks: {} };

    for (const f of files) {
      done++;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("modpack:install-progress", {
          current: done,
          total,
          fileName: path.basename(f.path || ""),
        });
      }
      if (f.env && f.env.client === "unsupported") continue;
      const dlUrl = (f.downloads || [])[0];
      if (!dlUrl || !f.path) {
        failed++;
        continue;
      }
      try {
        const res = await fetch(dlUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const destPath = path.join(profileRoot, f.path);
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await fsp.writeFile(destPath, buffer);

        // mods/resourcepacks/shaderpacks 폴더 바로 안에 있는 파일이면, 기존 "모드 관리"
        // 화면에서 그대로 알아볼 수 있도록 메타데이터도 같이 채워둠(가능한 경우에만)
        const topFolder = f.path.split("/")[0];
        if (modMetaByKind[topFolder] && f.path === `${topFolder}/${path.basename(f.path)}`) {
          const parsed = tryParseModrinthCdnUrl(dlUrl);
          if (parsed) {
            modMetaByKind[topFolder][path.basename(f.path)] = {
              projectId: parsed.projectId,
              versionId: parsed.versionId,
              versionNumber: null,
              title: path.basename(f.path).replace(/\.(jar|zip)$/i, ""),
              icon: null,
              author: null,
            };
          }
        }
      } catch (err) {
        failed++;
        logToFile(`모드팩 파일 설치 실패(${f.path}): ` + (err?.message || err));
      }
    }

    for (const [kind, meta] of Object.entries(modMetaByKind)) {
      if (Object.keys(meta).length > 0) await writeModMeta(profileRoot, kind, meta);
    }

    // ---- overrides/ · client-overrides/ 폴더: 압축 안에 파일 그대로 들어있는 설정 등을
    // 다운로드 없이 그대로 풀어넣음 (client-overrides가 있으면 overrides보다 나중에 덮어써서 우선함) ----
    for (const overridesDir of ["overrides", "client-overrides"]) {
      const prefix = overridesDir + "/";
      const entries = zip.getEntries().filter((e) => e.entryName.startsWith(prefix) && !e.isDirectory);
      for (const e of entries) {
        const relPath = e.entryName.slice(prefix.length);
        if (!relPath) continue;
        const destPath = path.join(profileRoot, relPath);
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await fsp.writeFile(destPath, e.getData());
      }
    }

    const list = getProfiles();
    list.push(profile);
    // 24-93차: 방금 만든 p_... 폴더를 프로필 이름으로 옮김(applyProfileFolderName 주석 참고)
    applyProfileFolderName(profile, list);
    saveProfiles(list);

    // ---- 아이콘: 모드팩 프로젝트 아이콘을 그대로 프로필 아이콘으로 지정 ----
    await setProfileIconFromUrl(id, icon);

    // 다른 프로필 만들 때와 마찬가지로 자바/에셋을 조용히 미리 받아둠 (기다리지 않고 흘려보냄)
    prefetchAssetsForProfile(profile).catch((err) => {
      logToFile("모드팩 프로필 자바/에셋 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
    });

    return { ok: true, profile, failedCount: failed, totalFiles: total };
  } catch (err) {
    logToFile("모드팩 설치 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

// 15차: "모드팩 업로드는 .mrpack 업로드하는 걸로" - Modrinth에서 검색해 설치하는
// explore:install-modpack과 달리, 유저가 이미 갖고 있는 .mrpack 파일을 로컬에서 직접 골라
// 설치하는 경로. 파일을 원격에서 받아오는 단계만 없을 뿐, 압축을 풀어서 새 프로필을 통째로
// 만드는 나머지 로직은 explore:install-modpack과 동일함
ipcMain.handle("profiles:install-modpack-file", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "모드팩 파일(.mrpack) 선택",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "Modrinth 모드팩", extensions: ["mrpack"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  const filePath = result.filePaths[0];
  try {
    const zip = new AdmZip(filePath);
    const indexEntry = zip.getEntry("modrinth.index.json");
    if (!indexEntry) throw new Error("올바른 모드팩 파일(.mrpack)이 아니에요.");
    const index = JSON.parse(zip.readAsText(indexEntry));

    const mcVersion = index.dependencies?.minecraft;
    if (!mcVersion) throw new Error("모드팩에 마인크래프트 버전 정보가 없어요.");

    const id = generateProfileId();
    const profileRoot = getProfileRoot(id);
    await fsp.mkdir(path.join(profileRoot, "mods"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "resourcepacks"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "shaderpacks"), { recursive: true });

    const profile = {
      id,
      name: (index.name || path.basename(filePath, ".mrpack") || "새 모드팩").toString().trim() || "새 모드팩",
      mcVersion,
      loader: detectModpackLoader(index), // 24-2차: 실제 팩에 들어있는 로더를 감지해서 사용(Forge/NeoForge 지원)
      memoryGB: 4,
      width: 1280,
      height: 720,
      fullscreen: false,
      jvmArgs: "",
      createdAt: new Date().toISOString(),
      fromModpack: true,
      modpackName: index.name || null,
    };

    const files = Array.isArray(index.files) ? index.files : [];
    const total = files.length;
    let done = 0;
    let failed = 0;
    const modMetaByKind = { mods: {}, resourcepacks: {}, shaderpacks: {} };

    for (const f of files) {
      done++;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("modpack:install-progress", {
          current: done,
          total,
          fileName: path.basename(f.path || ""),
        });
      }
      if (f.env && f.env.client === "unsupported") continue;
      const dlUrl = (f.downloads || [])[0];
      if (!dlUrl || !f.path) {
        failed++;
        continue;
      }
      try {
        const res = await fetch(dlUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const destPath = path.join(profileRoot, f.path);
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await fsp.writeFile(destPath, buffer);

        const topFolder = f.path.split("/")[0];
        if (modMetaByKind[topFolder] && f.path === `${topFolder}/${path.basename(f.path)}`) {
          const parsed = tryParseModrinthCdnUrl(dlUrl);
          if (parsed) {
            modMetaByKind[topFolder][path.basename(f.path)] = {
              projectId: parsed.projectId,
              versionId: parsed.versionId,
              versionNumber: null,
              title: path.basename(f.path).replace(/\.(jar|zip)$/i, ""),
              icon: null,
              author: null,
            };
          }
        }
      } catch (err) {
        failed++;
        logToFile(`업로드한 모드팩 파일 설치 실패(${f.path}): ` + (err?.message || err));
      }
    }

    for (const [kind, meta] of Object.entries(modMetaByKind)) {
      if (Object.keys(meta).length > 0) await writeModMeta(profileRoot, kind, meta);
    }

    for (const overridesDir of ["overrides", "client-overrides"]) {
      const prefix = overridesDir + "/";
      const entries = zip.getEntries().filter((e) => e.entryName.startsWith(prefix) && !e.isDirectory);
      for (const e of entries) {
        const relPath = e.entryName.slice(prefix.length);
        if (!relPath) continue;
        const destPath = path.join(profileRoot, relPath);
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await fsp.writeFile(destPath, e.getData());
      }
    }

    const list = getProfiles();
    list.push(profile);
    // 24-93차: 방금 만든 p_... 폴더를 프로필 이름으로 옮김(applyProfileFolderName 주석 참고)
    applyProfileFolderName(profile, list);
    saveProfiles(list);

    prefetchAssetsForProfile(profile).catch((err) => {
      logToFile("업로드한 모드팩 프로필 자바/에셋 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
    });

    return { ok: true, profile, failedCount: failed, totalFiles: total };
  } catch (err) {
    logToFile("모드팩 업로드 설치 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 22차 신규: "프로필 그 ...에서 .mrpack으로 뽑는 모드팩 파일로 만드는 기능도 만들어줘" -
// 위 profiles:install-modpack-file(.mrpack 가져오기)의 반대 방향. Modrinth에서 받은 모드/
// 리소스팩/쉐이더(프로젝트ID+버전ID가 있는 것)는 표준 modrinth.index.json의 files[] 항목으로
// (실제 파일은 안 담고 다운로드 URL/해시만) 담고, 직접 추가해서 출처를 모르는 파일은
// overrides/ 폴더에 실제로 파일을 담아서 내보냄(표준 .mrpack 뷰어/런처와 호환)
async function fetchStableFabricLoaderVersion(mcVersion) {
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!res.ok) return null;
    const loaders = await res.json();
    if (!Array.isArray(loaders) || loaders.length === 0) return null;
    const stable = loaders.find((l) => l.loader?.stable) || loaders[0];
    return stable?.loader?.version || null;
  } catch (_) {
    return null;
  }
}

function sanitizeFileNameForExport(name) {
  return String(name || "profile").replace(/[\\/:*?"<>|]/g, "_").trim() || "profile";
}

ipcMain.handle("profiles:export-modpack", async (_e, id) => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const profile = getProfiles().find((p) => p.id === id);
  if (!profile) return { ok: false, error: "프로필을 찾을 수 없어요." };

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: "모드팩(.mrpack)으로 내보내기",
    defaultPath: path.join(app.getPath("downloads"), `${sanitizeFileNameForExport(profile.name)}.mrpack`),
    filters: [{ name: "Modrinth 모드팩", extensions: ["mrpack"] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  try {
    const profileRoot = getProfileRoot(id);
    const zip = new AdmZip();
    const files = [];
    const overridesEntries = [];

    for (const kind of ["mods", "resourcepacks", "shaderpacks"]) {
      const dir = path.join(profileRoot, kind);
      if (!fs.existsSync(dir)) continue;
      const ext = kind === "mods" ? ".jar" : ".zip";
      const meta = await readModMeta(profileRoot, kind);
      const rawFiles = await fsp.readdir(dir);
      for (const f of rawFiles) {
        // 25-3차: 노바 내장 모드 / 24-46차: Fabric API - 둘 다 클라이언트 자체 기능이라
        // 모드팩 내보내기에도 포함하지 않음
        if (kind === "mods" && isHiddenModFileName(f)) continue;
        const lower = f.toLowerCase();
        // .disabled 상태(꺼둔 모드)는 표준 형식으로 표현할 방법이 없어서 내보내지 않음
        if (!lower.endsWith(ext)) continue;
        const absPath = path.join(dir, f);
        const m = meta[f];
        if (m?.projectId && m?.versionId) {
          const buffer = await fsp.readFile(absPath);
          files.push({
            path: `${kind}/${f}`,
            hashes: {
              sha1: crypto.createHash("sha1").update(buffer).digest("hex"),
              sha512: crypto.createHash("sha512").update(buffer).digest("hex"),
            },
            env: { client: "required", server: kind === "mods" ? "unsupported" : "unsupported" },
            downloads: [`https://cdn.modrinth.com/data/${m.projectId}/versions/${m.versionId}/${encodeURIComponent(f)}`],
            fileSize: buffer.length,
          });
        } else {
          // Modrinth 출처가 없는(직접 추가한) 파일은 다운로드 URL을 만들 수 없으므로
          // overrides에 파일 자체를 그대로 담음
          overridesEntries.push({ absPath, zipPath: `overrides/${kind}/${f}` });
        }
      }
    }

    // 24-2차: 프로필의 실제 로더(forge/neoforge/fabric)에 맞춰 올바른 dependencies 키로
    // 버전을 적어줌 - 예전엔 항상 fabric-loader만 적었는데, 이제 프로필이 Forge/NeoForge일
    // 수도 있으므로 분기해서 처리함
    const index = {
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0.0",
      name: profile.name,
      files,
      dependencies: { minecraft: profile.mcVersion },
    };
    if (profile.description) index.summary = profile.description;
    if (profile.loader === "forge") {
      const forgeVersion = await fetchRecommendedForgeVersion(profile.mcVersion);
      if (forgeVersion) index.dependencies.forge = forgeVersion;
    } else if (profile.loader === "neoforge") {
      const neoVersion = await fetchRecommendedNeoForgeVersion(profile.mcVersion);
      if (neoVersion) index.dependencies.neoforge = neoVersion;
    } else if (profile.loader !== "vanilla") {
      const loaderVersion = await fetchStableFabricLoaderVersion(profile.mcVersion);
      if (loaderVersion) index.dependencies["fabric-loader"] = loaderVersion;
    }

    zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify(index, null, 2), "utf-8"));
    for (const { absPath, zipPath } of overridesEntries) {
      zip.addLocalFile(absPath, path.dirname(zipPath), path.basename(zipPath));
    }
    zip.writeZip(saveResult.filePath);

    return {
      ok: true,
      filePath: saveResult.filePath,
      linkedCount: files.length,
      bundledCount: overridesEntries.length,
    };
  } catch (err) {
    logToFile("모드팩 내보내기 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 설치된 모드/리소스팩 제거 (메타데이터도 같이 지움)
ipcMain.handle("explore:uninstall", async (_e, { profileId, kind, fileName }) => {
  try {
    const profileRoot = getProfileRoot(profileId);
    await fsp.unlink(path.join(profileRoot, kind, fileName)).catch(() => {});
    const meta = await readModMeta(profileRoot, kind);
    delete meta[fileName];
    await writeModMeta(profileRoot, kind, meta);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 프로필에 설치된 모드 중 Modrinth 최신 버전이 있는 것들 확인 (개별/전체 업데이트용)
ipcMain.handle("explore:check-updates", async (_e, { profileId, kind }) => {
  const profile = findProfile(profileId);
  if (!profile) return [];
  const profileRoot = getProfileRoot(profileId);
  const meta = await readModMeta(profileRoot, kind);

  const results = [];
  for (const [fileName, m] of Object.entries(meta)) {
    if (m.pinned) continue; // 버전 고정된 모드는 전체 업데이트에서 제외
    try {
      const params = new URLSearchParams({ game_versions: JSON.stringify([profile.mcVersion]) });
      if (kind === "mods") params.set("loaders", JSON.stringify(["fabric"]));
      const res = await mrFetch(`${MODRINTH_API}/project/${m.projectId}/version?${params.toString()}`);
      if (!res.ok) continue;
      const versions = await res.json();
      const latest = versions.find((v) => v.version_type === "release") || versions[0];
      if (latest && latest.id !== m.versionId) {
        results.push({
          fileName,
          projectId: m.projectId,
          title: m.title,
          icon: m.icon,
          author: m.author,
          newVersionId: latest.id,
          newVersionNumber: latest.version_number,
          fileUrl: latest.files?.[0]?.url,
          newFileName: latest.files?.[0]?.filename,
        });
      }
    } catch (err) {
      logToFile("모드 업데이트 확인 실패: " + (err?.message || err));
    }
  }
  return results;
});

// 업데이트 적용: 예전 파일 지우고 새 파일 설치 + 메타데이터 갱신
ipcMain.handle("explore:apply-update", async (_e, { profileId, kind, oldFileName, fileUrl, newFileName, projectId, projectTitle, icon, author, versionId, versionNumber }) => {
  try {
    const profileRoot = getProfileRoot(profileId);
    const destDir = path.join(profileRoot, kind);
    await fsp.unlink(path.join(destDir, oldFileName)).catch(() => {});

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error("파일 다운로드 실패");
    const buffer = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(path.join(destDir, newFileName), buffer);

    const meta = await readModMeta(profileRoot, kind);
    const prevAuthor = meta[oldFileName]?.author;
    delete meta[oldFileName];
    meta[newFileName] = { projectId, versionId, versionNumber: versionNumber || null, title: projectTitle, icon, author: author || prevAuthor };
    await writeModMeta(profileRoot, kind, meta);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});


// ----------------------------------------------------------------------------
// Forum (Supabase REST API로 게시글/답글/좋아요 관리)
// ----------------------------------------------------------------------------
function supabaseHeaders(extra) {
  return {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: supabaseHeaders(options.headers),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase 요청 실패 (${res.status}): ${text}`);
  }
  // 204뿐 아니라, Prefer 헤더를 안 줘서 201/200인데도 몸통이 비어있는 경우가 있어서
  // (POST/PATCH/DELETE 등) 상태 코드만 보지 말고 실제 텍스트를 먼저 확인함
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}


// ============================================================================
// 24-214차: 티어 (아이언 → 브론즈 → 실버 → 골드 → 플래티넘 → 다이아몬드)
// "댓글, 클라이언트 켠 시간, 게시글을 기준으로 이 3개를 올리면 티어도 자동으로 올라가게"
// 24-215차: 시작 티어는 아이언 (아이언 → 브론즈 → 실버 → 골드 → 플래티넘 → 다이아몬드)
//
// 셋 다 이미 어딘가에 있는 값이다.
//   · 게시글 / 댓글 : forum_posts / forum_replies 를 내 uuid 로 세면 된다
//   · 클라이언트 켠 시간 : 런처가 켜져 있는 동안 5분마다 1칸씩 쌓는다(로컬)
// 계산한 결과는 nova_player_tiers 한 줄에 올려둔다. 남의 티어도 이 표에서 읽는다.
// (친구창은 노바 계정 id 로, 게시판은 마크 uuid 로 사람을 가리켜서 두 열을 다 넣어둔다)
// ============================================================================
const TIERS_TABLE = "nova_player_tiers";
// 24-215차: 시작은 아이언. 아무것도 안 해도 아이언이고, 조금만 하면 브론즈로 올라간다.
// 24-224차: "조건은 초반은 쉽고 가면 갈수록 어렵게"
// 간격을 10 → 30 → 90 → 300 → 800 으로 벌려서, 처음 두 칸은 금방 오르고 위로 갈수록 멀어진다.
const TIER_STEPS = [
  // 24-234차: "티어 올리기 너무 쉬워 훨씬 어렵게"
  // 24-235차: "점수 더 올려야 해 더" - 처음 기준의 10배 이상으로
  { key: "diamond", min: 15000 },
  { key: "platinum", min: 6000 },
  { key: "gold", min: 2000 },
  { key: "silver", min: 600 },
  { key: "bronze", min: 150 },
  { key: "iron", min: 0 },
];
// 티어마다 주는 것 / 거는 것
//  · 출석 코인 : 아이언 1 → 다이아 6 (한 칸에 1씩)
//  · 하루 글/댓글 수 : 올라갈수록 더 많이
//  · 주간 퀘스트 : 아이언은 잠김
const TIER_PERKS = {
  // 24-229차: servers = 내 서버 최대 개수(아이언~골드 2, 플래티넘 이상 3) - 상점 슬롯 +1 과 중첩
  iron: { coin: 1, posts: 3, comments: 10, weekly: false, servers: 2 },
  bronze: { coin: 2, posts: 5, comments: 20, weekly: true, servers: 2 },
  silver: { coin: 3, posts: 8, comments: 35, weekly: true, servers: 2 },
  gold: { coin: 4, posts: 12, comments: 60, weekly: true, servers: 2 },
  platinum: { coin: 5, posts: 20, comments: 100, weekly: true, servers: 3 },
  diamond: { coin: 6, posts: 40, comments: 200, weekly: true, servers: 3 },
};
const TIER_LABEL = {
  iron: "아이언",
  bronze: "브론즈",
  silver: "실버",
  gold: "골드",
  platinum: "플래티넘",
  diamond: "다이아몬드",
};
// 지금 내 티어 - 마지막으로 센 값을 들고 있다가 그대로 쓴다(없으면 아이언)
let myTierCache = { tier: "iron", score: 0, posts: 0, comments: 0, minutes: 0 };
function myTier() {
  return TIER_PERKS[myTierCache.tier] ? myTierCache.tier : "iron";
}
function myPerks() {
  return TIER_PERKS[myTier()];
}
// 점수: 게시글 10 / 댓글 3 / 런처 1시간 2
function tierScoreOf(posts, comments, minutes) {
  // 24-234차: 플레이 시간은 1시간에 1점
  return Math.floor((posts || 0) * 10 + (comments || 0) * 3 + (minutes || 0) / 60);
}
function tierKeyOf(score) {
  return (TIER_STEPS.find((t) => score >= t.min) || TIER_STEPS[TIER_STEPS.length - 1]).key;
}

// 런처를 켜 둔 시간(분). 5분마다 1씩 쌓는다 - 켜두기만 해도 오르지만 올라가는 속도가 느려서
// 게시글/댓글 쪽이 훨씬 빠르다(그게 의도다).
let tierMinuteTimer = null;
function startTierMinuteTimer() {
  if (tierMinuteTimer) return;
  tierMinuteTimer = setInterval(() => {
    store.set("launcher_minutes", (Number(store.get("launcher_minutes")) || 0) + 5);
  }, 5 * 60 * 1000);
}

async function countRows(table, column, value) {
  try {
    const rows = await supabaseFetch(
      `/${table}?${column}=eq.${encodeURIComponent(value)}&select=id&limit=2000`
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    return 0;
  }
}

// 내 티어를 다시 세서 표에 올린다
// 24-229차: 표에 없을 수도 있는 칸들(옛 표). 없으면 빼고 올리고/읽는다
const TIER_EXTRA_COLS = ["avatar", "frame", "theme_bg", "theme_accent"];
const tierMissingCols = new Set();
function myLookExtras() {
  const d = getPlayerData(getActivePlayerUuid()) || {};
  const frameItem = SHOP_COLORS.find((c) => c.id === d.equippedFrame);
  const modeItem = SHOP_COLORS.find((c) => c.id === d.equippedThemeMode);
  const colorItem = SHOP_COLORS.find((c) => c.id === d.equippedColor);
  return {
    frame: frameItem?.frame || null,
    theme_bg: modeItem?.hex || null,
    theme_accent: colorItem?.hex || modeItem?.plateColor || null,
  };
}
let tierSyncTimer = null;
function scheduleTierSync() {
  clearTimeout(tierSyncTimer);
  tierSyncTimer = setTimeout(() => tierSyncMine().catch(() => {}), 1500);
}
async function tierSyncMine() {
  const me = getMyIdentity();
  if (!me.uuid) return null;
  const minutes = Number(store.get("launcher_minutes")) || 0;
  const posts = await countRows("forum_posts", "author_uuid", me.uuid);
  const comments = await countRows("forum_replies", "author_uuid", me.uuid);
  const score = tierScoreOf(posts, comments, minutes);
  const tier = tierKeyOf(score);
  const row = {
    mc_uuid: String(me.uuid),
    nova_account_id: getMySiteIdentity().id ? String(getMySiteIdentity().id) : null,
    name: me.name,
    // 24-224차: "커뮤니티 프로필 사진은 마크 사진이 아니라 클라이언트 사진이야"
    // 내가 올린 클라이언트 프로필 사진 주소를 같이 올려둔다 - 남들이 내 사진을 보려면
    // 어딘가 공유된 곳에 있어야 하는데, 이 표가 이미 uuid 로 모두를 가리키고 있다.
    // 24-228차: 올린 사진은 active_uuid 쪽에 저장되므로 그쪽도 본다
    avatar: getPlayerData(me.uuid)?.avatarUrl || getPlayerData(getActivePlayerUuid())?.avatarUrl || null,
    play_minutes: minutes,
    posts,
    comments,
    score,
    tier,
    updated_at: new Date().toISOString(),
  };
  // 24-229차: 남들 카드에 쓰일 테두리·테마색도 같이 올린다
  Object.assign(row, myLookExtras());
  const postRow = (r) =>
    supabaseFetch(`/${TIERS_TABLE}?on_conflict=mc_uuid`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(r),
    });
  const stripMissing = (r) => {
    const out = { ...r };
    tierMissingCols.forEach((c) => delete out[c]);
    return out;
  };
  try {
    await postRow(stripMissing(row));
  } catch (err) {
    // 칸이 없는 옛 표면 그 칸만 빼고 다시 올린다
    const msg = String(err?.message || err);
    const missing = TIER_EXTRA_COLS.filter((c) => msg.includes(c));
    if (missing.length) {
      missing.forEach((c) => tierMissingCols.add(c));
      await postRow(stripMissing(row)).catch(() => {});
    }
    logToFile("[티어] 올리기 실패: " + msg);
  }
  myTierCache = { tier, score, posts, comments, minutes };
  return { tier, score, posts, comments, minutes };
}

// 런처가 켜져 있는 동안 시간을 쌓고, 10분마다 내 티어를 다시 센다
startTierMinuteTimer();
setTimeout(() => tierSyncMine().catch(() => {}), 20 * 1000);
setInterval(() => tierSyncMine().catch(() => {}), 10 * 60 * 1000);

// 24-224차: 보관함 > 티어 칸에서 쓰는 값 - 지금 티어 / 다음 티어까지 / 칸마다의 혜택
ipcMain.handle("tier:info", async () => {
  const fresh = await tierSyncMine();
  const cur = fresh || myTierCache;
  const order = ["iron", "bronze", "silver", "gold", "platinum", "diamond"];
  const idx = order.indexOf(cur.tier);
  const next = order[idx + 1] || null;
  const nextMin = next ? TIER_STEPS.find((t) => t.key === next).min : null;
  return {
    ok: true,
    tier: cur.tier,
    label: TIER_LABEL[cur.tier],
    score: cur.score,
    posts: cur.posts,
    comments: cur.comments,
    minutes: cur.minutes,
    next,
    nextLabel: next ? TIER_LABEL[next] : null,
    nextMin,
    serverExtra: hostedServerLimit().extra, // 24-229차
    steps: order.map((k) => ({
      key: k,
      label: TIER_LABEL[k],
      min: TIER_STEPS.find((t) => t.key === k).min,
      ...TIER_PERKS[k],
    })),
  };
});

ipcMain.handle("tier:mine", async () => {
  const res = await tierSyncMine();
  return res ? { ok: true, ...res } : { ok: false };
});

// 화면에 보이는 사람들의 티어를 한 번에 읽어온다
ipcMain.handle("tier:lookup", async (_e, { mcUuids = [], accountIds = [] } = {}) => {
  const out = {};
  // 24-229차: 카드용으로 마크 이름·테두리·테마색까지 읽는다(없는 칸은 뺀다)
  const cols = ["mc_uuid", "nova_account_id", "name", "tier", "score", ...TIER_EXTRA_COLS.filter((c) => !tierMissingCols.has(c))];
  const sel = cols.join(",");
  const inList = (arr) => "(" + arr.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",") + ")";
  const toV = (r) => ({
    tier: r.tier,
    score: r.score,
    avatar: r.avatar || null,
    mcName: r.name || null,
    mcUuid: r.mc_uuid || null,
    frame: r.frame || null,
    themeBg: r.theme_bg || null,
    themeAccent: r.theme_accent || null,
  });
  try {
    if (mcUuids.length) {
      const rows = await supabaseFetch(`/${TIERS_TABLE}?mc_uuid=in.${inList(mcUuids.slice(0, 100))}&select=${sel}`);
      (rows || []).forEach((r) => {
        const v = toV(r);
        out[r.mc_uuid] = v;
        if (r.nova_account_id) out[r.nova_account_id] = v;
      });
    }
    if (accountIds.length) {
      const rows = await supabaseFetch(
        `/${TIERS_TABLE}?nova_account_id=in.${inList(accountIds.slice(0, 100))}&select=${sel}`
      );
      (rows || []).forEach((r) => {
        const v = toV(r);
        if (r.nova_account_id) out[r.nova_account_id] = v;
        out[r.mc_uuid] = v;
      });
    }
  } catch (err) {
    const msg = String(err?.message || err);
    const missing = TIER_EXTRA_COLS.filter((c) => msg.includes(c));
    missing.forEach((c) => tierMissingCols.add(c)); // 다음 호출부터 그 칸 없이 읽는다
    return { ok: false, error: msg || "티어를 읽지 못했어요." };
  }
  // 24-228차: 내 사진은 표에 올라가기 전이라도 바로 보이게 로컬 값으로 채운다
  // 24-229차: 테두리·테마색도 내 것은 로컬 값으로
  try {
    const mine = getPlayerData(getActivePlayerUuid())?.avatarUrl || getPlayerData(getMyIdentity().uuid)?.avatarUrl;
    const look = myLookExtras();
    const myKeys = [getMyIdentity().uuid, getActivePlayerUuid(), getMySiteIdentity().id].filter(Boolean).map(String);
    myKeys.forEach((k) => {
      if (!(mcUuids.includes(k) || accountIds.includes(k))) return;
      out[k] = {
        ...(out[k] || { tier: myTierCache?.tier || "iron", score: myTierCache?.score || 0, mcName: getMyIdentity().name }),
        ...(mine ? { avatar: mine } : {}),
        frame: look.frame,
        themeBg: look.theme_bg,
        themeAccent: look.theme_accent,
      };
    });
  } catch (_) {}
  return { ok: true, tiers: out };
});

// 공지사항 중 가장 최근 것 하나 - 커뮤니티 아이콘의 빨간 점에 쓴다
ipcMain.handle("forum:latest-notice", async () => {
  try {
    const rows = await supabaseFetch(
      `/forum_posts?category=eq.${encodeURIComponent("공지사항")}&select=id,title,created_at&order=created_at.desc&limit=1`
    );
    const row = (rows || [])[0];
    return { ok: true, notice: row || null };
  } catch (err) {
    return { ok: false, error: err?.message || "공지를 읽지 못했어요." };
  }
});


// ============================================================================
// 24-217차: 멤버 구독 - 구독한 사람이 글을 올리면 알림함에 뜬다
// "맴버 구독 만들어서 구독한 사람 게시글 알림받을 수 있게 만들어줘"
//
// 구독 한 줄에 "내가 이 사람 글을 어디까지 봤는지"(last_seen_post_at) 를 같이 들고 있어서,
// 새 글 판단에 다른 저장소가 필요 없다. 글 자체는 이미 forum_posts 에 다 있으니, 구독한
// 사람들의 uuid 로 그 시각 이후 글만 가져오면 그게 곧 알림이다.
// (표 만들기: Nova-Site/sql/2026-10-02_forum_subscriptions.sql)
// ============================================================================
const SUBS_TABLE = "nova_forum_subscriptions";

// 24-219차: "구독은 한번 취소하면 5시간 뒤에 다시 구독할 수 있게"
// 취소해도 줄을 지우지 않고 cancelled_at 만 찍는다(지워버리면 언제 취소했는지를 알 길이
// 없어서 쿨다운을 걸 수가 없다). 그래서 "구독 중"은 줄이 있고 cancelled_at 이 비어 있는 것.
const SUBS_COOLDOWN_MS = 5 * 60 * 60 * 1000;

async function mySubscriptionRows() {
  const me = getMyIdentity();
  if (!me.uuid) return [];
  try {
    const rows = await supabaseFetch(
      `/${SUBS_TABLE}?subscriber_uuid=eq.${encodeURIComponent(me.uuid)}&select=*&order=created_at.desc`
    );
    return rows || [];
  } catch (_) {
    return [];
  }
}
// 지금 실제로 구독 중인 것만
async function mySubscriptions() {
  return (await mySubscriptionRows()).filter((r) => !r.cancelled_at);
}

ipcMain.handle("subs:list", async () => ({ ok: true, subs: await mySubscriptions() }));

ipcMain.handle("subs:is-subscribed", async (_e, authorUuid) => {
  const rows = await mySubscriptionRows();
  const row = rows.find((r) => r.author_uuid === authorUuid);
  if (!row) return { ok: true, subscribed: false, cooldownMs: 0 };
  if (!row.cancelled_at) return { ok: true, subscribed: true, cooldownMs: 0 };
  const left = SUBS_COOLDOWN_MS - (Date.now() - new Date(row.cancelled_at).getTime());
  return { ok: true, subscribed: false, cooldownMs: Math.max(0, left) };
});

// 누르면 구독, 다시 누르면 해제
ipcMain.handle("subs:toggle", async (_e, { authorUuid, authorName } = {}) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인이 필요해요." };
  if (!authorUuid) return { ok: false, error: "대상을 찾을 수 없어요." };
  if (authorUuid === me.uuid) return { ok: false, error: "자기 자신은 구독할 수 없어요." };

  const rows = await mySubscriptionRows();
  const existing = rows.find((r) => r.author_uuid === authorUuid);
  const now = new Date().toISOString();
  try {
    // 구독 중 → 취소 (줄은 남기고 취소 시각만 찍는다)
    if (existing && !existing.cancelled_at) {
      try {
        // 바뀐 줄을 돌려받아 실제로 바뀌었는지 확인(수정 권한이 없으면 오류 없이 0줄이 돌아온다)
        const changed = await supabaseFetch(`/${SUBS_TABLE}?id=eq.${existing.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ cancelled_at: now }),
        });
        if (!Array.isArray(changed) || !changed.length) throw new Error("cancelled_at not updated");
      } catch (err) {
        // 24-248차: "구독 해제도 안돼" - cancelled_at 칸이 없는 옛 표(칸 추가 전에 만든 표)면
        // 취소 시각을 못 적는다. 그럴 땐 줄을 지워서라도 취소한다(이 경우 5시간 대기는 없음).
        if (!/cancelled_at/.test(String(err?.message || ""))) throw err;
        const removed = await supabaseFetch(`/${SUBS_TABLE}?id=eq.${existing.id}`, {
          method: "DELETE",
          headers: { Prefer: "return=representation" },
        });
        if (!Array.isArray(removed) || !removed.length) {
          return { ok: false, error: "구독 취소 권한이 없어요 (2026-10-02_forum_subscriptions_fix.sql 실행 필요)" };
        }
        return { ok: true, subscribed: false, cooldownMs: 0 };
      }
      return { ok: true, subscribed: false, cooldownMs: SUBS_COOLDOWN_MS };
    }
    // 취소한 적 있음 → 5시간이 지나야 다시
    if (existing) {
      const left = SUBS_COOLDOWN_MS - (Date.now() - new Date(existing.cancelled_at).getTime());
      if (left > 0) {
        const h = Math.floor(left / 3600000);
        const m = Math.ceil((left % 3600000) / 60000);
        return {
          ok: false,
          cooldownMs: left,
          error: `구독을 취소한 뒤에는 5시간 뒤에 다시 구독할 수 있어요 (${h > 0 ? `${h}시간 ` : ""}${m}분 남음)`,
        };
      }
      await supabaseFetch(`/${SUBS_TABLE}?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          cancelled_at: null,
          author_name: String(authorName || existing.author_name || "").slice(0, 40),
          last_seen_post_at: now,
        }),
      });
      return { ok: true, subscribed: true };
    }
    await supabaseFetch(`/${SUBS_TABLE}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        subscriber_uuid: String(me.uuid),
        author_uuid: String(authorUuid),
        author_name: String(authorName || "").slice(0, 40),
        // 구독한 순간 이전 글까지 알림으로 쏟아지면 곤란하다 - 지금부터가 기준
        last_seen_post_at: now,
      }),
    });
    return { ok: true, subscribed: true };
  } catch (err) {
    return { ok: false, error: err?.message || "구독에 실패했어요." };
  }
});

// 구독한 사람들이 내가 마지막으로 본 뒤에 올린 글
ipcMain.handle("subs:new-posts", async () => {
  const subs = await mySubscriptions();
  if (!subs.length) return { ok: true, posts: [] };
  // 가장 오래된 기준 시각 한 번으로 긁어오고, 사람마다의 기준은 아래에서 다시 거른다
  const since = subs
    .map((r) => r.last_seen_post_at || r.created_at)
    .sort()[0];
  const uuids = subs.map((r) => `"${String(r.author_uuid).replace(/"/g, "")}"`).join(",");
  try {
    const rows = await supabaseFetch(
      `/forum_posts?author_uuid=in.(${uuids})&created_at=gt.${encodeURIComponent(since)}` +
        `&select=id,title,category,author_uuid,author_name,created_at&order=created_at.desc&limit=50`
    );
    const seenBy = {};
    subs.forEach((r) => {
      seenBy[r.author_uuid] = r.last_seen_post_at || r.created_at;
    });
    const posts = (rows || []).filter((p) => p.created_at > (seenBy[p.author_uuid] || ""));
    return { ok: true, posts };
  } catch (err) {
    return { ok: false, error: err?.message || "구독 글을 읽지 못했어요." };
  }
});

// 24-218차: 나를 구독한 사람들(구독자)
ipcMain.handle("subs:followers", async () => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: true, followers: [] };
  try {
    const rows = await supabaseFetch(
      `/${SUBS_TABLE}?author_uuid=eq.${encodeURIComponent(me.uuid)}&cancelled_at=is.null` +
        `&select=id,subscriber_uuid,created_at&order=created_at.desc&limit=200`
    );
    // 구독자 닉네임은 티어 표에 이름이 같이 들어가 있어서 그걸로 채운다(없으면 uuid 앞자리)
    const list = rows || [];
    let names = {};
    if (list.length) {
      const inList = "(" + list.map((r) => `"${String(r.subscriber_uuid).replace(/"/g, "")}"`).join(",") + ")";
      try {
        const t = await supabaseFetch(`/${TIERS_TABLE}?mc_uuid=in.${inList}&select=mc_uuid,name`);
        (t || []).forEach((r) => {
          names[r.mc_uuid] = r.name;
        });
      } catch (_) {}
    }
    return {
      ok: true,
      followers: list.map((r) => ({ ...r, name: names[r.subscriber_uuid] || String(r.subscriber_uuid).slice(0, 8) })),
    };
  } catch (err) {
    return { ok: false, error: err?.message || "구독자를 읽지 못했어요." };
  }
});

// 구독한 사람들의 최근 글 모아보기 ("구독자 게시글만 볼 수 있게")
ipcMain.handle("subs:feed", async () => {
  const subs = await mySubscriptions();
  if (!subs.length) return { ok: true, posts: [] };
  const uuids = subs.map((r) => `"${String(r.author_uuid).replace(/"/g, "")}"`).join(",");
  try {
    const rows = await supabaseFetch(
      `/forum_posts?author_uuid=in.(${uuids})&select=id,title,category,author_uuid,author_name,created_at` +
        `&order=created_at.desc&limit=60`
    );
    return { ok: true, posts: rows || [] };
  } catch (err) {
    return { ok: false, error: err?.message || "구독 글을 읽지 못했어요." };
  }
});

// 알림함에서 확인했으면 그 사람(또는 전체) 기준 시각을 지금으로
ipcMain.handle("subs:mark-seen", async (_e, authorUuid) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: true };
  const now = new Date().toISOString();
  const where = authorUuid
    ? `subscriber_uuid=eq.${encodeURIComponent(me.uuid)}&author_uuid=eq.${encodeURIComponent(authorUuid)}`
    : `subscriber_uuid=eq.${encodeURIComponent(me.uuid)}`;
  try {
    await supabaseFetch(`/${SUBS_TABLE}?${where}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen_post_at: now }),
    });
  } catch (_) {}
  return { ok: true };
});


// ============================================================================
// 24-221차: 친구 폴더 - "친구창도 폴더 만들어서 정리할 수 있게 해줘 따로"
//
// 폴더는 "내가 내 친구 목록을 보기 좋게 묶는 것"일 뿐이라 서버에 올릴 이유가 없다.
// 상대에게도, 다른 사람에게도 안 보이고 내 컴퓨터에만 남는다(= 표를 새로 안 만들어도 된다).
//   friend_folders    : [{ id, name }]  - 만든 순서대로
//   friend_folder_map : { 친구계정id: 폴더id } - 어디에도 안 넣은 친구는 "일반"에 남는다
// ============================================================================
function getFriendFolders() {
  const v = store.get("friend_folders");
  return Array.isArray(v) ? v : [];
}
function getFriendFolderMap() {
  const v = store.get("friend_folder_map");
  return v && typeof v === "object" ? v : {};
}

// 24-229차: 친구 메모 - 내 컴퓨터에만 남는다. { 친구계정id: 글 }
function getFriendMemos() {
  const v = store.get("friend_memos");
  return v && typeof v === "object" ? v : {};
}
ipcMain.handle("friends:memos", () => ({ ok: true, memos: getFriendMemos() }));
ipcMain.handle("friends:memo-set", (_e, { id, text } = {}) => {
  if (!id) return { ok: false };
  const memos = getFriendMemos();
  const clean = String(text || "").trim().slice(0, 80);
  if (clean) memos[String(id)] = clean;
  else delete memos[String(id)];
  store.set("friend_memos", memos);
  return { ok: true, memos };
});

ipcMain.handle("friends:folders", () => ({
  ok: true,
  folders: getFriendFolders(),
  map: getFriendFolderMap(),
}));

ipcMain.handle("friends:folder-create", (_e, name) => {
  const clean = String(name || "").trim().slice(0, 20);
  if (!clean) return { ok: false, error: "폴더 이름을 입력해주세요." };
  const folders = getFriendFolders();
  if (folders.length >= 12) return { ok: false, error: "폴더는 12개까지 만들 수 있어요." };
  if (folders.some((f) => f.name === clean)) return { ok: false, error: "같은 이름의 폴더가 있어요." };
  const folder = { id: `ff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: clean };
  folders.push(folder);
  store.set("friend_folders", folders);
  return { ok: true, folder, folders };
});

ipcMain.handle("friends:folder-rename", (_e, { id, name } = {}) => {
  const clean = String(name || "").trim().slice(0, 20);
  if (!clean) return { ok: false, error: "폴더 이름을 입력해주세요." };
  const folders = getFriendFolders();
  const row = folders.find((f) => f.id === id);
  if (!row) return { ok: false, error: "폴더를 찾을 수 없어요." };
  if (folders.some((f) => f.id !== id && f.name === clean)) return { ok: false, error: "같은 이름의 폴더가 있어요." };
  row.name = clean;
  store.set("friend_folders", folders);
  return { ok: true, folders };
});

// 폴더만 없앤다 - 그 안에 있던 친구는 "일반"으로 돌아갈 뿐 친구 관계는 그대로다
ipcMain.handle("friends:folder-remove", (_e, id) => {
  const folders = getFriendFolders().filter((f) => f.id !== id);
  store.set("friend_folders", folders);
  const map = getFriendFolderMap();
  Object.keys(map).forEach((k) => {
    if (map[k] === id) delete map[k];
  });
  store.set("friend_folder_map", map);
  return { ok: true, folders, map };
});

ipcMain.handle("friends:folder-assign", (_e, { accountId, folderId } = {}) => {
  if (!accountId) return { ok: false, error: "친구를 찾을 수 없어요." };
  const map = getFriendFolderMap();
  if (folderId) map[accountId] = folderId;
  else delete map[accountId];
  store.set("friend_folder_map", map);
  return { ok: true, map };
});

// 폴더 순서 바꾸기(위/아래)
ipcMain.handle("friends:folder-move", (_e, { id, dir } = {}) => {
  const folders = getFriendFolders();
  const i = folders.findIndex((f) => f.id === id);
  if (i < 0) return { ok: false };
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= folders.length) return { ok: true, folders };
  [folders[i], folders[j]] = [folders[j], folders[i]];
  store.set("friend_folders", folders);
  return { ok: true, folders };
});

function getMyIdentity() {
  const profile = store.get("mc_profile");
  return { uuid: profile?.uuid || null, name: profile?.name || "알 수 없음" };
}

// 24-23차: "친구는 마크 계정끼리가 아니라 노바클 계정끼리, 노바클 닉네임으로" - 친구/귓속말/
// 온라인표시는 이제 마인크래프트 계정이 아니라 "노바 클라이언트(사이트) 계정" 단위로 묶임(한
// 사이트 계정에 마인크래프트 계정을 여러 개 연동할 수 있게 되면서, 어떤 마인크래프트 계정으로
// 접속 중이냐에 따라 친구 관계가 갈라지면 안 되기 때문 -
// sql/2026-08-30_friends_nova_account_identity.sql 참고). getMyIdentity()(마인크래프트
// uuid, 포럼/코인/스킨용)와는 별개 - id가 null이면 사이트 계정 로그인이 안 된 상태(게스트)라
// 호출한 쪽에서 로그인 필요 안내를 띄워야 함.
function getMySiteIdentity() {
  return {
    id: cachedSiteSession?.accountId || null,
    name: cachedSiteAccountFull?.nickname || cachedSiteAccountFull?.login_id || cachedSiteSession?.loginId || "알 수 없음",
  };
}

// 마인크래프트 계정 uuid는 대시(-) 없는 32자 형태로 오는데(mclc/Mojang API),
// Supabase에 uuid 타입 컬럼으로 저장했다가 돌려받으면 대시가 붙은 표준 형태로 바뀜.
// 그래서 "내 uuid"(대시 없음)와 "DB에서 받아온 uuid"(대시 있음)를 그냥 === 로 비교하면
// 같은 사람인데도 항상 다르다고 나오는 버그가 생김 -> 비교 전에 항상 이걸로 정규화
function normalizeUuid(u) {
  return String(u || "").replace(/-/g, "").toLowerCase();
}
function isSameUuid(a, b) {
  if (!a || !b) return false;
  return normalizeUuid(a) === normalizeUuid(b);
}

// 24-23차: "프로필 게시글만 보기가 아무것도 안 나오네 글을 썼는데, 게시글 쓴 카운트도 안됨" -
// forum_posts.author_uuid를 쿼리할 때 지금 들고 있는 uuid 문자열 그대로만(eq.) 비교하고
// 있었음. 24-21차에 마인크래프트 연동 확인에서 이미 겪었던 것과 같은 종류의 문제 -
// 마인크래프트 uuid는 원래 대시 없는 32자로 오는데, author_uuid는 라운드를 거치며 대시
// 있는/없는 형태가 섞여 저장됐을 수 있음(컬럼 타입/저장 시점에 따라 달라짐 - 이 sandbox에서
// 실제 데이터를 조회해 확인할 방법이 없어 방어적으로 두 형태 다 처리함). "정확히 이 문자열과
// 똑같아야만" 매칭되는 eq. 필터 대신, 대시 없는/있는 두 형태를 모두 in. 필터로 같이 조회해서
// 어느 쪽으로 저장돼 있어도 항상 찾아지게 함.
function uuidDashedVariant(u) {
  const n = normalizeUuid(u);
  if (n.length !== 32) return null;
  return `${n.slice(0, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}-${n.slice(20)}`;
}
function authorUuidInFilter(uuid) {
  const dashless = normalizeUuid(uuid);
  const dashed = uuidDashedVariant(uuid);
  const variants = dashed && dashed !== dashless ? [dashless, dashed] : [dashless];
  return `author_uuid=in.(${variants.join(",")})`;
}

// 코인이 바뀔 때마다 호출해서 Supabase에도 동기화 (포럼에서 다른 사람 코인 보여주려고)
async function syncCoinsToSupabase(uuid, name, coins) {
  if (!uuid) return;
  try {
    await supabaseFetch("/user_profiles", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ uuid, mc_name: name, coins, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    logToFile("코인 Supabase 동기화 실패: " + (err?.message || err));
  }
}

ipcMain.handle("app:is-admin", () => {
  return isDevAccount();
});

// ----------------------------------------------------------------------------
// 24-4차: "클라이언트도 사이트처럼 전용 계정 로그인통해서 하게 할 거고 마크 계정 등록하게
// 해줘 마크 계정 등록 안하면 게스트로 판단하고 계정에서 스킨 등을 구매하면 등록한 마크 계정
// 모두가 사용할 수 있는 시스템으로 하고 클라이언트는 한 곳에서만 로그인할 수 있게 해줘
// 여러 곳에서 동시 로그인이 안되게" - Phase 2 (24차 Phase 1의 연동 뼈대를 진짜 로그인
// 시스템으로 확장함. sql/2026-08-28_site_account_login_and_shared_shop.sql 을 Supabase에서
// 먼저 실행해야 동작함.)
//
// 이제 클라이언트는 마이크로소프트 로그인 전에 "사이트 계정"(아이디/비번)으로 먼저 로그인해야
// 하고, 그 사이트 계정에 마인크래프트 계정을 하나 이상 연동(=등록)해야 게스트가 아니게 됨.
// 등록은 별도 화면 없이, 사이트 계정 로그인 상태에서 마이크로소프트 로그인/계정 전환에
// 성공하는 순간 자동으로 이뤄짐(linkMinecraftUuidToActiveSiteAccount). 코인/상점(구매한
// 스킨 색 등)/출석/퀘스트 데이터는 이제 마인크래프트 uuid가 아니라 "사이트 계정" 기준으로
// 저장돼서, 같은 사이트 계정에 연동된 마인크래프트 계정이면 전부 공유해서 씀 - 이건
// getPlayerData/setPlayerField(아래쪽, player_data 섹션) 두 함수 안에서만 갈라주고, 그걸
// 호출하는 shop:buy 등 다른 코드는 전혀 안 건드림(영향 범위를 최소화하기 위함).
//
// * 보안 주의 *: 이 프로젝트는 모든 Supabase 테이블의 RLS를 열어둔 상태라(select/insert/
// update/delete를 anon key만으로 전부 허용) 여기서 다루는 비밀번호 해시(password_hash)나
// 세션 토큰(active_session_token)도 "클라이언트 코드가 그 규칙을 지킬 때만" 의미가 있는
// 보호일 뿐, DB 자체가 막아주지는 않음. 조작된 클라이언트(또는 Supabase REST API를 직접
// 호출)로는 다른 사이트 계정의 비밀번호 해시를 읽거나 active_session_token을 마음대로
// 덮어써서 "한 곳에서만 로그인" 제한을 우회하는 것도 가능함 - 이 앱의 다른 기능들도 처음부터
// 전부 이런 구조였어서 새로 생긴 문제는 아니지만, 이번엔 진짜 비밀번호가 걸리는 첫 기능이라
// 특히 강조함. 그래서 최소 길이만 아주 약하게 걸어두고(친구들끼리 쓰는 런처 수준 보호),
// 다른 사이트에서 쓰는 진짜 비밀번호는 여기 재사용하지 말라고 화면에서 안내함.

// 24-10차: "진짜 계정 통합" - 예전엔 이 런처가 site_accounts/site_account_links라는 완전히
// 별도인 계정 시스템을 Supabase RPC로 직접 두드렸는데, 알고 보니 Nova Site(웹사이트)가 이미
// 갖고 있던 nova_accounts가 애초부터 "나중에 앱에서 마인크래프트 계정을 연결하는 기능이
// 생기면 채운다"는 계획으로 만들어져 있었음(sql/2026-08-29_launcher_account_integration.sql
// 참고). 그래서 site_accounts 시스템은 걷어내고, 이제부터는 Nova Site가 새로 연 서버 API
// (/api/app/account/*)를 통해 그 nova_accounts 계정으로 로그인/회원가입하고, 로그인된 그
// 계정에 마인크래프트 계정을 하나씩 등록(연동)하는 방식으로 바뀜. 비밀번호 해시 비교/세션
// 토큰 발급 등은 전부 서버(Nova Site) 쪽 코드가 처리하므로, 여기서는 더 이상 scrypt 해시를
// 계산하거나 비교하지 않음(비밀번호는 HTTPS로만 그대로 전송 - 웹사이트 자체 로그인 폼과 동일).
//
// 코인도 이번에 하나로 합쳐짐: 사이트에서 실제 결제로 산 코인과 런처에서 출석/퀘스트/상점으로
// 벌고 쓰던 코인이 전부 nova_accounts.coins 하나의 지갑을 씀(아래 player_data 섹션 참고).

// "다른 기기에서 로그인해서 로그아웃됨" 안내에 쓸, 대충 어느 기기였는지 알려주는 이름표
function deviceLabel() {
  try {
    return os.hostname() || "이 기기";
  } catch (_) {
    return "이 기기";
  }
}

// 24-112차: "마크 계정은 한 곳에서 로그인하면 이전에 로그인돼 있던 계정이 로그아웃되는 시스템"
// 기기를 구분할 고정 id(설치할 때 한 번 만들어 계속 씀 - 기기 이름은 바뀔 수 있어서 따로 둠).
function getDeviceId() {
  let id = store.get("device_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    store.set("device_id", id);
  }
  return id;
}

// 이 마인크래프트 계정을 "이 기기가 쓴다"고 서버에 표시함. 다른 기기가 쓰고 있었으면 그 기기는
// 다음 하트비트(최대 45초) 때 그 계정에서 로그아웃됨. 실패해도 로그인 자체는 막지 않음(조용히 넘어감).
async function claimMinecraftSessionForThisDevice(uuid, name) {
  if (!cachedSiteSession?.accountId || !uuid) return { ok: false };
  try {
    const res = await novaSiteFetch("claim-minecraft", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      uuid,
      name: name || null,
      deviceId: getDeviceId(),
      device: deviceLabel(),
    });
    if (res?.ok && res.kickedPrevious) {
      logToFile(`[마크 세션] ${name || uuid}: 이전 기기(${res.previousDevice || "다른 기기"})에서 이 기기로 가져옴`);
    }
    return res || { ok: false };
  } catch (err) {
    logToFile("[마크 세션] 가져오기 실패(무시): " + (err?.message || err));
    return { ok: false };
  }
}

// 다른 기기가 가져간 마인크래프트 계정을 이 기기에서 지움(= 로그아웃).
// 지금 쓰고 있던 계정이었으면 활성 계정도 비워서 런처가 "마크 계정 연동" 화면으로 돌아가게 함.
function logoutMinecraftAccountsLocally(uuids) {
  const targets = (uuids || []).map((u) => normalizeUuid(u)).filter(Boolean);
  if (!targets.length) return { removed: [], activeRemoved: false };
  const accounts = getAccounts();
  const removed = [];
  for (const key of Object.keys(accounts)) {
    if (!targets.includes(normalizeUuid(key))) continue;
    removed.push({ uuid: key, name: accounts[key]?.name || null });
    delete accounts[key];
  }
  if (!removed.length) return { removed: [], activeRemoved: false };
  store.set("accounts", accounts);
  const activeUuid = store.get("active_uuid");
  let activeRemoved = false;
  if (activeUuid && targets.includes(normalizeUuid(activeUuid))) {
    store.delete("active_uuid");
    store.delete("mc_profile");
    cachedAuthorization = null;
    activeRemoved = true;
  }
  logToFile(`[마크 세션] 다른 기기에서 로그인해서 로컬 로그아웃: ${removed.map((r) => r.name || r.uuid).join(", ")}`);
  return { removed, activeRemoved };
}

// Nova Site 서버의 런처 전용 계정 API(app/api/app/account/*) 호출 헬퍼. 브라우저처럼 쿠키
// 세션을 못 들고 있어서, 응답으로 받은 session_token을 직접 저장해뒀다가 매 요청마다 body에
// 같이 실어보내는 방식(로그인 성공 시 새 토큰이 발급되면서 다른 기기의 기존 세션은 끊김).
// 24-171차: 웹사이트가 쓰는 계정 API(/api/account/...). 런처 전용 API(/api/app/account/...)와
// 달리 이쪽은 사람이 브라우저에서 쓰는 흐름이라 세션이 필요 없는 것들이 있다 -
// 비밀번호 찾기(메일 인증 코드)가 바로 그거라서, 사이트에 이미 있는 걸 런처가 그대로 쓴다.
async function novaSiteWebFetch(endpoint, body) {
  const res = await fetch(`${CONFIG.NOVA_SITE_API_BASE}/api/account/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  try {
    return (await res.json()) || { ok: false };
  } catch (_) {
    return { ok: false, error: "서버 응답을 읽지 못했어요." };
  }
}

async function novaSiteFetch(endpoint, body) {
  const res = await fetch(`${CONFIG.NOVA_SITE_API_BASE}/api/app/account/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  try {
    return (await res.json()) || { ok: false };
  } catch (_) {
    return { ok: false, error: "서버 응답을 읽지 못했어요." };
  }
}

// 지금 이 클라이언트가 로그인해있는 사이트/런처 계정 세션 (앱이 켜져있는 동안만 메모리에
// 보관 - 재시작하면 store의 "site_session"으로 다시 확인해서 복원함 - siteauth:get-cached 참고)
let cachedSiteSession = null; // { accountId, loginId, sessionToken, deviceName }
let cachedSiteAccountFull = null; // Nova Site API가 돌려준 account(+links 포함) JSON 그대로 (설정 화면 등에서 씀)
let cachedSiteAccountData = null; // shared_player_data (코인 제외 - coinLog/상점/출석/퀘스트) 메모리 캐시. 코인 자체는 cachedSiteAccountFull.coins에 있음
let cachedSiteAccountLinkedUuids = new Set(); // 이 사이트 계정에 연동된 마인크래프트 uuid들(정규화됨)
let siteAccountSaveTimer = null;

// Nova Site API가 돌려준 account(+links가 이미 합쳐져서 들어있음) JSON을 메모리 캐시 3개에
// 한꺼번에 반영함 - 여러 곳에서 캐시를 따로따로 갱신하다가 서로 어긋나는 걸 막기 위해, 계정
// 상태가 바뀌는 모든 곳(로그인/등록/연동/연동해제/재확인)에서 이 함수 하나만 씀.
function applySiteAccountRow(account) {
  cachedSiteAccountFull = account || null;
  cachedSiteAccountData =
    account?.shared_player_data && typeof account.shared_player_data === "object"
      ? account.shared_player_data
      : {};
  cachedSiteAccountLinkedUuids = new Set(
    (account?.links || []).filter((l) => l.provider === "minecraft").map((l) => normalizeUuid(l.provider_uid))
  );
  // 24-142차: "친구 프로필에서 코인이 안보여"
  // 진짜 잔액은 사이트 계정(nova_accounts.coins)에 있는데, 남의 프로필을 열 때 보여주는
  // forum:get-user-info 는 Supabase 의 user_profiles.coins(옛 복사본)를 읽음. 그 복사본은
  // addCoins()가 "런처 안에서 코인이 오갈 때"만 갱신해서, 사이트에서 충전하거나 다른 기기에서
  // 쓴 변화는 영영 반영되지 않았고 남에게는 0이나 옛날 값이 보였음.
  // 이제 사이트 계정 정보가 새로 올 때마다(로그인/새로고침/하트비트) 연동된 마인크래프트
  // 계정들 쪽 복사본도 같이 맞춰줌. 실패해도 무시(표시용 값이라 실행에 영향 없음).
  syncSiteCoinsToProfiles();
}

// 사이트 계정의 코인을 연동된 마인크래프트 uuid 들의 user_profiles.coins 로 복사해 둠.
// 같은 값을 반복해서 쓰지 않도록 마지막으로 보낸 값을 기억함
let lastMirroredSiteCoins = null;
function syncSiteCoinsToProfiles() {
  try {
    const coins = cachedSiteAccountFull?.coins;
    if (typeof coins !== "number") return;
    if (lastMirroredSiteCoins === coins) return;

    const links = (cachedSiteAccountFull?.links || []).filter((l) => l.provider === "minecraft");
    if (links.length === 0) return;
    lastMirroredSiteCoins = coins;

    for (const l of links) {
      const uuid = normalizeUuid(l.provider_uid);
      if (!uuid) continue;
      const name = l.provider_name || store.get("mc_profile")?.name || "";
      syncCoinsToSupabase(uuid, name, coins).catch(() => {});
    }
  } catch (_) {
    /* 표시용이라 실패해도 무시 */
  }
}

// 24-12차 신규: 관리자(개발자 계정) 판별을 한 곳으로 모음 - "관리자 계정인데 왜 상점에서
// 코인이 부족하다고 나오냐"는 버그 리포트로 발견함. 이 앱 곳곳(상점 구매 우회, 프리셋
// 생성/삭제, 포럼 신고/정지/공지 관리 등 13곳)의 관리자 판별이 전부
// `store.get("mc_profile")?.name === CONFIG.DEV_ACCOUNT_NAME`(=지금 활성화된 마인크래프트
// 프로필 이름)만 보고 있었는데, 24-10차로 로그인 방식이 "사이트 계정이 진짜 정체성, 마인크래프트
// 계정은 그 밑에 여러 개 연동되는 하위 계정"으로 바뀐 뒤로는 이 비교가 안 맞을 수 있음
// (관리자가 알트 마인크래프트 계정을 선택 중이거나, CONFIG.DEV_ACCOUNT_NAME 값 자체가 사실
// 마인크래프트 닉네임이 아니라 사이트 계정 아이디/닉네임인 경우) - 그러면 관리자인데도 이
// 비교가 전부 실패해서 일반 유저와 똑같이 취급되고, 상점에서도 코인 우회 없이 진짜 잔액으로
// 검사당하게 됨. 사이트 계정 로그인 아이디/닉네임과 지금 활성화된 마인크래프트 프로필 이름
// 중 하나라도 CONFIG.DEV_ACCOUNT_NAME과 일치하면 관리자로 인정하도록 범위를 넓힘.
function isDevAccount() {
  // 24-66차: "a01051242995@gmail.com 이걸로 만든 계정 관리자 권한좀 넣어서 상점좀 이용
  // 가능하게 해줘 무료로" - 이 이메일로 가입/로그인된 사이트 계정은 이메일만으로 바로 관리자
  // 인정(닉네임을 나중에 바꾸거나 다른 이름으로 활동해도 계속 관리자로 인식됨). 아래
  // CONFIG.DEV_ACCOUNT_NAME 판별(닉네임/로그인 아이디 기준)과는 별개의 독립 경로.
  const email = String(cachedSiteAccountFull?.email || "").trim().toLowerCase();
  if (email && (CONFIG.ADMIN_EMAILS || []).some((e) => String(e).trim().toLowerCase() === email)) {
    return true;
  }

  // 24-66차: 24-14차 때 "일반 유저 화면 테스트를 위해" 임시로 넣어둔 return false; 우회가
  // 그 이후로 계속 남아있어서, 그동안 이 함수를 쓰는 모든 관리자 전용 기능(상점 무료 구매,
  // 프리셋 관리, 포럼 신고/정지/공지 관리 등 13곳)이 통째로 꺼져 있었음(발견) - 제거함.

  // 24-13차: "아직도... 구매 문제 해결 안됐다" - 24-12차에서 비교 대상(사이트 계정/마인크래프트
  // 프로필)은 넓혔지만, 여전히 대소문자나 앞뒤 공백이 하나라도 다르면 그냥 조용히 실패해서
  // 관리자 본인도 왜 안 되는지 알 수가 없었음. 표시용 값이 아니라 "이 사람이 개발자 계정이
  // 맞는지"만 판별하는 내부 비교라서, 대소문자/공백 차이는 다른 사람으로 취급할 이유가
  // 없다고 보고 비교 전에 둘 다 trim + 소문자로 맞춰서 비교함
  const target = String(CONFIG.DEV_ACCOUNT_NAME || "").trim().toLowerCase();
  if (!target) return false;
  // 24-66차: cachedSiteAccountFull?.nickname은 실제로 존재하지 않는 필드(Nova Site의
  // toAccountJson()이 내려주는 건 login_id/display_name이지 nickname이 아님) - 잠재 버그라
  // 같이 고침(login_id는 이미 있었으니 display_name으로 교체).
  const candidates = [
    cachedSiteAccountFull?.login_id,
    cachedSiteAccountFull?.display_name,
    cachedSiteSession?.loginId,
    store.get("mc_profile")?.name,
  ];
  return candidates.some((v) => typeof v === "string" && v.trim().toLowerCase() === target);
}

async function reloadActiveSiteAccount() {
  if (!cachedSiteSession?.accountId) {
    applySiteAccountRow(null);
    return null;
  }
  const res = await novaSiteFetch("verify-session", {
    accountId: cachedSiteSession.accountId,
    sessionToken: cachedSiteSession.sessionToken,
  });
  if (!res?.ok) {
    applySiteAccountRow(null);
    return null;
  }
  applySiteAccountRow(res.account);
  return cachedSiteAccountFull;
}

function isUuidLinkedToActiveSiteAccount(uuid) {
  if (!uuid || !cachedSiteSession) return false;
  return cachedSiteAccountLinkedUuids.has(normalizeUuid(uuid));
}

// 공용 데이터(shared_player_data)는 건드릴 때마다 바로 Supabase에 쓰면 너무 잦아서, 이
// 프로젝트의 다른 debounce 저장 패턴과 동일하게 800ms 동안 조용하면 그때 한 번만 저장함
function scheduleSiteAccountDataSave() {
  if (!cachedSiteSession?.accountId) return;
  if (siteAccountSaveTimer) clearTimeout(siteAccountSaveTimer);
  siteAccountSaveTimer = setTimeout(async () => {
    siteAccountSaveTimer = null;
    const accountId = cachedSiteSession?.accountId;
    const sessionToken = cachedSiteSession?.sessionToken;
    const data = cachedSiteAccountData;
    if (!accountId || !sessionToken || !data) return;
    try {
      await novaSiteFetch("set-shared-data", {
        accountId,
        sessionToken,
        data,
      });
    } catch (err) {
      logToFile("사이트 계정 공용 데이터 저장 실패: " + (err?.message || err));
    }
  }, 800);
}

// 기기별(로컬) player_data 저장소를 직접 읽고 쓰는 헬퍼. 사이트 계정 연동 여부와 무관하게
// "이 기기에 예전부터 있던 데이터"를 그대로 읽거나(마이그레이션 시딩용), 연동 안 된 계정의
// 데이터를 지금까지처럼 기기별로 저장할 때 씀.
function getLocalPlayerData(uuid) {
  if (!uuid) return {};
  const all = store.get("player_data") || {};
  return all[uuid] || {};
}
function setLocalPlayerField(uuid, field, value) {
  if (!uuid) return;
  const all = store.get("player_data") || {};
  if (!all[uuid]) all[uuid] = {};
  all[uuid][field] = value;
  store.set("player_data", all);
}

// 마인크래프트 계정을 사이트 계정에 처음 연동하는 순간, 그 계정이 로컬에 이미 갖고 있던
// 코인/상점/출석/퀘스트 데이터를 사이트 계정 공용 데이터로 한 번만 옮겨줌 - 사이트 계정 쪽
// 공용 데이터가 아예 비어있을 때만 그대로 복사함(이미 공용 데이터가 있으면 안 건드려서,
// 두 번째/세 번째 마인크래프트 계정을 연동할 때 첫 계정의 데이터를 덮어써버리는 걸 막음).
function maybeSeedSiteAccountDataFromLocal(uuid) {
  if (!cachedSiteSession || !cachedSiteAccountData) return;
  if (Object.keys(cachedSiteAccountData).length > 0) return;
  const local = getLocalPlayerData(uuid);
  if (!local || Object.keys(local).length === 0) return;
  cachedSiteAccountData = { ...local };
  scheduleSiteAccountDataSave();
}

// 지금 로그인해있는 사이트/런처 계정에 마인크래프트 계정을 연동함(="마크 계정 등록"). 설정
// 화면에서 다른 저장된 계정을 골라 수동으로 연동할 때와, 마이크로소프트 로그인/계정 전환에
// 성공했을 때 자동으로 등록할 때(auth:login, accounts:switch, getAuthorizationForLaunch)
// 이 함수 하나로 처리함. 이미 다른 사이트 계정에 연동된 마인크래프트 계정이면 조용히
// 건너뛰고 warning만 돌려줌 - 마이크로소프트 로그인 자체는 그대로 성공 처리되게.
// 24-10차: 서버(Nova Site)가 lib/mcAuth.js로 진짜 소유권을 검증하려면 지금 막 로그인/갱신한
// "진짜 유효한" 마인크래프트 액세스 토큰이 필요해서 mcAccessToken 인자가 새로 추가됨.
async function linkMinecraftUuidToActiveSiteAccount(uuid, name, mcAccessToken) {
  if (!cachedSiteSession?.accountId || !uuid) return { linked: false };
  if (isUuidLinkedToActiveSiteAccount(uuid)) return { linked: true };
  // 24-23차: "마크 계정당 노바클 계정 1개라고 노바클 계정은 마크 계정 여러개 된다고" -
  // 24-15차에 넣었던 "사이트 계정 하나에 마인크래프트 계정 딱 하나만" 제한을 반대 방향으로
  // 뒤집어달라는 요청. 원래 이 제한은 클라이언트(여기)에만 있었고, 서버(Nova Site
  // launcherLinkMinecraft)와 DB 스키마(nova_account_links는 애초에 (nova_account_id 아니라)
  // (provider, provider_uid) 조합만 유니크해서 한 계정에 마인크래프트 링크가 여러 개
  // 있어도 됨)는 처음부터 여러 개를 지원하도록 만들어져 있었음 - 그래서 여기 클라이언트
  // 쪽 가드만 없애면 됨. "마인크래프트 계정 1개는 사이트 계정 1개에만" 이라는 반대 방향
  // 제약은 서버가 이미 다른 계정 소유인 uuid를 거부하는 것으로 그대로 유지됨(아래
  // res.warning "이미 다른 사이트 계정에 등록된 마인크래프트 계정이에요" 분기).
  if (!mcAccessToken) return { linked: false, warning: "마인크래프트 인증 토큰을 찾을 수 없어요." };
  try {
    // "이미 다른 계정에 등록됐는지" 체크와 실제 연동 둘 다 서버(Nova Site) 쪽 launcherLinkMinecraft
    // 함수 안에서 세션 토큰 확인 + 마인크래프트 소유권 검증과 함께 원자적으로 처리됨.
    const res = await novaSiteFetch("link-minecraft", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      mcAccessToken,
      uuid,
      name,
    });
    if (!res?.ok) {
      return { linked: false, warning: res?.error || "마인크래프트 계정을 등록하지 못했어요." };
    }
    if (res.account) applySiteAccountRow(res.account);
    if (!res.linked) {
      return { linked: false, warning: res.warning || "이미 다른 사이트 계정에 등록된 마인크래프트 계정이에요." };
    }
    maybeSeedSiteAccountDataFromLocal(uuid);
    return { linked: true };
  } catch (err) {
    logToFile("마인크래프트 계정 자동 등록 실패: " + (err?.message || err));
    return { linked: false, warning: "마인크래프트 계정을 등록하지 못했어요." };
  }
}

function clearSiteSessionLocally() {
  // 24-187차: 계정이 바뀌면 "어디까지 봤는지" 기준도 지운다(새 계정의 옛 귓속말이
  // 방금 온 것처럼 뜨지 않게 - resetSocialSignalBaseline 참고)
  try { resetSocialSignalBaseline(); } catch (_) {}
  cachedSiteSession = null;
  cachedSiteAccountFull = null;
  cachedSiteAccountData = null;
  cachedSiteAccountLinkedUuids = new Set();
  store.delete("site_session");
}

// 로컬에 저장해둔 세션 토큰이 서버(Supabase)에 있는 값과 아직 같은지 다시 확인함. 다른
// 기기에서 로그인하면 서버 쪽 active_session_token이 새로 덮어써지므로, 여기서 false가
// 나오면 "다른 곳에서 로그인해서 여기는 로그아웃됨" 상태인 것. 네트워크 오류일 땐 세션을
// 끊지 않음(fail-open) - 반대로 앱을 새로 켤 때의 세션 복원(siteauth:get-cached)은 서버
// 확인이 안 되면 아예 막음(fail-closed) - 신뢰를 "새로" 세우는 쪽이라 더 보수적으로 감.
async function verifySiteSessionStillActive() {
  if (!cachedSiteSession?.accountId || !cachedSiteSession?.sessionToken) return false;
  try {
    const res = await novaSiteFetch("verify-session", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
    });
    return !!res?.ok;
  } catch (err) {
    logToFile("사이트 세션 확인 실패(네트워크 오류로 간주, 세션 유지): " + (err?.message || err));
    return true;
  }
}

// 24-10차: 회원가입 규칙이 웹사이트 가입(nova_accounts)과 완전히 동일해짐 - 이메일 +
// 비밀번호(8자 이상) + 닉네임(2~16자, 로그인 아이디로도 씀). 여기서 만든 계정은 그대로
// 웹사이트에서도 로그인되고, 반대도 마찬가지임.
// 24-239차: 회원가입 이메일 인증 코드 보내기
ipcMain.handle("siteauth:send-signup-code", async (_e, email) => {
  const em = String(email || "").trim();
  if (!em || !em.includes("@")) return { ok: false, error: "이메일 형식이 올바르지 않아요." };
  try {
    const res = await novaSiteFetch("send-code", { purpose: "signup", email: em });
    return res?.ok ? { ok: true } : { ok: false, error: res?.error || "인증 코드를 보내지 못했어요." };
  } catch (err) {
    return { ok: false, error: "서버에 연결하지 못했어요." };
  }
});
// 24-239차: 이미 가입한 계정의 이메일 인증(추천인 등에 필요)
ipcMain.handle("email:verify-send", async () => {
  if (!cachedSiteSession?.accountId) return { ok: false, error: "로그인이 필요해요." };
  try {
    const res = await novaSiteFetch("send-code", {
      purpose: "verify",
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
    });
    return res?.ok ? res : { ok: false, error: res?.error || "인증 코드를 보내지 못했어요." };
  } catch (err) {
    return { ok: false, error: "서버에 연결하지 못했어요." };
  }
});
ipcMain.handle("email:verify-confirm", async (_e, code) => {
  if (!cachedSiteSession?.accountId) return { ok: false, error: "로그인이 필요해요." };
  try {
    const res = await novaSiteFetch("verify-email", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      code: String(code || ""),
    });
    if (res?.ok && cachedSiteAccountFull) cachedSiteAccountFull.email_verified = true; // 24-240차
    return res?.ok ? { ok: true } : { ok: false, error: res?.error || "인증하지 못했어요." };
  } catch (err) {
    return { ok: false, error: "서버에 연결하지 못했어요." };
  }
});

ipcMain.handle("siteauth:register", async (_e, email, nickname, password, emailCode) => {
  const em = String(email || "").trim();
  const nick = String(nickname || "").trim();
  const pw = String(password || "");
  if (!em || !em.includes("@")) return { ok: false, error: "이메일 형식이 올바르지 않아요." };
  if (nick.length < 2) return { ok: false, error: "닉네임은 2자 이상이어야 해요." };
  if (pw.length < 8) return { ok: false, error: "비밀번호는 8자 이상이어야 해요." };
  try {
    const res = await novaSiteFetch("register", {
      email: em,
      nickname: nick,
      password: pw,
      device: deviceLabel(),
      emailCode: String(emailCode || ""), // 24-239차
    });
    if (!res?.ok) return { ok: false, error: res?.error || "계정을 만들지 못했어요." };

    cachedSiteSession = {
      accountId: res.account.id,
      loginId: res.account.login_id || nick,
      sessionToken: res.session_token,
      deviceName: deviceLabel(),
    };
    store.set("site_session", {
      accountId: res.account.id,
      loginId: cachedSiteSession.loginId,
      sessionToken: res.session_token,
    });
    applySiteAccountRow(res.account);
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("사이트 계정 회원가입 실패: " + (err?.message || err));
    return { ok: false, error: "계정을 만들지 못했어요. 네트워크를 확인해주세요." };
  }
});

// identifier는 이메일이든 닉네임(아이디)이든 둘 다 받음(웹사이트 로그인 폼과 동일).
ipcMain.handle("siteauth:login", async (_e, loginId, password) => {
  const id = String(loginId || "").trim();
  const pw = String(password || "");
  if (!id || !pw) return { ok: false, error: "아이디와 비밀번호를 입력해주세요." };
  try {
    // 비밀번호 비교는 서버(Nova Site) 쪽에서 이뤄짐 - 다른 기기가 로그인해있었더라도 여기서
    // 새 토큰으로 덮어써서 그 기기의 세션을 끊음. 그 기기에는 알림을 따로 보내지 않고, 다음
    // 하트비트나 재시작 때 스스로 발견하게 됨.
    const res = await novaSiteFetch("login", { identifier: id, password: pw, device: deviceLabel() });
    if (!res?.ok) return { ok: false, error: res?.error || "아이디 또는 비밀번호가 올바르지 않아요." };

    cachedSiteSession = {
      accountId: res.account.id,
      loginId: id,
      sessionToken: res.session_token,
      deviceName: deviceLabel(),
    };
    store.set("site_session", { accountId: res.account.id, loginId: id, sessionToken: res.session_token });
    applySiteAccountRow(res.account);
    // 24-173차: "연동돼 있는데 왜 또 마크 로그인을 시키냐" 를 추적하려면, 서버가 실제로
    // 연동 목록을 몇 개나 내려줬는지가 결정적이다(런처는 이 목록을 보고 게이트를 판단함)
    const mcLinks = (res.account?.links || []).filter((l) => l.provider === "minecraft");
    logToFile(
      `[사이트 로그인] ${id} - 연동된 마크 계정 ${mcLinks.length}개` +
        (mcLinks.length ? ` (${mcLinks.map((l) => l.provider_name || l.provider_uid).join(", ")})` : "")
    );
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("사이트 계정 로그인 실패: " + (err?.message || err));
    return { ok: false, error: "로그인에 실패했어요. 네트워크를 확인해주세요." };
  }
});

ipcMain.handle("siteauth:logout", async () => {
  // 로컬 캐시만 지우는 게 아니라 서버 쪽 세션 토큰도 같이 무효화함(내 세션 토큰이 맞을 때만
  // 지워지므로 다른 계정에 영향 없음) - 로그아웃한 세션이 서버에는 계속 "활성"으로 남아있는
  // 걸 방지함.
  try {
    if (cachedSiteSession?.accountId && cachedSiteSession?.sessionToken) {
      await novaSiteFetch("logout", {
        accountId: cachedSiteSession.accountId,
        sessionToken: cachedSiteSession.sessionToken,
      });
    }
  } catch (err) {
    logToFile("사이트 계정 로그아웃(서버 쪽) 실패(무시하고 로컬은 정상 로그아웃 처리): " + (err?.message || err));
  }
  clearSiteSessionLocally();
  return { ok: true };
});

// 렌더러가 주기적으로(45초마다, 친구 온라인 상태 하트비트와 같은 패턴) 호출함 - 살아있다는
// 걸 서버에 알리는 동시에, 다른 기기가 로그인해서 내 세션이 끊겼는지도 이 타이밍에 알게 됨
ipcMain.handle("siteauth:heartbeat", async () => {
  if (!cachedSiteSession?.accountId) return { ok: true, kicked: false };
  try {
    // 24-112차: 이 기기가 갖고 있는 마인크래프트 계정 목록도 같이 보내서, 다른 기기가
    // 가져간 계정이 있으면(mcKicked) 이 기기에서는 그 계정을 로그아웃함
    const localUuids = Object.keys(getAccounts());
    const res = await novaSiteFetch("heartbeat", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      deviceId: getDeviceId(),
      mcUuids: localUuids,
    });
    if (res?.kicked) {
      const device = res.device || "다른 기기";
      clearSiteSessionLocally();
      return { ok: true, kicked: true, device };
    }
    if (Array.isArray(res?.mcKicked) && res.mcKicked.length) {
      const info = logoutMinecraftAccountsLocally(res.mcKicked.map((m) => m.uuid));
      if (info.removed.length) {
        return {
          ok: true,
          kicked: false,
          mcKicked: info.removed.map((r, i) => ({
            name: r.name || res.mcKicked[i]?.name || null,
            device: res.mcKicked.find((m) => normalizeUuid(m.uuid) === normalizeUuid(r.uuid))?.device || null,
          })),
          mcActiveRemoved: info.activeRemoved,
        };
      }
    }
    return { ok: true, kicked: false };
  } catch (err) {
    // 네트워크 오류로 멀쩡한 세션이 끊기지 않게 fail-open
    logToFile("사이트 세션 하트비트 실패(무시): " + (err?.message || err));
    return { ok: true, kicked: false };
  }
});

// 앱을 새로 켰을 때, 저장해둔 세션이 아직 유효한지 서버에 확인하고 나서만 복원함(fail-closed
// - 서버 확인이 안 되면 그냥 다시 로그인하게 함. 하트비트의 fail-open과 의도적으로 반대).
ipcMain.handle("siteauth:get-cached", async () => {
  const saved = store.get("site_session");
  if (!saved?.accountId || !saved?.sessionToken) return { ok: true, account: null };
  try {
    const res = await novaSiteFetch("verify-session", {
      accountId: saved.accountId,
      sessionToken: saved.sessionToken,
    });
    if (!res?.ok) {
      clearSiteSessionLocally();
      return { ok: true, account: null };
    }
    cachedSiteSession = {
      accountId: saved.accountId,
      loginId: saved.loginId,
      sessionToken: saved.sessionToken,
      deviceName: deviceLabel(),
    };
    applySiteAccountRow(res.account);
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("사이트 세션 복원 실패(네트워크 오류로 간주, 재로그인 필요): " + (err?.message || err));
    return { ok: false, error: "network" };
  }
});

ipcMain.handle("account:get-site-account", async () => {
  if (!cachedSiteSession) return { ok: true, account: null };
  try {
    await reloadActiveSiteAccount();
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("사이트 계정 조회 실패: " + (err?.message || err));
    return { ok: false, error: "사이트 계정 정보를 불러오지 못했어요." };
  }
});

// 설정 화면에서 "다른 저장된 계정"을 골라 수동으로 연동할 때 씀(예: 이미 로그인해둔 부계정을
// 나중에 등록). 24-10차: 서버가 진짜 소유권을 검증하려면 지금 유효한 액세스 토큰이 필요해서,
// accounts:switch와 동일하게 저장된 토큰을 한 번 갱신함(실제로 이 계정으로 전환하지는 않음 -
// 지금 활성 계정은 그대로 둠).
ipcMain.handle("account:link-minecraft-account", async (_e, targetUuid) => {
  if (!cachedSiteSession) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  try {
    const localAccounts = getAccounts();
    const target = localAccounts[targetUuid];
    if (!target) return { ok: false, error: "이 런처에 저장된 계정이 아니에요. 한 번 로그인한 계정만 연동할 수 있어요." };

    const authManager = new Auth("select_account");
    let mc = tokenUtils.fromMclcToken(authManager, target.savedToken);
    mc = await mc.refresh(false);
    const mclcAuth = mc.mclc();
    const accessToken = mclcAuth?.access_token || mclcAuth?.accessToken;
    if (!accessToken) return { ok: false, error: "이 계정의 로그인이 만료됐어요. 다시 로그인해주세요." };
    const name = mclcAuth?.profile?.name || mc.profile?.name || target.name;
    saveAccount(targetUuid, name, mc.mclc(true)); // 갱신된 토큰 다시 저장

    const result = await linkMinecraftUuidToActiveSiteAccount(targetUuid, name, accessToken);
    if (!result.linked) return { ok: false, error: result.warning || "계정을 연동하지 못했어요." };
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("마인크래프트 계정 연동 실패: " + (err?.message || err));
    return { ok: false, error: "이 계정의 로그인이 만료됐어요. 다시 로그인해주세요." };
  }
});

// 24-111차: "사이트 계정의 디스코드 태그 입력칸 이게 필요 없는 거라니까" - 설정 > 사이트 계정의
// 디스코드 태그 입력칸과 그 저장 IPC(account:link-discord)를 제거함. (연동 해제 목록은 그대로라
// 예전에 저장해둔 디스코드 링크가 있으면 거기서 "해제"로 지울 수 있음)

ipcMain.handle("account:unlink", async (_e, linkId) => {
  if (!cachedSiteSession) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  try {
    // 마인크래프트 계정을 전부 연동 해제해도(=게스트로 돌아가도) 정상적인 상태임.
    // 이 링크가 정말 "지금 로그인한 이 계정" 소유인지를 서버(launcherUnlink 함수 안 DELETE
    // 조건에 nova_account_id=eq.내 계정)가 직접 확인함 - 링크 id만 알아서는 다른 계정의
    // 연동을 임의로 끊을 수 없음.
    const res = await novaSiteFetch("unlink", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      linkId,
    });
    if (!res?.ok) return { ok: false, error: res?.error || "연동 정보를 찾을 수 없어요." };
    applySiteAccountRow(res.account);
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("계정 연동 해제 실패: " + (err?.message || err));
    return { ok: false, error: "연동을 해제하지 못했어요." };
  }
});

// ----------------------------------------------------------------------------
// 24-45차: 프로필 사진(아바타)
// site_accounts 테이블은 Nova Site 서버 API(novaSiteFetch)로만 관리되고 이 앱에서 직접
// PATCH할 수 없어서(코인/닉네임 등도 전부 이 경로), 아바타 URL을 저장하려고 새 서버
// 엔드포인트를 추가하는 대신 이미 있는 공용 데이터 저장 경로 - setPlayerField/getPlayerData
// (customSkins/coins와 같은 방식 - 사이트 계정이 연동돼 있으면 novaSiteFetch("set-shared-data")로
// 자동으로 서버에 올라감) - 를 그대로 재사용함. getPlayerData/setPlayerField는 파일 아래쪽
// (player_data 섹션)에 정의돼 있지만 함수 선언이라 호이스팅되어 여기서도 바로 쓸 수 있음.
// 사진 파일만 먼저 골라서 미리보기(자르기 전 원본)를 돌려줌 - profiles:pick-icon-temp와 동일한 패턴
ipcMain.handle("account:pick-avatar-temp", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "프로필 사진 선택",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  return { ok: true, previewUrl: "file://" + filePath.replace(/\\/g, "/") };
});
// 렌더러의 캔버스 크롭 도구가 잘라낸 결과(base64 PNG data URL)를 받아 Supabase Storage의
// avatars 버킷(public - forum-images와 같은 방식으로 새로 만들어야 함)에 올리고, 지금 로그인된
// 계정에 귀속시킴
ipcMain.handle("account:upload-avatar", async (_e, { dataUrl } = {}) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "프로필 정보를 확인할 수 없어요." };
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) return { ok: false, error: "이미지 데이터가 올바르지 않아요." };
  try {
    const ext = match[1] === "jpg" ? "jpeg" : match[1];
    const buffer = Buffer.from(match[2], "base64");
    const objectName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/avatars/${objectName}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": `image/${ext}`,
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(await res.text());
    const publicUrl = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/avatars/${objectName}`;
    setPlayerField(uuid, "avatarUrl", publicUrl);
    tierSyncMine().catch(() => {}); // 24-228차: 커뮤니티에서 남들도 바로 보게
    return { ok: true, url: publicUrl };
  } catch (err) {
    logToFile("아바타 업로드 실패: " + (err?.message || err));
    return { ok: false, error: "업로드에 실패했어요. Supabase에 avatars 버킷(public)이 있는지 확인해주세요." };
  }
});
ipcMain.handle("account:get-avatar", () => getPlayerData(getActivePlayerUuid()).avatarUrl || null);

// ----------------------------------------------------------------------------
// 친구 (Supabase user_profiles로 닉네임 검색 -> 친구 요청 -> 수락하면 친구)
// 실시간 서버 소켓 같은 건 없어서, "온라인"은 user_profiles.updated_at이
// 최근 3분 안에 갱신됐는지로 대충 판단함 (앱이 켜져있는 동안 주기적으로 heartbeat 보냄)
// ----------------------------------------------------------------------------
const FRIEND_ONLINE_WINDOW_MS = 90 * 1000; // 17차: 온라인 판정을 90초로 좁히고, 그 다음 단계로 "자리비움"을 새로 둠
const FRIEND_AWAY_WINDOW_MS = 5 * 60 * 1000; // 90초~5분 사이는 "자리비움", 그 이상은 "오프라인"

// 코인 변동이 없어도 접속 중임을 주기적으로 알려서, 친구 목록의 "온라인" 표시가 정확해지게 함
// statusText: 지금 뭘 하고 있는지(예: "너굴마을 플레이 중", "런처에서 대기 중") - 친구 목록에 그대로 보여줌
// 17차: statusKind("server"|"profile"|null) + statusRef(서버id 또는 프로필id) + statusVersion(마크 버전)을
// 같이 보내서, 친구 목록에서 "참가하기"를 텍스트 파싱이 아니라 정확한 값으로 처리할 수 있게 함.
// 아직 sql/2026-08-25_friends_status_kind.sql이 Supabase에서 실행 안 됐을 수도 있으니,
// 새 컬럼이 없어서 실패하면 기존 방식(문구만)으로 한 번 더 시도함(하위 호환)
// 24-23차: user_profiles(마인크래프트 uuid 기준) 대신 site_presence(노바 계정 id 기준)에
// 씀 - 새로 만든 테이블이라 예전 컬럼 호환 재시도(위 user_profiles 때 하던 것)는 필요 없음
ipcMain.handle("friends:heartbeat", async (_e, statusText, statusKind, statusRef, statusVersion) => {
  const me = getMySiteIdentity();
  if (!me.id) return { ok: false };
  try {
    await supabaseFetch("/site_presence", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        nova_account_id: me.id,
        nickname: me.name,
        updated_at: new Date().toISOString(),
        status_text: String(statusText || "").slice(0, 60),
        status_kind: statusKind || null,
        status_ref: statusRef ? String(statusRef).slice(0, 80) : null,
        status_version: statusVersion ? String(statusVersion).slice(0, 20) : null,
      }),
    });
    return { ok: true };
  } catch (err) {
    logToFile("친구 heartbeat 실패: " + (err?.message || err));
    return { ok: false };
  }
});

// 24-67차 신규: site_presence에 "지금 뭘 하고 있는지"(접속 서버/마크 계정)를 올림. 위
// friends:heartbeat와 같은 테이블·같은 upsert 패턴(merge-duplicates)이지만, 이건 렌더러가
// 아니라 메인 프로세스가 게임이 켜져 있는 동안 스스로 주기적으로 호출함 - 서로 다른 컬럼만
// 갱신하므로 heartbeat가 채우는 status_text 등과 덮어쓰지 않음(merge-duplicates는 지정한
// 컬럼만 갱신되는 upsert라, 여기서 안 보내는 컬럼은 그대로 남아있음).
// 49-201차: game_afk 컬럼(sql/2026-09-30_site_presence_game_afk.sql)이 아직 없으면 upsert 전체가 실패한다 -
// 그때는 game_afk만 빼고 한 번 더 올리고, 이번 실행 동안은 더 안 보낸다(나머지 접속 정보가 끊기지 않게).
let presenceAfkUnsupported = false;
async function uploadGamePresenceInfo(fields) {
  const me = getMySiteIdentity();
  if (!me.id) return; // 사이트 계정 로그인 안 된 상태(이론상 게임 실행 자체가 막혀있어 거의 안 옴)
  const send = (f) => supabaseFetch("/site_presence", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      nova_account_id: me.id,
      nickname: me.name,
      updated_at: new Date().toISOString(),
      ...f,
    }),
  });
  const withAfk = "game_afk" in fields && !presenceAfkUnsupported;
  const f = { ...fields };
  if (!withAfk) delete f.game_afk;
  try {
    await send(f);
  } catch (err) {
    if (withAfk) {
      presenceAfkUnsupported = true;
      logToFile("게임 접속 정보: game_afk 컬럼이 없어 자리 비움은 빼고 올립니다(sql/2026-09-30_site_presence_game_afk.sql 실행 필요) - " + (err?.message || err));
      delete f.game_afk;
      try {
        await send(f);
      } catch (err2) {
        logToFile("게임 접속 정보(site_presence) 업로드 실패: " + (err2?.message || err2));
      }
      return;
    }
    logToFile("게임 접속 정보(site_presence) 업로드 실패: " + (err?.message || err));
  }
}

// 49-207차: 모드와 주고받는 게임 폴더 파일. 옛 모드는 .nova-*, 새 모드(Luna's Light)는 .luna-* 를 쓴다.
// 런처가 쓰는 파일은 둘 다 쓰고, 모드가 쓰는 파일은 있는 쪽(새 이름 먼저)을 읽는다.
function modIoPaths(runRoot, name) {
  return [path.join(runRoot, `.luna-${name}`), path.join(runRoot, `.nova-${name}`)];
}
function modIoReadPath(runRoot, name) {
  const [luna, nova] = modIoPaths(runRoot, name);
  return fs.existsSync(luna) ? luna : nova;
}
function modIoUnlinkAll(runRoot, name) {
  for (const p of modIoPaths(runRoot, name)) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
}
function lunaTwinPath(p) {
  return path.join(path.dirname(p), path.basename(p).replace(/^\.nova-/, ".luna-"));
}
function launchSigFor(prefix, ts) {
  return crypto.createHmac("sha256", NOVA_LAUNCH_SECRET).update(prefix + ts).digest("hex");
}

// 게임 폴더의 .nova-presence.json(Nova-Mod가 20초마다 남김 - 49-27차)을 읽어 서버/닉네임
// 정보를 뽑음. 모드가 없는 프로필(바닐라/Forge/NeoForge)이거나, Fabric이라도 모드가 아직
// 한 번도 파일을 안 썼으면 조용히 null을 돌려줌(정상 상태 - 로그 스팸 안 남김).
// 24-79차: 모드 쪽(NovaSocial.publishPresence)이 실제로 쓰는 이름을 확인함 -
//   { ts, novaAccountId, mcName, mcUuid, server, serverName, singleplayer }
// server는 싱글플레이일 때 빈 문자열(친구가 참가할 수 없으니 주소를 안 올림). 아래 후보
// 목록은 예전 방어 코드를 그대로 두되 실제 이름(server/serverName/mcName)이 먼저 잡힌다.
const PRESENCE_FILE_MAX_AGE_MS = 90 * 1000; // 모드는 20초마다 다시 씀 - 이보다 오래되면 죽은 값

async function readModPresenceFile(runRoot) {
  try {
    const raw = await fsp.readFile(modIoReadPath(runRoot, "presence.json"), "utf-8");
    const data = JSON.parse(raw);
    // 24-79차: 게임이 크래시로 죽으면 파일이 그대로 남는다 - 다음 실행 때 그 값을 그대로
    // 올려 "있지도 않은 서버에 있는 것"으로 보이던 문제. ts가 낡았으면 없는 셈 친다.
    const ts = Number(data.ts || data.timestamp || 0);
    if (ts > 0 && Date.now() - ts > PRESENCE_FILE_MAX_AGE_MS) return null;
    const serverAddress = data.server_address || data.serverAddress || data.server || data.address || null;
    const serverName = data.server_name || data.serverName || null;
    const mcName = data.mc_name || data.mcName || data.name || null;
    // 49-201차: 모드의 [자리 비움] 상태(없으면 false)
    const afk = data.afk === true;
    presenceFileWarned = false;
    if (!serverAddress && !serverName && !mcName) return null;
    return { serverAddress, serverName, mcName, afk };
  } catch (err) {
    if (err?.code !== "ENOENT" && !presenceFileWarned) {
      presenceFileWarned = true; // 파일이 없는 건 정상(모드 미설치 등)이라 ENOENT는 아예 로그 안 남김
      logToFile("[접속 정보] .nova-presence.json 읽기 실패: " + (err?.message || err));
    }
    return null;
  }
}

// 24-79차: 게임을 켜기 직전에 지난 실행이 남긴 파일을 지움(위 ts 검사와 이중 안전장치).
// 모드가 켜지면 몇 초 안에 새로 쓰므로 지워도 잃는 정보가 없다.
async function clearModPresenceFile(runRoot) {
  try {
    modIoUnlinkAll(runRoot, "presence.json");
  } catch (_) {
    // 없으면 정상
  }
}

// runRoot: 이번 실행에 쓰인 게임 폴더. knownInfo: 런처가 실행 시점에 이미 알고 있는 정보
// (서버 모드면 서버 주소/이름 + 마크 계정 이름 - 모드가 없거나 아직 파일을 안 썼어도 이 정도는
// 바로 올라감). 20초마다(모드가 파일을 쓰는 주기와 동일) .nova-presence.json을 다시 읽어서
// 있으면 그 값으로 덮어씀 - 자유 플레이 프로필로 켜서 유저가 인게임에서 직접 다른 서버로
// 들어간 경우까지 반영하기 위함(그 경우는 런처가 애초에 알 방법이 없어서 모드 파일이 꼭 필요함).
function startPresenceUpload(runRoot, knownInfo) {
  stopPresenceUpload(false);
  presenceFileWarned = false;
  const upload = async () => {
    // 설정 > "친구에게 지금 뭘 플레이 중인지 공유 안 함"(hidePresence) - 기존 friends:heartbeat의
    // 상태 문구도 이 설정일 땐 "런처 사용 중"으로만 보내던 것과 동일하게, 여기서도 실제 서버/
    // 계정 정보는 올리지 않고 비워서 보냄(온라인 여부 자체는 heartbeat가 따로 관리).
    if (getSettings().hidePresence) {
      await uploadGamePresenceInfo({ server_address: null, server_name: null, mc_name: null });
      return;
    }
    const fromFile = await readModPresenceFile(runRoot);
    const info = fromFile || knownInfo || {};
    await uploadGamePresenceInfo({
      server_address: info.serverAddress || null,
      server_name: info.serverName || null,
      mc_name: info.mcName || knownInfo?.mcName || null,
      game_afk: !!(fromFile && fromFile.afk),   // 49-201차: 모드의 자리 비움
    });
  };
  upload().catch(() => {});
  presenceUploadTimer = setInterval(() => upload().catch(() => {}), 20000);
}

// clearRemote: 게임이 종료됐을 때 true로 호출 - 타이머만 멈추는 게 아니라 서버 정보를 비워서
// (온라인 여부 자체는 friends:heartbeat가 별도로 계속 관리하므로 그대로 둠) 친구 목록/모드
// 소셜 화면에 "게임을 끈 뒤에도 마지막으로 있던 서버가 계속 표시되는" 문제가 없게 함.
function stopPresenceUpload(clearRemote) {
  if (presenceUploadTimer) {
    clearInterval(presenceUploadTimer);
    presenceUploadTimer = null;
  }
  if (clearRemote) {
    uploadGamePresenceInfo({ server_address: null, server_name: null, mc_name: null, game_afk: false }).catch(() => {});
  }
}

// ----------------------------------------------------------------------------
// 49-74차(모드 4-5 "듣고 있는 노래"): 지금 재생 중인 곡을 게임 폴더에 적어줌
// ----------------------------------------------------------------------------
// 모드(자바)에는 "무슨 노래가 나오나"를 물어볼 길이 아예 없음 - 그건 윈도우가 갖고 있는 정보임
// (윈도우 미디어 세션: Spotify / 크롬·엣지의 유튜브 / 윈도우 미디어 플레이어 등이 여기에 곡을
// 올림. 볼륨 조절기 위에 곡 제목이 뜨는 그 정보임). 네이티브 모듈을 모드에 동봉하는 건 40개
// 버전에 얹기엔 너무 무거워서, 이미 윈도우 프로그램인 런처가 대신 물어보고 게임 폴더에
// .nova-now-playing.json 한 줄을 남김. 모드는 그 파일만 읽음(NovaNowPlaying.java 주석 참고).
//
// 왜 powershell을 "계속 띄워두는가": 2초마다 powershell.exe를 새로 띄우면 실행 비용(프로세스
// 생성 + .NET 로딩)이 곡 정보 한 줄 값어치를 훨씬 넘김. 그래서 한 번만 띄워서 그 안에서 돌게
// 하고, 런처는 그 출력을 읽어서 파일로 옮기기만 함. 게임이 꺼지면 같이 죽임.
//
// 실패해도 게임에는 아무 영향이 없음 - 파일이 안 생기고, 모드는 아무것도 표시하지 않음
// (없는 걸 지어내지 않기 위해 모드 쪽에서도 파일이 없으면 그냥 안 그림).
let nowPlayingProc = null;
let nowPlayingTarget = null;
let nowPlayingWroteAt = 0;

// 49-181차(사용자: "노래 어플 우선, 같이 켜져 있으면 소리 큰 거"): 앱(프로세스)별 지금 나는 소리 크기.
// 윈도우 볼륨 믹서가 앱마다 보여 주는 막대와 같은 값(IAudioMeterInformation 최고치 × 앱 볼륨, 음소거면 0)을
// n번(ms 간격) 재서 가장 큰 값을 낸다 - 곡 사이 잠깐 조용한 순간에 0으로 튀지 않게.
const NOVA_AUDIO_CS = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
public static class NovaAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr prm, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr g, int flags, out IntPtr ctl);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr g, int flags, out IntPtr vol);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int n);
    [PreserveSig] int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object s);
  }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr v);
    [PreserveSig] int SetDisplayName(IntPtr v, IntPtr c);
    [PreserveSig] int GetIconPath(out IntPtr v);
    [PreserveSig] int SetIconPath(IntPtr v, IntPtr c);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(IntPtr g, IntPtr c);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier(out IntPtr v);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr v);
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float v, IntPtr c);
    [PreserveSig] int GetMasterVolume(out float v);
    [PreserveSig] int SetMute(int m, IntPtr c);
    [PreserveSig] int GetMute(out int m);
  }
  class Entry { public string Name; public IAudioMeterInformation Meter; public ISimpleAudioVolume Vol; }
  static List<Entry> Open() {
    var list = new List<Entry>();
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
    IMMDevice dev;
    if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return list;
    Guid iid = typeof(IAudioSessionManager2).GUID;
    object o;
    if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0 || o == null) return list;
    var mgr = (IAudioSessionManager2)o;
    IAudioSessionEnumerator se;
    if (mgr.GetSessionEnumerator(out se) != 0 || se == null) return list;
    int count;
    se.GetCount(out count);
    for (int i = 0; i < count; i++) {
      try {
        object so;
        if (se.GetSession(i, out so) != 0 || so == null) continue;
        var c2 = so as IAudioSessionControl2;
        var meter = so as IAudioMeterInformation;
        if (c2 == null || meter == null) continue;
        uint pid;
        if (c2.GetProcessId(out pid) != 0 || pid == 0) continue;
        string name;
        try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { continue; }
        var e = new Entry();
        e.Name = name; e.Meter = meter; e.Vol = so as ISimpleAudioVolume;
        list.Add(e);
      } catch { }
    }
    return list;
  }
  public static string[] Sample(int n, int ms) {
    var best = new Dictionary<string, float>();
    List<Entry> entries;
    try { entries = Open(); } catch { entries = new List<Entry>(); }
    for (int i = 0; i < n; i++) {
      foreach (var e in entries) {
        float p = 0f, v = 1f; int m = 0;
        try { e.Meter.GetPeakValue(out p); } catch { }
        if (e.Vol != null) { try { e.Vol.GetMasterVolume(out v); e.Vol.GetMute(out m); } catch { } }
        float eff = m != 0 ? 0f : p * v;
        float cur;
        if (!best.TryGetValue(e.Name, out cur) || eff > cur) best[e.Name] = eff;
      }
      if (i < n - 1) Thread.Sleep(ms);
    }
    var outList = new List<string>();
    foreach (var kv in best) outList.Add(kv.Key + "\t" + kv.Value.ToString("0.0000", CultureInfo.InvariantCulture));
    return outList.ToArray();
  }
}`;

// Windows PowerShell 5.1(=powershell.exe) 전용. WinRT 호출에 .NET Framework의
// System.WindowsRuntimeSystemExtensions가 필요해서 pwsh(PowerShell 7)로는 안 됨.
const NOW_PLAYING_PS1 = [
  "$ErrorActionPreference = 'Stop'",
  // 한글 곡 제목이 깨지지 않게 - 안 맞추면 콘솔 코드페이지(949)로 나가고 Node는 UTF-8로 읽음
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "try {",
  "  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null",
  "  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null",
  "  [Windows.Foundation.IAsyncOperation`1,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null",
  "} catch {",
  "  [Console]::Error.WriteLine('nova: no media api')",
  "  exit 1",
  "}",
  // 49-77차: 이 어셈블리를 안 올리면 [System.WindowsRuntimeSystemExtensions] 형식을 못 찾는다(launcher.log에서 확인)
  // 49-118차(사용자 로그 실측: "System.WindowsRuntimeSystemExtensions 형식을 찾을 수 없습니다"): 이름만으로
  //  Add-Type이 이 어셈블리를 못 잡는 PC가 있다 → 이름으로 먼저 시도하고, 안 되면 GAC에서 dll을 직접 찾아 올린다.
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue",
  "if (-not ([System.Management.Automation.PSTypeName]'System.WindowsRuntimeSystemExtensions').Type) {",
  "  try {",
  "    $wrDll = Get-ChildItem -Path (Join-Path $env:windir 'Microsoft.NET\\assembly\\GAC_MSIL\\System.Runtime.WindowsRuntime') -Recurse -Filter 'System.Runtime.WindowsRuntime.dll' -ErrorAction SilentlyContinue | Select-Object -First 1",
  "    if ($wrDll) { Add-Type -Path $wrDll.FullName }",
  "  } catch { }",
  "}",
  "if (-not ([System.Management.Automation.PSTypeName]'System.WindowsRuntimeSystemExtensions').Type) {",
  "  [Console]::Error.WriteLine('nova: winrt extensions missing')",
  "  exit 1",
  "}",
  // 49-177차(모드 "플랫폼 색"): 크롬 안의 유튜브/SOOP 같은 건 미디어 세션만으론 어느 사이트인지 모른다 -
  // 보이는 창 제목(탭 제목 + " - YouTube" 등)을 같이 넘겨서 런처가 플랫폼을 고른다. 한 번만 컴파일해 두고 계속 씀.
  "$novaWinSrc = @'",
  "using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;",
  "public static class NovaWin {",
  "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
  "  [DllImport(\"user32.dll\")] static extern bool EnumWindows(EnumProc cb, IntPtr l);",
  "  [DllImport(\"user32.dll\")] static extern bool IsWindowVisible(IntPtr h);",
  "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);",
  "  public static string[] Titles() {",
  "    var list = new List<string>();",
  "    EnumWindows(new EnumProc(delegate (IntPtr h, IntPtr l) {",
  "      if (IsWindowVisible(h)) { var sb = new StringBuilder(512); if (GetWindowText(h, sb, 512) > 0) list.Add(sb.ToString()); }",
  "      return true;",
  "    }), IntPtr.Zero);",
  "    return list.ToArray();",
  "  }",
  "}",
  "'@",
  "try { Add-Type -TypeDefinition $novaWinSrc -ErrorAction Stop } catch { }",
  // 49-181차: 앱별 소리 크기 측정기(실패하면 소리 크기 없이 재생 중인지만 보고 고른다)
  "$novaAudioSrc = @'",
  ...NOVA_AUDIO_CS.split("\n"),
  "'@",
  "$novaAudioOk = $false",
  "try { Add-Type -TypeDefinition $novaAudioSrc -ErrorAction Stop; $novaAudioOk = $true } catch { [Console]::Error.WriteLine('nova: audio meter unavailable ' + $_.Exception.Message) }",
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {",
  "  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'",
  "})[0]",
  "function Await($op, $type) {",
  "  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))",
  "  $t.Wait(-1) | Out-Null",
  "  $t.Result",
  "}",
  "try {",
  "  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])",
  "} catch {",
  "  [Console]::Error.WriteLine('nova: session manager failed')",
  "  exit 1",
  "}",
  // 49-181차: 지금 세션 하나만이 아니라 미디어 세션 전부(앱, 제목, 재생 중인지)와 앱별 소리 크기를 같이 보낸다.
  // 무엇을 띄울지는 런처(pickNowPlaying)가 고른다: 노래 앱 우선, 같은 급끼리는 소리 큰 쪽.
  "while ($true) {",
  "  $list = @()",
  "  $keys = @()",
  "  try {",
  "    $curId = ''",
  "    $cur = $mgr.GetCurrentSession()",
  "    if ($cur -ne $null) { $curId = [string]$cur.SourceAppUserModelId }",
  "    foreach ($s in $mgr.GetSessions()) {",
  "      try {",
  "        $t = ''; $a = ''; $p = $false",
  "        $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])",
  "        if ($props -ne $null) { $t = [string]$props.Title; $a = [string]$props.Artist }",
  "        $info = $s.GetPlaybackInfo()",
  "        if ($info -ne $null) { $p = ($info.PlaybackStatus.ToString() -eq 'Playing') }",
  "        $id = [string]$s.SourceAppUserModelId",
  "        $list += New-Object psobject -Property @{ title = $t; artist = $a; playing = $p; app = $id; cur = ($id -eq $curId) }",
  "        if ($t.Length -gt 0) { $keys += $t.Substring(0, [Math]::Min(12, $t.Length)) }",
  "      } catch { }",
  "    }",
  "  } catch { }",
  "  $wins = @()",
  "  try {",
  "    foreach ($w in [NovaWin]::Titles()) {",
  "      $hit = $w -match 'YouTube|SOOP|sooplive|Spotify|Melon|Genie|Bugs|FLO|VIBE|SoundCloud|Apple Music'",
  "      if (-not $hit) { foreach ($k in $keys) { if ($w.IndexOf($k, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hit = $true; break } } }",
  "      if ($hit) { $wins += $w }",
  "      if ($wins.Count -ge 16) { break }",
  "    }",
  "  } catch { }",
  "  $levels = @()",
  "  if ($novaAudioOk) { try { $levels = @([NovaAudio]::Sample(8, 200)) } catch { Start-Sleep -Milliseconds 1600 } } else { Start-Sleep -Milliseconds 1600 }",
  "  $obj = New-Object psobject -Property @{ sessions = @($list); wins = @($wins); levels = @($levels); meter = $novaAudioOk }",
  "  [Console]::Out.WriteLine((ConvertTo-Json $obj -Compress -Depth 4))",
  "  [Console]::Out.Flush()",
  "  Start-Sleep -Milliseconds 400",
  "}",
].join("\r\n");

// 49-177차(모드 "플랫폼 색"): 어느 플랫폼에서 나오는 곡인지 추정. 앱(Spotify/멜론 PC 앱)이면 앱 이름으로,
// 브라우저면 곡 제목이 들어간 창 제목의 끝("- YouTube Music", "- YouTube", "SOOP")으로. 모르면 빈 문자열(색 없음).
let lastNowPlayingTitle = "";
function nowPlayingPlatform(p) {
  const app = String((p && p.app) || "").toLowerCase();
  if (app.includes("spotify")) return "spotify";
  if (app.includes("melon") || app.includes("iloen")) return "melon";
  if (app.includes("music.youtube") || app.includes("youtube music")) return "ytmusic";
  const wins = Array.isArray(p && p.wins) ? p.wins.map(String) : (p && p.wins ? [String(p.wins)] : []);
  const key = String((p && p.title) || "").slice(0, 12).toLowerCase();
  // 곡 제목이 들어간 창을 먼저 본다(다른 탭의 유튜브 창과 헷갈리지 않게)
  const ordered = wins.slice().sort((a, b) => (key && b.toLowerCase().includes(key) ? 1 : 0) - (key && a.toLowerCase().includes(key) ? 1 : 0));
  for (const w of ordered) {
    const s = w.toLowerCase();
    if (s.includes("youtube music")) return "ytmusic";
    if (/\bsoop\b|sooplive/.test(s)) return "soop";
    if (s.includes("youtube")) return "youtube";
    if (s.includes("melon") || w.includes("멜론")) return "melon";
    if (s.includes("spotify")) return "spotify";
  }
  return "";
}

// 49-181차(사용자: "무조건 노래 어플 우선 + 소리 큰 거. 유튜브/숲/멜론이 켜져 있으면 멜론, 멜론이 멈췄거나 소리가
// 꺼져 있으면 유튜브, 유튜브 뮤직과 멜론이 같이 켜져 있으면 소리 큰 거"):
//  1) 재생 중이고 실제로 소리가 나는(앱 볼륨 믹서 막대가 움직이는) 노래 앱 중 가장 큰 것
//  2) 없으면 재생 중이고 소리가 나는 나머지(유튜브, SOOP 등) 중 가장 큰 것
//  3) 소리 크기를 못 재는 PC면 재생 중인 것(노래 앱 먼저), 그것도 없으면 윈도우가 "지금 세션"이라고 하는 것
// 두 개가 비슷한 크기로 번갈아 커지며 깜빡이지 않게, 지금 띄운 것보다 25% 넘게 클 때만 바꾼다.
const NP_MUSIC = new Set(["melon", "spotify", "ytmusic"]);
const NP_MUSIC_RE = /melon|멜론|iloen|spotify|youtube music|genie|지니|bugs|벅스|\bflo\b|dreamus|vibe|soundcloud|apple ?music|applemusic|itunes|deezer|tidal/i;
const NP_ALIASES = { "308046b0af4a39cb": "firefox", msedge: "msedge", chrome: "chrome", whale: "whale" };
let npChosenKey = "";

function npAppName(app) {
  let a = String(app || "").toLowerCase();
  a = a.split(/[\\/!]/).pop() || a;
  a = a.replace(/\.exe$/, "");
  return NP_ALIASES[a] || a;
}

function npLevelFor(app, levels) {
  if (!levels) return -1;
  const a = npAppName(app);
  if (!a) return -1;
  if (levels.has(a)) return levels.get(a);
  for (const [name, v] of levels) {
    if (name.length >= 4 && a.length >= 4 && (a.includes(name) || name.includes(a))) return v;
  }
  return -1;   // 이 앱의 소리 세션을 못 찾음(모름)
}

function npIsMusic(s) {
  if (NP_MUSIC.has(s.platform)) return true;
  if (NP_MUSIC_RE.test(String(s.app || ""))) return true;
  return false;
}

function pickNowPlaying(parsed) {
  const raw = Array.isArray(parsed.sessions) ? parsed.sessions : (parsed.sessions ? [parsed.sessions] : []);
  const wins = Array.isArray(parsed.wins) ? parsed.wins.map(String) : (parsed.wins ? [String(parsed.wins)] : []);
  let levels = null;
  if (parsed.meter) {
    levels = new Map();
    const arr = Array.isArray(parsed.levels) ? parsed.levels : (parsed.levels ? [parsed.levels] : []);
    for (const line of arr) {
      const [name, v] = String(line).split("\t");
      const n = Number(v);
      if (name && Number.isFinite(n)) levels.set(name.toLowerCase(), Math.max(levels.get(name.toLowerCase()) || 0, n));
    }
  }
  const list = raw.filter((x) => x && (x.title || x.artist)).map((x) => {
    const key = String(x.title || "").slice(0, 12).toLowerCase();
    // 이 세션의 곡 제목이 들어간 창만 먼저 본다(없으면 사이트 창 전부) - 다른 탭과 헷갈리지 않게
    const mine = key ? wins.filter((w) => w.toLowerCase().includes(key)) : [];
    const s = { title: String(x.title || ""), artist: String(x.artist || ""), playing: !!x.playing, app: String(x.app || ""), cur: !!x.cur };
    s.platform = nowPlayingPlatform({ app: s.app, title: s.title, wins: mine.length ? mine : wins });
    s.soopWin = mine.some((w) => /\bsoop\b|sooplive|아프리카tv|afreecatv/i.test(w));
    s.music = npIsMusic(s);
    const lv = npLevelFor(s.app, levels);
    const id = s.app + "|" + s.title;
    // 1.6초 동안 잰 최고치 그대로 쓴다(멈추거나 음소거하면 바로 0 - 다음 차례에 바로 넘어가게)
    s.level = lv >= 0 ? lv : -1;
    s.id = id;
    return s;
  });
  // 49-184차(사용자: "숲은 노래에서 빼줘 아예 - 숲이 계속 인식돼"): SOOP 방송은 노래가 아니라 후보에서 뺀다.
  // 앱 이름이나 이 세션의 창 제목에 SOOP이 보이면 뺀다(플랫폼 판정이 다른 걸로 나와도).
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.platform === "soop" || s.soopWin || /\bsoop\b|sooplive|afreeca|아프리카/i.test(s.app)) list.splice(i, 1);
  }
  if (!list.length) return null;
  const QUIET = 0.004;
  // 소리 세션을 못 찾은 앱(-1)은 재생 중이면 소리 나는 걸로 치되, 실제로 잰 것보다는 뒤로 민다
  const audible = (s) => s.playing && (s.level < 0 || s.level > QUIET);
  const loudest = (arr) => arr.slice().sort((a, b) => b.level - a.level)[0];
  let pick = null;
  const tiers = [list.filter((s) => s.music && audible(s)), list.filter((s) => !s.music && audible(s))];
  for (const tier of tiers) {
    if (!tier.length) continue;
    pick = loudest(tier);
    // 지금 띄운 것이 같은 급에 아직 있으면, 새 후보가 25% 넘게 커야 바꾼다
    const keep = tier.find((s) => s.id === npChosenKey);
    if (keep && keep !== pick && !(pick.level > keep.level * 1.25 + 0.002)) pick = keep;
    break;
  }
  if (!pick) {
    const playing = list.filter((s) => s.playing);
    pick = playing.find((s) => s.music) || playing[0] || list.find((s) => s.cur) || list[0];
  }
  npChosenKey = pick.id;
  return pick;
}

function startNowPlayingBridge(runRoot) {
  stopNowPlayingBridge();
  if (process.platform !== "win32" || !runRoot) return;
  startPipWatcher(runRoot);   // 49-177차: 보고 있는 영상(모드가 부탁하면 창을 찍어 보냄)
  let scriptPath;
  try {
    scriptPath = path.join(os.tmpdir(), "nova-now-playing.ps1");
    // BOM을 붙여야 powershell이 한글이 섞인 곡 제목을 제대로 내보냄
    fs.writeFileSync(scriptPath, "﻿" + NOW_PLAYING_PS1, "utf-8");
  } catch (err) {
    logToFile("[노바 모드][노래] 스크립트 기록 실패: " + (err?.message || err));
    return;
  }
  nowPlayingTarget = path.join(runRoot, ".nova-now-playing.json");
  nowPlayingWroteAt = 0;
  try {
    nowPlayingProc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    logToFile("[노바 모드][노래] powershell 실행 실패(노래 표시만 비활성): " + (err?.message || err));
    nowPlayingProc = null;
    return;
  }
  let buf = "";
  let last = "";
  nowPlayingProc.stdout.on("data", (chunk) => {
    buf += String(chunk);
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (_) {
        continue;
      }
      // 49-181차: 새 스크립트는 세션 전부를 보낸다 - 여기서 하나를 고른다(옛 한 줄 형식도 그대로 받음)
      if (Array.isArray(parsed.sessions) || parsed.sessions) {
        let chosen = null;
        try {
          chosen = pickNowPlaying(parsed);
        } catch (err) {
          logToFile("[노바 모드][노래] 고르기 실패: " + (err?.message || err));
        }
        parsed = chosen
          ? { title: chosen.title, artist: chosen.artist, playing: chosen.playing, app: chosen.app, platform: chosen.platform }
          : { title: "", artist: "", playing: false, app: "", platform: "" };
      }
      // 내용이 그대로면 파일을 다시 쓰지 않음 - 다만 모드가 "오래된 값"으로 버리지 않게
      // 5초에 한 번은 무조건 다시 씀(모드 쪽 STALE_MS = 15초)
      const key = JSON.stringify(parsed);
      const now = Date.now();
      if (key === last && now - nowPlayingWroteAt < 5000) continue;
      last = key;
      nowPlayingWroteAt = now;
      try {
        lastNowPlayingTitle = parsed.title || "";
        const npBody = JSON.stringify({ ts: now, title: parsed.title || "", artist: parsed.artist || "", playing: !!parsed.playing, source: parsed.platform != null ? parsed.platform : nowPlayingPlatform(parsed) });
        fs.writeFileSync(nowPlayingTarget, npBody, "utf-8");
        try { fs.writeFileSync(lunaTwinPath(nowPlayingTarget), npBody, "utf-8"); } catch (_) {}
      } catch (_) {
        // 게임 폴더가 사라졌거나(프로필 삭제) 잠긴 것 - 다음 줄에서 다시 시도
      }
    }
  });
  nowPlayingProc.stderr.on("data", (chunk) => {
    const msg = String(chunk).trim();
    if (msg) logToFile("[노바 모드][노래] " + msg);
  });
  nowPlayingProc.on("close", () => {
    nowPlayingProc = null;
  });
}

// 게임이 켜져 있는 동안만 파일이 살아 있게 - 끝나면 지워서 모드가 옛 곡을 계속 띄우지 않게 함
// (모드도 ts로 한 번 더 거르지만, 여기서 지우는 쪽이 더 정확함)
function stopNowPlayingBridge() {
  stopPipWatcher();
  if (nowPlayingProc) {
    try {
      nowPlayingProc.kill();
    } catch (_) {}
    nowPlayingProc = null;
  }
  if (nowPlayingTarget) {
    try {
      fs.unlinkSync(nowPlayingTarget);
    } catch (_) {}
    try {
      fs.unlinkSync(lunaTwinPath(nowPlayingTarget));
    } catch (_) {}
    nowPlayingTarget = null;
  }
}

// ----------------------------------------------------------------------------
// 49-177차(모드 "보고 있는 영상"): 브라우저의 영상 창을 작게 찍어 게임에 보내 줌
// ----------------------------------------------------------------------------
// 사용자: "내가 보고 있는 동영상 플랫폼 마크 전체화면 하더라도 보이는 기능".
// 다른 프로그램 창을 찍는 건 자바로는 못 하고, 크롬(=Electron)은 윈도우 그래픽 캡처로 **가려진 창도** 찍는다
// (마크 전체 화면 뒤에 깔린 브라우저도 됨 - 최소화만 아니면). 그래서 런처가 숨은 창 하나에서 그 창을 찍어
// PNG로 만들고, 127.0.0.1 소켓으로 모드에 흘려 준다. 모드는 받아서 HUD에 그린다(NovaPip.java).
//
// 흐름: 모드가 .nova-pip.json {action:"start"|"stop", fps, maxW, pick} 를 씀 → 0.5초마다 봄 →
// start면 창 목록(desktopCapturer)에서 영상 사이트 창을 골라(지금 나오는 곡 제목과 맞는 창 먼저, pick번째)
// 숨은 창의 getUserMedia로 찍음 → 프레임마다 [길이 4바이트][PNG]를 소켓으로.
// .nova-pip-state.json {ts, port, running, window, error, count} 는 2초마다 새로 씀(모드가 오래된 값은 버림).
// 실패해도 게임엔 아무 영향 없음 - 모드가 안내 문구만 띄움.
// net은 "서버 상태" 구역에서 이미 불러 둠(게임을 켤 때만 쓰므로 선언 순서 문제 없음)
let pipWatch = null;
const PIP_SITES = /youtube|soop|sooplive|chzzk|치지직|twitch|netflix|넷플릭스|tving|티빙|laftel|라프텔|disney\+|디즈니\+|coupang play|쿠팡플레이|watcha|왓챠|wavve|웨이브|bilibili|niconico|kick|tiktok|틱톡|vimeo|melon|멜론|spotify/i;
const PIP_BROWSERS = /chrome|edge|whale|firefox|opera|brave|naver/i;

const PIP_HTML = `<!doctype html><meta charset="utf-8"><body><script>
// 49-187차(사용자: "영상이 검정색으로 떠, 60프레임, 화질 좋게, 화면만 딱"):
//  - 숨은 창에서 <video>로 그리면 크롬이 화면에 안 보이는 영상은 새 장면을 안 그려서(검은 화면) → 트랙에서 바로 한 장씩 받는
//    MediaStreamTrackProcessor를 쓴다(없는 버전만 예전 video 방식, 대신 문서에 붙여 둠).
//  - 창 전체를 작게 줄여 찍던 것(maxWidth) → 원래 해상도로 받아서 "영상이 나오는 부분"만 잘라 원하는 폭으로 줄인다.
//  - 영상 부분 찾기: 작게 줄인 화면(128칸)을 0.1초마다 비교해 칸마다 "얼마나 자주 바뀌는지"(최근 1초쯤의 평균)를 센다.
//    자주 바뀌는 칸(영상)만 모아 그 칸들로 가장 꽉 찬 16:9(쇼츠면 9:16) 사각형 중 가장 큰 것을 고른다. 채팅은 올라갈 때만
//    한 번씩 바뀌어 자주 바뀌는 칸이 아니라서 빠지고, 멈춰 있는 글자는 아예 안 바뀐다. 아무것도 안 움직이면 마지막 자리 그대로.
const { ipcRenderer } = require("electron");
let stream = null, reader = null, running = false, video = null, timer = null, token = 0;
async function stop() {
  running = false;
  token++;
  if (timer) { clearInterval(timer); timer = null; }
  try { if (reader) await reader.cancel(); } catch (_) {}
  reader = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video) { try { video.remove(); } catch (_) {} video.srcObject = null; video = null; }
}
ipcRenderer.on("pip-stop", () => { stop(); });

function makeCropper(ratio) {
  const DW = 128;
  let DH = 72, sw = 0, sh = 0, prev = null, freq = null, lastChg = null, samples = 0, lastSample = 0, lastPick = 0;
  let crop = null, pending = null, pendingHits = 0;
  const small = new OffscreenCanvas(DW, DH);
  const sg = small.getContext("2d", { willReadFrequently: true });
  function pick(now) {
    const n = DW * DH;
    const act = new Uint8Array(n);
    let total = 0;
    if (samples < 15) return;
    // 49-189차: 가장자리 넓히기용 - 최근 6초 안에 한 번이라도 바뀐 칸(영상 속 잠깐 멈춘 곳까지 영상으로 본다)
    const ever = new Uint8Array(n);
    for (let i = 0; i < n; i++) { if (freq[i] > 0.25) { act[i] = 1; total++; } if (now - lastChg[i] < 6000) ever[i] = 1; }
    if (total < n * 0.01) return;   // 거의 안 움직임 - 지금 자리 유지
    const W = DW + 1;
    const sum = new Int32Array((DW + 1) * (DH + 1));
    for (let y = 0; y < DH; y++) {
      let row = 0;
      for (let x = 0; x < DW; x++) { row += act[y * DW + x]; sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row; }
    }
    const cw = sw / DW, ch = sh / DH;
    const A = ratio === "shorts" ? 9 / 16 : 16 / 9;
    let best = null;
    for (let w = DW; w >= Math.round(DW * 0.15) && !best; w--) {
      const h = Math.round((w * cw) / (A * ch));
      if (h < 4 || h > DH) continue;
      let bd = 0, bx = 0, by = 0;
      for (let y = 0; y + h <= DH; y++) {
        for (let x = 0; x + w <= DW; x++) {
          const s = sum[(y + h) * W + x + w] - sum[y * W + x + w] - sum[(y + h) * W + x] + sum[y * W + x];
          const d = s / (w * h);
          if (d > bd) { bd = d; bx = x; by = y; }
        }
      }
      if (bd >= 0.95) best = { x: bx, y: by, w, h };
    }
    if (!best) return;
    // 꽉 찬 가운데를 찾았으면 가장자리를 한 줄씩 넓힌다 - 새 줄의 절반 넘게 움직이면 영상의 일부
    const sum2 = new Int32Array((DW + 1) * (DH + 1));
    for (let y = 0; y < DH; y++) {
      let row = 0;
      for (let x = 0; x < DW; x++) { row += ever[y * DW + x]; sum2[(y + 1) * W + x + 1] = sum2[y * W + x + 1] + row; }
    }
    const rectSum = (x, y, w, h) => sum2[(y + h) * W + x + w] - sum2[y * W + x + w] - sum2[(y + h) * W + x] + sum2[y * W + x];
    for (let grew = true; grew;) {
      grew = false;
      if (best.x > 0 && rectSum(best.x - 1, best.y, 1, best.h) >= best.h * 0.5) { best.x--; best.w++; grew = true; }
      if (best.x + best.w < DW && rectSum(best.x + best.w, best.y, 1, best.h) >= best.h * 0.5) { best.w++; grew = true; }
      if (best.y > 0 && rectSum(best.x, best.y - 1, best.w, 1) >= best.w * 0.5) { best.y--; best.h++; grew = true; }
      if (best.y + best.h < DH && rectSum(best.x, best.y + best.h, best.w, 1) >= best.w * 0.5) { best.h++; grew = true; }
    }
    // 칸 경계에 걸린 바깥 줄이 섞이지 않게 반 칸씩 안으로
    const r = { x: (best.x + 0.5) * cw, y: (best.y + 0.5) * ch, w: (best.w - 1) * cw, h: (best.h - 1) * ch };
    const same = (a, b) => a && b && Math.abs(a.x - b.x) < cw * 2 && Math.abs(a.y - b.y) < ch * 2 && Math.abs(a.w - b.w) < cw * 3;
    if (!crop) { crop = r; return; }
    if (same(r, crop)) return;
    // 두 번 연속 같은 자리가 나와야 옮긴다(잠깐 움직인 것에 흔들리지 않게)
    if (same(r, pending)) { if (++pendingHits >= 2) { crop = r; pending = null; } }
    else { pending = r; pendingHits = 1; }
  }
  return {
    feed(src, w, h, now) {
      if (w !== sw || h !== sh) {
        sw = w; sh = h;
        DH = Math.max(16, Math.min(256, Math.round(DW * h / w)));
        small.width = DW; small.height = DH;
        prev = null; freq = new Float32Array(DW * DH); lastChg = new Float64Array(DW * DH); samples = 0; crop = null; pending = null;
      }
      if (now - lastSample < 90) return;
      lastSample = now;
      sg.drawImage(src, 0, 0, DW, DH);
      const px = sg.getImageData(0, 0, DW, DH).data;
      const n = DW * DH;
      const cur = new Uint8Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) cur[i] = (px[j] * 3 + px[j + 1] * 6 + px[j + 2]) / 10;
      if (prev) {
        for (let i = 0; i < n; i++) {
          const ch = Math.abs(cur[i] - prev[i]) > 3;
          freq[i] = freq[i] * 0.9 + (ch ? 0.1 : 0);
          if (ch) lastChg[i] = now;
        }
        samples++;
      }
      prev = cur;
      if (now - lastPick > 1000) { lastPick = now; pick(now); }
    },
    rect() { return crop; },
  };
}

ipcRenderer.on("pip-start", async (_e, o) => {
  await stop();
  const my = ++token;
  running = true;
  try {
    if (!navigator.mediaDevices) throw new Error("mediaDevices 없음(" + location.protocol + ")");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
      chromeMediaSource: "desktop", chromeMediaSourceId: o.id, maxWidth: 3840, maxHeight: 2160, maxFrameRate: o.fps } } });
    if (my !== token) { stream.getTracks().forEach((t) => t.stop()); return; }
    const track = stream.getVideoTracks()[0];
    if (track) track.onended = () => ipcRenderer.send("nova-pip-ended");
    const out = new OffscreenCanvas(2, 2);
    const g = out.getContext("2d", { willReadFrequently: true });
    // 49-189차: 사용자가 [영역 지정]으로 고른 자리가 있으면 그 자리(창 전체를 0~1로 본 값) - 자동 찾기는 안 한다
    const area = o.area && o.area.w > 0.01 && o.area.h > 0.01 ? o.area : null;
    const cropper = o.crop && !area ? makeCropper(o.ratio) : null;
    const gap = Math.max(1000 / 61, 1000 / o.fps - 2);
    let busy = false, lastSent = 0, lastDiag = 0;
    // 49-199차(사용자: "영상 그거 계속 다른 화면으로 넘기면 검정색 화면 되고 가끔은 또 되고"): 찍는 창이 새까맣게만 오는
    // 경우(크롬 창이 크기/전체 화면이 바뀐 뒤 캡처가 끊긴 채 남거나, 다른 창에 완전히 가려져 크롬이 그리기를 멈춘 경우)를
    // 0.25초마다 16x9로 줄여 본다. 창 전체(탭 줄 포함)가 2초 넘게 완전히 검으면 검은 장은 보내지 않고(모드는 마지막 장을 유지)
    // 런처에 알려 캡처를 다시 잇게 한다. 다시 그림이 오면 그것도 알린다.
    const probe = new OffscreenCanvas(16, 9);
    const pg = probe.getContext("2d", { willReadFrequently: true });
    let lastProbe = 0, blackSince = 0, blackSent = false, okSent = false;
    const handle = (src, sw, sh) => {
      const now = performance.now();
      if (now - lastProbe > 250) {
        lastProbe = now;
        pg.drawImage(src, 0, 0, 16, 9);
        const pd = pg.getImageData(0, 0, 16, 9).data;
        let mx = 0;
        for (let i = 0; i < pd.length; i += 4) mx = Math.max(mx, pd[i], pd[i + 1], pd[i + 2]);
        if (mx < 6) {
          if (!blackSince) blackSince = now;
          if (!blackSent && now - blackSince > 2000) { blackSent = true; ipcRenderer.send("nova-pip-black", sw + "x" + sh); }
        } else {
          if (blackSent || !okSent) ipcRenderer.send("nova-pip-ok", sw + "x" + sh);   // 다시 이은 뒤 첫 그림도 알린다
          okSent = true;
          blackSince = 0;
          blackSent = false;
        }
      }
      if (blackSent) return;   // 새까만 장은 안 보낸다
      if (cropper) cropper.feed(src, sw, sh, now);
      if (busy || now - lastSent < gap) return;
      const r = area
        ? { x: area.x * sw, y: area.y * sh, w: Math.max(2, area.w * sw), h: Math.max(2, area.h * sh) }
        : (cropper && cropper.rect()) || { x: 0, y: 0, w: sw, h: sh };
      // 49-189차: 게임에 그려질 폭 그대로(작은 영상은 여기서 부드럽게 키워 보낸다 - 마크에서 키우면 계단이 진다)
      const k = Math.min(o.maxW, 1920) / r.w;
      const w = Math.max(2, Math.round(r.w * k)), h = Math.max(2, Math.round(r.h * k));
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      g.imageSmoothingQuality = "high";
      g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
      if (now - lastDiag > 10000) {
        lastDiag = now;
        // 10초마다 한 번: 보낸 화면의 평균 밝기(0이면 검은 화면을 받고 있는 것) - 런처 로그로
        const d = g.getImageData(0, 0, w, h).data;
        let s = 0, c = 0;
        for (let i = 0; i < d.length; i += 4 * 97) { s += d[i] + d[i + 1] + d[i + 2]; c += 3; }
        ipcRenderer.send("nova-pip-diag", "원본 " + sw + "x" + sh + ", 자른 곳 " + Math.round(r.x) + "," + Math.round(r.y) + " " + Math.round(r.w) + "x" + Math.round(r.h) + ", 보냄 " + w + "x" + h + ", 밝기 " + Math.round(c ? s / c : 0));
      }
      busy = true;
      lastSent = now;
      // 49-195차(사용자: "영상 보기 아주 약간 밀리는 느낌"): PNG로 싸고(런처) 푸는(모드) 데만 한 장에 수십 ms가 걸려 늦게 보였다.
      // 모드가 받을 수 있다고 하면(o.raw) 1280x720 이하는 픽셀을 그대로 보낸다(싸고 푸는 시간 0).
      if (o.raw && w * h <= 1280 * 720) {
        const d = g.getImageData(0, 0, w, h).data;
        if (my === token) ipcRenderer.send("nova-pip-raw", w, h, new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
        busy = false;
        return;
      }
      out.convertToBlob({ type: "image/png" }).then((b) => b.arrayBuffer()).then((ab) => {
        if (my === token) ipcRenderer.send("nova-pip-frame", new Uint8Array(ab));
        busy = false;
      }, () => { busy = false; });
    };
    if (typeof MediaStreamTrackProcessor === "function") {
      reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      while (running && my === token) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        try { handle(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
      }
    } else {
      video = document.createElement("video");
      video.muted = true;
      video.style.cssText = "position:fixed;left:0;top:0;width:4px;height:4px;opacity:0.01";
      document.body.appendChild(video);
      video.srcObject = stream;
      await video.play();
      timer = setInterval(() => { if (video && video.videoWidth) handle(video, video.videoWidth, video.videoHeight); }, Math.max(16, Math.round(1000 / o.fps)));
    }
  } catch (err) {
    if (my === token) ipcRenderer.send("nova-pip-error", String((err && err.message) || err));
  }
});
</script></body>`;

function pipStateWrite(w) {
  if (!w) return;
  try {
    const pipBody = JSON.stringify({
      ts: Date.now(), port: w.port || 0, running: !!w.sourceName, window: w.sourceName || "",
      error: w.error || null, count: w.count || 0, list: (w.list || []).slice(0, 20),
    });
    for (const p of modIoPaths(w.runRoot, "pip-state.json")) {
      try { fs.writeFileSync(p, pipBody, "utf-8"); } catch (_) {}
    }
  } catch (_) {}
}

function pipEnsureWindow(w) {
  if (w.win && !w.win.isDestroyed()) return w.ready;
  w.win = new BrowserWindow({
    show: false, width: 320, height: 240, skipTaskbar: true, focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, partition: "nova-pip" },
  });
  w.ready = new Promise((res) => w.win.webContents.once("did-finish-load", res));
  // 49-180차: data: 주소는 "안전한 페이지"가 아니라서 navigator.mediaDevices 자체가 없다(캡처 실패:
  // "Cannot read properties of undefined (reading 'getUserMedia')"). 파일로 써서 file://로 연다.
  let pipFile = null;
  try {
    pipFile = path.join(app.getPath("userData"), "nova-pip.html");
    fs.writeFileSync(pipFile, PIP_HTML, "utf-8");
  } catch (err) {
    pipFile = null;
    logToFile("[노바 모드][영상] 캡처 페이지 파일 쓰기 실패: " + (err?.message || err));
  }
  if (pipFile) w.win.loadFile(pipFile);
  else w.win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PIP_HTML));
  w.win.on("closed", () => { if (pipWatch === w) { w.win = null; w.ready = null; } });
  return w.ready;
}

function pipStopCapture(w) {
  if (!w) return;
  w.sourceName = "";
  if (w.win && !w.win.isDestroyed()) {
    try { w.win.webContents.send("pip-stop"); } catch (_) {}
    try { w.win.destroy(); } catch (_) {}
  }
  w.win = null;
  w.ready = null;
}

// 49-179차: 고를 수 있는 창 목록(영상 사이트 창 먼저, 그다음 브라우저 창). 마크와 런처 자신은 뺀다.
async function pipCandidates() {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const key = String(lastNowPlayingTitle || "").slice(0, 12).toLowerCase();
  const score = (n) => {
    const s = n.toLowerCase();
    let v = 0;
    if (PIP_SITES.test(n)) v += 4;
    if (key && s.includes(key)) v += 2;
    if (PIP_BROWSERS.test(n)) v += 1;
    return v;
  };
  return sources
    .filter((s) => s.name && !/^minecraft|nova client/i.test(s.name) && (PIP_SITES.test(s.name) || PIP_BROWSERS.test(s.name)))
    .sort((a, b) => score(b.name) - score(a.name));
}

async function pipRefreshList(w) {
  if (!w || w.listing) return;
  w.listing = true;
  try {
    const cands = await pipCandidates();
    w.list = cands.map((c) => c.name);
    w.count = cands.length;
  } catch (_) {
  } finally {
    w.listing = false;
  }
}

async function pipStart(w, req) {
  if (!w || w.starting) return;
  w.starting = true;
  w.req = req;
  w.wanted = true;
  w.lastTry = Date.now();
  try {
    // 49-187차: 60프레임, 폭 1920까지(모드가 화면에 그려질 실제 픽셀 폭을 보낸다). crop = 영상 부분만 자르기, ratio = normal|shorts
    const fps = Math.max(5, Math.min(60, Number(req.fps) || 60));
    const maxW = Math.max(160, Math.min(1920, Number(req.maxW) || 640));
    const crop = req.crop !== false;
    const ratio = req.ratio === "shorts" ? "shorts" : "normal";
    const raw = !!req.raw;   // 49-195차: 모드가 픽셀 그대로 받을 수 있음
    let area = null;
    const ap = String(req.area || "").split(",").map(Number);
    if (ap.length === 4 && ap.every((v) => Number.isFinite(v)) && ap[2] > 0.01 && ap[3] > 0.01) {
      area = { x: Math.max(0, ap[0]), y: Math.max(0, ap[1]), w: Math.min(1, ap[2]), h: Math.min(1, ap[3]) };
    }
    const areaKey = area ? ap.join(",") : "";
    let cands = [];
    try {
      cands = await pipCandidates();
    } catch (err) {
      w.error = "창 목록을 받지 못함";
      logToFile("[노바 모드][영상] 창 목록 실패: " + (err?.message || err));
      pipStateWrite(w);
      return;
    }
    w.count = cands.length;
    w.list = cands.map((c) => c.name);
    if (!cands.length) {
      pipStopCapture(w);
      w.error = "영상 창 없음 (브라우저에서 영상을 열어 두세요)";
      pipStateWrite(w);
      return;
    }
    // 49-179차: 모드에서 고른 창 이름이 있으면 그 창(탭 제목이 바뀌었으면 앞부분이 같은 창), 없으면 맨 위 후보
    const want = String(req.window || "");
    let pick = null;
    if (want) {
      pick = cands.find((c) => c.name === want)
        || cands.find((c) => c.name.slice(0, 24) === want.slice(0, 24))
        // 영상이 바뀌면 탭 제목(창 이름)도 바뀐다 - 지금 찍고 있는 그 창이 아직 있으면 그대로 둔다
        || (w.sourceId ? cands.find((c) => c.id === w.sourceId) : null)
        || null;
      if (!pick) {
        pipStopCapture(w);
        w.error = "고른 창이 닫혔거나 이름이 바뀜";
        pipStateWrite(w);
        return;
      }
    }
    if (!pick) pick = cands[0];
    if (w.sourceId === pick.id && w.win && !w.win.isDestroyed() && w.fps === fps && w.maxW === maxW && w.crop === crop && w.ratio === ratio && w.areaKey === areaKey && w.raw === raw) {
      w.sourceName = pick.name;   // 같은 창 그대로 - 이름(탭 제목)만 새로
      pipStateWrite(w);
      return;
    }
    w.error = null;
    w.sourceId = pick.id;
    w.sourceName = pick.name;
    w.fps = fps;
    w.maxW = maxW;
    w.crop = crop;
    w.ratio = ratio;
    w.areaKey = areaKey;
    w.raw = raw;
    await pipEnsureWindow(w);
    if (pipWatch !== w || !w.win || w.win.isDestroyed()) return;
    w.win.webContents.send("pip-start", { id: pick.id, fps, maxW, crop, ratio, area, raw });
    logToFile("[노바 모드][영상] 찍는 창: " + pick.name + " (" + fps + "fps, 너비 " + maxW + (area ? ", 고른 자리 " + areaKey : crop ? ", 영상 부분만 " + ratio : "") + ")");
    pipStateWrite(w);
  } finally {
    w.starting = false;
  }
}

// 49-195차(사용자: "영상 보기 아주 약간 밀리는 느낌"): 예전엔 모드가 못 따라오면 4MB(몇 장)까지 쌓아 두고 보내서 쌓인 만큼
// 늦게 보였다. 이제 앞 장을 다 넘기기 전엔 새 장을 건너뛴다 - 늘 가장 새 장만 간다.
function pipSendFrame(w, parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const head = Buffer.alloc(4);
  head.writeUInt32BE(len, 0);
  for (const c of w.clients) {
    if (c.destroyed || c.writableLength > 0) continue;
    c.write(head);
    for (const p of parts) c.write(p);
  }
}
ipcMain.on("nova-pip-frame", (e, data) => {
  const w = pipWatch;
  if (!w || !w.win || w.win.isDestroyed() || e.sender !== w.win.webContents || !w.clients.size) return;
  pipSendFrame(w, [Buffer.from(data)]);
});
// 49-195차: 픽셀 그대로(RGBA) - ["NRAW"][폭 4바이트][높이 4바이트][픽셀]. 모드가 raw를 부탁했을 때만 온다.
ipcMain.on("nova-pip-raw", (e, fw, fh, data) => {
  const w = pipWatch;
  if (!w || !w.win || w.win.isDestroyed() || e.sender !== w.win.webContents || !w.clients.size) return;
  const px = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (px.length !== fw * fh * 4) return;
  const hdr = Buffer.alloc(12);
  hdr.write("NRAW", 0, "latin1");
  hdr.writeUInt32BE(fw >>> 0, 4);
  hdr.writeUInt32BE(fh >>> 0, 8);
  pipSendFrame(w, [hdr, px]);
});
// 49-199차: 찍는 창이 2초 넘게 새까맣다 - 캡처를 새로 잇는다(창 크기/전체 화면이 바뀐 뒤 끊긴 경우는 이걸로 돌아온다).
// 세 번 이어 붙여도 계속 검으면 크롬이 가려져 그리기를 멈춘 것으로 보고 30초 쉬며 모드 화면에 이유를 띄운다.
ipcMain.on("nova-pip-black", (e, size) => {
  const w = pipWatch;
  if (!w || !w.win || w.win.isDestroyed() || e.sender !== w.win.webContents) return;
  const now = Date.now();
  w.blackCount = (w.blackCount || 0) + 1;
  if (w.blackCount > 3 || now < (w.blackPauseUntil || 0)) {
    if (w.blackCount === 4) {
      w.blackPauseUntil = now + 30000;
      logToFile("[노바 모드][영상] 계속 검은 화면(" + size + ") - 창이 가려져 브라우저가 그리기를 멈춘 것으로 봄");
    }
    w.error = "영상 창이 가려져 검게 찍힘 (브라우저 창이 조금이라도 보이게)";
    if (now >= (w.blackPauseUntil || 0)) w.blackCount = 0;   // 쉬는 시간이 끝나면 다시 이어 붙여 본다
    pipStateWrite(w);
    return;
  }
  logToFile("[노바 모드][영상] 검은 화면(" + size + ") - 캡처 다시 잇기 " + w.blackCount + "번째");
  w.error = "영상 다시 연결 중";
  pipStateWrite(w);
  const req = w.req;
  pipStopCapture(w);
  if (req) setTimeout(() => { if (pipWatch === w && w.wanted) pipStart(w, req).catch(() => {}); }, 300);
});
ipcMain.on("nova-pip-ok", (e, size) => {
  const w = pipWatch;
  if (!w || !w.win || w.win.isDestroyed() || e.sender !== w.win.webContents) return;
  if (w.blackCount) logToFile("[노바 모드][영상] 다시 그림이 옴(" + size + ")");
  w.blackCount = 0;
  w.blackPauseUntil = 0;
  w.error = null;
  pipStateWrite(w);
});
// 49-187차: 캡처 창이 10초마다 알려 주는 상태(원본 크기, 자른 곳, 밝기) - 검은 화면 같은 문제를 로그로 확인하려고
ipcMain.on("nova-pip-diag", (e, msg) => {
  const w = pipWatch;
  if (!w || !w.win || w.win.isDestroyed() || e.sender !== w.win.webContents) return;
  logToFile("[노바 모드][영상] " + String(msg).slice(0, 200));
});
ipcMain.on("nova-pip-error", (e, msg) => {
  const w = pipWatch;
  if (!w || !w.win || e.sender !== w.win.webContents) return;
  w.error = "영상 창을 찍지 못함";
  logToFile("[노바 모드][영상] 캡처 실패: " + msg);
  pipStopCapture(w);
  pipStateWrite(w);
});
ipcMain.on("nova-pip-ended", (e) => {
  const w = pipWatch;
  if (!w || !w.win || e.sender !== w.win.webContents) return;
  pipStopCapture(w);   // 창이 닫혔다 - 다음 감시 차례에 다른 창을 다시 찾는다
  w.sourceId = null;
  pipStateWrite(w);
});

function startPipWatcher(runRoot) {
  stopPipWatcher();
  if (process.platform !== "win32" || !runRoot) return;
  let reqPath = modIoReadPath(runRoot, "pip.json");
  modIoUnlinkAll(runRoot, "pip.json");
  const w = { runRoot, lastMtime: 0, clients: new Set(), port: 0, win: null, ready: null, wanted: false, req: null,
    sourceId: null, sourceName: "", error: null, count: 0, lastTry: 0, starting: false };
  pipWatch = w;
  w.server = net.createServer((sock) => {
    sock.setNoDelay(true);
    w.clients.add(sock);
    sock.on("error", () => {});
    sock.on("close", () => w.clients.delete(sock));
  });
  w.server.on("error", (err) => logToFile("[노바 모드][영상] 소켓 실패: " + (err?.message || err)));
  w.server.listen(0, "127.0.0.1", () => {
    w.port = w.server.address().port;
    pipStateWrite(w);
  });
  w.timer = setInterval(() => {
    let st = null;
    try { st = fs.statSync((reqPath = modIoReadPath(runRoot, "pip.json"))); } catch (_) {}
    if (st && st.mtimeMs !== w.lastMtime) {
      w.lastMtime = st.mtimeMs;
      let req = null;
      try { req = JSON.parse(fs.readFileSync(reqPath, "utf-8")); } catch (_) {}
      if (req && req.action === "start") pipStart(w, req).catch(() => {});
      else if (req && req.action === "stop") { w.wanted = false; pipStopCapture(w); w.sourceId = null; w.error = null; pipStateWrite(w); }
      return;
    }
    // 켜 둔 채 창을 못 찾았거나 창이 닫혔으면 5초마다 다시 찾는다
    if (w.wanted && !w.sourceName && Date.now() - w.lastTry > 5000 && w.req) pipStart(w, w.req).catch(() => {});
  }, 500);
  w.stateTimer = setInterval(() => {
    // 목록 화면이 늘 새 목록을 보도록 켜 둔 동안 2초마다 창 목록도 새로 읽는다
    if (w.wanted) pipRefreshList(w).catch(() => {});
    pipStateWrite(w);
  }, 2000);
}

function stopPipWatcher() {
  const w = pipWatch;
  if (!w) return;
  pipWatch = null;
  if (w.timer) clearInterval(w.timer);
  if (w.stateTimer) clearInterval(w.stateTimer);
  pipStopCapture(w);
  for (const c of w.clients) { try { c.destroy(); } catch (_) {} }
  try { w.server.close(); } catch (_) {}
  modIoUnlinkAll(w.runRoot, "pip.json");
  modIoUnlinkAll(w.runRoot, "pip-state.json");
}

// ----------------------------------------------------------------------------
// 49-76차(모드 6-5 "녹화"): ffmpeg를 런처가 받아 두고, 모드가 부탁하면 게임 창을 녹화함
// ----------------------------------------------------------------------------
// 49-72차의 GIF 녹화는 60fps·720p·무제한을 물리적으로 못 함(1분에 수 GB). 사용자 결정으로 ffmpeg.
//
// 왜 "런처가 창을 찍는가"(모드가 프레임을 넘기지 않고): 모드 안에서 화면을 GPU에서 읽어 오면
// (glReadPixels) 그 순간 렌더가 멈춰서 1080p60은 프레임이 눈에 띄게 떨어짐. ffmpeg의 gdigrab은
// 윈도우가 이미 합성해 둔 창 그림을 **런처가 띄운 별도 프로세스**에서 가져가므로 게임 프로세스에는
// 아무 비용이 없음. "프레임 드랍 없음"이 최우선이라 이쪽이 맞음. 대가는 ffmpeg 프로세스의 CPU
// (libx264 veryfast 1080p60 ≈ 코어 하나) - 게임 스레드가 아니라 다른 프로세스라 게임은 안 끊김.
//
// 흐름: 모드가 게임 폴더에 .nova-record.json {action:"start"|"stop", height, fps} 를 씀 → 런처가
// 0.5초마다 그 파일을 봄 → start면 게임 창 제목(프로세스 id로 찾음)으로 ffmpeg gdigrab을 띄움 →
// .nova-record-state.json {recording, since, dir, error} 를 써서 모드 HUD가 빨간 점을 그림.
// 12시간마다 파일을 끊는 건 ffmpeg segment 먹서가 함(-segment_time 43200). 게임이 끝나면 같이 끝냄.
//
// ffmpeg는 gyan.dev "essentials" 빌드(~30MB, gdigrab + libx264 포함)를 tools/ffmpeg/ 에 한 번 받아 둠.
// 실패하면 녹화만 안 될 뿐 게임엔 영향 없음(모드가 "런처가 ffmpeg를 아직 못 받았습니다"로 알림).
const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
let ffmpegEnsuring = null;

function ffmpegExePath() {
  const p = path.join(getRoot(), "tools", "ffmpeg", "ffmpeg.exe");
  return fs.existsSync(p) ? p : null;
}

async function ensureFfmpeg() {
  if (process.platform !== "win32") return null;
  const have = ffmpegExePath();
  if (have) return have;
  if (ffmpegEnsuring) return ffmpegEnsuring;
  ffmpegEnsuring = (async () => {
    const dir = path.join(getRoot(), "tools", "ffmpeg");
    const zip = path.join(dir, "ffmpeg.zip");
    try {
      logToFile("[노바 모드][녹화] ffmpeg 내려받는 중: " + FFMPEG_URL);
      await downloadFileWithProgress(FFMPEG_URL, zip, undefined, null);
      // zip 안의 ffmpeg-*-essentials_build/bin/ffmpeg.exe 하나만 꺼냄
      const z = new AdmZip(zip);
      const entry = z.getEntries().find((e) => /\/bin\/ffmpeg\.exe$/i.test(e.entryName));
      if (!entry) throw new Error("zip 안에 ffmpeg.exe가 없음");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, "ffmpeg.exe"), entry.getData());
      await fsp.unlink(zip).catch(() => {});
      logToFile("[노바 모드][녹화] ffmpeg 준비됨");
      // 게임이 이미 떠 있으면 모드에게 "이제 된다"고 알림
      if (recordWatch && !recordWatch.proc) recordStateWrite(recordWatch.runRoot, { recording: false, error: null, ready: true });
      return path.join(dir, "ffmpeg.exe");
    } catch (err) {
      logToFile("[노바 모드][녹화] ffmpeg 준비 실패(녹화만 비활성): " + (err?.message || err));
      await fsp.unlink(zip).catch(() => {});
      return null;
    } finally {
      ffmpegEnsuring = null;
    }
  })();
  return ffmpegEnsuring;
}

let recordWatch = null;      // { runRoot, pid, timer, proc, lastMtime }
// 앱이 뜨고 20초 뒤에 조용히 받아 둠(첫 녹화 때 기다리지 않게). 이미 있으면 아무 일도 안 함.
setTimeout(() => { ensureFfmpeg().catch(() => {}); }, 20000);

function recordStateWrite(runRoot, state) {
  try {
    // ready는 항상 같이 적는다 - 모드가 "지금 눌러도 되나"를 이 값으로만 본다
    const recBody = JSON.stringify({ ts: Date.now(), ready: !!ffmpegExePath(), ...state });
    for (const p of modIoPaths(runRoot, "record-state.json")) {
      try { fs.writeFileSync(p, recBody, "utf-8"); } catch (_) {}
    }
  } catch (_) {}
}

// 게임 창 제목 - 프로세스 id로 찾음(모드가 제목을 알려 줄 필요가 없고, 제목이 바뀌어도 시작 시점 것만 있으면 됨)
function windowTitleOfPid(pid) {
  return new Promise((resolve) => {
    try {
      const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { windowsHide: true });
      let out = "";
      ps.stdout.on("data", (d) => { out += String(d); });
      ps.on("close", () => resolve(out.trim()));
      ps.on("error", () => resolve(""));
    } catch (_) {
      resolve("");
    }
  });
}

async function recordStart(req) {
  const w = recordWatch;
  if (!w || w.proc) return;
  const ffmpeg = ffmpegExePath() || (await ensureFfmpeg());
  if (!ffmpeg) {
    recordStateWrite(w.runRoot, { recording: false, error: "런처가 ffmpeg를 아직 못 받았습니다" });
    return;
  }
  const title = w.pid ? await windowTitleOfPid(w.pid) : "";
  const height = Math.max(360, Math.min(2160, Number(req.height) || 1080));
  const fps = Math.max(24, Math.min(120, Number(req.fps) || 60));
  // 49-207차: 새 모드(.luna-record.json로 요청)와 옛 모드(nova-clips)는 보는 폴더가 다르다.
  // 49-212차(사용자: "밖으로 내보내는 파일 이름에 루나/노바 다 빼"): 새 모드는 clips 폴더에 clip_<시각>.mp4
  const outDir = path.join(w.runRoot, w.luna ? "clips" : "nova-clips");
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const input = title ? `title=${title}` : "desktop";
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "0", "-i", input,
    // 창이 목표보다 작으면 키우지 않음(min). 짝수 크기여야 yuv420p가 됨(-2)
    "-vf", `scale=-2:min(ih\\,${height})`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-g", String(fps * 2),
    // 12시간마다 새 파일(사용자 요청). 이름은 시작 시각
    "-f", "segment", "-segment_time", "43200", "-reset_timestamps", "1", "-strftime", "1",
    path.join(outDir, (w.luna ? "clip" : "nova") + "_%Y-%m-%d_%H-%M-%S.mp4"),
  ];
  let proc;
  try {
    proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  } catch (err) {
    recordStateWrite(w.runRoot, { recording: false, error: "ffmpeg 실행 실패" });
    logToFile("[노바 모드][녹화] 실행 실패: " + (err?.message || err));
    return;
  }
  w.proc = proc;
  let errText = "";
  proc.stderr.on("data", (d) => { errText += String(d); if (errText.length > 4000) errText = errText.slice(-4000); });
  proc.on("close", (code) => {
    if (recordWatch && recordWatch.proc === proc) recordWatch.proc = null;
    const bad = code !== 0 && code !== null && errText.trim();
    if (bad) logToFile("[노바 모드][녹화] ffmpeg 종료 코드 " + code + ": " + errText.trim().split("\n").slice(-3).join(" | "));
    if (w.runRoot) recordStateWrite(w.runRoot, { recording: false, error: bad ? "녹화가 끊겼습니다(런처 로그 참고)" : null, dir: outDir });
  });
  recordStateWrite(w.runRoot, { recording: true, since: Date.now(), dir: outDir, error: null, input: title ? "window" : "desktop" });
  logToFile("[노바 모드][녹화] 시작: " + input + " → " + outDir + " (" + height + "p " + fps + "fps)");
}

function recordStop() {
  const w = recordWatch;
  if (!w || !w.proc) return;
  try {
    w.proc.stdin.write("q\n");   // 정상 종료 - 파일 끝(moov)을 제대로 닫음
  } catch (_) {
    try { w.proc.kill(); } catch (_) {}
  }
  setTimeout(() => { try { if (w.proc) w.proc.kill(); } catch (_) {} }, 5000);
}

function startRecordWatcher(runRoot, pid) {
  stopRecordWatcher();
  if (process.platform !== "win32" || !runRoot) return;
  let reqPath = modIoReadPath(runRoot, "record.json");
  modIoUnlinkAll(runRoot, "record.json");
  recordStateWrite(runRoot, { recording: false, error: null, ready: !!ffmpegExePath() });
  recordWatch = { runRoot, pid: pid || null, proc: null, lastMtime: 0, timer: null };
  const w = recordWatch;
  w.timer = setInterval(async () => {
    let st;
    try { st = fs.statSync((reqPath = modIoReadPath(runRoot, "record.json"))); } catch (_) { return; }
    if (st.mtimeMs === w.lastMtime) return;
    w.lastMtime = st.mtimeMs;
    let req;
    try { req = JSON.parse(fs.readFileSync(reqPath, "utf-8")); } catch (_) { return; }
    w.luna = path.basename(reqPath).startsWith(".luna-");   // 49-207차: 어느 모드가 요청했는지(녹화 폴더 결정)
    if (req.action === "start") await recordStart(req);
    else if (req.action === "stop") recordStop();
  }, 500);
  // 미리 받아 둠 - 처음 누르는 순간 30MB를 기다리지 않게
  ensureFfmpeg().catch(() => {});
}

function stopRecordWatcher() {
  const w = recordWatch;
  if (!w) return;
  if (w.timer) clearInterval(w.timer);
  recordStop();
  modIoUnlinkAll(w.runRoot, "record.json");
  modIoUnlinkAll(w.runRoot, "record-state.json");
  recordWatch = null;
}

// ==================== 49-106차(모드: 세션 복구): 게임 안 "세션이 잘못됨" 화면의 [세션 새로고침 후 재접속] ====================
// 모드가 .nova-relogin.json{action:"refresh"} 를 쓰면, 활성 계정의 토큰을 강제로 새로 받아
// .nova-relogin-result.json{ts, sig, uuid, name, accessToken}(우리 비밀값으로 서명)에 써 준다. 모드는 서명을
// 확인하고 게임 세션을 그 토큰으로 교체한 뒤 바로 재접속한다 - 게임/런처 재시작이 필요 없다.
let reloginWatch = null;

function startReloginWatcher(runRoot) {
  stopReloginWatcher();
  if (!runRoot) return;
  let reqPath = modIoReadPath(runRoot, "relogin.json");
  modIoUnlinkAll(runRoot, "relogin.json");
  modIoUnlinkAll(runRoot, "relogin-result.json");
  reloginWatch = { runRoot, lastMtime: 0, timer: null, busy: false };
  const w = reloginWatch;
  w.timer = setInterval(async () => {
    let st;
    try { st = fs.statSync((reqPath = modIoReadPath(runRoot, "relogin.json"))); } catch (_) { return; }
    if (st.mtimeMs === w.lastMtime) return;
    w.lastMtime = st.mtimeMs;
    let req;
    try { req = JSON.parse(fs.readFileSync(reqPath, "utf-8")); } catch (_) { return; }
    if (req.action !== "refresh" || w.busy) return;
    w.busy = true;
    try { await reloginRefresh(runRoot); } finally { w.busy = false; }
  }, 400);
}

function stopReloginWatcher() {
  const w = reloginWatch;
  if (!w) return;
  if (w.timer) clearInterval(w.timer);
  modIoUnlinkAll(w.runRoot, "relogin.json");
  modIoUnlinkAll(w.runRoot, "relogin-result.json");
  reloginWatch = null;
}

// 활성 계정 토큰을 강제 갱신(mc.refresh(true))해서 서명된 결과 파일로 내려 준다.
async function reloginRefresh(runRoot) {
  try {
    const activeUuid = store.get("active_uuid") || null;
    const accounts = getAccounts();
    const acc = activeUuid ? accounts[activeUuid] : null;
    if (!acc || !acc.savedToken) {
      logToFile("[노바 세션복구] 활성 계정이 없어 세션을 새로 받지 못함");
      return;
    }
    const authManager = new Auth("select_account");
    let mc = tokenUtils.fromMclcToken(authManager, acc.savedToken);
    mc = await Promise.race([
      mc.refresh(true),   // true = 만료 여부와 무관하게 강제 갱신(세션이 이미 죽어 있으므로)
      new Promise((_, reject) => setTimeout(() => reject(new Error("토큰 갱신 시간 초과")), 10000)),
    ]);
    const mclcAuth = mc.mclc();
    const accessToken = mclcAuth?.access_token || mclcAuth?.accessToken || null;
    if (!accessToken) {
      logToFile("[노바 세션복구] 새 액세스 토큰을 받지 못함");
      return;
    }
    const name = mclcAuth?.profile?.name || acc.name;
    const uuid = normalizeUuid(mclcAuth?.profile?.id || acc.uuid);
    try { saveAccount(acc.uuid, name, mc.mclc(true)); } catch (_) {}
    try { cachedAuthorization = mc.mclc(); } catch (_) {}
    const ts = Date.now();
    const sig = crypto.createHmac("sha256", NOVA_LAUNCH_SECRET).update("NovaClient::" + ts).digest("hex");
    fs.writeFileSync(path.join(runRoot, ".nova-relogin-result.json"),
      JSON.stringify({ ts, sig, uuid, name, accessToken }), "utf-8");
    // 49-207차: 새 모드(Luna's Light)용 - 서명 앞머리만 다르다
    fs.writeFileSync(path.join(runRoot, ".luna-relogin-result.json"),
      JSON.stringify({ ts, sig: launchSigFor("LunaClient::", ts), uuid, name, accessToken }), "utf-8");
    logToFile("[노바 세션복구] 세션 새로 발급 완료: " + name);
  } catch (err) {
    logToFile("[노바 세션복구] 실패: " + (err?.message || err));
  }
}

// 49-102차(사용자: "PIP 기능 삭제해줘"): 유튜브 창(PIP) 기능 제거. 모드의 PIP 창 모듈(YoutubeWindowModule)과
// 함께, 여기 있던 .nova-mirror 파일 감시 + always-on-top WebContentsView 창(mirror*) 코드를 전부 뺐다.

// 내 프로필 자기소개 저장 (설정 > 스킨 탭에서 입력)
ipcMain.handle("profile:set-bio", async (_e, bio) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  try {
    await supabaseFetch("/user_profiles", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ uuid: me.uuid, mc_name: me.name, bio: String(bio || "").slice(0, 200) }),
    });
    return { ok: true };
  } catch (err) {
    logToFile("자기소개 저장 실패: " + (err?.message || err));
    return { ok: false, error: "저장에 실패했어요." };
  }
});

// 두 uuid가 서로 친구(수락된 관계)인지 확인 - 프로필 비공개, 귓속말 권한 체크에 씀
async function checkAreFriends(uuidA, uuidB) {
  if (!uuidA || !uuidB) return false;
  if (isSameUuid(uuidA, uuidB)) return true; // 본인은 항상 통과
  try {
    const rows = await supabaseFetch(
      `/friends?or=(and(requester_uuid.eq.${uuidA},addressee_uuid.eq.${uuidB}),and(requester_uuid.eq.${uuidB},addressee_uuid.eq.${uuidA}))&status=eq.accepted&select=id&limit=1`
    );
    return (rows || []).length > 0;
  } catch (err) {
    logToFile("친구 여부 확인 실패: " + (err?.message || err));
    return false;
  }
}

// 닉네임으로 유저 검색 (친구 추가할 대상 찾기)
// 24-23차: 레거시/미사용 - 친구는 이제 마인크래프트 닉네임(user_profiles.mc_name)이 아니라
// 노바 클라이언트 닉네임으로 추가하게 바뀌었고(friends:add 참고), 이 핸들러를 호출하는 UI가
// 없어서(렌더러 어디에서도 friendsSearch를 안 씀) 새 방식으로 다시 만들지 않고 그대로 둠
ipcMain.handle("friends:search", async (_e, query) => {
  const me = getMyIdentity();
  const q = String(query || "").trim();
  if (!q || !me.uuid) return [];
  try {
    const rows = await supabaseFetch(
      `/user_profiles?mc_name=ilike.*${encodeURIComponent(q)}*&uuid=neq.${me.uuid}&select=uuid,mc_name&limit=8`
    );
    return (rows || []).map((r) => ({ uuid: r.uuid, name: r.mc_name }));
  } catch (err) {
    logToFile("친구 검색 실패: " + (err?.message || err));
    return [];
  }
});

// 친구 요청 보내기 (상대가 이미 나한테 요청을 보내둔 상태면, 새로 안 만들고 바로 수락 처리)
// 24-23차: "마크 계정끼리가 아니라 노바클 계정끼리, 노바클 닉네임으로" - user_profiles.mc_name
// (마인크래프트 닉네임) 검색 대신 Nova Site의 social 엔드포인트로 노바 클라이언트 닉네임 ->
// 노바 계정 id를 찾고, friends 테이블에는 그 id를 담음(컬럼명은 그대로 requester_uuid/
// addressee_uuid지만 이제 담기는 값의 의미가 노바 계정 id - sql/2026-08-30_friends_nova_
// account_identity.sql 주석 참고)
ipcMain.handle("friends:add", async (_e, targetNickname) => {
  const me = getMySiteIdentity();
  if (!me.id) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  const nickname = String(targetNickname || "").trim();
  if (!nickname) return { ok: false, error: "닉네임을 입력해주세요." };
  if (nickname.toLowerCase() === me.name.toLowerCase()) return { ok: false, error: "자기 자신은 추가할 수 없어요." };

  try {
    const found = await novaSiteFetch("social", { by: "nickname", nickname });
    if (!found?.ok) return { ok: false, error: "해당 닉네임의 노바 클라이언트 계정을 찾을 수 없어요." };
    const targetId = found.id;
    if (isSameUuid(targetId, me.id)) return { ok: false, error: "자기 자신은 추가할 수 없어요." };

    // 이미 관계가 있는지 확인 (양방향 다 확인) - "계정을 못 찾음"과 별개로, 찾은 다음엔
    // 반드시 이 체크가 먼저 실행되므로 이미 친구인 경우 정확한 "이미 친구예요" 메시지가 뜸
    const existing = await supabaseFetch(
      `/friends?or=(and(requester_uuid.eq.${me.id},addressee_uuid.eq.${targetId}),and(requester_uuid.eq.${targetId},addressee_uuid.eq.${me.id}))&select=*`
    );
    const foundRel = existing[0];
    if (foundRel) {
      if (foundRel.status === "accepted") return { ok: false, error: "이미 친구예요." };
      if (isSameUuid(foundRel.requester_uuid, targetId)) {
        // 상대가 먼저 나한테 요청을 보내둔 상태 -> 바로 수락
        await supabaseFetch(`/friends?id=eq.${foundRel.id}`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) });
        return { ok: true, accepted: true };
      }
      return { ok: false, error: "이미 친구 요청을 보냈어요." };
    }

    await supabaseFetch("/friends", {
      method: "POST",
      body: JSON.stringify({
        requester_uuid: me.id,
        requester_name: me.name,
        addressee_uuid: targetId,
        addressee_name: found.nickname,
        status: "pending",
      }),
    });
    return { ok: true, accepted: false };
  } catch (err) {
    logToFile("친구 요청 실패: " + (err?.message || err));
    return { ok: false, error: "친구 요청에 실패했어요. 잠시 후 다시 시도해주세요." };
  }
});

// 24-23차: user_profiles(마인크래프트 uuid) 대신 site_presence(노바 계정 id)에서 온라인 상태를
// 읽음. entry.uuid 필드명은 렌더러 호환을 위해 그대로 두지만, 이제 담기는 값은 마인크래프트
// uuid가 아니라 노바 계정 id(entry.accountId에도 동일한 값을 같이 내려줘서 새 코드는 이 이름을
// 쓰게 함 - 렌더러의 친구 클릭 처리는 이 id를 social:resolve-account-mc로 다시 마인크래프트
// uuid로 변환해서 프로필 팝업을 염, renderer.js 참고)
ipcMain.handle("friends:list", async () => {
  const me = getMySiteIdentity();
  if (!me.id) return { friends: [], incoming: [], outgoing: [] };
  try {
    const rows = await supabaseFetch(
      `/friends?or=(requester_uuid.eq.${me.id},addressee_uuid.eq.${me.id})&select=*&order=created_at.desc`
    );

    const otherIds = new Set();
    (rows || []).forEach((r) => otherIds.add(isSameUuid(r.requester_uuid, me.id) ? r.addressee_uuid : r.requester_uuid));

    let presenceMap = {}; // 17차: "online"/"away"/"offline" 3단계
    let statusMap = {};
    let statusKindMap = {};
    let statusRefMap = {};
    let statusVersionMap = {};
    if (otherIds.size > 0) {
      const idFilter = Array.from(otherIds).join(",");
      const presences = await supabaseFetch(
        `/site_presence?nova_account_id=in.(${idFilter})&select=nova_account_id,updated_at,status_text,status_kind,status_ref,status_version`
      );
      const now = Date.now();
      (presences || []).forEach((p) => {
        const elapsed = now - new Date(p.updated_at).getTime();
        presenceMap[p.nova_account_id] =
          elapsed < FRIEND_ONLINE_WINDOW_MS ? "online" : elapsed < FRIEND_AWAY_WINDOW_MS ? "away" : "offline";
      });
      statusMap = Object.fromEntries((presences || []).map((p) => [p.nova_account_id, p.status_text || ""]));
      statusKindMap = Object.fromEntries((presences || []).map((p) => [p.nova_account_id, p.status_kind || null]));
      statusRefMap = Object.fromEntries((presences || []).map((p) => [p.nova_account_id, p.status_ref || null]));
      statusVersionMap = Object.fromEntries((presences || []).map((p) => [p.nova_account_id, p.status_version || null]));
    }

    const friends = [];
    const incoming = [];
    const outgoing = [];
    const blocked = [];
    for (const r of rows || []) {
      const isMeRequester = isSameUuid(r.requester_uuid, me.id);
      const otherId = isMeRequester ? r.addressee_uuid : r.requester_uuid;
      const otherName = isMeRequester ? r.addressee_name : r.requester_name;
      const presence = presenceMap[otherId] || "offline";
      const online = presence !== "offline"; // 하위 호환(online=자리비움 포함)
      const entry = {
        id: r.id,
        uuid: otherId, // 이제 노바 계정 id (필드명은 렌더러 호환용으로 유지)
        accountId: otherId,
        name: otherName,
        online,
        presence, // "online" | "away" | "offline"
        status: presence !== "offline" ? statusMap[otherId] || "" : "",
        statusKind: presence !== "offline" ? statusKindMap[otherId] || null : null,
        statusRef: presence !== "offline" ? statusRefMap[otherId] || null : null,
        statusVersion: presence !== "offline" ? statusVersionMap[otherId] || null : null,
      };
      // 24-61차: friends:block 핸들러를 채워넣으면서 status="blocked" 행이 실제로 생기기
      // 시작하니, friends:list도 그걸 인지해야 함 - "내가 차단함"(requester=나)일 때만
      // "차단 관련" 목록에 보여주고, "상대가 나를 차단함"(requester=상대)이면 친구/요청/차단
      // 어디에도 안 보이게 완전히 숨김(상대는 내가 차단한 걸 알 필요가 없는 것과 대칭)
      if (r.status === "blocked") {
        if (isMeRequester) blocked.push(entry);
        continue;
      }
      if (r.status === "accepted") friends.push(entry);
      else if (isMeRequester) outgoing.push(entry);
      else incoming.push(entry);
    }
    return { friends, incoming, outgoing, blocked };
  } catch (err) {
    logToFile("친구 목록 조회 실패: " + (err?.message || err));
    return { friends: [], incoming: [], outgoing: [], blocked: [] };
  }
});

ipcMain.handle("friends:accept", async (_e, requestId) => {
  try {
    await supabaseFetch(`/friends?id=eq.${requestId}`, { method: "PATCH", body: JSON.stringify({ status: "accepted" }) });
    return { ok: true };
  } catch (err) {
    logToFile("친구 수락 실패: " + (err?.message || err));
    return { ok: false, error: "처리에 실패했어요." };
  }
});

// 거절 / 요청 취소 / 친구 삭제 - 다 같은 행 삭제라 하나로 처리
ipcMain.handle("friends:remove", async (_e, requestId) => {
  try {
    await supabaseFetch(`/friends?id=eq.${requestId}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    logToFile("친구 삭제 실패: " + (err?.message || err));
    return { ok: false, error: "처리에 실패했어요." };
  }
});

// 24-61차 신규: "차단하기" 실제 처리 핸들러. preload.js(friendsBlock)/renderer.js
// (submitFriendBlock, 친구 우클릭 메뉴)에서는 이미 이 IPC를 부르고 있었는데, 정작 main.js에
// 이 핸들러 자체가 없어서 지금까지 "차단" 버튼/메뉴를 눌러도 조용히 실패하고 있었음(코드
// sql/2026-09-04_friends_blocked_status.sql 주석에 이 핸들러 존재를 전제로 한 마이그레이션
// 안내가 이미 있었는데 실제 핸들러가 빠져 있었던 것 - 이번에 같이 채워넣음).
// friends:add와 거의 동일하게 닉네임 -> 노바 계정 id로 찾은 뒤, 기존 관계가 있으면(친구/요청
// 중이었어도) status="blocked"로 덮어쓰고, 없으면 새로 만듦. 이때 requester_uuid를 항상
// "차단하는 나"로 맞춰둬야 friends:list에서 "내가 차단함"과 "상대가 나를 차단함"을 구분할 수
// 있음(전자만 "차단 관련" 목록에 보여주고, 후자는 완전히 숨김)
ipcMain.handle("friends:block", async (_e, targetNickname) => {
  const me = getMySiteIdentity();
  if (!me.id) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  const nickname = String(targetNickname || "").trim();
  if (!nickname) return { ok: false, error: "닉네임을 입력해주세요." };
  if (nickname.toLowerCase() === me.name.toLowerCase()) return { ok: false, error: "자기 자신은 차단할 수 없어요." };

  try {
    const found = await novaSiteFetch("social", { by: "nickname", nickname });
    if (!found?.ok) return { ok: false, error: "해당 닉네임의 노바 클라이언트 계정을 찾을 수 없어요." };
    const targetId = found.id;
    if (isSameUuid(targetId, me.id)) return { ok: false, error: "자기 자신은 차단할 수 없어요." };

    const existing = await supabaseFetch(
      `/friends?or=(and(requester_uuid.eq.${me.id},addressee_uuid.eq.${targetId}),and(requester_uuid.eq.${targetId},addressee_uuid.eq.${me.id}))&select=*`
    );
    const foundRel = existing[0];
    if (foundRel) {
      await supabaseFetch(`/friends?id=eq.${foundRel.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          requester_uuid: me.id,
          requester_name: me.name,
          addressee_uuid: targetId,
          addressee_name: found.nickname,
          status: "blocked",
        }),
      });
    } else {
      await supabaseFetch("/friends", {
        method: "POST",
        body: JSON.stringify({
          requester_uuid: me.id,
          requester_name: me.name,
          addressee_uuid: targetId,
          addressee_name: found.nickname,
          status: "blocked",
        }),
      });
    }
    return { ok: true };
  } catch (err) {
    logToFile("친구 차단 실패: " + (err?.message || err));
    return { ok: false, error: "차단에 실패했어요. 잠시 후 다시 시도해주세요(supabase의 friends.status에 옛 CHECK 제약이 남아있으면 sql/2026-09-04_friends_blocked_status.sql을 먼저 실행해주세요)." };
  }
});

// 24-23차 신규: 친구 목록(노바 계정 id)에서 그 친구의 전체 프로필 팝업(스킨/게시글 - 전부
// 마인크래프트 uuid 기준)으로 넘어갈 때 씀 - 그 노바 계정에 연동된 마인크래프트 캐릭터 중
// 첫 번째(가장 먼저 연동한 것)를 대표로 골라서 돌려줌. 연동된 마인크래프트 계정이 하나도
// 없으면(사이트 계정만 만들고 마인크래프트는 아직 연동 안 한 친구) noMinecraft:true만 내려줌
ipcMain.handle("social:resolve-account-mc", async (_e, accountId) => {
  if (!accountId) return { ok: false };
  try {
    const res = await novaSiteFetch("social", { by: "accountId", accountId });
    if (!res?.ok) return { ok: false };
    const first = (res.minecraftAccounts || [])[0];
    if (!first) return { ok: false, noMinecraft: true, nickname: res.nickname };
    return { ok: true, uuid: first.uuid, name: first.name, nickname: res.nickname };
  } catch (err) {
    logToFile("친구 프로필용 마인크래프트 계정 조회 실패: " + (err?.message || err));
    return { ok: false };
  }
});

// ----------------------------------------------------------------------------
// 귓속말 (친구끼리만 가능 - 실시간 소켓은 없어서, 창을 열어둔 동안 짧은 주기로 다시 불러오는 방식)
// ----------------------------------------------------------------------------
// 11-5 (미구현/보류): "귓속말을 별도 OS 창으로 띄우기" 요청 - 지금은 메인 창 안의 팝업(overlay)
// 이지만, 별도 창으로 만들려면 대략 아래 작업이 다 필요해서 라이브 테스트 없이 안전하게 끝내기엔
// 범위가 커 이번엔 보류하고 TODO만 남겨둠:
//   1) 친구별(또는 통합) 귓속말 전용 BrowserWindow를 새로 만들고, 그 창만을 위한 별도 렌더러
//      HTML/JS 번들이 필요함 (지금 whisper-popup은 index.html 안의 오버레이라 그대로 못 씀)
//   2) 메인 창과 귓속말 창 사이에 새 메시지 도착을 실시간으로 동기화할 IPC 브로드캐스트
//      (지금의 4초 폴링 방식 대신, 새 메시지가 오면 두 창 다 갱신되도록)
//   3) 여러 친구와 동시에 귓속말할 때 창을 여러 개 띄울지/탭으로 합칠지 UX 결정
//   4) 창 위치/포커스 관리 (메인 창을 최소화해도 귓속말 창은 남아있어야 하는지 등)
//   5) preload.js에 그 창 전용 contextBridge API 추가
// 24-23차: 귓속말도 친구와 동일하게 노바 계정 id 기준으로 바뀜 - toUuid 파라미터명은 그대로
// 두지만(호출부 다수라 이름 자체를 바꾸진 않음) 실제로 넘어오는 값은 이제 노바 계정 id
ipcMain.handle("whisper:send", async (_e, { toUuid, message }) => {
  const me = getMySiteIdentity();
  if (!me.id) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  const text = String(message || "").trim().slice(0, 500);
  if (!text) return { ok: false, error: "메시지를 입력해주세요." };
  if (!toUuid) return { ok: false, error: "받는 사람을 찾을 수 없어요." };

  const isFriend = await checkAreFriends(me.id, toUuid);
  if (!isFriend) return { ok: false, error: "친구끼리만 귓속말을 보낼 수 있어요." };

  try {
    const targets = await supabaseFetch(`/site_presence?nova_account_id=eq.${toUuid}&select=nickname&limit=1`);
    const toName = targets[0]?.nickname || "알 수 없음";
    await supabaseFetch("/whispers", {
      method: "POST",
      body: JSON.stringify({
        sender_uuid: me.id,
        sender_name: me.name,
        receiver_uuid: toUuid,
        receiver_name: toName,
        message: text,
      }),
    });
    return { ok: true };
  } catch (err) {
    logToFile("귓속말 보내기 실패: " + (err?.message || err));
    return { ok: false, error: "전송에 실패했어요. 잠시 후 다시 시도해주세요." };
  }
});

// 특정 친구와의 대화 내역 (최근 100개, 오래된 순)
ipcMain.handle("whisper:list", async (_e, otherUuid) => {
  const me = getMySiteIdentity();
  if (!me.id || !otherUuid) return [];
  try {
    const rows = await supabaseFetch(
      `/whispers?or=(and(sender_uuid.eq.${me.id},receiver_uuid.eq.${otherUuid}),and(sender_uuid.eq.${otherUuid},receiver_uuid.eq.${me.id}))&select=*&order=created_at.asc&limit=100`
    );
    return (rows || []).map((r) => ({
      id: r.id,
      fromMe: isSameUuid(r.sender_uuid, me.id),
      message: r.message,
      createdAt: r.created_at,
    }));
  } catch (err) {
    logToFile("귓속말 조회 실패: " + (err?.message || err));
    return [];
  }
});

// 15-6(6차): 친구 목록에 "안 읽은 귓속말 있음" 빨간 점을 표시하기 위한 최소 구현.
// 진짜 실시간 푸시(소켓)는 없어서(위 11-5 TODO 참고), 마지막으로 그 친구와의 귓속말 창을
// 열었던 시각을 electron-store에 저장해두고, 친구 목록을 새로고침할 때마다 그 시각 이후에
// 온 귓속말이 있는지 조회해서 비교하는 방식 -> "친구 목록이 로드/새로고침될 때" 기준의
// best-effort이고, 목록을 안 열어둔 채로 새 귓속말이 와도 그 순간엔 빨간 점이 안 뜸(다음
// 새로고침 때 뜸). 읽음 시각 자체는 로컬(이 컴퓨터)에만 저장됨 - 다른 기기와는 동기화 안 됨.
function getWhisperReadMap() {
  return store.get("whisper_read_map") || {};
}
ipcMain.handle("whisper:mark-read", (_e, otherUuid) => {
  if (!otherUuid) return { ok: false };
  const map = getWhisperReadMap();
  map[normalizeUuid(otherUuid)] = new Date().toISOString();
  store.set("whisper_read_map", map);
  return { ok: true };
});

ipcMain.handle("whisper:unread-senders", async (_e, friendUuids) => {
  const me = getMySiteIdentity();
  if (!me.id || !Array.isArray(friendUuids) || friendUuids.length === 0) return [];
  try {
    const rows = await supabaseFetch(
      `/whispers?receiver_uuid=eq.${me.id}&select=sender_uuid,created_at&order=created_at.desc&limit=300`
    );
    const readMap = getWhisperReadMap();
    const latestBySender = {};
    for (const r of rows || []) {
      const key = normalizeUuid(r.sender_uuid);
      if (!latestBySender[key]) latestBySender[key] = r.created_at;
    }
    const unread = [];
    for (const uuid of friendUuids) {
      const key = normalizeUuid(uuid);
      const latest = latestBySender[key];
      if (!latest) continue;
      const readAt = readMap[key];
      if (!readAt || new Date(latest) > new Date(readAt)) unread.push(uuid);
    }
    return unread;
  } catch (err) {
    logToFile("귓속말 안읽음 조회 실패: " + (err?.message || err));
    return [];
  }
});

// ── 24-187차: 친구 초대·귓속말이 오면 바로 보이게(신호 방식) ─────────────────────
// 사용자: "그 친구 초대가 왔을 때랑 귓속말 왔을 때 바로바로 안보여 새로고침을 더 빠르게
// 해줘야 할 듯 아니면 신호를 받으면 주거나"
//
// 여태 친구 목록(friends:list)은 45초마다, 귓속말은 창을 열어둔 동안만 4초마다 새로
// 받아왔다. 그래서 초대가 와도 최대 45초, 귓속말도 창을 닫아뒀으면 빨간 점이 뜨기까지
// 최대 45초가 걸렸다. friends:list 는 친구 수만큼 조회가 딸려 있어서 그걸 그냥 4초마다
// 돌리면 요청이 몇 배로 늘어난다.
//
// 그래서 "새 게 왔는지"만 보는 아주 가벼운 확인(각각 최신 1행)을 메인 프로세스에서 짧은
// 간격으로 돌리고, 바뀐 게 있을 때만 렌더러에 신호(social:signal)를 밀어준다. 렌더러는
// 그 신호를 받은 순간에만 무거운 새로고침을 한다 - 평소 요청량은 거의 그대로인데 체감은
// 바로 뜨는 것처럼 된다.
const SOCIAL_SIGNAL_MS_ACTIVE = 4000;   // 런처 창을 보고 있을 때
const SOCIAL_SIGNAL_MS_IDLE = 20000;    // 창을 내려놨거나 트레이에 숨겼을 때
let socialSignalTimer = null;
let socialSignalMs = 0;
let socialSignalInFlight = false;
let socialSignalPrimed = false;         // 첫 확인은 기준만 잡고 알림은 띄우지 않는다
let socialLastWhisperAt = null;
let socialLastRequestAt = null;

// 로그아웃/계정 전환 때는 기준을 지워서, 새 계정의 옛 귓속말이 "새로 왔다"고 뜨지 않게 한다
function resetSocialSignalBaseline() {
  socialSignalPrimed = false;
  socialLastWhisperAt = null;
  socialLastRequestAt = null;
}

function isNewerIso(a, b) {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

async function checkSocialSignal() {
  if (socialSignalInFlight) return;
  const me = getMySiteIdentity();
  if (!me.id) { resetSocialSignalBaseline(); return; }
  socialSignalInFlight = true;
  try {
    // 각각 최신 1행만. 친구 요청은 "아직 안 받은 것(pending)"만 본다.
    const [whispers, requests] = await Promise.all([
      supabaseFetch(
        `/whispers?receiver_uuid=eq.${me.id}&select=sender_uuid,sender_name,created_at&order=created_at.desc&limit=1`
      ).catch(() => null),
      supabaseFetch(
        `/friends?addressee_uuid=eq.${me.id}&status=eq.pending&select=requester_uuid,requester_name,created_at&order=created_at.desc&limit=1`
      ).catch(() => null),
    ]);
    const w = (whispers || [])[0] || null;
    const r = (requests || [])[0] || null;
    // "달라졌다"가 아니라 "더 새롭다"로 본다 - 요청 하나를 수락해서 그 다음 pending 이
    // 최신이 되는 경우처럼, 값이 바뀌었을 뿐 새로 온 게 아닌 경우를 걸러내기 위해서.
    const newWhisper = socialSignalPrimed && isNewerIso(w?.created_at, socialLastWhisperAt);
    const newRequest = socialSignalPrimed && isNewerIso(r?.created_at, socialLastRequestAt);
    if (isNewerIso(w?.created_at, socialLastWhisperAt)) socialLastWhisperAt = w.created_at;
    if (isNewerIso(r?.created_at, socialLastRequestAt)) socialLastRequestAt = r.created_at;
    socialSignalPrimed = true;
    if (!newWhisper && !newRequest) return;
    logToFile(`[친구] 새 신호 - 귓속말 ${newWhisper ? "O" : "-"} / 친구요청 ${newRequest ? "O" : "-"}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("social:signal", {
        whisper: newWhisper ? { from: w.sender_uuid, name: w.sender_name || "", at: w.created_at } : null,
        friendRequest: newRequest ? { from: r.requester_uuid, name: r.requester_name || "", at: r.created_at } : null,
      });
    }
  } catch (err) {
    logToFile("친구/귓속말 신호 확인 실패: " + (err?.message || err));
  } finally {
    socialSignalInFlight = false;
  }
}

// 창을 보고 있을 때만 4초, 내려놨으면 20초. 매 틱마다 다시 판단해서 간격을 갈아끼운다.
function scheduleSocialSignal() {
  let want = SOCIAL_SIGNAL_MS_IDLE;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      want = SOCIAL_SIGNAL_MS_ACTIVE;
    }
  } catch (_) {}
  if (socialSignalTimer && socialSignalMs === want) return;
  if (socialSignalTimer) clearInterval(socialSignalTimer);
  socialSignalMs = want;
  socialSignalTimer = setInterval(() => {
    scheduleSocialSignal();
    checkSocialSignal();
  }, want);
}

// 렌더러가 직접 "지금 바로 확인해줘"라고 부를 수도 있게(친구 추가·수락 직후 등)
ipcMain.handle("social:check-now", async () => {
  await checkSocialSignal();
  return { ok: true };
});

// 17차 신규: 포럼 글쓰기 임시저장(1개만 가능, 계정별로 따로 저장) - 서버가 아니라 이 컴퓨터에만 저장됨
function draftStoreKey() {
  const uuid = store.get("active_uuid") || "anon";
  return `forum_draft_${uuid}`;
}
ipcMain.handle("forum:get-draft", () => store.get(draftStoreKey()) || null);
ipcMain.handle("forum:save-draft", (_e, draft) => {
  store.set(draftStoreKey(), { ...draft, savedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle("forum:clear-draft", () => {
  store.delete(draftStoreKey());
  return { ok: true };
});

// 17차: 포럼 화면을 열 때 렌더러가 먼저 호출해서, 내가 지금 정지 상태인지(글쓰기만 막힘 /
// 읽기+쓰기 모두 막힘) 확인함. getForumRestriction 정의는 아래쪽에 있지만 function 선언이라 호이스팅됨.
ipcMain.handle("forum:check-restriction", async () => {
  const me = getMyIdentity();
  if (!me.uuid) return null;
  return await getForumRestriction(me.uuid);
});

// 17차: "말머리 목록을 많이 쓴 순서대로 정렬해달라" - 카테고리별로 실제 글에 붙은 말머리(tag)
// 개수를 세서 { "정보": { "PVP": 12, "모드": 5, ... }, ... } 형태로 돌려줌. PostgREST는 REST
// 경로만으로 GROUP BY를 못 하므로, tag/category 컬럼만 뽑아서(select로 용량 최소화) 서버 쪽
// JS에서 직접 집계함(포럼 규모상 전체 글 수가 많지 않아 이 방식으로 충분함)
ipcMain.handle("forum:tag-usage-counts", async () => {
  try {
    const rows = await supabaseFetch("/forum_posts?select=category,tag&tag=not.is.null&limit=5000");
    const counts = {};
    for (const r of rows || []) {
      if (!r.tag || !r.category) continue;
      if (!counts[r.category]) counts[r.category] = {};
      counts[r.category][r.tag] = (counts[r.category][r.tag] || 0) + 1;
    }
    return { ok: true, counts };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), counts: {} };
  }
});

ipcMain.handle("forum:list-posts", async (_e, { category, search, sort, authorUuid, tag }) => {
  try {
    const orderField = sort === "popular" ? "like_count" : "created_at";
    const commonFilters = [];
    if (search) commonFilters.push(`title=ilike.*${encodeURIComponent(search)}*`);
    if (authorUuid) commonFilters.push(authorUuidInFilter(authorUuid));
    if (tag && tag !== "all") commonFilters.push(`tag=eq.${encodeURIComponent(tag)}`);

    // 고정된 글은 카테고리 필터와 상관없이 항상 맨 위에 (검색/작성자 필터는 그대로 적용)
    const pinnedQuery = ["select=*", "pinned=eq.true", "order=pinned_at.asc", ...commonFilters].join("&");
    const pinned = await supabaseFetch(`/forum_posts?${pinnedQuery}`);

    let query = `select=*&order=${orderField}.desc&pinned=eq.false`;
    if (category && category !== "all") query += `&category=eq.${encodeURIComponent(category)}`;
    for (const f of commonFilters) query += `&${f}`;
    const rest = await supabaseFetch(`/forum_posts?${query}`);

    const all = [...(pinned || []), ...(rest || [])];

    // 24-14차: "신고한 게시글은 신고됨이라고 표시하기 나한테만" - 내가 신고한 글 id만 한 번에
    // 조회해서(내 uuid로만 필터링 - 다른 사람 신고 여부는 절대 안 섞임) 각 글에
    // reported_by_me로 붙여줌. 렌더러는 이 값이 있는 글에만 "신고됨" 배지를 보여주면 됨
    const me = getMyIdentity();
    if (me.uuid && all.length > 0) {
      try {
        const myReports = await supabaseFetch(
          `/forum_reports?reporter_uuid=eq.${me.uuid}&select=post_id`
        );
        const reportedIds = new Set((myReports || []).map((r) => r.post_id));
        all.forEach((p) => { p.reported_by_me = reportedIds.has(p.id); });
      } catch (err) {
        // 신고 여부 조회가 실패해도 목록 자체는 그대로 반환
      }
    }

    return all;
  } catch (err) {
    logToFile("게시글 목록 조회 실패: " + (err?.message || err));
    return [];
  }
});

ipcMain.handle("forum:pin-post", async (_e, id) => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  try {
    await supabaseFetch(`/forum_posts?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: true, pinned_at: new Date().toISOString() }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:unpin-post", async (_e, id) => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  try {
    await supabaseFetch(`/forum_posts?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: false, pinned_at: null }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:get-post", async (_e, postId) => {
  try {
    const [posts, replies] = await Promise.all([
      supabaseFetch(`/forum_posts?id=eq.${postId}&select=*`),
      supabaseFetch(`/forum_replies?post_id=eq.${postId}&select=*&order=created_at.asc`),
    ]);
    const me = getMyIdentity();
    let liked = false;
    if (me.uuid) {
      const likeRows = await supabaseFetch(
        `/forum_likes?post_id=eq.${postId}&author_uuid=eq.${me.uuid}&select=post_id`
      );
      liked = likeRows.length > 0;
    }
    // 24-45차: "답글 좋아요, 신고" 기능 추가 - 이 글의 답글들 중 내가 이미 좋아요/신고를
    // 누른 게 있으면 각 답글에 liked_by_me/reported_by_me로 표시해서 렌더러가 하트 색/
    // "신고하기" 메뉴 노출 여부를 처음부터 맞게 그릴 수 있게 함(post의 reported_by_me와
    // 같은 패턴). sql/2026-09-03_forum_reply_upgrade.sql 마이그레이션 전이라 관련 테이블/
    // 컬럼이 없으면 그냥 조용히 건너뛰고 답글 목록 자체는 정상적으로 보여줌
    if (me.uuid && replies.length > 0) {
      try {
        const idList = replies.map((r) => r.id).join(",");
        const [myReplyLikes, myReplyReports] = await Promise.all([
          supabaseFetch(`/forum_reply_likes?reply_id=in.(${idList})&author_uuid=eq.${me.uuid}&select=reply_id`),
          supabaseFetch(`/forum_reports?reply_id=in.(${idList})&reporter_uuid=eq.${me.uuid}&select=reply_id`),
        ]);
        const likedSet = new Set((myReplyLikes || []).map((r) => r.reply_id));
        const reportedSet = new Set((myReplyReports || []).map((r) => r.reply_id));
        replies.forEach((r) => {
          r.liked_by_me = likedSet.has(r.id);
          r.reported_by_me = reportedSet.has(r.id);
        });
      } catch (err) {
        // 마이그레이션 미적용 등으로 실패해도 답글 목록 자체는 그대로 반환
      }
    }
    const post = posts[0] || null;
    if (post) {
      // 조회수는 계정당 1회만 올라가야 함 (forum_post_views에 (post_id, viewer_uuid) 기록이 없을 때만 +1)
      if (me.uuid) {
        try {
          const already = await supabaseFetch(
            `/forum_post_views?post_id=eq.${postId}&viewer_uuid=eq.${me.uuid}&select=post_id`
          );
          if (!already || already.length === 0) {
            await supabaseFetch("/forum_post_views", {
              method: "POST",
              body: JSON.stringify({ post_id: postId, viewer_uuid: me.uuid }),
            });
            const nextViewCount = (post.view_count || 0) + 1;
            supabaseFetch(`/forum_posts?id=eq.${postId}`, {
              method: "PATCH",
              body: JSON.stringify({ view_count: nextViewCount }),
            }).catch((err) => logToFile("조회수 갱신 실패: " + (err?.message || err)));
            post.view_count = nextViewCount;
          }
        } catch (err) {
          // forum_post_views 테이블이 아직 없는 등 실패 시엔 조회수 중복 방지 없이 조용히 넘어감
          // (마이그레이션 sql/2026-08-21_forum_view_dedup.sql 을 아직 안 돌렸을 수 있음)
          logToFile("조회수 중복 방지 확인 실패(마이그레이션 미적용 가능): " + (err?.message || err));
        }
      }
    }
    return { post, replies, liked };
  } catch (err) {
    logToFile("게시글 상세 조회 실패: " + (err?.message || err));
    return { post: null, replies: [], liked: false };
  }
});

// 도배 방지: 1분에 글 1개만. 본인의 가장 최근 글 시각을 확인해서 60초 안 지났으면 막음
const FORUM_POST_COOLDOWN_MS = 60 * 1000;
async function checkForumPostCooldown(uuid) {
  try {
    const rows = await supabaseFetch(
      `/forum_posts?author_uuid=eq.${uuid}&select=created_at&order=created_at.desc&limit=1`
    );
    const last = rows?.[0]?.created_at;
    if (!last) return { ok: true };
    const elapsed = Date.now() - new Date(last).getTime();
    if (elapsed < FORUM_POST_COOLDOWN_MS) {
      const waitSec = Math.ceil((FORUM_POST_COOLDOWN_MS - elapsed) / 1000);
      return { ok: false, error: `글은 1분에 한 개만 쓸 수 있어요. ${waitSec}초 후에 다시 시도해주세요.` };
    }
    return { ok: true };
  } catch (err) {
    logToFile("포럼 도배 방지 체크 실패(그냥 통과시킴): " + (err?.message || err));
    return { ok: true }; // 체크 자체가 실패하면 글쓰기를 막지는 않음
  }
}

// 24차: "하루 최대 게시글을 5개로 제한시켜줘 나 제외하고 하루 최대 답글도 100개로 나 빼고" -
// 자정(로컬 시각) 기준으로 오늘 작성한 글/답글 개수를 세서 한도를 넘으면 막음. 개발자 계정
// (CONFIG.DEV_ACCOUNT_NAME, 다른 관리자 전용 기능들과 같은 판별 방식)은 예외로 항상 통과시킴
const FORUM_POST_DAILY_LIMIT = 5;
const FORUM_REPLY_DAILY_LIMIT = 100;
function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
async function checkForumDailyPostLimit(uuid) {
  if (isDevAccount()) return { ok: true };
  try {
    const rows = await supabaseFetch(
      `/forum_posts?author_uuid=eq.${uuid}&select=id&created_at=gte.${startOfTodayIso()}`
    );
    // 24-224차: "티어별 하루 댓글 제한, 게시글 제한도 둘 것"
    const limit = Math.min(FORUM_POST_DAILY_LIMIT, myPerks().posts);
    if ((rows || []).length >= limit) {
      return {
        ok: false,
        error: `오늘 쓸 수 있는 글을 다 썼어요 (${TIER_LABEL[myTier()]} ${limit}개). 티어가 오르면 늘어나요.`,
      };
    }
    return { ok: true };
  } catch (err) {
    logToFile("포럼 하루 글 제한 체크 실패(그냥 통과시킴): " + (err?.message || err));
    return { ok: true }; // 체크 자체가 실패하면 글쓰기를 막지는 않음(도배 방지 쿨다운과 같은 원칙)
  }
}
async function checkForumDailyReplyLimit(uuid) {
  if (isDevAccount()) return { ok: true };
  try {
    const rows = await supabaseFetch(
      `/forum_replies?author_uuid=eq.${uuid}&select=id&created_at=gte.${startOfTodayIso()}`
    );
    const limit = Math.min(FORUM_REPLY_DAILY_LIMIT, myPerks().comments);
    if ((rows || []).length >= limit) {
      return {
        ok: false,
        error: `오늘 쓸 수 있는 댓글을 다 썼어요 (${TIER_LABEL[myTier()]} ${limit}개). 티어가 오르면 늘어나요.`,
      };
    }
    return { ok: true };
  } catch (err) {
    logToFile("포럼 하루 답글 제한 체크 실패(그냥 통과시킴): " + (err?.message || err));
    return { ok: true };
  }
}

// 17차: 관리자가 유저를 정지(쓰기 금지 / 읽기+쓰기 금지)시킬 수 있는 기능.
// forum_user_restrictions 테이블에서 만료 안 된(expires_at이 null이거나 미래인) 행을 찾음.
async function getForumRestriction(uuid) {
  if (!uuid) return null;
  try {
    const rows = await supabaseFetch(
      `/forum_user_restrictions?target_uuid=eq.${uuid}&order=created_at.desc&limit=5`
    );
    const now = Date.now();
    const active = (rows || []).find((r) => !r.expires_at || new Date(r.expires_at).getTime() > now);
    return active || null;
  } catch (err) {
    // 마이그레이션(sql/2026-08-25_forum_moderation.sql) 미적용 등으로 실패하면, 정지 없는 것으로 취급
    return null;
  }
}

ipcMain.handle("forum:create-post", async (_e, { title, content, category, tag, imageUrl, attachmentUrl, attachmentName, sharedProfileCode }) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  // '공지사항' 카테고리는 제작자만 쓸 수 있음 (UI에서도 막지만 여기서도 한 번 더 확인)
  if (category === "공지사항" && !isDevAccount()) {
    return { ok: false, error: "공지사항은 제작자만 작성할 수 있어요." };
  }
  const restriction = await getForumRestriction(me.uuid);
  if (restriction) {
    return { ok: false, error: "커뮤니티 글쓰기가 제한된 상태예요." + (restriction.reason ? ` (사유: ${restriction.reason})` : "") };
  }
  const cooldown = await checkForumPostCooldown(me.uuid);
  if (!cooldown.ok) return cooldown;
  const dailyLimit = await checkForumDailyPostLimit(me.uuid);
  if (!dailyLimit.ok) return dailyLimit;
  try {
    const rows = await supabaseFetch("/forum_posts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        author_uuid: me.uuid,
        author_name: me.name,
        title,
        content,
        category,
        tag: tag || null,
        image_url: imageUrl || null,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
        // 11차 신규: 글 상단에 고정할 프로필 공유 코드(선택) - sql/2026-08-22_forum_shared_profile_code.sql
        // 이 Supabase에서 실행돼 있어야 저장됨
        shared_profile_code: sharedProfileCode || null,
      }),
    });
    return { ok: true, post: rows[0] };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:update-post", async (_e, { id, title, content, category, tag, sharedProfileCode }) => {
  const me = getMyIdentity();
  if (category === "공지사항" && !isDevAccount()) {
    return { ok: false, error: "공지사항은 제작자만 작성할 수 있어요." };
  }
  try {
    await supabaseFetch(`/forum_posts?id=eq.${id}&author_uuid=eq.${me.uuid}`, {
      method: "PATCH",
      body: JSON.stringify({
        title,
        content,
        category,
        tag: tag || null,
        shared_profile_code: sharedProfileCode || null,
        updated_at: new Date().toISOString(),
      }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:delete-post", async (_e, id) => {
  const me = getMyIdentity();
  const isAdmin = isDevAccount();
  try {
    // 관리자는 전체 조건 없이, 일반 유저는 본인 글만 삭제 가능
    const filter = isAdmin ? `id=eq.${id}` : `id=eq.${id}&author_uuid=eq.${me.uuid}`;
    await supabaseFetch(`/forum_posts?${filter}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 3-2(4차): 게시글 신고. 신고 자체는 로그인한 아무나 가능(관리자 체크 없음),
// 목록 조회(forum:list-reports)만 isAdmin 체크로 막아서 관리자만 볼 수 있게 함.
ipcMain.handle("forum:report-post", async (_e, { postId, postTitle, reason, detail }) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  if (!postId || !reason) return { ok: false, error: "신고 사유를 선택해주세요." };
  try {
    // 17차: 한 게시글에는 한 번만 신고할 수 있음(신고 버튼도 이후 비활성화됨) -
    // 유니크 제약(sql/2026-08-25_forum_moderation.sql)이 없는 DB에서도 동작하도록 미리 조회로 한 번 더 확인
    const existing = await supabaseFetch(
      `/forum_reports?post_id=eq.${postId}&reporter_uuid=eq.${me.uuid}&select=id&limit=1`
    );
    if ((existing || []).length > 0) {
      return { ok: false, alreadyReported: true, error: "이미 신고한 게시글이에요." };
    }
    // 17차: 삭제돼도 신고 내역에서 내용을 볼 수 있도록 신고 시점의 본문도 같이 스냅샷
    // 24-14차: "매니저 M 달린 계정이 쓴 게시글은 신고 불가능하게 하기" - 클라이언트(신고
    // 버튼 숨김)만으론 우회될 수 있어서, 서버(여기)에서도 작성자가 운영자 계정이면 막음
    let postContent = "";
    try {
      const postRows = await supabaseFetch(`/forum_posts?id=eq.${postId}&select=content,author_name&limit=1`);
      postContent = postRows?.[0]?.content || "";
      const postAuthorName = String(postRows?.[0]?.author_name || "").trim();
      if (postAuthorName && postAuthorName === String(CONFIG.DEV_ACCOUNT_NAME || "").trim()) {
        return { ok: false, error: "운영자 게시글은 신고할 수 없어요." };
      }
    } catch (err) {
      // 본문 조회 실패해도 신고 자체는 계속 진행
    }
    await supabaseFetch("/forum_reports", {
      method: "POST",
      body: JSON.stringify({
        post_id: postId,
        post_title: postTitle || "",
        post_content: postContent,
        reporter_uuid: me.uuid,
        reporter_name: me.name || "",
        reason,
        detail: detail || "",
      }),
    });
    return { ok: true };
  } catch (err) {
    // 유니크 제약 위반(23505)이면 "이미 신고함"으로 안내
    if (String(err?.message || err).includes("23505")) {
      return { ok: false, alreadyReported: true, error: "이미 신고한 게시글이에요." };
    }
    return { ok: false, error: String(err?.message || err) };
  }
});

// 17차: 내가 이 게시글을 이미 신고했는지 확인(신고 버튼 비활성화용)
ipcMain.handle("forum:has-reported", async (_e, postId) => {
  const me = getMyIdentity();
  if (!me.uuid || !postId) return false;
  try {
    const rows = await supabaseFetch(
      `/forum_reports?post_id=eq.${postId}&reporter_uuid=eq.${me.uuid}&select=id&limit=1`
    );
    return (rows || []).length > 0;
  } catch (err) {
    return false;
  }
});

// 24-45차: 답글도 신고할 수 있게(기존엔 게시글만 가능) - forum_reports.reply_id가 있으면
// "답글 신고", 없으면(null) 기존처럼 "게시글 신고"로 구분됨(sql/2026-09-03_forum_reply_upgrade.sql).
// 신고 자체는 로그인한 아무나 가능, 목록 조회는 forum:list-reports(isAdmin 체크)만 씀 - 게시글
// 신고(forum:report-post)와 동일한 패턴을 그대로 따름
ipcMain.handle("forum:report-reply", async (_e, { replyId, postId, reason, detail }) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  if (!replyId || !reason) return { ok: false, error: "신고 사유를 선택해주세요." };
  try {
    const existing = await supabaseFetch(
      `/forum_reports?reply_id=eq.${replyId}&reporter_uuid=eq.${me.uuid}&select=id&limit=1`
    );
    if ((existing || []).length > 0) {
      return { ok: false, alreadyReported: true, error: "이미 신고한 답글이에요." };
    }
    let replyContent = "";
    try {
      const replyRows = await supabaseFetch(`/forum_replies?id=eq.${replyId}&select=content,author_name&limit=1`);
      replyContent = replyRows?.[0]?.content || "";
      const replyAuthorName = String(replyRows?.[0]?.author_name || "").trim();
      if (replyAuthorName && replyAuthorName === String(CONFIG.DEV_ACCOUNT_NAME || "").trim()) {
        return { ok: false, error: "운영자 답글은 신고할 수 없어요." };
      }
    } catch (err) {
      // 답글 내용 조회 실패해도 신고 자체는 계속 진행
    }
    await supabaseFetch("/forum_reports", {
      method: "POST",
      body: JSON.stringify({
        post_id: postId || null,
        reply_id: replyId,
        post_title: "",
        reply_content: replyContent,
        reporter_uuid: me.uuid,
        reporter_name: me.name || "",
        reason,
        detail: detail || "",
      }),
    });
    return { ok: true };
  } catch (err) {
    if (String(err?.message || err).includes("23505")) {
      return { ok: false, alreadyReported: true, error: "이미 신고한 답글이에요." };
    }
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-45차: 내가 이 답글을 이미 신고했는지 확인(forum:has-reported의 답글 버전)
ipcMain.handle("forum:has-reported-reply", async (_e, replyId) => {
  const me = getMyIdentity();
  if (!me.uuid || !replyId) return false;
  try {
    const rows = await supabaseFetch(
      `/forum_reports?reply_id=eq.${replyId}&reporter_uuid=eq.${me.uuid}&select=id&limit=1`
    );
    return (rows || []).length > 0;
  } catch (err) {
    return false;
  }
});

ipcMain.handle("forum:list-reports", async () => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  try {
    const rows = await supabaseFetch("/forum_reports?order=created_at.desc&limit=500");
    return { ok: true, reports: rows || [] };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 17차: 관리자 - 유저 정지(글쓰기 금지 / 읽기+쓰기 금지) 목록/등록/해제
ipcMain.handle("forum:list-restrictions", async () => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  try {
    const rows = await supabaseFetch("/forum_user_restrictions?order=created_at.desc&limit=200");
    return { ok: true, restrictions: rows || [] };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:moderate-user", async (_e, { targetUuid, targetName, restrictType, durationHours, reason }) => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  if (!targetUuid || !["write", "read_write"].includes(restrictType)) {
    return { ok: false, error: "잘못된 요청이에요." };
  }
  try {
    const expiresAt = durationHours && Number(durationHours) > 0
      ? new Date(Date.now() + Number(durationHours) * 60 * 60 * 1000).toISOString()
      : null; // null = 무기한
    await supabaseFetch("/forum_user_restrictions", {
      method: "POST",
      body: JSON.stringify({
        target_uuid: targetUuid,
        target_name: targetName || "",
        restrict_type: restrictType,
        reason: reason || "",
        created_by: store.get("mc_profile")?.name || "",
        expires_at: expiresAt,
      }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:unmoderate-user", async (_e, targetUuid) => {
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };
  try {
    await supabaseFetch(`/forum_user_restrictions?target_uuid=eq.${targetUuid}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:create-reply", async (_e, { postId, parentId, content, imageUrl }) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  const restriction = await getForumRestriction(me.uuid);
  if (restriction) {
    return { ok: false, error: "커뮤니티 글쓰기가 제한된 상태예요." + (restriction.reason ? ` (사유: ${restriction.reason})` : "") };
  }
  const dailyLimit = await checkForumDailyReplyLimit(me.uuid);
  if (!dailyLimit.ok) return dailyLimit;
  // 24-45차: "답글에 사진 첨부 가능하게 해주고" - 텍스트 없이 사진만으로도 답글을 남길 수 있게
  // 허용(둘 다 비어있을 때만 막음). image_url은 sql/2026-09-03_forum_reply_upgrade.sql로
  // 추가되는 컬럼 - 마이그레이션 전이면 이 컬럼이 없어 REST 호출 자체가 실패할 수 있으므로,
  // 그 경우엔 image_url 없이 한 번 더 시도해서 텍스트 답글만이라도 살아있게 함
  if (!String(content || "").trim() && !imageUrl) {
    return { ok: false, error: "내용을 입력해주세요." };
  }
  const basePayload = {
    post_id: postId,
    parent_id: parentId || null,
    author_uuid: me.uuid,
    author_name: me.name,
    content: content || "",
  };
  try {
    const rows = await supabaseFetch("/forum_replies", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(imageUrl ? { ...basePayload, image_url: imageUrl } : basePayload),
    });
    return { ok: true, reply: rows[0] };
  } catch (err) {
    if (imageUrl) {
      try {
        const rows = await supabaseFetch("/forum_replies", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(basePayload),
        });
        return { ok: true, reply: rows[0] };
      } catch (err2) {
        return { ok: false, error: String(err2?.message || err2) };
      }
    }
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-5차: "내가 쓴 게시글 답변도 삭제/수정 가능하게 해줘" - 게시글(forum:update-post/
// forum:delete-post)은 이미 있었는데 답글에는 수정/삭제가 아예 없었음. 게시글과 같은 패턴
// (수정은 작성자만, 삭제는 작성자 또는 관리자)으로 답글용 핸들러 2개를 추가함.
ipcMain.handle("forum:update-reply", async (_e, { id, content }) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  const text = String(content || "").trim();
  if (!text) return { ok: false, error: "내용을 입력해주세요." };
  try {
    await supabaseFetch(`/forum_replies?id=eq.${id}&author_uuid=eq.${me.uuid}`, {
      method: "PATCH",
      body: JSON.stringify({ content: text }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:delete-reply", async (_e, id) => {
  const me = getMyIdentity();
  const isAdmin = isDevAccount();
  try {
    // 게시글 삭제(forum:delete-post)와 동일한 패턴: 관리자는 전체 조건 없이,
    // 일반 유저는 본인 답글만 삭제 가능
    const filter = isAdmin ? `id=eq.${id}` : `id=eq.${id}&author_uuid=eq.${me.uuid}`;
    await supabaseFetch(`/forum_replies?${filter}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("forum:toggle-like", async (_e, postId) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  try {
    const existing = await supabaseFetch(
      `/forum_likes?post_id=eq.${postId}&author_uuid=eq.${me.uuid}&select=post_id`
    );
    if (existing.length > 0) {
      await supabaseFetch(`/forum_likes?post_id=eq.${postId}&author_uuid=eq.${me.uuid}`, { method: "DELETE" });
      const posts = await supabaseFetch(`/forum_posts?id=eq.${postId}&select=like_count`);
      const newCount = Math.max(0, (posts[0]?.like_count || 1) - 1);
      await supabaseFetch(`/forum_posts?id=eq.${postId}`, { method: "PATCH", body: JSON.stringify({ like_count: newCount }) });
      return { ok: true, liked: false, likeCount: newCount };
    } else {
      await supabaseFetch("/forum_likes", {
        method: "POST",
        body: JSON.stringify({ post_id: postId, author_uuid: me.uuid }),
      });
      const posts = await supabaseFetch(`/forum_posts?id=eq.${postId}&select=like_count`);
      const newCount = (posts[0]?.like_count || 0) + 1;
      await supabaseFetch(`/forum_posts?id=eq.${postId}`, { method: "PATCH", body: JSON.stringify({ like_count: newCount }) });
      return { ok: true, liked: true, likeCount: newCount };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-45차: "답글 좋아요" - 게시글 좋아요(forum:toggle-like)와 완전히 같은 패턴을 forum_replies/
// forum_reply_likes에 그대로 적용(sql/2026-09-03_forum_reply_upgrade.sql 마이그레이션 필요)
ipcMain.handle("forum:toggle-reply-like", async (_e, replyId) => {
  const me = getMyIdentity();
  if (!me.uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  try {
    const existing = await supabaseFetch(
      `/forum_reply_likes?reply_id=eq.${replyId}&author_uuid=eq.${me.uuid}&select=reply_id`
    );
    if (existing.length > 0) {
      await supabaseFetch(`/forum_reply_likes?reply_id=eq.${replyId}&author_uuid=eq.${me.uuid}`, { method: "DELETE" });
      const rows = await supabaseFetch(`/forum_replies?id=eq.${replyId}&select=like_count`);
      const newCount = Math.max(0, (rows[0]?.like_count || 1) - 1);
      await supabaseFetch(`/forum_replies?id=eq.${replyId}`, { method: "PATCH", body: JSON.stringify({ like_count: newCount }) });
      return { ok: true, liked: false, likeCount: newCount };
    } else {
      await supabaseFetch("/forum_reply_likes", {
        method: "POST",
        body: JSON.stringify({ reply_id: replyId, author_uuid: me.uuid }),
      });
      const rows = await supabaseFetch(`/forum_replies?id=eq.${replyId}&select=like_count`);
      const newCount = (rows[0]?.like_count || 0) + 1;
      await supabaseFetch(`/forum_replies?id=eq.${replyId}`, { method: "PATCH", body: JSON.stringify({ like_count: newCount }) });
      return { ok: true, liked: true, likeCount: newCount };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-54차: "3D 스킨이 가끔 안 뜬다" - skinview3d가 렌더러(브라우저 컨텍스트)에서 텍스처
// URL(textures.minecraft.net)을 직접 img/텍스처로 fetch하는데, CSP img-src에 그 호스트를
// 매번 정확히 다 넣어주기 애매하고 네트워크 상태에 따라 크로스오리진 로드가 조용히 실패하는
// 경우가 있어 로딩 실패 원인 파악이 어려웠음. 그래서 메인 프로세스가 대신 PNG를 내려받아
// base64 data: URL로 바꿔서 내려주면, 렌더러는 네트워크 요청 없이 그 data: URL만 <img>/캔버스에
// 그대로 먹이면 되어 CSP/네트워크 이슈에서 자유로워짐(실패하면 기존 원본 URL로 폴백 -
// mountSkinViewer의 skinDataUrl || skinUrl 참고).
async function toDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch (err) {
    logToFile("텍스처 data URL 변환 실패: " + (err?.message || err) + " (" + url + ")");
    return null;
  }
}

// 9차: "스킨 로드할 때 모자/망토도 로딩해줘" - 지금까지 쓰던 crafatar 렌더는 모자(2번째 레이어)는
// ?overlay로 어느 정도 되지만 망토(cape)는 아예 지원을 안 함(crafatar 자체가 망토 렌더링이 없는
// 서비스). 그래서 렌더러에서 skinview3d(3D 스킨 뷰어 라이브러리, MIT)로 직접 그리기로 하고,
// 거기 필요한 실제 스킨/망토 PNG 텍스처 URL은 Mojang 세션 서버에서 받아옴 - CSP가
// connect-src를 'self'로 막아둬서 렌더러에서 직접 fetch 못 하니 메인 프로세스에서 대신 조회함
ipcMain.handle("skin:get-textures", async (_e, uuid) => {
  try {
    const id = normalizeUuid(uuid);
    if (!id) return { ok: false };
    const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const prop = (data.properties || []).find((p) => p.name === "textures");
    if (!prop) return { ok: false };
    const decoded = JSON.parse(Buffer.from(prop.value, "base64").toString("utf-8"));
    const textures = decoded.textures || {};
    const skinUrl = textures.SKIN?.url || null;
    const capeUrl = textures.CAPE?.url || null;
    // 24-54차: data: URL 변환은 메인 프로세스가 대신 다운로드까지 해야 해서 원본 URL 조회보다
    // 느릴 수 있으니 둘을 동시에 처리 - 실패해도 null로 폴백될 뿐 전체 응답은 그대로 나감
    const [skinDataUrl, capeDataUrl] = await Promise.all([toDataUrl(skinUrl), toDataUrl(capeUrl)]);
    return {
      ok: true,
      skinUrl,
      capeUrl,
      skinDataUrl,
      capeDataUrl,
      slim: textures.SKIN?.metadata?.model === "slim",
    };
  } catch (err) {
    logToFile("스킨 텍스처 조회 실패: " + (err?.message || err));
    return { ok: false };
  }
});

// 게시글 작성자를 눌렀을 때 - 닉네임/코인/전신 스킨/글 정보
// 9차: 예전엔 친구가 아니면 코인/작성글/자기소개를 다 잠가서 안 보여줬는데, 그건 의도한 동작이
// 아니었다는 피드백으로 전부 공개로 바꿈. 귓속말 가능 여부(isFriend)만 계속 구분해서 내려줌
ipcMain.handle("forum:get-user-info", async (_e, uuid) => {
  try {
    const me = getMyIdentity();
    const isSelf = isSameUuid(me.uuid, uuid);
    // 24-23차: 친구 여부는 이제 마인크래프트 uuid가 아니라 노바 계정 id로 판단해야 함 - 이
    // 게시글 작성자의 마인크래프트 uuid를 노바 계정 id(+닉네임)로 바꿔서 같이 내려줌. 렌더러의
    // "친구 추가"/"귓속말" 버튼이 이제 노바 계정 id/닉네임 기준으로 동작해야 해서 필요함(연동
    // 안 된 마인크래프트 계정이거나 내가 게스트/비로그인이면 둘 다 null/false)
    let isFriend = isSelf;
    let novaAccountId = null;
    let novaNickname = null;
    if (!isSelf) {
      const resolved = await novaSiteFetch("social", { by: "mcUuid", mcUuid: uuid });
      if (resolved?.ok) {
        novaAccountId = resolved.accountId;
        novaNickname = resolved.nickname || null;
        const mySite = getMySiteIdentity();
        if (mySite.id) isFriend = await checkAreFriends(mySite.id, novaAccountId);
      }
    }

    const profiles = await supabaseFetch(`/user_profiles?uuid=eq.${uuid}&select=*`);
    const name = profiles[0]?.mc_name || "알 수 없음";

    const skinRenderUrl = `https://crafatar.com/renders/body/${uuid}?overlay`;

    const posts = await supabaseFetch(`/forum_posts?${authorUuidInFilter(uuid)}&select=id&order=created_at.desc`);
    return {
      uuid,
      name,
      isSelf,
      isFriend,
      novaAccountId,
      novaNickname,
      coins: profiles[0]?.coins ?? 0,
      postCount: posts.length,
      bio: profiles[0]?.bio || "",
      skinRenderUrl,
    };
  } catch (err) {
    logToFile("포럼 유저 정보 조회 실패: " + (err?.message || err));
    return null;
  }
});

// 이미지 첨부 (Supabase Storage의 forum-images 버킷에 업로드)
ipcMain.handle("forum:upload-image", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "이미지 선택",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const filePath = result.filePaths[0];
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(filePath) || ".png";
    const objectName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/forum-images/${objectName}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(await res.text());

    const publicUrl = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/forum-images/${objectName}`;
    return { ok: true, url: publicUrl };
  } catch (err) {
    logToFile("이미지 업로드 실패: " + (err?.message || err));
    return { ok: false, error: "이미지 업로드에 실패했어요. Supabase에 forum-images 버킷(public)이 있는지 확인해주세요." };
  }
});

// 이미지 말고 일반 파일도 첨부 가능 (zip, txt 등 - forum-files 버킷 필요)
ipcMain.handle("forum:upload-file", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "첨부할 파일 선택",
    defaultPath: app.getPath("downloads"),
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const filePath = result.filePaths[0];
    const originalName = path.basename(filePath);
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(filePath) || "";
    const objectName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;

    const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/forum-files/${objectName}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(await res.text());

    const publicUrl = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/forum-files/${objectName}`;
    return { ok: true, url: publicUrl, name: originalName };
  } catch (err) {
    logToFile("파일 업로드 실패: " + (err?.message || err));
    return { ok: false, error: "파일 업로드에 실패했어요. Supabase에 forum-files 버킷(public)이 있는지 확인해주세요." };
  }
});

// ----------------------------------------------------------------------------
// 프로필 공유 (코드 하나로 다른 사람이 내 프로필을 그대로 받아갈 수 있게)
// ----------------------------------------------------------------------------
function generateShareCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 는 뺌
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function uploadFileToSupabase(bucket, objectPath, buffer) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/octet-stream",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Supabase Storage 버킷에 anon 업로드 권한(RLS 정책)이 없을 때 나는 특징적인 에러 -
    // 개발자가 알아볼 수 있게 원문은 로그로 남기고, 사용자에게는 알아듣기 쉬운 메시지를 줌
    if (text.includes("row-level security") || text.includes("Unauthorized")) {
      throw new Error(
        "STORAGE_RLS: shared-profile-files 버킷에 업로드 권한이 없어요 (Supabase에서 storage.objects 정책을 확인해주세요) - 원문: " + text
      );
    }
    throw new Error(text || `업로드 실패 (${res.status})`);
  }
}

// 2-5(7차): "프로필 갱신"에서 로컬에서 지워진(더 이상 이 프로필에 없는) 공유 파일들을
// Supabase Storage에서도 같이 정리할 때 씀 (profiles:delete에서 이미 쓰던 batch-delete 패턴 재사용)
async function deleteStorageObjects(bucket, paths) {
  if (!paths || paths.length === 0) return;
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch (err) {
    logToFile(`공유 파일 정리 실패(${bucket}): ` + (err?.message || err));
  }
}

// 2-6(7차): 공유 코드의 mods/resourcepacks/shaderpacks/아이콘 파일들을 로컬 프로필 폴더로
// 내려받음 (profiles:import 최초 다운로드와, "업데이트 연동" 재동기화 둘 다 이 함수를 씀).
// removeStale=true면 지금 공유 목록에 없는 로컬 파일은 그대로 지워서 완전히 미러링함
// (부분 diff가 아니라 항상 "전체 재동기화" - 정확성 우선, 트레이드오프는 보고서에 명시)
async function downloadSharedProfileFiles(profileRoot, shared, { removeStale } = {}) {
  const kindMap = { mods: shared.mod_files, resourcepacks: shared.resourcepack_files, shaderpacks: shared.shader_files };
  for (const [kind, files] of Object.entries(kindMap)) {
    const dir = path.join(profileRoot, kind);
    await fsp.mkdir(dir, { recursive: true });
    const keepSet = new Set(files || []);
    for (const f of files || []) {
      const res = await fetch(
        `${CONFIG.SUPABASE_URL}/storage/v1/object/public/shared-profile-files/${shared.code}/${kind}/${encodeURIComponent(f)}`
      );
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(path.join(dir, f), buffer);
    }
    if (removeStale) {
      const existing = fs.existsSync(dir) ? await fsp.readdir(dir) : [];
      for (const f of existing) {
        if (!keepSet.has(f)) await fsp.unlink(path.join(dir, f)).catch(() => {});
      }
    }
  }

  if (removeStale) {
    // 아이콘이 바뀌었거나 없어졌으면, 예전 확장자로 남아있던 로컬 아이콘 파일을 정리
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const p = path.join(profileRoot, `icon.${ext}`);
      if (fs.existsSync(p) && shared.icon_file !== `icon.${ext}`) await fsp.unlink(p).catch(() => {});
    }
  }
  if (shared.icon_file) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/storage/v1/object/public/shared-profile-files/${shared.code}/${encodeURIComponent(shared.icon_file)}`
    );
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(path.join(profileRoot, shared.icon_file), buffer);
    }
  }
}

// ----------------------------------------------------------------------------
// 24-100차: 공유에 "노바 모드 설정" / "모드 컨피그 파일"을 선택해서 같이 싣기 + 업데이트 알림
// "공유코드 뿌릴 때 모드 설정도 공유할건지 선택하게 해줘 ... 컨피그 파일도 같이 공유할 수 있게
//  할지 고를 수 있게 해주고 / 공유자가 프로필을 업데이트했을 때 받은 사람들에게 업데이트 신호를
//  보내서 따라 업데이트할 수 있게 할지 고르는 기능"
//
// DB(shared_profiles) 컬럼은 건드리지 않음(SQL 실행 없이 바로 동작하도록). 추가 정보는 전부
// Storage의 같은 코드 폴더에 둠:
//   <코드>/share-meta.json              - 어떤 옵션으로 올렸는지 + 설정 묶음 파일 이름/해시
//   <코드>/nova-settings-<해시8>.zip    - config/novaclient/ 의 설정 파일(개인 기록 제외)
//   <코드>/configs-<해시8>.zip          - config/ 의 다른 모드 설정 파일
// zip 이름에 내용 해시를 넣은 이유: 공개 URL은 CDN에 캐시돼서 같은 이름으로 덮어쓰면 한동안 옛
// 파일이 내려갈 수 있음. meta는 이름이 고정이라 받을 때 ?t=<지금>을 붙여 캐시를 피함.
//
// "업데이트 신호" = shared_profiles.updated_at. 공유자가 [변경 사항 올리기]에서 "받은 사람들에게
// 알리기"를 켰을 때만 올림. 받은 쪽은 앱 시작 때 + 10분마다 확인해서, 새 버전이 있으면 바로
// 덮어쓰지 않고 "업데이트 / 이번 건 건너뛰기 / 나중에"를 고르게 함(profiles:check-share-updates).
// ----------------------------------------------------------------------------
const SHARE_META_FILE = "share-meta.json";
// 노바 모드 설정 중 "그 사람만의 기록"이라 남에게 주면 안 되는 것 - 폴더(stats/ containers/)는
// 애초에 최상위 파일만 담아서 빠지고, 파일은 여기 이름으로 뺌
const NOVA_SETTINGS_PRIVATE_FILES = new Set(["waypoints.json"]);
// 컨피그로 싣는 파일 - 텍스트 설정 파일만(모드가 config/에 캐시·이미지·db를 두는 경우가 있어서)
const SHARE_CONFIG_EXTS = new Set([
  ".json", ".json5", ".jsonc", ".toml", ".properties", ".cfg", ".conf", ".config",
  ".txt", ".yml", ".yaml", ".ini", ".snbt",
]);
const SHARE_CONFIG_MAX_FILE = 1024 * 1024;       // 파일 하나 1MB 넘으면 설정이 아니라 데이터로 봄
const SHARE_CONFIG_MAX_TOTAL = 20 * 1024 * 1024; // 전체 20MB까지

// 24-105차: updates = "업데이트 공유"(공유자가 나중에 수정한 걸 받은 사람들이 따라 받을 수 있게).
// 코드를 만들 때 고르고, 끄면 [변경 사항 올리기]를 해도 받은 사람들에게 업데이트 신호가 안 감.
// 옛 공유(값 없음)는 예전 동작 그대로 켜진 것으로 봄.
function normalizeShareOptions(o) {
  // 24-227차: "노바 모드 설정이 왜 계속 있는 거야 없애" - 공유 항목에서 뺐다(항상 꺼짐)
  return { modSettings: false, configs: !!o?.configs, updates: o?.updates !== false };
}

// 한 묶음(zip)으로 만들고 내용 해시를 같이 돌려줌. 파일이 하나도 없으면 null.
function buildShareZip(entries) {
  if (!entries.length) return null;
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = crypto.createHash("sha256");
  const zip = new AdmZip();
  for (const e of entries) {
    h.update(e.rel + "\0");
    h.update(e.buffer);
    zip.addFile(e.rel, e.buffer);
  }
  return { buffer: zip.toBuffer(), hash: h.digest("hex"), count: entries.length };
}

// 노바 모드 설정: config/novaclient/ 바로 아래 파일만(stats/ containers/ 같은 기록 폴더 제외)
async function collectNovaSettingsEntries(profileRoot) {
  // 49-207차: 새 모드(Luna's Light)는 config/lunaslight, 옛 모드는 config/novaclient
  const dirName = fs.existsSync(path.join(profileRoot, "config", "lunaslight")) ? "lunaslight" : "novaclient";
  const dir = path.join(profileRoot, "config", dirName);
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (NOVA_SETTINGS_PRIVATE_FILES.has(ent.name.toLowerCase())) continue;
    const full = path.join(dir, ent.name);
    const st = await fsp.stat(full);
    if (st.size > SHARE_CONFIG_MAX_FILE) continue;
    out.push({ rel: `config/${dirName}/${ent.name}`, buffer: await fsp.readFile(full) });
  }
  return out;
}

// 모드 컨피그: config/ 전체(노바 모드 폴더 제외), 텍스트 설정 파일만, 크기 제한
async function collectModConfigEntries(profileRoot) {
  const root = path.join(profileRoot, "config");
  const out = [];
  let total = 0;
  const skipped = [];
  if (!fs.existsSync(root)) return { entries: out, skipped };
  async function walk(dir, relBase) {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!relBase && (ent.name.toLowerCase() === "novaclient" || ent.name.toLowerCase() === "lunaslight")) continue; // 노바 모드 설정은 따로
        await walk(full, rel);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!SHARE_CONFIG_EXTS.has(path.extname(ent.name).toLowerCase())) continue;
      const st = await fsp.stat(full);
      if (st.size > SHARE_CONFIG_MAX_FILE || total + st.size > SHARE_CONFIG_MAX_TOTAL) {
        skipped.push(rel);
        continue;
      }
      total += st.size;
      out.push({ rel: `config/${rel}`, buffer: await fsp.readFile(full) });
    }
  }
  await walk(root, "");
  return { entries: out, skipped };
}

// 공유자 쪽: 고른 옵션대로 설정 묶음을 올리고 meta를 씀. 예전에 올렸던 묶음 중 이제 안 쓰는 건
// staleObjectPaths에 담아 돌려줌(호출한 쪽에서 한 번에 지움).
async function uploadShareExtras(code, profileRoot, options, prevMeta) {
  const opts = normalizeShareOptions(options);
  const meta = { v: 1, options: opts, novaSettings: null, configs: null, uploadedAt: new Date().toISOString() };
  const stale = [];
  let skippedConfigs = [];

  if (opts.modSettings) {
    const z = buildShareZip(await collectNovaSettingsEntries(profileRoot));
    if (z) {
      const file = `nova-settings-${z.hash.slice(0, 8)}.zip`;
      if (prevMeta?.novaSettings?.file !== file) await uploadFileToSupabase("shared-profile-files", `${code}/${file}`, z.buffer);
      meta.novaSettings = { file, hash: z.hash, count: z.count };
    }
  }
  if (opts.configs) {
    const { entries, skipped } = await collectModConfigEntries(profileRoot);
    skippedConfigs = skipped;
    const z = buildShareZip(entries);
    if (z) {
      const file = `configs-${z.hash.slice(0, 8)}.zip`;
      if (prevMeta?.configs?.file !== file) await uploadFileToSupabase("shared-profile-files", `${code}/${file}`, z.buffer);
      meta.configs = { file, hash: z.hash, count: z.count };
    }
  }
  for (const k of ["novaSettings", "configs"]) {
    const old = prevMeta?.[k]?.file;
    if (old && old !== meta[k]?.file) stale.push(`${code}/${old}`);
  }
  await uploadFileToSupabase("shared-profile-files", `${code}/${SHARE_META_FILE}`, Buffer.from(JSON.stringify(meta), "utf-8"));
  return { meta, stale, skippedConfigs };
}

// meta 읽기 - 옛 공유 코드(24-100차 이전)에는 없으니 null이면 "모드/리소스팩/쉐이더만"으로 취급
async function fetchShareMeta(code) {
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/storage/v1/object/public/shared-profile-files/${code}/${SHARE_META_FILE}?t=${Date.now()}`
    );
    if (!res.ok) return null;
    const m = await res.json();
    return m && typeof m === "object" ? m : null;
  } catch (_) {
    return null;
  }
}

// 받은 쪽: 설정 묶음을 풀어 넣음. zip 안 경로는 반드시 config/ 아래여야 하고, 프로필 폴더
// 밖으로 나가는 경로(../ 등)는 건너뜀(남이 만든 파일이라 그대로 믿지 않음).
async function applyShareZip(code, file, profileRoot) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/public/shared-profile-files/${code}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`설정 파일을 받지 못했어요 (${res.status})`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const configRoot = path.resolve(profileRoot, "config");
  let written = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = String(e.entryName || "").replace(/\\/g, "/");
    if (!name.startsWith("config/") || name.split("/").includes("..")) continue;
    const dest = path.resolve(profileRoot, name);
    if (!dest.startsWith(configRoot + path.sep)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, e.getData());
    written++;
  }
  return written;
}

// 공유자가 올린 파일 목록
function sharedFileLists(shared) {
  return {
    mods: shared.mod_files || [],
    resourcepacks: shared.resourcepack_files || [],
    shaderpacks: shared.shader_files || [],
  };
}

// 받은 쪽: 모드/리소스팩/쉐이더 + (있으면) 설정 묶음까지 반영.
// 지우는 규칙: "예전에 공유로 받았던 파일인데 이번 목록에 없는 것"만 지움 - 받은 사람이 직접
// 넣은 모드는 건드리지 않음. (24-100차 이전에 받은 프로필은 그 기록이 없어서 예전처럼
// 목록에 없는 건 전부 지움 - 한 번 업데이트하고 나면 그때부터 기록이 생김)
async function applySharedProfileContent(profileRoot, shared, meta, prevSharedFiles, { initial } = {}) {
  const now = sharedFileLists(shared);
  if (initial || prevSharedFiles) {
    await downloadSharedProfileFiles(profileRoot, shared, { removeStale: false });
    if (prevSharedFiles) {
      for (const kind of Object.keys(now)) {
        const keep = new Set(now[kind]);
        for (const f of prevSharedFiles[kind] || []) {
          if (!keep.has(f)) await fsp.unlink(path.join(profileRoot, kind, f)).catch(() => {});
        }
      }
    }
  } else {
    await downloadSharedProfileFiles(profileRoot, shared, { removeStale: true });
  }
  const extras = {};
  if (meta?.novaSettings?.file) {
    await applyShareZip(shared.code, meta.novaSettings.file, profileRoot);
    extras.novaSettings = meta.novaSettings.hash;
  }
  if (meta?.configs?.file) {
    await applyShareZip(shared.code, meta.configs.file, profileRoot);
    extras.configs = meta.configs.hash;
  }
  return { sharedFiles: now, sharedExtras: extras };
}

// 받은 쪽에 보여줄 "무엇이 바뀌었나" - 내가 마지막으로 받은 목록과 비교
function diffSharedUpdate(profile, shared, meta) {
  const now = sharedFileLists(shared);
  const prev = profile.sharedFiles || null;
  const out = { added: {}, removed: {}, novaSettingsChanged: false, configsChanged: false, knownPrev: !!prev };
  for (const kind of Object.keys(now)) {
    const p = new Set(prev ? prev[kind] || [] : []);
    const n = new Set(now[kind]);
    out.added[kind] = prev ? now[kind].filter((f) => !p.has(f)) : [];
    out.removed[kind] = prev ? [...p].filter((f) => !n.has(f)) : [];
  }
  const seen = profile.sharedExtras || {};
  if (meta?.novaSettings?.hash && meta.novaSettings.hash !== seen.novaSettings) out.novaSettingsChanged = true;
  if (meta?.configs?.hash && meta.configs.hash !== seen.configs) out.configsChanged = true;
  return out;
}

// 24-100차: 공유 창을 열 때 - 이미 코드가 있는지, 지난번에 어떤 옵션으로 올렸는지, 설정 파일이
// 몇 개나 있는지(체크박스 옆에 보여줌)
ipcMain.handle("profiles:share-info", async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  const root = getProfileRoot(profileId);
  let novaSettingsCount = 0, configCount = 0;
  try { novaSettingsCount = (await collectNovaSettingsEntries(root)).length; } catch (_) {}
  try { configCount = (await collectModConfigEntries(root)).entries.length; } catch (_) {}
  return {
    ok: true,
    shareCode: profile.shareCode || null,
    shareOptions: normalizeShareOptions(profile.shareOptions),
    lastUploadedAt: profile.shareLastUploadedAt || null,
    blocked: profile.fromPreset ? "프리셋으로 만든 프로필은 공유할 수 없어요." : null,
    novaSettingsCount,
    configCount,
  };
});


// 24-225차: 프로필 한 개의 값 몇 개만 바꿔 저장
function patchProfileFields(profileId, patch) {
  const list = getProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) return;
  Object.assign(list[idx], patch);
  saveProfiles(list);
}

// 24-225차: 공유 코드 하나를 서버에서 깨끗이 지운다(올린 파일 + 코드 줄).
// 프로필을 지울 때, 설정을 바꿔 코드를 새로 낼 때, 공유를 끌 때 모두 이 길로 온다.
async function deleteShareCodeEverywhere(code) {
  if (!code) return;
  try {
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${code}&select=*`);
    const shared = (rows || [])[0];
    if (shared) {
      const paths = [];
      for (const kind of ["mods", "resourcepacks", "shaderpacks"]) {
        const kindKey = kind === "mods" ? "mod_files" : kind === "resourcepacks" ? "resourcepack_files" : "shader_files";
        for (const f of shared[kindKey] || []) paths.push(`${code}/${kind}/${f}`);
      }
      if (shared.icon_file) paths.push(`${code}/${shared.icon_file}`);
      const meta = await fetchShareMeta(code);
      if (meta?.novaSettings?.file) paths.push(`${code}/${meta.novaSettings.file}`);
      if (meta?.configs?.file) paths.push(`${code}/${meta.configs.file}`);
      paths.push(`${code}/${SHARE_META_FILE}`);
      if (paths.length) {
        await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/shared-profile-files`, {
          method: "DELETE",
          headers: supabaseHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: paths }),
        });
      }
    }
    await supabaseFetch(`/shared_profiles?code=eq.${code}`, { method: "DELETE" });
  } catch (err) {
    logToFile("공유 코드/파일 삭제 실패: " + (err?.message || err));
  }
}

// 설정을 바꾸면 쓰던 코드는 그 자리에서 무효가 되고 새 코드가 나온다
// ("공유 코드는 언제든 설정을 바꿀 수 있게 해줘 대신 바꾸면 기존 코드가 유효하지 않고 새로")
ipcMain.handle("profiles:share-reissue", async (_e, profileId, options) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (profile.shareCode) {
    await deleteShareCodeEverywhere(profile.shareCode);
    patchProfileFields(profileId, { shareCode: null, shareLastUploadedAt: null });
  }
  return await createShareCode(profileId, options);
});

// 공유 끄기 - 코드도 올린 파일도 없앤다
ipcMain.handle("profiles:share-off", async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (profile.shareCode) await deleteShareCodeEverywhere(profile.shareCode);
  patchProfileFields(profileId, { shareCode: null, shareLastUploadedAt: null });
  return { ok: true };
});

ipcMain.handle("profiles:share", (_e, profileId, options) => createShareCode(profileId, options));

async function createShareCode(profileId, options) {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (profile.fromPreset) {
    return { ok: false, error: "프리셋으로 만든 프로필은 공유할 수 없어요." };
  }

  // 이미 공유 코드를 만든 적이 있으면, 새로 만들지 않고 그 코드를 그대로 다시 알려줌
  // (설정을 바꿔 새로 내고 싶으면 profiles:share-reissue 로 온다 - 24-225차)
  if (profile.shareCode) {
    return { ok: true, code: profile.shareCode, reused: true };
  }
  // 24-100차: 옵션을 안 주면(포럼 글에 붙여 공유 등) 지난번 선택 → 없으면 모드/리소스팩/쉐이더만
  const shareOptions = normalizeShareOptions(options || profile.shareOptions);

  try {
    // 코드가 겹치지 않을 때까지 새로 생성
    let code;
    for (let i = 0; i < 10; i++) {
      code = generateShareCode();
      const existing = await supabaseFetch(`/shared_profiles?code=eq.${code}&select=code`);
      if (existing.length === 0) break;
    }

    const profileRoot = getProfileRoot(profileId);
    const kinds = { mods: [], resourcepacks: [], shaderpacks: [] };

    for (const kind of Object.keys(kinds)) {
      const dir = path.join(profileRoot, kind);
      if (!fs.existsSync(dir)) continue;
      const files = await fsp.readdir(dir);
      for (const f of files) {
        // 25차: 노바 내장 모드 / 24-46차: Fabric API - 둘 다 클라이언트 자체 기능이라
        // 공유 코드에 포함하지 않음(받는 쪽 런처가 실행 시 알아서 다시 주입함)
        if (kind === "mods" && isHiddenModFileName(f)) continue;
        const buffer = await fsp.readFile(path.join(dir, f));
        await uploadFileToSupabase("shared-profile-files", `${code}/${kind}/${encodeURIComponent(f)}`, buffer);
        kinds[kind].push(f);
      }
    }

    // 프로필 아이콘도 같이 공유 (있을 때만)
    let iconFile = null;
    const icon = findProfileIconFile(profileId);
    if (icon) {
      const buffer = await fsp.readFile(icon.path);
      iconFile = `icon.${icon.ext}`;
      await uploadFileToSupabase("shared-profile-files", `${code}/${iconFile}`, buffer);
    }

    // 24-100차: 고른 경우에만 노바 모드 설정 / 모드 컨피그 묶음도 올림
    const extras = await uploadShareExtras(code, profileRoot, shareOptions, null);

    const me = getMyIdentity();
    await supabaseFetch("/shared_profiles", {
      method: "POST",
      body: JSON.stringify({
        code,
        name: profile.name,
        mc_version: profile.mcVersion,
        memory_gb: profile.memoryGB,
        width: profile.width,
        height: profile.height,
        fullscreen: profile.fullscreen,
        mod_files: kinds.mods,
        resourcepack_files: kinds.resourcepacks,
        shader_files: kinds.shaderpacks,
        icon_file: iconFile,
        created_by: me.name,
        // 2-5(7차): "업데이트 연동"이 이 값을 기준으로 새 버전이 있는지 판단하므로, DB 트리거를
        // 믿지 않고 매번 직접 명시함 (트리거가 실제로 있는지 확인할 수 없어서)
        updated_at: new Date().toISOString(),
      }),
    });

    // 이 프로필에 코드를 귀속시켜서 다음부터는 같은 코드를 재사용함
    const list = getProfiles();
    const idx = list.findIndex((p) => p.id === profileId);
    if (idx >= 0) {
      list[idx].shareCode = code;
      list[idx].shareOptions = shareOptions;
      list[idx].shareLastUploadedAt = new Date().toISOString();
      saveProfiles(list);
    }

    return { ok: true, code, meta: extras.meta, skippedConfigs: extras.skippedConfigs.length };
  } catch (err) {
    logToFile("프로필 공유 실패: " + (err?.message || err));
    const raw = String(err?.message || err);
    const friendly = raw.startsWith("STORAGE_RLS:")
      ? "지금은 공유 파일 업로드가 서버에서 막혀있어요 (관리자에게 알려주세요). 잠시 후 다시 시도해주세요."
      : raw;
    return { ok: false, error: friendly };
  }
}

ipcMain.handle("profiles:import", async (_e, code) => {
  try {
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${code.trim().toUpperCase()}&select=*`);
    const shared = rows[0];
    if (!shared) return { ok: false, error: "존재하지 않는 코드예요." };

    const id = generateProfileId();
    const profileRoot = getProfileRoot(id);
    await fsp.mkdir(path.join(profileRoot, "mods"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "resourcepacks"), { recursive: true });
    await fsp.mkdir(path.join(profileRoot, "shaderpacks"), { recursive: true });

    // 24-100차: 설정 묶음까지 같이 반영하고, "공유로 받은 파일 목록"을 기억해둠(업데이트 때
    // 공유자가 뺀 것만 지우고 내가 직접 넣은 건 남기기 위해)
    const meta = await fetchShareMeta(shared.code);
    const applied = await applySharedProfileContent(profileRoot, shared, meta, null, { initial: true });

    const profile = {
      id,
      name: `${shared.name} (공유됨)`,
      mcVersion: shared.mc_version,
      memoryGB: shared.memory_gb,
      width: shared.width,
      height: shared.height,
      fullscreen: shared.fullscreen,
      createdAt: new Date().toISOString(),
      // 2-1~2-3(7차): 누가 만들었는지(원작자) + 어느 코드에서 왔는지 기록해두고,
      // "업데이트 연동"은 기본 켬 (유저가 나중에 꺼도 그때부터만 반영 안 됨)
      importedFrom: shared.code,
      importedAuthor: shared.created_by || null,
      updateSync: true, // 24-100차부터 의미: "공유자 업데이트 알림 받기"(자동 덮어쓰기 아님)
      sharedUpdatedAtSeen: shared.updated_at || new Date().toISOString(),
      sharedFiles: applied.sharedFiles,
      sharedExtras: applied.sharedExtras,
    };
    const list = getProfiles();
    list.push(profile);
    // 24-93차: 방금 만든 p_... 폴더를 프로필 이름으로 옮김(applyProfileFolderName 주석 참고)
    applyProfileFolderName(profile, list);
    saveProfiles(list);

    // 10-6(7차): 파일 다운로드가 끝난 뒤, 응답을 기다리게 하지 않고 이 프로필의 마인크래프트
    // 버전 자바+에셋도 백그라운드로 같이 미리 받아둠
    prefetchAssetsForProfile(profile).catch((err) => {
      logToFile("공유로 불러온 프로필 - 에셋 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
    });

    return { ok: true, profile };
  } catch (err) {
    logToFile("프로필 불러오기 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 11차 신규: 포럼 글에 고정된 공유 코드를 "미리보기"만 할 때 씀 - profiles:import와 달리
// 실제로 새 프로필을 만들거나 파일을 내려받지 않고, shared_profiles에 있는 메타데이터
// (이름/버전/모드·리소스팩·쉐이더 파일 목록/아이콘)만 읽어서 돌려줌
ipcMain.handle("profiles:preview-share", async (_e, code) => {
  try {
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${String(code || "").trim().toUpperCase()}&select=*`);
    const shared = rows[0];
    if (!shared) return { ok: false, error: "존재하지 않는 코드예요." };
    const iconUrl = shared.icon_file
      ? `${CONFIG.SUPABASE_URL}/storage/v1/object/public/shared-profile-files/${shared.code}/${encodeURIComponent(shared.icon_file)}`
      : null;
    return {
      ok: true,
      code: shared.code,
      name: shared.name,
      mcVersion: shared.mc_version,
      modFiles: shared.mod_files || [],
      resourcepackFiles: shared.resourcepack_files || [],
      shaderFiles: shared.shader_files || [],
      author: shared.created_by || null,
      iconUrl,
      // 24-100차: 설정 묶음이 실려 있는지
      ...(await (async () => {
        const meta = await fetchShareMeta(shared.code);
        return {
          novaSettingsCount: meta?.novaSettings?.count || 0,
          updatesEnabled: !(meta?.options && meta.options.updates === false), // 24-105차
          configCount: meta?.configs?.count || 0,
        };
      })()),
    };
  } catch (err) {
    logToFile("공유 프로필 미리보기 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 2-5(7차): "프로필 갱신" - 공유 코드를 만든 원작자만 쓸 수 있음. 지금 로컬 mods/resourcepacks/
// shaderpacks/아이콘 상태를 같은 코드에 다시 올리고, 로컬에서 지워진 파일은 Storage에서도 정리함
// 24-100차: { options, notify } - options는 이번에 같이 올릴 설정 묶음, notify는 "받은 사람들에게
// 업데이트 알리기". notify가 꺼져 있으면 파일만 바꾸고 updated_at(=업데이트 신호)은 그대로 둬서
// 이미 받은 사람들에게는 알림이 안 감(새로 받는 사람은 바뀐 구성을 받음).
ipcMain.handle("profiles:refresh-share", async (_e, profileId, { options, notify } = {}) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (!profile.shareCode) return { ok: false, error: "아직 공유한 적 없는 프로필이에요." };

  try {
    const code = profile.shareCode;
    // 지금까지 올라가 있던 파일 목록을 먼저 조회 - 로컬에서 지워진 파일의 Storage 오브젝트를
    // 정확히 알아야 정리할 수 있음
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${code}&select=*`);
    const prevShared = rows[0] || {};
    const shareOptions = normalizeShareOptions(options || profile.shareOptions);
    // 24-105차: "업데이트 공유"를 꺼뒀으면 알림(업데이트 신호)을 절대 안 보냄
    const sendNotify = shareOptions.updates && notify !== false;

    const profileRoot = getProfileRoot(profileId);
    const kinds = { mods: [], resourcepacks: [], shaderpacks: [] };
    for (const kind of Object.keys(kinds)) {
      const dir = path.join(profileRoot, kind);
      if (!fs.existsSync(dir)) continue;
      const files = await fsp.readdir(dir);
      for (const f of files) {
        // 25차: 노바 내장 모드 / 24-46차: Fabric API - 둘 다 클라이언트 자체 기능이라
        // 공유 코드에 포함하지 않음(받는 쪽 런처가 실행 시 알아서 다시 주입함)
        if (kind === "mods" && isHiddenModFileName(f)) continue;
        const buffer = await fsp.readFile(path.join(dir, f));
        await uploadFileToSupabase("shared-profile-files", `${code}/${kind}/${encodeURIComponent(f)}`, buffer);
        kinds[kind].push(f);
      }
    }

    // 로컬에서 없어진(=삭제된) 파일들의 Storage 오브젝트 정리
    const prevKindMap = {
      mods: prevShared.mod_files || [],
      resourcepacks: prevShared.resourcepack_files || [],
      shaderpacks: prevShared.shader_files || [],
    };
    const staleObjectPaths = [];
    for (const kind of Object.keys(kinds)) {
      const nowSet = new Set(kinds[kind]);
      for (const f of prevKindMap[kind]) {
        if (!nowSet.has(f)) staleObjectPaths.push(`${code}/${kind}/${f}`);
      }
    }

    let iconFile = null;
    const icon = findProfileIconFile(profileId);
    if (icon) {
      const buffer = await fsp.readFile(icon.path);
      iconFile = `icon.${icon.ext}`;
      await uploadFileToSupabase("shared-profile-files", `${code}/${iconFile}`, buffer);
    }
    if (prevShared.icon_file && prevShared.icon_file !== iconFile) {
      staleObjectPaths.push(`${code}/${prevShared.icon_file}`);
    }

    // 24-100차: 설정 묶음(옵션을 끈 경우엔 예전 묶음이 stale로 빠짐)
    const prevMeta = await fetchShareMeta(code);
    const extras = await uploadShareExtras(code, profileRoot, shareOptions, prevMeta);
    staleObjectPaths.push(...extras.stale);

    await deleteStorageObjects("shared-profile-files", staleObjectPaths);

    const nowIso = new Date().toISOString();
    await supabaseFetch(`/shared_profiles?code=eq.${code}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: profile.name,
        mc_version: profile.mcVersion,
        memory_gb: profile.memoryGB,
        width: profile.width,
        height: profile.height,
        fullscreen: profile.fullscreen,
        mod_files: kinds.mods,
        resourcepack_files: kinds.resourcepacks,
        shader_files: kinds.shaderpacks,
        icon_file: iconFile,
        ...(sendNotify ? { updated_at: nowIso } : {}),
      }),
    });

    {
      const list = getProfiles();
      const idx = list.findIndex((p) => p.id === profileId);
      if (idx >= 0) {
        list[idx].shareOptions = shareOptions;
        list[idx].shareLastUploadedAt = nowIso;
        saveProfiles(list);
      }
    }
    return { ok: true, updatedAt: nowIso, notified: sendNotify, meta: extras.meta, skippedConfigs: extras.skippedConfigs.length };
  } catch (err) {
    logToFile("프로필 갱신(공유 재업로드) 실패: " + (err?.message || err));
    const raw = String(err?.message || err);
    const friendly = raw.startsWith("STORAGE_RLS:")
      ? "지금은 공유 파일 업로드가 서버에서 막혀있어요 (관리자에게 알려주세요). 잠시 후 다시 시도해주세요."
      : raw;
    return { ok: false, error: friendly };
  }
});

// 2-6(7차) → 24-100차: 공유받은 프로필의 "업데이트 신호" 확인. 예전엔 새 버전이 있으면 조용히
// 전부 덮어썼는데, 이제는 받을지를 사람이 고름 - 여기선 "무엇이 바뀌었나"만 모아서 돌려주고
// 반영은 profiles:apply-share-update, 건너뛰기는 profiles:skip-share-update가 함.
// updateSync(=업데이트 알림 받기)가 꺼진 프로필은 확인하지 않음.
ipcMain.handle("profiles:check-share-updates", async () => {
  const list = getProfiles();
  const targets = list.filter((p) => p.importedFrom && p.updateSync !== false);
  const pending = [];
  for (const profile of targets) {
    try {
      const rows = await supabaseFetch(`/shared_profiles?code=eq.${profile.importedFrom}&select=*`);
      const shared = rows[0];
      if (!shared) continue; // 원본 공유가 지워졌으면 조용히 건너뜀 (지금 프로필은 그대로 둠)
      const seen = profile.sharedUpdatedAtSeen ? new Date(profile.sharedUpdatedAtSeen).getTime() : 0;
      const current = shared.updated_at ? new Date(shared.updated_at).getTime() : 0;
      if (!(current > seen)) continue; // 새 버전 없음
      const meta = await fetchShareMeta(shared.code);
      // 24-105차: 공유자가 "업데이트 공유"를 끈 코드면 알리지 않음
      if (meta?.options && meta.options.updates === false) continue;
      pending.push({
        profileId: profile.id,
        profileName: profile.name,
        code: shared.code,
        author: shared.created_by || profile.importedAuthor || null,
        updatedAt: shared.updated_at,
        mcVersion: shared.mc_version,
        mcVersionChanged: String(shared.mc_version) !== String(profile.mcVersion),
        fromVersion: profile.mcVersion,
        diff: diffSharedUpdate(profile, shared, meta),
      });
    } catch (err) {
      logToFile(`[업데이트 알림] "${profile.name}" 확인 실패: ` + (err?.message || err));
    }
  }
  return { ok: true, pending };
});

ipcMain.handle("profiles:apply-share-update", async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile || !profile.importedFrom) return { ok: false, error: "공유받은 프로필이 아니에요." };
  // 게임이 켜져 있으면 그 폴더의 jar가 잠겨 있어서 바꾸다 깨질 수 있음
  if (isProfileFolderBusy()) return { ok: false, error: "게임을 끈 뒤에 업데이트해주세요." };
  try {
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${profile.importedFrom}&select=*`);
    const shared = rows[0];
    if (!shared) return { ok: false, error: "공유자가 공유를 지워서 더 이상 업데이트할 수 없어요." };
    const meta = await fetchShareMeta(shared.code);
    const root = getProfileRoot(profile.id);
    const applied = await applySharedProfileContent(root, shared, meta, profile.sharedFiles || null, { initial: false });
    const list = getProfiles();
    const idx = list.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      list[idx].mcVersion = shared.mc_version;
      list[idx].sharedUpdatedAtSeen = shared.updated_at || new Date().toISOString();
      list[idx].sharedFiles = applied.sharedFiles;
      list[idx].sharedExtras = { ...(list[idx].sharedExtras || {}), ...applied.sharedExtras };
      saveProfiles(list);
    }
    logToFile(`[업데이트 알림] "${profile.name}" (코드 ${shared.code}) 업데이트 반영`);
    prefetchAssetsForProfile({ ...profile, mcVersion: shared.mc_version }).catch(() => {});
    return { ok: true, profile: idx >= 0 ? list[idx] : profile };
  } catch (err) {
    logToFile(`[업데이트 알림] "${profile.name}" 업데이트 실패: ` + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// "이번 건 건너뛰기" - 이 버전은 본 것으로 치고, 다음 업데이트 신호부터 다시 알림
ipcMain.handle("profiles:skip-share-update", (_e, profileId, updatedAt) => {
  const list = getProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) return { ok: false, error: "존재하지 않는 프로필이에요." };
  list[idx].sharedUpdatedAtSeen = updatedAt || new Date().toISOString();
  saveProfiles(list);
  return { ok: true };
});

// 24-14차: "설정에 시스템 언어 자동 옵션 빼줘" - language가 아직 한 번도 저장 안 됐거나
// (기본값 "system") 예전 버전에서 "system"으로 저장돼있던 경우, 지금 이 순간의 OS 언어로
// 딱 한 번 ko/en 중 하나로 확정해서 store에 그대로 저장해둠 - 그 뒤로는 설정 화면에서 직접
// 고른 값만 쓰고, "system"이라는 자동 추적 상태 자체가 다시는 나타나지 않음
function getSettings() {
  const merged = { ...DEFAULT_SETTINGS, ...(store.get("settings") || {}) };
  if (merged.language !== "ko" && merged.language !== "en") {
    const locale = String(app.getLocale() || "ko").toLowerCase();
    merged.language = locale.startsWith("en") ? "en" : "ko";
    store.set("settings", merged);
  }
  return merged;
}
function setSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  store.set("settings", merged);
  return merged;
}

// ----------------------------------------------------------------------------
// 경로 헬퍼
// ----------------------------------------------------------------------------
function getRoot() {
  return path.join(app.getPath("appData"), CONFIG.INSTANCE_NAME);
}

function getRuntimeDir(javaFeatureVersion) {
  return path.join(getRoot(), "runtime", `jre-${javaFeatureVersion}`);
}

function getJavaExecutable(javaFeatureVersion) {
  const runtime = getRuntimeDir(javaFeatureVersion);
  if (process.platform === "win32") {
    return findJavawRecursive(runtime);
  }
  return findJavaBinRecursive(runtime, "java");
}

// Adoptium 압축을 풀면 내부 폴더명이 버전마다 달라서(jdk-21.0.x+y-jre 등) 재귀 탐색
function findFileRecursive(dir, fileName) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, fileName);
      if (found) return found;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  return null;
}
function findJavawRecursive(dir) {
  return findFileRecursive(dir, "javaw.exe") || findFileRecursive(dir, "java.exe");
}
function findJavaBinRecursive(dir, name) {
  return findFileRecursive(dir, name);
}

// ----------------------------------------------------------------------------
// 노바 내장 모드(novaclient-mod) 자동 주입 (25차, 2026-08-31)
// ⚠️ 25-3차: 이 블록은 한 번 다른 작업 세션의 병행 저장으로 통째로 유실된 적이 있음 - 지우면 안 됨.
// Nova-Mod 프로젝트에서 버전별로 빌드한 jar(총 40개, 1.15.2~26.2)를 novamod/ 폴더에
// 담아두고, 실행할 때마다 그 마인크래프트 버전에 맞는 jar 하나를 인스턴스 mods 폴더에
// 자동으로 복사함. 이 모드는 "설치된 모드"가 아니라 클라이언트 자체 기능이라서:
//  - 프로필/서버 어느 모드로 실행하든 항상 들어감 (단, Fabric일 때만 - 바닐라/Forge/
//    NeoForge 프로필은 Fabric 모드를 못 읽으므로 건너뜀)
//  - 런처의 모드 관리 화면(mods:list-installed / profiles:list-files)에는 안 보임
//  - 프로필 공유 코드 업로드에도 포함 안 됨
// 해당 버전용 jar가 novamod/에 없으면(모드가 아직 지원 안 하는 버전) 조용히 건너뜀.
// ----------------------------------------------------------------------------
const NOVA_MOD_FILE_PREFIX = "novaclient-mod-";
// 49-207차: 모드 이름이 Luna's Light(id lunaslight)로 바뀌면서 jar 이름도 lunaslight-<버전>-...jar 가 됐다.
// 저장소/폴더에 옛 이름과 새 이름이 섞여 있을 수 있어서 둘 다 알아보고, 같은 마크 버전이면 새 이름을 먼저 쓴다.
const LUNA_MOD_FILE_PREFIX = "lunaslight-";
// 49-212차(사용자: "밖으로 내보내지는 파일 이름에 루나나 노바 다 빼"): jar 이름을 builtin-mod-<버전>-...jar 로.
// 셋 다 알아보고 같은 마크 버전이면 builtin-mod > lunaslight > novaclient-mod 순으로 쓴다.
const BUILTIN_MOD_FILE_PREFIX = "builtin-mod-";
function isModJarName(f) {
  return typeof f === "string" &&
    (f.startsWith(BUILTIN_MOD_FILE_PREFIX) || f.startsWith(LUNA_MOD_FILE_PREFIX) || f.startsWith(NOVA_MOD_FILE_PREFIX));
}
// 새 방식(.luna-*.json 교환, config/lunaslight) 모드인지 - builtin-mod와 lunaslight 둘 다
function isLunaModJarName(f) {
  return typeof f === "string" && (f.startsWith(BUILTIN_MOD_FILE_PREFIX) || f.startsWith(LUNA_MOD_FILE_PREFIX));
}
// 같은 마크 버전 jar가 여럿이면 높은 쪽을 쓴다
function modJarRank(f) {
  if (typeof f !== "string") return -1;
  if (f.startsWith(BUILTIN_MOD_FILE_PREFIX)) return 2;
  if (f.startsWith(LUNA_MOD_FILE_PREFIX)) return 1;
  return f.startsWith(NOVA_MOD_FILE_PREFIX) ? 0 : -1;
}

// 24-46차: 모든 Fabric 프로필에 Fabric API를 기본으로 자동 주입 - "패브릭 모드 깔 때마다
// Fabric API 없어서 안 켜진다"는 문제를 아예 없애기 위해, 노바 내장 모드와 완전히 같은
// "숨김 자동 주입" 방식을 그대로 재사용함. 차이점은 노바 모드는 이 저장소 안(novamod/)에
// 미리 빌드해둔 jar를 복사하는 것이고, Fabric API는 남의 프로젝트라 Modrinth(공식 프로젝트 ID
// P7dR8mSH)에서 그 마인크래프트 버전에 맞는 빌드를 매번 조회해서 받아온다는 점뿐 - 나머지
// (모드 관리 화면에 안 보임 / 삭제 불가능 / 모드팩 내보내기·공유 코드에 안 실림) 규칙은 동일함.
// ════════════════════════════════════════════════════════════════════════════
// 24-141차: "구 버전들 패브릭 api 가 안깔린 게 좀 있는 거 같아"
// 자동 주입(Fabric API / Mod Menu)에 같은 모양의 구멍이 세 개 있었음:
//
//  1) 실패하면 "있던 것까지 지워버림"
//     조회에 실패하면 picked=null -> wantedName=null 이 되고, 그 상태로 "wantedName 이
//     아닌 기존 jar 를 전부 삭제"하는 정리 코드가 먼저 돌았음. 즉 인터넷이 잠깐 끊기거나
//     Modrinth 가 5xx/레이트리밋을 한 번만 뱉어도, 잘 깔려 있던 Fabric API 가 지워지고
//     아무것도 안 들어간 채로 게임이 켜졌음. -> 새로 넣을 게 확정됐을 때만 옛것을 지움.
//
//  2) 실패 결과를 앱이 꺼질 때까지 캐시함
//     resolve...File() 이 null 도 캐시에 넣어서, 한 번 실패하면 런처를 껐다 켤 때까지
//     그 버전은 계속 "없음"으로 처리됐음. -> 성공한 결과만 캐시함.
//
//  3) 받은 파일이 진짜 jar 인지 확인하지 않음
//     fetch 결과를 그대로 저장해서, CDN 오류 페이지나 중간에 끊긴 파일이 mods/ 에
//     들어가면 게임이 아예 안 켜졌음. -> looksLikeFabricModJar 로 확인하고 아니면 지움.
//
// 그리고 실패했을 때 로그에만 남기고 조용히 넘어가던 것도, 노바 모드와 마찬가지로
// 런처 화면에 알리도록 바꿈.
// ════════════════════════════════════════════════════════════════════════════

// Modrinth 가 아주 옛날 파일 이름을 URL 인코딩된 채로 주는 경우가 있어서(예:
// "fabric-api-0.28.5%2B1.14.jar") 사람이 읽을 수 있는 이름으로 되돌림.
// 디코딩이 실패하거나 경로 구분자가 섞이면 원본을 그대로 씀(안전 우선).
function safeDecodeFileName(name) {
  const raw = String(name || "");
  if (!raw.includes("%")) return raw;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return raw;
    return decoded;
  } catch (_) {
    return raw;
  }
}

// 자동 주입 공통 처리: 조회 -> (확정됐을 때만) 옛 jar 정리 -> 내려받기 -> jar 검증
// label 은 로그/알림에 쓰는 이름("Fabric API" 등), prefix 는 파일 이름 앞에 붙이는 표식
async function syncAutoInjectedMod({ label, prefix, mcVersion, runRoot, resolve }) {
  const destDir = path.join(runRoot, "mods");
  await fsp.mkdir(destDir, { recursive: true });

  let picked = null;
  try {
    picked = await resolve(mcVersion);
  } catch (err) {
    logToFile(`[${label}] 버전 조회 실패: ` + (err?.message || err));
  }

  const legacy = LEGACY_INJECT_PREFIXES[prefix];
  const listExisting = async () =>
    (await fsp.readdir(destDir)).filter((f) => f.startsWith(prefix) || (legacy && f.startsWith(legacy)));

  if (!picked || !picked.fileUrl) {
    // ⚠️ 여기서 기존 jar 를 지우면 안 됨 - 조회 실패였을 수도 있는데, 그러면 잘 쓰던
    //    Fabric API 가 사라진 채로 게임이 켜짐(이 라운드에서 고친 핵심 버그)
    const kept = await listExisting();
    if (kept.length > 0) {
      logToFile(`[${label}] ${mcVersion} 조회 실패 - 이미 있는 ${kept[0]} 을 그대로 씁니다`);
      return;
    }
    logToFile(`[${label}] ${mcVersion}에 맞는 버전을 찾지 못해 주입을 건너뜀`);
    notifyRenderer(`${label}(${mcVersion})를 넣지 못했어요. 인터넷 연결을 확인해주세요.`, "error");
    return;
  }

  const wantedName = prefix + safeDecodeFileName(picked.fileName);
  const destPath = path.join(destDir, wantedName);

  if (!fs.existsSync(destPath)) {
    const res = await fetch(picked.fileUrl);
    if (!res.ok) throw new Error(`${label} 다운로드 실패 (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const tmpPath = destPath + ".part";
    await fsp.writeFile(tmpPath, buffer);
    // 받은 게 진짜 Fabric 모드 jar 인지 확인 - 오류 페이지나 잘린 파일이 들어가면
    // 게임이 아예 안 켜짐
    if (!looksLikeFabricModJar(tmpPath)) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw new Error(`${label} 파일이 올바르지 않아 버렸습니다`);
    }
    await fsp.rename(tmpPath, destPath);
    logToFile(`[${label}] 주입: ${wantedName}`);
  }

  // 새 파일이 확실히 자리잡은 뒤에야 다른 버전용 옛 jar 를 정리함
  for (const f of await listExisting()) {
    if (f === wantedName) continue;
    await fsp.unlink(path.join(destDir, f)).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 24-184차: "너굴마을은 모드체커 고정으로 되게 해달라니까"
//
// 너굴마을 전용 모드체커를 노바 모드와 같은 "고정 주입" 대상으로 만든다.
//   · 너굴마을에 연결된 프로필로 켤 때마다 자동으로 들어간다
//   · 모드 목록에 안 보이고(isHiddenModFileName), 유저가 끄거나 지울 수 없다
//   · 너굴마을 연결을 풀면 다음 실행 때 알아서 빠진다
//
// 받는 곳은 https://mcng.kr/mods/ng-modchecker.zip 하나뿐이고 버전 표기가 없어서,
// ETag/Last-Modified 로 "바뀌었을 때만" 다시 받는다(조건부 GET). 서버가 안 되면 전에
// 받아둔 걸 그대로 쓴다 - 게임은 켜져야 하니까.
// 이름은 .zip 인데 실제로는 jar 가 그대로 올라오기도 해서, 열어보고 판단한다.
//   · 안에 fabric.mod.json 이 있으면 그 파일 자체가 모드 jar
//   · 아니면 zip 안의 첫 .jar 를 꺼내 쓴다
// ────────────────────────────────────────────────────────────────────────────
// 49-212차: 런처가 넣는 jar 이름에서 노바를 뺐다. 옛 이름(novaclient-ngmodchecker-)도 우리 것으로 알아보고 정리한다.
const NEOGUL_MODCHECKER_PREFIX = "builtin-ngmodchecker-";
const NEOGUL_MODCHECKER_PREFIX_OLD = "novaclient-ngmodchecker-";
function isOurModCheckerName(f) {
  return f.startsWith(NEOGUL_MODCHECKER_PREFIX) || f.startsWith(NEOGUL_MODCHECKER_PREFIX_OLD);
}
const NEOGUL_MODCHECKER_URL = "https://mcng.kr/mods/ng-modchecker.zip";
const NEOGUL_MODCHECKER_META_KEY = "neogul_modchecker_meta";

function neogulModCheckerCacheDir() {
  return path.join(getRoot(), "ngmodchecker");
}

// 내려받은 파일(zip 또는 jar)에서 진짜 모드 jar 바이트를 꺼낸다. 못 찾으면 null.
function extractModCheckerJar(buffer) {
  try {
    const zip = new AdmZip(buffer);
    if (zip.getEntry("fabric.mod.json")) return buffer; // 이미 모드 jar 였음
    const inner = zip.getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".jar"));
    return inner ? inner.getData() : null;
  } catch (_) {
    return null;
  }
}

// jar 안의 fabric.mod.json 에서 모드 id 를 읽는다(못 읽으면 null).
function readFabricModId(filePath) {
  try {
    const entry = new AdmZip(filePath).getEntry("fabric.mod.json");
    if (!entry) return null;
    const j = JSON.parse(entry.getData().toString("utf-8"));
    return j && typeof j.id === "string" ? j.id : null;
  } catch (_) {
    return null;
  }
}

// 최신 모드체커 jar 를 캐시 폴더에 준비하고 그 경로를 돌려준다(실패하면 null).
async function ensureNeogulModCheckerJar() {
  const dir = neogulModCheckerCacheDir();
  await fsp.mkdir(dir, { recursive: true });
  const jarPath = path.join(dir, "ng-modchecker.jar");
  const meta = store.get(NEOGUL_MODCHECKER_META_KEY) || {};

  const headers = {};
  if (fs.existsSync(jarPath)) {
    if (meta.etag) headers["If-None-Match"] = meta.etag;
    if (meta.lastModified) headers["If-Modified-Since"] = meta.lastModified;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(NEOGUL_MODCHECKER_URL, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 304 && fs.existsSync(jarPath)) {
      return jarPath; // 안 바뀌었음
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = Buffer.from(await res.arrayBuffer());
    const jar = extractModCheckerJar(raw);
    if (!jar) throw new Error("모드 jar 를 찾지 못했어요");

    const tmp = jarPath + ".part";
    await fsp.writeFile(tmp, jar);
    if (!looksLikeFabricModJar(tmp)) {
      await fsp.unlink(tmp).catch(() => {});
      throw new Error("받은 파일이 Fabric 모드가 아니에요");
    }
    await fsp.rename(tmp, jarPath);
    store.set(NEOGUL_MODCHECKER_META_KEY, {
      etag: res.headers.get("etag") || null,
      lastModified: res.headers.get("last-modified") || null,
      sha: crypto.createHash("sha256").update(jar).digest("hex").slice(0, 8),
      updatedAt: new Date().toISOString(),
    });
    logToFile("[너굴 모드체커] 새로 받았어요");
    return jarPath;
  } catch (err) {
    logToFile("[너굴 모드체커] 내려받기 실패: " + (err?.message || err));
    return fs.existsSync(jarPath) ? jarPath : null; // 전에 받아둔 게 있으면 그거라도
  }
}

// 너굴마을에 연결된 프로필이면 모드체커를 넣고, 아니면 빼준다.
async function syncNeogulModChecker(profileId, runRoot) {
  const destDir = path.join(runRoot, "mods");
  const listExisting = async () => {
    try {
      return (await fsp.readdir(destDir)).filter(isOurModCheckerName);
    } catch (_) {
      return [];
    }
  };

  try {
    if (!isProfileLinkedToNeogul(profileId)) {
      // 너굴마을용이 아니면 전에 넣어둔 게 있어도 치운다
      for (const f of await listExisting()) {
        await fsp.unlink(path.join(destDir, f)).catch(() => {});
        logToFile("[너굴 모드체커] 너굴마을 연결이 아니라 뺐어요: " + f);
      }
      return;
    }

    await fsp.mkdir(destDir, { recursive: true });
    const jarPath = await ensureNeogulModCheckerJar();
    if (!jarPath) {
      const kept = await listExisting();
      if (kept.length) {
        logToFile("[너굴 모드체커] 새로 못 받아서 이미 있는 " + kept[0] + " 을 그대로 씁니다");
        return;
      }
      notifyRenderer("너굴마을 모드체커를 받지 못했어요. 인터넷 연결을 확인해주세요.", "error");
      return;
    }

    // 24-185차: 유저가 같은 모드체커를 직접 깔아둔 경우. Fabric 은 같은 모드 id 가 두 개면
    // 게임을 아예 안 켜주므로(중복 모드 오류), 그럴 땐 우리 사본을 넣지 않고 유저 것을 쓴다.
    const ourId = readFabricModId(jarPath);
    if (ourId) {
      let userCopy = null;
      try {
        for (const f of await fsp.readdir(destDir)) {
          if (!f.toLowerCase().endsWith(".jar")) continue;
          if (isOurModCheckerName(f)) continue; // 우리가 넣은 건 제외
          if (readFabricModId(path.join(destDir, f)) === ourId) { userCopy = f; break; }
        }
      } catch (_) {}
      if (userCopy) {
        for (const f of await listExisting()) {
          await fsp.unlink(path.join(destDir, f)).catch(() => {});
        }
        logToFile(`[너굴 모드체커] 직접 깔아둔 ${userCopy} 가 있어서 그걸 그대로 씁니다(중복 주입 안 함)`);
        return;
      }
    }

    // 내용이 바뀌면 파일 이름도 바뀌도록 해시를 붙인다(바뀐 걸 확실히 갈아끼우려고)
    const sha = crypto.createHash("sha256").update(await fsp.readFile(jarPath)).digest("hex").slice(0, 8);
    const wantedName = `${NEOGUL_MODCHECKER_PREFIX}${sha}.jar`;
    const destPath = path.join(destDir, wantedName);
    if (!fs.existsSync(destPath)) {
      await fsp.copyFile(jarPath, destPath);
      logToFile("[너굴 모드체커] 주입: " + wantedName);
    }
    // 새 파일이 자리잡은 뒤에 옛 버전 정리
    for (const f of await listExisting()) {
      if (f === wantedName) continue;
      await fsp.unlink(path.join(destDir, f)).catch(() => {});
    }
  } catch (err) {
    // 모드체커를 못 넣어도 게임 실행 자체는 막지 않는다(다른 자동 주입과 같은 규칙)
    logToFile("[너굴 모드체커] 주입 실패(실행은 계속함): " + (err?.message || err));
  }
}

const FABRIC_API_PROJECT_ID = "P7dR8mSH"; // Modrinth의 "Fabric API" 공식 프로젝트 ID
const FABRIC_API_FILE_PREFIX = "builtin-fabricapi-";

// 24-50차: "모드 리스트 모드를 자체적으로 내장시키고" - 게임 안에서 설치된 모드 목록을
// 보여주는 Fabric 모드 "Mod Menu"도 Fabric API와 완전히 같은 패턴으로 모든 Fabric
// 프로필에 기본 자동 주입함. Mod Menu 자체가 Fabric API에 의존하는 모드라, 이미 항상
// 같이 주입되고 있는 Fabric API 덕분에 별도 처리 없이 의존성이 항상 충족됨.
const MOD_MENU_PROJECT_ID = "mOgUt4GM"; // Modrinth의 "Mod Menu" 공식 프로젝트 ID
const MOD_MENU_FILE_PREFIX = "builtin-modmenu-";
// 49-212차: 옛 이름으로 넣어 둔 자동 주입 jar(novaclient-fabricapi-/novaclient-modmenu-)도 우리 것으로 알아보고 정리한다
const LEGACY_INJECT_PREFIXES = {
  [FABRIC_API_FILE_PREFIX]: "novaclient-fabricapi-",
  [MOD_MENU_FILE_PREFIX]: "novaclient-modmenu-",
};

// 노바 내장 모드 + Fabric API + Mod Menu 셋 다 "유저가 관리하는 모드"가 아니므로, 모드
// 목록/모드팩 내보내기/공유 코드 어디에도 노출되면 안 됨 - 그 판단 기준을 한 군데로
// 모아둠(함수 선언이라 파일 어디서든 먼저 써도 안전함 - 호이스팅됨).
function isHiddenModFileName(fileName) {
  return (
    isModJarName(fileName) ||
    fileName.startsWith(FABRIC_API_FILE_PREFIX) ||
    fileName.startsWith(MOD_MENU_FILE_PREFIX) ||
    fileName.startsWith("novaclient-fabricapi-") ||
    fileName.startsWith("novaclient-modmenu-") ||
    isOurModCheckerName(fileName)
  );
}

// 이 마인크래프트 버전에 맞는 Fabric API 빌드를 Modrinth에서 조회 - 같은 실행 중엔 버전별로
// 한 번만 조회하도록 캐싱(여러 프로필을 연달아 실행해도 매번 다시 조회하지 않게)
const fabricApiVersionCache = {}; // mcVersion -> {fileUrl, fileName, versionNumber} | null
async function resolveFabricApiFile(mcVersion) {
  if (Object.prototype.hasOwnProperty.call(fabricApiVersionCache, mcVersion)) {
    return fabricApiVersionCache[mcVersion];
  }
  try {
    const versions = await fetchModVersionsForGame(FABRIC_API_PROJECT_ID, mcVersion, "mod");
    const picked = versions.find((v) => v.versionType === "release") || versions[0] || null;
    // 24-141차: 성공했을 때만 캐시함. 예전엔 null 도 캐시해서, 한 번 실패하면 런처를
    // 껐다 켤 때까지 그 버전은 계속 "없음"으로 처리됐음
    if (picked) fabricApiVersionCache[mcVersion] = picked;
    return picked;
  } catch (err) {
    logToFile("[Fabric API] 버전 조회 실패: " + (err?.message || err));
    return null;
  }
}

// syncNovaMod와 동일한 패턴: 이 버전에 안 맞는(옛날) Fabric API jar는 정리하고, 필요한 게
// 이미 있으면 재다운로드하지 않음. 조회/다운로드가 실패해도 실행 자체는 막지 않음(이 버전을
// Fabric API가 아직 지원 안 하는 아주 최신/구버전일 수도 있으므로 조용히 건너뜀).
async function syncFabricApiMod(mcVersion, runRoot) {
  try {
    await syncAutoInjectedMod({
      label: "Fabric API",
      prefix: FABRIC_API_FILE_PREFIX,
      mcVersion,
      runRoot,
      resolve: resolveFabricApiFile,
    });
  } catch (err) {
    // 주입이 실패해도 게임 실행 자체는 막지 않음(노바 모드와 같은 규칙)
    logToFile("[Fabric API] 주입 실패(실행은 계속함): " + (err?.message || err));
    notifyRenderer(`Fabric API(${mcVersion})를 넣지 못했어요. 인터넷 연결을 확인해주세요.`, "error");
  }
}

// resolveFabricApiFile/syncFabricApiMod와 완전히 같은 패턴 - Mod Menu용
const modMenuVersionCache = {}; // mcVersion -> {fileUrl, fileName, versionNumber} | null
async function resolveModMenuFile(mcVersion) {
  if (Object.prototype.hasOwnProperty.call(modMenuVersionCache, mcVersion)) {
    return modMenuVersionCache[mcVersion];
  }
  try {
    const versions = await fetchModVersionsForGame(MOD_MENU_PROJECT_ID, mcVersion, "mod");
    const picked = versions.find((v) => v.versionType === "release") || versions[0] || null;
    if (picked) modMenuVersionCache[mcVersion] = picked; // 24-141차: 실패는 캐시하지 않음
    return picked;
  } catch (err) {
    logToFile("[Mod Menu] 버전 조회 실패: " + (err?.message || err));
    return null;
  }
}

async function syncModMenuMod(mcVersion, runRoot) {
  try {
    await syncAutoInjectedMod({
      label: "Mod Menu",
      prefix: MOD_MENU_FILE_PREFIX,
      mcVersion,
      runRoot,
      resolve: resolveModMenuFile,
    });
  } catch (err) {
    logToFile("[Mod Menu] 주입 실패(실행은 계속함): " + (err?.message || err));
  }
}

// 25-2차: 노바 내장 모드 "런처 전용 잠금"용 공유 비밀값. 실행 직전에 이 값으로 서명한 토큰
// 파일(.nova-launch.json)을 게임 폴더에 써두면, 모드가 시작할 때 같은 비밀값으로 서명을
// 검증해서(15분 유효) 통과 못 하면 모든 기능을 스스로 끔 - jar만 복사해 다른 런처에 넣으면
// 아무것도 안 켜짐. ⚠️ Nova-Mod의 NovaClientMod.java에 있는 값과 반드시 같아야 함.
// (한계: 클라이언트 측 보호라 디컴파일할 줄 아는 사람은 우회 가능 - 일반 유저 차단 목적)
const NOVA_LAUNCH_SECRET = "677ba6308331ba9b0fb83bfdb6e3a52f81e890f38343001aa9ced084e04c751e";

// 49-38차: 설치판(app.isPackaged)은 패키징 시점에 묶인 resources/novamod의 jar만 봐서, 모드를 새로 빌드해도
// 런처를 다시 패키징하기 전엔 옛 jar가 계속 주입됐다(프로필 mods 폴더에 손으로 넣어도 다음 실행 때 되돌림).
// 사용자 데이터 폴더(%APPDATA%/NovaClient/novamod)에 jar가 있으면 그쪽을 먼저 쓴다 - Nova-Mod의 deployToLauncher가
// 빌드할 때마다 여기에도 복사하므로 "빌드 → 실행"만으로 새 모드가 들어간다.
function getNovaModDir() {
  const override = path.join(getRoot(), "novamod");
  try {
    if (fs.existsSync(override) && fs.readdirSync(override).some((f) => f.toLowerCase().endsWith(".jar"))) {
      return override;
    }
  } catch (_) {}
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "novamod");
  }
  return path.join(__dirname, "novamod");
}

// 49-152차(Nova-Mod 세션): "모든 버전에 이 모드가 안 들어가 있다던데" - 설치판은 1.21.11/26.1.2 jar만
// 설치 파일(resources/novamod)에 들어 있고 나머지 38개는 받아와야 한다. 그런데 예전엔 한 폴더만 봤다:
// %APPDATA%/NovaClient/novamod 에 jar가 하나라도 생기면(다른 버전을 한 번 받으면) 설치 파일에 든 jar를
// 아예 안 봐서, 그 버전도 다시 받아야 했다. 이제 받은 폴더 → 설치 파일 폴더 순서로 둘 다 찾는다.
function novaModDirCandidates() {
  const dirs = [path.join(getRoot(), "novamod")];
  dirs.push(app.isPackaged ? path.join(process.resourcesPath, "novamod") : path.join(__dirname, "novamod"));
  return dirs;
}

function findNovaModJarFor(mcVersion) {
  // 24-230차: "노바 이름의 모드는 지워야 해 루나스라이트여야 해"
  // 예전엔 폴더를 하나씩 보다가 처음 맞는 걸 바로 썼다 - 받아둔 폴더(%APPDATA%)에 옛 novaclient-mod jar만
  // 있으면 설치 파일 쪽 builtin-mod(= Luna's Light) 를 두고 옛 노바 모드가 들어갔다.
  // 이제 모든 폴더를 다 모아 Luna's Light(builtin-mod / lunaslight) 중에서만 고른다.
  const found = [];
  novaModDirCandidates().forEach((dir, dirIdx) => {
    try {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir)
        .filter((f) => isLunaModJarName(f) && f.endsWith(`+mc${mcVersion}.jar`))
        .forEach((f) => found.push({ dir, f, dirIdx }));
    } catch (_) {}
  });
  found.sort((a, b) => modJarRank(b.f) - modJarRank(a.f) || a.dirIdx - b.dirIdx);
  return found[0] ? path.join(found[0].dir, found[0].f) : null;
}

// 24-230차: 옛 노바 이름 jar(novaclient-mod-*)는 남겨둘 이유가 없다 - 켤 때 모드 폴더에서 지운다.
// (설치판의 resources 폴더는 지울 수 없을 수도 있어서 실패는 그냥 넘긴다)
async function purgeNovaNamedModJars() {
  let removed = 0;
  for (const dir of novaModDirCandidates()) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of await fsp.readdir(dir)) {
        if (f.startsWith(NOVA_MOD_FILE_PREFIX)) {
          await fsp.unlink(path.join(dir, f)).then(() => removed++).catch(() => {});
        }
      }
    } catch (_) {}
  }
  if (removed) logToFile(`[모드] 옛 노바 이름 jar ${removed}개 삭제`);
}
app.whenReady().then(() => setTimeout(() => purgeNovaNamedModJars().catch(() => {}), 3000));

// ════════════════════════════════════════════════════════════════════════════
// 24-92차: 모드 jar 40개를 설치 파일에 넣지 않고, "지금 실행할 버전 하나"만 받아옴
// (24-93차에 복구: 다른 작업 세션의 병행 저장으로 이 블록이 통째로 유실됐었음 - 지우면 안 됨.
//  package.json의 extraResources에서 novamod가 빠져 있으므로, 이 블록이 없으면
//  설치판에서는 노바 모드가 아예 안 들어갑니다.)
//
// 왜: jar 40개가 125MB라서 설치 파일 페이로드가 276MB까지 커졌고, 게시할 때마다 그걸
// 통째로 업로드해야 했습니다(실측 61KB/s = 약 78분). 사람은 보통 한두 버전만 씁니다.
//
// 받은 jar는 %APPDATA%/NovaClient/novamod 에 남습니다. 이 폴더는 원래부터
// getNovaModDir()이 가장 먼저 보는 곳(49-38차)이라, 한 번 받으면 다음부터는 그대로 씁니다.
//
// 실패해도 실행은 막지 않습니다 - Fabric API/Mod Menu 자동 주입과 완전히 같은 규칙입니다.
// ════════════════════════════════════════════════════════════════════════════
// 24-189차 이후로 이 값은 "저장소 목록을 못 받았을 때"만 쓰는 예비값이다. 평소엔 저장소의
// novamod/ 폴더 목록에서 이름을 그대로 가져오므로, 모드 버전을 올려도 여기를 고칠 필요가 없다.
const NOVA_MOD_VERSION = "0.1.0"; // 예비용 - jar 이름에 들어가는 모드 버전
// 40개 jar가 첨부돼 있는 Release 태그(.github/workflows/novamod-assets.yml이 만듦).
// 런처 버전과 따로 두는 이유: 모드가 그대로인데 런처만 새로 내는 회차에 jar를 다시 올릴 필요가 없음.
const NOVA_MOD_RELEASE_TAG = `novamod-${NOVA_MOD_VERSION}`;
const NOVA_MOD_DOWNLOAD_BASE = `https://github.com/Sil2ntium7012/nova-client/releases/download/${NOVA_MOD_RELEASE_TAG}/`;

function novaModFileNameFor(mcVersion) {
  return `${BUILTIN_MOD_FILE_PREFIX}${mcVersion}-${NOVA_MOD_VERSION}+mc${mcVersion}.jar`;
}

// 받은 파일이 진짜 Fabric 모드 jar인지 확인합니다. "zip으로 열리고 fabric.mod.json이
// 있다"는 조건으로 404 HTML이나 중간에 끊긴 파일을 걸러냅니다(그런 파일을 mods에
// 넣으면 게임이 아예 안 켜집니다).
function looksLikeFabricModJar(filePath) {
  try {
    return !!new AdmZip(filePath).getEntry("fabric.mod.json");
  } catch (_) {
    return false;
  }
}

// 같은 실행 중에 이미 실패한 버전은 다시 시도하지 않음
const novaModDownloadFailed = new Set();

// ⚠️ 받는 도중에 연결이 끊기면 응답 스트림이 끝나지도, 에러가 나지도 않고 **그대로 멈춰
// 있는** 경우가 있습니다(재현 확인 - 100초를 기다려도 안 끝남). 게임을 켜기 직전에 부르는
// 함수라 그러면 게임이 영영 안 켜지므로 두 겹으로 막습니다.
//   · 조각이 20초 동안 안 오면 취소(STALL)
//   · 전체 120초 상한(HARD - content-length가 없어 진행률 콜백이 안 불리는 경우 대비)
const NOVA_MOD_DL_STALL_MS = 20000;
const NOVA_MOD_DL_HARD_MS = 120000;

// 49-152차: 받는 곳을 두 군데로. ① 저장소 main 브랜치의 novamod/ 폴더(raw) - jar 40개가 git에 들어 있어서
// push만 하면 바로 최신이 된다. ② 예전 Release 태그(novamod-0.1.0) - 워크플로(novamod-assets.yml)가 PC에
// 없어서 이 릴리스가 안 만들어졌을 가능성이 높다. 그래서 ①을 먼저, ②는 예비로만 쓴다.
const NOVA_MOD_RAW_BASE = "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/novamod/";

function novaModUrlsFor(fileName) {
  return [NOVA_MOD_RAW_BASE + encodeURIComponent(fileName), NOVA_MOD_DOWNLOAD_BASE + fileName];
}

// 받은 jar 기록(%APPDATA%/NovaClient/novamod/.downloaded.json): { 파일이름: { size, mtimeMs, etag } }.
// 우리가 받은 파일만 나중에 새 버전으로 바꿔 준다. 크기/시각이 기록과 다르면 누가(Nova-Mod의
// deployToLauncher 빌드 복사 등) 바꾼 것이라 건드리지 않는다 - 개발 PC의 새 빌드를 옛 jar로 덮는 사고 방지.
function novaModRecordPath() {
  return path.join(getRoot(), "novamod", ".downloaded.json");
}
function readNovaModRecord() {
  try {
    return JSON.parse(fs.readFileSync(novaModRecordPath(), "utf-8")) || {};
  } catch (_) {
    return {};
  }
}
function writeNovaModRecord(rec) {
  try {
    fs.writeFileSync(novaModRecordPath(), JSON.stringify(rec, null, 2), "utf-8");
  } catch (_) {}
}

// 49-203차: 개발 PC 표시. Nova-Mod 빌드(deployToLauncherAppData)가 %APPDATA%/NovaClient/novamod/.local-build 를 만든다.
// 이 표시가 있는 PC에서, 우리가 받은 기록이 없거나 기록과 크기/시각이 다른 jar는 "이 PC에서 빌드한 것"으로 보고 덮지 않는다.
// 일반 사용자 PC에는 표시가 없어서 예전처럼 저장소 최신을 받는다.
function isLocalNovaModBuild(filePath) {
  try {
    if (!fs.existsSync(path.join(getRoot(), "novamod", ".local-build"))) return false;
    const rec = readNovaModRecord()[path.basename(filePath)];
    if (!rec) return true;
    const st = fs.statSync(filePath);
    return st.size !== rec.size || Math.abs(st.mtimeMs - rec.mtimeMs) > 2000;
  } catch (_) {
    return false;
  }
}

// 한 주소에서 jar 하나 받기(.part → 검사 → 제 이름). 성공하면 ETag를 돌려준다(없으면 "").
async function downloadNovaModFrom(url, destPath) {
  const tmpPath = destPath + ".part";
  const controller = new AbortController();
  let stallTimer = null;
  const hardTimer = setTimeout(() => controller.abort(), NOVA_MOD_DL_HARD_MS);
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), NOVA_MOD_DL_STALL_MS);
  };
  try {
    armStall();
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const etag = res.headers.get("etag") || "";
    await fsp.mkdir(path.dirname(tmpPath), { recursive: true });
    const out = fs.createWriteStream(tmpPath);
    await new Promise((resolve, reject) => {
      res.body.on("data", armStall);
      res.body.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      res.body.pipe(out);
    });
    if (!looksLikeFabricModJar(tmpPath)) throw new Error("받은 파일이 올바른 모드 jar가 아님");
    await fsp.rename(tmpPath, destPath);
    return etag;
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  } finally {
    clearTimeout(stallTimer);
    clearTimeout(hardTimer);
  }
}

async function downloadNovaModJar(mcVersion, fileName, destPath) {
  let lastErr = null;
  for (const url of novaModUrlsFor(fileName)) {
    try {
      const etag = await downloadNovaModFrom(url, destPath);
      const st = await fsp.stat(destPath);
      const rec = readNovaModRecord();
      rec[fileName] = { size: st.size, mtimeMs: st.mtimeMs, etag, from: url };
      writeNovaModRecord(rec);
      logToFile(`[노바 모드] ${mcVersion}용 jar 다운로드 완료: ${fileName} (${url})`);
      return destPath;
    } catch (err) {
      lastErr = err;
      logToFile(`[노바 모드] ${mcVersion}용 jar 받기 실패, 다음 주소 시도: ${url} - ${err?.message || err}`);
    }
  }
  throw lastErr || new Error("받을 곳이 없음");
}

// ════════════════════════════════════════════════════════════════════════════
// 24-189차: "우리 모드 클라이언트 업뎃 안해도 항상 최신 우리 클라 모드만 가져오는 법 없어?"
//
// 여태도 jar 내용이 바뀌면 런처 업데이트 없이 새로 받아오긴 했다(아래 refreshNovaModJar -
// 저장소 raw 파일의 ETag 비교). 그런데 두 군데가 막혀 있었다:
//   ① 파일 이름을 NOVA_MOD_VERSION("0.1.0")으로 런처 안에서 만들어 썼다. 모드 버전을
//      0.2.0으로 올리면 파일 이름이 바뀌는데, 런처는 계속 0.1.0 이름만 찾으니 결국
//      런처를 새로 내야 했다.
//   ② 설치 파일에 같이 들어간 jar(resources/novamod - 1.21.11 / 26.1.2)는 "우리가 받은 게
//      아니라서" 최신 확인을 아예 건너뛰었다. 그 두 버전을 쓰는 사람은 설치할 때 들어간
//      모드를 계속 쓰게 된다.
//
// 그래서 이름을 만들어 쓰는 대신, 저장소의 novamod/ 폴더 목록을 한 번 받아와서 "그 마크
// 버전으로 끝나는 파일"을 고른다. 모드 버전이 뭐든 상관없어지므로, 이제 모드를 새로 내면
// jar를 novamod/ 에 넣고 push 하는 것만으로 모든 사람이 다음 실행 때 최신을 받는다.
// 목록에는 파일마다 git blob sha가 같이 오니, 가지고 있는 파일의 sha와 비교해서 다를 때만
// 받는다(설치 파일에 든 jar도 이 비교를 똑같이 거친다).
// 목록을 못 받으면(오프라인·요청 제한) 예전 방식 그대로 동작한다 - 아무것도 안 막힌다.
const NOVA_MOD_LIST_URL =
  "https://api.github.com/repos/Sil2ntium7012/nova-client/contents/novamod?ref=main";
const NOVA_MOD_LIST_MS = 8000;
let novaModListPromise = null; // 런처를 켠 뒤 한 번만 요청

// 깃이 파일에 매기는 해시(sha1("blob <길이>\0" + 내용)). 목록이 주는 sha와 같은 방식이라
// 내려받지 않고도 "내가 가진 게 저장소의 그 파일인지"를 정확히 알 수 있다.
function gitBlobSha(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  } catch (_) {
    return null;
  }
}

async function fetchNovaModList() {
  if (novaModListPromise) return novaModListPromise;
  novaModListPromise = (async () => {
    const saved = store.get("novamod_index") || null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NOVA_MOD_LIST_MS);
    try {
      const headers = { Accept: "application/vnd.github+json", "User-Agent": MODRINTH_UA };
      // 내용이 그대로면 304가 오고, 그건 깃허브 요청 제한에 안 잡힌다
      if (saved?.etag) headers["If-None-Match"] = saved.etag;
      const res = await fetch(NOVA_MOD_LIST_URL, { headers, signal: controller.signal });
      if (res.status === 304 && saved?.items) return saved.items;
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      const items = (Array.isArray(rows) ? rows : [])
        .filter((r) => r?.type === "file" && typeof r.name === "string" && r.name.endsWith(".jar"))
        .map((r) => ({ name: r.name, size: r.size || 0, sha: r.sha || "" }));
      if (!items.length) throw new Error("목록이 비어 있음");
      store.set("novamod_index", { etag: res.headers.get("etag") || "", at: Date.now(), items });
      logToFile(`[노바 모드] 저장소 목록 ${items.length}개 확인`);
      return items;
    } catch (err) {
      logToFile("[노바 모드] 저장소 목록 확인 실패(있던 방식으로 진행): " + (err?.message || err));
      return saved?.items || null; // 예전에 받아둔 목록이라도 있으면 그걸 쓴다
    } finally {
      clearTimeout(timer);
    }
  })();
  return novaModListPromise;
}

// 이 마크 버전용 jar 중 가장 최신(이름순 마지막 = 모드 버전이 높은 쪽)
function pickNovaModEntry(items, mcVersion) {
  const suffix = `+mc${mcVersion}.jar`;
  // 24-230차: 저장소에 옛 노바 이름 jar만 있어도 그건 받지 않는다(Luna's Light 만)
  const matches = (items || []).filter(
    (e) => isLunaModJarName(e.name) && e.name.endsWith(suffix)
  );
  if (!matches.length) return null;
  // 49-207차: 새 이름(lunaslight-)이 있으면 그쪽이 끝(=선택)에 오도록
  matches.sort((a, b) => (modJarRank(a.name) - modJarRank(b.name)) || a.name.localeCompare(b.name, "en", { numeric: true }));
  return matches[matches.length - 1];
}

// 새 이름으로 받았으면, 받은 폴더에 남은 같은 마크 버전의 옛 jar는 지운다(디스크만 먹음)
async function pruneOldNovaModJars(mcVersion, keepName) {
  const dir = path.join(getRoot(), "novamod");
  const suffix = `+mc${mcVersion}.jar`;
  try {
    for (const f of await fsp.readdir(dir)) {
      if (f === keepName) continue;
      if (isModJarName(f) && f.endsWith(suffix)) {
        await fsp.unlink(path.join(dir, f)).catch(() => {});
      }
    }
  } catch (_) {}
}

// 우리가 받은 jar가 저장소의 최신과 같은지 확인(런처를 켠 뒤 버전마다 한 번, HEAD 요청 하나).
// 다르면 새로 받는다. 확인이 안 되면(오프라인 등) 있던 jar를 그대로 쓴다.
const NOVA_MOD_FRESH_CHECKED = new Set();
const NOVA_MOD_HEAD_MS = 6000;
async function refreshNovaModJar(mcVersion, cachedPath) {
  const fileName = path.basename(cachedPath);
  if (NOVA_MOD_FRESH_CHECKED.has(fileName)) return cachedPath;
  NOVA_MOD_FRESH_CHECKED.add(fileName);
  if (path.dirname(cachedPath) !== path.join(getRoot(), "novamod")) return cachedPath; // 설치 파일에 든 jar
  const rec = readNovaModRecord()[fileName];
  if (!rec || !rec.etag) return cachedPath; // 우리가 받은 게 아님(빌드 복사본 등)
  try {
    const st = await fsp.stat(cachedPath);
    if (st.size !== rec.size || Math.abs(st.mtimeMs - rec.mtimeMs) > 2000) return cachedPath; // 누가 바꿈
  } catch (_) {
    return cachedPath;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOVA_MOD_HEAD_MS);
  try {
    const res = await fetch(NOVA_MOD_RAW_BASE + encodeURIComponent(fileName), {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    const etag = res.ok ? res.headers.get("etag") || "" : "";
    if (!etag || etag === rec.etag) return cachedPath;
  } catch (_) {
    return cachedPath;
  } finally {
    clearTimeout(timer);
  }
  try {
    await downloadNovaModJar(mcVersion, fileName, cachedPath);
    logToFile(`[노바 모드] ${mcVersion}용 jar를 새 버전으로 바꿈: ${fileName}`);
  } catch (err) {
    logToFile(`[노바 모드] ${mcVersion}용 새 jar 받기 실패(있던 것 사용): ${err?.message || err}`);
  }
  return cachedPath;
}

async function ensureNovaModJar(mcVersion) {
  const cached = findNovaModJarFor(mcVersion);

  // 24-189차: 저장소 목록을 먼저 본다. 이름을 우리가 만들지 않으므로 모드 버전이 올라가도
  // (런처를 안 고쳐도) 그대로 최신을 집어온다.
  const list = await fetchNovaModList();
  const want = list ? pickNovaModEntry(list, mcVersion) : null;
  if (want) {
    // 49-207차: 이 PC에 새 이름(lunaslight-) jar가 있는데 저장소에는 아직 옛 이름만 있으면 새 것을 쓴다
    if (cached && modJarRank(path.basename(cached)) > modJarRank(want.name)) {
      return cached;
    }
    if (cached && path.basename(cached) === want.name && gitBlobSha(cached) === want.sha) {
      return cached; // 이미 최신 - 설치 파일에 든 jar도 여기서 통과한다
    }
    const destPath = path.join(getRoot(), "novamod", want.name);
    if (fs.existsSync(destPath) && gitBlobSha(destPath) === want.sha) {
      await pruneOldNovaModJars(mcVersion, want.name);
      return destPath;
    }
    // 49-203차(사용자: "26.1.2 실행했는데 왜 우리 모드 적용이 안 됐냐"): 개발 PC에서 방금 빌드한 jar를 저장소의
    // 옛 jar(26.1.2가 228KB짜리 깨진 빌드였음)로 덮어써서 HUD/믹스인이 통째로 빠졌다. 개발 PC 표시(.local-build)가
    // 있고 이 jar가 우리가 받은 게 아니면(기록 없음/기록과 다름) 새로 받지 않고 그대로 쓴다.
    if (fs.existsSync(destPath) && isLocalNovaModBuild(destPath)) {
      logToFile(`[노바 모드] ${mcVersion}용 jar는 이 PC에서 빌드한 것이라 저장소 것으로 바꾸지 않음: ${want.name}`);
      await pruneOldNovaModJars(mcVersion, want.name);
      return destPath;
    }
    if (!novaModDownloadFailed.has(mcVersion)) {
      try {
        await downloadNovaModJar(mcVersion, want.name, destPath);
        NOVA_MOD_FRESH_CHECKED.add(want.name);
        await pruneOldNovaModJars(mcVersion, want.name);
        logToFile(`[노바 모드] ${mcVersion}용 최신 jar 적용: ${want.name}`);
        return destPath;
      } catch (err) {
        logToFile(`[노바 모드] ${mcVersion}용 최신 jar 받기 실패: ${err?.message || err}`);
        // 가지고 있던 게 있으면 그걸로 실행은 계속한다
        if (cached) return cached;
        novaModDownloadFailed.add(mcVersion);
        return null;
      }
    }
    if (cached) return cached;
    return null;
  }

  // 목록을 못 받았을 때(오프라인 등) - 24-189차 이전과 똑같이 동작한다
  if (cached) return refreshNovaModJar(mcVersion, cached);
  if (novaModDownloadFailed.has(mcVersion)) return null;

  const fileName = novaModFileNameFor(mcVersion);
  const destPath = path.join(getRoot(), "novamod", fileName);
  try {
    await downloadNovaModJar(mcVersion, fileName, destPath);
    NOVA_MOD_FRESH_CHECKED.add(fileName);
    return destPath;
  } catch (err) {
    novaModDownloadFailed.add(mcVersion);
    logToFile(`[노바 모드] ${mcVersion}용 jar 다운로드 실패(모드 없이 실행): ${err?.message || err}`);
    return null;
  }
}

// 런처 화면에 짧은 알림을 띄운다(showToast). 창이 아직 없으면 조용히 무시
function notifyRenderer(text, type) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:notice", { text, type: type || "info" });
    }
  } catch (_) {}
}

// 49-207차: 모드 이름이 Luna's Light로 바뀌며 게임 폴더의 데이터 폴더 이름도 바뀌었다(설정 config/lunaslight,
// 통계 이미지 luna-stats, 녹화 luna-clips). 새 모드를 넣을 때 옛 폴더를 새 이름으로 옮겨 설정과 기록을 그대로 이어 쓴다.
// 새 폴더가 이미 있으면 거기에 없는 것만 옮긴다(덮어쓰지 않음). 키 설정(options.txt)의 모드 메뉴 키 이름도 바꾼다.
async function moveDirMerging(src, dst) {
  for (const ent of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (!fs.existsSync(d)) {
      await fsp.rename(s, d);
    } else if (ent.isDirectory()) {
      await moveDirMerging(s, d);
    }
  }
}
// 49-213차: 게임 안 "처음 설정"(글꼴, GUI 크기, 기능 보기, HUD 배경, 마우스 감도, 화면 모드) 기록 - 모드가 런처 폴더에 남긴다.
// 이 파일이 있으면 다른 프로필은 묻지 않고 같은 값을 입히고, 없으면 서버로 켜도 설정부터 띄운다.
function firstSetupPrefsPath() {
  return path.join(getRoot(), "first-setup.json");
}
function readFirstSetupPrefs() {
  try {
    const p = firstSetupPrefsPath();
    if (!fs.existsSync(p)) return null;
    const o = JSON.parse(fs.readFileSync(p, "utf-8"));
    return o && typeof o === "object" ? o : null;
  } catch (_) {
    return null;
  }
}
function hasNewModJar(runRoot) {
  try {
    return fs.readdirSync(path.join(runRoot, "mods")).some(isLunaModJarName);
  } catch (_) {
    return false;
  }
}
async function migrateModDataToLuna(runRoot) {
  const pairs = [
    [path.join(runRoot, "config", "novaclient"), path.join(runRoot, "config", "lunaslight")],
    // 49-212차: 통계 내보내기/녹화 폴더 이름에서 루나/노바를 뺐다(stats-export, clips)
    [path.join(runRoot, "nova-stats"), path.join(runRoot, "stats-export")],
    [path.join(runRoot, "luna-stats"), path.join(runRoot, "stats-export")],
    [path.join(runRoot, "nova-clips"), path.join(runRoot, "clips")],
    [path.join(runRoot, "luna-clips"), path.join(runRoot, "clips")],
  ];
  for (const [src, dst] of pairs) {
    try {
      if (!fs.existsSync(src)) continue;
      if (!fs.existsSync(dst)) {
        await fsp.rename(src, dst);
      } else {
        await moveDirMerging(src, dst);
      }
      logToFile(`[노바 모드] 데이터 폴더 옮김: ${path.relative(runRoot, src)} -> ${path.relative(runRoot, dst)}`);
    } catch (err) {
      logToFile(`[노바 모드] 데이터 폴더 옮기기 실패(${path.relative(runRoot, src)}): ` + (err?.message || err));
    }
  }
  try {
    const opt = path.join(runRoot, "options.txt");
    if (fs.existsSync(opt)) {
      const t = await fsp.readFile(opt, "utf-8");
      if (t.includes("key_key.novaclient.")) {
        await fsp.writeFile(opt, t.split("key_key.novaclient.").join("key_key.lunaslight."), "utf-8");
      }
    }
  } catch (_) {}
}

async function syncNovaMod(mcVersion, runRoot) {
  try {
    const destDir = path.join(runRoot, "mods");
    await fsp.mkdir(destDir, { recursive: true });

    // 24-92차: 캐시에 없으면 여기서 받아옴(못 받으면 null - 아래에서 조용히 건너뜀)
    const srcPath = await ensureNovaModJar(mcVersion);
    const wantedName = srcPath ? path.basename(srcPath) : null;

    // 다른 버전용/옛날 노바 모드 jar가 남아있으면 정리 (버전을 바꿔 실행하거나 런처를
    // 업데이트했을 때 두 개가 중복 로드되는 사고 방지)
    const existing = (await fsp.readdir(destDir)).filter(
      (f) => isModJarName(f) && f !== wantedName
    );
    for (const f of existing) {
      await fsp.unlink(path.join(destDir, f)).catch(() => {});
    }

    if (!srcPath) {
      // 24-133차: "우리 전용 모드가 안껴져있었어" - 여기서 조용히 넘어가는 바람에 노바 모드가
      // 빠진 채로 게임이 켜져도 아무도 몰랐음. 이제 런처 화면에도 알린다.
      logToFile(`[노바 모드] ${mcVersion}용 jar를 찾지도 받지도 못해 주입을 건너뜀`);
      notifyRenderer(
        `Nova 전용 모드(${mcVersion})를 넣지 못했어요. 인터넷 연결을 확인해주세요.`,
        "error"
      );
      return;
    }

    const destPath = path.join(destDir, wantedName);
    let needCopy = true;
    try {
      const [s1, s2] = await Promise.all([fsp.stat(srcPath), fsp.stat(destPath)]);
      // 49-38차: 크기만 비교하면 크기가 같은 새 빌드가 안 들어감 - 원본이 더 새것이면(수정 시각) 복사
      needCopy = s1.size !== s2.size || s1.mtimeMs > s2.mtimeMs + 1000;
    } catch (_) {
      needCopy = true;
    }
    if (needCopy) {
      await fsp.copyFile(srcPath, destPath);
      logToFile(`[노바 모드] 주입: ${wantedName} (from ${srcPath})`);
    }
    if (isLunaModJarName(wantedName)) {
      await migrateModDataToLuna(runRoot);
    }
  } catch (err) {
    // 내장 모드 주입이 실패해도 게임 실행 자체는 막지 않음
    logToFile("[노바 모드] 주입 실패(실행은 계속함): " + (err?.message || err));
  }
}

async function ensureDirs() {
  await fsp.mkdir(getRoot(), { recursive: true });
  await fsp.mkdir(getRuntimeDir(), { recursive: true });
  await fsp.mkdir(path.join(getRoot(), "mods"), { recursive: true });
  await fsp.mkdir(path.join(getRoot(), "versions"), { recursive: true });
  await fsp.mkdir(path.join(getRoot(), "logs"), { recursive: true });
}

// 설정 화면에서 정한 값(언어/밝기/전체화면)을 매번 실행할 때마다 options.txt에 반영합니다.
// (다른 설정 줄들은 그대로 두고, 이 몇 줄만 덮어씁니다)
// 24-37차: "GUI 크기/음량을 게임 안에서 바꿔도 계속 고정된 값으로 돌아온다" - guiScale과
// 마스터/음악 음량은 런처 설정 화면에 대응하는 UI 자체가 없는데도 매 실행마다 강제로 같은
// 값으로 덮어써지고 있어서, 게임 안 옵션에서 직접 바꿔도 다음 실행 때 무조건 초기화되던
// 문제였음. 이 세 항목은 이제 upsert(항상 덮어씀) 대신 upsertIfMissing(옵션 파일에 그
// 항목이 아직 없을 때, 즉 최초 실행일 때만 기본값을 넣어줌)으로 바꿔서, 한 번 만들어진
// 뒤에는 게임 안에서 바꾼 값을 그대로 유지함. lang/gamma/fullscreen은 런처 쪽에 대응하는
// 확실한 정책(항상 한국어, 항상 밝기 100%, 설정 화면의 전체화면 토글)이 있어서 그대로 둠.
async function applyConfiguredOptions(targetRoot, fullscreenOverride) {
  const s = getSettings();
  const root = targetRoot || getRoot();
  const fullscreen = fullscreenOverride !== undefined ? fullscreenOverride : s.mcFullscreen;
  const optionsPath = path.join(root, "options.txt");

  let lines = [];
  if (fs.existsSync(optionsPath)) {
    lines = (await fsp.readFile(optionsPath, "utf-8"))
      .split("\n")
      .filter((l) => l.trim().length > 0);
  }

  const upsert = (key, value) => {
    const line = `${key}:${value}`;
    const idx = lines.findIndex((l) => l.startsWith(key + ":"));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  };

  const upsertIfMissing = (key, value) => {
    const idx = lines.findIndex((l) => l.startsWith(key + ":"));
    if (idx < 0) lines.push(`${key}:${value}`);
  };

  upsert("lang", "ko_kr");
  upsert("gamma", "1.0"); // 밝기는 항상 100%로 고정
  upsert("fullscreen", fullscreen ? "true" : "false");
  upsertIfMissing("guiScale", "3"); // 최초 실행 시 기본값만, 이후엔 게임 안에서 바꾼 값 유지
  upsertIfMissing("soundCategory_master", "0.5"); // 최초 실행 시 기본값만
  upsertIfMissing("soundCategory_music", "0.2"); // 최초 실행 시 기본값만

  await fsp.writeFile(optionsPath, lines.join("\n") + "\n", "utf-8");

  // 24-147차: 활성화해둔 리소스팩/쉐이더팩을 실제로 게임에 켜줌(설정에서 끌 수 있음)
  // 24-225차: 설정 칸을 없앴으니 예전에 꺼둔 사람도 늘 켜진 것으로 본다
  if (true) {
    await applyEnabledPacks(root).catch((err) =>
      logToFile("[팩 자동 적용] 실패(실행은 계속함): " + (err?.message || err))
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 24-147차: 프로필에서 "활성화"해둔 리소스팩/쉐이더팩을 게임이 실제로 쓰도록 적어줌.
//  · 리소스팩: options.txt 의 resourcePacks 에 파일 이름들을 넣음(ensureResourcePacksEnabled)
//  · 쉐이더팩: Iris/Oculus 가 읽는 config/iris.properties, config/oculus.properties 에
//             shaderPack 과 enableShaders 를 적음. 둘 다 써도 서로 방해하지 않음
// "활성화"는 파일 이름에 .disabled 가 붙었는지로 판단함(profiles:toggle-file 과 같은 규칙).
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// 24-150차: "클라에서 리소스팩 끄면 게임 켰을 때 자동으로 안 껴지는 게 아니라, 아예 리팩이
// 인게임 목록에서 없어진다" - 지금까지 목록의 "비활성화"는 파일 이름 뒤에 .disabled 를
// 붙이는 방식이었다. 모드(.jar)는 Fabric 이 실제로 안 읽어야 하니 그게 맞지만, 리소스팩/
// 쉐이더팩은 그러면 마인크래프트가 파일 자체를 못 봐서 게임 안 목록에서도 통째로 사라진다.
// -> 팩은 파일 이름을 건드리지 않고 프로필 폴더의 .nova-packs-off.json 으로만 관리한다.
//    끈 팩도 게임 목록에는 그대로 보이고, 자동 적용(options.txt / iris.properties)에서만 빠진다.
// ────────────────────────────────────────────────────────────────────────────
const PACK_OFF_FILE = ".nova-packs-off.json";
const PACK_KINDS = new Set(["resourcepacks", "shaderpacks"]);

async function readPackOff(profileRoot) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(profileRoot, PACK_OFF_FILE), "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch (_) {
    return {};
  }
}

async function getPackOffList(profileRoot, kind) {
  const data = await readPackOff(profileRoot);
  return Array.isArray(data[kind]) ? data[kind] : [];
}

async function setPackOffList(profileRoot, kind, list) {
  const data = await readPackOff(profileRoot);
  data[kind] = Array.from(new Set(list));
  await fsp
    .writeFile(path.join(profileRoot, PACK_OFF_FILE), JSON.stringify(data, null, 2), "utf-8")
    .catch((err) => logToFile("[팩 목록] 저장 실패: " + (err?.message || err)));
}

// 예전 방식으로 .disabled 가 붙어 있던 팩은 파일 이름을 되돌리고 off 목록으로 옮긴다.
// (한 번만 일어나면 되지만, 여러 번 돌아도 아무 일도 안 하므로 목록을 볼 때마다 호출함)
async function migratePackDisabledNames(profileRoot, kind) {
  if (!PACK_KINDS.has(kind)) return;
  const dir = path.join(profileRoot, kind);
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch (_) {
    return;
  }
  const off = await getPackOffList(profileRoot, kind);
  let changed = false;
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".disabled")) continue;
    const base = f.slice(0, -".disabled".length);
    try {
      if (!fs.existsSync(path.join(dir, base))) {
        await fsp.rename(path.join(dir, f), path.join(dir, base));
      }
      const meta = await readModMeta(profileRoot, kind);
      if (meta[f]) {
        meta[base] = meta[f];
        delete meta[f];
        await writeModMeta(profileRoot, kind, meta);
      }
      if (!off.includes(base)) {
        off.push(base);
        changed = true;
      }
      logToFile(`[팩 목록] .disabled 이름 되돌림: ${kind}/${base} (끈 상태로 기록)`);
    } catch (err) {
      logToFile("[팩 목록] 이름 되돌리기 실패: " + (err?.message || err));
    }
  }
  if (changed) await setPackOffList(profileRoot, kind, off);
}

async function listEnabledPackFiles(dir, exts, offList) {
  try {
    const files = await fsp.readdir(dir);
    const off = offList || [];
    return files.filter((f) => {
      const lower = f.toLowerCase();
      if (lower.endsWith(".disabled")) return false; // 아직 안 옮겨진 옛날 파일 방어
      if (off.includes(f)) return false;             // 24-150차: 런처에서 꺼둔 팩
      return exts.some((e) => lower.endsWith(e));
    });
  } catch (_) {
    return [];
  }
}

async function applyEnabledPacks(runRoot) {
  // 24-150차: 끈 팩은 파일을 숨기지 않고 이 목록으로만 걸러낸다(게임 목록에는 그대로 보임)
  await migratePackDisabledNames(runRoot, "resourcepacks");
  await migratePackDisabledNames(runRoot, "shaderpacks");
  const rpOff = await getPackOffList(runRoot, "resourcepacks");
  const shOff = await getPackOffList(runRoot, "shaderpacks");

  // ── 리소스팩
  const rpDir = path.join(runRoot, "resourcepacks");
  const packs = await listEnabledPackFiles(rpDir, [".zip"], rpOff);
  // 폴더 형태 리소스팩도 지원(압축을 푼 채로 넣어두는 사람이 있음)
  try {
    for (const e of await fsp.readdir(rpDir, { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        !e.name.toLowerCase().endsWith(".disabled") &&
        !rpOff.includes(e.name) &&
        !packs.includes(e.name)
      ) {
        packs.push(e.name);
      }
    }
  } catch (_) {}
  // 항상 기록함 - 활성화된 팩이 하나도 없으면 빈 목록을 써서 "켜져 있던 걸 끔"도 반영됨
  await ensureResourcePacksEnabled(packs, runRoot);

  // ── 쉐이더팩 (Iris / Oculus)
  const shaderDir = path.join(runRoot, "shaderpacks");
  const shaders = await listEnabledPackFiles(shaderDir, [".zip"], shOff);
  try {
    for (const e of await fsp.readdir(shaderDir, { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        !e.name.toLowerCase().endsWith(".disabled") &&
        !shOff.includes(e.name) &&
        !shaders.includes(e.name)
      ) {
        shaders.push(e.name);
      }
    }
  } catch (_) {}

  const configDir = path.join(runRoot, "config");
  await fsp.mkdir(configDir, { recursive: true });
  // 쉐이더는 한 번에 하나만 켤 수 있음 - 활성화된 것 중 첫 번째를 씀
  const picked = shaders[0] || null;
  for (const fileName of ["iris.properties", "oculus.properties"]) {
    const target = path.join(configDir, fileName);
    let lines = [];
    try {
      lines = (await fsp.readFile(target, "utf-8")).split("\n").filter((l) => l.trim().length > 0);
    } catch (_) {}
    const put = (key, value) => {
      const idx = lines.findIndex((l) => l.startsWith(key + "="));
      const line = `${key}=${value}`;
      if (idx >= 0) lines[idx] = line;
      else lines.push(line);
    };
    put("enableShaders", picked ? "true" : "false");
    if (picked) put("shaderPack", picked);
    await fsp.writeFile(target, lines.join("\n") + "\n", "utf-8").catch(() => {});
  }

  logToFile(
    `[팩 자동 적용] 리소스팩 ${packs.length}개, 쉐이더 ${picked ? `"${picked}"` : "없음"} -> ${runRoot}`
  );
}

function logToFile(line) {
  try {
    const logPath = path.join(getRoot(), "logs", "launcher.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch (_) {
    /* 로그 실패는 무시 */
  }
}

// ----------------------------------------------------------------------------
// 스플래시(로딩) 창 - 투명/프레임 없음, 뒤 배경이 비침
// ----------------------------------------------------------------------------
let splashWindow = null;
let splashShownAt = 0;

// 24-57차: "N★VA CLIENT 워드마크가 잘려서 보인다" - 24-55차에서 splash.html의 카드를
// 세로형(296x336)에서 가로형(432x216)으로 바꾸면서 이 창도 같이 456x240으로 키웠어야
// 했는데, 그 수정이 실제로는 반영되지 않은 채(경위는 프로젝트 문서 참고) 예전 크기
// (320x360)로 남아있던 게 잘림의 직접 원인이었음. 게다가 그 456x240이라는 값 자체도
// 샌드박스의 대체 폰트로 잰 폭이라 실제 기기의 SUIT 폰트 폭과 다를 수 있어, 고정 픽셀을
// 또 추측해서 넣는 방식은 같은 문제가 재발할 여지가 있음(이미 두 번째임).
// 그래서 이제 창 크기를 미리 추측하지 않고, splash.html이 실제 폰트로 다 그려진 뒤
// 자기 카드(.splash-card)의 진짜 렌더링 크기를 재서 "splash:size" IPC로 보고하면
// 그 실측값(+아주 약간의 여유)에 맞춰 이 창을 그 때 가서 리사이즈 + 화면 정중앙 배치하고,
// 그 다음에야 보여주는 방식으로 바꿈 - 실제 폰트 폭이 얼마든 잘릴 수가 없음.
// width/height 값은 그 보고가 오기 전까지, 또는(스크립트 오류 등으로) 끝내 안 왔을 때
// 타임아웃 폴백으로 쓰이는 기본값일 뿐, 최종 크기를 보장하지 않음(기존 app:boot-ready의
// BOOT_READY_TIMEOUT_MS와 같은 "무한정 기다리지 않고 일정 시간 뒤 그냥 진행" 패턴 재사용).
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 456,
    height: 240,
    // 24-115차: "처음에 클라 켤 때 이거 이렇게 떠"(작업표시줄에 일렉트론 기본 원자 아이콘)
    // 로딩 화면 창에만 icon이 없어서, 메인 창이 뜨기 전까지 작업표시줄에 Electron 기본
    // 아이콘이 보였음. 메인 창(createWindow)과 같은 앱 아이콘을 지정함.
    icon: path.join(__dirname, "build", "icon.png"),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "src", "preload-splash.js"),
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadFile(path.join(__dirname, "src", "splash.html"));

  let splashSized = false;
  const showSplashSizedAt = (width, height) => {
    if (splashSized || !splashWindow || splashWindow.isDestroyed()) return;
    splashSized = true;
    try {
      // 여러 모니터 환경도 고려해서, 창이 뜨는 시점의 마우스 커서가 있는 모니터를
      // 기준으로 정중앙에 배치함(그 모니터가 곧 유저가 보고 있을 확률이 가장 높은 화면)
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const area = display.workArea;
      const w = Math.max(200, Math.round(width));
      const h = Math.max(120, Math.round(height));
      const x = Math.round(area.x + (area.width - w) / 2);
      const y = Math.round(area.y + (area.height - h) / 2);
      splashWindow.setBounds({ x, y, width: w, height: h });
    } catch (err) {
      logToFile("스플래시 창 크기 조정 실패, 기본 크기로 표시: " + (err?.message || err));
    }
    splashWindow.show();
    splashShownAt = Date.now();
  };

  // splash.html의 reportSplashSize(w, h) → preload-splash.js → 여기로 들어옴(1회성 보고)
  ipcMain.once("splash:size", (_e, width, height) => showSplashSizedAt(width, height));

  splashWindow.once("ready-to-show", () => {
    // 1.2초 안에 실측 보고가 안 오면(스크립트 오류, 폰트 로딩 지연 등) 기본 크기로라도
    // 보여줌 - showSplashSizedAt은 splashSized 플래그로 한 번만 실행되므로, 보고가 이미
    // 처리된 뒤 이 타임아웃이 나중에 발동해도 아무 일도 일어나지 않아 안전함
    setTimeout(() => showSplashSizedAt(456, 240), 1200);
  });
}

// 24-35차: "처음에 로딩시간 무조건 걸어둔 거 그 시간 없애고 그 시간에 마크 계정 로딩해봐" -
// 예전엔 스플래시가 실제 로딩 상황과 무관하게 무조건 최소 3.2초는 떠 있었음(아래
// createWindow의 옛 MIN_SPLASH_MS - 순전히 "너무 빨리 사라지면 허전해 보인다"는 연출용
// 강제 대기였고, 그동안 실제로는 아무 일도 안 하고 그냥 기다리기만 했음). 이제 그 고정
// 대기를 없애고, 렌더러가 시작하자마자 실제로 하고 있는 일(사이트 계정 확인 + 마인크래프트
// 계정 자동 로그인 - renderer.js 맨 위 boot-gate IIFE, notifyBootReady 참고)이 끝났다는
// 신호를 받을 때까지만 스플래시를 붙잡아두는 방식으로 바꿈 - "가짜로 기다리는 시간"을
// "실제로 계정을 불러오는 시간"으로 바꿔치기하는 것. 신호가 영영 안 오는 경우(렌더러 쪽
// 예상 못 한 오류 등)에 화면이 무한 로딩으로 멈추지 않도록 안전 타임아웃을 같이 둠.
let rendererBootReady = false;
let resolveBootReady = null;
const bootReadyPromise = new Promise((resolve) => {
  resolveBootReady = resolve;
});
const BOOT_READY_TIMEOUT_MS = 8000;
ipcMain.on("app:boot-ready", () => {
  rendererBootReady = true;
  resolveBootReady?.();
});

// 24-54차: "3D 스킨이 가끔 안 뜬다" 진단용 - skinview3d 로드/텍스처 조회 관련 렌더러 쪽
// 진단 로그(mountSkinViewer의 window.nova.logClient 호출)를 그대로 로그 파일에도 남겨서,
// 유저 PC에서만 재현되는 문제를 로그 파일만 보고도 파악할 수 있게 함(preload.js의
// logClient 브리지 → 여기로 들어옴)
ipcMain.on("log:client", (_e, line) => {
  logToFile("[렌더러] " + String(line));
});

// ----------------------------------------------------------------------------
// 메인 창 생성 (프레임 없는 창 + 자체 타이틀바 -> 초록/깔끔 테마는 src/style.css)
// ----------------------------------------------------------------------------
let mainWindow = null;
// 17차 신규, 24-42차: "클라이언트가 오른쪽 아래 이런 리스트(Windows 작업표시줄 알림 영역/숨겨진
// 아이콘 목록)에 뜨게 해줘" - 이전엔 백그라운드 실행 설정일 때만 생기던 트레이 아이콘을,
// 이제 앱이 켜져 있는 동안(창이 보이든 숨겨져 있든) 항상 떠 있도록 바꿈(아래 app.whenReady()
// 참고) - 디스코드/지포스 익스피리언스 등 다른 상주 프로그램들과 같은 자리에 항상 표시됨
let appTray = null;
let currentAbortController = null; // 다운로드 중단용
let gameProcess = null;
// 24-93차: "복제 실행"(launch:start-duplicate)이 준비 중인 개수. 준비 도중에 프로필 폴더
// 이름이 바뀌면 이미 계산해둔 경로로 모드를 복사하다 깨지므로 applyProfileFolderName()이 봄.
let duplicateLaunchesInFlight = 0;

// 24-149차: "프로필 바꾸면 추가 실행이 아니라 PLAY가 떠야 하는데 안그러고, 2개 켜놓고 하나
// 끄면 PLAY가 뜨고" - 지금까지 렌더러는 isInGame 이라는 참/거짓 하나만 보고 버튼 글자를
// 정했다. 그래서 (1) A 프로필이 켜져 있는데 목록에서 B를 골라도 계속 "추가 실행하기"가 뜨고,
// (2) 두 개를 켜놓고 하나만 꺼도 launch:game-closed 한 번에 곧바로 "PLAY"로 돌아갔다.
// 메인 실행과 추가 실행을 여기 한 곳에서 pid 단위로 같이 추적하고, 바뀔 때마다 렌더러에
// 현재 목록을 통째로 알려준다(launch:running-changed).
const runningInstances = new Map(); // pid -> { profileId, mode }

function getRunningState() {
  // 24-154차: proc 은 렌더러로 못 보내므로(직렬화 불가) 빼고 보낸다. startedAt 은 "가장 먼저
  // 켠 순서대로 종료"(launch:stop-oldest)와 버튼 표시에 쓰임
  const instances = [];
  for (const [pid, info] of runningInstances) {
    // 24-194차: serverId 도 같이 - 목록에서 "지금 이 서버로 플레이 중"을 표시하려면
    // mode:"server" 만으로는 어느 서버인지 알 수 없다.
    instances.push({
      pid,
      profileId: info.profileId,
      serverId: info.serverId || null,
      mode: info.mode,
      startedAt: info.startedAt,
    });
  }
  instances.sort((a, b) => a.startedAt - b.startedAt);
  return { count: instances.length, instances };
}

function broadcastRunningState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("launch:running-changed", getRunningState());
  } catch (_) {}
}

function registerRunningInstance(proc, info) {
  const pid = proc && proc.pid;
  if (!pid) return null;
  runningInstances.set(pid, {
    profileId: info?.profileId || null,
    serverId: info?.serverId || null, // 24-194차
    mode: info?.mode === "server" ? "server" : "profile",
    startedAt: Date.now(),
    proc,
  });
  broadcastRunningState();
  return pid;
}

// ----------------------------------------------------------------------------
// 24-193차: "게임 실행중에는 런처를 꺼도 완전 종료가 아니고 창만 안보이게 하고 다시 실행하면
//            그 창이 뜨게 해줘 마크를 꺼도 런처가 뜨게 해주고"
//
// 예전엔 X 버튼이 무조건 완전 종료였다(window:close -> mainWindow.close() ->
// window-all-closed -> app.quit()). 게임을 켜둔 채로 런처를 치우고 싶어서 X를 누르면
// 런처가 통째로 죽어서, 게임이 끝난 뒤 친구/코인/플레이타임 같은 게 하나도 안 돌아갔다.
// 이제 게임이 켜져 있는 동안의 X 는 "숨기기"다. 다시 꺼내는 길은 세 가지 - 트레이
// 아이콘, 바탕화면 아이콘을 다시 누르기(second-instance), 그리고 게임이 꺼지는 순간.
// ----------------------------------------------------------------------------
let isReallyQuitting = false; // before-quit 이 올려줌. 이게 true 면 X 도 그냥 종료한다.

function anyGameRunning() {
  return runningInstances.size > 0 || !!(gameProcess && gameProcess.pid);
}

function showMainWindowNow() {
  // 강제 업데이트 중엔 어떤 경로로도 메인 창이 다시 나타나면 안 됨(24-66차)
  if (isForcedUpdating) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  try {
    appTray?.setToolTip("Nova Client");
  } catch (_) {}
}

// 게임이 꺼진 직후. 바로 띄우지 않고 한 박자 쉬는 이유: 미뤄뒀던 강제 업데이트가 있으면
// 이 직후에 업데이트 창이 뜨는데, 그 앞에 메인 창이 한 번 깜빡이면 안 되기 때문이다.
function showMainWindowAfterGame() {
  setTimeout(() => {
    if (isForcedUpdating || pendingForcedInstallAfterGame) return;
    if (anyGameRunning()) return; // 그 사이 또 켰으면 그대로 둔다
    showMainWindowNow();
  }, 400);
}

function unregisterRunningInstance(pid) {
  if (!pid) return;
  if (runningInstances.delete(pid)) {
    broadcastRunningState();
    // 24-193차: 마지막 게임이 꺼지면 숨겨둔 창을 다시 띄운다. 여기에 두면 "추가 실행"으로
    // 켠 게임이 마지막이었던 경우도 같이 처리된다(예전엔 메인 실행 쪽에서만 창을 띄웠다).
    if (runningInstances.size === 0 && !gameProcess) showMainWindowAfterGame();
  }
}

// 게임을 켜는 중이거나 켜져 있으면 프로필 폴더 이름을 옮기지 않음(다음 기회로 미룸).
//  · currentAbortController: launch:start가 준비를 시작할 때 만들고 끝나면(finally) 비움
//  · gameProcess: 게임이 켜져 있는 동안
//  · duplicateLaunchesInFlight: 복제 실행 준비 중
// 복제 실행으로 켜진 게임 자체는 따로 추적하지 않지만, Windows는 안의 파일이 열려 있는
// 폴더의 이름을 바꿔주지 않으므로(renameSync가 실패) 결과적으로 안전합니다.
function isProfileFolderBusy() {
  return !!gameProcess || !!currentAbortController || duplicateLaunchesInFlight > 0;
}
// 24-14차: "게임 X 눌러서 종료하거나 Stop 눌러서 종료할 때 크래시 떴다고" - 유저가 직접
// 끈 경우를 표시해두는 플래그. launch:stop이 별도 IPC 핸들러라 launch:start 안의
// 지역 변수(weLaunchedThis 등)와 공유가 안 돼서 모듈 전역에 둠
let stoppedByUser = false;

// 24-66차 신규: "클라이언트 시작할 때 업데이트 정보를 확인해서 만약 필요하면 업데이트 강제해줘
// 이제부터는 그리고 업데이트중일 때 런처 실행 안되게 해주고" - 새 버전이 감지된 순간부터
// 설치가 끝나서 앱이 재시작되기 전까지 true. 이 동안엔 새 게임 실행(launch:start)을 막고,
// 트레이/중복 실행으로 메인 창을 다시 꺼내는 것도 막아서 "예전 버전으로 계속 쓰기"를 원천
// 차단함(setupAutoUpdate/launch:start/tryShowMainWindowFromTray/second-instance 참고).
let isForcedUpdating = false;
// 강제 업데이트가 감지된 시점에 이미 게임이 실행 중이었다면, 플레이 세션을 강제로 끊는 건
// 너무 파괴적이라 설치를 게임이 끝날 때까지 미룸 - 그동안은 다운로드만 조용히 먼저 받아둠
// (isForcedUpdating은 계속 true라서 "추가로 새로 켜는 것"은 여전히 막힘). 게임이 끝나면
// launcher.on("close")가 이 플래그를 보고 마저 설치를 진행함.
let pendingForcedInstallAfterGame = false;

// 24-67차 신규: "친구 접속 정보 업로드" - 게임이 켜져 있는 동안 site_presence에 지금 어느
// 서버에 있는지(server_address/server_name)와 어떤 마인크래프트 계정으로 접속했는지(mc_name)를
// 주기적으로 올려서, 친구 목록(런처)과 게임 안 소셜 화면(Nova-Mod) 양쪽에서 "친구가 지금
// 어디 있는지"를 정확히 볼 수 있게 함. sql/2026-09-08_site_presence_game_info.sql 실행 필요
// (site_presence에 컬럼 3개 신규 추가). 인게임(모드) 쪽은 사용자가 별도로 작업 중이라 이번엔
// 런처 쪽만 구현함 - startPresenceUpload/stopPresenceUpload/readModPresenceFile 참고.
let presenceUploadTimer = null;
let presenceFileWarned = false; // .nova-presence.json 읽기 실패를 매번 로그에 남기지 않기 위한 1회성 플래그

// 17차 신규: 트레이 아이콘 생성(한 번만) - "왼쪽 아래" 요청은 Windows에서 트레이 아이콘 위치를
// 앱이 직접 지정할 수 없어서(항상 작업표시줄 알림 영역=우측 하단) 표준 위치인 우측 하단에 표시함
// 24차: "만약 백그라운드 실행중이라면 여기 뜨게 해주고 우클릭 눌러서 쓰기, 키기 등 할 수 있게
// 해줘" - (1) 아이콘을 nativeImage로 직접 16x16로 축소해서 넣음: Windows 알림 영역은 아이콘을
// 아주 작게 그리는데, 원본 큰 PNG를 그대로 넘기면 트레이 구현체마다 리샘플링 품질이 들쭉날쭉
// 하거나(흐릿하게 뭉개짐) 드물게 초기화가 실패하는 경우가 있어서, 미리 정확한 크기로 만들어
// 넘기는 쪽이 더 안정적임. (2) 메뉴를 열 때마다 다시 만들어서(rebuildMenu) 그 순간의 창
// 보임/숨김 상태를 반영한 "보이기"/"숨기기" 토글 항목을 보여주고, 하나뿐이던 "완전히 종료"
// 옆에 상태를 확인할 수 있게 함
// 24-42차: "클라이언트가 오른쪽 아래 이런 리스트에 뜨게 해줘"(작업표시줄 숨겨진 아이콘 목록
// 스크린샷 첨부) - 이전엔 백그라운드 실행 설정(마크 실행 시 동작=백그라운드/완전종료, 또는
// --background 자동시작)일 때만 ensureTray()가 호출돼서, 창을 보통처럼 띄워두고 쓰는 가장
// 흔한 경우엔 트레이 아이콘이 아예 없었음. app.whenReady()에서 무조건 한 번 호출하도록 바꿔서
// (아래 참고), 창이 보이든 숨겨져 있든 앱이 실행되는 동안은 항상 이 목록에 떠 있게 함 - 다른
// 백그라운드 상주 프로그램들(디스코드, 지포스 익스피리언스 등)과 같은 자리에 같은 방식으로
// 표시됨. X 버튼을 누르면 여전히 완전히 종료됨(기존 동작 그대로, 이 라운드에서 안 건드림) -
// 트레이는 "떠 있는 동안 우클릭/좌클릭으로 창을 숨기고 다시 꺼낼 수 있는" 용도일 뿐, 닫기
// 버튼의 동작 자체를 트레이로 최소화하도록 바꾼 건 아님
// 24-66차 신규: 트레이 좌클릭/메뉴의 "보이기/숨기기" 둘 다 이 헬퍼로 통일 - 강제 업데이트
// 중이면 메인 창 대신 업데이트 진행 창을 앞으로 가져옴("백그라운드에 남아있는 문제 없도록
// 철저하게 막아줘" - 업데이트 중엔 어떤 경로로도 메인 창이 다시 나타나면 안 됨).
function tryShowMainWindowFromTray() {
  if (isForcedUpdating) {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.show();
      updateWindow.focus();
    }
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}
function buildTrayMenu() {
  const isVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  return Menu.buildFromTemplate([
    {
      label: isForcedUpdating ? "업데이트 설치 중..." : isVisible ? "Nova Client 숨기기" : "Nova Client 보이기",
      click: tryShowMainWindowFromTray,
    },
    { type: "separator" },
    {
      label: "완전히 종료",
      click: () => {
        appTray?.destroy();
        appTray = null;
        app.quit();
      },
    },
  ]);
}
function ensureTray() {
  if (appTray && !appTray.isDestroyed()) return appTray;
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
    if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16, quality: "best" });
    appTray = new Tray(icon);
    // 24-42차: 이제 트레이가 백그라운드 상태에서만 뜨는 게 아니라 항상 떠 있으므로,
    // "백그라운드에서 실행 중"이라고 고정 표시하면 창을 보통처럼 띄워둔 상태에서도
    // 오해를 줄 수 있어 일반적인 이름으로 바꿈(다른 상주 프로그램들의 툴팁과 같은 방식)
    appTray.setToolTip("Nova Client");
    appTray.setContextMenu(buildTrayMenu());
    // 우클릭(Windows 기본 트레이 메뉴 트리거)은 setContextMenu가 자동으로 처리해주지만, 그 전에
    // 매번 메뉴를 새로 만들어서 "보이기"/"숨기기" 라벨이 항상 지금 창 상태와 맞게 함
    appTray.on("right-click", () => {
      appTray?.setContextMenu(buildTrayMenu());
    });
    appTray.on("click", tryShowMainWindowFromTray);
  } catch (err) {
    logToFile("트레이 아이콘 생성 실패: " + (err?.message || err));
  }
  return appTray;
}

// 17차 신규: 마크 실행 성공 직후, 설정에 따라 런처 창을 어떻게 할지 처리
function applyOnLaunchBehavior() {
  const behavior = getSettings().onLaunchBehavior || "stay";
  if (behavior === "background") {
    ensureTray();
    mainWindow?.hide();
  } else if (behavior === "quit") {
    ensureTray(); // 게임은 계속 실행되므로, 혹시 몰라 트레이는 남겨서 나중에 런처를 다시 열 수 있게 함
    try {
      gameProcess?.unref?.(); // 런처 프로세스가 끝나도 게임 자식 프로세스는 계속 살아있도록
    } catch (_) {}
    logToFile("설정(마크 실행 시 동작=완전 종료)에 따라 런처를 종료합니다. 게임 프로세스는 계속 실행됩니다.");
    setTimeout(() => app.quit(), 300); // 위 IPC 응답이 렌더러에 확실히 전달된 다음 종료
  }
  // "stay"는 아무것도 안 함(기존과 동일하게 창을 그대로 켜둠)
}

// 17차 신규: 컴퓨터 시작 시 자동 실행 설정 적용
function applyAutostartSetting() {
  if (process.platform === "linux") return; // 리눅스는 setLoginItemSettings 미지원
  const mode = getSettings().autostartMode || "no";
  try {
    app.setLoginItemSettings({
      openAtLogin: mode !== "no",
      args: mode === "background" ? ["--background"] : [],
    });
  } catch (err) {
    logToFile("자동 시작 설정 적용 실패: " + (err?.message || err));
  }
}
// 15차 신규(퀘스트): 게임이 실제로 켜진 시각을 기록해뒀다가, 꺼질 때 경과 시간을 재서
// 일일/주간 퀘스트 플레이타임에 더함 (서버/프로필 모드 둘 다 "런처를 통한 플레이"로 포함)
let questSessionStartedAt = null;

// 23차 버그 수정: "전체화면이 창화면 최대크기를 말한 거였는데 ;;" - 19~21차 내내 이 버튼을
// Electron의 OS 레벨 전체화면(setFullScreen/enter-full-screen/leave-full-screen, F11 눌렀을
// 때처럼 창틀 자체가 없어지는 모드)으로 다루고 있었는데, 사용자가 말한 "전체화면"은 사실
// 일반적인 창 최대화(윈도우 오른쪽 위 네모 버튼, maximize/unmaximize) 버튼이었음. 그래서
// 그동안의 "전체화면 해제하면 원래 크기로 안 돌아온다" 수정들은 전부 엉뚱한 이벤트를 붙잡고
// 있었던 것 - setFullScreen 계열은 이 창처럼 resizable:false로 고정한 창과 궁합이 안 좋아서
// 해제 후 크기 복원이 들쭉날쭉했고, 그걸 60/200/450/800ms 지연 setBounds 여러 번으로 억지로
// 땜질하고 있었음. 진짜 최대화(maximize/unmaximize)는 Windows/Electron이 이전 창 크기+위치를
// 알아서 기억했다가 그대로 복원해주므로, 이런 수동 보정이 아예 필요 없음
// 23차: 위 createWindow 상단 주석 참고 - "전체화면" 버튼/단축키가 실제로 하는 일은 항상
// 이 창 최대화 토글이었음. F11 핸들러와 아래 IPC 핸들러(window:toggle-fullscreen)가 똑같은
// 동작을 하므로 공용 함수로 뺌
// 24-104차: "클라이언트 전체화면 했다가 다시 누르면 전 화면이 아니라 무조건 처음 크기로
// 돌려놔줘" - Windows가 기억한 "직전 크기"(드래그·스냅 등으로 바뀐 크기일 수 있음) 대신 항상
// 처음 크기(1280x800)로, 지금 창이 있는 모니터의 작업 영역 가운데로 되돌림. 모니터가 그보다
// 작으면 작업 영역에 맞게 줄임.
const MAIN_WINDOW_DEFAULT_SIZE = { width: 1280, height: 800 };
function restoreMainWindowDefaultBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
  try {
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const wa = display.workArea;
    const width = Math.min(MAIN_WINDOW_DEFAULT_SIZE.width, wa.width);
    const height = Math.min(MAIN_WINDOW_DEFAULT_SIZE.height, wa.height);
    mainWindow.setBounds({
      x: Math.round(wa.x + (wa.width - width) / 2),
      y: Math.round(wa.y + (wa.height - height) / 2),
      width,
      height,
    });
  } catch (err) {
    logToFile("창 크기 되돌리기 실패(무시): " + (err?.message || err));
  }
}

function toggleMainWindowMaximize() {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
}

// 24-22차: "클라이언트 전체 테두리 둥글게 하라니까 왜 네모가 뒤에 남아있냐" - 23차엔 "최대화
// 해제 직후"에만 이 보정(배경색 재적용 + 1px 크기 토글로 강제로 다시 그리게 함)을 걸어뒀는데,
// 사용자가 보내준 사진을 보니 창을 "처음 띄웠을 때"도(최대화와 전혀 상관없이) 모서리가 둥글게
// 안 잘리고 각진 자국/선이 남아있었음. frame:false+transparent:true 창은 DWM이 둥근 모서리로
// 잘려나가는 투명한 비클라이언트 영역을 맨 처음 화면에 보여줄 때도 제대로 못 그릴 때가 있어서,
// 최대화 해제 때 쓰던 것과 똑같은 보정을 공용 함수로 빼서 "창이 처음 뜰 때"에도 같이 적용함
function redrawTransparentFrame() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
  mainWindow.setBackgroundColor("#00000000");
  const b = mainWindow.getBounds();
  mainWindow.setBounds({ ...b, width: b.width + 1 });
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
      mainWindow.setBounds(b);
    }
  });
}

// 24-23차: "클라이언트 테두리 네모 아직도 있고" - 24-22차의 redrawTransparentFrame()(배경색
// 재적용 + 1px 토글로 다시 그리게 하는 보정)로도 여전히 해결이 안 됐다는 재지적. 그건 "각진
// 자국이 얇게 남는" 정도의 문제를 노리고 만든 보정이었는데, 실제로는 그보다 근본적으로
// - frame:false+transparent:true 창이라도 Windows는 창을 "완전한 직사각형"으로 취급하고,
// CSS border-radius는 그 안에서 알파(투명도)로만 모서리를 "숨기는" 것 - DWM이 알파 합성
// 타이밍을 놓치면 그 사각형 원본이 그대로 비쳐 보일 수 있음. 이번엔 CSS에 의존하지 않고
// 창 자체의 실제 모양(hit-region + 그려지는 영역)을 setShape()로 body의 border-radius(12px)와
// 맞는 둥근 사각형으로 직접 잘라내서, "알파가 새어나오는" 경우 자체를 원천적으로 없앰(원 방정식으로
// 모서리를 가로줄 사각형 여러 개로 근사 - setShape는 곡선을 직접 못 받고 사각형 목록만 받음).
// 최대화 중엔 body 쪽도 각지게(is-fullscreen) 바뀌므로 셰이프도 그대로 꽉 찬 사각형 하나로 둠.
function computeRoundedRectShape(width, height, radius) {
  const r = Math.max(0, Math.min(Math.floor(radius), Math.floor(Math.min(width, height) / 2)));
  if (r <= 0 || width <= 0 || height <= 0) return [{ x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }];
  const rects = [];
  for (let y = 0; y < r; y++) {
    const dy = r - y - 0.5;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    const inset = Math.max(0, Math.min(r, Math.round(r - dx)));
    rects.push({ x: inset, y, width: Math.max(0, width - inset * 2), height: 1 });
  }
  if (height - r * 2 > 0) {
    rects.push({ x: 0, y: r, width, height: height - r * 2 });
  }
  for (let y = 0; y < r; y++) {
    const dy = y + 0.5;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    const inset = Math.max(0, Math.min(r, Math.round(r - dx)));
    rects.push({ x: inset, y: height - r + y, width: Math.max(0, width - inset * 2), height: 1 });
  }
  return rects;
}
const MAIN_WINDOW_CORNER_RADIUS = 12; // src/style.css의 body { border-radius: 12px } 와 맞춤
function applyRoundedWindowShape() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform !== "win32" && process.platform !== "linux") return; // setShape는 macOS 미지원
  try {
    const { width, height } = mainWindow.getBounds();
    const shape = mainWindow.isMaximized()
      ? [{ x: 0, y: 0, width, height }] // 최대화 중엔 body도 각지므로 그대로 꽉 찬 사각형
      : computeRoundedRectShape(width, height, MAIN_WINDOW_CORNER_RADIUS);
    mainWindow.setShape(shape);
  } catch (err) {
    logToFile("창 모서리 셰이프 적용 실패(무시): " + (err?.message || err));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_SIZE.width, // 24-104차: 최대화 해제 시 이 크기로 되돌림
    height: MAIN_WINDOW_DEFAULT_SIZE.height,
    // 23차: 진짜 최대화(maximize)가 동작하려면 resizable/maximizable이 꺼져있으면 안 됨.
    // 다만 사용자가 가장자리를 직접 끌어서 자유롭게 리사이즈하는 것까지 원한 건 아니고
    // "최대화 버튼 누르면 커졌다가, 다시 누르면 원래 크기로 돌아오는" 토글만 원했던 것이므로,
    // thickFrame은 그대로 false로 둬서(아래) 가장자리 드래그용 두꺼운 리사이즈 테두리 자체가
    // 안 생기게 해서 기존처럼 자유 리사이즈는 여전히 안 됨
    resizable: true,
    maximizable: true,
    frame: false, // OS 기본 타이틀바 제거 -> 커스텀 최소화/최대화/닫기 버튼 사용
    // 창 배경을 불투명 색으로 채우면, body의 둥근 모서리(border-radius)로 잘려나간
    // 네 귀퉁이 부분에 그 배경색이 그대로 보여서 "각지게 튀어나온" 것처럼 보임.
    // 완전히 투명하게 만들어서 모서리 바깥은 정말로 안 보이게(진짜 투명) 함
    transparent: true,
    backgroundColor: "#00000000",
    // Windows에서 frame:false + transparent:true 조합일 때 기본적으로 켜져 있는
    // "두꺼운 프레임"(WS_THICKFRAME) 때문에 창 위쪽/왼쪽 가장자리에 얇은 흰 선이 계속
    // 남아있었음. thickFrame과 그림자를 꺼서 완전히 없앰 - 23차: 이 값을 꺼둔 덕분에
    // resizable:true로 바꿔도(위 참고) 가장자리를 잡고 끄는 드래그 리사이즈용 두꺼운 테두리
    // 자체가 생기지 않아서, 여전히 사용자가 손으로 자유롭게 리사이즈할 수는 없음
    thickFrame: false,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 24-23차: 창을 만들자마자(아직 show:false라 화면엔 안 보이지만) 바로 둥근 셰이프부터
  // 잡아둠 - 나중에 페이드인 끝나고 나서야 처음 적용하면 그 사이 어느 프레임엔가 각진
  // 상태로 잠깐 그려질 수 있어서, 아예 처음부터 각진 채로 시작하지 않게 함
  applyRoundedWindowShape();

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  // 17차: 컴퓨터 시작 시 "백그라운드로 시작"이 켜져 있으면(--background 인자), 창을 띄우지 않고
  // 트레이로만 시작함. 그 외에는 기존처럼 스플래시 후 정상적으로 창을 보여줌
  const startInBackground = process.argv.includes("--background");
  mainWindow.once("ready-to-show", () => {
    if (startInBackground) {
      ensureTray();
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      return; // mainWindow.show() 호출 안 함 - 트레이에만 존재
    }
    // 24-35차: 고정 대기(옛 MIN_SPLASH_MS) 대신, 렌더러의 실제 시작 작업(사이트 계정 확인 +
    // 마인크래프트 계정 자동 로그인)이 끝났다는 신호(app:boot-ready)를 기다림 - 위
    // bootReadyPromise/rendererBootReady 선언부 주석 참고. 이미 끝나있으면(아주 빠른 네트워크
    // 등) 곧바로 다음 단계로 넘어가고, 아직이면 신호가 오거나 안전 타임아웃에 걸릴 때까지만
    // 기다림.
    const waitForBootReady = Promise.all([
      rendererBootReady
        ? Promise.resolve()
        : Promise.race([bootReadyPromise, new Promise((resolve) => setTimeout(resolve, BOOT_READY_TIMEOUT_MS))]),
      // 24-101차: 서버 상태 첫 확인도 로딩 화면에서 같이 끝냄(최대 4초 - 서버가 응답 없으면
      // 로딩을 더 붙잡지 않음). 앱 시작 때 이미 시작해둔 확인을 같이 기다리는 것이라 추가 요청 없음
      lastServerStatuses
        ? Promise.resolve()
        : Promise.race([serverStatusInFlight || checkAllServersStatus(), new Promise((resolve) => setTimeout(resolve, 4000))]),
    ]);

    waitForBootReady.then(() => {
      // 24-250차: 업데이트 창이 떠 있으면 메인 창은 띄우지 않는다(업데이트 로딩만 보이게)
      if (updateWindow && !updateWindow.isDestroyed() && isForcedUpdating) {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        return;
      }
      // 24-11차: "로딩하다가 딱 켜지는 게 아니라 좀 멋있게 켜지게" - 예전엔 스플래시를
      // 곧바로 close()하고 메인 창을 show()해서 화면이 뚝 끊겨 바뀌었음. 이제 메인 창은
      // opacity 0에서 시작해서 서서히 밝아지고(페이드인), 그와 동시에 스플래시 쪽에도
      // is-leaving 클래스를 붙여 CSS 트랜지션으로 부드럽게 사라지게 한 뒤에 닫음
      try { mainWindow.setOpacity(0); } catch (_) {}
      mainWindow.show();
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript("document.body.classList.add('is-leaving')").catch(() => {});
      }
      const FADE_STEPS = 12;
      const FADE_INTERVAL_MS = 25;
      let fadeStep = 0;
      const fadeTimer = setInterval(() => {
        fadeStep++;
        try {
          if (!mainWindow.isDestroyed()) mainWindow.setOpacity(Math.min(1, fadeStep / FADE_STEPS));
        } catch (_) {}
        if (fadeStep >= FADE_STEPS) {
          clearInterval(fadeTimer);
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
            splashWindow = null;
          }
          // 24-22차: "클라이언트 전체 테두리 둥글게 하라니까 왜 네모가 뒤에 남아있냐" - 창을
          // 맨 처음 보여줄 때도 최대화 해제 직후와 같은 DWM 재계산 문제가 생길 수 있어서,
          // 페이드인이 끝난 직후 같은 보정을 한 번 걸어줌
          setTimeout(redrawTransparentFrame, 60);
          // 24-23차: 위 redrawTransparentFrame()로도 여전히 안 됐다는 재지적이라, 셰이프
          // 자체를 다시 한번 확정지음(생성 직후에도 이미 걸어뒀지만, 실제 화면에 보여진
          // 뒤에 한 번 더 걸어서 확실하게 함)
          applyRoundedWindowShape();
        }
      }, FADE_INTERVAL_MS);
    });
  });

  // 24-58차: 여기 있던 최소화/복원/블러/포커스 시 배경음악 정지·재생 리스너는 런처
  // 배경음악 기능 자체가 없어지면서 함께 제거함(다른 용도가 없던 리스너들이었음)

  // 23차: F11로 창 최대화 토글 (메뉴바를 꺼둬서 OS 기본 F11 처리가 없으므로 직접 잡아줌).
  // 예전엔 setFullScreen()을 불렀는데(위 createWindow 상단 주석 참고), 이제 진짜
  // maximize()/unmaximize()를 부름 - toggleMainWindowMaximize()는 아래 IPC 핸들러에서도
  // 그대로 재사용함
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      toggleMainWindowMaximize();
    }
  });
  // 23차: 최대화/복원 진입·해제를 렌더러에도 알려서 레이아웃을 그에 맞게 조정할 수 있게 함
  // (채널 이름 window:fullscreen-changed는 렌더러/preload 쪽 변경을 최소화하려고 그대로 유지 -
  // "창이 커진 상태냐 아니냐"라는 렌더러 입장에서의 의미는 그대로이고, 메인 프로세스 쪽에서
  // 어떤 네이티브 메커니즘으로 그걸 구현했는지만 바뀐 것)
  // 24-187차: 창을 다시 보기 시작하면(트레이에서 꺼내거나 최소화 해제) 간격을 4초로
  // 되돌리고, 그동안 온 게 있는지 기다리지 않고 바로 한 번 확인한다
  mainWindow.on("focus", () => {
    scheduleSocialSignal();
    checkSocialSignal();
  });
  mainWindow.on("show", () => scheduleSocialSignal());
  mainWindow.on("restore", () => {
    scheduleSocialSignal();
    checkSocialSignal();
  });
  mainWindow.on("minimize", () => scheduleSocialSignal());
  mainWindow.on("hide", () => scheduleSocialSignal());
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", true);
    // 24-23차: 최대화되면 body도 각지게 바뀌므로(is-fullscreen), 셰이프도 같이 꽉 찬
    // 사각형으로 맞춰서 셰이프가 CSS보다 안쪽으로 파고들어 클릭이 씹히는 일이 없게 함
    applyRoundedWindowShape();
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", false);
    // 24-104차: 직전 크기가 아니라 항상 처음 크기(1280x800, 화면 가운데)로. Windows가 이벤트
    // 직후에 기억해둔 크기를 한 번 더 적용하는 경우가 있어 30ms 뒤 한 번 더(아래 60ms 보정 전에)
    restoreMainWindowDefaultBounds();
    setTimeout(() => {
      restoreMainWindowDefaultBounds();
      applyRoundedWindowShape();
    }, 30);
    // 20차에서 겪었던 것과 같은 원인(frame:false+transparent:true 창은 DWM이 비클라이언트
    // 영역을 다시 계산 안 해서 모서리에 얇은 각진 선이 남는 문제)이 최대화 해제 직후에도
    // 나타날 수 있어서 같은 보정을 적용함. 다만 진짜 maximize/unmaximize는 이전 창 크기·위치를
    // Windows/Electron이 스스로 정확히 기억했다가 복원해주므로, 19~21차처럼 크기 자체를 수동
    // setBounds로 여러 번 우겨넣을 필요는 없고, 배경색 재적용 + 1px 토글로 다시 그리게만 하면 됨
    // (24-22차: 이 보정 자체를 redrawTransparentFrame()으로 공용화함 - 아래 참고)
    setTimeout(redrawTransparentFrame, 60);
    // 24-23차: 복원된 크기 기준으로 둥근 셰이프를 다시 계산해서 적용(최대화 중엔 꽉 찬
    // 사각형 셰이프였으므로, 복원 후에도 그대로면 모서리가 다시 각져 보임)
    applyRoundedWindowShape();
  });

  mainWindow.on("close", (e) => {
    // 24-213차: "서버 킨 동안은 클라이언트 못 끄게 해"
    // 서버는 이 런처의 자식 프로세스라, 런처가 죽으면 서버 콘솔도 같이 날아간다.
    // 그래서 서버가 켜져 있으면 창을 닫지 않고 먼저 끄라고 알린다.
    if (!isReallyQuitting && hostedState !== "stopped") {
      e.preventDefault();
      try {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("hosted:close-blocked");
      } catch (_) {}
      return;
    }
    // 24-193차: 게임이 켜져 있는 동안의 X 는 완전 종료가 아니라 숨기기. 트레이 아이콘이나
    // 바탕화면 아이콘을 다시 누르면 이 창이 그대로 다시 나온다(second-instance 참고).
    if (!isReallyQuitting && anyGameRunning()) {
      e.preventDefault();
      ensureTray();
      mainWindow.hide();
      // 창이 어디 갔는지 모르면 곤란하니, 트레이 아이콘에 마우스를 올렸을 때 이유가 보이게 함
      try {
        appTray?.setToolTip("Nova Client - 게임 실행 중 (눌러서 창 열기)");
      } catch (_) {}
      logToFile("[창] 게임 실행 중이라 완전 종료 대신 창만 숨김");
      return;
    }
    // 창을 닫으면(다운로드 도중 포함) 진행 중인 다운로드를 즉시 중단
    if (currentAbortController) {
      currentAbortController.abort();
      logToFile("창 종료로 인해 다운로드 중단됨");
    }
  });
}

app.whenReady().then(() => {
  // 24-134차: Default 프로필 보장 + 첫 실행이면 그걸 선택된 상태로. 예전엔 profiles:list
  // IPC 안에서만 불러서, 렌더러가 servers:list 를 먼저 물어보면 그 순간엔 launch_mode 가
  // 아직 비어 있어 기본값 "server" 로 읽혔음(= 처음 켜면 서버가 골라져 보임)
  ensureDefaultProfile();
  migrateDefaultProfileVersion(); // 24-135차: 옛 Default(1.20.1 등)를 기준 버전으로 한 번 보정
  applyProfileArgFromArgv(process.argv);
  migrateOldAccountFormat();
  resetAttendanceOnce();
  migrateCoinsToPerAccount();
  migrateProfileDefaultsFromSettings();
  migrateProfileFoldersToNames(); // 24-93차: p_... 폴더를 프로필 이름으로
  resetLocalMcAccountsForSingleAccountModel();
  applyAutostartSetting(); // 17차: 저장된 설정대로 "컴퓨터 시작 시 실행"을 OS에 매번 다시 반영
  // 24-42차: 창을 보통처럼 띄워두고 쓰는 경우를 포함해서 앱이 실행되는 동안은 항상 트레이
  // 아이콘이 떠 있도록, 시작하자마자(창 생성/스플래시보다도 먼저) 한 번 만들어둠 - 아래
  // ensureTray()의 다른 호출부(백그라운드 실행 설정, --background 자동시작)는 이미 떠 있으면
  // 그대로 재사용하므로(idempotent) 중복 생성 걱정 없음
  ensureTray();

  // 로그인 팝업을 포함한 모든 요청에 한국어를 우선하도록 강제 지정
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["Accept-Language"] = "ko-KR,ko;q=0.9,en;q=0.6";
    callback({ requestHeaders: details.requestHeaders });
  });

  createSplashWindow();
  ensureDirs().then(createWindow).then(prefetchCommonAssetsOnce);
});

// 10-4: 첫 실행이 너무 오래 걸리는 문제 완화 - 가장 무거운 일회성 다운로드인 자바 런타임을
// 앱을 켜자마자 조용히 미리 받아둠 (Play 버튼 진행률 표시는 안 건드림).
let didPrefetchCommonAssets = false;
async function prefetchCommonAssetsOnce() {
  if (didPrefetchCommonAssets) return;
  didPrefetchCommonAssets = true;
  try {
    const defaultVersion = (CONFIG.SERVERS && CONFIG.SERVERS[0] && CONFIG.SERVERS[0].version) || "1.21.11";
    const defaultLoader = CONFIG.LOADER; // 24-94차: 서버에 loader 필드가 없어짐
    const javaFeatureVersion = getJavaFeatureVersionFor(defaultVersion, defaultLoader);
    if (!getJavaExecutable(javaFeatureVersion)) {
      logToFile(`첫 실행 - 자바(JRE ${javaFeatureVersion}) 미리 준비 시작`);
      await ensureJava(undefined, javaFeatureVersion, { silent: true });
      logToFile("첫 실행 - 자바 미리 준비 완료");
    }
    // 24-94차: 예전엔 여기서 서버 버전 마인크래프트 에셋을 공용 폴더(getRoot())에 미리 받았는데,
    // 이제 서버도 프로필 폴더로 켜서 공용 폴더에서 실행하는 일이 없음 - 수백 MB 낭비라 뺌.
  } catch (err) {
    // 미리 준비가 실패해도 실제 실행할 때 다시 시도되니까 조용히 넘어감
    logToFile("첫 실행 자바 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
  }
}

// 10-5: 새 프로필을 만든 직후, 그 프로필의 마인크래프트 버전에 맞는 자바를 조용히 미리 받아둠
// (prefetchCommonAssetsOnce와 같은 방식, ensureJava의 silent 옵션을 그대로 재사용)
async function prefetchAssetsForProfile(profile) {
  if (!profile?.mcVersion) return;
  const javaFeatureVersion = getJavaFeatureVersionFor(profile.mcVersion, profile.loader);
  if (!getJavaExecutable(javaFeatureVersion)) {
    logToFile(`새 프로필(${profile.name}) - 자바(JRE ${javaFeatureVersion}) 미리 준비 시작`);
    await ensureJava(undefined, javaFeatureVersion, { silent: true });
    logToFile(`새 프로필(${profile.name}) - 자바 미리 준비 완료`);
  }
  // 10-6(7차): 자바뿐 아니라 이 프로필의 마인크래프트 버전 에셋/라이브러리/클라이언트 jar도
  // 같이 미리 받아둠 (프로필을 만들자마자 시작 - 첫 Play 때까지 기다리지 않게)
  prefetchMinecraftAssets(profile.mcVersion, getProfileRoot(profile.id)).catch((err) => {
    logToFile(`새 프로필(${profile.name}) - 마인크래프트 에셋 미리 준비 실패(나중에 실행 시 다시 시도됨): ` + (err?.message || err));
  });
}

// ----------------------------------------------------------------------------
// 10-6(7차): 마인크래프트 버전 매니페스트/라이브러리/클라이언트 jar/에셋 "다운로드만" 미리 하기
//
// mclc(minecraft-launcher-core)는 이 작업들을 실제 게임 프로세스를 켜는 launch() 안에서만
// 순서대로 처리하고("checkJava -> getVersion -> getNatives -> getJar -> getClasses -> getAssets
// -> getLaunchOptions -> spawn"), "다운로드만 하고 실행은 안 함" 같은 granular API를 따로
// export하지 않는다 (실제로 이 프로젝트에서 쓰는 3.18.2 버전의 components/launcher.js를 직접
// 확인함). 유일한 안전한 방법은 launch()가 spawn 직전까지 쓰는 것과 완전히 같은 내부 모듈
// (components/handler.js)을 직접 불러와서, launch()가 하는 일 중
//   - checkJava (이미 ensureJava로 별도 처리함)
//   - getLaunchOptions / classpath 조립 / 실제 프로세스 spawn (게임을 켜는 부분 자체)
// 이 두 가지만 빼고, 실제 다운로드 4단계(getVersion/getNatives/getJar/getClasses/getAssets)만
// 그대로 재현하는 것. 즉 "실행 직전까지 mclc가 하는 다운로드"를 모두 안전하게 미리 하되,
// 게임 프로세스는 정말로 한 번도 spawn되지 않는다.
//
// 한계(정직하게 명시): Fabric 로더 프로필(ensureFabricProfile) 준비까지는 포함하지만, Forge는
// 이 런처가 아예 안 쓰므로 다루지 않음. 그리고 이 함수가 실패해도(네트워크 문제 등) 조용히
// 로그만 남기고 넘어가며, 실제 실행(launch:start) 때 mclc가 launch() 안에서 다시 한 번
// 똑같은 다운로드를 시도하므로 안전함(빠졌던 파일만 마저 받고, 이미 받아둔 건 건너뜀).
const prefetchingMcAssetsKeys = new Set();
async function prefetchMinecraftAssets(mcVersion, targetRoot) {
  if (!mcVersion) return;
  const root = targetRoot || getRoot();
  const key = `${root}::${mcVersion}`;
  if (prefetchingMcAssetsKeys.has(key)) return; // 이미 같은 대상으로 진행 중이면 중복 실행 안 함
  prefetchingMcAssetsKeys.add(key);
  try {
    logToFile(`[에셋 미리받기] 시작: ${mcVersion} (${root})`);

    // Fabric 로더 프로필(커스텀 버전 json)까지 포함해서 진짜 실행 때와 같은 구성으로 준비
    // (silent: true - 실행 진행률 UI를 건드리지 않음, ensureJava의 silent 옵션과 같은 패턴)
    const customVersion = await ensureFabricProfile(undefined, mcVersion, root, { silent: true });

    // launcher.js의 launch()가 만드는 것과 같은 모양의 options/overrides를, 실행(spawn) 없이
    // Handler에게만 넘겨서 다운로드 메서드들을 그대로 재사용함
    const fakeClient = new EventEmitter();
    fakeClient.options = {
      root,
      version: { number: mcVersion, type: "release", custom: customVersion || undefined },
      overrides: {
        url: {
          meta: "https://launchermeta.mojang.com",
          resource: "https://resources.download.minecraft.net",
          mavenForge: "https://files.minecraftforge.net/maven/",
          defaultRepoForge: "https://libraries.minecraft.net/",
          fallbackMaven: "https://search.maven.org/remotecontent?filepath=",
        },
      },
    };
    const directory = path.join(root, "versions", customVersion || mcVersion);
    fakeClient.options.directory = directory;

    const handler = new MclcHandler(fakeClient);

    // 1) 버전 매니페스트 + 버전 json (바닐라 기준 - Fabric도 이 위에 얹혀서 실행됨)
    await handler.getVersion();

    // 2) 네이티브 라이브러리 (1.19+ 버전은 mclc가 별도 네이티브 다운로드 없이 root를 그대로 반환함)
    await handler.getNatives();

    // 3) 클라이언트 jar (이미 있으면 건너뜀 - launch()와 동일한 조건)
    const mcPath = customVersion
      ? path.join(root, "versions", customVersion, `${customVersion}.jar`)
      : path.join(directory, `${mcVersion}.jar`);
    if (!fs.existsSync(mcPath)) {
      await handler.getJar();
    }

    // 4) 라이브러리 (Fabric 커스텀 버전 json이 있으면 그 안의 라이브러리도 같이)
    let modifyJson = null;
    if (customVersion) {
      const customJsonPath = path.join(root, "versions", customVersion, `${customVersion}.json`);
      if (fs.existsSync(customJsonPath)) {
        modifyJson = JSON.parse(await fsp.readFile(customJsonPath, "utf-8"));
      }
    }
    await handler.getClasses(modifyJson);

    // 5) 에셋 (아이콘/사운드/UI 리소스 등 - 보통 용량이 가장 큼)
    await handler.getAssets();

    logToFile(`[에셋 미리받기] 완료: ${mcVersion} (${root})`);
  } catch (err) {
    // 실패해도 실제 실행(launch:start) 시 mclc가 launch() 안에서 다시 시도하므로 조용히 넘어감
    logToFile(`[에셋 미리받기] 실패(${mcVersion}, 나중에 실행 시 다시 시도됨): ` + (err?.stack || err?.message || err));
  } finally {
    prefetchingMcAssetsKeys.delete(key);
  }
}

// ----------------------------------------------------------------------------
// 런처 자체 자동 업데이트 (GitHub Releases)
// 새 exe를 만들어서 GitHub Release로 올려두면, 이미 설치된 사람들은
// 앱을 켤 때 자동으로 새 버전을 (변경된 부분만) 받아서 다음 실행 때 적용됩니다.
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// 업데이트 전용 독립 창 (스플래시 창과 같은 방식 - 메인 창과 별개)
// ----------------------------------------------------------------------------
let updateWindow = null;
// 24-66차 신규: 강제 업데이트 중엔 이 창을 Alt+F4/닫기 등으로 못 없애게 막아야 하는데,
// installUpdateNow()가 부르는 quitAndInstall()도 내부적으로 app.quit()을 호출해서 이 창에
// close 이벤트를 보냄 - 그 정상적인 종료까지 막아버리면 설치 자체가 안 되므로, 설치를 실제로
// 시작하는 순간엔 이 플래그를 미리 풀어둬서 구분함(installUpdateNow() 참고).
let allowUpdateWindowClose = false;

function createUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) return;

  allowUpdateWindowClose = false;
  updateWindow = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    backgroundColor: "#0e0e0e",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  updateWindow.setMenuBarVisibility(false);
  updateWindow.loadFile(path.join(__dirname, "src", "update.html"));
  updateWindow.once("ready-to-show", () => updateWindow?.show());

  // 24-66차 신규: "백그라운드에 남아있는 문제 없도록 철저하게 막아줘" - 강제 업데이트 중엔
  // 이 창을 Alt+F4 등으로 닫아서 메인 창(숨겨진 상태)만 남는 상황을 막음. installUpdateNow()가
  // 실제로 종료를 시작할 때는 allowUpdateWindowClose를 먼저 풀어두므로 그 정상 종료는 막지 않음.
  updateWindow.on("close", (e) => {
    if (isForcedUpdating && !allowUpdateWindowClose) {
      e.preventDefault();
    }
  });

  // 업데이트 받는 동안 메인 창은 숨김 (업데이트 창만 보이게)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  // 24-250차: "실행로딩이랑 업뎃 로딩 같이 떠 업뎃로딩만 뜨게" - 실행 로딩(스플래시)은 바로 닫는다
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}
// 업데이트가 실패해서 평소처럼 쓰게 되돌릴 때 메인 창을 확실히 보이게(페이드인 전에 숨겨졌을 수 있음)
function showMainAfterUpdateAbort() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.setOpacity(1); } catch (_) {}
  mainWindow.show();
}

function setUpdateWindowPercent(percent) {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  updateWindow.webContents
    .executeJavaScript(
      `document.getElementById('bar').style.width = '${percent}%';` +
        `document.getElementById('percent').textContent = '${percent}%';`
    )
    .catch(() => {});
}

// 24-249차: "런처 업데이트가 생기면 윈도우 알림(오른쪽 아래 뜨는 거)으로 알려주라"
// 버전마다 한 번만 띄운다. 누르면 런처 창을 앞으로 가져온다.
let updateToastShownFor = null;
function showUpdateToast(version, phase) {
  try {
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;
    const key = `${version}|${phase}`;
    if (updateToastShownFor === key) return;
    updateToastShownFor = key;
    const n = new Notification({
      title: "Nova Client 업데이트",
      body:
        phase === "after-game"
          ? `새 버전 ${version || ""} · 게임 종료 후 설치`.trim()
          : `새 버전 ${version || ""} · 업데이트 중`.trim(),
      icon: path.join(__dirname, "build", "icon.png"),
      silent: false,
    });
    n.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
  } catch (err) {
    logToFile("업데이트 알림 실패: " + (err?.message || err));
  }
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 중(npm start)에는 업데이트 확인 안 함

  autoUpdater.autoDownload = false; // 자동으로 받지 않고, 버튼을 눌러야만 받기 시작함
  autoUpdater.autoInstallOnAppQuit = true;
  // 24-250차: "업데이트 자체가 안되는데 무슨 문제야? 로딩 다 되면 이전 버전 그대로야"
  // 원인(launcher.log): "New version ... is not signed by the application owner: publisherNames: Nova Client"
  // package.json 의 win.publisherName 때문에 받은 설치 파일의 디지털 서명을 검사하는데, 우리 설치 파일은
  // 서명(코드사이닝 인증서)이 없어서 매번 "가짜 파일"로 보고 버렸다 → 로딩만 돌고 예전 버전 그대로.
  // 서명 검사를 건너뛴다(받는 곳은 우리 GitHub 릴리스뿐이고 sha512 무결성 검사는 그대로 한다).
  try {
    autoUpdater.verifyUpdateCodeSignature = () => Promise.resolve(null);
  } catch (_) {}

  // 24-119차: "이제부터 업데이트 확인 했을 때 깃허브에 내 버전보다 낮으면 그걸로 업뎃되게 해줘"
  // 기본값(false)에선 GitHub 최신 릴리스가 지금 설치된 버전보다 낮으면 electron-updater가
  // "이미 최신"으로 보고 아무것도 안 함. 그래서 버전을 잘못 올려서 배포한 뒤(24-116차의 1.1.0)
  // 다시 낮은 번호로 되돌리면, 높은 버전이 깔린 사람들은 영영 업데이트를 못 받는 상태가 됨.
  // allowDowngrade를 켜두면 "GitHub에 올라온 버전 == 쓸 버전"이 되어, 번호가 낮아도 그쪽으로
  // 되돌려 받음(버전이 완전히 같을 때만 건너뜀 - 아래 update-available/downloaded 핸들러에
  // 이미 같은 버전이면 무시하는 가드가 있음)
  autoUpdater.allowDowngrade = true;

  // 제작자 본인 계정으로 로그인된 상태라면, GitHub에 "Pre-release(프리릴리즈)"로만
  // 올려둔 테스트 버전도 자동업데이트 대상에 포함시킵니다. 일반 유저는 정식 릴리즈만
  // 받으니, 이 설정으로 미리 몰래 받아서 써보고 괜찮으면 나중에 정식 릴리즈로 승격하면 됩니다.
  // (로그인 전이라도 마지막으로 로그인했던 계정 정보가 저장되어 있어 바로 판단 가능 - 이 시점엔
  // 아직 사이트 계정 세션 복원이 끝나기 전일 수 있어 isDevAccount()가 결국 이 마인크래프트
  // 프로필 이름 폴백으로 판단하게 됨)
  if (isDevAccount()) {
    autoUpdater.allowPrerelease = true;
    logToFile("개발자 계정 감지됨 - 프리릴리즈(테스트 버전) 자동업데이트 허용");
  }

  // 24-66차 신규: "업데이트 정보를 확인해서 만약 필요하면 업데이트 강제해줘 이제부터는" -
  // 예전엔 여기서 타이틀바 아이콘만 띄우고 끝(눌러야 다운로드 시작)이었는데, 이제 감지 즉시
  // isForcedUpdating을 켜고 자동으로 다운로드까지 시작함. 단, 이미 게임을 플레이 중이면
  // (gameProcess 존재) 지금 당장 창을 가리지 않고 다운로드만 조용히 먼저 받아두고, 설치는
  // 게임이 실제로 끝나는 시점(launcher.on("close"))으로 미룸 - 플레이 세션을 강제로 끊는 게
  // 너무 파괴적이라고 판단함.
  autoUpdater.on("update-available", (info) => {
    if (info?.version && info.version === app.getVersion()) return;
    isForcedUpdating = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:available", { version: info?.version || "", forced: true });
    }
    if (gameProcess && gameProcess.pid) {
      pendingForcedInstallAfterGame = true;
      logToFile("업데이트 감지 - 게임 플레이 중이라 설치는 게임 종료 후로 미룸(다운로드는 지금 시작)");
      showUpdateToast(info?.version, "after-game"); // 24-249차
    } else {
      createUpdateWindow();
      showUpdateToast(info?.version, "now"); // 24-249차
    }
    autoUpdater.downloadUpdate().catch((err) => {
      logToFile("업데이트 자동 다운로드 실패: " + (err?.stack || err));
      // 다운로드 자체가 실패하면 무한정 막아두지 않고 잠금을 풀어서 평소대로 쓸 수 있게 되돌림
      // (다음 5분 주기 확인 때 다시 시도됨)
      isForcedUpdating = false;
      pendingForcedInstallAfterGame = false;
      allowUpdateWindowClose = true;
      if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
      showMainAfterUpdateAbort();
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateWindowPercent(Math.round(progress.percent || 0));
  });

  autoUpdater.on("update-downloaded", (info) => {
    // 어떤 이유로든(캐시 등) 현재 버전과 같은 게 다시 내려온 경우엔 무시
    if (info?.version && info.version === app.getVersion()) {
      logToFile("동일 버전이 다시 감지되어 업데이트 창을 띄우지 않음: " + info.version);
      isForcedUpdating = false;
      pendingForcedInstallAfterGame = false;
      return;
    }
    updateReady = true;
    // 24-66차 신규: 게임이 끝날 때까지 설치를 미뤄둔 상태라면, 여기선 100%만 표시하지 않고
    // 조용히 끝냄 - 실제 설치는 launcher.on("close")가 pendingForcedInstallAfterGame을 보고 진행함
    if (pendingForcedInstallAfterGame) {
      logToFile("업데이트 다운로드 완료 - 게임이 끝나면 이어서 설치함");
      return;
    }
    setUpdateWindowPercent(100);
    // 100%를 잠깐 보여준 뒤, 자동으로 꺼졌다가 새 버전으로 다시 켜짐
    setTimeout(() => installUpdateNow(), 800);
  });
  autoUpdater.on("error", (err) => {
    logToFile("업데이트 확인 실패: " + (err?.stack || err));
    // 24-66차 신규: 다운로드/확인 도중 오류가 나면(설치까지 아직 안 갔으면) 잠금을 풀어줌
    if (isForcedUpdating && !pendingForcedInstallAfterGame && !updateReady) {
      isForcedUpdating = false;
      allowUpdateWindowClose = true;
      if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
      showMainAfterUpdateAbort();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    logToFile("업데이트 확인 실패: " + (err?.stack || err));
  });
}

let updateReady = false;

// 타이틀바 업데이트 아이콘을 눌렀을 때 - 여기서부터 실제 다운로드 시작(수동 트리거, 강제
// 업데이트가 이미 진행 중이면 중복 실행 방지)
ipcMain.on("update:start-download", () => {
  if (!app.isPackaged || isForcedUpdating) return;
  isForcedUpdating = true;
  createUpdateWindow(); // 이제부터 진행률을 보여줄 준비
  autoUpdater.downloadUpdate().catch((err) => {
    logToFile("업데이트 다운로드 실패: " + (err?.stack || err));
    isForcedUpdating = false;
  });
});

function installUpdateNow() {
  if (!app.isPackaged || !updateReady) return;
  // 24-66차 신규: quitAndInstall()은 내부적으로 app.quit()을 호출해서 모든 창(업데이트 창
  // 포함)에 close 이벤트를 보냄 - createUpdateWindow()에서 건 close 가드가 isForcedUpdating을
  // 계속 true로 보고 이 정상 종료까지 막아버릴 뻔한 걸 구현 중 직접 발견해서, 실제 설치를
  // 시작하기 직전에 미리 두 플래그를 풀어둠(가드가 더 이상 막지 않도록).
  isForcedUpdating = false;
  allowUpdateWindowClose = true;
  // 창을 직접 destroy()로 강제 종료하지 않음 - quitAndInstall이 스스로
  // 앱을 완전히 종료시킨 뒤에 설치 프로그램을 실행하는 게 정상 순서라,
  // 직접 끼어들면 파일이 아직 사용 중인 상태에서 설치가 시작돼서
  // "Failed to uninstall old application files" 오류가 날 수 있음.
  autoUpdater.quitAndInstall(true, true); // 조용히 설치 + 설치 후 자동 재실행
}

app.whenReady().then(() => {
  setupAutoUpdate();
});

ipcMain.handle("update:install-now", () => {
  installUpdateNow();
});

// ----------------------------------------------------------------------------
// 서버 상태(켜짐/꺼짐) + 실제 접속 지연시간(ms) 주기적으로 확인
// ----------------------------------------------------------------------------
const net = require("net");

function measurePingMs(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port: Number(port), timeout: timeoutMs });
    const finish = (ms) => {
      socket.destroy();
      resolve(ms);
    };
    socket.on("connect", () => finish(Date.now() - start));
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
  });
}

// 24-95차: 서버 소개(MOTD)의 첫 줄 - 색 코드(§x)를 뺀 줄 중 첫 번째 비지 않은 줄, 최대 80자.
// 외부 서버가 주는 문자열이라 렌더러에서 반드시 escape해서 씀.
function firstMotdLine(motd) {
  const lines = Array.isArray(motd?.clean) ? motd.clean : Array.isArray(motd?.raw) ? motd.raw : [];
  for (const l of lines) {
    const t = String(l || "").replace(/\u00a7[0-9a-fk-or]/gi, "").replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, 80);
  }
  return "";
}

// ----------------------------------------------------------------------------
// 24-101차: "클라이언트 처음 들어갔을 때 서버 로딩이 좀 느려 오프라인으로 떠 초반에 / 클라 로딩할
// 때 같이 로딩해야 할 듯"
// 원인 3가지였음:
//  1) 상태를 외부 사이트(api.mcsrvstat.us)에 물어봤음 - 수 초씩 걸리고, 느리거나 실패하면
//     catch로 떨어져 서버가 켜져 있어도 "오프라인"이 됨. 그 사이트는 결과를 몇 분씩 캐시함.
//  2) 앱 시작 때 첫 확인 결과를 보낼 창이 아직 없거나(스플래시 중) 화면이 덜 떠서 결과가
//     버려짐 → 다음 확인(30초 뒤)까지 "확인 중/오프라인"으로 남음.
//  3) 한 번 실패하면 30초 동안 그대로.
// 고친 것:
//  1) 마인크래프트 클라이언트가 서버 목록에서 쓰는 방식(Server List Ping)으로 서버에 **직접**
//     물어봄 - 보통 수십 ms, 인원·MOTD·아이콘까지 한 번에. 실패할 때만 외부 사이트로 폴백.
//  2) 결과를 main이 기억해두고(lastServerStatuses), 렌더러가 시작할 때 직접 가져감
//     (servers:status-now). 스플래시가 닫히기 전에 첫 확인을 기다림(최대 4초) - 로딩 화면이
//     끝났을 땐 이미 상태가 떠 있음.
//  3) 확인이 실패한 서버가 있으면 30초가 아니라 5초 뒤에 다시(최대 3번).
// ----------------------------------------------------------------------------
function writeVarInt(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return Buffer.from(out);
}
function readVarInt(buf, offset) {
  let result = 0, shift = 0, pos = offset;
  while (true) {
    if (pos >= buf.length) return null; // 아직 덜 받음
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: result >>> 0, size: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error("VarInt too big");
  }
}
function mcPacket(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
// 채팅 컴포넌트(문자열 또는 {text, extra[]})를 색 코드 없는 평문으로
function flattenMcText(c) {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(flattenMcText).join("");
  let t = typeof c.text === "string" ? c.text : typeof c.translate === "string" ? c.translate : "";
  if (Array.isArray(c.extra)) t += c.extra.map(flattenMcText).join("");
  return t;
}

// Server List Ping(1.7+) - 연결 시간을 pingMs로 씀(예전 measurePingMs와 같은 기준)
function queryServerDirect(host, port, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let connectedMs = null;
    let buf = Buffer.alloc(0);
    let done = false;
    const socket = net.createConnection({ host, port: Number(port) });
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error("timeout")), timeoutMs);
    socket.on("connect", () => {
      connectedMs = Date.now() - start;
      const hostBuf = Buffer.from(String(host), "utf8");
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(Number(port) || 25565);
      const handshake = mcPacket(0x00, Buffer.concat([
        writeVarInt(767),               // 프로토콜 번호(상태 조회엔 아무 값이나 받아줌)
        writeVarInt(hostBuf.length), hostBuf,
        portBuf,
        writeVarInt(1),                 // 다음 상태 = status
      ]));
      socket.write(Buffer.concat([handshake, mcPacket(0x00, Buffer.alloc(0))]));
    });
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 2 * 1024 * 1024) return finish(new Error("response too big"));
      try {
        const len = readVarInt(buf, 0);
        if (!len || buf.length < len.size + len.value) return; // 더 받아야 함
        let off = len.size;
        const id = readVarInt(buf, off); off += id.size;
        if (id.value !== 0x00) return finish(new Error("unexpected packet"));
        const strLen = readVarInt(buf, off); off += strLen.size;
        const json = JSON.parse(buf.slice(off, off + strLen.value).toString("utf8"));
        finish(null, { json, pingMs: connectedMs });
      } catch (err) {
        finish(err);
      }
    });
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(new Error("closed")));
  });
}

async function checkOneServerStatusViaApi(server) {
  // 예전 방식(외부 사이트) - 직접 조회가 막히는 환경(방화벽 등)을 위한 폴백
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const [res, pingMs] = await Promise.all([
      fetch(`https://api.mcsrvstat.us/3/${server.host}:${server.port}`, { signal: ac.signal }),
      measurePingMs(server.host, server.port),
    ]);
    const data = await res.json();
    // 24-80차: 서버 아이콘(data:image/png;base64,...) - 외부 문자열이라 형식을 한 번 거름
    return {
      serverId: server.id,
      online: !!data.online,
      playersOnline: data.players?.online,
      playersMax: data.players?.max,
      pingMs,
      icon: typeof data.icon === "string" && data.icon.startsWith("data:image/") ? data.icon : null,
      motd: data.online ? firstMotdLine(data.motd) : "", // 24-95차
      checked: true,
    };
  } finally {
    clearTimeout(t);
  }
}

async function checkOneServerStatus(server) {
  try {
    const tgt = await serverPingTarget(server); // 24-241차
    const { json, pingMs } = await queryServerDirect(tgt.host, tgt.port);
    const motdText = flattenMcText(json.description);
    return {
      serverId: server.id,
      online: true,
      playersOnline: json.players?.online,
      playersMax: json.players?.max,
      pingMs,
      icon: typeof json.favicon === "string" && json.favicon.startsWith("data:image/") ? json.favicon : null,
      motd: firstMotdLine({ clean: motdText.split("\n") }),
      checked: true,
    };
  } catch (directErr) {
    try {
      return await checkOneServerStatusViaApi(server);
    } catch (err) {
      // 둘 다 실패 = 정말 꺼졌거나 인터넷이 안 됨. checked:false는 "확인 못 함"이라 빨리 재시도함
      return { serverId: server.id, online: false, playersOnline: undefined, playersMax: undefined, pingMs: undefined, icon: null, checked: false };
    }
  }
}

// 13차: 목록의 서버 전부를 한 번에(동시에) 확인
// 24-101차: 결과를 기억해두고, 확인 중에 또 부르면 같은 확인을 같이 기다림
let lastServerStatuses = null;
let serverStatusInFlight = null;
let serverStatusQuickRetries = 0;
let serverStatusRetryTimer = null;
function checkAllServersStatus() {
  if (serverStatusInFlight) return serverStatusInFlight;
  serverStatusInFlight = (async () => {
    const results = await Promise.all(getAllServers().map((s) => checkOneServerStatus(s)));
    lastServerStatuses = results;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("servers:status-all", results);
    }
    // 확인에 실패한 서버가 있으면 5초 뒤 한 번 더(최대 3번) - 30초 동안 오프라인으로 남지 않게
    if (results.some((r) => !r.online) && serverStatusQuickRetries < 3) {
      serverStatusQuickRetries++;
      clearTimeout(serverStatusRetryTimer);
      serverStatusRetryTimer = setTimeout(() => checkAllServersStatus(), 5000);
    } else if (results.every((r) => r.online)) {
      serverStatusQuickRetries = 0;
    }
    return results;
  })().finally(() => {
    serverStatusInFlight = null;
  });
  return serverStatusInFlight;
}

// 렌더러가 시작할 때 직접 가져감 - 이미 결과가 있으면 바로, 확인 중이면 끝날 때까지(최대 4초)
ipcMain.handle("servers:status-now", async () => {
  if (lastServerStatuses) return lastServerStatuses;
  const p = serverStatusInFlight || checkAllServersStatus();
  return Promise.race([p, new Promise((r) => setTimeout(() => r(null), 4000))]);
});

let serverStatusInterval = null;
let periodicTickCount = 0;

app.whenReady().then(() => {
  checkAllServersStatus();
  checkAnnouncementPeriodic();
  checkStatusPeriodic();
  // 24-187차: 친구 초대·귓속말 신호는 서버 상태(30초)와 따로, 훨씬 짧은 간격으로 돈다
  checkSocialSignal();
  scheduleSocialSignal();

  serverStatusInterval = setInterval(() => {
    periodicTickCount++;
    checkAllServersStatus();
    checkAnnouncementPeriodic();
    checkStatusPeriodic();

    // 깃허브 API 요청 제한을 고려해서 업데이트 확인은 5분(10틱)마다만 같이 확인
    if (app.isPackaged && periodicTickCount % 10 === 0) {
      autoUpdater.checkForUpdates().catch((err) => {
        logToFile("주기적 업데이트 확인 실패: " + (err?.stack || err));
      });
    }
  }, 30000); // 30초마다 확인
});

app.on("window-all-closed", () => {
  // 24-193차: 게임 중의 X 는 위 close 핸들러가 막으므로(창이 안 없어짐) 여기까지 올 일이
  // 없다. 혹시 다른 이유로 창이 진짜 사라졌다면 되살릴 방법이 없어서(트레이만 남은 좀비가
  // 됨) 그냥 종료하는 게 맞다 - 그래서 창이 살아있을 때만 붙잡아 둔다.
  if (anyGameRunning() && mainWindow && !mainWindow.isDestroyed()) return;
  if (process.platform !== "darwin") app.quit();
});

// 24-42차: 트레이 아이콘을 항상 띄워두게 되면서, 앱이 완전히 종료될 때 트레이 아이콘도 같이
// 정리해야 작업표시줄에 아이콘이 남아있다가 마우스를 올려야 사라지는 "유령 아이콘" 현상을
// 피할 수 있음(Windows 트레이의 흔한 증상 - 프로세스는 끝났는데 아이콘 잔상만 남는 것)
app.on("before-quit", () => {
  // 24-193차: 여기부터는 진짜 종료다 - 위 close 핸들러가 창을 숨기지 않고 보내준다.
  // (트레이의 "완전히 종료", 업데이트 설치, 설정의 "마크 실행 시 완전 종료" 모두 이 길로 온다)
  isReallyQuitting = true;
  if (appTray && !appTray.isDestroyed()) {
    appTray.destroy();
    appTray = null;
  }
});

// ----------------------------------------------------------------------------
// IPC: 창 컨트롤 (최소화 / 닫기) - 최대화/리사이즈는 불가능한 고정 크기 창
// ----------------------------------------------------------------------------
ipcMain.on("window:minimize", () => mainWindow?.minimize());
// X 버튼은 완전 종료함 - 단, 24-193차부터 게임이 켜져 있는 동안엔 창만 숨긴다
// (실제 판단은 mainWindow 의 close 핸들러가 함)
ipcMain.on("window:close", () => mainWindow?.close());

// 23차: "전체화면이 창화면 최대크기를 말한 거였는데" - 이 버튼/채널 이름은 그대로 두되
// (렌더러 쪽 변경 최소화), 실제 동작은 OS 레벨 전체화면이 아니라 진짜 창 최대화로 바뀜.
// toggleMainWindowMaximize()는 F11 핸들러(위 createWindow 안)와 공유함
ipcMain.handle("window:toggle-fullscreen", () => {
  if (!mainWindow) return { ok: false, fullscreen: false };
  const next = toggleMainWindowMaximize();
  return { ok: true, fullscreen: next };
});
ipcMain.handle("window:is-fullscreen", () => ({ fullscreen: !!mainWindow?.isMaximized() }));

ipcMain.handle("app:open-folder", () => {
  shell.openPath(getRoot());
  return { ok: true };
});

// 7-2: 설정 화면의 자바 위치 목록에서 "폴더 열기"를 누르면 그 자바 버전 폴더를 탐색기로 엶
ipcMain.handle("settings:open-java-folder", (_e, javaFeatureVersion) => {
  shell.openPath(getRuntimeDir(javaFeatureVersion));
  return { ok: true };
});

// 24-144차: "귓속말 안열리는데 확인좀"
// 원인은 렌더러의 isInGame 플래그였음. 게임이 켜지면 true, launch:game-closed 를 받으면
// false 로 돌아가는데, 그 이벤트를 놓치면(프로세스가 비정상 종료되는 등) 플래그가 true 로
// 굳어버리고 openWhisperPopup 이 조건 없이 return 해서 "눌러도 아무 반응이 없는" 상태가 됨.
// 렌더러가 진짜 상태를 다시 물어볼 수 있게 조회용 IPC 를 둠(자가 복구용).
ipcMain.handle("launch:is-running", () => runningInstances.size > 0 || !!(gameProcess && gameProcess.pid));

// 24-149차: 렌더러가 버튼 글자(PLAY / 추가 실행하기 / STOP)를 정할 때 쓰는 현재 실행 목록.
// 창을 새로 띄우거나 포커스가 돌아왔을 때 한 번 맞춰보는 용도로도 씀.
ipcMain.handle("launch:get-running", () => getRunningState());

// 24-154차: "추가 실행 옆에 종료 버튼 만들기 - 가장 먼저 킨 순서대로 종료"
// 기존 launch:stop 은 "메인 실행(gameProcess)" 하나만 끄기 때문에, 여러 개 켜둔 상태에서는
// 어느 게 꺼질지 유저 입장에서 예측이 안 됐다. 이 핸들러는 startedAt 이 가장 이른 인스턴스를
// pid 로 직접 끈다(윈도우는 자식 프로세스까지 같이 죽여야 해서 taskkill /T 사용).
// 24-155차: "다른 프로필로 바꾸면 종료 버튼도 안보여야지, 그 프로필 종료가 아니니까" -
// 렌더러가 지금 고른 대상(profileId / mode)을 같이 보내면 그 대상 중에서만 고른다.
ipcMain.handle("launch:stop-oldest", async (_e, filter) => {
  let list = getRunningState().instances;
  if (filter && filter.mode === "profile" && filter.profileId) {
    list = list.filter((i) => i.profileId === filter.profileId);
  } else if (filter && filter.mode === "server") {
    list = list.filter((i) => i.mode === "server");
  }
  if (list.length === 0) return { ok: false, error: "실행 중인 게임이 없어요." };
  const target = list[0];
  const info = runningInstances.get(target.pid);
  stoppedByUser = true; // 유저가 일부러 끈 것 - 크래시 리포트 안 띄움(24-14차 참고)
  logToFile(`[종료] 가장 먼저 켠 인스턴스 종료 pid=${target.pid}`);
  try {
    if (process.platform === "win32") {
      await new Promise((resolve) => exec(`taskkill /pid ${target.pid} /T /F`, () => resolve()));
    } else {
      info?.proc?.kill?.("SIGTERM");
    }
  } catch (err) {
    logToFile("[종료] 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
  // close 이벤트가 곧 도착해 목록에서 빠지지만, 혹시 못 받는 경우를 대비해 조금 뒤 정리
  setTimeout(() => unregisterRunningInstance(target.pid), 4000);
  return { ok: true, pid: target.pid };
});

ipcMain.handle("app:restart", () => {
  app.relaunch();
  app.exit(0);
});

// ----------------------------------------------------------------------------
// IPC: 마이크로소프트 로그인 (여러 계정 저장 + 빠른 전환 지원)
// ----------------------------------------------------------------------------
// 로그인 후 발급받은 인증 정보를 앱이 켜져 있는 동안 메모리에 보관합니다.
let cachedAuthorization = null;

function getAccounts() {
  return store.get("accounts") || {};
}
function saveAccount(uuid, name, savedToken) {
  const accounts = getAccounts();
  accounts[uuid] = { uuid, name, savedToken };
  store.set("accounts", accounts);
}

// 예전 버전(단일 계정 저장 방식: mc_saved_token/mc_profile)에서
// 새 다중 계정 저장 방식(accounts/active_uuid)으로 자동 이전 (업데이트 후 로그인 풀림 방지)
function migrateOldAccountFormat() {
  const oldToken = store.get("mc_saved_token");
  const oldProfile = store.get("mc_profile");
  const accounts = store.get("accounts");

  if (oldToken && oldProfile?.uuid && !accounts) {
    saveAccount(oldProfile.uuid, oldProfile.name, oldToken);
    store.set("active_uuid", oldProfile.uuid);
    store.delete("mc_saved_token");
    logToFile("예전 로그인 정보를 새 계정 저장 방식으로 이전함: " + oldProfile.name);
  }
}

// 24-15차: "마크 계정이 왜 이미 있는 거야 있더라도 다 없애고 정보 새로 해, 한 계정에만
// 등록되게 하고 없애면 다시 로그인하게 해야지" - 예전(24차 이전) "여러 계정 빠른 전환"
// 시절부터 로컬에 쌓여있을 수 있는 마인크래프트 계정 캐시(accounts/active_uuid/
// mc_profile - 마이크로소프트 인증 토큰 자체)를 이 버전에서 한 번만 통째로 비움. 사이트
// 계정과 마인크래프트 계정을 서버에서 실제로 연결하는 정보(nova_account_links)는 이
// 함수와 무관하게 그대로 남아있어서, 다음에 같은 마인크래프트 계정으로 다시 로그인하면
// 자동으로 그대로 연동됨 - 로컬에 남아있던 "여러 계정" 캐시만 지우고 매번 실제 로그인을
// 새로 하도록 만드는 것이 목적(한 사이트 계정 = 마인크래프트 계정 하나라는 새 원칙과 맞춰
// 예전에 테스트로 쌓인 계정 캐시가 혼란을 주지 않게 함).
function resetLocalMcAccountsForSingleAccountModel() {
  if (store.get("mc_accounts_reset_single_account_v1")) return;
  store.delete("accounts");
  store.delete("active_uuid");
  store.delete("mc_profile");
  store.set("mc_accounts_reset_single_account_v1", true);
  logToFile("한 계정당 마인크래프트 1개 연동 방식으로 전환하면서 로컬 계정 캐시를 초기화함(서버 연동 정보는 유지됨)");
}

// 출석 시스템 테스트하면서 쌓인 기록을 한 번만 초기화 (1일차부터 다시 시작하게 함)
function resetAttendanceOnce() {
  if (store.get("attendance_reset_1_0_19")) return;
  store.delete("attendance_cycle_start");
  store.delete("attendance_last_claim");
  store.delete("attendance_claimed_days");
  store.set("attendance_reset_1_0_19", true);
  logToFile("출석 기록을 1일차로 초기화함");
}

// 예전 버전(코인/상점/출석이 PC 전체에 공용으로 저장되던 방식)을 계정별 저장 방식으로 이전
function migrateCoinsToPerAccount() {
  if (store.get("migrated_coins_per_account_1_1_4")) return;

  const uuid = store.get("active_uuid");
  if (uuid) {
    const oldCoins = store.get("coins");
    const oldOwned = store.get("owned_colors");
    const oldEquipped = store.get("equipped_color");
    const oldLog = store.get("coin_log");
    const oldCycleStart = store.get("attendance_cycle_start");
    const oldLastClaim = store.get("attendance_last_claim");
    const oldClaimedDays = store.get("attendance_claimed_days");

    if (typeof oldCoins === "number") setPlayerField(uuid, "coins", oldCoins);
    if (oldOwned) setPlayerField(uuid, "ownedColors", oldOwned);
    if (oldEquipped) setPlayerField(uuid, "equippedColor", oldEquipped);
    if (oldLog) setPlayerField(uuid, "coinLog", oldLog);
    if (oldCycleStart) setPlayerField(uuid, "attendanceCycleStart", oldCycleStart);
    if (oldLastClaim) setPlayerField(uuid, "attendanceLastClaim", oldLastClaim);
    if (oldClaimedDays) setPlayerField(uuid, "attendanceClaimedDays", oldClaimedDays);

    logToFile("PC 공용 코인/상점/출석 데이터를 계정(" + uuid + ")별 저장 방식으로 이전함");
  }

  store.delete("coins");
  store.delete("owned_colors");
  store.delete("equipped_color");
  store.delete("coin_log");
  store.delete("attendance_cycle_start");
  store.delete("attendance_last_claim");
  store.delete("attendance_claimed_days");
  store.set("migrated_coins_per_account_1_1_4", true);
}

// 24-27차: ensureDefaultProfile()/profiles:create를 고쳐도, 이미 만들어져있던 기존
// 프로필들(예: "Default", "wdadwa", "PVP")은 예전에 하드코딩된 1280/720/false/4GB
// 값을 이미 저장한 채로 남아있어서 그대로는 안 고쳐짐. 여기서 한 번만, 그 "손댄 적
// 없는 예전 기본값 그대로인" 프로필만 골라 지금 설정 화면 값으로 맞춰줌 (프로필 수정
// 화면에서 사용자가 직접 해상도/전체화면을 바꿔놓은 프로필은 신호(1280/720/false와
// 다른 값)가 남아있으므로 건드리지 않음).
function migrateProfileDefaultsFromSettings() {
  if (store.get("migrated_profile_defaults_from_settings_v1")) return;

  const list = getProfiles();
  const s = getSettings();
  let changed = false;
  for (const p of list) {
    const untouched =
      Number(p.width) === 1280 && Number(p.height) === 720 && p.fullscreen === false;
    if (untouched) {
      p.width = Math.max(640, Math.min(7680, Number(s.mcResolutionWidth) || 1280));
      p.height = Math.max(480, Math.min(4320, Number(s.mcResolutionHeight) || 720));
      p.fullscreen = !!s.mcFullscreen;
      if (typeof p.memoryGB !== "number" || p.memoryGB === 4) {
        p.memoryGB = Math.max(1, Math.min(32, Number(s.memoryGB) || 4));
      }
      changed = true;
    }
  }
  if (changed) {
    saveProfiles(list);
    logToFile("기존 프로필들의 해상도/전체화면/메모리 기본값을 설정 화면 값으로 동기화함");
  }

  store.set("migrated_profile_defaults_from_settings_v1", true);
}

// 저장된 활성 계정 토큰으로 조용히 재로그인을 시도합니다.
async function trySilentLogin() {
  const activeUuid = store.get("active_uuid");
  const accounts = getAccounts();
  const account = activeUuid ? accounts[activeUuid] : null;
  if (!account) {
    // 24-173차 진단용 - 여기서 걸리면 이 기기에 저장된 마인크래프트 계정 자체가 없는 것
    logToFile(`[자동 로그인] 저장된 계정 없음 (active_uuid=${activeUuid || "없음"}, 계정 ${Object.keys(accounts).length}개)`);
    return null;
  }

  try {
    const authManager = new Auth("select_account");
    let mc = tokenUtils.fromMclcToken(authManager, account.savedToken);
    mc = await mc.refresh(false); // 만료된 경우에만 실제로 갱신

    const mclcAuth = mc.mclc();
    cachedAuthorization = mclcAuth;

    const profile = {
      name: mclcAuth?.profile?.name || mclcAuth?.name || mc.profile?.name || "플레이어",
      uuid: mclcAuth?.profile?.id || mclcAuth?.uuid || mc.profile?.id || activeUuid,
    };
    saveAccount(profile.uuid, profile.name, mc.mclc(true)); // 갱신된 토큰 다시 저장
    store.set("mc_profile", profile);
    logToFile(`[자동 로그인] 성공: ${profile.name}`); // 24-173차 진단용
    return profile;
  } catch (err) {
    logToFile("자동 로그인 실패(만료됐거나 취소됨): " + (err?.stack || err));
    // 24-14차: "게스트가 아니고 마크 계정이 등록이 돼있는데 게스트라고 계속 뜬다" - 예전엔
    // 여기서 실패할 때마다(네트워크 문제 등 일시적인 이유여도) 이 계정 정보(accounts/
    // active_uuid/mc_profile)를 통째로 지워버렸음. 이 마인크래프트 계정은 노바 계정에 이미
    // 정식으로 연동(등록)돼 있는데, 그냥 "자동 로그인 토큰 갱신"이 한 번 실패했다고 그
    // 등록 사실 자체를 로컬에서 지워버리면 getMyIdentity()(코인/포럼 등 여러 곳에서 씀)도
    // 같이 게스트로 오판하게 됨. 이제 이 시도에서만 조용히 로그인 안 된 걸로 처리하고(PLAY를
    // 누르면 새로 마이크로소프트 로그인 창이 뜸), 계정 자체는 지우지 않음 - 진짜로 계정을
    // 빼고 싶으면 로그아웃(auth:logout)을 명시적으로 눌러야만 지워짐
    cachedAuthorization = null;
    return null;
  }
}

ipcMain.handle("auth:get-cached", async () => {
  return await trySilentLogin();
});

// 24-239차: "마크 계정도 로그인했을 때 마크가 있는지 체크" - 마이크로소프트 계정만 있고 마인크래프트
// 자바 에디션이 없으면 프로필이 없다(404). 그런 계정은 로그인을 막는다. 네트워크가 안 될 때는 막지 않는다.
async function checkMinecraftOwnership(accessToken) {
  if (!accessToken) return { ok: false, error: "마인크래프트 계정을 확인하지 못했어요." };
  try {
    const res = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return { ok: false, error: "마인크래프트 자바 에디션이 없는 계정이에요." };
    if (!res.ok) return { ok: true, unknown: true };
    const profile = await res.json().catch(() => null);
    if (!profile?.id || !profile?.name) return { ok: false, error: "마인크래프트 자바 에디션이 없는 계정이에요." };
    return { ok: true, profile };
  } catch (err) {
    logToFile("[로그인] 마크 보유 확인 실패(통과): " + (err?.message || err));
    return { ok: true, unknown: true };
  }
}

ipcMain.handle("auth:login", async () => {
  try {
    const authManager = new Auth("select_account");
    // msmc 가 자체 팝업(Electron BrowserWindow)을 띄워 마이크로소프트 로그인을 진행합니다.
    const xboxManager = await authManager.launch("electron");
    const token = await xboxManager.getMinecraft();

    const mclcAuth = token.mclc();
    // 24-239차: 마크가 있는 계정인지 먼저 확인
    const own = await checkMinecraftOwnership(mclcAuth?.access_token || mclcAuth?.accessToken);
    if (!own.ok) return { ok: false, error: own.error };
    cachedAuthorization = mclcAuth;

    const profile = {
      name: mclcAuth?.profile?.name || mclcAuth?.name || token.profile?.name || "플레이어",
      uuid: mclcAuth?.profile?.id || mclcAuth?.uuid || token.profile?.id || "",
    };

    saveAccount(profile.uuid, profile.name, token.mclc(true)); // 갱신 가능한 형태로 저장
    store.set("active_uuid", profile.uuid);
    store.set("mc_profile", profile);

    // 24-4차: 사이트 계정에 로그인해있으면, 방금 로그인한 이 마인크래프트 계정을 곧바로
    // "등록"함(=사이트 계정에 연동). 별도의 "등록" 화면을 새로 만들지 않고, 마이크로소프트
    // 로그인 자체가 등록을 겸하게 하는 방식 - 이미 다른 사이트 계정에 등록된 계정이면
    // 조용히 건너뛰고 경고만 같이 돌려줌(마이크로소프트 로그인 자체는 성공으로 처리).
    let siteLinkWarning = null;
    let kickedPreviousDevice = null;
    if (cachedSiteSession) {
      const mcAccessToken = mclcAuth?.access_token || mclcAuth?.accessToken;
      const linkResult = await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
      if (!linkResult.linked) siteLinkWarning = linkResult.warning || null;
      // 24-112차: 이 마인크래프트 계정을 이 기기 것으로 가져옴(다른 기기는 곧 로그아웃됨)
      const claim = await claimMinecraftSessionForThisDevice(profile.uuid, profile.name);
      if (claim?.kickedPrevious) kickedPreviousDevice = claim.previousDevice || "다른 기기";
    }

    return { ok: true, profile, siteLinkWarning, kickedPreviousDevice };
  } catch (err) {
    logToFile("로그인 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 24-169차: "비밀번호/아이디 찾기 있어야 해. 아이디 찾기는 마크 계정으로 찾을 수 있게
//            (A 계정에 B 마크 계정이 있으면 B로 찾으면 A의 아이디를 알려주고),
//            아이디로 비밀번호 찾을 수 있게."
//
// 본인 확인 수단: "그 계정에 연동된 마인크래프트 계정으로 실제로 로그인해 보이기".
// 런처는 이미 마이크로소프트 로그인 창을 띄울 수 있고, 메일 발송 설비는 없으므로 이 방식이
// 가장 확실하다(아무나 남의 uuid 를 적어 넣는 것도 막힌다 - 사이트가 마크 토큰을 검증함).
//
// ⚠️ 서버 쪽 엔드포인트 1개가 필요하다(Nova Site: /api/app/account/find-id):
//    find-id { mcUuid, mcAccessToken, mcName } -> { ok, loginId, nickname, email }
//    mcAccessToken 을 모장 쪽으로 한 번 확인한 뒤에만 응답해야 한다(안 그러면 남의 uuid 를
//    적어 넣는 것만으로 남의 아이디를 알아낼 수 있다).
// 비밀번호 찾기는 사이트에 이미 있는 /api/account/forgot-password + reset-password 를
// 그대로 쓴다(24-171차) - 새로 만들 게 없다.
//
// 아래 microsoftVerifyOnly 는 "확인만" 한다 - 런처의 계정 목록/활성 계정/사이트 연동은
// 절대 건드리지 않는다(로그인 안 된 상태에서 쓰는 기능이라 더더욱).
// ────────────────────────────────────────────────────────────────────────────
async function microsoftVerifyOnly() {
  const authManager = new Auth("select_account");
  const xboxManager = await authManager.launch("electron");
  const token = await xboxManager.getMinecraft();
  const mclcAuth = token.mclc();
  const uuid = normalizeUuid(mclcAuth?.profile?.id || mclcAuth?.uuid || "");
  const name = mclcAuth?.profile?.name || mclcAuth?.name || "";

  // 24-173차: 방금 마이크로소프트 로그인을 실제로 한 것이므로, 그 계정이 이미 이 기기에
  // 저장돼 있던 계정이면 토큰을 새것으로 바꿔 둔다. 예전엔 이 로그인 결과를 통째로 버려서,
  // 아이디 찾기를 하고 나면 저장돼 있던 토큰만 낡은 채로 남았다.
  // ⚠️ 없던 계정을 새로 "추가"하지는 않는다(공용 PC 에서 남이 아이디 찾기를 했다고 그 사람
  //    계정이 이 런처에 등록되면 안 된다). 활성 계정(active_uuid)도 건드리지 않는다.
  try {
    const accounts = getAccounts();
    const known = Object.keys(accounts).find((k) => normalizeUuid(k) === uuid);
    if (known) {
      saveAccount(known, name || accounts[known]?.name, token.mclc(true));
      logToFile(`[아이디 찾기] 기존 계정 토큰 갱신: ${name || known}`);
    }
  } catch (err) {
    logToFile("[아이디 찾기] 토큰 갱신 실패(무시): " + (err?.message || err));
  }

  return { uuid, name, accessToken: mclcAuth?.access_token || mclcAuth?.accessToken || null };
}

ipcMain.handle("account:find-id", async () => {
  try {
    const v = await microsoftVerifyOnly();
    if (!v.uuid) return { ok: false, error: "마인크래프트 계정을 확인하지 못했어요." };
    const res = await novaSiteFetch("find-id", {
      mcUuid: v.uuid,
      mcAccessToken: v.accessToken,
      mcName: v.name,
    });
    if (!res?.ok) {
      logToFile(`[아이디 찾기] 실패: ${v.name}(${v.uuid}) - ${res?.error || "없음"}`);
      return {
        ok: false,
        mcName: v.name,
        error: res?.error || "이 마인크래프트 계정으로 등록된 노바클 계정을 찾지 못했어요.",
      };
    }
    logToFile(`[아이디 찾기] 성공: ${v.name} -> ${res.loginId}`);
    return {
      ok: true,
      mcName: v.name,
      loginId: res.loginId,
      nickname: res.nickname || null,
      email: res.email || null,
    };
  } catch (err) {
    logToFile("[아이디 찾기] 예외: " + (err?.message || err));
    return { ok: false, error: "마인크래프트 로그인이 취소됐거나 실패했어요." };
  }
});

// 24-171차: "비밀번호 찾기는 이메일로 해야 하는 거 아니야?"
// 맞다. 24-169차에 "메일 설비가 없다"고 단정하고 마크 계정 인증으로 만들었는데, 사실
// Nova Site 에는 이미 메일 발송(Resend)과 비밀번호 재설정 코드 흐름이 전부 있었다
// (lib/email.js, nova_password_resets, /api/account/forgot-password + reset-password).
// 그래서 비밀번호 찾기는 사이트와 똑같은 "이메일로 6자리 코드 -> 코드 + 새 비밀번호" 로
// 되돌리고, 그 두 라우트를 런처가 그대로 호출한다(사이트에 새로 만들 게 없다).
// 마크 계정 인증은 "아이디 찾기"에만 남는다 - 아이디를 모르면 이메일도 모르기 때문에
// 메일로는 풀 수 없는 유일한 경우라서.
ipcMain.handle("account:request-password-code", async (_e, { email } = {}) => {
  try {
    const addr = String(email || "").trim().toLowerCase();
    if (!addr || !addr.includes("@")) return { ok: false, error: "이메일 형식이 올바르지 않아요." };
    const res = await novaSiteWebFetch("forgot-password", { email: addr });
    if (!res?.ok) {
      logToFile(`[비밀번호 찾기] 코드 발송 실패: ${addr} - ${res?.error || "없음"}`);
      return { ok: false, error: res?.error || "인증 코드를 보내지 못했어요." };
    }
    // 가입 여부를 알려주지 않는 게 사이트 정책이라, 계정이 없어도 성공으로 돌아온다
    logToFile(`[비밀번호 찾기] 코드 발송 요청: ${addr}`);
    return { ok: true };
  } catch (err) {
    logToFile("[비밀번호 찾기] 코드 발송 예외: " + (err?.message || err));
    return { ok: false, error: "인터넷 연결을 확인해주세요." };
  }
});

ipcMain.handle("account:reset-password", async (_e, { email, code, newPassword } = {}) => {
  try {
    const addr = String(email || "").trim().toLowerCase();
    const c = String(code || "").trim();
    const pw = String(newPassword || "");
    if (!addr || !addr.includes("@")) return { ok: false, error: "이메일 형식이 올바르지 않아요." };
    if (!c) return { ok: false, error: "인증 코드를 입력해주세요." };
    if (pw.length < 8) return { ok: false, error: "새 비밀번호는 8자 이상이어야 해요." };

    const res = await novaSiteWebFetch("reset-password", { email: addr, code: c, newPassword: pw });
    if (!res?.ok) {
      logToFile(`[비밀번호 찾기] 재설정 실패: ${addr} - ${res?.error || "없음"}`);
      return { ok: false, error: res?.error || "인증 코드가 올바르지 않거나 만료됐어요." };
    }
    logToFile(`[비밀번호 찾기] 재설정 성공: ${addr}`);
    return { ok: true };
  } catch (err) {
    logToFile("[비밀번호 찾기] 재설정 예외: " + (err?.message || err));
    return { ok: false, error: "인터넷 연결을 확인해주세요." };
  }
});

ipcMain.handle("auth:logout", async () => {
  const activeUuid = store.get("active_uuid");
  if (activeUuid) {
    const accounts = getAccounts();
    delete accounts[activeUuid];
    store.set("accounts", accounts);
  }
  cachedAuthorization = null;
  store.delete("mc_profile");
  store.delete("active_uuid");
  return { ok: true };
});

// ---- 계정 목록 / 빠른 전환 --------------------------------------------------
// 24-23차: "난 계정을 추가한 적이 없는데 왜 있냐" - 이 목록은 원래 "이 PC에서 마이크로소프트
// 로그인에 한 번이라도 성공한 적 있는 계정" 전부를 그대로 보여주고 있었음(24-15차 이전
// "여러 계정 빠른 전환" 시절 캐시나, 테스트로 로그인해본 계정도 안 지워지고 그대로 남아있음).
// 지금 로그인한 사이트 계정에 로그인해있으면, 실제로 그 사이트 계정에 연동된 마인크래프트
// 계정만 걸러서 보여줌 - 예전에 로그인해봤지만 지금은 이 사이트 계정과 무관하거나(연동한
// 적 없음) 연동을 해제한 계정은 스위처에서 더 이상 안 보임(로컬 캐시 자체를 지우진 않아서,
// 나중에 다시 연동하면 로그인 없이 그대로 빠르게 다시 씀 - 아래 accounts:switch 참고).
ipcMain.handle("accounts:list", () => {
  const accounts = getAccounts();
  const activeUuid = store.get("active_uuid");
  let entries = Object.values(accounts);
  if (cachedSiteSession?.accountId) {
    entries = entries.filter((a) => cachedSiteAccountLinkedUuids.has(normalizeUuid(a.uuid)));
  }
  return entries.map((a) => ({
    uuid: a.uuid,
    name: a.name,
    active: a.uuid === activeUuid,
  }));
});

ipcMain.handle("accounts:switch", async (_e, uuid) => {
  const accounts = getAccounts();
  const account = accounts[uuid];
  if (!account) return { ok: false, error: "저장된 계정을 찾을 수 없어요." };

  try {
    const authManager = new Auth("select_account");
    let mc = tokenUtils.fromMclcToken(authManager, account.savedToken);
    mc = await mc.refresh(false);

    const mclcAuth = mc.mclc();
    cachedAuthorization = mclcAuth;

    const profile = {
      name: mclcAuth?.profile?.name || mclcAuth?.name || mc.profile?.name || account.name,
      uuid: mclcAuth?.profile?.id || mclcAuth?.uuid || mc.profile?.id || uuid,
    };
    saveAccount(profile.uuid, profile.name, mc.mclc(true));
    store.set("active_uuid", profile.uuid);
    store.set("mc_profile", profile);

    // auth:login과 동일하게, 계정 전환에 성공한 마인크래프트 계정도 곧바로 등록함
    let siteLinkWarning = null;
    let kickedPreviousDevice = null;
    if (cachedSiteSession) {
      const mcAccessToken = mclcAuth?.access_token || mclcAuth?.accessToken;
      const linkResult = await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
      if (!linkResult.linked) siteLinkWarning = linkResult.warning || null;
      const claim = await claimMinecraftSessionForThisDevice(profile.uuid, profile.name); // 24-112차
      if (claim?.kickedPrevious) kickedPreviousDevice = claim.previousDevice || "다른 기기";
    }

    return { ok: true, profile, siteLinkWarning, kickedPreviousDevice };
  } catch (err) {
    logToFile("계정 전환 실패: " + (err?.stack || err));
    return { ok: false, error: "이 계정의 로그인이 만료됐어요. 다시 로그인해주세요." };
  }
});

// 실행(Play) 직전에 쓸 authorization 객체를 반환. 메모리에 없으면 저장된 토큰으로 한 번 더 시도.
// 24-4차: 이제 실행하려면 (1) 사이트 계정에 로그인해있어야 하고, (2) 그 세션이 다른 기기에
// 뺏기지 않은 상태여야 하고, (3) 마인크래프트 계정이 최소 하나는 등록(연동)돼 있어야 함
// (게스트는 실행 불가). 마이크로소프트 로그인/계정 전환 쪽에서 이미 등록을 시도하지만,
// (자동 로그인으로 복원되는 등) 등록 시도 없이 여기까지 온 경우를 대비해 실행 직전에도
// 한 번 더 등록을 시도해줌.
// 49-23차: 게임 안 소셜 화면(모드 NovaSocialScreen)에 넘길 정보. 등록된(사이트 계정에 연동된) 마인크래프트
// 계정들의 토큰을 실행 직전에 한 번 갱신해서 싣는다(accounts:switch와 같은 msmc refresh 경로). 활성 계정은
// 이미 갱신된 cachedAuthorization을 그대로 씀. 한 계정이라도 실패하면 그 계정만 빠짐(실행은 막지 않음).
async function collectSocialBridgeForMod() {
  const me = getMySiteIdentity();
  const activeUuid = store.get("active_uuid") || null;
  const accounts = getAccounts();
  const list = [];
  for (const acc of Object.values(accounts)) {
    if (!acc?.uuid || !acc?.savedToken) continue;
    if (cachedSiteSession?.accountId && !cachedSiteAccountLinkedUuids.has(normalizeUuid(acc.uuid))) continue;
    try {
      let accessToken = null;
      let name = acc.name;
      if (isSameUuid(acc.uuid, activeUuid) && cachedAuthorization) {
        accessToken = cachedAuthorization?.access_token || cachedAuthorization?.accessToken || null;
        name = cachedAuthorization?.profile?.name || cachedAuthorization?.name || name;
      } else {
        const authManager = new Auth("select_account");
        let mc = tokenUtils.fromMclcToken(authManager, acc.savedToken);
        mc = await Promise.race([
          mc.refresh(false),
          new Promise((_, reject) => setTimeout(() => reject(new Error("토큰 갱신 시간 초과")), 10000)),
        ]);
        const mclcAuth = mc.mclc();
        accessToken = mclcAuth?.access_token || mclcAuth?.accessToken || null;
        name = mclcAuth?.profile?.name || mc.profile?.name || name;
        saveAccount(acc.uuid, name, mc.mclc(true));
      }
      if (accessToken) list.push({ uuid: normalizeUuid(acc.uuid), name, accessToken });
    } catch (err) {
      logToFile("[노바 모드] 계정 토큰 갱신 실패(" + (acc.name || acc.uuid) + "): " + (err?.message || err));
    }
  }
  // 49-38차(모드 테마 동기화): 상점에서 장착한 색(equippedColor)의 hex를 같이 실어 보낸다.
  // 모드(NovaSocial)가 cosmetics.accent("#RRGGBB")를 읽어 게임 안 GUI/HUD 강조색으로 쓴다. 장착한 게 없거나
  // 모르는 id면 필드를 빼서 모드가 기본색(노바 연두)으로 가게 둔다.
  // 49-40차(사용자: "블랙 테마에 보라색으로 하고 갔는데 전혀 적용이 안 됐어"): 배경까지 바뀌는 "테마" 상품
  // (equippedThemeMode - 블랙 & 화이트/핑크/아쿠아/스카이/마인크래프트/메탈)도 같이 싣는다. 모드는 theme.mode
  // (style.css의 data-color-theme 값)로 패널·카드·글자 톤을 맞추고, 색상 상품이 없으면 테마 기본 포인트색을 쓴다.
  let cosmetics = null;
  try {
    const data = getPlayerData(activeUuid);
    const equipped = data?.equippedColor || null;
    const color = equipped ? SHOP_COLORS.find((c) => c.id === equipped) : null;
    if (color?.hex) cosmetics = { accent: color.hex, id: color.id, name: color.name };
    const equippedMode = data?.equippedThemeMode || null;
    const theme = equippedMode ? SHOP_COLORS.find((c) => c.id === equippedMode && c.category === "fulltheme") : null;
    if (theme?.mode) {
      cosmetics = cosmetics || {};
      cosmetics.theme = { id: theme.id, mode: theme.mode, name: theme.name };
    }
  } catch (_) {}
  return {
    // 49-74차(모드 5-9): 모드가 게임 안에서 닉네임으로 친구를 찾을 때 이 주소를 씀
    //   (런처 friends:add가 쓰는 /api/app/account/social과 같은 자리 - novaSiteFetch 참고)
    site: { id: me.id, name: me.name, api: CONFIG.NOVA_SITE_API_BASE },
    // 49-76차(모드 6-5): ffmpeg가 준비돼 있으면 경로(없으면 null - 모드는 "런처가 받는 중"으로 표시)
    tools: { ffmpeg: ffmpegExePath() },
    // 49-207차: 모드(Luna's Light)에 서비스 이름을 박아 두지 않으려고, site_presence의 계정 id 컬럼과
    // 디스코드 상태 그림 주소를 런처가 알려 준다.
    supabase: { url: CONFIG.SUPABASE_URL, anonKey: CONFIG.SUPABASE_ANON_KEY, presenceIdColumn: "nova_account_id" },
    logoUrl: "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/build/icon.png",
    activeUuid: activeUuid ? normalizeUuid(activeUuid) : null,
    accounts: list,
    ...(cosmetics ? { cosmetics } : {}),
  };
}

async function getAuthorizationForLaunch() {
  if (!cachedSiteSession) {
    throw new Error("먼저 사이트 계정에 로그인해주세요.");
  }
  const stillActive = await verifySiteSessionStillActive();
  if (!stillActive) {
    const device = cachedSiteAccountFull?.active_session_device || "다른 기기";
    clearSiteSessionLocally();
    throw new Error(`다른 기기(${device})에서 로그인해서 여기는 로그아웃됐어요. 다시 로그인해주세요.`);
  }

  if (!cachedAuthorization) await trySilentLogin();

  if (cachedAuthorization) {
    const profile = store.get("mc_profile");
    const mcAccessToken = cachedAuthorization?.access_token || cachedAuthorization?.accessToken;
    if (profile?.uuid) {
      await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
      // 24-112차: 실행 직전에도 이 기기 것으로 확정(다른 기기에서 켜져 있었다면 거기서 로그아웃됨)
      await claimMinecraftSessionForThisDevice(profile.uuid, profile.name);
    }
  }

  if (!cachedAuthorization) {
    throw new Error("로그인 정보가 없습니다. 먼저 마이크로소프트 로그인을 해주세요.");
  }
  if (cachedSiteAccountLinkedUuids.size === 0) {
    throw new Error("먼저 마인크래프트 계정을 등록해주세요. (게스트 상태에서는 게임을 실행할 수 없어요)");
  }
  return cachedAuthorization;
}

// ----------------------------------------------------------------------------
// 진행률 보고 헬퍼
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// 진행률 보고 헬퍼
// 여러 단계(자바 설치 / Fabric 준비 / 모드 설치 / 마인크래프트 다운로드)를
// 하나의 전체 0~100% 진행률로 합산해서 렌더러에 보냅니다.
// (각 단계가 차지하는 비중은 대략적인 다운로드 용량 비율로 잡았습니다)
// ----------------------------------------------------------------------------
const PHASE_ORDER = ["java", "mods-meta", "mods", "resourcepacks", "game"];
const PHASE_WEIGHT = {
  java: 10,          // 자바 런타임 (없을 때만 다운로드)
  "mods-meta": 5,    // Fabric 로더 프로필 (용량 작음)
  mods: 10,          // 모드 파일 복사
  resourcepacks: 5,  // 리소스팩 복사 + 호환성 패치
  game: 70,          // 마인크래프트 라이브러리/에셋 (보통 가장 큼)
};

// 24-107차: opts.big = "진짜 오래 걸리는 다운로드/설치"(자바 받기·압축 해제, Forge/NeoForge 설치,
// 모드팩 받기, 마인크래프트 파일 실제 다운로드). 렌더러는 이 표시가 붙은 진행만 PLAY 아래에
// 글로 보여줌 - 매번 도는 "확인 중/준비 완료" 같은 짧은 단계는 글을 안 띄움.
function reportProgress(phase, percentInPhase, detail, opts) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const idx = PHASE_ORDER.indexOf(phase);
  let base = 0;
  for (let i = 0; i < idx; i++) base += PHASE_WEIGHT[PHASE_ORDER[i]];

  const clampedPhasePct = Math.max(0, Math.min(100, percentInPhase));
  const overall = base + (PHASE_WEIGHT[phase] || 0) * (clampedPhasePct / 100);

  // 24-157차: "100 찍고 그대로 몇분이 걸리고 그래" - 파일 다운로드가 끝나도 압축 해제/검증/
  // 자바 실행까지 시간이 꽤 남는데 퍼센트는 이미 100 이라 멈춘 것처럼 보였다. 실제로 게임이
  // 떴을 때(final)만 100 을 쓰고, 그 전에는 96 을 넘지 않게 막아서 마지막 구간을 남겨둔다.
  let shown = Math.max(0, Math.min(100, overall));
  if (!opts?.final) shown = Math.min(shown, 96);

  mainWindow.webContents.send("launch:progress", {
    phase,
    percent: Math.round(shown * 10) / 10, // 소수 첫째 자리까지 - 렌더러가 부드럽게 보간함
    detail: detail || "",
    big: !!opts?.big,
    // 24-157차: "대충 다운받는 수 보면 예측 되잖아 속도랑 시간"
    bytesPerSec: opts?.bytesPerSec || 0,
    downloadedBytes: opts?.downloadedBytes || 0,
    final: !!opts?.final,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 24-157차: 게임 파일 단계(game) 진행률 추적기
// mclc 는 두 가지 이벤트를 준다.
//   · progress        { type, task, total } : 같은 종류(라이브러리/네이티브/에셋...) 안에서
//                       "몇 번째 파일인지". 종류가 바뀌면 0 부터 다시 시작한다.
//   · download-status { name, type, current, total } : 지금 받는 "파일 하나"의 바이트.
// 예전 코드는 download-status 의 current/total 을 그대로 전체 퍼센트로 썼다. 그건 파일 하나
// 기준이라 첫 파일이 끝나는 순간 100% 가 되고, 렌더러는 퍼센트를 되돌리지 않으므로 그 뒤로
// 몇 분이 남아도 100% 에 멈춰 있는 것처럼 보였다. (유저 제보의 정확한 원인)
// 이제는:
//   · 퍼센트 : 종류별로 고정 비중을 두고, 종류 안에서는 "파일 개수" 비율로 채운다.
//              한 번 올라간 종류별 값은 내려가지 않으므로 전체도 항상 우상향한다.
//   · 속도   : download-status 의 바이트 "증가분"만 모아서 초당 속도를 계산한다(EMA).
//   · 남은 시간은 렌더러가 퍼센트가 오르는 속도로 계산한다(다운로드 외 단계도 포함되므로).
// ────────────────────────────────────────────────────────────────────────────
const GAME_SLOTS = [
  { key: "classes", w: 24 },  // 라이브러리(.jar)
  { key: "natives", w: 8 },   // 네이티브(플랫폼 전용)
  { key: "assets", w: 60 },   // 에셋(개수가 압도적으로 많아 체감 시간의 대부분)
  { key: "etc", w: 8 },       // 그 외(모드팩/커스텀 등)
];

function gameSlotKeyFor(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("asset")) return "assets";
  if (t.includes("native")) return "natives";
  if (t.includes("class") || t.includes("librar") || t.includes("forge")) return "classes";
  return "etc";
}

function createGameProgressTracker() {
  const slot = {};            // key -> 0~1 (한 번 오른 값은 안 내려감)
  const lastBytesByName = new Map();
  let downloadedBytes = 0;
  let windowBytes = 0;
  let windowAt = Date.now();
  let bps = 0;
  let lastType = "";
  // 24-160차: "실행중에는 플레이 밑에 뭐 뜨지 않게 해줘"
  // 24-157차부터 게임 단계 진행을 무조건 big=true 로 보냈더니, 받을 게 하나도 없는 두 번째
  // 실행에서도(파일 확인만 하고 지나가는 단계) PLAY 아래 글이 잠깐씩 떴다.
  // 이제 "실제로 받은 바이트"가 기준치를 넘었을 때만 big 으로 올린다 -> 진짜 다운로드가
  // 있을 때만 속도/남은 시간 줄이 뜨고, 그냥 실행일 땐 버튼 안 "실행 중..."만 보인다.
  const BIG_BYTES = 3 * 1024 * 1024;

  function overallPct() {
    let sum = 0;
    for (const s of GAME_SLOTS) sum += (slot[s.key] || 0) * s.w;
    return sum; // 0~100 (모든 종류를 다 봐야 100 에 가까워짐)
  }

  return {
    onProgress(e) {
      if (!e || !e.total) return;
      const key = gameSlotKeyFor(e.type);
      const v = Math.max(0, Math.min(1, e.task / e.total));
      slot[key] = Math.max(slot[key] || 0, v);
      lastType = e.type || lastType;
      reportProgress("game", overallPct(), `${lastType || "파일"} 내려받는 중`, {
        big: downloadedBytes > BIG_BYTES,
        bytesPerSec: bps,
        downloadedBytes,
      });
    },
    onDownloadStatus(e) {
      if (!e || !e.total) return;
      // 파일 하나의 바이트 증가분만 모은다(전체 퍼센트로는 쓰지 않음 - 위 주석 참고)
      const name = e.name || e.type || "?";
      const prev = lastBytesByName.get(name) || 0;
      let delta = e.current - prev;
      if (delta < 0) delta = e.current; // 새 파일이 같은 이름으로 다시 시작한 경우
      if (e.current >= e.total) lastBytesByName.delete(name);
      else lastBytesByName.set(name, e.current);
      if (delta > 0) {
        downloadedBytes += delta;
        windowBytes += delta;
      }
      const now = Date.now();
      const elapsed = now - windowAt;
      if (elapsed >= 700) {
        const inst = windowBytes / (elapsed / 1000);
        bps = bps ? bps * 0.6 + inst * 0.4 : inst;
        windowBytes = 0;
        windowAt = now;
        reportProgress("game", overallPct(), `${lastType || "파일"} 내려받는 중`, {
          big: downloadedBytes > BIG_BYTES,
          bytesPerSec: bps,
          downloadedBytes,
        });
      }
    },
    done() {
      // 24-160차: 실행이 끝나는 순간엔 글을 남기지 않는다(렌더러가 캡션을 비움)
      reportProgress("game", 100, "", { final: true, downloadedBytes });
    },
  };
}

// ----------------------------------------------------------------------------
// 1) 자바 자동 설치 (Adoptium Temurin JRE, 필요할 때만 다운로드)
// ----------------------------------------------------------------------------
// 가장 최근 크래시 리포트를 찾아서 내용을 읽어옴 (없으면 최신 로그로 대체)
async function findLatestCrashReport(sinceMs) {
  try {
    const crashDir = path.join(getRoot(), "crash-reports");
    if (fs.existsSync(crashDir)) {
      const files = (await fsp.readdir(crashDir)).filter((f) => f.endsWith(".txt"));
      if (files.length > 0) {
        const withTime = await Promise.all(
          files.map(async (f) => {
            const st = await fsp.stat(path.join(crashDir, f));
            return { f, mtime: st.mtimeMs };
          })
        );
        withTime.sort((a, b) => b.mtime - a.mtime);
        // 24-14차: "게임 X 눌러서 종료하거나 Stop 눌러서 종료할 때 크래시 떴다고" - 이 함수가
        // 실제 crash-reports/*.txt가 하나도 없으면 그냥 logs/latest.log 마지막 부분을 대신
        // 돌려주고 있었는데, 그러면 종료 코드가 0이 아니기만 해도(Stop으로 강제종료, 창을 그냥
        // 닫음 등 실제 크래시가 아닌 경우 포함) 크래시 팝업이 뜨고 있었음. 진짜 크래시 리포트
        // 파일이 "이번 실행 중에" 새로 생겼을 때만 크래시로 인정하도록, 이번 실행 시작 시각
        // 이전에 만들어진(예전 세션에서 남은) 오래된 크래시 리포트는 무시함
        if (typeof sinceMs === "number" && withTime[0].mtime < sinceMs) return null;
        const latest = path.join(crashDir, withTime[0].f);
        const text = await fsp.readFile(latest, "utf-8");
        return text.slice(0, 8000); // 너무 길면 잘라서 전달
      }
    }
    // 24-14차: 진짜 크래시 리포트 파일이 없으면 더 이상 로그 파일로 대체해서 보여주지 않음 -
    // 일반 로그 마지막 부분은 "크래시가 아닌데 크래시처럼" 보이게 하는 원인이었음
    return null;
  } catch (err) {
    logToFile("크래시 리포트 읽기 실패: " + (err?.message || err));
  }
  return null;
}

// rcedit 모듈은 버전에 따라 콜백/프로미스 방식이 달라서 둘 다 지원하도록 감싸줌
function runRcedit(exePath, options) {
  return new Promise((resolve, reject) => {
    try {
      const mod = require("rcedit");
      const fn = typeof mod === "function" ? mod : mod.rcedit || mod.default;
      if (!fn) return reject(new Error("rcedit 모듈을 불러오지 못했습니다."));
      if (fn.length >= 3) {
        fn(exePath, options, (err) => (err ? reject(err) : resolve()));
      } else {
        Promise.resolve(fn(exePath, options)).then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

// javaw.exe를 우리 아이콘으로 바꾼 복사본으로 실행하면, 작업표시줄/작업관리자에 표시되는
// 프로세스 아이콘이 우리 아이콘으로 보입니다(모드 없이 가능한 부분).
// 단, 마인크래프트 창이 완전히 뜨고 나면 게임이 자체적으로 자기 아이콘을 다시 덮어써서
// 창 자체의 아이콘까지 완벽히 유지하려면 Custom Window Title 같은 모드가 그래도 필요합니다.
async function ensureCustomIconJavaw(javaPath) {
  if (process.platform !== "win32") return javaPath;

  try {
    const iconPath = path.join(__dirname, "build", "icon.ico");
    if (!fs.existsSync(iconPath)) return javaPath; // 아이콘 파일 없으면 그냥 기본 javaw 사용

    const dir = path.dirname(javaPath);
    const customPath = path.join(dir, "NovaClient.exe");

    if (!fs.existsSync(customPath)) {
      await fsp.copyFile(javaPath, customPath);
      await runRcedit(customPath, { icon: iconPath });
      logToFile("작업표시줄용 커스텀 아이콘 javaw 생성: " + customPath);
    }
    return customPath;
  } catch (err) {
    logToFile("커스텀 아이콘 적용 실패, 기본 javaw로 진행: " + (err?.message || err));
    return javaPath;
  }
}

async function ensureJava(signal, javaFeatureVersion, opts = {}) {
  const silent = !!opts.silent; // 10-4: 첫 실행 때 미리 준비할 땐 Play 버튼 진행률 바를 건드리면 안 되니까 조용히 진행
  const existing = getJavaExecutable(javaFeatureVersion);
  if (existing) {
    if (!silent) reportProgress("java", 100, "자바 확인 완료");
    return existing;
  }

  if (!silent) reportProgress("java", 0, "자바 런타임 정보를 확인하는 중...");

  const osKey = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const archKey = process.arch === "arm64" ? "aarch64" : "x64";
  const ext = osKey === "windows" ? "zip" : "tar.gz";

  const apiUrl = `https://api.adoptium.net/v3/binary/latest/${javaFeatureVersion}/ga/${osKey}/${archKey}/jre/hotspot/normal/eclipse`;

  const runtimeDir = getRuntimeDir(javaFeatureVersion);
  await fsp.mkdir(runtimeDir, { recursive: true });
  const archivePath = path.join(runtimeDir, `jre-${javaFeatureVersion}.${ext}`);
  await downloadFileWithProgress(apiUrl, archivePath, signal, (pct) => {
    if (!silent) reportProgress("java", pct, `자바(JRE ${javaFeatureVersion}) 다운로드 중...`, { big: true });
  });

  if (!silent) reportProgress("java", 100, "자바 압축 해제 중...", { big: true });
  if (ext === "zip") {
    await extractZip(archivePath, { dir: runtimeDir });
  } else {
    await tar.x({ file: archivePath, cwd: runtimeDir });
  }
  await fsp.unlink(archivePath).catch(() => {});

  const javaBin = getJavaExecutable(javaFeatureVersion);
  if (!javaBin) throw new Error("자바 설치 후에도 실행 파일을 찾지 못했습니다.");

  // 리눅스/맥에서는 실행 권한 부여
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(javaBin, 0o755);
    } catch (_) {}
  }

  if (!silent) reportProgress("java", 100, "자바 설치 완료");
  return javaBin;
}

// 리다이렉트를 따라가며 파일을 스트리밍 다운로드 + 진행률(%) 콜백
async function downloadFileWithProgress(url, destPath, signal, onProgress) {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);

  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const fileStream = fs.createWriteStream(destPath);

  await new Promise((resolve, reject) => {
    res.body.on("data", (chunk) => {
      received += chunk.length;
      if (total > 0 && onProgress) onProgress((received / total) * 100);
    });
    res.body.on("error", reject);
    fileStream.on("error", reject);
    fileStream.on("finish", resolve);
    res.body.pipe(fileStream);
  }).catch((err) => {
    fileStream.close();
    fs.unlink(destPath, () => {});
    throw err;
  });
}

// ----------------------------------------------------------------------------
// 2) Fabric 로더 프로필 준비 (mclc 의 "custom" 버전 기능을 이용)
// ----------------------------------------------------------------------------
async function ensureFabricProfile(signal, mcVersion, targetRoot, opts = {}) {
  const silent = !!opts.silent; // 10-6(7차): 에셋 미리받기(prefetchMinecraftAssets)에서 쓸 땐 진행률 UI를 건드리면 안 됨
  if (!silent) reportProgress("mods-meta", 0, "Fabric 로더 정보를 확인하는 중...");

  const loaderListRes = await fetch(
    `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`,
    { signal }
  );
  if (!loaderListRes.ok) throw new Error("Fabric 로더 목록을 가져오지 못했습니다.");
  const loaders = await loaderListRes.json();
  if (!loaders || loaders.length === 0) {
    throw new Error(`${mcVersion} 버전에 대한 Fabric 로더를 찾을 수 없습니다.`);
  }
  const stable = loaders.find((l) => l.loader.stable) || loaders[0];
  const loaderVersion = stable.loader.version;

  const customName = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const versionDir = path.join(targetRoot || getRoot(), "versions", customName);
  const versionJsonPath = path.join(versionDir, `${customName}.json`);

  if (!fs.existsSync(versionJsonPath)) {
    if (!silent) reportProgress("mods-meta", 50, "Fabric 프로필 다운로드 중...");
    const profileRes = await fetch(
      `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`,
      { signal }
    );
    if (!profileRes.ok) throw new Error("Fabric 프로필 JSON을 가져오지 못했습니다.");
    const profileJson = await profileRes.text();
    await fsp.mkdir(versionDir, { recursive: true });
    await fsp.writeFile(versionJsonPath, profileJson, "utf-8");
  }

  if (!silent) reportProgress("mods-meta", 100, "Fabric 준비 완료");
  return customName;
}

// ----------------------------------------------------------------------------
// 2-1) 24-2차 신규: Forge / NeoForge 로더 준비
// ----------------------------------------------------------------------------
// "모드팩 포지랑 네오포지도 지원좀 해주라" - Fabric은 meta API가 완성된 버전 JSON을
// 그대로 내려줘서 그냥 받아 쓰면 끝이지만(위 ensureFabricProfile), Forge/NeoForge는
// 그런 API가 없고 대신 공식 설치 프로그램(installer.jar)이 있음. 이 설치 프로그램은
// "--installClient <경로>"로 실행하면(공식적으로 지원하는 헤드리스 모드 - 다른 런처들도
// 이 방식으로 Forge/NeoForge를 지원함) versions/ 폴더 안에 Fabric의 커스텀 버전 JSON과
// 똑같은 역할을 하는 버전 파일을 직접 만들어줌. 그래서 "설치 프로그램을 한 번 돌려서
// 버전 파일을 만들어낸 뒤, 그 결과를 Fabric과 동일한 방식(customName 문자열)으로
// launch:start에 넘긴다"는 전략으로 구현함 - launch:start 쪽 코드는 전혀 안 바뀜.
//
// ⚠️ 정직하게 밝혀둠: 이 부분은 이 세션(샌드박스)에서 실제로 자바를 실행해서 설치
// 프로그램을 돌려볼 방법이 없어 라이브 테스트를 못 했음. Forge/NeoForge 공식 문서에
// 나온 표준 방식대로 작성했지만, 마인크래프트 버전대에 따라 설치 프로그램 동작이 조금씩
// 달라질 수 있어서 실제 기기에서 먼저 가벼운 모드팩으로 확인해보는 걸 권장함(문제가
// 있으면 로그 파일에 [installer] 태그로 설치 프로그램 출력이 그대로 남음).

// Forge: 공식 promotions API로 마인크래프트 버전별 추천/최신 빌드 번호를 조회
let cachedForgePromotions = null;
async function fetchRecommendedForgeVersion(mcVersion, signal) {
  try {
    if (!cachedForgePromotions) {
      const res = await fetch("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json", { signal });
      if (!res.ok) throw new Error("Forge 버전 정보를 가져오지 못했습니다.");
      cachedForgePromotions = await res.json();
    }
    const promos = cachedForgePromotions.promos || {};
    return promos[`${mcVersion}-recommended`] || promos[`${mcVersion}-latest`] || null;
  } catch (err) {
    logToFile("Forge 버전 조회 실패: " + (err?.message || err));
    return null;
  }
}

// NeoForge: 전용 추천 API가 없어서 maven-metadata.xml의 버전 목록에서 직접 골라야 함.
// XML 파서 라이브러리를 새로 추가하지 않고, 아주 단순한 <version>..</version> 태그만
// 정규식으로 뽑아냄(신뢰할 수 있는 공식 maven 서버 응답이라 안전).
let cachedNeoForgeVersions = null;
async function fetchNeoForgeVersions(signal) {
  if (cachedNeoForgeVersions) return cachedNeoForgeVersions;
  const res = await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml", { signal });
  if (!res.ok) throw new Error("NeoForge 버전 목록을 가져오지 못했습니다.");
  const xml = await res.text();
  cachedNeoForgeVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return cachedNeoForgeVersions;
}
// NeoForge 버전 문자열은 마인크래프트 버전 앞의 "1."을 뗀 형태로 시작함(공식 규칙,
// 예: 마인크래프트 1.21.1 → NeoForge 21.1.x)
function neoForgeMcPrefix(mcVersion) {
  return String(mcVersion).replace(/^1\./, "");
}
function compareVersionStrings(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
async function fetchRecommendedNeoForgeVersion(mcVersion, signal) {
  try {
    const versions = await fetchNeoForgeVersions(signal);
    const prefix = neoForgeMcPrefix(mcVersion) + ".";
    const matches = versions.filter((v) => v.startsWith(prefix) && !v.includes("-beta"));
    if (matches.length === 0) return null;
    matches.sort(compareVersionStrings);
    return matches[matches.length - 1];
  } catch (err) {
    logToFile("NeoForge 버전 조회 실패: " + (err?.message || err));
    return null;
  }
}

// Forge/NeoForge 설치 프로그램(.jar)을 "--installClient <경로>"로 조용히 실행
function runInstallerClient(javaPath, installerJarPath, targetRoot, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ["-jar", installerJarPath, "--installClient", targetRoot], { cwd: targetRoot });
    let stderrTail = "";
    child.stdout?.on("data", (d) => logToFile("[installer] " + String(d).trim()));
    child.stderr?.on("data", (d) => {
      const text = String(d);
      stderrTail = (stderrTail + text).slice(-1000);
      logToFile("[installer:err] " + text.trim());
    });
    child.on("error", (err) => reject(new Error("설치 프로그램을 실행하지 못했습니다: " + (err?.message || err))));
    const onAbort = () => {
      child.kill();
      reject(new Error("사용자가 취소했습니다."));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("close", (code) => {
      signal?.removeEventListener?.("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(`설치 프로그램이 오류로 종료됐습니다(코드 ${code})` + (stderrTail ? `: ${stderrTail.slice(0, 200)}` : "")));
    });
  });
}

// 24-60차: "한 13%에서 오류나는데?" (설치 프로그램이 오류로 종료됐습니다(코드 1)) - 유저
// PC의 installer.log를 직접 확인해보니 원인이 명확했음:
//   "There is no minecraft launcher profile in ... you need to run the launcher first!"
// Forge/NeoForge 설치 프로그램(--installClient)은 대상 폴더가 "공식 마인크래프트 런처가
// 한 번이라도 실행된 폴더"인지를 launcher_profiles.json 파일의 존재 여부로만 판단함. Nova
// Client는 공식 런처가 아니라서 이 파일이 절대 생기지 않고, 그래서 하이의 놀이터(Forge
// 1.20.1) 서버처럼 새 폴더에 처음 Forge를 설치할 때마다 무조건 이 지점에서 실패하고
// 있었음(운으로 통과한 적이 없었던 것 - 이 코드 경로 자체가 라이브 테스트 전무했음).
// 해결: 설치 프로그램 실행 직전에 최소 형태의 launcher_profiles.json을 만들어둠(이미
// 있으면 절대 건드리지 않음) - 다른 서드파티 런처들도 흔히 쓰는 우회 방법이고, Forge
// 설치 프로그램 입장에선 "런처가 이미 한 번 실행됐다"고 인식하게 됨
async function ensureLauncherProfilesStub(root) {
  const profilesPath = path.join(root, "launcher_profiles.json");
  if (fs.existsSync(profilesPath)) return;
  const stub = {
    profiles: {},
    settings: {
      crashAssistance: true,
      enableAdvanced: false,
      enableAnalytics: true,
      enableHistorical: false,
      enableReleases: true,
      enableSnapshots: false,
      keepLauncherOpen: false,
      profileSorting: "ByLastPlayed",
      showGameLog: false,
      showMenu: false,
      soundOn: false,
    },
    version: 3,
  };
  try {
    await fsp.mkdir(root, { recursive: true });
    await fsp.writeFile(profilesPath, JSON.stringify(stub, null, 2), "utf8");
    logToFile("launcher_profiles.json 스텁 생성: " + profilesPath);
  } catch (err) {
    logToFile("launcher_profiles.json 생성 실패: " + (err?.message || err));
  }
}

// installer가 만들어낸 버전 폴더를 versions/ 디렉터리 전후 스냅샷 비교로 찾아냄 -
// Forge/NeoForge가 실제로 붙이는 폴더 이름 표기는 마인크래프트 버전대마다 조금씩
// 달라서(예: "1.20.1-forge-47.x.y", "neoforge-21.1.x" 등) 정확한 이름 규칙을 미리
// 못박아두지 않고, "이 실행 전후로 새로 생긴 폴더"를 그대로 찾는 방식이 더 안전함
async function findNewVersionFolder(versionsDir, before, matchHint) {
  const after = fs.existsSync(versionsDir) ? await fsp.readdir(versionsDir) : [];
  const created = after.filter((n) => !before.includes(n));
  return created.find((n) => n.toLowerCase().includes(matchHint)) || created[0] || null;
}

async function ensureForgeProfile(signal, mcVersion, targetRoot, javaPath, opts = {}) {
  const silent = !!opts.silent;
  if (!silent) reportProgress("mods-meta", 0, "Forge 버전 정보를 확인하는 중...");
  const forgeVersion = await fetchRecommendedForgeVersion(mcVersion, signal);
  if (!forgeVersion) throw new Error(`${mcVersion} 버전에 대한 Forge를 찾을 수 없습니다.`);

  const root = targetRoot || getRoot();
  const versionsDir = path.join(root, "versions");
  await fsp.mkdir(versionsDir, { recursive: true });
  const existing = await fsp.readdir(versionsDir);
  const already = existing.find((n) => n.includes("forge") && n.includes(forgeVersion));
  if (already) {
    if (!silent) reportProgress("mods-meta", 100, "Forge 준비 완료");
    return already;
  }

  if (!silent) reportProgress("mods-meta", 15, "Forge 설치 프로그램 받는 중...");
  const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
  const tempDir = path.join(getRoot(), "temp");
  await fsp.mkdir(tempDir, { recursive: true });
  const installerPath = path.join(tempDir, `forge-installer-${mcVersion}-${forgeVersion}.jar`);
  try {
    await downloadFileWithProgress(installerUrl, installerPath, signal, (pct) => {
      if (!silent) reportProgress("mods-meta", 15 + pct * 0.35, "Forge 설치 프로그램 받는 중...", { big: true });
    });

    if (!silent) reportProgress("mods-meta", 55, "Forge 설치 중... (시간이 조금 걸릴 수 있어요)", { big: true });
    await ensureLauncherProfilesStub(root);
    await runInstallerClient(javaPath, installerPath, root, signal);

    const versionFolder = await findNewVersionFolder(versionsDir, existing, "forge");
    if (!versionFolder) throw new Error("Forge 설치 후 버전 파일을 찾지 못했습니다.");

    if (!silent) reportProgress("mods-meta", 100, "Forge 준비 완료");
    return versionFolder;
  } finally {
    fs.unlink(installerPath, () => {});
  }
}

async function ensureNeoForgeProfile(signal, mcVersion, targetRoot, javaPath, opts = {}) {
  const silent = !!opts.silent;
  if (!silent) reportProgress("mods-meta", 0, "NeoForge 버전 정보를 확인하는 중...");
  const neoVersion = await fetchRecommendedNeoForgeVersion(mcVersion, signal);
  if (!neoVersion) throw new Error(`${mcVersion} 버전에 대한 NeoForge를 찾을 수 없습니다.`);

  const root = targetRoot || getRoot();
  const versionsDir = path.join(root, "versions");
  await fsp.mkdir(versionsDir, { recursive: true });
  const existing = await fsp.readdir(versionsDir);
  const already = existing.find((n) => n.includes("neoforge") && n.includes(neoVersion));
  if (already) {
    if (!silent) reportProgress("mods-meta", 100, "NeoForge 준비 완료");
    return already;
  }

  if (!silent) reportProgress("mods-meta", 15, "NeoForge 설치 프로그램 받는 중...");
  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
  const tempDir = path.join(getRoot(), "temp");
  await fsp.mkdir(tempDir, { recursive: true });
  const installerPath = path.join(tempDir, `neoforge-installer-${neoVersion}.jar`);
  try {
    await downloadFileWithProgress(installerUrl, installerPath, signal, (pct) => {
      if (!silent) reportProgress("mods-meta", 15 + pct * 0.35, "NeoForge 설치 프로그램 받는 중...", { big: true });
    });

    if (!silent) reportProgress("mods-meta", 55, "NeoForge 설치 중... (시간이 조금 걸릴 수 있어요)", { big: true });
    await ensureLauncherProfilesStub(root);
    await runInstallerClient(javaPath, installerPath, root, signal);

    const versionFolder = await findNewVersionFolder(versionsDir, existing, "neoforge");
    if (!versionFolder) throw new Error("NeoForge 설치 후 버전 파일을 찾지 못했습니다.");

    if (!silent) reportProgress("mods-meta", 100, "NeoForge 준비 완료");
    return versionFolder;
  } finally {
    fs.unlink(installerPath, () => {});
  }
}

// 24-60차 후속: "모드팩서버 누르면 플레이 눌렸다가 바로 꺼지는데?" - launcher.log를 직접
// 확인해보니 게임이 뜨기도 전에 자바 자체가 즉시 죽고 있었음:
//   java.lang.ExceptionInInitializerError / InaccessibleObjectException:
//   ... module java.base does not "opens java.lang.invoke" to unnamed module ...
// 원인: 이 프로젝트가 쓰는 minecraft-launcher-core(mclc) 라이브러리는 "custom version"
// 방식(version.custom, 지금 Forge/NeoForge를 실행하는 방식)일 때 그 버전 JSON의
// "arguments.jvm" 배열(1.17+ 모던 Forge가 JPMS 모듈 시스템 때문에 반드시 필요로 하는
// --add-opens/--add-exports/-p 모듈 경로 등)을 전혀 읽어서 반영하지 않음(mclc 소스
// components/handler.js의 getJVM()이 OS별 고정 플래그 하나만 돌려줄 뿐, 어디에도
// arguments.jvm을 참조하는 코드가 없음 - 직접 확인함). Forge 설치 프로그램 자체는 이
// 인자들이 전부 정확히 들어있는 버전 JSON을 잘 만들어주고 있었는데(설치는 24-60차에서
// 정상화됨), mclc가 그걸 무시하고 자기 기본 JVM 인자만 써서 실행하다보니 자바가 저 모듈
// 접근 예외로 곧바로 죽어버린 것 - Fabric은 이런 모듈 인자가 필요 없어서 지금까지는 이
// 문제가 드러나지 않았음.
// 해결: Forge/NeoForge 버전 JSON을 직접 읽어서 arguments.jvm을 뽑아내고, 그 안의
// ${library_directory}/${classpath_separator}/${version_name} 플레이스홀더를 실제 값으로
// 치환한 뒤 mclc의 opts.customArgs로 넘김(customArgs는 mclc 내부에서 -cp/메인클래스보다
// 앞쪽에 그대로 들어가므로 JVM 옵션으로 정확히 동작함 - launcher.js 71~84번째 줄 확인).
function getModernLoaderJvmArgs(runRoot, customVersion) {
  try {
    const jsonPath = path.join(runRoot, "versions", customVersion, `${customVersion}.json`);
    if (!fs.existsSync(jsonPath)) return [];
    const versionJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const jvmArgs = versionJson?.arguments?.jvm;
    if (!Array.isArray(jvmArgs) || jvmArgs.length === 0) return [];

    const libraryDirectory = path.join(runRoot, "libraries");
    const classpathSeparator = path.delimiter; // Windows: ";"
    const versionName = versionJson.id || customVersion;

    const resolveOne = (value) =>
      String(value)
        .split("${library_directory}").join(libraryDirectory)
        .split("${classpath_separator}").join(classpathSeparator)
        .split("${version_name}").join(versionName);

    const resolved = [];
    for (const entry of jvmArgs) {
      // Forge/NeoForge 버전 JSON은 보통 문자열만 씀(OS 조건부 rule 객체는 거의 없음) -
      // 혹시 있으면 안전하게 건너뜀(잘못된 값을 그대로 넣는 것보다 나음)
      if (typeof entry === "string") resolved.push(resolveOne(entry));
    }
    logToFile(`[Forge/NeoForge] JVM 모듈 인자 ${resolved.length}개 적용: ${customVersion}`);
    return resolved;
  } catch (err) {
    logToFile(`[Forge/NeoForge] JVM 모듈 인자 추출 실패(${customVersion}): ${err?.message || err}`);
    return [];
  }
}

// 24-176차: 여기 있던 syncMods() 를 지웠다(위 3-1 주석 참고).

// 24-120차: "선릿벨리 팩은 아예 없애줘 이제 필요없어" - 여기 있던 "모드팩 서버 자동 설치"
// (3-0, 50차) 블록을 통째로 삭제함. 모드가 300개 넘는 서버용으로 GitHub Release의 클라이언트
// zip을 받아 인스턴스에 풀어주던 구조인데, 24-94차에 서버가 "주소와 버전"만 들고 연결된
// 프로필로 켜지게 바뀌면서 호출부가 이미 사라져 죽은 코드로 남아 있었음. 같이 지운 것:
// syncServerModpack / resolveModpackSource / readModpackMarker / listInstanceResourcePacks /
// USER_PREF_FILES / MODPACK_MARKER_FILE / MODPACK_RESOURCEPACK_MANIFEST / CONFIG.MODPACK_URL,
// 그리고 저장소의 modpack.json. (Modrinth .mrpack 가져오기/내보내기는 별개 기능이라 그대로 유지)

// ----------------------------------------------------------------------------
// 3-1) 리소스팩 동기화 + 자동 장착
//   resourcepacks/ 폴더에 넣어둔 .zip을 인스턴스로 복사(모드와 동일한 미러 방식)한 뒤,
//   options.txt의 resourcePacks 목록에 강제로 넣어서 매번 켜질 때 자동으로 켜져 있게 합니다.
// ----------------------------------------------------------------------------
// 리소스팩 안의 pack.mcmeta를 열어서 버전 호환 범위를 강제로 넓혀줍니다.
// (오래된 리소스팩이라 마인크래프트가 자동으로 꺼버리는 문제를 방지)
// 이미 넓혀져 있으면 건드리지 않아서 매번 다시 압축하지 않습니다.
function patchResourcePackFormat(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntry("pack.mcmeta");
    if (!entry) {
      logToFile(`[리소스팩] pack.mcmeta 없음: ${zipPath}`);
      return;
    }

    let json;
    try {
      json = JSON.parse(zip.readAsText(entry));
    } catch (err) {
      logToFile(`[리소스팩] pack.mcmeta 파싱 실패(${zipPath}): ${err?.message || err}`);
      return; // 형식이 이상하면 건드리지 않음
    }
    if (!json.pack) {
      logToFile(`[리소스팩] pack.mcmeta에 "pack" 필드 없음: ${zipPath}`);
      return;
    }

    const already =
      json.pack.max_format === 200 &&
      json.pack.min_format === 0 &&
      json.pack.supported_formats?.max_inclusive === 200;
    if (already) return;

    // 패치 전 원본을 임시 백업 (패치가 파일을 깨뜨릴 경우 되돌리기 위함)
    const backupPath = zipPath + ".bak";
    fs.copyFileSync(zipPath, backupPath);

    json.pack.min_format = 0;
    json.pack.max_format = 200; // 넉넉하게 넓혀서 이후 버전까지 커버
    json.pack.supported_formats = { min_inclusive: 0, max_inclusive: 200 };

    zip.deleteFile("pack.mcmeta");
    zip.addFile("pack.mcmeta", Buffer.from(JSON.stringify(json, null, 2), "utf-8"));
    zip.writeZip(zipPath);

    // 안의 모든 파일을 실제로 다 읽어봐서(압축 해제 시도) 손상 여부를 검증.
    // (pack.mcmeta 하나만 확인하는 걸로는 부족함 -> 다른 엔트리가 깨져도 게임이 크래시하듯
    //  전체 리소스팩이 통째로 비활성화되는 심각한 문제로 이어졌었음)
    let corrupted = false;
    try {
      const verifyZip = new AdmZip(zipPath);
      for (const e of verifyZip.getEntries()) {
        if (e.isDirectory) continue;
        try {
          e.getData();
        } catch (entryErr) {
          corrupted = true;
          logToFile(
            `[리소스팩] 패치 후 손상 감지(${path.basename(zipPath)}, 파일: ${e.entryName}): ${entryErr?.message || entryErr}`
          );
          break;
        }
      }
    } catch (verifyErr) {
      corrupted = true;
      logToFile(`[리소스팩] 패치 후 재검증 실패(${zipPath}): ${verifyErr?.message || verifyErr}`);
    }

    if (corrupted) {
      // 손상됐으면 패치를 포기하고 원본으로 되돌림 (호환성 확장은 못 하지만 최소한 안 깨짐)
      fs.copyFileSync(backupPath, zipPath);
      logToFile(`[리소스팩] 패치가 파일을 손상시켜서 원본으로 롤백함: ${path.basename(zipPath)}`);
    } else {
      logToFile(`[리소스팩] 패치 완료 및 무결성 확인됨: ${path.basename(zipPath)}`);
    }
    fs.unlinkSync(backupPath);
  } catch (err) {
    logToFile("리소스팩 호환성 패치 실패(" + zipPath + "): " + (err?.message || err));
  }
}

// zip 파일 안의 모든 항목이 실제로 정상 압축해제되는지 검사 (손상 여부 확인)
function isZipHealthy(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      e.getData(); // 손상되어 있으면 여기서 예외 발생
    }
    return true;
  } catch (_) {
    return false;
  }
}

// 24-176차: 여기 있던 syncResourcePacks() 를 지웠다. 내장 resourcepacks/ 폴더를 인스턴스로
// 복사해주던 함수인데, 24-94차에 호출부가 사라진 뒤로 아무도 안 부르는 죽은 코드였다
// (같은 이유로 syncMods / getModsSourceDir / getResourcePacksSourceDir 도 같이 지웠고,
//  package.json extraResources 에서도 mods/ resourcepacks/ 를 뺐다 - 24-175차).
// patchResourcePackFormat 은 유저가 직접 설치하는 리소스팩에도 쓰이므로 그대로 둔다.

async function ensureResourcePacksEnabled(packFiles, targetRoot) {
  const optionsPath = path.join(targetRoot || getRoot(), "options.txt");
  let lines = [];
  if (fs.existsSync(optionsPath)) {
    lines = (await fsp.readFile(optionsPath, "utf-8"))
      .split("\n")
      .filter((l) => l.trim().length > 0);
  }

  const upsert = (key, value) => {
    const line = `${key}:${value}`;
    const idx = lines.findIndex((l) => l.startsWith(key + ":"));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  };

  // "vanilla", "mod_resources" 같은 내장 항목이나 이미 "file/..." 형태로 들어온 항목에
  // file/ 을 또 붙이면 마인크래프트가 못 알아봅니다. 파일 이름에만 붙입니다.
  const BUILTIN_PACK_IDS = ["vanilla", "mod_resources", "programmer_art"];
  const resourcePacksValue = JSON.stringify(
    (packFiles || []).map((f) => {
      const name = String(f);
      if (name.indexOf("/") !== -1) return name;
      if (BUILTIN_PACK_IDS.indexOf(name) !== -1) return name;
      return `file/${name}`;
    })
  );
  upsert("resourcePacks", resourcePacksValue);
  // 예전에 형식이 안 맞아 "호환 안 됨"으로 찍혔던 기록이 있으면 여기서 강제로 비워서
  // 지금은 자동 패치된 상태인 팩이 계속 막히는 일이 없게 함
  upsert("incompatibleResourcePacks", "[]");

  await fsp.writeFile(optionsPath, lines.join("\n") + "\n", "utf-8");
  logToFile(`[리소스팩] options.txt에 기록함: ${optionsPath} -> resourcePacks:${resourcePacksValue}`);
}

// ----------------------------------------------------------------------------
// 4) 마인크래프트 실행 (mclc)
// ----------------------------------------------------------------------------
ipcMain.handle("launch:start", async () => {
  // 24-66차 신규: "업데이트중일 때 런처 실행 안되게 해줘" - 강제 업데이트가 진행 중(다운로드~
  // 설치 대기)이면 새로 게임을 켜지 못하게 막음. 이미 실행 중이던 게임은 이 검사와 무관하게
  // 그대로 계속됨(설치는 launcher.on("close")에서 게임 종료 후에 이어서 진행됨)
  if (isForcedUpdating) {
    return { ok: false, error: "업데이트를 설치하는 중이에요. 잠시 후 다시 시도해주세요." };
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    const authorization = await getAuthorizationForLaunch();
    const mode = store.get("launch_mode") || "server";

    let mcVersion, runRoot, memoryGB, windowWidth, windowHeight, fullscreen;
    let selectedServer = null;
    let activeProfile = null;

    if (mode === "profile") {
      activeProfile = findProfile(store.get("selected_profile_id"));
      if (!activeProfile) throw new Error("선택된 프로필이 없어요. 먼저 프로필을 골라주세요.");
    } else {
      // 24-94차: 서버 모드도 이제 "그 서버에 연결해둔 프로필"로 켭니다. 예전처럼 런처가
      // 서버용 모드/모드팩을 공용 폴더(getRoot())에 깔아주던 방식은 없어졌고, 폴더·로더·
      // 메모리·해상도·JVM 인수까지 전부 그 프로필 것을 그대로 씁니다. 달라지는 건 실행 직후
      // 그 서버로 바로 접속한다는 것(아래 quickPlay)뿐입니다.
      selectedServer = getSelectedServer();
      activeProfile = getLinkedProfileForServer(selectedServer);
      if (!activeProfile) {
        const err = new Error(
          `${selectedServer.name}에 들어갈 ${selectedServer.version} 프로필을 먼저 골라주세요.`
        );
        err.needsServerProfile = true; // 렌더러가 이걸 보고 서버 설정 창을 바로 열어줌
        throw err;
      }

      // 13차: 서버별 마지막 플레이 시각(서버 목록 정렬용)
      const serverLastPlayed = store.get("server_last_played") || {};
      serverLastPlayed[selectedServer.id] = new Date().toISOString();
      store.set("server_last_played", serverLastPlayed);
    }

    // 24-161차: 너굴마을에 연결된 프로필이면, 허용 목록에 없는 모드를 실행 전에 꺼둔다
    {
      const turnedOff = await enforceNeogulModPolicy(activeProfile.id);
      if (turnedOff.length) {
        notifyRenderer(
          `너굴마을에서 허용되지 않은 모드 ${turnedOff.length}개를 껐어요 (${turnedOff.slice(0, 3).join(", ")}${turnedOff.length > 3 ? " 외" : ""})`
        );
      }
    }

    mcVersion = activeProfile.mcVersion;
    runRoot = getProfileRoot(activeProfile.id);
    memoryGB = activeProfile.memoryGB;
    windowWidth = activeProfile.width;
    windowHeight = activeProfile.height;
    fullscreen = activeProfile.fullscreen;
    // 49-213차: 게임 안 "처음 설정"에서 고른 화면 모드를 이 프로필에 한 번 옮긴다(이후 프로필 설정에서 바꾸면 그게 이김)
    {
      const firstSetup = readFirstSetupPrefs();
      if (firstSetup && firstSetup.window !== undefined && activeProfile.firstSetupTs !== firstSetup.ts) {
        fullscreen = Number(firstSetup.window) === 1;
        const list = getProfiles();
        const pp = list.find((p) => p.id === activeProfile.id);
        if (pp) {
          pp.fullscreen = fullscreen;
          pp.firstSetupTs = firstSetup.ts;
          saveProfiles(list);
        }
      }
    }

    // 마지막으로 플레이한 시각 기록 (프로필 편집 화면에 "몇 시간 전" 형태로 표시하기 위함)
    // 24-94차: 서버로 들어가도 그 프로필로 플레이한 것이므로 같이 기록함
    {
      const list = getProfiles();
      const idx = list.findIndex((p) => p.id === activeProfile.id);
      if (idx >= 0) {
        list[idx].lastPlayedAt = new Date().toISOString();
        saveProfiles(list);
        activeProfile.lastPlayedAt = list[idx].lastPlayedAt;
      }
    }

    // 15차: loader가 "vanilla"인 프로필은 Fabric 준비 단계 자체를 건너뜀.
    // 24-2차: forge/neoforge면 해당 준비 함수를 대신 호출함. loader 필드가 없는 옛 프로필은 Fabric.
    // 24-94차: 서버 모드도 프로필의 loader를 따름(예전엔 서버 설정의 loader를 썼음).
    const isVanillaProfile = activeProfile?.loader === "vanilla";
    const profileLoader = activeProfile?.loader;

    // 24-79차: 자바 버전은 로더까지 봐야 정해진다(1.15~1.16 Fabric은 17, Forge는 8) - 그래서
    // profileLoader 계산을 자바 준비보다 앞으로 옮겼다.
    const javaFeatureVersion = getJavaFeatureVersionFor(mcVersion, profileLoader);
    const javaPathRaw = await ensureJava(signal, javaFeatureVersion);
    const javaPath = await ensureCustomIconJavaw(javaPathRaw);
    let customVersion;
    if (isVanillaProfile) {
      customVersion = null;
    } else if (profileLoader === "forge") {
      customVersion = await ensureForgeProfile(signal, mcVersion, runRoot, javaPath);
    } else if (profileLoader === "neoforge") {
      customVersion = await ensureNeoForgeProfile(signal, mcVersion, runRoot, javaPath);
    } else {
      customVersion = await ensureFabricProfile(signal, mcVersion, runRoot);
    }

    // 24-94차: 서버 모드의 모드팩/모드/리소스팩 자동 설치(syncServerModpack/syncMods/
    // syncResourcePacks)는 없어짐 - 서버도 연결된 프로필에 유저가 넣은 구성을 그대로 씀.

    // 25차: 노바 내장 모드는 예외 - 프로필/서버 어느 쪽이든 Fabric으로 실행할 때 항상
    // 자동 주입함(유저가 넣은 모드가 아니라 클라이언트 자체 기능이므로. syncNovaMod 주석 참고).
    // 24-46차: Fabric API도 같은 이유로 항상 자동 주입함(syncFabricApiMod 주석 참고).
    // 24-50차: Mod Menu도 같은 이유로 항상 자동 주입함(syncModMenuMod 주석 참고).
    // ⚠️ 서버 모드에서는 반드시 syncMods 다음에 불러야 함 - syncMods가 "목록에 없는 jar 정리"
    // 단계에서 먼저 넣어둔 노바 모드/Fabric API/Mod Menu jar를 지워버리기 때문.
    // 49-213차: 이 컴퓨터에서 처음 설정을 한 번도 안 했으면 서버로 바로 접속하지 않고, 모드가 처음 설정을 띄운 뒤 들어가게 넘긴다
    let deferServerForSetup = null;
    if (!isVanillaProfile && profileLoader !== "forge" && profileLoader !== "neoforge") {
      await syncNovaMod(mcVersion, runRoot);
      await syncFabricApiMod(mcVersion, runRoot);
      await syncModMenuMod(mcVersion, runRoot);
      if (selectedServer && !readFirstSetupPrefs() && hasNewModJar(runRoot)) {
        deferServerForSetup = selectedServer;
        logToFile(`[처음 설정] 아직 안 해서 ${selectedServer.name} 접속은 설정을 마친 뒤로 미룸`);
      }
      // 24-184차: 너굴마을 전용 모드체커도 고정 주입(연결이 아니면 알아서 빠짐)
      await syncNeogulModChecker(activeProfile.id, runRoot);

      // 25-2차: 런처 전용 잠금 토큰 기록 (NOVA_LAUNCH_SECRET 주석 참고)
      // 49-23차(모드 소셜): 같은 파일에 게임 안 "소셜" 화면이 쓸 정보를 같이 실어 보냄 -
      //  site     : 노바 계정 id/닉네임(친구 목록은 노바 계정 단위)
      //  supabase : 친구 목록 조회용 REST 주소/anon 키(anon 키는 원래 클라이언트에 박혀 배포되는 공개 키)
      //  accounts : 이 노바 계정에 "등록된" 마인크래프트 계정들의 uuid/이름/액세스 토큰(게임 안에서 프로필 전환용,
      //             토큰은 실행 직전에 갱신). 활성 계정은 어차피 --accessToken으로 넘어가는 값이라 노출 수준은 같음.
      try {
        const ts = Date.now();
        const sig = crypto.createHmac("sha256", NOVA_LAUNCH_SECRET).update("NovaClient::" + ts).digest("hex");
        const social = await collectSocialBridgeForMod().catch((err) => {
          logToFile("[노바 모드] 소셜 정보 수집 실패(친구/프로필 전환만 비활성): " + (err?.message || err));
          return {};
        });
        await fsp.writeFile(path.join(runRoot, ".nova-launch.json"), JSON.stringify({ ts, sig, ...social, launcherVersion: app.getVersion() }), "utf-8");
        // 49-207차: 새 모드(Luna's Light)는 .luna-launch.json + "LunaClient::" 서명을 본다
        await fsp.writeFile(path.join(runRoot, ".luna-launch.json"), JSON.stringify({
          ts, sig: launchSigFor("LunaClient::", ts), ...social, launcherVersion: app.getVersion(),
          setupPrefsPath: firstSetupPrefsPath(),   // 49-213차: 처음 설정 공용 기록
          ...(deferServerForSetup ? {
            pendingServer: `${deferServerForSetup.host}:${deferServerForSetup.port}`,
            pendingServerName: deferServerForSetup.name || "",
          } : {}),
        }), "utf-8");
        startNowPlayingBridge(runRoot);   // 49-74차(모드 4-5): 듣고 있는 노래를 게임 폴더에 적어줌
      } catch (err) {
        logToFile("[노바 모드] 실행 토큰 기록 실패(모드가 비활성 상태로 뜰 수 있음): " + (err?.message || err));
      }
    }

    await applyConfiguredOptions(runRoot, fullscreen);

    reportProgress("game", 0, "마인크래프트 파일 확인 중...");

    const launcher = new Client();

    const opts = {
      authorization,
      root: runRoot,
      version: {
        number: mcVersion,
        type: "release",
        custom: customVersion || undefined,
      },
      memory: {
        max: `${memoryGB}G`,
        min: `${memoryGB}G`,
      },
      javaPath,
      window: {
        width: windowWidth,
        height: windowHeight,
      },
    };

    // 프로필에 JVM 인수가 지정돼 있으면 그대로 전달 (공백 기준으로 나눠서 배열로)
    if (activeProfile?.jvmArgs) {
      opts.customArgs = activeProfile.jvmArgs.split(/\s+/).filter(Boolean);
    }
    // 24-60차 후속: Forge/NeoForge는 mclc가 못 읽는 버전 JSON의 arguments.jvm(모듈 접근
    // 인자)을 직접 뽑아서 얹어줘야 자바가 죽지 않음 - getModernLoaderJvmArgs() 주석 참고
    if ((profileLoader === "forge" || profileLoader === "neoforge") && customVersion) {
      const loaderJvmArgs = getModernLoaderJvmArgs(runRoot, customVersion);
      if (loaderJvmArgs.length) {
        opts.customArgs = (opts.customArgs || []).concat(loaderJvmArgs);
      }
    }

    // 서버 모드일 때만 접속 서버 자동 지정 (프로필 모드는 그냥 싱글/자유 플레이용)
    // 49-213차: 처음 설정을 기다리는 중이면 바로 접속하지 않는다(모드가 설정을 마친 뒤 들어감)
    if (selectedServer && deferServerForSetup) {
      upsertServerInDat(runRoot, selectedServer);
    } else if (selectedServer) {
      opts.server = { host: selectedServer.host, port: selectedServer.port };
      // 24-183차: 게임 안 멀티플레이 목록에도 넣어준다(+ 서버 리소스팩 자동 사용)
      upsertServerInDat(runRoot, selectedServer);
      opts.quickPlay = {
        type: "multiplayer",
        identifier: `${selectedServer.host}:${selectedServer.port}`,
      };
    }

    // 24-157차: 파일 하나 기준이던 퍼센트를 종류별 비중 기반으로 교체(위 createGameProgressTracker 주석)
    const gameProgress = createGameProgressTracker();
    launcher.on("progress", (e) => gameProgress.onProgress(e));
    launcher.on("download-status", (e) => gameProgress.onDownloadStatus(e));
    launcher.on("data", (line) => logToFile(String(line)));
    launcher.on("debug", (line) => logToFile("[debug] " + String(line)));
    let weLaunchedThis = false; // 우리가 실제로 이 게임을 켰는지 확인용 안전장치
    let mainRunPid = null;      // 24-149차: runningInstances 에 등록해둔 pid
    const launchStartedAtMs = Date.now(); // 24-14차: 이번 실행 시작 시각 - 예전 세션의 남은 크래시 리포트를 걸러내는 기준

    launcher.on("close", async (code) => {
      logToFile("게임 프로세스 종료, 코드: " + code);
      gameProcess = null;
      unregisterRunningInstance(mainRunPid); // 24-149차: 남은 인스턴스가 있으면 버튼은 그대로 유지됨
      mainRunPid = null;
      stopPresenceUpload(true); // 24-67차: 접속 정보 업로드 중단 + 서버 정보 비우기
      stopNowPlayingBridge();   // 49-74차: 노래 브리지도 같이 끔(+ 남은 파일 삭제)
      stopRecordWatcher();      // 49-76차: 녹화 중이면 파일을 닫고 감시를 끝냄
      stopReloginWatcher();     // 49-106차: 세션 복구 요청 감시 종료

      // 우리가 실제로 이번에 켠 게임이 아니면(안전장치) 아무 반응도 하지 않음
      if (!weLaunchedThis) {
        logToFile("우리가 직접 켠 게임이 아닌 것으로 판단, 무시함");
        return;
      }

      // 15차 신규(퀘스트): 실제로 게임이 켜져 있던 시간만큼 일일/주간 퀘스트 플레이타임에 반영
      if (questSessionStartedAt) {
        const seconds = Math.max(0, Math.round((Date.now() - questSessionStartedAt) / 1000));
        addQuestPlaySeconds(seconds);
        questSessionStartedAt = null;
      }

      // 24-66차 신규: 게임이 실행 중이라 미뤄뒀던 강제 업데이트가 있다면(설치까지 이미
      // 준비돼 있음), 메인 창을 다시 보여주는 대신 곧바로 설치를 이어서 진행함 - 창이
      // 한 번 보였다가 곧바로 다시 업데이트 창 뒤로 숨겨지는 깜빡임을 막기 위해 여기서
      // 갈림길을 나눔(둘 다 하지 않고 하나만)
      if (pendingForcedInstallAfterGame && updateReady) {
        pendingForcedInstallAfterGame = false;
        logToFile("게임 종료 감지 - 미뤄뒀던 강제 업데이트 설치를 시작함");
        createUpdateWindow();
        setUpdateWindowPercent(100);
        setTimeout(() => installUpdateNow(), 800);
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        // 24-193차: 숨겨뒀거나 최소화해둔 창도 제대로 앞으로 꺼낸다(예전엔 show() 하나뿐이라
        // 최소화 상태면 작업표시줄에 그대로 있었다)
        showMainWindowNow();
        mainWindow.webContents.send("launch:game-closed", { code });

        // 24-14차: "게임 X 눌러서 종료하거나 Stop 눌러서 종료할 때 크래시 떴다고" - 여기 조건이
        // code !== 0 뿐이었는데, Stop 버튼으로 강제 종료(taskkill /F, SIGTERM)하거나 게임
        // 창을 그냥 X로 닫으면 정상 종료(0)가 아니라 code가 null이거나 0이 아닌 값으로 오는
        // 경우가 많아서, 유저가 일부러 끈 것까지 전부 "크래시"로 오판하고 있었음. Stop 버튼을
        // 눌렀을 때 미리 표시해두는 stoppedByUser 플래그를 같이 확인해서, 유저가 직접 끈 경우엔
        // 크래시 리포트를 띄우지 않음
        if (code !== 0 && !stoppedByUser) {
          const crashText = await findLatestCrashReport(launchStartedAtMs);
          if (crashText) {
            mainWindow.webContents.send("game:crashed", { text: crashText });
          }
        }
        stoppedByUser = false;
      }
    });

    await clearModPresenceFile(runRoot); // 24-79차: 지난 실행이 남긴 접속 정보 파일 정리
    fsp.unlink(path.join(runRoot, ".nova-discord.json")).catch(() => {}); // 49-125차: 지난 실행의 디스코드 표시 흔적
    fsp.unlink(path.join(runRoot, ".luna-discord.json")).catch(() => {});
    gameProcess = await launcher.launch(opts);
    gameProgress.done(); // 24-157차: 여기서만 100% - 그 전에는 96% 를 넘지 않음
    mainRunPid = registerRunningInstance(gameProcess, {
      profileId: activeProfile?.id || null,
      serverId: selectedServer?.id || null, // 24-194차: 목록의 "플레이 중" 표시용
      mode: mode === "profile" ? "profile" : "server",
    });
    startRecordWatcher(runRoot, gameProcess && gameProcess.pid);   // 49-76차(모드 6-5): 녹화 요청 감시
    startReloginWatcher(runRoot);                                   // 49-106차(모드: 세션 복구): 세션 새로고침 요청 감시
    weLaunchedThis = true; // launch()가 성공적으로 끝난 뒤부터만 "우리가 켰다"고 인정
    stoppedByUser = false; // 새 게임 세션 시작 - 이전 세션의 플래그가 남아있지 않게 초기화
    questSessionStartedAt = Date.now(); // 15차 신규(퀘스트): 플레이타임 측정 시작점

    // 24-67차 신규: 접속 정보 업로드 시작 - 서버 모드면 런처가 이미 아는 서버 주소/이름을
    // 즉시 올리고(모드 설치 여부와 무관하게 바로 반영됨), 이후 20초마다 .nova-presence.json을
    // 다시 읽어 자유 플레이 중 실제로 들어간 서버까지 반영함(Fabric + 모드 설치 시에만).
    {
      const mcName = authorization?.profile?.name || authorization?.name || store.get("mc_profile")?.name || null;
      startPresenceUpload(runRoot, {
        serverAddress: selectedServer ? `${selectedServer.host}:${selectedServer.port}` : null,
        serverName: selectedServer ? selectedServer.name : null,
        mcName,
      });
    }

    reportProgress("game", 100, "실행 완료");
    // 10-1: 게임이 켜져도 런처 창을 숨기지 않고 그대로 켜둠 (Play 버튼이 Stop으로 바뀜)
    // - 17차: 설정 > 클라이언트에서 "마크를 켰을 때" 동작을 고를 수 있게 함
    //   "stay"(기존 그대로 유지) / "background"(트레이로 숨김) / "quit"(런처 완전 종료)
    applyOnLaunchBehavior();

    return { ok: true };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, aborted: true };
    }
    // 24-94차: 서버에 연결된 프로필이 없음 - 오류가 아니라 설정이 필요한 것(렌더러가 설정 창을 엶)
    if (err?.needsServerProfile) {
      return { ok: false, needsServerProfile: true, serverId: getSelectedServer().id, error: String(err.message) };
    }
    logToFile("실행 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  } finally {
    currentAbortController = null;
  }
});

// 10-1: 실행 중인 게임을 런처에서 바로 종료 (Play → Stop 버튼)
ipcMain.handle("launch:stop", async () => {
  if (!gameProcess || !gameProcess.pid) return { ok: false, error: "실행 중인 게임이 없어요." };
  try {
    stoppedByUser = true; // 24-14차: 이 종료는 유저가 직접 누른 것 - close 핸들러가 크래시로 오판하지 않게 함
    if (process.platform === "win32") {
      // Windows에서는 그냥 kill()만 하면 자식 프로세스(javaw)가 안 죽는 경우가 있어서 트리째로 종료
      await new Promise((resolve) => {
        exec(`taskkill /pid ${gameProcess.pid} /T /F`, () => resolve());
      });
    } else {
      gameProcess.kill("SIGTERM");
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-51차: "프로필로 실행 중일 때 PLAY를 또 누르면 같은 프로필을 하나 더(복제) 실행하기" -
// 기존 launch:start는 gameProcess/currentAbortController/진행률 표시/디스코드 상태/크래시
// 감지를 전부 "메인" 실행 하나만 추적하도록 짜여 있어서, 그 상태를 그대로 재사용하면 이미 켜진
// 인스턴스를 덮어써버림. 그래서 그런 전역 상태를 전혀 건드리지 않는 완전히 별도의 mclc
// Client 인스턴스를 새로 만들어 그냥 실행만 시키고 끝냄(진행률 바 갱신 X, 종료 이벤트 감지도
// 안 함 - 여러 개를 동시에 띄워도 서로 안 꼬이게 하기 위한 의도적 설계).
// 24-54차: "정지 대신 추가 실행하기"로 이름이 바뀌면서 렌더러가 이 핸들러를 재사용함 - 이
// 핸들러 자체의 동작은 그대로임. 프로필 모드 전용(서버 모드에선 렌더러가 이 핸들러를 안 부름).
ipcMain.handle("launch:start-duplicate", async () => {
  // 24-66차 신규: 위 launch:start와 동일한 이유로, 강제 업데이트 중에는 추가 실행도 막음
  if (isForcedUpdating) {
    return { ok: false, error: "업데이트를 설치하는 중이에요. 잠시 후 다시 시도해주세요." };
  }
  duplicateLaunchesInFlight++; // 24-93차: 준비 중엔 프로필 폴더 이름 변경을 막음(isProfileFolderBusy)
  try {
    const activeProfile = findProfile(store.get("selected_profile_id"));
    if (!activeProfile) throw new Error("선택된 프로필이 없어요. 먼저 프로필을 골라주세요.");
    // 24-149차: "추가 실행도 눌렀을 때 게이지가 보여야지, 안 보이니까 실행되는 건지 아닌지
    // 모르겠고" - 추가 실행은 진행률을 아예 안 보내고 있었다(24-51차에서 메인 실행 상태를
    // 안 건드리려고 일부러 뺐음). 진행률 이벤트는 전역 상태를 건드리지 않으므로 단계마다
    // 보내줘도 안전하다. 파일별 퍼센트까지는 안 세고, 단계가 끝날 때마다 채워 준다.
    reportProgress("java", 0, "준비 중...");

    await enforceNeogulModPolicy(activeProfile.id); // 24-161차
    const mcVersion = activeProfile.mcVersion;
    const runRoot = getProfileRoot(activeProfile.id);
    const memoryGB = activeProfile.memoryGB;
    const windowWidth = activeProfile.width;
    const windowHeight = activeProfile.height;
    const fullscreen = activeProfile.fullscreen;

    const authorization = await getAuthorizationForLaunch();
    const isVanillaProfile = activeProfile?.loader === "vanilla";
    const profileLoader = activeProfile?.loader;
    const javaFeatureVersion = getJavaFeatureVersionFor(mcVersion, profileLoader); // 24-79차: 로더까지 봄
    const javaPathRaw = await ensureJava(undefined, javaFeatureVersion, { silent: true });
    const javaPath = await ensureCustomIconJavaw(javaPathRaw);
    reportProgress("java", 100, "준비 완료");
    let customVersion;
    if (isVanillaProfile) {
      customVersion = null;
    } else if (profileLoader === "forge") {
      customVersion = await ensureForgeProfile(undefined, mcVersion, runRoot, javaPath, { silent: true });
    } else if (profileLoader === "neoforge") {
      customVersion = await ensureNeoForgeProfile(undefined, mcVersion, runRoot, javaPath, { silent: true });
    } else {
      customVersion = await ensureFabricProfile(undefined, mcVersion, runRoot, { silent: true });
    }
    reportProgress("mods-meta", 100, "준비 완료");

    if (!isVanillaProfile && profileLoader !== "forge" && profileLoader !== "neoforge") {
      await syncNovaMod(mcVersion, runRoot);
      await syncFabricApiMod(mcVersion, runRoot);
      await syncModMenuMod(mcVersion, runRoot);
      // 24-184차: 너굴마을 전용 모드체커도 고정 주입(연결이 아니면 알아서 빠짐)
      await syncNeogulModChecker(activeProfile.id, runRoot);
      try {
        const ts = Date.now();
        const sig = crypto.createHmac("sha256", NOVA_LAUNCH_SECRET).update("NovaClient::" + ts).digest("hex");
        const social = await collectSocialBridgeForMod().catch((err) => {
          logToFile("[노바 모드][복제 실행] 소셜 정보 수집 실패: " + (err?.message || err));
          return {};
        });
        await fsp.writeFile(path.join(runRoot, ".nova-launch.json"), JSON.stringify({ ts, sig, ...social, launcherVersion: app.getVersion() }), "utf-8");
        // 49-207차: 새 모드(Luna's Light)는 .luna-launch.json + "LunaClient::" 서명을 본다
        await fsp.writeFile(path.join(runRoot, ".luna-launch.json"), JSON.stringify({ ts, sig: launchSigFor("LunaClient::", ts), ...social, launcherVersion: app.getVersion(), setupPrefsPath: firstSetupPrefsPath() }), "utf-8");
        startNowPlayingBridge(runRoot);   // 49-74차(모드 4-5): 듣고 있는 노래를 게임 폴더에 적어줌
      } catch (err) {
        logToFile("[노바 모드][복제 실행] 실행 토큰 기록 실패: " + (err?.message || err));
      }
    }

    reportProgress("mods", 100, "준비 완료");
    await applyConfiguredOptions(runRoot, fullscreen);
    reportProgress("resourcepacks", 100, "준비 완료");

    const launcher = new Client();
    const opts = {
      authorization,
      root: runRoot,
      version: {
        number: mcVersion,
        type: "release",
        custom: customVersion || undefined,
      },
      memory: {
        max: `${memoryGB}G`,
        min: `${memoryGB}G`,
      },
      javaPath,
      window: {
        width: windowWidth,
        height: windowHeight,
      },
    };
    if (activeProfile?.jvmArgs) {
      opts.customArgs = activeProfile.jvmArgs.split(/\s+/).filter(Boolean);
    }
    // 24-60차 후속: getModernLoaderJvmArgs() 주석 참고 - 추가 실행하기에서도 동일하게 적용
    if ((profileLoader === "forge" || profileLoader === "neoforge") && customVersion) {
      const loaderJvmArgs = getModernLoaderJvmArgs(runRoot, customVersion);
      if (loaderJvmArgs.length) {
        opts.customArgs = (opts.customArgs || []).concat(loaderJvmArgs);
      }
    }
    launcher.on("data", (line) => logToFile("[복제 실행] " + String(line)));
    launcher.on("debug", (line) => logToFile("[복제 실행][debug] " + String(line)));
    // 24-149차: 추가 실행도 같은 진행률 채널로 보여줌
    // 24-157차: 메인 실행과 같은 추적기를 씀(파일 하나 기준 퍼센트 버그 제거)
    const dupProgress = createGameProgressTracker();
    launcher.on("progress", (e) => dupProgress.onProgress(e));
    launcher.on("download-status", (e) => dupProgress.onDownloadStatus(e));

    // 24-149차: 추가로 켠 게임도 runningInstances 에 등록해서, 여러 개 켜놓고 하나만 꺼도
    // 버튼이 곧장 PLAY 로 돌아가지 않게 함. close 는 launch() 보다 먼저 걸어둬야 놓치지 않음.
    let dupPid = null;
    let dupClosed = false;
    launcher.on("close", () => {
      dupClosed = true;
      unregisterRunningInstance(dupPid);
      dupPid = null;
    });

    const dupProc = await launcher.launch(opts);
    dupPid = registerRunningInstance(dupProc, { profileId: activeProfile.id, mode: "profile" });
    // launch() 가 끝나기 전에 이미 꺼졌다면(아주 짧게 죽는 경우) 등록을 바로 되돌린다
    if (dupClosed) {
      unregisterRunningInstance(dupPid);
      dupPid = null;
    }
    reportProgress("game", 100, "실행 중");
    return { ok: true };
  } catch (err) {
    logToFile("[복제 실행] 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  } finally {
    duplicateLaunchesInFlight--;
  }
});

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:get-creator", () => CONFIG.CREATOR_NAME);
ipcMain.handle("app:get-license", () => CONFIG.LICENSE_TEXT);
ipcMain.handle("app:get-business-info", () => CONFIG.BUSINESS_INFO); // 17차 신규

// ----------------------------------------------------------------------------
// 설정 (메모리 / 음량 / 디스코드 링크)
// ----------------------------------------------------------------------------
ipcMain.handle("settings:get", () => getSettings());
ipcMain.handle("settings:set", (_e, partial) => {
  // 24-136차: 글꼴 배율은 0.5 ~ 2.0 (0.1 단위) 범위를 벗어나지 않게 여기서 한 번 더 조임
  if (partial && Object.prototype.hasOwnProperty.call(partial, "uiFontScale")) {
    const n = Number(partial.uiFontScale);
    const clamped = Number.isFinite(n) ? Math.min(2, Math.max(0.5, Math.round(n * 10) / 10)) : 1;
    partial = { ...partial, uiFontScale: clamped };
  }
  const merged = setSettings(partial || {});
  // 17차: autostartMode가 바뀌면 즉시 OS 시작 프로그램 등록에도 반영
  if (partial && Object.prototype.hasOwnProperty.call(partial, "autostartMode")) applyAutostartSetting();
  return merged;
});

// 7-1: 지원 언어는 ko/en 둘뿐 - 24-14차부터 getSettings()가 항상 둘 중 하나로 확정된 값을
// 돌려주므로(예전의 "system" 자동 추적 로직은 거기서 한 번만 처리되고 여기선 그대로 씀)
function resolveEffectiveLanguage() {
  return getSettings().language === "en" ? "en" : "ko";
}
ipcMain.handle("settings:get-effective-language", () => resolveEffectiveLanguage());

// 7-2: 지금 앱이 지원하는 마인크래프트 버전들에 필요한 자바 버전(8/17/21)과, 그게 실제로
// 이 PC에 설치돼 있는지/어디 있는지 읽기 전용으로 보여줌 (Modrinth의 "Java 위치" 설정 화면 참고)
ipcMain.handle("settings:get-java-info", () => {
  try {
    const profiles = getProfiles();
    // 24-79차: 자바 버전이 로더에 따라 갈리므로(1.15~1.16 Fabric 17 / Forge 8) 버전만이 아니라
    // (버전, 로더) 쌍으로 모은다. 서버 목록의 버전·로더도 같이 넣어 서버 모드도 반영됨.
    const needed = new Map(); // "버전\u0000로더" -> {mcVersion, loader}
    const addNeeded = (mcVersion, loader) => {
      if (!mcVersion) return;
      needed.set(`${mcVersion}\u0000${loader || ""}`, { mcVersion, loader });
    };
    for (const p of profiles) addNeeded(p.mcVersion, p.loader);
    for (const sv of getAllServers()) addNeeded(sv.version, sv.loader || CONFIG.LOADER);
    if (needed.size === 0) addNeeded("1.21.11", CONFIG.LOADER);

    // 자바 버전(8/17/21/25) 하나당 이걸 필요로 하는 마인크래프트 버전들을 묶음
    const byFeatureVersion = new Map();
    for (const { mcVersion, loader } of needed.values()) {
      const fv = getJavaFeatureVersionFor(mcVersion, loader);
      if (!byFeatureVersion.has(fv)) byFeatureVersion.set(fv, []);
      if (!byFeatureVersion.get(fv).includes(mcVersion)) byFeatureVersion.get(fv).push(mcVersion);
    }

    const result = Array.from(byFeatureVersion.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([javaFeatureVersion, mcVersions]) => {
        const javaPath = getJavaExecutable(javaFeatureVersion);
        return {
          javaFeatureVersion,
          mcVersions: mcVersions.sort(),
          installed: !!javaPath,
          path: javaPath || null,
          folder: getRuntimeDir(javaFeatureVersion),
        };
      });
    return result;
  } catch (err) {
    logToFile("자바 설치 정보 조회 실패: " + (err?.message || err));
    return [];
  }
});

// 24-58차: "배경음악 설정이랑 음악 아예 전부 삭제하자" - 여기 있던 런처 배경음악 기능
// (music/ 폴더 mp3 목록을 내려주던 getMusicSourceDir()/ipcMain.handle("music:list", ...))을
// 통째로 제거함. music/ 폴더의 mp3 파일 자체는 이 세션에서 PC 파일을 지울 방법이 없어
// 그대로 남아있으니, 편하실 때 폴더째로 직접 지워주셔도 됩니다(더 이상 어디서도 참조 안 함).

// ----------------------------------------------------------------------------
// 홈 화면 스크린샷 슬라이드쇼
// ----------------------------------------------------------------------------
function getScreenshotsSourceDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "screenshots");
  }
  return path.join(__dirname, "screenshots");
}

ipcMain.handle("screenshots:list", async () => {
  const dir = getScreenshotsSourceDir();
  if (!fs.existsSync(dir)) return [];
  const files = (await fsp.readdir(dir))
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  return files.map((f) => path.join(dir, f).replace(/\\/g, "/"));
});

// ----------------------------------------------------------------------------
// 효과음 (코인 획득 등)
// ----------------------------------------------------------------------------
function getSfxSourceDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "sfx");
  }
  return path.join(__dirname, "sfx");
}

ipcMain.handle("sfx:get-coin", () => {
  const filePath = path.join(getSfxSourceDir(), "coin.mp3");
  if (!fs.existsSync(filePath)) return null;
  return filePath.replace(/\\/g, "/");
});

// ----------------------------------------------------------------------------
// 디스코드 버튼 (설정에서 바꾸는 게 아니라 CONFIG.DISCORD_URL 고정값 사용)
// ----------------------------------------------------------------------------
ipcMain.handle("app:open-external", (_e, url) => {
  // https:// 로 시작하는 것만 허용 (임의 프로토콜 실행 방지)
  if (typeof url === "string" && /^https:\/\//.test(url)) {
    shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

// 지금 어느 모드로 플레이 중이냐에 따라 실제 게임 파일(모드/리소스팩/세이브 등)이 있는 폴더를 보여줌
// (서버 모드면 공유 인스턴스 폴더, 프로필 모드면 그 프로필 전용 폴더)
ipcMain.handle("app:open-game-folder", () => {
  const mode = store.get("launch_mode") || "server";
  let dir;
  if (mode === "profile") {
    const profile = findProfile(store.get("selected_profile_id"));
    dir = profile ? getProfileRoot(profile.id) : getRoot();
  } else {
    // 24-94차: 서버 모드는 그 서버에 연결된 프로필 폴더
    const linked = getLinkedProfileForServer(getSelectedServer());
    dir = linked ? getProfileRoot(linked.id) : getRoot();
  }
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});

ipcMain.handle("app:get-system-is-dark", () => nativeTheme.shouldUseDarkColors);

nativeTheme.on("updated", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("system-theme-changed", nativeTheme.shouldUseDarkColors);
  }
});

ipcMain.handle("app:check-update-now", async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, hasResult: !!result };
  } catch (err) {
    // 24-70차: "업데이트 확인 오류 뭐야 이거?" - GitHub 쪽 요청이 막히거나(방화벽/보안
    // 프로그램/일시적 API 제한 등) 예상 밖 응답을 받으면, electron-updater가 응답 헤더까지
    // 통째로 들어간 매우 긴 원본 에러 메시지(err.message)를 던짐. 예전엔 이 원본 문자열을
    // 그대로 사용자 토스트에 꽂아버려서, 화면 위쪽에 "Turbo-Frame, X-Requested-With, ...
    // x-frame-options: deny" 같은 알아볼 수 없는 텍스트 덩어리가 그대로 떴었음. 원본은
    // launcher.log에만 남기고, 사용자에게는 짧고 이해할 수 있는 문구만 보여줌
    logToFile("수동 업데이트 확인 실패: " + (err?.stack || err));
    return {
      ok: false,
      error: "GitHub에서 업데이트 정보를 가져오지 못했어요. 네트워크 상태를 확인하고 잠시 후 다시 시도해주세요.",
    };
  }
});

ipcMain.handle("app:open-discord", () => {
  if (CONFIG.DISCORD_URL) {
    shell.openExternal(CONFIG.DISCORD_URL);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle("app:open-releases", () => {
  if (CONFIG.GITHUB_RELEASES_URL) {
    shell.openExternal(CONFIG.GITHUB_RELEASES_URL);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle("app:open-website", () => {
  if (CONFIG.WEBSITE_URL) {
    shell.openExternal(CONFIG.WEBSITE_URL);
    return { ok: true };
  }
  return { ok: false };
});

// 24-31차 신규: 설정 > 정보 > 커뮤니티의 "상점" 버튼 - 코인 구매(충전) 페이지를 기본 브라우저로 바로 엶
ipcMain.handle("app:open-coins-shop", () => {
  if (CONFIG.COINS_BUY_URL) {
    shell.openExternal(CONFIG.COINS_BUY_URL);
    return { ok: true };
  }
  return { ok: false };
});

// ----------------------------------------------------------------------------
// 업데이트 내역
// ----------------------------------------------------------------------------
ipcMain.handle("app:get-changelog", () => CHANGELOG);

// ----------------------------------------------------------------------------
// 공지사항 배너 (GitHub의 announcement.json 파일을 직접 읽어옴 -> 앱 업데이트 없이 즉시 반영)
// ----------------------------------------------------------------------------
async function fetchAnnouncement() {
  try {
    const res = await globalThis.fetch(CONFIG.ANNOUNCEMENT_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.active || !data.message) return null;

    const seenId = store.get("dismissed_announcement_id");
    return { ...data, unread: seenId !== data.id };
  } catch (err) {
    logToFile("공지사항 조회 실패: " + (err?.message || err));
    return null;
  }
}

ipcMain.handle("announcement:get", async () => fetchAnnouncement());

// ----------------------------------------------------------------------------
// 19차: 소식(News) - 포럼 공지사항과는 별개로, 개발자가 직접 올리는 이벤트/소식을 여러
// 박스(카드)로 보여줌. 위 announcement.json과 같은 원리로 news.json을 GitHub 저장소에
// 두고 그 안 내용을 그대로 가져와서 카드로 렌더링함 - 앱을 새로 배포하지 않아도 저장소의
// news.json만 수정하면 바로 반영됨
// ----------------------------------------------------------------------------
async function fetchNews() {
  try {
    const res = await globalThis.fetch(CONFIG.NEWS_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.items)) return [];
    return data.items;
  } catch (err) {
    logToFile("소식 조회 실패: " + (err?.message || err));
    return [];
  }
}
ipcMain.handle("news:get", async () => fetchNews());

// ============================================================================
// 24-200차: 마인크래프트 공식 소식 (번역본 + 원문 링크)
// "그 소식에는 minecraft.net/en-us/article 여기 올라오는 거 번역본이랑 링크해서 올려줘"
//
// minecraft.net 페이지를 긁지 않고, 공식 런처가 쓰는 뉴스 피드를 그대로 받는다
// (launchercontent.mojang.com/news.json). 페이지 구조가 바뀌어도 안 깨지고, 항목마다
// minecraft.net 기사 주소(readMoreLink)가 들어 있어서 "원문 보기"를 바로 걸 수 있다.
//
// 번역은 이미 있는 explore:translate 와 같은 방법(구글 무료 엔드포인트)을 쓴다. 기사마다
// 매번 번역하면 느리고 요청도 많아지니, 제목/요약만 번역하고 결과를 디스크에 캐시해 둔다.
// 번역이 실패하면 영어 원문을 그대로 보여준다 - 소식이 아예 안 뜨는 것보다 낫다.
// ============================================================================
const MC_NEWS_URL = "https://launchercontent.mojang.com/news.json";
const MC_NEWS_IMAGE_BASE = "https://launchercontent.mojang.com/";
const MC_NEWS_TTL = 60 * 60 * 1000; // 1시간
const MC_NEWS_MAX = 12;
let mcNewsCache = null; // { at, items }

function mcNewsTransCache() {
  const m = store.get("mc_news_translations");
  return m && typeof m === "object" ? m : {};
}

// 구글 무료 엔드포인트. explore:translate 와 같은 방식이고, 실패하면 원문을 그대로 돌려준다.
async function translateToKorean(text) {
  const src = String(text || "").trim();
  if (!src) return "";
  try {
    // 24-201차: 공식 소식에도 주소가 섞여 들어오므로 같은 방식으로 보호한다
    const { masked, urls } = maskUrlsForTranslate(src.slice(0, 1200));
    const params = new URLSearchParams({ client: "gtx", sl: "en", tl: "ko", dt: "t", q: masked });
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
    if (!res.ok) return src;
    const data = await res.json();
    const out = (data?.[0] || []).map((seg) => seg?.[0] || "").join("");
    return unmaskUrlsAfterTranslate(out, urls).trim() || src;
  } catch (_) {
    return src;
  }
}

async function fetchMinecraftNews() {
  if (mcNewsCache && Date.now() - mcNewsCache.at < MC_NEWS_TTL) return mcNewsCache.items;
  try {
    const res = await fetch(MC_NEWS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    // 피드가 entries 로 오는데, 혹시 모양이 바뀌어도 버티도록 items 도 같이 본다
    const raw = Array.isArray(data?.entries) ? data.entries : Array.isArray(data?.items) ? data.items : [];

    // 자바 에디션 소식을 먼저 보여준다(이 런처는 자바판 전용이라 베드락 소식은 덜 쓸모 있다)
    const sorted = raw.slice().sort((a, b) => {
      const aj = /java/i.test(a?.category || "") ? 0 : 1;
      const bj = /java/i.test(b?.category || "") ? 0 : 1;
      if (aj !== bj) return aj - bj;
      return new Date(b?.date || 0) - new Date(a?.date || 0);
    });

    const cache = mcNewsTransCache();
    let cacheChanged = false;
    const items = [];
    for (const e of sorted.slice(0, MC_NEWS_MAX)) {
      const id = String(e?.id || e?.title || "");
      if (!id) continue;
      let tr = cache[id];
      if (!tr) {
        tr = {
          title: await translateToKorean(e.title),
          text: await translateToKorean(e.text),
        };
        cache[id] = tr;
        cacheChanged = true;
      }
      const img = e?.playPageImage?.url || e?.newsPageImage?.url || null;
      items.push({
        id,
        title: tr.title || e.title || "",
        titleEn: e.title || "",
        text: tr.text || e.text || "",
        category: e.category || "",
        date: e.date || null,
        // 공식 피드의 링크는 "/article/..." 처럼 앞이 잘려 오는 경우가 있어 붙여준다
        link: e.readMoreLink
          ? e.readMoreLink.startsWith("http")
            ? e.readMoreLink
            : `https://www.minecraft.net${e.readMoreLink.startsWith("/") ? "" : "/"}${e.readMoreLink}`
          : "https://www.minecraft.net/en-us/article",
        image: img ? (img.startsWith("http") ? img : MC_NEWS_IMAGE_BASE + img.replace(/^\//, "")) : null,
      });
    }
    if (cacheChanged) {
      // 캐시가 끝없이 커지지 않게 최근 60개만 남긴다
      const keys = Object.keys(cache);
      if (keys.length > 60) {
        for (const k of keys.slice(0, keys.length - 60)) delete cache[k];
      }
      store.set("mc_news_translations", cache);
    }
    mcNewsCache = { at: Date.now(), items };
    logToFile(`[소식] 마인크래프트 공식 소식 ${items.length}건 불러옴`);
    return items;
  } catch (err) {
    logToFile("[소식] 마인크래프트 공식 소식 실패: " + (err?.message || err));
    return mcNewsCache?.items || [];
  }
}

ipcMain.handle("news:minecraft", () => fetchMinecraftNews());

// 30초마다 서버 상태 확인할 때 같이 공지사항도 새로 확인해서, 새 공지가 있으면 렌더러로 밀어줌
let lastAnnouncementId = null;
async function checkAnnouncementPeriodic() {
  const ann = await fetchAnnouncement();
  const currentId = ann?.id || null;
  if (currentId !== lastAnnouncementId) {
    lastAnnouncementId = currentId;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("announcement:update", ann);
    }
  }
}

// 버전 문자열 비교 (1.1.2 vs 1.1.10 같은 것도 숫자로 정확히 비교)
function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkStatusPeriodic() {
  try {
    const res = await globalThis.fetch(CONFIG.STATUS_URL, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();

    const maintenanceActive = !!data?.maintenance?.active;
    const maintenanceMessage = data?.maintenance?.message || "점검 중이에요.";
    const minVersion = data?.minVersion || null;
    const tooOld = minVersion ? compareVersions(app.getVersion(), minVersion) < 0 : false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("status:update", {
        maintenance: maintenanceActive,
        maintenanceMessage,
        forceUpdate: tooOld,
        minVersion,
      });
    }
  } catch (err) {
    logToFile("상태(점검모드/최소버전) 확인 실패: " + (err?.message || err));
  }
}

ipcMain.handle("announcement:dismiss", (_e, id) => {
  store.set("dismissed_announcement_id", id);
  return true;
});

// ----------------------------------------------------------------------------
// 최근 업데이트 날짜 (버전이 바뀐 걸 감지하면 그 시점을 저장)
// ----------------------------------------------------------------------------
ipcMain.handle("app:get-last-update", () => {
  const current = app.getVersion();
  const lastSeenVersion = store.get("last_seen_version");
  let lastUpdateDate = store.get("last_update_date");

  if (lastSeenVersion !== current) {
    lastUpdateDate = new Date().toISOString();
    store.set("last_seen_version", current);
    store.set("last_update_date", lastUpdateDate);
  }

  return lastUpdateDate || null;
});

ipcMain.handle("launch:show-window-again", () => {
  mainWindow?.show();
});

// 17차 신규: 업데이트 기록을 안 읽었으면 점을 띄우기 위한 별도 추적값.
// (위 last_seen_version은 "최근 업데이트 {날짜}" 텍스트용으로 앱을 열자마자 자동 갱신되지만,
//  이건 유저가 실제로 업데이트 목록 화면을 열어야만 갱신됨)
ipcMain.handle("app:has-unseen-update", () => {
  return store.get("last_update_seen_version") !== app.getVersion();
});
ipcMain.handle("app:mark-update-seen", () => {
  store.set("last_update_seen_version", app.getVersion());
  return { ok: true };
});

// 17차 신규: "공지사항도 내가 따로 올리는 거 말고 커뮤니티에 있는 최근 공지사항을 메인화면에
// 공유해줘" - 별도 announcement.json이 아니라, 포럼 "공지사항" 카테고리의 최신 글을 그대로 씀
ipcMain.handle("forum:get-latest-notice", async () => {
  try {
    const rows = await supabaseFetch(
      `/forum_posts?category=eq.${encodeURIComponent("공지사항")}&select=id,title,created_at&order=created_at.desc&limit=1`
    );
    const notice = rows?.[0] || null;
    if (!notice) return null;
    return { ...notice, seen: store.get("dismissed_forum_notice_id") === notice.id };
  } catch (err) {
    logToFile("최근 공지사항 조회 실패: " + (err?.message || err));
    return null;
  }
});
ipcMain.handle("forum:dismiss-notice", (_e, id) => {
  store.set("dismissed_forum_notice_id", id);
  return { ok: true };
});

// ----------------------------------------------------------------------------
// 스킨 관리 (마인크래프트 공식 API 직접 사용)
// ----------------------------------------------------------------------------

// 현재 장착된 스킨(이미지 URL + classic/slim 모델) 조회
ipcMain.handle("skin:get-current", async () => {
  try {
    const profile = store.get("mc_profile");
    if (!profile?.uuid) return null;

    const res = await globalThis.fetch(
      `https://sessionserver.mojang.com/session/minecraft/profile/${profile.uuid}`
    );
    if (!res.ok) return null;
    const data = await res.json();

    const texturesProp = (data.properties || []).find((p) => p.name === "textures");
    if (!texturesProp) return null;

    const decoded = JSON.parse(Buffer.from(texturesProp.value, "base64").toString("utf-8"));
    const skin = decoded.textures?.SKIN;
    if (!skin) return null;

    return {
      url: skin.url,
      variant: skin.metadata?.model === "slim" ? "slim" : "classic",
    };
  } catch (err) {
    logToFile("스킨 조회 실패: " + (err?.message || err));
    return null;
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 24-156차: "런처 스킨에서 이미 마크 런처에 등록한 스킨이랑 플레이어 망토 로딩 전부 다 해줘"
// skin:get-current / skin:get-textures 는 둘 다 세션 서버(공개 프로필)를 보기 때문에
// "지금 적용 중인" 스킨 1개와 망토 1개밖에 알 수 없다. 계정이 실제로 갖고 있는 스킨/망토를
// 전부 보려면 로그인 토큰으로 마인크래프트 서비스 API 를 직접 물어봐야 한다.
//   GET https://api.minecraftservices.com/minecraft/profile
//     -> { id, name, skins:[{id,state,url,variant}], capes:[{id,state,url,alias}] }
// 이미지 주소는 그대로 쓰면 WebGL 에서 CORS 로 막힐 수 있어서(24-54차 참고) 여기서 미리
// data: URL 로 받아서 같이 내려준다.
// ────────────────────────────────────────────────────────────────────────────
function getMcAccessToken() {
  return (
    cachedAuthorization?.access_token ||
    cachedAuthorization?.accessToken ||
    null
  );
}

ipcMain.handle("skin:get-account-profile", async () => {
  try {
    const accessToken = getMcAccessToken();
    if (!accessToken) return { ok: false, error: "마인크래프트 로그인 정보가 없어요." };
    const res = await globalThis.fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logToFile(`[스킨] 계정 프로필 조회 실패 ${res.status}: ${text}`);
      return { ok: false, error: `프로필을 불러오지 못했어요 (${res.status})` };
    }
    const data = await res.json();
    const skins = Array.isArray(data.skins) ? data.skins : [];
    const capes = Array.isArray(data.capes) ? data.capes : [];

    // 텍스처를 data: URL 로 같이 받아둔다(3D 뷰어가 CORS 없이 바로 쓸 수 있게).
    // 실패해도 url 은 그대로 남으므로 화면이 깨지지는 않는다.
    const [skinDataUrls, capeDataUrls] = await Promise.all([
      Promise.all(skins.map((x) => toDataUrl(x.url).catch(() => null))),
      Promise.all(capes.map((x) => toDataUrl(x.url).catch(() => null))),
    ]);

    return {
      ok: true,
      uuid: normalizeUuid(data.id),
      name: data.name || null,
      skins: skins.map((x, i) => ({
        id: x.id,
        state: x.state, // "ACTIVE" | "INACTIVE"
        url: x.url,
        variant: String(x.variant || "").toLowerCase() === "slim" ? "slim" : "classic",
        dataUrl: skinDataUrls[i],
      })),
      capes: capes.map((x, i) => ({
        id: x.id,
        state: x.state,
        url: x.url,
        alias: x.alias || null,
        dataUrl: capeDataUrls[i],
      })),
    };
  } catch (err) {
    logToFile("[스킨] 계정 프로필 조회 예외: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-156차: 망토 바꾸기 / 벗기 (capeId 가 없으면 안 쓰는 상태로 만듦)
ipcMain.handle("skin:set-cape", async (_e, capeId) => {
  try {
    const accessToken = getMcAccessToken();
    if (!accessToken) return { ok: false, error: "마인크래프트 로그인 정보가 없어요." };
    const url = "https://api.minecraftservices.com/minecraft/profile/capes/active";
    const res = capeId
      ? await globalThis.fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ capeId }),
        })
      : await globalThis.fetch(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logToFile(`[스킨] 망토 변경 실패 ${res.status}: ${text}`);
      return { ok: false, error: `망토를 바꾸지 못했어요 (${res.status})` };
    }
    logToFile(`[스킨] 망토 변경 완료 capeId=${capeId || "(없음)"}`);
    return { ok: true };
  } catch (err) {
    logToFile("[스킨] 망토 변경 예외: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 새 스킨 파일(.png) 선택 창 띄우기
ipcMain.handle("skin:pick-file", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "스킨 이미지 선택 (PNG)",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "PNG 이미지", extensions: ["png"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 19차: "내가 추가한 스킨들은 바뀌기만 하지 말고 리스트에 추가해줘 여러개 스위치할 수 있게" -
// 계정(uuid)별로 그동안 적용했던 커스텀 스킨 목록은 24-14차부터 customSkins 필드로
// getPlayerData/setPlayerField를 거쳐서 저장됨(연동된 노바 계정이 있으면 공용 데이터,
// 없으면 기기별 로컬 - 코인/상점과 동일한 패턴).

// 선택한 스킨을 마인크래프트 계정에 실제로 적용
ipcMain.handle("skin:upload", async (_e, { filePath, variant, saveToList, name }) => {
  try {
    if (!cachedAuthorization) {
      throw new Error("로그인 정보가 없습니다. 먼저 로그인해주세요.");
    }
    const accessToken =
      cachedAuthorization.access_token || cachedAuthorization.accessToken;
    if (!accessToken) throw new Error("인증 토큰을 찾을 수 없습니다.");

    const fileBuffer = await fsp.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: "image/png" });

    const form = new FormData();
    form.append("variant", variant === "slim" ? "slim" : "classic");
    form.append("file", blob, path.basename(filePath));

    const res = await globalThis.fetch("https://api.minecraftservices.com/minecraft/profile/skins", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`스킨 적용 실패 (${res.status}): ${text}`);
    }

    // 19차: 직접 올린(피커로 고른) 스킨일 때만 "내가 추가한 스킨" 목록에 저장 - 기본 스킨
    // 프리셋은 이미 자기 자신의 목록이 있어서 여기 또 저장할 필요가 없음(saveToList 미지정)
    let saved = null;
    if (saveToList) {
      const uuid = cachedAuthorization?.profile?.id || store.get("mc_profile")?.uuid;
      if (uuid) {
        const cacheDir = path.join(getRoot(), "skin-cache", "custom", uuid);
        await fsp.mkdir(cacheDir, { recursive: true });
        const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const cachedPath = path.join(cacheDir, `${id}.png`);
        await fsp.writeFile(cachedPath, fileBuffer);
        saved = {
          id,
          name: (name && String(name).trim()) || path.basename(filePath).replace(/\.png$/i, ""),
          variant: variant === "slim" ? "slim" : "classic",
          filePath: cachedPath,
          dataUrl: `data:image/png;base64,${fileBuffer.toString("base64")}`,
          savedAt: Date.now(),
        };
        const list = (getPlayerData(uuid).customSkins || []).filter((s) => s.name !== saved.name || s.variant !== saved.variant);
        list.unshift(saved);
        setPlayerField(uuid, "customSkins", list.slice(0, 30)); // 최대 30개까지만 보관
      }
    }

    return { ok: true, saved };
  } catch (err) {
    logToFile("스킨 업로드 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 19차: "내가 추가한 스킨" 목록 조회/삭제 - 현재 로그인된 계정 uuid 기준
ipcMain.handle("skin:list-custom", () => {
  const uuid = cachedAuthorization?.profile?.id || store.get("mc_profile")?.uuid;
  if (!uuid) return { ok: false, list: [] };
  return { ok: true, list: getPlayerData(uuid).customSkins || [] };
});
ipcMain.handle("skin:remove-custom", (_e, id) => {
  const uuid = cachedAuthorization?.profile?.id || store.get("mc_profile")?.uuid;
  if (!uuid) return { ok: false, list: [] };
  const list = (getPlayerData(uuid).customSkins || []).filter((s) => s.id !== id);
  setPlayerField(uuid, "customSkins", list);
  return { ok: true, list };
});

// 18차: "스킨 마크 기본 스킨들로 변경도 쉽게 변경도 되고 보기도 쉽게 해줘" - 스티브/알렉스를
// 비롯한 마인크래프트 "기본 스킨"들은 별도로 다운로드하지 않아도 이미 유저가 받아둔 마인크래프트
// 클라이언트 jar 안에(assets/minecraft/textures/entity/player/wide|slim/*.png) 그대로 들어있음.
// 그래서 외부에서 이미지를 새로 받아오는 대신, 이미 설치된 버전 중 하나의 jar을 열어서 그 안의
// 기본 스킨 PNG들을 그대로 꺼내 캐시 폴더에 복사해두고, 그 경로를 그대로 기존 skin:upload로
// 넘기면(적용) 실제 모장 스킨 API를 통해 그대로 장착됨 - 별도의 "적용" IPC가 필요 없음
ipcMain.handle("skin:get-default-presets", async (_e, mcVersion) => {
  try {
    const root = getRoot();
    const versionsDir = path.join(root, "versions");
    const candidateJars = [];
    if (mcVersion) candidateJars.push(path.join(versionsDir, mcVersion, `${mcVersion}.jar`));
    if (fs.existsSync(versionsDir)) {
      const dirs = await fsp.readdir(versionsDir).catch(() => []);
      for (const d of dirs) {
        const p = path.join(versionsDir, d, `${d}.jar`);
        if (!candidateJars.includes(p)) candidateJars.push(p);
      }
    }
    const jarPath = candidateJars.find((p) => fs.existsSync(p));
    if (!jarPath) return { ok: false, reason: "no-jar" };

    const zip = new AdmZip(jarPath);
    const entries = zip.getEntries();
    const rx = /^assets\/minecraft\/textures\/entity\/player\/(wide|slim)\/([a-z0-9_]+)\.png$/i;
    const cacheDir = path.join(root, "skin-cache", "defaults");
    await fsp.mkdir(cacheDir, { recursive: true });

    const presets = [];
    for (const entry of entries) {
      const m = entry.entryName.match(rx);
      if (!m) continue;
      const [, modelDir, rawName] = m;
      const buf = entry.getData();
      const cachedPath = path.join(cacheDir, `${modelDir}-${rawName}.png`);
      await fsp.writeFile(cachedPath, buf);
      presets.push({
        id: `${modelDir}-${rawName}`,
        name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
        variant: modelDir === "wide" ? "classic" : "slim",
        filePath: cachedPath,
        dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
      });
    }
    // 스티브/알렉스를 맨 앞에, 나머지는 이름순
    const rank = (name) => (name.toLowerCase() === "steve" ? 0 : name.toLowerCase() === "alex" ? 1 : 2);
    presets.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

    return { ok: true, presets };
  } catch (err) {
    logToFile("기본 스킨 목록 조회 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// ----------------------------------------------------------------------------
// 유저가 직접 추가하는 리소스팩
// ----------------------------------------------------------------------------
ipcMain.handle("resourcepack:add-file", async () => {
  if (!mainWindow) return { ok: false, error: "창을 찾을 수 없습니다." };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "리소스팩 선택 (ZIP)",
    defaultPath: app.getPath("downloads"),
    filters: [{ name: "리소스팩 ZIP", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const srcPath = result.filePaths[0];
    const dest = path.join(getRoot(), "resourcepacks");
    await fsp.mkdir(dest, { recursive: true });

    let fileName = path.basename(srcPath);
    let destPath = path.join(dest, fileName);
    // 이름이 겹치면 뒤에 번호를 붙여 덮어쓰지 않게 함
    let n = 1;
    while (fs.existsSync(destPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      const candidate = `${base}(${n})${ext}`;
      destPath = path.join(dest, candidate);
      fileName = candidate;
      n++;
    }

    await fsp.copyFile(srcPath, destPath);
    patchResourcePackFormat(destPath); // 버전 호환성 자동 패치

    const list = new Set(store.get("user_resource_packs") || []);
    list.add(fileName);
    store.set("user_resource_packs", Array.from(list));

    return { ok: true, fileName };
  } catch (err) {
    logToFile("리소스팩 추가 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("resourcepack:list-user", () => store.get("user_resource_packs") || []);

ipcMain.handle("mods:list-installed", async () => {
  try {
    const dir = path.join(getRoot(), "mods");
    if (!fs.existsSync(dir)) return [];
    // 25차: 노바 내장 모드(novaclient-mod)/24-46차: Fabric API 자동 주입분은 클라이언트
    // 자체 기능이므로 목록에서 숨김
    const files = (await fsp.readdir(dir)).filter(
      (f) => f.toLowerCase().endsWith(".jar") && !isHiddenModFileName(f)
    );
    return files.sort();
  } catch (_) {
    return [];
  }
});

// ----------------------------------------------------------------------------
// 설치 용량 확인 / 전체 삭제
// ----------------------------------------------------------------------------
async function getFolderSize(dirPath) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getFolderSize(full);
    } else {
      try {
        const st = await fsp.stat(full);
        total += st.size;
      } catch (_) {}
    }
  }
  return total;
}

ipcMain.handle("app:get-installed-size", async () => {
  const bytes = await getFolderSize(getRoot());
  return bytes;
});

ipcMain.handle("app:reset-install", async () => {
  try {
    if (currentAbortController) currentAbortController.abort();
    await fsp.rm(getRoot(), { recursive: true, force: true });
    logToFile("설치 폴더 전체 삭제됨: " + getRoot());
    return { ok: true };
  } catch (err) {
    logToFile("전체 삭제 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 24-123차: "클라이언트 정보에서 클라이언트 삭제 기능 만들어줘 제어판 가기 귀찮다"
// 설정 > 클라이언트 탭의 "Nova Client 삭제" 버튼. electron-builder(NSIS)가 설치 폴더에
// 같이 만들어 두는 제거 프로그램("Uninstall Nova Client.exe")을 그대로 띄웁니다.
// 제거 프로그램은 런처가 켜져 있으면 진행하지 못하므로, 띄운 직후 런처를 종료합니다.
// (detached + unref 라서 부모가 죽어도 제거 프로그램은 계속 살아 있음)
ipcMain.handle("app:uninstall", async () => {
  try {
    if (!app.isPackaged) {
      return { ok: false, error: "개발 모드(npm start)에서는 제거할 수 없어요." };
    }
    if (process.platform !== "win32") {
      return { ok: false, error: "윈도우에서만 지원해요." };
    }

    const exeDir = path.dirname(app.getPath("exe"));
    let uninstaller = path.join(exeDir, `Uninstall ${app.getName()}.exe`);
    if (!fs.existsSync(uninstaller)) {
      // productName 이 바뀌었거나 이름이 조금 다를 수 있으니 폴더를 훑어서 찾음
      const found = (fs.readdirSync(exeDir) || []).find((f) => /^Uninstall .*\.exe$/i.test(f));
      if (found) uninstaller = path.join(exeDir, found);
    }
    if (!fs.existsSync(uninstaller)) {
      logToFile("제거 프로그램을 찾지 못함: " + exeDir);
      return {
        ok: false,
        error: "제거 프로그램을 찾지 못했어요. 윈도우 설정 > 앱에서 제거해주세요.",
      };
    }

    logToFile("클라이언트 제거 시작: " + uninstaller);
    // 게임이 돌고 있으면 먼저 멈춤 - 파일이 잠긴 채로 제거가 실패하는 걸 막음
    try {
      if (gameProcess && gameProcess.pid) gameProcess.kill();
    } catch (_) {}

    const child = spawn(uninstaller, [], { detached: true, stdio: "ignore" });
    child.unref();

    // 제거 프로그램이 뜰 틈을 조금 주고 런처를 끔
    setTimeout(() => {
      try {
        app.quit();
      } catch (_) {
        app.exit(0);
      }
    }, 600);

    return { ok: true };
  } catch (err) {
    logToFile("클라이언트 제거 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("resourcepack:remove-user", async (_e, fileName) => {
  try {
    const list = (store.get("user_resource_packs") || []).filter((f) => f !== fileName);
    store.set("user_resource_packs", list);
    const filePath = path.join(getRoot(), "resourcepacks", fileName);
    await fsp.unlink(filePath).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ----------------------------------------------------------------------------
// 첫 실행 약관 동의
// ----------------------------------------------------------------------------
ipcMain.handle("terms:get-agreed", () => !!store.get("terms_agreed"));
ipcMain.handle("terms:agree", () => {
  store.set("terms_agreed", true);
  return true;
});

// ----------------------------------------------------------------------------
// 24-11차 신규: 최초 실행 시 무료 테마(다크/화이트) 선택 화면
// - 이 코드가 처음 도는 시점에 이미 terms_agreed가 true였던 사람(=기존 유저, 업데이트로
//   이 기능을 처음 받은 사람)은 "최초 실행"이 아니므로 다시 안 보이도록 바로 시청 처리함
// ----------------------------------------------------------------------------
if (store.get("terms_agreed") && store.get("theme_onboarding_seen") === undefined) {
  store.set("theme_onboarding_seen", true);
}
ipcMain.handle("onboarding:get-theme-seen", () => !!store.get("theme_onboarding_seen"));
ipcMain.handle("onboarding:set-theme-seen", () => {
  store.set("theme_onboarding_seen", true);
  return true;
});

// ----------------------------------------------------------------------------
// 계정별 데이터 (코인/출석/상점 소유 등은 PC 전체가 아니라 로그인한 계정마다 따로 저장됨)
// ----------------------------------------------------------------------------
function getActivePlayerUuid() {
  return store.get("active_uuid") || null;
}
// 24-4차: 로그인한 사이트 계정에 이 마인크래프트 계정이 연동돼(=등록돼) 있으면, 코인/상점/
// 출석/퀘스트 데이터를 기기별 로컬 저장소가 아니라 사이트 계정의 공용 데이터에서 읽고 씀 -
// 그래야 "구매한 스킨 등을 등록한 마크 계정 모두가 쓸 수 있는" 시스템이 됨. 연동 안 된(=
// 게스트이거나 아직 등록 안 한) 마인크래프트 계정은 지금까지처럼 기기별 로컬 저장소를 그대로
// 씀. 이 두 함수를 호출하는 shop:buy 등 다른 코드는 전혀 안 건드리고, 여기서만 갈라줌.
// 24-10차: 코인은 더 이상 shared_player_data 블롭 안에 안 들어있음 - 사이트 결제 코인과
// 완전히 합쳐지면서 nova_accounts.coins라는 별도 컬럼(=cachedSiteAccountFull.coins) 하나로
// 옮겨감. 그래서 연동된 계정일 땐 coinLog/상점/출석/퀘스트 등 나머지 공용 데이터에 coins만
// 얹어서 돌려줌(호출부 코드는 그대로 data.coins로 읽을 수 있게 호환 유지).
function getPlayerData(uuid) {
  if (!uuid) return {};
  if (isUuidLinkedToActiveSiteAccount(uuid)) {
    return { ...(cachedSiteAccountData || {}), coins: cachedSiteAccountFull?.coins || 0 };
  }
  return getLocalPlayerData(uuid);
}
function setPlayerField(uuid, field, value) {
  if (!uuid) return;
  if (isUuidLinkedToActiveSiteAccount(uuid)) {
    if (field === "coins") {
      // 낙관적으로 메모리 캐시(cachedSiteAccountFull.coins)부터 즉시 갱신하고, 서버에는
      // 델타(변화량)만 fire-and-forget으로 보냄(이 프로젝트의 다른 코인 동기화와 동일한 패턴 -
      // 실패해도 다음 조회/재로그인 때 서버 값으로 다시 맞춰짐).
      const prev = cachedSiteAccountFull?.coins || 0;
      const next = Number(value) || 0;
      const delta = next - prev;
      if (cachedSiteAccountFull) cachedSiteAccountFull.coins = next;
      if (cachedSiteSession?.accountId && delta !== 0) {
        novaSiteFetch("adjust-coins", {
          accountId: cachedSiteSession.accountId,
          sessionToken: cachedSiteSession.sessionToken,
          delta,
        }).catch((err) => logToFile("코인 서버 동기화 실패: " + (err?.message || err)));
      }
      return;
    }
    if (!cachedSiteAccountData) cachedSiteAccountData = {};
    cachedSiteAccountData[field] = value;
    scheduleSiteAccountDataSave();
    return;
  }
  setLocalPlayerField(uuid, field, value);
}

// ----------------------------------------------------------------------------
// 코인 / 7일 출석 (일주일마다 초기화) - 전부 계정별로 따로 저장됨
// ----------------------------------------------------------------------------
function getCoins(uuid = getActivePlayerUuid()) {
  return getPlayerData(uuid).coins || 0;
}
function addCoins(amount, reason, uuid = getActivePlayerUuid()) {
  if (!uuid) return 0;
  const next = getCoins(uuid) + amount;
  setPlayerField(uuid, "coins", next);

  if (reason) {
    const log = getPlayerData(uuid).coinLog || [];
    log.unshift({ amount, reason, date: new Date().toISOString() });
    setPlayerField(uuid, "coinLog", log.slice(0, 50)); // 최근 50개만 보관
  }

  // 포럼에서 다른 사람 코인도 보여줄 수 있게 Supabase에도 동기화 (실패해도 무시함)
  const profile = store.get("mc_profile");
  if (profile?.uuid === uuid) {
    syncCoinsToSupabase(uuid, profile.name, next).catch(() => {});
  }

  return next;
}
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  return Math.floor((b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
}

// 출석체크: 매월 1일에 초기화됨. 매일 고정 코인 지급 + 토요일마다 보너스 추가.
// 24-10차: 코인이 사이트 결제 코인(1코인=1원)과 완전히 합쳐지면서, 공짜로 나가는 양을
// 대폭 낮춤(기존 대비 약 85% 절감 - Nova Site lib/playerRewards.js와 동일한 값으로 맞춤).
// 24-224차: "티어별로 출첵 코인 1씩 올라가게 하고 가장 낮은 티어가 1개 그리고 토요일 보너스 삭제"
// 고정 2코인 + 토요일 보너스였던 걸, 티어 하나에만 달린 값으로 바꿨다(아이언 1 ~ 다이아 6).
function attendanceAmount() {
  return myPerks().coin;
}

function monthKeyString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function isSaturday(year, monthIndex, day) {
  return new Date(year, monthIndex, day).getDay() === 6;
}

function getAttendanceState(uuid = getActivePlayerUuid()) {
  const data = getPlayerData(uuid);
  const now = new Date();
  const monthKey = monthKeyString(now);
  const today = now.getDate(); // 1~31

  // 저장된 달과 지금 달이 다르면(=새 달 시작) 화면 표시용으로 초기화된 것처럼 보여줌
  // (실제 저장은 유저가 처음 출석 버튼을 누르는 순간에 반영됨)
  const claimedDays = data.attendanceMonthKey === monthKey ? (data.attendanceClaimedDays || []) : [];

  return {
    uuid,
    monthKey,
    today,
    claimedDays,
    canClaimToday: !!uuid && !claimedDays.includes(today),
  };
}

ipcMain.handle("coins:get-log", () => getPlayerData(getActivePlayerUuid()).coinLog || []);

ipcMain.handle("rewards:get-status", () => {
  const s = getAttendanceState();
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  // 이 달의 토요일 날짜들을 미리 다 계산해서 보내줌 (화면에서 보너스 표시용)
  const saturdays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (isSaturday(year, monthIndex, d)) saturdays.push(d);
  }

  return {
    coins: getCoins(),
    monthKey: s.monthKey,
    daysInMonth,
    firstWeekday: new Date(year, monthIndex, 1).getDay(), // 0=일요일
    today: s.today,
    claimedDays: s.claimedDays,
    canClaimToday: s.canClaimToday,
    dailyAmount: attendanceAmount(),
    tier: myTier(),
    tierLabel: TIER_LABEL[myTier()],
    saturdays: [], // 24-224차: 토요일 보너스 없앰(화면 호환용으로 빈 배열만 남김)
  };
});

// day: 유저가 실제로 클릭한 날짜(1~31). 오늘 날짜가 아니면 거부.
ipcMain.handle("rewards:claim", (_e, day) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };

  const s = getAttendanceState(uuid);

  if (Number(day) !== s.today) {
    return { ok: false, error: "오늘 받을 수 있는 날짜가 아니에요." };
  }
  if (!s.canClaimToday) {
    return { ok: false, error: "오늘은 이미 받았어요." };
  }

  // 새 달로 넘어왔으면 저장된 달/목록을 갱신
  const data = getPlayerData(uuid);
  if (data.attendanceMonthKey !== s.monthKey) {
    setPlayerField(uuid, "attendanceMonthKey", s.monthKey);
    setPlayerField(uuid, "attendanceClaimedDays", []);
  }

  const amount = attendanceAmount();
  addCoins(amount, `출석체크 ${s.today}일 (${TIER_LABEL[myTier()]})`, uuid);

  const claimedDays = getPlayerData(uuid).attendanceClaimedDays || [];
  if (!claimedDays.includes(s.today)) claimedDays.push(s.today);
  setPlayerField(uuid, "attendanceClaimedDays", claimedDays);

  return {
    ok: true,
    amount,
    bonus: 0,
    tier: myTier(),
    day: s.today,
    coins: getCoins(uuid),
    claimedDays,
  };
});

// ----------------------------------------------------------------------------
// 15차 신규: 퀘스트 시스템 (일일: 1/3/6시간 플레이, 주간: 10/30/60시간 플레이)
// 코인/출석과 마찬가지로 계정별(uuid)로 저장됨. 플레이타임 누적 자체는 launcher.on("close")
// 에서 addQuestPlaySeconds()로 항상 이뤄지고(출석 여부와 무관), 일일 퀘스트만 "그날 출석체크를
// 완료해야 보상을 받을 수 있음"이라는 조건이 claim 단계에서 추가로 걸림
// ----------------------------------------------------------------------------

// 24-10차: 출석과 동일하게 대폭 절감(Nova Site lib/playerRewards.js와 동일한 값)
const QUEST_DAILY_TIERS = [
  { hours: 1, reward: 1 },
  { hours: 3, reward: 1 },
  { hours: 6, reward: 2 },
];
const QUEST_WEEKLY_TIERS = [
  { hours: 10, reward: 10 },
  { hours: 30, reward: 15 },
  { hours: 60, reward: 20 },
];

// ISO 8601 주차("YYYY-Www", 월요일 시작) - 출석체크는 매월 1일에 초기화되지만, 주간
// 퀘스트는 이름 그대로 매주 초기화돼야 하므로 월과는 별개의 주차 키를 씀
function weekKeyString(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // 일요일(0)을 7로 취급해 월요일 시작 주로 계산
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// 게임이 켜져 있던 시간(초)을 오늘/이번 주 누적 플레이타임에 더함. 날짜/주가 바뀌었으면
// 그 시점의 누적치와 "받음" 기록을 먼저 리셋하고 시작함
function addQuestPlaySeconds(seconds, uuid = getActivePlayerUuid()) {
  if (!uuid || !seconds || seconds <= 0) return;
  const data = getPlayerData(uuid);

  const today = todayString();
  const dailySeconds = (data.questDailyKey === today ? data.questDailyPlaySeconds || 0 : 0) + seconds;
  setPlayerField(uuid, "questDailyPlaySeconds", dailySeconds);
  if (data.questDailyKey !== today) setPlayerField(uuid, "questDailyClaimedTiers", []);
  setPlayerField(uuid, "questDailyKey", today);

  const week = weekKeyString();
  const weekSeconds = (data.questWeekKey === week ? data.questWeekPlaySeconds || 0 : 0) + seconds;
  setPlayerField(uuid, "questWeekPlaySeconds", weekSeconds);
  if (data.questWeekKey !== week) setPlayerField(uuid, "questWeekClaimedTiers", []);
  setPlayerField(uuid, "questWeekKey", week);
}

function getQuestStatus(uuid = getActivePlayerUuid()) {
  const data = getPlayerData(uuid);
  const today = todayString();
  const week = weekKeyString();

  const dailySeconds = data.questDailyKey === today ? data.questDailyPlaySeconds || 0 : 0;
  const dailyClaimed = data.questDailyKey === today ? data.questDailyClaimedTiers || [] : [];
  const weekSeconds = data.questWeekKey === week ? data.questWeekPlaySeconds || 0 : 0;
  const weekClaimed = data.questWeekKey === week ? data.questWeekClaimedTiers || [] : [];

  // "일일퀘스트는 출첵을 해야 보상을 받을 수 있게 대신 시간은 계속 쌓이고" - 누적(위)은
  // 항상 되고, 여기 claimable 판정에서만 그날 출석 여부를 추가로 확인함
  const attendance = getAttendanceState(uuid);
  const attendanceDoneToday = attendance.claimedDays.includes(attendance.today);

  const dailyHours = dailySeconds / 3600;
  const weekHours = weekSeconds / 3600;

  const dailyTiers = QUEST_DAILY_TIERS.map((t) => ({
    hours: t.hours,
    reward: t.reward,
    reached: dailyHours >= t.hours,
    claimed: dailyClaimed.includes(t.hours),
    claimable: dailyHours >= t.hours && !dailyClaimed.includes(t.hours) && attendanceDoneToday,
  }));
  const weeklyTiers = QUEST_WEEKLY_TIERS.map((t) => ({
    hours: t.hours,
    reward: t.reward,
    reached: weekHours >= t.hours,
    claimed: weekClaimed.includes(t.hours),
    claimable: weekHours >= t.hours && !weekClaimed.includes(t.hours),
  }));

  return {
    uuid,
    coins: getCoins(uuid),
    dailyPlaySeconds: dailySeconds,
    weekPlaySeconds: weekSeconds,
    attendanceDoneToday,
    dailyTiers,
    weeklyTiers,
  };
}

ipcMain.handle("quests:get-status", () => ({
  ...getQuestStatus(),
  weeklyLocked: !myPerks().weekly, // 24-224차: 아이언은 주간 퀘스트가 잠겨 있다
  tier: myTier(),
  tierLabel: TIER_LABEL[myTier()],
}));

ipcMain.handle("quests:claim-daily", (_e, hours) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  const tier = QUEST_DAILY_TIERS.find((t) => t.hours === Number(hours));
  if (!tier) return { ok: false, error: "잘못된 퀘스트예요." };

  const status = getQuestStatus(uuid);
  const found = status.dailyTiers.find((t) => t.hours === tier.hours);
  if (!found || found.claimed) return { ok: false, error: "이미 받았거나 받을 수 없는 퀘스트예요." };
  if (!found.reached) return { ok: false, error: "아직 플레이타임 조건을 채우지 못했어요." };
  if (!status.attendanceDoneToday) return { ok: false, error: "오늘 출석체크를 먼저 해주세요." };

  const today = todayString();
  const data = getPlayerData(uuid);
  const claimed = data.questDailyKey === today ? data.questDailyClaimedTiers || [] : [];
  claimed.push(tier.hours);
  setPlayerField(uuid, "questDailyKey", today);
  setPlayerField(uuid, "questDailyClaimedTiers", claimed);

  addCoins(tier.reward, `일일 퀘스트 ${tier.hours}시간 달성`, uuid);
  return { ok: true, amount: tier.reward, coins: getCoins(uuid) };
});

// 24-224차: "티어가 아이언이면 주간퀘스트 안열리게"
ipcMain.handle("quests:claim-weekly", (_e, hours) => {
  if (!myPerks().weekly) {
    return { ok: false, error: "주간 퀘스트는 브론즈부터 열려요." };
  }
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  const tier = QUEST_WEEKLY_TIERS.find((t) => t.hours === Number(hours));
  if (!tier) return { ok: false, error: "잘못된 퀘스트예요." };

  const status = getQuestStatus(uuid);
  const found = status.weeklyTiers.find((t) => t.hours === tier.hours);
  if (!found || found.claimed) return { ok: false, error: "이미 받았거나 받을 수 없는 퀘스트예요." };
  if (!found.reached) return { ok: false, error: "아직 플레이타임 조건을 채우지 못했어요." };

  const week = weekKeyString();
  const data = getPlayerData(uuid);
  const claimed = data.questWeekKey === week ? data.questWeekClaimedTiers || [] : [];
  claimed.push(tier.hours);
  setPlayerField(uuid, "questWeekKey", week);
  setPlayerField(uuid, "questWeekClaimedTiers", claimed);

  addCoins(tier.reward, `주간 퀘스트 ${tier.hours}시간 달성`, uuid);
  return { ok: true, amount: tier.reward, coins: getCoins(uuid) };
});

// ----------------------------------------------------------------------------
// 꾸미기 상점 (색상)
// ----------------------------------------------------------------------------
ipcMain.handle("shop:get-catalog", () => SHOP_COLORS);

ipcMain.handle("shop:get-state", () => {
  const uuid = getActivePlayerUuid();
  const data = getPlayerData(uuid);
  return {
    coins: getCoins(uuid),
    owned: data.ownedColors || [],
    equipped: data.equippedColor || null,
    // 17차: "테마모드(다크/화이트)랑 색상을 동시에 착용할 수 있게 해줘" - "완전 테마"
    // (배경까지 바뀌는 fulltheme, 예: 블랙&화이트/핑크)는 이제 색상(equippedColor)과는
    // 별도 슬롯(equippedThemeMode)에 저장돼서 둘 다 동시에 켜져 있을 수 있음
    equippedMode: data.equippedThemeMode || null,
    equippedFrame: data.equippedFrame || null, // 24-229차: 프로필 테두리
    // 24-66차 신규: 소모품(닉네임 변경권 등) 보유 개수 - { [consumableField]: count }
    consumables: data.consumables || {},
    // 24-146차: 청약철회(환불)할 수 있는 구매 목록 - 24시간이 안 지났고 실제로 코인을 낸 것만
    refundable: listRefundablePurchases(uuid),
  };
});

ipcMain.handle("shop:buy", (_e, colorId) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };

  const color = SHOP_COLORS.find((c) => c.id === colorId);
  if (!color) return { ok: false, error: "존재하지 않는 색상이에요." };

  // 24-66차 신규: 소모품(예: 닉네임 변경권)은 "한 번만 살 수 있음(ownedColors)" 규칙이 아니라
  // 살 때마다 개수가 쌓이는 방식이라 완전히 별도 분기로 처리함 - 기존 색상/테마 구매 흐름(아래)은
  // 전혀 안 건드림.
  if (color.consumable) {
    // 24-229차: 개수 제한이 있는 소모품(서버 슬롯 +1 은 1개까지)
    const field0 = color.consumableField || color.id;
    if (color.maxCount && ((getPlayerData(uuid).consumables || {})[field0] || 0) >= color.maxCount) {
      return { ok: false, error: "이미 보유" };
    }
    const isAdmin = isDevAccount();
    if (!isAdmin) {
      const coins = getCoins(uuid);
      if (coins < color.price) {
        return {
          ok: false,
          error: `코인이 부족해요. (보유 ${coins.toLocaleString()} / 필요 ${color.price.toLocaleString()})`,
        };
      }
      addCoins(-color.price, `상점: ${color.name} 구매`, uuid);
    }
    const field = color.consumableField || color.id;
    const consumables = { ...(getPlayerData(uuid).consumables || {}) };
    consumables[field] = (consumables[field] || 0) + 1;
    setPlayerField(uuid, "consumables", consumables);
    return { ok: true, coins: getCoins(uuid), consumables };
  }

  const owned = getPlayerData(uuid).ownedColors || [];
  if (owned.includes(colorId)) return { ok: false, error: "이미 가지고 있어요." };

  // 관리자 계정은 코인 없이도 상점 이용 가능(무료 지급) - 코인은 아예 차감 안 함
  const isAdmin = isDevAccount();
  if (!isAdmin) {
    const coins = getCoins(uuid);
    // 24-12차: "코인 부족하면 부족하다고 해야지" - 그냥 "코인이 부족해요"만 뜨면 정말 코인이
    // 모자란 건지 다른 문제인지 헷갈릴 수 있어서, 지금 보유량/필요량 숫자를 그대로 같이 보여줌
    if (coins < color.price) {
      return {
        ok: false,
        error: `코인이 부족해요. (보유 ${coins.toLocaleString()} / 필요 ${color.price.toLocaleString()})`,
      };
    }
    addCoins(-color.price, `상점: ${color.name} 색상 구매`, uuid);
  }
  setPlayerField(uuid, "ownedColors", [...owned, colorId]);
  // 24-146차: "상점 밑에 청약철회 만들어서 구매한지 하루도 안됐다면 환불할 수있게"
  // 예전엔 산 물건을 id 문자열 배열(ownedColors)로만 들고 있어서 "언제 샀는지"가 어디에도
  // 없었음(코인 기록은 최근 50개만 남고 관리자 구매는 아예 안 남아서 근거로 못 씀).
  // 그래서 구매할 때마다 시각과 실제로 낸 금액을 따로 적어둠 - 환불 가능 여부와 돌려줄
  // 코인을 이 기록만 보고 정확히 판단함.
  const purchases = { ...(getPlayerData(uuid).purchases || {}) };
  purchases[colorId] = { at: new Date().toISOString(), paid: isAdmin ? 0 : color.price };
  setPlayerField(uuid, "purchases", purchases);
  return { ok: true, coins: getCoins(uuid) };
});

// 24-66차 신규: 보유한 "닉네임 변경권"을 실제로 소비해서 Nova Site 계정의 닉네임을 바꿈.
// Nova Site의 change-nickname API를 호출해서 서버에서 실제로 성공한 게 확인된 뒤에만 티켓을
// 차감함(실패했는데 티켓만 사라지는 일이 없도록).
ipcMain.handle("account:use-nickname-ticket", async (_e, newNickname) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  if (!cachedSiteSession?.accountId || !cachedSiteSession?.sessionToken) {
    return { ok: false, error: "사이트 계정으로 로그인해야 닉네임을 바꿀 수 있어요." };
  }
  const clean = String(newNickname || "").trim();
  if (!clean) return { ok: false, error: "새 닉네임을 입력해주세요." };
  const have = (getPlayerData(uuid).consumables || {}).nicknameChangeTickets || 0;
  if (have <= 0) {
    return { ok: false, error: "닉네임 변경권이 없어요. 상점 > 기타 탭에서 구매해주세요." };
  }
  const res = await novaSiteFetch("change-nickname", {
    accountId: cachedSiteSession.accountId,
    sessionToken: cachedSiteSession.sessionToken,
    newNickname: clean,
  }).catch(() => null);
  if (!res || !res.ok) {
    return { ok: false, error: res?.error || "닉네임 변경에 실패했어요." };
  }
  // applySiteAccountRow를 먼저 호출해 캐시를 최신 계정으로 갈아끼운 "뒤에" consumables를
  // 차감해야 함 - 순서가 바뀌면 방금 갈아끼운 캐시(옛 개수)가 이 차감을 덮어써버려서, 나중에
  // debounce 저장이 실행될 때(scheduleSiteAccountDataSave가 그 시점의 전역 캐시를 그대로
  // 저장함) 차감이 사라지는 문제가 생김.
  applySiteAccountRow(res.account);
  const consumables = { ...(getPlayerData(uuid).consumables || {}) };
  consumables.nicknameChangeTickets = Math.max((consumables.nicknameChangeTickets || 0) - 1, 0);
  setPlayerField(uuid, "consumables", consumables);
  return { ok: true, account: res.account };
});

// ────────────────────────────────────────────────────────────────────────────
// 24-146차: 청약철회(환불)
// 디지털 상품이라도 일정 기간 안에는 청약철회를 받아줘야 해서, "산 지 24시간이 안 지났고
// 실제로 코인을 낸 구매"만 되돌릴 수 있게 함.
//  · 돌려주는 코인은 "그때 실제로 낸 금액"(purchases[id].paid) - 나중에 상품 가격이 바뀌어도
//    더 주거나 덜 주는 일이 없음
//  · 관리자 무료 지급(paid: 0)은 돌려줄 코인이 없으므로 목록에 안 나옴
//  · 지금 착용 중인 색/테마를 환불하면 그 슬롯을 비워서 기본 모습으로 되돌림
// ────────────────────────────────────────────────────────────────────────────
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

function listRefundablePurchases(uuid) {
  if (!uuid) return [];
  const data = getPlayerData(uuid);
  const owned = data.ownedColors || [];
  const purchases = data.purchases || {};
  const now = Date.now();
  const out = [];
  for (const id of owned) {
    const rec = purchases[id];
    if (!rec || !rec.at) continue; // 기록이 없는 옛 구매는 대상 아님
    if (!(rec.paid > 0)) continue; // 무료로 받은 건 돌려줄 코인이 없음
    const boughtAt = new Date(rec.at).getTime();
    if (!Number.isFinite(boughtAt)) continue;
    const left = REFUND_WINDOW_MS - (now - boughtAt);
    if (left <= 0) continue;
    const item = SHOP_COLORS.find((c) => c.id === id);
    out.push({ id, name: item?.name || id, paid: rec.paid, at: rec.at, msLeft: left });
  }
  out.sort((a, b) => a.msLeft - b.msLeft); // 곧 만료되는 것부터
  return out;
}

ipcMain.handle("shop:list-refundable", () => listRefundablePurchases(getActivePlayerUuid()));

ipcMain.handle("shop:refund", (_e, colorId) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };

  const refundable = listRefundablePurchases(uuid).find((r) => r.id === colorId);
  if (!refundable) {
    return { ok: false, error: "환불할 수 있는 구매가 아니에요. (구매 후 24시간이 지났거나 기록이 없어요)" };
  }

  const data = getPlayerData(uuid);

  // 1) 보유 목록에서 제거
  setPlayerField(uuid, "ownedColors", (data.ownedColors || []).filter((id) => id !== colorId));

  // 2) 구매 기록 제거
  const purchases = { ...(data.purchases || {}) };
  delete purchases[colorId];
  setPlayerField(uuid, "purchases", purchases);

  // 3) 착용 중이었으면 그 슬롯을 비움(기본 모습으로)
  const item = SHOP_COLORS.find((c) => c.id === colorId);
  if (item?.frame) {
    if (data.equippedFrame === colorId) setPlayerField(uuid, "equippedFrame", null);
  } else if (item?.category === "fulltheme") {
    if (data.equippedThemeMode === colorId) setPlayerField(uuid, "equippedThemeMode", null);
  } else if (data.equippedColor === colorId) {
    setPlayerField(uuid, "equippedColor", null);
  }

  // 4) 낸 만큼 코인 돌려주기
  addCoins(refundable.paid, `청약철회: ${refundable.name}`, uuid);

  const after = getPlayerData(uuid);
  logToFile(`[상점] 청약철회: ${colorId} / 환급 ${refundable.paid} 코인`);
  return {
    ok: true,
    coins: getCoins(uuid),
    equipped: after.equippedColor || null,
    equippedMode: after.equippedThemeMode || null,
    refunded: refundable.paid,
    name: refundable.name,
  };
});

ipcMain.handle("shop:equip", (_e, colorId) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };

  if (colorId === null || colorId === "default") {
    // "기본값" 버튼 - 색상/테마모드 둘 다 완전히 초기화
    setPlayerField(uuid, "equippedColor", null);
    setPlayerField(uuid, "equippedThemeMode", null);
    return { ok: true, equipped: null, equippedMode: null };
  }
  const owned = getPlayerData(uuid).ownedColors || [];
  if (!owned.includes(colorId)) return { ok: false, error: "구매하지 않은 색상이에요." };

  // 17차: "테마모드(다크/화이트)랑 색상 스와치를 동시에 착용할 수 있게 해줘" - 예전엔 착용
  // 슬롯이 하나뿐이라 완전 테마를 착용하면 다른 색상을 같이 못 썼는데, 이제 "완전 테마"
  // (category: fulltheme, 배경까지 바뀜)와 "색상"(포인트색만 바뀜)을 서로 다른 슬롯에 따로
  // 저장해서 두 개가 항상 동시에 적용됨
  const color = SHOP_COLORS.find((c) => c.id === colorId);
  // 24-229차: 테두리는 따로 된 칸 - 색/테마는 그대로 둔다
  if (color?.frame) {
    setPlayerField(uuid, "equippedFrame", colorId);
    scheduleTierSync();
    const d = getPlayerData(uuid);
    return { ok: true, equipped: d.equippedColor || null, equippedMode: d.equippedThemeMode || null, equippedFrame: colorId };
  }
  scheduleTierSync(); // 테마색도 남들 카드에 쓰인다
  if (color?.category === "fulltheme") {
    // 24-72차: "테마 바꿨을 때 항상 테마 기본색으로 바꿔주고" - 17차 때는 완전 테마를 새로
    // 착용해도 이전에 장착해둔 색상(포인트색)을 그대로 유지했는데, 이제는 완전 테마를 바꾸면
    // 그 전에 써둔 커스텀 포인트색을 같이 해제해서 항상 새 테마 고유의 기본색이 보이게 함
    // (포인트색을 다시 쓰고 싶으면 보관함/상점에서 그 색상을 다시 장착하면 됨)
    setPlayerField(uuid, "equippedThemeMode", colorId);
    setPlayerField(uuid, "equippedColor", null);
    return { ok: true, equipped: null, equippedMode: colorId };
  }
  setPlayerField(uuid, "equippedColor", colorId);
  return { ok: true, equipped: colorId, equippedMode: getPlayerData(uuid).equippedThemeMode || null };
});

// 17차 신규: 카테고리별로 따로 해제(색상만 해제, 또는 완전 테마만 해제) - "기본값"과 달리
// 다른 슬롯은 그대로 둠
ipcMain.handle("shop:unequip-category", (_e, category) => {
  const uuid = getActivePlayerUuid();
  if (!uuid) return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  if (category === "fulltheme") setPlayerField(uuid, "equippedThemeMode", null);
  else if (category === "cosmetic") setPlayerField(uuid, "equippedFrame", null); // 24-229차
  else setPlayerField(uuid, "equippedColor", null);
  scheduleTierSync();
  return { ok: true };
});

// ----------------------------------------------------------------------------
// 24-85차 신규: 가입 축하 선물
// "처음 회원가입하면 테마랑 색 하나씩 공짜로 고르게 해주고 닉네임 변경권도 1개 처음에 무료로 줘
//  이거 지금 이미 회원가입 돼있는 사람들도 보상 안받았으면 주라"
//
// 저장 위치가 중요합니다. 상점 보유 목록(ownedColors)/소모품(consumables)은 사이트 계정의
// 공용 데이터(shared_player_data)에 들어있고, 이 앱은 그걸 getPlayerData/setPlayerField로
// 읽고 씁니다. 그래서 "받았는지" 표시도 같은 곳에 두면:
//   · 기기를 바꾸거나 다른 마인크래프트 계정으로 전환해도 한 번만 받습니다.
//   · 이미 가입한 사람은 이 표시가 없으니 다음 실행 때 자동으로 대상이 됩니다
//     (= 소급 지급이 따로 필요 없음, Nova Site나 SQL도 안 건드려도 됨).
//
// welcomeGift 모양: { ticketAt: ISO, pickedAt: ISO, themeId, colorId }
// ----------------------------------------------------------------------------
const WELCOME_GIFT_TICKET_FIELD = "nicknameChangeTickets";

// 선물은 "사이트 계정"에 주는 것이므로, 사이트 계정에 연동된 상태에서만 처리합니다.
// (연동 안 된 상태에서 기기 로컬에 줘버리면 나중에 연동했을 때 계정 쪽에는 기록이 없어서
//  한 번 더 받게 됩니다.)
function welcomeGiftUuidIfEligible() {
  const uuid = getActivePlayerUuid();
  if (!uuid) return null;
  if (!cachedSiteSession?.accountId) return null;
  if (!isUuidLinkedToActiveSiteAccount(uuid)) return null;
  return uuid;
}

// 24-88차: "상점에 파는 색만 남둬야지 기본색은 제외하고 화이트랑 회색은" - 선물로 고르는
// 목록에서 무채색 기본색(블랙/화이트/그레이)을 뺍니다. 이 셋은 색이라기보다 기본값에 가까워서
// 무지개 색상들과 나란히 놓으면 목록이 어색해집니다. 상점에서는 그대로 계속 팝니다.
const WELCOME_GIFT_EXCLUDED_COLOR_IDS = ["mono-black", "mono-white", "mono-gray"];

// 24-89차 수정: "미리보기에 왜 색이 3개밖에 없어? 그리고 테마는 어디갔고?"
//
// 이전에는 "이미 가진 것"을 목록에서 아예 빼버렸습니다. 갓 가입한 사람은 가진 게 없으니
// 전부 보였지만, 상점에서 이것저것 산 사람(특히 소급 지급 대상)은 남은 몇 개만 보이고,
// 한 카테고리를 전부 가졌으면 그 칸이 통째로 사라져서 선물이 고장난 것처럼 보였습니다.
//
// 이제 목록은 **항상 전체**를 내려주고(무채색 기본색과 소모품만 제외), 이미 가진 것은
// owned 표시만 붙여 고를 수 없게 합니다. 목록이 왜 짧은지 화면에서 바로 보입니다.
function welcomeGiftCatalog(uuid) {
  const owned = getPlayerData(uuid).ownedColors || [];
  const pick = (category) =>
    SHOP_COLORS.filter(
      (c) =>
        c.category === category &&
        !c.consumable &&
        !WELCOME_GIFT_EXCLUDED_COLOR_IDS.includes(c.id)
    ).map((c) => ({
      id: c.id,
      name: c.name,
      hex: c.hex || null,
      plateColor: c.plateColor || null,
      icon: c.icon || null,
      price: c.price,
      // 24-86차: 미리보기 화면의 body[data-color-theme] 값으로 그대로 쓰므로 같이 내려줌
      mode: c.mode || null,
      owned: owned.includes(c.id),
    }));
  return { themes: pick("fulltheme"), colors: pick("theme") };
}

// 24-89차: 한 칸을 전부 가진 사람은 고를 게 없어서 그 칸이 빈손이 됩니다. 그런 경우에만
// 0보다 큰 값을 돌려주고, 그만큼 코인으로 대신 드립니다. 금액은 그 칸에서 **가장 싼**
// 상품 가격 - 선물로 고를 수 있었던 최소 가치와 같아서 더 얹어주는 일이 없습니다.
function welcomeGiftCoinValue(list) {
  if (!list.length || list.some((c) => !c.owned)) return 0;
  return Math.min(...list.map((c) => c.price || 0));
}

// 앱이 켜진 뒤 한 번 불립니다. 닉네임 변경권은 고를 게 없으니 여기서 바로 지급하고,
// 테마/색 고르기가 남아있는지만 알려줍니다(고르기를 나중에 해도 변경권은 이미 받은 상태).
// ----------------------------------------------------------------------------
// 24-192차: 추천인 시스템
// "추천인 시스템 만들어서 색 고를 때 추천인 입력하면 본인이랑 그 사람한테 각각 200 코인씩"
//
// 추천인은 지금 런처를 켜고 있지 않은 "남의 계정"이다. 그 사람 잔액을 이 런처가 직접
// 올릴 수는 없으므로(adjust-coins 는 자기 계정만 건드린다) 지급 자체는 전부 서버에서
// 한다 - Nova Site 의 /api/app/account/referral + Postgres 함수 rpc_nova_apply_referral
// 이 "기록 남기기 + 양쪽 코인 더하기"를 한 트랜잭션으로 처리한다.
// 여기서는 부르고, 돌아온 잔액으로 캐시를 맞추고, 코인 기록에 한 줄 남기는 것만 한다.
// ⚠️ addCoins 를 쓰면 안 된다 - 서버가 이미 넣어줬는데 또 넣으면 두 번 들어가고,
//    adjust-coins 동기화까지 따라붙어 서버 잔액도 틀어진다.
// ----------------------------------------------------------------------------
const REFERRAL_REWARD = 200;

async function fetchReferralStatus() {
  if (!cachedSiteSession?.accountId) return { used: true, reward: REFERRAL_REWARD };
  try {
    const res = await novaSiteFetch("referral", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      check: true,
    });
    if (res?.ok) return { used: !!res.used, reward: res.reward || REFERRAL_REWARD };
  } catch (err) {
    logToFile("[추천인] 상태 확인 실패: " + (err?.message || err));
  }
  // 확인이 안 되면 입력칸을 안 보여준다(넣었는데 또 넣으라고 띄우는 쪽보다 낫다)
  return { used: true, reward: REFERRAL_REWARD };
}

ipcMain.handle("referral:status", () => fetchReferralStatus());

ipcMain.handle("referral:apply", async (_e, nickname) => {
  if (!cachedSiteSession?.accountId) {
    return { ok: false, error: "사이트 계정으로 로그인해야 추천인을 넣을 수 있어요." };
  }
  const clean = String(nickname || "").trim();
  if (!clean) return { ok: false, error: "추천인 닉네임을 입력해주세요." };

  let res;
  try {
    // 24-239차: 지금 쓰는 마크 계정 토큰을 같이 보내서 서버가 직접 확인한다(마크+이메일 둘 다 필요)
    res = await novaSiteFetch("referral", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      referrerNickname: clean,
      mcAccessToken: cachedAuthorization?.access_token || cachedAuthorization?.accessToken || null,
      mcUuid: getActivePlayerUuid() || null,
    });
  } catch (err) {
    logToFile("[추천인] 적용 실패: " + (err?.message || err));
    return { ok: false, error: "서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
  if (!res?.ok) return { ok: false, code: res?.code || null, error: res?.error || "추천인을 적용하지 못했어요." };

  // 서버가 돌려준 잔액으로 캐시를 맞춘다(여기서 addCoins 를 부르면 두 번 들어간다)
  if (cachedSiteAccountFull && Number.isFinite(Number(res.coins))) {
    cachedSiteAccountFull.coins = Number(res.coins);
  }
  const uuid = getActivePlayerUuid();
  if (uuid) {
    const log = getPlayerData(uuid).coinLog || [];
    log.unshift({
      amount: res.reward || REFERRAL_REWARD,
      reason: `추천인 ${res.referrerNickname}`,
      date: new Date().toISOString(),
    });
    setPlayerField(uuid, "coinLog", log.slice(0, 50));
  }
  logToFile(`[추천인] ${res.referrerNickname} 적용 - 양쪽에 ${res.reward || REFERRAL_REWARD}코인`);
  return {
    ok: true,
    reward: res.reward || REFERRAL_REWARD,
    coins: res.coins,
    referrerNickname: res.referrerNickname || clean,
  };
});

ipcMain.handle("welcome:sync", async () => {
  const uuid = welcomeGiftUuidIfEligible();
  if (!uuid) return { ok: true, eligible: false };

  const data = getPlayerData(uuid);
  const gift = { ...(data.welcomeGift || {}) };
  let ticketGiven = false;

  if (!gift.ticketAt) {
    const consumables = { ...(data.consumables || {}) };
    consumables[WELCOME_GIFT_TICKET_FIELD] = (consumables[WELCOME_GIFT_TICKET_FIELD] || 0) + 1;
    setPlayerField(uuid, "consumables", consumables);
    gift.ticketAt = new Date().toISOString();
    setPlayerField(uuid, "welcomeGift", gift);
    ticketGiven = true;
    logToFile("[가입 선물] 닉네임 변경권 1개 지급");
  }

  const { themes, colors } = welcomeGiftCatalog(uuid);
  const themeCoins = welcomeGiftCoinValue(themes);
  const colorCoins = welcomeGiftCoinValue(colors);
  const needsPick = !gift.pickedAt && (themes.length > 0 || colors.length > 0);

  // 24-192차: 추천인 입력칸을 띄울지 - 아직 안 넣은 계정에만 보여준다
  const referral = await fetchReferralStatus();

  return {
    ok: true,
    eligible: true,
    ticketGiven,
    needsPick,
    themes,
    colors,
    themeCoins,
    colorCoins,
    referralUsed: referral.used,
    referralReward: referral.reward,
  };
});

ipcMain.handle("welcome:claim", (_e, { themeId, colorId } = {}) => {
  const uuid = welcomeGiftUuidIfEligible();
  if (!uuid) return { ok: false, error: "사이트 계정으로 로그인해야 받을 수 있어요." };

  const data = getPlayerData(uuid);
  const gift = { ...(data.welcomeGift || {}) };
  if (gift.pickedAt) return { ok: false, error: "이미 받은 선물이에요." };

  const owned = [...(data.ownedColors || [])];
  const { themes, colors } = welcomeGiftCatalog(uuid);
  const themeCoins = welcomeGiftCoinValue(themes);
  const colorCoins = welcomeGiftCoinValue(colors);

  // 고를 게 있는 칸은 반드시 골라야 하고, 고른 값은 실제로 "아직 안 가진" 후보여야 합니다
  // (화면을 건드려서 엉뚱한 id를 보내도 비싼 상품을 공짜로 가져갈 수 없게).
  // 24-89차: 목록에 이미 가진 것도 같이 내려가므로 owned가 아닌 것만 인정합니다.
  const theme = themes.find((c) => c.id === themeId && !c.owned) || null;
  const color = colors.find((c) => c.id === colorId && !c.owned) || null;
  // 코인으로 대신 받는 칸(그 칸을 전부 가진 경우)은 고를 게 없으니 안 골라도 통과시킵니다.
  if (themes.length > 0 && !themeCoins && !theme)
    return { ok: false, error: "테마를 하나 선택해주세요." };
  if (colors.length > 0 && !colorCoins && !color)
    return { ok: false, error: "색상을 하나 선택해주세요." };

  if (theme) owned.push(theme.id);
  if (color) owned.push(color.id);
  setPlayerField(uuid, "ownedColors", owned);

  // 24-89차: 전부 가진 칸은 코인으로 대신 지급(위 welcomeGiftCoinValue 참고)
  const coinReward = themeCoins + colorCoins;
  if (coinReward > 0) addCoins(coinReward, "가입 축하 선물", uuid);

  // 고르자마자 바로 적용해줍니다. 완전 테마와 색상은 서로 다른 슬롯이라 둘 다 동시에 켜집니다
  // (17차 참고). shop:equip과 달리 여기서는 색상을 지우지 않습니다 - 방금 같이 고른 것이니까요.
  if (theme) setPlayerField(uuid, "equippedThemeMode", theme.id);
  if (color) setPlayerField(uuid, "equippedColor", color.id);

  gift.pickedAt = new Date().toISOString();
  gift.themeId = theme?.id || null;
  gift.colorId = color?.id || null;
  setPlayerField(uuid, "welcomeGift", gift);

  logToFile(
    `[가입 선물] 테마=${gift.themeId || "-"} 색=${gift.colorId || "-"} 코인=${coinReward} 지급 완료`
  );
  return {
    ok: true,
    themeId: gift.themeId,
    themeName: theme?.name || null,
    colorId: gift.colorId,
    colorName: color?.name || null,
    coins: coinReward,
    balance: getCoins(uuid),
  };
});

// ============================================================================
// 24-195차: 클라이언트로 서버 열기
// "클라이언트로 서버 열기 기능도 있으면 좋을 듯" (서버 종류: Fabric 서버까지)
//
// 이 컴퓨터에서 마인크래프트 서버를 직접 띄운다. 서버 폴더는
// %APPDATA%/NovaClient/hosted/<id>/ 에 하나씩 따로 만든다(프로필 폴더와 완전히 분리 -
// 서버가 월드/설정을 같은 폴더에 쓰면 플레이용 프로필이 망가진다).
//
// 한 번에 하나만 켠다. 마인크래프트 서버는 메모리를 통째로 잡고 포트도 하나씩 쓰는데,
// 개인 PC에서 여러 개를 동시에 띄우는 건 사실상 사고라서 일부러 막았다.
//
// 서버 jar:
//   · 바닐라 - 모장 version_manifest 에서 그 버전의 server.jar 주소를 찾아 받는다.
//   · Fabric - meta.fabricmc.net 이 "서버 실행기 jar" 를 바로 만들어 준다. 그 jar 를 처음
//     켜면 필요한 라이브러리와 바닐라 서버를 스스로 받는다(그래서 첫 실행만 좀 걸린다).
//
// ⚠️ eula.txt 는 사용자가 화면에서 직접 동의를 눌렀을 때만 쓴다. 런처가 마음대로 동의
//    처리를 해버리면 안 되는 부분이다(모장 EULA).
// ============================================================================
const HOSTED_MAX_LOG = 400;
const HOSTED_STOP_GRACE_MS = 12000;

function hostedDir() {
  return path.join(getRoot(), "hosted");
}
function hostedServerRoot(id) {
  return path.join(hostedDir(), String(id));
}
function getHostedServers() {
  const list = store.get("hosted_servers");
  return Array.isArray(list) ? list : [];
}
function saveHostedServers(list) {
  store.set("hosted_servers", list);
}
function findHostedServer(id) {
  return getHostedServers().find((h) => h.id === id) || null;
}

let hostedProc = null;
let hostedCurrentId = null;
let hostedState = "stopped"; // stopped | preparing | starting | running | stopping
let hostedLog = [];
let hostedStartedAt = 0;
// 24-207차: 런처를 끄고 다시 켰을 때 "이미 돌고 있는 서버"를 되찾은 상태.
// 이때는 자식 프로세스 손잡이가 없어서 콘솔/명령은 못 쓰고, 끄는 것만 PID로 한다.
let hostedAdopted = false;
let hostedAdoptedPid = 0;

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // 살아 있지만 권한이 없는 경우
  }
}

// 런처가 켜질 때 한 번: 지난번에 켜 둔 서버가 아직 돌고 있으면 그 상태로 되찾는다.
let hostedAdoptTried = false;
function hostedAdoptOrphan() {
  if (hostedAdoptTried) return;
  hostedAdoptTried = true;
  const saved = store.get("hosted_running");
  if (!saved?.id || !saved?.pid) return;
  if (!pidAlive(saved.pid)) {
    store.delete("hosted_running");
    return;
  }
  if (!findHostedServer(saved.id)) {
    store.delete("hosted_running");
    return;
  }
  hostedAdopted = true;
  hostedAdoptedPid = saved.pid;
  hostedCurrentId = saved.id;
  hostedStartedAt = saved.at || Date.now();
  hostedState = "running";
  hostedPushLog("[런처] 이미 돌고 있는 서버에 다시 연결 (콘솔/명령 불가)", "info");
  startHostedAddrTimer(saved.id);
}

function hostedStatus() {
  const s = hostedCurrentId ? findHostedServer(hostedCurrentId) : null;
  return {
    state: hostedState,
    serverId: hostedCurrentId,
    serverName: s?.name || null,
    port: s?.port || null,
    startedAt: hostedStartedAt || null,
    addresses: hostedAddresses(s?.port || null),
    portOpened: !!upnpMapped && upnpMapped.port === (s?.port || null), // 24-197차
    addressFqdn: s?.addressFqdn || null, // 24-198차
    addressSlug: s?.addressSlug || null,
    adopted: hostedAdopted, // 24-207차: 되찾은 서버는 콘솔/명령을 못 쓴다
  };
}
function hostedBroadcast() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("hosted:state", hostedStatus());
  } catch (_) {}
}
function hostedPushLog(line, kind) {
  const text = String(line).replace(/\r/g, "").trimEnd();
  if (!text) return;
  const row = { t: Date.now(), kind: kind || "out", text };
  hostedLog.push(row);
  if (hostedLog.length > HOSTED_MAX_LOG) hostedLog = hostedLog.slice(-HOSTED_MAX_LOG);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("hosted:log", row);
    } catch (_) {}
  }
}
function hostedSetState(next) {
  hostedState = next;
  hostedBroadcast();
}

// 같은 공유기 안에서 쓰는 주소(192.168.x.x 등). 밖에서 들어오려면 포트포워딩이 필요하다.
function hostedAddresses(port) {
  const out = [];
  if (!port) return out;
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (n.family !== "IPv4" || n.internal) continue;
        out.push({ label: "와이파이 공유기", host: n.address, port, iface: name });
      }
    }
  } catch (_) {}
  // 24-211차: "이 컴퓨터 이건 없애줘" - localhost 줄은 뺐다(자기 컴퓨터에서 들어올 일은 거의 없다)
  return out;
}

// 서버는 콘솔 출력을 읽어야 해서 javaw(콘솔 없음) 대신 java 를 쓴다
function getServerJavaExecutable(javaFeatureVersion) {
  const runtime = getRuntimeDir(javaFeatureVersion);
  if (process.platform === "win32") {
    return findFileRecursive(runtime, "java.exe") || findFileRecursive(runtime, "javaw.exe");
  }
  return findJavaBinRecursive(runtime, "java");
}

// 바닐라 server.jar 주소 찾기
async function resolveVanillaServerJarUrl(mcVersion) {
  const res = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  if (!res.ok) throw new Error("마인크래프트 버전 목록을 받지 못했어요.");
  const manifest = await res.json();
  const entry = (manifest.versions || []).find((v) => v.id === String(mcVersion));
  if (!entry) throw new Error(`${mcVersion} 버전을 찾을 수 없어요.`);
  const detailRes = await fetch(entry.url);
  if (!detailRes.ok) throw new Error("버전 정보를 받지 못했어요.");
  const detail = await detailRes.json();
  const url = detail?.downloads?.server?.url;
  if (!url) throw new Error(`${mcVersion} 은(는) 공식 서버 파일이 없어요.`);
  return url;
}

// Fabric 서버 실행기 jar 주소 (로더/설치기 최신 안정판 기준)
async function resolveFabricServerJarUrl(mcVersion) {
  const loaderRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
  if (!loaderRes.ok) throw new Error("Fabric 로더 정보를 받지 못했어요.");
  const loaders = await loaderRes.json();
  const loader = (loaders || []).find((l) => l?.loader?.stable) || (loaders || [])[0];
  if (!loader?.loader?.version) throw new Error(`${mcVersion} 용 Fabric 로더가 없어요.`);

  const instRes = await fetch("https://meta.fabricmc.net/v2/versions/installer");
  if (!instRes.ok) throw new Error("Fabric 설치기 정보를 받지 못했어요.");
  const installers = await instRes.json();
  const installer = (installers || []).find((i) => i.stable) || (installers || [])[0];
  if (!installer?.version) throw new Error("Fabric 설치기 정보를 받지 못했어요.");

  return `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader.loader.version}/${installer.version}/server/jar`;
}

function hostedJarName(server) {
  return server.loader === "fabric" ? "fabric-server-launch.jar" : "server.jar";
}

async function ensureHostedServerJar(server) {
  const dir = hostedServerRoot(server.id);
  await fsp.mkdir(dir, { recursive: true });
  const jarPath = path.join(dir, hostedJarName(server));
  try {
    const st = await fsp.stat(jarPath);
    if (st.size > 1024) return jarPath; // 이미 받아둠
  } catch (_) {}

  hostedPushLog(`[런처] ${server.loader === "fabric" ? "Fabric" : "바닐라"} 서버 파일을 받는 중...`, "info");
  const url =
    server.loader === "fabric"
      ? await resolveFabricServerJarUrl(server.mcVersion)
      : await resolveVanillaServerJarUrl(server.mcVersion);
  await downloadFileWithProgress(url, jarPath, undefined, null);
  hostedPushLog("[런처] 서버 파일 준비 완료", "info");
  return jarPath;
}

// ----------------------------------------------------------------------------
// server.properties 손보기
// 24-197차: "그걸 토대로 우리가 걍 수정하자" - 설정 파일을 메모장으로 열어 고치는 게 아니라
// 런처 창에서 바로 고친다. 그래서 (1) 서버를 만들 때 기본값으로 한 번 써주고, (2) 그 뒤로는
// 사용자가 창에서 바꾼 값만 그 줄을 갈아끼운다. 우리가 모르는 줄과 주석은 손대지 않는다.
// (예전엔 서버를 켤 때마다 motd/max-players 를 우리 값으로 덮어써서, 창에서 고쳐도 다음
//  실행 때 되돌아갔다.)
// ----------------------------------------------------------------------------
function hostedPropertiesPath(id) {
  return path.join(hostedServerRoot(id), "server.properties");
}
async function readHostedProperties(id) {
  try {
    const raw = await fsp.readFile(hostedPropertiesPath(id), "utf-8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1);
    }
    return out;
  } catch (_) {
    return {};
  }
}
// 주어진 키만 갈아끼우고 나머지 줄(주석 포함)은 그대로 둔다
async function patchHostedProperties(id, patch) {
  const file = hostedPropertiesPath(id);
  let lines = [];
  try {
    lines = (await fsp.readFile(file, "utf-8")).split(/\r?\n/);
  } catch (_) {
    lines = ["#Minecraft server properties", "#Nova Client"];
  }
  for (const [k, v] of Object.entries(patch || {})) {
    const i = lines.findIndex((l) => !l.trim().startsWith("#") && l.split("=")[0].trim() === k);
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, lines.join("\n"), "utf-8");
}

// 창에서 고칠 수 있게 열어둔 설정들. 여기 없는 값은 파일에서 직접 고쳐야 한다.
// online-mode 는 일부러 넣지 않는다 - 끄면 아무나 남의 닉네임으로 들어올 수 있다.
// 24-209차: "서버 설정이 버튼, 작성 형식이 뒤죽박죽이라 보기 안예쁘고"
// 칸을 종류별로 묶어서(월드 / 켬끔 / 리소스팩) 화면에서 줄을 맞춰 그릴 수 있게 group 을 넣었다.
// wide 는 한 줄을 통째로 쓰는 칸(주소처럼 긴 값).
const HOSTED_EDITABLE_PROPS = [
  // 24-211차: "motd는 그라데이션이나 색 넣을 수 있으니까" - 색 코드(\u00A7x\u00A7R...)가 붙으면
  // 글자 수가 금방 늘어난다. 보이는 글자는 59자지만 값 자체는 길어질 수 있어서 상한을 올렸다.
  { key: "motd", type: "text", label: "서버 소개", max: 512, group: "world", wide: true },
  { key: "max-players", type: "number", label: "최대 인원", min: 1, max: 200, group: "world" },
  // 24-224차: "왜 다 영어로 돼있어 한글로 패치해주고 단어로만 해라"
  // 서버에 적히는 값(peaceful 등)은 그대로 두고, 화면에 보이는 글자만 names 로 바꿔 보여준다.
  {
    key: "difficulty",
    type: "select",
    label: "난이도",
    options: ["peaceful", "easy", "normal", "hard"],
    names: ["평화", "쉬움", "보통", "어려움"],
    group: "world",
  },
  {
    key: "gamemode",
    type: "select",
    label: "게임 모드",
    options: ["survival", "creative", "adventure", "spectator"],
    names: ["생존", "창작", "모험", "관전"],
    group: "world",
  },
  { key: "spawn-protection", type: "number", label: "스폰 보호 반경", min: 0, max: 64, group: "world" },
  { key: "view-distance", type: "number", label: "시야 거리(청크)", min: 3, max: 32, group: "world" },
  { key: "simulation-distance", type: "number", label: "연산 거리(청크)", min: 3, max: 32, group: "world" },
  // 24-224차: 시드와 월드 종류는 월드를 처음 만들 때만 의미가 있어서(만든 뒤에 바꿔도
  // 이미 생성된 월드에는 적용되지 않는다) 설정 칸에서 빼고 "새 서버 만들기"로 옮겼다.
  { key: "pvp", type: "bool", label: "PvP 허용", group: "toggle" },
  { key: "hardcore", type: "bool", label: "하드코어", group: "toggle" },
  { key: "allow-nether", type: "bool", label: "네더 허용", group: "toggle" },
  { key: "spawn-monsters", type: "bool", label: "몬스터 생성", group: "toggle" },
  { key: "spawn-animals", type: "bool", label: "동물 생성", group: "toggle" },
  { key: "spawn-npcs", type: "bool", label: "주민 생성", group: "toggle" },
  { key: "force-gamemode", type: "bool", label: "게임모드 강제", group: "toggle" },
  { key: "enable-status", type: "bool", label: "상태 공개", group: "toggle" },
  { key: "white-list", type: "bool", label: "화이트리스트", group: "toggle" },
  { key: "allow-flight", type: "bool", label: "비행 허용", group: "toggle" },
  { key: "enable-command-block", type: "bool", label: "커맨드 블록", group: "toggle" },
  { key: "player-idle-timeout", type: "number", label: "자동 퇴장(분)", min: 0, max: 60, group: "advanced" },
  { key: "max-world-size", type: "number", label: "월드 크기 제한", min: 1, max: 29999984, group: "advanced" },
  { key: "entity-broadcast-range-percentage", type: "number", label: "개체 표시 거리", min: 10, max: 1000, group: "advanced" },
  { key: "network-compression-threshold", type: "number", label: "네트워크 압축 기준", min: -1, max: 2048, group: "advanced" },
  { key: "op-permission-level", type: "select", label: "관리자 권한", options: ["1", "2", "3", "4"], names: ["1단계", "2단계", "3단계", "4단계"], group: "advanced" },
  { key: "function-permission-level", type: "select", label: "함수 권한", options: ["1", "2", "3", "4"], names: ["1단계", "2단계", "3단계", "4단계"], group: "advanced" },
  { key: "sync-chunk-writes", type: "bool", label: "청크 즉시 저장", group: "advanced" },
  // 24-207차: "서버 자동 리소스팩도 적용시킬 수 있게"
  // 주소를 넣어두면 들어온 사람에게 그 리소스팩이 자동으로 내려간다. require 를 켜면
  // 받지 않으면 못 들어온다. sha1 은 선택이지만 넣어두면 바뀐 걸 정확히 알아채서 다시 받는다.
  { key: "resource-pack", type: "text", label: "리소스팩 주소", max: 500, group: "pack", wide: true },
  { key: "resource-pack-sha1", type: "text", label: "리소스팩 SHA-1", max: 40, group: "pack", wide: true },
  { key: "require-resource-pack", type: "bool", label: "리소스팩 필수", group: "pack" },
];

// ============================================================================
// 24-197차: 바깥에서도 들어올 수 있게 - 공유기 포트 자동 열기(UPnP) + 공인 IP 확인
//
// 집에서 연 서버는 공유기가 막고 있어서 밖에 있는 친구가 못 들어온다. 보통은 공유기
// 관리자 페이지에 들어가서 "포트포워딩"을 직접 해야 하는데, 대부분의 가정용 공유기는
// UPnP(IGD)라는 표준으로 "이 포트 좀 열어줘"를 프로그램이 요청할 수 있게 해 둔다.
// 그걸 직접 구현했다 - 외부 프로그램을 받아서 돌리지 않는다.
//
// 흐름: SSDP 로 공유기 찾기(UDP 멀티캐스트) → 장치 설명 XML 에서 WAN 서비스의 주소 찾기
//      → SOAP 로 AddPortMapping / GetExternalIPAddress → 끌 때 DeletePortMapping.
//
// 안 되는 경우도 있다(공유기가 UPnP 를 꺼뒀거나, 통신사가 공인 IP 를 안 주는 CGNAT).
// 그럴 땐 실패 이유를 그대로 화면에 띄우고 수동 포트포워딩을 안내한다.
// ============================================================================
const UPNP_SEARCH_MS = 3000;
const UPNP_SOAP_MS = 6000;

let upnpMapped = null; // { port, controlUrl, serviceType } - 켜둔 매핑(끌 때 지우려고)

function upnpXmlTag(xml, tag) {
  // 주의: 템플릿 문자열 안에서는 \s 가 그냥 s 로 죽는다(태그된 템플릿이 아니라서).
  // 정규식을 문자열로 조립할 땐 역슬래시를 두 번 써야 한다.
  const re = new RegExp(
    "<(?:[a-zA-Z0-9]+:)?" + tag + "[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?" + tag + ">",
    "i"
  );
  const m = re.exec(String(xml || ""));
  return m ? m[1].trim() : null;
}

// 공유기(IGD)를 찾아서 설명 XML 주소를 돌려준다
function upnpDiscover() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch (_) {}
      resolve(v);
    };
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const targets = [
      "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
      "urn:schemas-upnp-org:service:WANIPConnection:1",
      "urn:schemas-upnp-org:service:WANPPPConnection:1",
    ];
    sock.on("error", () => finish(null));
    sock.on("message", (msg) => {
      const text = String(msg);
      const m = /^location:\s*(\S+)/im.exec(text);
      if (m) finish(m[1]);
    });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch (_) {}
      for (const st of targets) {
        const payload = Buffer.from(
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            'MAN: "ssdp:discover"\r\n' +
            "MX: 2\r\n" +
            `ST: ${st}\r\n\r\n`
        );
        sock.send(payload, 0, payload.length, 1900, "239.255.255.250");
      }
    });
    setTimeout(() => finish(null), UPNP_SEARCH_MS);
  });
}

async function upnpFetchText(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPNP_SOAP_MS);
  try {
    const res = await fetch(url, { ...(opts || {}), signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// 설명 XML 에서 "포트를 열 수 있는 서비스"의 제어 주소를 찾는다
async function upnpFindService(descUrl) {
  const { ok, text } = await upnpFetchText(descUrl);
  if (!ok || !text) return null;
  const base = new URL(descUrl);
  for (const type of [
    "urn:schemas-upnp-org:service:WANIPConnection:2",
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
  ]) {
    const idx = text.indexOf(type);
    if (idx < 0) continue;
    // 그 서비스 블록 안의 controlURL 만 집는다(앞뒤 <service> 경계로 잘라서 봄)
    const start = text.lastIndexOf("<service", idx);
    const end = text.indexOf("</service>", idx);
    const chunk = text.slice(start < 0 ? 0 : start, end < 0 ? text.length : end);
    const control = upnpXmlTag(chunk, "controlURL");
    if (control) return { serviceType: type, controlUrl: new URL(control, base).toString() };
  }
  return null;
}

async function upnpSoap(service, action, bodyXml) {
  const envelope =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    "<s:Body>" +
    `<u:${action} xmlns:u="${service.serviceType}">${bodyXml || ""}</u:${action}>` +
    "</s:Body></s:Envelope>";
  const { ok, status, text } = await upnpFetchText(service.controlUrl, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${service.serviceType}#${action}"`,
    },
    body: envelope,
  });
  if (!ok) {
    const reason = upnpXmlTag(text || "", "errorDescription") || `HTTP ${status}`;
    throw new Error(reason);
  }
  return text || "";
}

function upnpLocalIPv4() {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) return n.address;
      }
    }
  } catch (_) {}
  return null;
}

async function upnpOpenPort(port) {
  const descUrl = await upnpDiscover();
  if (!descUrl) throw new Error("공유기를 찾지 못했어요(UPnP가 꺼져 있을 수 있어요).");
  const service = await upnpFindService(descUrl);
  if (!service) throw new Error("공유기가 포트 열기를 지원하지 않아요.");
  const localIp = upnpLocalIPv4();
  if (!localIp) throw new Error("이 컴퓨터의 내부 IP를 찾지 못했어요.");

  const body =
    "<NewRemoteHost></NewRemoteHost>" +
    `<NewExternalPort>${port}</NewExternalPort>` +
    "<NewProtocol>TCP</NewProtocol>" +
    `<NewInternalPort>${port}</NewInternalPort>` +
    `<NewInternalClient>${localIp}</NewInternalClient>` +
    "<NewEnabled>1</NewEnabled>" +
    "<NewPortMappingDescription>Nova Client Minecraft</NewPortMappingDescription>" +
    "<NewLeaseDuration>0</NewLeaseDuration>";
  await upnpSoap(service, "AddPortMapping", body);

  let externalIp = null;
  try {
    const xml = await upnpSoap(service, "GetExternalIPAddress", "");
    externalIp = upnpXmlTag(xml, "NewExternalIPAddress");
  } catch (_) {}

  upnpMapped = { port, ...service };
  return { localIp, externalIp };
}

async function upnpClosePort() {
  if (!upnpMapped) return;
  const m = upnpMapped;
  upnpMapped = null;
  try {
    await upnpSoap(m, "DeletePortMapping", "<NewRemoteHost></NewRemoteHost>" + `<NewExternalPort>${m.port}</NewExternalPort>` + "<NewProtocol>TCP</NewProtocol>");
    logToFile(`[서버 열기] 공유기 포트 ${m.port} 닫음`);
  } catch (err) {
    logToFile("[서버 열기] 공유기 포트 닫기 실패(무시): " + (err?.message || err));
  }
}

// 통신사가 공인 IP 를 안 주는지(CGNAT) 판단하려고 사설 대역인지 본다
function isPrivateIPv4(ip) {
  if (!ip) return true;
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
  return false;
}

// ============================================================================
// 24-198차: 내가 연 서버에 주소 붙이기
// "주소도 직접 설정해서 설정한 주소가 아이피랑 같은 역할을 하게 해서 들어오게 할 수 있어?"
//
// 이름을 하나 고르면 <이름>.<우리 도메인> 이 그 사람의 공인 IP 를 가리키게 된다. 뒤에 붙는
// 도메인은 사이트가 정한다(Nova-Site 의 NOVA_HOST_DOMAIN) - 런처에는 박아두지 않는다. 집 IP 는
// 수시로 바뀌니까, 서버를 켤 때와 그 뒤 10분마다 "지금 내 IP" 를 사이트에 다시 알려서
// DNS 를 갱신한다(= DDNS). 포트까지 숨기려고 SRV 레코드도 같이 만들어서, 친구는 포트를
// 몰라도 주소만 치면 들어온다.
//
// ⚠️ 공인 IP 는 런처가 알아내서 보내지 않는다. 사이트가 "이 요청이 어느 IP 에서 왔는지"를
//    보고 그걸 쓴다 - 런처 말을 믿으면 아무 IP 나 적어서 남의 주소를 엉뚱한 곳으로 돌릴 수
//    있기 때문이다(Nova-Site 의 lib/hostedAddresses.js 주석 참고).
// ============================================================================
const HOSTED_ADDR_REFRESH_MS = 10 * 60 * 1000;
let hostedAddrTimer = null;

async function hostedAddrFetch(action, extra) {
  if (!cachedSiteSession?.accountId) {
    return { ok: false, error: "사이트 계정으로 로그인해야 주소를 쓸 수 있어요." };
  }
  try {
    return await novaSiteFetch("hosted-address", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      action,
      ...(extra || {}),
    });
  } catch (err) {
    logToFile("[주소] 요청 실패: " + (err?.message || err));
    return { ok: false, error: "서버에 연결하지 못했어요." };
  }
}

ipcMain.handle("hosted:address-list", () => hostedAddrFetch("list"));

async function hostedClaimAddressFor(id, slug) {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  // 24-199차: 이 서버에 이미 다른 주소가 붙어 있으면 그걸 먼저 뗀다. 안 그러면 쓰지도
  // 않는 옛 주소가 계정 한도(3개)를 계속 차지하고, 그 주소도 계속 이 집을 가리킨다.
  const prev = server.addressSlug;
  const res = await hostedAddrFetch("claim", { slug });
  if (!res?.ok) return res || { ok: false, error: "주소를 만들지 못했어요." };
  if (prev && prev !== res.slug) {
    await hostedAddrFetch("release", { slug: prev });
    logToFile(`[서버 열기] 옛 주소 ${prev} 을(를) 뗌`);
  }

  const list = getHostedServers();
  const row = list.find((h) => h.id === id);
  if (row) {
    row.addressSlug = res.slug;
    row.addressFqdn = res.fqdn;
    saveHostedServers(list);
  }
  hostedPushLog(`[런처] 주소: ${res.fqdn}`, "info");
  // 24-213차: 예전에는 "서버가 켜져 있을 때만" IP 를 맞췄다. 그런데 주소를 만드는 일(claim)은
  // 데이터베이스에 이름만 잡아두는 것이고, 실제 DNS 레코드(A/SRV)는 이 맞추기(refresh)에서
  // 만들어진다. 그래서 주소를 만들어 놓고 서버를 켜기 전에 그 주소로 들어가보면 "그런 주소
  // 없음"(NXDOMAIN)이 떴다 - 사용자 눈에는 "주소가 안 되는" 것으로 보였다.
  // 이제 만들자마자 바로 지금 집 IP 로 레코드를 만들어 둔다.
  const fixed = await hostedAddrRefresh(id, true);
  hostedBroadcast();
  if (fixed && !fixed.ok) return { ...res, warn: fixed.error };
  return res;
}
ipcMain.handle("hosted:address-claim", (_e, { id, slug } = {}) => hostedClaimAddressFor(id, slug));

ipcMain.handle("hosted:address-release", async (_e, id) => {
  const server = findHostedServer(id);
  if (!server?.addressSlug) return { ok: true };
  const res = await hostedAddrFetch("release", { slug: server.addressSlug });
  const list = getHostedServers();
  const row = list.find((h) => h.id === id);
  if (row) {
    delete row.addressSlug;
    delete row.addressFqdn;
    saveHostedServers(list);
  }
  hostedBroadcast();
  return res || { ok: true };
});

// 지금 IP 로 DNS 를 맞춘다. 서버를 켤 때 한 번, 그 뒤 10분마다.
async function hostedAddrRefresh(id, loud) {
  const server = findHostedServer(id);
  if (!server?.addressSlug) return null;
  const res = await hostedAddrFetch("refresh", { slug: server.addressSlug, port: server.port });
  if (!res?.ok) {
    hostedPushLog(`[런처] 주소 갱신 실패: ${res?.error || "알 수 없음"}`, "err");
    return res || { ok: false, error: "주소를 맞추지 못했어요." };
  }
  if (loud || res.changed) {
    hostedPushLog(
      `[런처] ${res.fqdn} → ${res.ip}:${res.port}`,
      "info"
    );
  }
  return res;
}

function startHostedAddrTimer(id) {
  stopHostedAddrTimer();
  const server = findHostedServer(id);
  if (!server?.addressSlug) return;
  hostedAddrRefresh(id, true);
  hostedAddrTimer = setInterval(() => hostedAddrRefresh(id, false), HOSTED_ADDR_REFRESH_MS);
}
function stopHostedAddrTimer() {
  if (hostedAddrTimer) {
    clearInterval(hostedAddrTimer);
    hostedAddrTimer = null;
  }
}

ipcMain.handle("hosted:open-port", async (_e, id) => {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  try {
    hostedPushLog("[런처] 공유기에 포트 열기를 요청하는 중...", "info");
    const { localIp, externalIp } = await upnpOpenPort(server.port);
    const cg = isPrivateIPv4(externalIp);
    hostedPushLog(
      `[런처] 공유기 포트 ${server.port} 열림 (내부 ${localIp}${externalIp ? ` / 외부 ${externalIp}` : ""})`,
      "info"
    );
    if (cg && externalIp) {
      hostedPushLog(
        "[런처] 공유기가 받은 IP도 사설 IP예요 - 통신사 쪽에서 한 번 더 막혀 있어서(CGNAT) 밖에서는 못 들어올 수 있어요.",
        "err"
      );
    }
    hostedBroadcast();
    return { ok: true, localIp, externalIp, cgnat: cg };
  } catch (err) {
    hostedPushLog(`[런처] 포트를 열지 못했어요: ${err?.message || err}`, "err");
    return { ok: false, error: err?.message || "포트를 열지 못했어요." };
  }
});

ipcMain.handle("hosted:close-port", async () => {
  await upnpClosePort();
  hostedBroadcast();
  return { ok: true };
});

// 24-229차: "서버 아이언~골드 최대2개 플래티넘 이상은 최대3개 / 상점에서 1개 더"
function hostedServerLimit() {
  const base = myPerks()?.servers || 2;
  const extra = Math.min(1, Number((getPlayerData(getActivePlayerUuid())?.consumables || {}).serverSlots) || 0);
  return { base, extra, max: base + extra, tier: myTier() };
}
async function hostedLimitError(count) {
  let lim = hostedServerLimit();
  if (count < lim.max) return null;
  await tierSyncMine().catch(() => {}); // 티어가 막 올랐을 수 있다
  lim = hostedServerLimit();
  return count < lim.max ? null : `서버 최대 ${lim.max}개`;
}
ipcMain.handle("hosted:limit", () => ({ ok: true, used: getHostedServers().length, ...hostedServerLimit() }));

ipcMain.handle("hosted:list", () => {
  const running = hostedCurrentId;
  return getHostedServers().map((h) => ({ ...h, running: h.id === running && hostedState !== "stopped" }));
});
ipcMain.handle("hosted:status", () => {
  hostedAdoptOrphan();
  return hostedStatus();
});
ipcMain.handle("hosted:get-log", () => hostedLog);

ipcMain.handle("hosted:create", async (_e, payload = {}) => {
  const name = String(payload.name || "").trim().slice(0, 32);
  const mcVersion = String(payload.mcVersion || "").trim();
  if (!name) return { ok: false, error: "서버 이름을 입력해주세요." };
  if (!mcVersion) return { ok: false, error: "마인크래프트 버전을 골라주세요." };
  const loader = payload.loader === "fabric" ? "fabric" : "vanilla";
  const port = Math.min(65535, Math.max(1024, Number(payload.port) || 25565));
  const list = getHostedServers();
  // 24-229차: 티어별 최대 개수(+ 상점 슬롯)
  const limitErr = await hostedLimitError(list.length);
  if (limitErr) return { ok: false, error: limitErr };
  // 24-207차: "같은 포트는 왜 못만들어" - 한 번에 하나만 켜지므로 포트가 겹쳐도 충돌하지
  // 않는다. 막을 이유가 없어서 뺐다(같은 포트로 여러 개 만들어두고 골라 켜는 게 자연스럽다).
  // 24-197차: "율라 직접 고치는 거 말고 바로 고쳐넣기 하면 안돼? 만들 때부터 수락 받는 거지"
  // EULA 동의를 만들 때 한 번 받고, 받은 그 자리에서 eula.txt 를 써버린다. 만든 뒤에
  // 체크박스를 또 누르게 하던 단계를 없앴다. 동의 없이 만들 수는 없다(서버가 안 켜진다).
  if (!payload.acceptEula) {
    return { ok: false, error: "마인크래프트 EULA에 동의해야 서버를 만들 수 있어요." };
  }
  const maxPlayers = Math.min(200, Math.max(1, Number(payload.maxPlayers) || 10));
  const motd = String(payload.motd || name).slice(0, 59);
  const server = {
    id: `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    mcVersion,
    loader,
    memoryGB: Math.min(16, Math.max(1, Number(payload.memoryGB) || 2)),
    port,
    maxPlayers,
    motd,
    eulaAccepted: true,
    eulaAcceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const dir = hostedServerRoot(server.id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "eula.txt"),
    `# https://aka.ms/MinecraftEULA\n# Nova Client - ${server.eulaAcceptedAt} 에 사용자가 동의함\neula=true\n`,
    "utf-8"
  );
  // 서버를 처음 켜기 전에도 창에서 설정을 고칠 수 있도록 기본값을 미리 써둔다
  // 24-224차: 시드/월드 종류는 여기서(=월드가 만들어지기 전에) 한 번만 정한다
  const levelSeed = String(payload.levelSeed || "").trim().slice(0, 64);
  const levelType = ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified"].includes(
    payload.levelType
  )
    ? payload.levelType
    : "minecraft:normal";
  await patchHostedProperties(server.id, {
    "server-port": String(port),
    "max-players": String(maxPlayers),
    motd,
    "online-mode": "true", // 정품 확인은 끄지 않는다
    difficulty: "normal",
    gamemode: "survival",
    pvp: "true",
    "white-list": "false",
    "enable-command-block": "false",
    "level-seed": levelSeed,
    "level-type": levelType,
  });
  list.push(server);
  saveHostedServers(list);
  logToFile(`[서버 열기] 새 서버 "${name}" (${loader} ${mcVersion}, 포트 ${port})`);

  // 24-213차: "주소는 서버 만들기 할 때도 설정하게 하고" - 만들면서 받은 이름으로 바로 잡는다.
  // 주소를 못 잡아도 서버 자체는 이미 만들어졌으니, 이유만 같이 돌려준다.
  const slug = String(payload.addressSlug || "").trim().toLowerCase();
  if (slug) {
    const claimed = await hostedClaimAddressFor(server.id, slug);
    if (!claimed?.ok) return { ok: true, server, addressError: claimed?.error || "주소 실패" };
    const fresh = findHostedServer(server.id);
    return { ok: true, server: fresh || server };
  }
  return { ok: true, server };
});

ipcMain.handle("hosted:get-properties", async (_e, id) => {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  const values = await readHostedProperties(id);
  return { ok: true, fields: HOSTED_EDITABLE_PROPS, values };
});

ipcMain.handle("hosted:set-properties", async (_e, { id, values } = {}) => {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  const patch = {};
  for (const f of HOSTED_EDITABLE_PROPS) {
    if (!(f.key in (values || {}))) continue;
    let v = values[f.key];
    if (f.type === "bool") v = v ? "true" : "false";
    else if (f.type === "number") {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) continue;
      v = String(Math.min(f.max ?? 9999, Math.max(f.min ?? 0, n)));
    } else if (f.type === "select") {
      if (!f.options.includes(String(v))) continue;
      v = String(v);
    } else {
      v = String(v).slice(0, f.max || 200).replace(/[\r\n]/g, " ");
    }
    patch[f.key] = v;
  }
  await patchHostedProperties(id, patch);

  // 목록 표시에 쓰는 값도 같이 맞춰둔다
  const list = getHostedServers();
  const row = list.find((h) => h.id === id);
  if (row) {
    if (patch.motd !== undefined) row.motd = patch.motd;
    if (patch["max-players"] !== undefined) row.maxPlayers = Number(patch["max-players"]);
    saveHostedServers(list);
  }
  const running = hostedCurrentId === id && hostedState !== "stopped";
  return { ok: true, needsRestart: running };
});

ipcMain.handle("hosted:remove", async (_e, id) => {
  if (hostedCurrentId === id && hostedState !== "stopped") {
    return { ok: false, error: "켜져 있는 서버는 지울 수 없어요. 먼저 꺼주세요." };
  }
  const list = getHostedServers();
  const idx = list.findIndex((h) => h.id === id);
  if (idx < 0) return { ok: false, error: "서버를 찾을 수 없어요." };
  const [removed] = list.splice(idx, 1);
  saveHostedServers(list);
  // 24-199차: 붙여둔 주소도 같이 뗀다. 안 그러면 지운 서버의 주소가 계속 이 집 IP 를
  // 가리키고(남이 그 주소로 들어오려 시도함), 그 이름도 계속 점유된 채로 남는다.
  if (removed?.addressSlug) {
    const res = await hostedAddrFetch("release", { slug: removed.addressSlug });
    logToFile(
      `[서버 열기] 주소 ${removed.addressFqdn || removed.addressSlug} 도 같이 뗌 (${res?.ok ? "성공" : res?.error || "실패"})`
    );
  }
  // 월드까지 같이 지우면 되돌릴 수 없으니, 폴더는 남겨두고 목록에서만 뺀다
  logToFile(`[서버 열기] "${removed.name}" 을 목록에서 지움(폴더는 그대로 둠)`);
  return { ok: true, folder: hostedServerRoot(id) };
});

ipcMain.handle("hosted:open-folder", (_e, id) => {
  shell.openPath(hostedServerRoot(id));
  return { ok: true };
});

ipcMain.handle("hosted:accept-eula", async (_e, id) => {
  const list = getHostedServers();
  const server = list.find((h) => h.id === id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  await fsp.mkdir(hostedServerRoot(id), { recursive: true });
  await fsp.writeFile(
    path.join(hostedServerRoot(id), "eula.txt"),
    "# https://aka.ms/MinecraftEULA\neula=true\n",
    "utf-8"
  );
  server.eulaAccepted = true;
  saveHostedServers(list);
  return { ok: true };
});

// 프로필의 모드를 서버로 복사. fabric.mod.json 의 environment 가 "client" 인 모드는
// 서버에 넣으면 안 되므로(대개 바로 뻗는다) 건너뛴다. 런처가 몰래 넣는 모드도 제외.
ipcMain.handle("hosted:copy-mods", async (_e, { id, profileId } = {}) => {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  if (server.loader !== "fabric") return { ok: false, error: "Fabric 서버에만 모드를 넣을 수 있어요." };
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "프로필을 찾을 수 없어요." };

  const srcDir = path.join(getProfileRoot(profile.id), "mods");
  const destDir = path.join(hostedServerRoot(id), "mods");
  await fsp.mkdir(destDir, { recursive: true });

  let files = [];
  try {
    files = await fsp.readdir(srcDir);
  } catch (_) {
    return { ok: false, error: "그 프로필에는 모드 폴더가 없어요." };
  }

  const copied = [];
  const skipped = [];
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".jar")) continue; // .disabled 는 건너뜀
    if (isHiddenModFileName(f)) continue; // 런처가 넣는 것들
    const full = path.join(srcDir, f);
    let env = "*";
    try {
      const entry = new AdmZip(full).getEntry("fabric.mod.json");
      if (entry) {
        const meta = JSON.parse(entry.getData().toString("utf-8"));
        env = String(meta.environment || "*").toLowerCase();
      }
    } catch (_) {
      // 읽을 수 없는 jar 는 안전하게 건너뛴다
      skipped.push({ name: f, why: "읽을 수 없음" });
      continue;
    }
    if (env === "client") {
      skipped.push({ name: f, why: "클라이언트 전용" });
      continue;
    }
    await fsp.copyFile(full, path.join(destDir, f));
    copied.push(f);
  }
  logToFile(`[서버 열기] 모드 복사: ${copied.length}개 복사 / ${skipped.length}개 건너뜀`);
  return { ok: true, copied: copied.length, skipped };
});

ipcMain.handle("hosted:start", async (_e, id) => {
  if (hostedState !== "stopped") return { ok: false, error: "이미 서버가 켜져 있어요." };
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  if (!server.eulaAccepted) return { ok: false, error: "먼저 마인크래프트 EULA에 동의해주세요.", needsEula: true };

  hostedCurrentId = id;
  hostedLog = [];
  hostedStartedAt = 0;
  hostedSetState("preparing");
  try {
    const dir = hostedServerRoot(id);
    await fsp.mkdir(dir, { recursive: true });
    const jarPath = await ensureHostedServerJar(server);
    // 24-197차: 켤 때는 포트만 확인한다(나머지는 창에서 고친 값을 그대로 둔다)
    await patchHostedProperties(server.id, { "server-port": String(server.port) });

    const javaFeatureVersion = getJavaFeatureVersionFor(server.mcVersion, server.loader);
    hostedPushLog(`[런처] 자바 JRE ${javaFeatureVersion} 확인`, "info");
    await ensureJava(undefined, javaFeatureVersion, { silent: true });
    const javaPath = getServerJavaExecutable(javaFeatureVersion);
    if (!javaPath) throw new Error("자바를 찾지 못했어요.");

    const mem = `${server.memoryGB}G`;
    const args = [`-Xms${mem}`, `-Xmx${mem}`, "-jar", path.basename(jarPath), "nogui"];
    hostedPushLog(`[런처] 서버 시작 - 메모리 ${mem} / 포트 ${server.port}`, "info");
    hostedSetState("starting");

    // 24-207차: 런처를 꺼도 서버는 계속 돌아야 하므로 자기 프로세스 그룹으로 떼어 낸다.
    // (Windows 에서 detached 는 DETACHED_PROCESS - 새 콘솔 창이 뜨지는 않는다)
    hostedProc = spawn(javaPath, args, { cwd: dir, detached: true });
    hostedStartedAt = Date.now();
    hostedAdopted = false;
    // 런처를 다시 켰을 때 이 서버를 되찾기 위한 표시
    store.set("hosted_running", { id, pid: hostedProc.pid, at: hostedStartedAt });

    const onChunk = (kind) => (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (hostedEatStatLine(line)) continue; // 24-213차: 우리가 물어본 상태값
        hostedPushLog(line, kind);
        // "Done (12.345s)! For help..." 가 뜨면 실제로 접속을 받기 시작한 것
        if (hostedState === "starting" && /\bDone\s*\(/i.test(line)) {
          hostedSetState("running");
          startHostedStats(); // 24-213차
        }
      }
    };
    hostedProc.stdout?.on("data", onChunk("out"));
    hostedProc.stderr?.on("data", onChunk("err"));
    hostedProc.on("error", (err) => {
      hostedPushLog(`[런처] 실행 실패: ${err?.message || err}`, "err");
    });
    hostedProc.on("close", (code) => {
      hostedPushLog(`[런처] 서버 종료 (코드 ${code})`, "info");
      upnpClosePort(); // 24-197차: 열어둔 공유기 포트는 같이 닫는다
      stopHostedAddrTimer(); // 24-198차: 주소 갱신도 멈춘다
      stopHostedStats(); // 24-213차
      hostedProc = null;
      hostedStartedAt = 0;
      hostedAdopted = false;
      store.delete("hosted_running");
      hostedSetState("stopped");
      hostedCurrentId = null;
    });

    // 24-198차: 주소를 붙여둔 서버면 지금 IP 로 맞추고, 그 뒤 주기적으로 다시 맞춘다
    startHostedAddrTimer(id);

    // 마지막으로 켠 시각 기록
    const list = getHostedServers();
    const row = list.find((h) => h.id === id);
    if (row) {
      row.lastStartedAt = new Date().toISOString();
      saveHostedServers(list);
    }
    return { ok: true };
  } catch (err) {
    hostedPushLog(`[런처] ${err?.message || err}`, "err");
    hostedProc = null;
    hostedCurrentId = null;
    hostedSetState("stopped");
    logToFile("[서버 열기] 실행 실패: " + (err?.stack || err));
    return { ok: false, error: err?.message || "서버를 켜지 못했어요." };
  }
});

ipcMain.handle("hosted:command", (_e, text) => {
  // 24-207차: 런처를 다시 켜서 되찾은 서버에는 명령을 넣을 길이 없다(stdin 이 없음)
  if (hostedAdopted) {
    return { ok: false, error: "런처를 다시 켠 뒤에는 명령을 보낼 수 없어요. 서버를 끄고 다시 켜면 콘솔을 쓸 수 있어요." };
  }
  if (!hostedProc || !hostedProc.stdin) return { ok: false, error: "서버가 켜져 있지 않아요." };
  const line = String(text || "").trim();
  if (!line) return { ok: false };
  try {
    hostedProc.stdin.write(line + "\n");
    hostedPushLog("> " + line, "cmd");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "명령을 보내지 못했어요." };
  }
});

// 24-207차: "서버 눌렀을 때 수정도 안돼" - 서버 자체 값(이름/메모리/포트)을 창에서 고칠 수
// 있게 한다. 켜져 있는 동안 바꾼 값은 다음에 켤 때부터 적용된다.
ipcMain.handle("hosted:update", async (_e, { id, patch } = {}) => {
  const list = getHostedServers();
  const row = list.find((h) => h.id === id);
  if (!row) return { ok: false, error: "서버를 찾을 수 없어요." };

  if (patch?.name !== undefined) {
    const name = String(patch.name).trim().slice(0, 32);
    if (!name) return { ok: false, error: "서버 이름을 입력해주세요." };
    row.name = name;
  }
  if (patch?.memoryGB !== undefined) {
    row.memoryGB = Math.min(16, Math.max(1, Number(patch.memoryGB) || row.memoryGB));
  }
  if (patch?.port !== undefined) {
    row.port = Math.min(65535, Math.max(1024, Number(patch.port) || row.port));
  }
  saveHostedServers(list);
  // 포트는 server.properties 에도 맞춰둔다
  await patchHostedProperties(id, { "server-port": String(row.port) });
  hostedBroadcast();
  const running = hostedCurrentId === id && hostedState !== "stopped";
  return { ok: true, server: row, needsRestart: running };
});


// ============================================================================
// 24-210차: 화이트리스트 관리 / 모드팩으로 서버 만들기
// "화이트리스트 추가하고 목록 보는 곳도 따로 만들어줘 그리고 모드팩 넣으면 알아서 모드팩
//  분해하고 넣어서 모드팩서버로 만들어주는 것도 해주고"
// ============================================================================

function hostedWhitelistPath(id) {
  return path.join(hostedServerRoot(id), "whitelist.json");
}
async function readHostedWhitelist(id) {
  try {
    const raw = await fsp.readFile(hostedWhitelistPath(id), "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((r) => r && r.name) : [];
  } catch (_) {
    return [];
  }
}
async function writeHostedWhitelist(id, list) {
  await fsp.mkdir(hostedServerRoot(id), { recursive: true });
  await fsp.writeFile(hostedWhitelistPath(id), JSON.stringify(list, null, 2), "utf-8");
}
// 8-4-4-4-12 형태로. whitelist.json 은 하이픈이 들어간 UUID 를 쓴다.
function dashUuid(hex) {
  const h = String(hex || "").replace(/-/g, "");
  if (h.length !== 32) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// 닉네임 → 정품 계정 UUID. 서버가 꺼져 있을 때는 우리가 직접 찾아서 넣어야 한다
// (켜져 있으면 서버 콘솔에 whitelist add 를 보내서 서버가 찾게 한다).
async function mojangProfileByName(name) {
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error("마인크래프트 계정을 찾지 못했어요.");
  const data = await res.json();
  const uuid = dashUuid(data?.id);
  if (!uuid) return null;
  return { uuid, name: data.name || name };
}

// 켜져 있는 그 서버면 콘솔로 시키고(서버가 whitelist.json 을 직접 고친다), 아니면 파일을 고친다
function hostedIsLive(id) {
  return hostedCurrentId === id && hostedState !== "stopped";
}
async function hostedWhitelistViaConsole(cmd) {
  if (!hostedProc?.stdin) return false;
  try {
    hostedProc.stdin.write(cmd + "\n");
    hostedPushLog("> " + cmd, "cmd");
    await new Promise((r) => setTimeout(r, 900)); // 서버가 파일을 쓸 시간
    return true;
  } catch (_) {
    return false;
  }
}

ipcMain.handle("hosted:whitelist-list", async (_e, id) => {
  if (!findHostedServer(id)) return { ok: false, error: "서버를 찾을 수 없어요." };
  const props = await readHostedProperties(id);
  return { ok: true, players: await readHostedWhitelist(id), enabled: String(props["white-list"]) === "true" };
});

ipcMain.handle("hosted:whitelist-add", async (_e, { id, name } = {}) => {
  if (!findHostedServer(id)) return { ok: false, error: "서버를 찾을 수 없어요." };
  const nick = String(name || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
    return { ok: false, error: "닉네임은 영문·숫자·밑줄(_) 3~16자여야 해요." };
  }
  const list = await readHostedWhitelist(id);
  if (list.some((r) => String(r.name).toLowerCase() === nick.toLowerCase())) {
    return { ok: false, error: "이미 들어 있는 사람이에요." };
  }
  if (hostedIsLive(id) && (await hostedWhitelistViaConsole(`whitelist add ${nick}`))) {
    return { ok: true, players: await readHostedWhitelist(id) };
  }
  let profile = null;
  try {
    profile = await mojangProfileByName(nick);
  } catch (err) {
    return { ok: false, error: err?.message || "계정을 확인하지 못했어요." };
  }
  if (!profile) return { ok: false, error: `"${nick}" 이라는 마인크래프트 계정이 없어요.` };
  list.push(profile);
  await writeHostedWhitelist(id, list);
  return { ok: true, players: list };
});

ipcMain.handle("hosted:whitelist-remove", async (_e, { id, name } = {}) => {
  if (!findHostedServer(id)) return { ok: false, error: "서버를 찾을 수 없어요." };
  const nick = String(name || "").trim();
  if (hostedIsLive(id) && (await hostedWhitelistViaConsole(`whitelist remove ${nick}`))) {
    return { ok: true, players: await readHostedWhitelist(id) };
  }
  const list = (await readHostedWhitelist(id)).filter(
    (r) => String(r.name).toLowerCase() !== nick.toLowerCase()
  );
  await writeHostedWhitelist(id, list);
  return { ok: true, players: list };
});

// ----------------------------------------------------------------------------
// 모드팩으로 서버 만들기
//
// .mrpack (Modrinth) 이 가장 깔끔하다. 안에 든 modrinth.index.json 에 마크 버전·로더 버전과
// 파일마다 받을 주소가 다 적혀 있고, 파일마다 "서버에서 쓰는지"(env.server) 까지 들어 있어서
// 클라이언트 전용 모드를 알아서 뺄 수 있다. 별도 API 키도 필요 없다.
//
// CurseForge 의 일반 모드팩 zip 은 manifest.json 에 projectID/fileID 만 있고 실제 주소가
// 없어서, 그 숫자로 파일을 받으려면 CurseForge API 키가 있어야 한다(우리는 안 쓴다).
// 대신 모드팩 페이지의 "Server Pack" zip 은 mods 폴더가 통째로 들어 있어서 그대로 풀면 된다.
// 그래서 zip 안에 mods 폴더가 있으면 그대로 풀고, 없으면 서버 팩을 받아오라고 알려준다.
// ----------------------------------------------------------------------------
function modpackProgress(stage, done, total, text) {
  try {
    mainWindow?.webContents?.send("hosted:modpack-progress", { stage, done, total, text });
  } catch (_) {}
}

function zipEntryText(zip, name) {
  const e = zip.getEntry(name);
  return e ? zip.readAsText(e) : null;
}
// zip 안의 한 폴더를 서버 폴더로 풀어낸다. ".." 가 든 경로는 무시한다(zip slip 방지).
async function extractZipFolder(zip, prefix, destDir) {
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/");
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    if (!rel || rel.includes("..")) continue;
    const out = path.join(destDir, rel);
    if (!out.startsWith(destDir)) continue;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, entry.getData());
    count++;
  }
  return count;
}

ipcMain.handle("hosted:pick-modpack", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "모드팩 파일 고르기",
    properties: ["openFile"],
    filters: [
      { name: "모드팩", extensions: ["mrpack", "zip"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok: false };
  const filePath = res.filePaths[0];
  try {
    const zip = new AdmZip(filePath);
    const idx = zipEntryText(zip, "modrinth.index.json");
    if (idx) {
      const meta = JSON.parse(idx);
      const deps = meta.dependencies || {};
      const loader = deps["fabric-loader"] ? "fabric" : deps["quilt-loader"] ? "quilt" : deps.forge ? "forge" : deps.neoforge ? "neoforge" : "vanilla";
      return {
        ok: true,
        filePath,
        kind: "mrpack",
        name: meta.name || path.basename(filePath, path.extname(filePath)),
        mcVersion: deps.minecraft || "",
        loader,
        fileCount: (meta.files || []).length,
      };
    }
    const man = zipEntryText(zip, "manifest.json");
    const hasMods = zip.getEntries().some((e) => /(^|\/)mods\/.+\.jar$/i.test(e.entryName.replace(/\\/g, "/")));
    if (man) {
      const meta = JSON.parse(man);
      const loaderId = String(meta?.minecraft?.modLoaders?.[0]?.id || "");
      const loader = loaderId.startsWith("fabric") ? "fabric" : loaderId.startsWith("forge") ? "forge" : loaderId.startsWith("neoforge") ? "neoforge" : "vanilla";
      return {
        ok: true,
        filePath,
        kind: hasMods ? "curseforge-server" : "curseforge",
        name: meta.name || path.basename(filePath, ".zip"),
        mcVersion: meta?.minecraft?.version || "",
        loader,
        fileCount: (meta.files || []).length,
      };
    }
    if (hasMods) {
      return {
        ok: true,
        filePath,
        kind: "serverpack",
        name: path.basename(filePath, path.extname(filePath)),
        mcVersion: "",
        loader: "fabric",
        fileCount: 0,
      };
    }
    return { ok: false, error: "모드팩 파일이 아닌 것 같아요(mods 폴더도 modrinth.index.json 도 없어요)." };
  } catch (err) {
    return { ok: false, error: err?.message || "모드팩 파일을 열지 못했어요." };
  }
});

ipcMain.handle("hosted:create-from-modpack", async (_e, payload = {}) => {
  const filePath = String(payload.filePath || "");
  if (!filePath) return { ok: false, error: "모드팩 파일을 골라주세요." };
  if (!payload.acceptEula) return { ok: false, error: "마인크래프트 EULA에 동의해야 서버를 만들 수 있어요." };
  const limitErr = await hostedLimitError(getHostedServers().length); // 24-229차
  if (limitErr) return { ok: false, error: limitErr };

  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (err) {
    return { ok: false, error: "모드팩 파일을 열지 못했어요." };
  }

  const idxText = zipEntryText(zip, "modrinth.index.json");
  const manText = zipEntryText(zip, "manifest.json");
  let meta = null;
  let kind = "serverpack";
  if (idxText) {
    meta = JSON.parse(idxText);
    kind = "mrpack";
  } else if (manText) {
    meta = JSON.parse(manText);
    kind = "curseforge";
  }

  // 버전과 로더: 모드팩이 알려주면 그걸 쓰고, 없으면 만들기 폼에서 고른 값
  let mcVersion = String(payload.mcVersion || "").trim();
  let loader = payload.loader === "vanilla" ? "vanilla" : "fabric";
  if (kind === "mrpack") {
    const deps = meta.dependencies || {};
    mcVersion = deps.minecraft || mcVersion;
    if (deps.forge || deps.neoforge) {
      return { ok: false, error: "Forge / NeoForge 모드팩은 아직 열 수 없어요. Fabric 모드팩을 써주세요." };
    }
    if (deps["quilt-loader"]) {
      return { ok: false, error: "Quilt 모드팩은 아직 열 수 없어요. Fabric 모드팩을 써주세요." };
    }
    loader = deps["fabric-loader"] ? "fabric" : "vanilla";
  } else if (kind === "curseforge") {
    mcVersion = meta?.minecraft?.version || mcVersion;
    const loaderId = String(meta?.minecraft?.modLoaders?.[0]?.id || "");
    if (loaderId.startsWith("forge") || loaderId.startsWith("neoforge")) {
      return { ok: false, error: "Forge / NeoForge 모드팩은 아직 열 수 없어요. Fabric 모드팩을 써주세요." };
    }
    loader = loaderId.startsWith("fabric") ? "fabric" : "vanilla";
    const hasMods = zip.getEntries().some((e) => /(^|\/)mods\/.+\.jar$/i.test(e.entryName.replace(/\\/g, "/")));
    if (!hasMods) {
      return {
        ok: false,
        error:
          "이 CurseForge 모드팩 zip 에는 모드 파일이 들어 있지 않아요(목록만 있어요). 모드팩 페이지의 \"Server Pack\" 을 받아서 넣어주세요.",
      };
    }
  }
  if (!mcVersion) return { ok: false, error: "모드팩에 마인크래프트 버전이 없어요. 만들기 칸에서 버전을 골라주세요." };

  // 서버 만들기 (hosted:create 와 같은 모양으로 기록한다)
  const name = String(payload.name || meta?.name || "모드팩 서버").trim().slice(0, 32) || "모드팩 서버";
  const port = Math.min(65535, Math.max(1024, Number(payload.port) || 25565));
  const maxPlayers = Math.min(200, Math.max(1, Number(payload.maxPlayers) || 10));
  const motd = String(meta?.name || name).slice(0, 59);
  const server = {
    id: `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    mcVersion,
    loader,
    memoryGB: Math.min(16, Math.max(1, Number(payload.memoryGB) || 4)),
    port,
    maxPlayers,
    motd,
    modpack: { name: meta?.name || name, version: meta?.versionId || meta?.version || null, kind },
    eulaAccepted: true,
    eulaAcceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const dir = hostedServerRoot(server.id);

  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "eula.txt"),
      `# https://aka.ms/MinecraftEULA\n# Nova Client - ${server.eulaAcceptedAt} 에 사용자가 동의함\neula=true\n`,
      "utf-8"
    );

    modpackProgress("extract", 0, 1, "모드팩을 푸는 중...");
    if (kind === "mrpack") {
      // overrides 를 먼저 풀고, 서버 전용 overrides 로 덮어쓴다(순서가 중요하다)
      await extractZipFolder(zip, "overrides/", dir);
      await extractZipFolder(zip, "server-overrides/", dir);

      const files = (meta.files || []).filter((f) => f?.path && f.env?.server !== "unsupported" && f.downloads?.[0]);
      const skipped = (meta.files || []).length - files.length;
      let done = 0;
      for (const f of files) {
        const rel = String(f.path).replace(/\\/g, "/");
        if (rel.includes("..")) continue;
        const out = path.join(dir, rel);
        if (!out.startsWith(dir)) continue;
        modpackProgress("download", done, files.length, `${rel.split("/").pop()} 받는 중...`);
        await downloadFileWithProgress(f.downloads[0], out, undefined, null);
        done++;
      }
      modpackProgress("done", done, files.length, `모드 ${done}개를 넣었어요${skipped ? ` (클라 전용 ${skipped}개 제외)` : ""}`);
      logToFile(`[서버 열기] 모드팩(mrpack) "${server.name}" - 파일 ${done}개, 클라 전용 ${skipped}개 제외`);
    } else {
      // CurseForge 서버 팩 / 그냥 서버 팩 zip: overrides 가 있으면 그 안을, 없으면 zip 전체를
      const hasOverrides = zip.getEntries().some((e) => e.entryName.replace(/\\/g, "/").startsWith("overrides/"));
      const n = hasOverrides ? await extractZipFolder(zip, "overrides/", dir) : await extractZipFolder(zip, "", dir);
      modpackProgress("done", n, n, `파일 ${n}개를 넣었어요`);
      logToFile(`[서버 열기] 모드팩(zip) "${server.name}" - 파일 ${n}개 풀어넣음`);
    }

    // 모드팩이 들고 온 server.properties 가 있어도 우리가 쓰는 값은 맞춰둔다
    await patchHostedProperties(server.id, {
      "server-port": String(port),
      "max-players": String(maxPlayers),
      motd,
      "online-mode": "true",
      "white-list": "false",
    });

    const list = getHostedServers();
    list.push(server);
    saveHostedServers(list);
    return { ok: true, server };
  } catch (err) {
    logToFile("[서버 열기] 모드팩 서버 만들기 실패: " + (err?.stack || err));
    modpackProgress("error", 0, 0, err?.message || "모드팩을 넣지 못했어요.");
    return { ok: false, error: err?.message || "모드팩을 넣지 못했어요." };
  }
});


// ----------------------------------------------------------------------------
// 24-211차: 서버 아이콘 (server-icon.png)
// "서버 아이콘도 고를 수 있음 좋겠고 마크 형식 맞는 것만 골라지게 해주고"
// 마인크래프트는 서버 폴더의 server-icon.png(64x64 PNG)만 읽는다. 아무 그림이나 고르게 하되
// 우리가 64x64 PNG 로 바꿔서 넣는다(그래야 "형식이 맞는 것만" 들어간다).
// ----------------------------------------------------------------------------
function hostedIconPath(id) {
  return path.join(hostedServerRoot(id), "server-icon.png");
}
ipcMain.handle("hosted:get-icon", async (_e, id) => {
  try {
    const buf = await fsp.readFile(hostedIconPath(id));
    return { ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64") };
  } catch (_) {
    return { ok: true, dataUrl: null };
  }
});
ipcMain.handle("hosted:set-icon", async (_e, id) => {
  if (!findHostedServer(id)) return { ok: false, error: "서버를 찾을 수 없어요." };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "서버 아이콘 고르기 (64x64 PNG 로 바꿔서 넣어요)",
    properties: ["openFile"],
    filters: [{ name: "그림 파일", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok: false };
  try {
    const img = nativeImage.createFromPath(res.filePaths[0]);
    if (img.isEmpty()) return { ok: false, error: "그림을 읽지 못했어요." };
    const png = img.resize({ width: 64, height: 64, quality: "best" }).toPNG();
    await fsp.mkdir(hostedServerRoot(id), { recursive: true });
    await fsp.writeFile(hostedIconPath(id), png);
    return { ok: true, dataUrl: "data:image/png;base64," + png.toString("base64") };
  } catch (err) {
    return { ok: false, error: err?.message || "아이콘을 넣지 못했어요." };
  }
});
ipcMain.handle("hosted:clear-icon", async (_e, id) => {
  try {
    await fsp.unlink(hostedIconPath(id));
  } catch (_) {}
  return { ok: true };
});


// ----------------------------------------------------------------------------
// 24-212차: "내가 그 주소로 그대로 입력했는데 안되는데??"
// 주소가 안 될 이유는 몇 가지뿐이다. 하나씩 실제로 확인해서 "무엇이 문제인지" 를 바로 말해준다.
//   1) 서버가 꺼져 있다
//   2) 주소(DNS)가 아직 안 퍼졌다
//   3) 주소가 가리키는 IP 가 지금 우리 집 IP 와 다르다 → 그 자리에서 다시 맞춘다
//   4) 공유기 포트가 안 열렸다
//   5) 다 정상인데 "같은 와이파이 안에서" 바깥 주소로 들어가려 한 경우
//      (공유기 대부분이 이걸 막는다 - 헤어핀 NAT. 집 안에서는 192.168.x.x 로 들어가야 한다)
// ----------------------------------------------------------------------------
function tcpReachable(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (v) => {
      try {
        sock.destroy();
      } catch (_) {}
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

ipcMain.handle("hosted:address-check", async (_e, id) => {
  const server = findHostedServer(id);
  if (!server) return { ok: false, error: "서버를 찾을 수 없어요." };
  if (!server.addressFqdn) return { ok: false, error: "주소를 먼저 만들어주세요." };

  const live = hostedCurrentId === id && hostedState !== "stopped";
  if (!live) return { ok: true, level: "warn", text: "서버가 꺼져 있어요" };

  // 1) 서버가 실제로 포트를 듣고 있는지 (내 컴퓨터에서 바로 확인)
  if (!(await tcpReachable("127.0.0.1", server.port))) {
    return { ok: true, level: "error", text: `서버가 아직 ${server.port} 포트를 열지 않았어요 (켜지는 중일 수 있어요)` };
  }

  // 2) 주소가 퍼졌는지 + 3) 어디를 가리키는지
  let dnsIp = null;
  try {
    const ips = await dnsPromises.resolve4(server.addressFqdn);
    dnsIp = ips?.[0] || null;
  } catch (_) {}
  if (!dnsIp) {
    return { ok: true, level: "warn", text: "주소가 아직 퍼지지 않았어요 - 몇 분 뒤에 다시 해보세요" };
  }

  // 지금 우리 집 공인 IP 는 사이트가 요청을 받은 IP 로 알려준다(=가장 믿을 수 있는 값)
  const refreshed = await hostedAddrFetch("refresh", { slug: server.addressSlug, port: server.port });
  const myIp = refreshed?.ok ? refreshed.ip : null;
  if (myIp && dnsIp !== myIp) {
    return {
      ok: true,
      level: "warn",
      text: `주소가 옛 IP(${dnsIp})를 가리켜서 방금 ${myIp} 로 다시 맞췄어요 - 몇 분 뒤에 들어와보세요`,
    };
  }

  // 4) 밖에서 들어올 수 있는지
  if (!upnpMapped || upnpMapped.port !== server.port) {
    return {
      ok: true,
      level: "error",
      text: "공유기 포트가 안 열렸어요 - 공유기 설정에서 포트포워딩(TCP " + server.port + ")이 필요해요",
    };
  }

  // 5) 전부 정상
  return {
    ok: true,
    level: "ok",
    text: `정상이에요. 같은 와이파이 안에서는 이 주소 대신 아래 공유기 주소로 들어오세요`,
  };
});


// ----------------------------------------------------------------------------
// 24-213차: 서버가 도는 동안의 상태 (메모리 / TPS / 인원 / 가동 시간)
// "서버 실행동안 와이파이 공유기 자리에 메모리 사용량 TPS 이런 거 띄워주고"
//
// TPS 는 서버에게 직접 묻는다. 1.20.3 부터 바닐라에 `tick query` 가 있어서, 그 답을 콘솔
// 출력에서 읽어온다. 우리가 물어본 답줄은 콘솔 화면에는 안 보이게 걸러낸다(사용자가 치지도
// 않은 명령의 답이 5초마다 올라오면 로그를 못 읽는다).
// 인원은 `list` 로, 메모리는 자바 프로세스를 OS 에 물어서 가져온다.
// ----------------------------------------------------------------------------
let hostedStats = { memoryMB: 0, tps: null, mspt: null, players: null, maxPlayers: null };
let hostedStatsTimer = null;
let hostedStatsQuiet = 0; // 이 시각 전까지 올라오는 답줄은 우리가 물어본 것 - 콘솔에 안 올린다

const HOSTED_TICK_RE = /Average time per tick:\s*([\d.]+)\s*ms/i;
const HOSTED_RATE_RE = /Target tick rate:\s*([\d.]+)/i;
const HOSTED_LIST_RE = /There are (\d+)(?: of a max(?: of)? (\d+))? players? online/i;

// 우리가 5초마다 물어본 것들의 답인지 - 맞으면 콘솔에 안 올리고 숫자만 챙긴다
function hostedEatStatLine(line) {
  if (Date.now() > hostedStatsQuiet) return false;
  const t = HOSTED_TICK_RE.exec(line);
  if (t) {
    hostedStats.mspt = Number(t[1]);
    hostedStats.tps = Math.min(20, Math.round((1000 / Math.max(0.1, hostedStats.mspt)) * 10) / 10);
    return true;
  }
  if (HOSTED_RATE_RE.test(line)) return true;
  const l = HOSTED_LIST_RE.exec(line);
  if (l) {
    hostedStats.players = Number(l[1]);
    if (l[2]) hostedStats.maxPlayers = Number(l[2]);
    return true;
  }
  return false;
}

// 자바 프로세스가 실제로 쓰는 메모리 (Windows: tasklist, 그 외: ps)
function hostedReadMemoryMB(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(0);
    const cmd =
      process.platform === "win32"
        ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
        : `ps -o rss= -p ${pid}`;
    try {
      exec(cmd, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) return resolve(0);
        if (process.platform === "win32") {
          // "java.exe","1234","Console","1","1,234,567 K"
          const m = /"([\d,\.]+)\s*K"\s*$/m.exec(stdout.trim());
          return resolve(m ? Math.round(Number(m[1].replace(/[,\.]/g, "")) / 1024) : 0);
        }
        const kb = Number(String(stdout).trim());
        resolve(kb ? Math.round(kb / 1024) : 0);
      });
    } catch (_) {
      resolve(0);
    }
  });
}

async function hostedStatsTick() {
  if (hostedState !== "running" || !hostedProc) return;
  hostedStats.memoryMB = await hostedReadMemoryMB(hostedProc.pid);
  // 답줄이 올라올 동안만 콘솔을 막아둔다
  hostedStatsQuiet = Date.now() + 2500;
  try {
    hostedProc.stdin?.write("tick query\n");
    hostedProc.stdin?.write("list\n");
  } catch (_) {}
  try {
    mainWindow?.webContents?.send("hosted:stats", {
      ...hostedStats,
      uptimeMs: hostedStartedAt ? Date.now() - hostedStartedAt : 0,
    });
  } catch (_) {}
}
function startHostedStats() {
  stopHostedStats();
  hostedStats = { memoryMB: 0, tps: null, mspt: null, players: null, maxPlayers: null };
  hostedStatsTimer = setInterval(hostedStatsTick, 5000);
  setTimeout(hostedStatsTick, 1500);
}
function stopHostedStats() {
  if (hostedStatsTimer) clearInterval(hostedStatsTimer);
  hostedStatsTimer = null;
}

// stop 명령을 먼저 보내서 월드를 정상 저장하게 하고, 그래도 안 끝나면 강제로 끈다
ipcMain.handle("hosted:stop", () => {
  // 24-207차: 런처를 다시 켜서 되찾은 서버는 stdin 이 없으니 PID 로 끈다
  if (hostedAdopted) {
    if (!pidAlive(hostedAdoptedPid)) {
      hostedAdopted = false;
      store.delete("hosted_running");
      hostedCurrentId = null;
      hostedSetState("stopped");
      return { ok: true };
    }
    try {
      process.kill(hostedAdoptedPid);
    } catch (err) {
      return { ok: false, error: err?.message || "서버를 끄지 못했어요." };
    }
    hostedPushLog("[런처] 서버 종료", "info");
    hostedAdopted = false;
    hostedAdoptedPid = 0;
    store.delete("hosted_running");
    upnpClosePort();
    stopHostedAddrTimer();
    hostedCurrentId = null;
    hostedStartedAt = 0;
    hostedSetState("stopped");
    return { ok: true };
  }
  if (!hostedProc) return { ok: false, error: "서버가 켜져 있지 않아요." };
  hostedSetState("stopping");
  hostedPushLog("[런처] 서버 종료 중", "info");
  try {
    hostedProc.stdin?.write("stop\n");
  } catch (_) {}
  const proc = hostedProc;
  setTimeout(() => {
    if (hostedProc === proc && proc && !proc.killed) {
      hostedPushLog("[런처] 강제 종료", "err");
      try {
        proc.kill();
      } catch (_) {}
    }
  }, HOSTED_STOP_GRACE_MS);
  return { ok: true };
});

// 24-207차: "항상 서버를 여는 게 아니라 서버 열기를 눌러야 24시간 열어주는 거지"
// 예전엔 런처를 끄면 서버에 stop 을 보내서 같이 꺼졌다. 그러면 런처를 켜 두는 동안만 서버가
// 사는 셈이라, 친구들이 아무 때나 들어올 수 있는 서버가 못 된다. 이제 런처를 꺼도 서버는
// 그대로 돈다(끄는 건 "서버 끄기"로만). 자식 프로세스를 unref 해서 런처가 먼저 끝날 수 있게
// 해 둔다.
// 24-213차: "만약 강제종료하면 서버도 종료시키고"
// (24-207차에는 런처를 꺼도 서버를 살려뒀는데, 그러면 콘솔도 명령도 못 쓰는 서버가 떠돌아서
//  되돌렸다. 이제 런처가 끝나면 서버도 같이 끝난다 - stop 을 먼저 보내 월드를 저장시킨다.)
app.on("before-quit", () => {
  if (hostedProc) {
    try {
      hostedProc.stdin?.write("stop\n");
    } catch (_) {}
    setTimeout(() => {
      try {
        hostedProc?.kill();
      } catch (_) {}
    }, 4000);
    logToFile("[서버 열기] 런처 종료 - 서버도 같이 끕니다");
  } else if (hostedAdopted && hostedAdoptedPid) {
    try {
      process.kill(hostedAdoptedPid);
    } catch (_) {}
  }
  try {
    store.delete("hosted_running");
  } catch (_) {}
});

// ----------------------------------------------------------------------------
// 리딤 코드 (로그인한 계정 UUID 기준으로 1인당 1회만 사용 가능)
// ----------------------------------------------------------------------------
// 개발자 계정으로 로그인했을 때만 코드 목록을 볼 수 있음 (원문 코드는 아무도 못 봄, 라벨+코인만 보임)
// 24-143차: "개발자 리딤코드 리스트에 뭘 입력해야 나오는지 안나오고"
// 코드 원문은 일부러 저장하지 않음(해시만 둠) - 그래서 목록에 "입력할 코드"를 띄우려면
// 어딘가에 원문을 적어야 하고, 그러면 설치 파일을 뜯어본 사람 누구나 코드를 알게 됨.
// 그래서 원문 대신 두 가지를 같이 내려줌:
//   · hint  : 코드마다 직접 적어둘 수 있는 힌트(REDEEM_CODES 의 hint 필드, 비워도 됨)
//   · hash8 : 해시 앞 8자리 - 어떤 항목인지 구분하는 용도
// 이 둘 다 개발자 계정일 때만 나감.
ipcMain.handle("redeem:get-codes-dev", () => {
  if (!isDevAccount()) return null;
  return REDEEM_CODES.map(({ label, amount, hint, hash }) => ({
    label,
    amount,
    hint: hint || "",
    hash8: String(hash || "").slice(0, 8),
  }));
});

ipcMain.handle("redeem:submit", (_e, rawCode) => {
  const code = String(rawCode || "").trim();
  if (!code) return { ok: false, error: "코드를 입력해주세요." };

  const inputHash = hashCode(code);
  const matched = REDEEM_CODES.find((c) => c.hash === inputHash);
  logToFile(`[리딤코드] 입력받음 (원문은 로그에도 안 남김) / 일치 여부: ${!!matched}`);
  if (!matched) {
    return { ok: false, error: "존재하지 않는 코드예요." };
  }

  const profile = store.get("mc_profile");
  const uuid = profile?.uuid;
  if (!uuid) {
    logToFile("[리딤코드] 로그인 정보(mc_profile.uuid) 없음: " + JSON.stringify(profile));
    return { ok: false, error: "로그인 정보를 확인할 수 없어요." };
  }

  // 24-14차: "마크 계정별 설정 말고 노바 계정별로" - 연동된 노바 계정이 있으면 코인/상점처럼
  // 이 코드도 사이트 계정 공용 데이터에 저장해서, 같은 노바 계정에 연동된 다른 마인크래프트
  // 계정으로도 "이미 사용한 코드"로 인식되게 함(중복 수령 방지가 계정 단위가 아니라 사람
  // 단위로 정확해짐). 연동 안 된 게스트는 지금까지처럼 기기별로 저장됨.
  const redeemedList = getPlayerData(uuid).redeemedCodeHashes || [];
  if (redeemedList.includes(matched.hash)) {
    logToFile(`[리딤코드] 이미 사용됨: uuid=${uuid}`);
    return { ok: false, error: "이미 사용한 코드예요." };
  }

  const total = addCoins(matched.amount, `리딤 코드 사용: ${matched.label}`);

  setPlayerField(uuid, "redeemedCodeHashes", [...redeemedList, matched.hash]);

  logToFile(`[리딤코드] 성공: uuid=${uuid}, 지급 코인=${matched.amount}`);
  return { ok: true, amount: matched.amount, coins: total };
});

