// ============================================================================
//  Nova Client - main.js (Electron Main Process)
//  여러 마인크래프트 서버를 골라 접속할 수 있는 커스텀 런처
// ============================================================================
"use strict";

const { app, BrowserWindow, ipcMain, shell, session, dialog, nativeTheme, Tray, Menu, nativeImage, screen } = require("electron");
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
const Store = require("electron-store");

const { Auth, tokenUtils } = require("msmc");
const { Client } = require("minecraft-launcher-core");
// 10-6(7차): 실제 게임을 켜지 않고 다운로드만(에셋/라이브러리/클라이언트 jar) 미리 받아두려고,
// mclc가 launch() 내부에서만 만드는 Handler를 직접 가져와서 씀 (launch()가 하는 일 중
// checkJava/실행 인자 조립/실제 프로세스 spawn만 빼고 getVersion/getNatives/getJar/getClasses/getAssets를
// 그대로 재사용 - mclc가 "다운로드만" 하는 공식 API를 따로 export하지 않아서 이 방법이 가장 안전함)
const MclcHandler = require("minecraft-launcher-core/components/handler");
const EventEmitter = require("events");
const { autoUpdater } = require("electron-updater");
let DiscordRPC = null;
try {
  DiscordRPC = require("discord-rpc");
} catch (err) {
  console.warn("discord-rpc 모듈 로드 실패, 디스코드 상태 표시 기능은 꺼집니다:", err?.message || err);
}

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
  price: 2030,
  originalPrice: 2900,
  discountPercent: 30,
  category: "fulltheme",
  mode: "pure-black",
  recommended: true,
  isBundle: true,
  featuredMain: true, // 17차: 상점 메인 캐러셀 1번 슬라이드
  featuredPairColorId: "mono-black", // 캐러셀에서 같이 보여줄 "검정" 색상
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
  price: 2030,
  originalPrice: 2900,
  discountPercent: 30,
  category: "fulltheme",
  mode: "cute",
  recommended: true,
  isBundle: true,
  featuredSub: true, // 17차: 상점 메인 캐러셀 2번 슬라이드
  featuredPairColorId: "hue-330", // 캐러셀에서 같이 보여줄 "핑크" 색상(HUE_NAMES 330 = 핑크)
});

// 24-68차 신규: "테마 하나 더 추가하자 아쿠아랑 스카이로 할건데" - 배경이 그라데이션이고
// 오브제(달/별, 바다에 있는 무언가)가 있고 UI 뒤에 그림자로 입체감을 주는 완전 테마 2종.
// 가격 구조는 기존 블랙&화이트/핑크와 동일하게 맞춤(24-43차 고정가+30% 할인 규칙 재사용).
SHOP_COLORS.push({
  id: "theme-aqua",
  name: "아쿠아",
  hex: "#14c8a0",
  plateColor: "#0a3a4d",
  price: 2030,
  originalPrice: 2900,
  discountPercent: 30,
  category: "fulltheme",
  mode: "aqua",
});
SHOP_COLORS.push({
  id: "theme-sky",
  name: "스카이",
  hex: "#8f7bea",
  plateColor: "#1b1140",
  price: 2030,
  originalPrice: 2900,
  discountPercent: 30,
  category: "fulltheme",
  mode: "sky",
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

// 리딤 코드 목록 (코드는 대소문자 구분 없이 비교, 새 코드는 여기에 추가하면 됨)
// 리딤 코드는 원문이 아니라 "해시값"으로 저장해요. 이러면 나중에 파일을 열어봐도
// 실제 코드 문자열은 절대 안 보이고(해시만 보임), 입력한 코드가 맞는지 확인만 가능해요.
// label은 원문이 아니라 "이 코드가 뭔지 알아보기 위한 메모"예요 (개발자 목록에 표시됨).
//
// 새 코드를 추가하는 법: 아래처럼 터미널에서 해시를 만들어서 넣으면 돼요.
// node -e "console.log(require('crypto').createHash('sha256').update('원하는코드'.toLowerCase()).digest('hex'))"
const REDEEM_CODES = [
  // 예시: { hash: "970ec274...", amount: 200, label: "런칭 기념 코드" },
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
  // 50차: 서버별 모드로더 + 모드팩 자동 다운로드 지원 추가.
  //   loader      : 이 서버에 들어갈 때 준비할 로더("fabric" | "forge" | "neoforge").
  //                 안 적으면 CONFIG.LOADER(fabric)를 씀 - 기존 서버들은 그대로 동작함.
  //   minMemoryGB : 이 서버에 필요한 최소 할당 메모리. 설정값이 이보다 낮으면 자동으로 올려줌
  //                 (모드 300개짜리 팩을 4GB로 켜면 로딩 도중 그냥 죽어버림).
  //   modpack     : 모드가 너무 많아 설치 파일에 못 넣는 서버용. 여기 적은 zip을 첫 실행 때
  //                 받아서 인스턴스에 풀고, version 문자열이 바뀔 때만 다시 받음.
  //                 modpack이 있으면 mods/<버전>/ 폴더(=설치 파일 동봉분)는 안 씀.
  //                 zip 안 구조(클라이언트용이어야 함 - 서버팩 그대로 넣으면 안 됨):
  //                   mods/            (필수)
  //                   config/          (선택)
  //                   kubejs/          (선택 - 판매가/툴팁이 서버와 같아야 하므로 넣는 걸 권장)
  //                   resourcepacks/   (선택)
  SERVERS: [
    {
      id: "hisunlit",
      name: "하이의 놀이터",
      host: "hellosunlit.kro.kr",
      port: "25565",
      version: "1.20.1",
      loader: "forge",
      minMemoryGB: 6,
      modpack: {
        // 이 문자열을 바꿀 때마다 유저 쪽에서 모드팩을 다시 받습니다(모드 추가/교체 시 올리세요)
        version: "1.0.0",
        url: "https://github.com/Sil2ntium7012/nova-client/releases/download/pack-hisunlit-1.0.0/hisunlit-client.zip",
      },
    },
    // 24-59차: "그 외의 서버들은 다 없애주고" - 여기 있던 예전 서버 2개(lunarworld/
    // Nugulfarm)를 주석으로만 남겨두지 않고 완전히 지움. 위 hisunlit(하이의 놀이터 =
    // Society: Sunlit Valley) 서버 하나만 남음
  ],
  INSTANCE_NAME: "NovaClient",     // 실제 .minecraft 와 분리된 독립 인스턴스 폴더명
  CREATOR_NAME: "망고",            // 화면에 표시할 제작자 이름
  DEV_ACCOUNT_NAME: "LNR_Sil2ntium", // 이 계정으로 로그인했을 때만 리딤 코드 목록을 볼 수 있음
  // 24-66차 신규: 이 이메일로 가입/로그인된 사이트 계정은 닉네임과 무관하게 항상 관리자로 인정
  ADMIN_EMAILS: ["a01051242995@gmail.com"],
  DISCORD_URL: "https://discord.gg/PVkq8jQdeF", // 24-31차: 디스코드 초대 링크 갱신
  // 디스코드 "실행 중" 표시(Rich Presence)용 Application ID
  // https://discord.com/developers/applications 에서 새 애플리케이션 만들고 여기 General Information의
  // "APPLICATION ID" 값을 복사해서 넣어주세요. 빈 값이면 이 기능은 그냥 조용히 꺼져있어요.
  DISCORD_CLIENT_ID: "1539194520174993522",
  GITHUB_RELEASES_URL: "https://github.com/Sil2ntium7012/nova-client/releases", // 버전 클릭 시 이동
  WEBSITE_URL: "https://nova-site-xi.vercel.app/", // 24-31차: 설정 > "Nova Client 사이트" 버튼 - 실제 Nova Site 주소로 갱신
  // 24-31차 신규: 설정 > 정보 > 커뮤니티의 "상점" 버튼 - 코인 구매(충전) 페이지로 바로 이동
  COINS_BUY_URL: "https://nova-site-xi.vercel.app/coins/buy",
  LICENSE_TEXT: "이 클라이언트(Nova Client)의 모든 권리는 제작자 망고에게 있습니다. 무단 재배포 및 수정 배포를 금지합니다.",
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
  // 모드팩 배포 정보(버전/주소)를 저장소에서 읽어옵니다. announcement/news 와 같은 원리로,
  // 이 파일만 고치면 런처를 새로 배포하지 않아도 유저가 새 모드팩을 받습니다.
  // 형식: { "<서버 id>": { "version": "1.0.1", "url": "https://.../hisunlit-client.zip" } }
  // 조회에 실패하면 아래 SERVERS 에 박아둔 modpack 값을 그대로 씁니다(오프라인/장애 대비).
  MODPACK_URL:
    "https://raw.githubusercontent.com/Sil2ntium7012/nova-client/main/modpack.json",
  SUPABASE_URL: "https://zrqlvhhruuuaphexztee.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycWx2aGhydXV1YXBoZXh6dGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODk1MzgsImV4cCI6MjEwMjQ2NTUzOH0.U7MwqPCrfPHHlPLqcryCfZhhXPcDJidxjCG07mF1svw",
  // 24-10차: 진짜 계정 통합 - "런처/사이트 전용 계정" 자체는 이제 Nova Site(웹사이트)가
  // 서버 API로 직접 처리함(Nova Client가 Supabase를 직접 두드리던 site_accounts RPC는 폐기).
  // 아래 주소가 그 API가 배포된 실제 도메인.
  NOVA_SITE_API_BASE: "https://nova-site-xi.vercel.app",
};

// ----------------------------------------------------------------------------
// 디스코드 "실행 중" 표시 (Rich Presence) - 디스코드 앱이 켜져있으면 자동으로 연결됨.
// CONFIG.DISCORD_CLIENT_ID가 비어있으면 이 기능은 그냥 조용히 아무것도 안 함.
// ----------------------------------------------------------------------------
let discordRpc = null;
let discordRpcReady = false;
const discordActivityStartedAt = Date.now();
// 마지막으로 setDiscordActivity()가 호출됐을 때의 상태 - 연결이 끊겼다가 다시 붙었을 때
// (디스코드를 launcher보다 늦게 켰거나, 디스코드가 재시작된 경우) 이걸로 바로 복원함
let discordLastState = { state: "메인 화면" };
let discordRetryTimer = null;

function setupDiscordRpc() {
  if (!CONFIG.DISCORD_CLIENT_ID || !DiscordRPC) return; // ID 안 넣었거나 모듈 로드 실패면 그냥 꺼둠

  // 디스코드가 런처보다 늦게 켜진 경우(또는 재시작된 경우)에도 결국 붙을 수 있도록
  // 처음 연결 실패/끊김 시 계속 재시도함 (예전엔 최초 1회만 시도하고 끝나서, 런처를 먼저 켜면
  // 디스코드 상태가 영영 안 뜨는 문제가 있었음)
  connectDiscordRpc();
}

function connectDiscordRpc() {
  if (discordRetryTimer) {
    clearTimeout(discordRetryTimer);
    discordRetryTimer = null;
  }

  discordRpc = new DiscordRPC.Client({ transport: "ipc" });

  discordRpc.on("ready", () => {
    discordRpcReady = true;
    logToFile("디스코드 Rich Presence 연결됨");
    setDiscordActivity(discordLastState); // 끊기기 전 상태(플레이 중이었다면 그것까지) 그대로 복원
  });

  // discord-rpc 라이브러리는 연결이 끊겨도 별도 이벤트를 안 줄 때가 있어서,
  // disconnected/close 둘 다 걸어두고 재연결을 시도함
  const scheduleReconnect = (reason) => {
    if (discordRpcReady) logToFile("디스코드 Rich Presence 연결 끊김(" + reason + "), 재연결 시도 예정");
    discordRpcReady = false;
    if (discordRetryTimer) return; // 이미 재시도 예약돼있으면 중복 예약 안 함
    discordRetryTimer = setTimeout(() => {
      discordRetryTimer = null;
      connectDiscordRpc();
    }, 15000); // 15초마다 재시도 - 디스코드를 나중에 켜도 결국 붙음
  };
  discordRpc.on("disconnected", () => scheduleReconnect("disconnected"));
  discordRpc.transport?.once?.("close", () => scheduleReconnect("transport closed"));

  discordRpc.login({ clientId: CONFIG.DISCORD_CLIENT_ID }).catch((err) => {
    // 디스코드 앱이 안 켜져있으면 여기로 옴 - 조용히 로그만 남기고, 위 재시도 타이머로 다시 시도함
    logToFile("디스코드 Rich Presence 연결 실패(디스코드 미실행 등, 15초 후 재시도): " + (err?.message || err));
    scheduleReconnect("login failed");
  });
}

// state: 상세 문구(예: "메인 화면", "Luna World 플레이 중", "test 프로필로 플레이 중")
// playing: 실제 게임 실행 중인지 여부 - true/false에 따라 작은 아이콘(smallImageKey)을 다르게 보여줌
//
// 참고: largeImageKey/smallImageKey는 코드로는 어떻게 해도 안 뜰 수 있음 - discord-rpc는
// 임의의 이미지 URL을 못 쓰고, 반드시 Discord 개발자 포털(discord.com/developers/applications
// > 해당 애플리케이션 > Rich Presence > Art Assets)에 "정확히 이 이름"으로 이미지를 먼저
// 업로드해둬야만 보임. 지금 largeImageKey인 "nova_logo"가 그 포털에 없으면 아이콘이 계속 안
// 뜸 - 코드 문제가 아니라 포털 설정이 안 돼 있는 것. 아래 smallImageKey 두 개("status_playing",
// "status_idle")도 새로 추가한 거라, 이것들도 같은 이름으로 포털에 업로드해야 실제로 보임.
function setDiscordActivity({ state, playing = false }) {
  discordLastState = { state, playing }; // 지금 아직 연결 전/재연결 중이어도 기억해뒀다가 붙으면 바로 반영
  if (!discordRpc || !discordRpcReady) return;
  discordRpc.setActivity({
    details: "Nova Client 실행중",
    state,
    startTimestamp: discordActivityStartedAt,
    largeImageKey: "nova_logo", // 디스코드 개발자 포털 Rich Presence Assets에 이 이름으로 이미지를 올려야 보임
    largeImageText: "Nova Client",
    smallImageKey: playing ? "status_playing" : "status_idle", // 이것도 포털에 같은 이름으로 업로드 필요
    smallImageText: playing ? "게임 플레이 중" : "런처에서 대기 중",
    instance: false,
    buttons: [{ label: "디스코드 참여하기", url: CONFIG.DISCORD_URL }],
  }).catch((err) => {
    logToFile("디스코드 상태 갱신 실패: " + (err?.message || err));
  });
}

function clearDiscordActivity() {
  discordLastState = { state: "메인 화면" };
  if (!discordRpc || !discordRpcReady) return;
  discordRpc.clearActivity().catch(() => {});
}

// 업데이트 내역 (새 버전 배포할 때마다 위에 추가해주세요 — 오래된 순 -> 최신 순)
// 24-59차: "클라이언트 버전 싹다 없앨 거거든? 버전 싹 초기화하고 1.0.0부터 하고 업뎃 기록
// 싹다 없애고 시작하게 해줘" - 여기 쌓여있던 기존 업데이트 내역(출시 1.0.0 ~ 그동안의 모든
// 버전)을 전부 지우고 1.0.0부터 새로 시작함. package.json 버전도 같이 1.0.0으로 되돌림
const CHANGELOG = [
  { version: "1.0.0", date: "2026-09-06", items: ["Nova Client를 새롭게 시작합니다"] },
  { version: "1.0.1", date: "2026-09-06", items: ["Forge 서버(하이의 놀이터) 설치 시 코드 1 오류로 실패하던 문제 수정"] },
  { version: "1.0.2", date: "2026-09-06", items: ["Forge/NeoForge 실행 시 게임이 뜨자마자 바로 꺼지던 문제 수정"] },
  {
    version: "1.0.4",
    date: "2026-09-07",
    items: [
      "하이의 놀이터 서버 주소 오타 수정",
      "서버 선택할 때도 프로필과 같은 효과음이 나도록 추가",
      "친구 우클릭 메뉴 신규 추가(귓속말/참가하기/친구 삭제하기/차단하기)",
      "차단하기 기능이 동작하지 않던 문제 수정",
      "귓속말이 오면 친구 탭에도 안 읽음 표시가 뜨도록 추가",
      "로그인/회원가입/마인크래프트 계정 연동 시 로딩 스피너 추가",
      "내 스킨/다른 사람 스킨 불러올 때 로딩 스피너 추가",
      "친구/서버 온라인 표시 색을 테마 색과 무관하게 항상 초록색으로 고정",
      "참가하기를 누르면 확인창 후 PLAY 없이 바로 게임에 참가하도록 변경",
      "설정 > 클라이언트 탭에 다운로드한 게임 파일 모두 삭제 버튼 신규 추가, 업데이트 확인/런처 재시작도 이 탭으로 이동",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-09-08",
    items: [
      "새 버전이 감지되면 자동으로 다운로드+설치되도록 변경(업데이트 중엔 새 게임 실행 불가)",
      "친구추가 시 대문자/소문자 구분 없이 검색되도록 수정",
      "상점에 기타 카테고리 신규 추가, 닉네임 변경권(100원) 판매",
      "게임 실행 중 친구 접속 정보(서버/계정)를 자동으로 업로드하도록 신규 추가",
    ],
  },
  {
    version: "1.0.6",
    date: "2026-09-08",
    items: [
      "상점에 새 완전 테마 2종(아쿠아/스카이) 추가",
    ],
  },
  {
    version: "1.0.7",
    date: "2026-09-08",
    items: [
      "아쿠아/스카이 테마 디테일 개선",
      "모드 목록 빈 화면 디자인 개선",
      "프로필 사진/닉네임 변경 UI 위치 조정",
      "친구 목록 정렬 및 간격 개선",
      "스킨 미리보기 고정 각도로 변경",
      "홈 배너 애니메이션 추가",
      "테마 색상 버그 수정",
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
  const found = CONFIG.SERVERS.find((s) => s.id === selectedId);
  return found || CONFIG.SERVERS[0];
}

// 마인크래프트 버전에 맞는 자바 버전을 자동으로 계산 (버전마다 필요한 자바가 다름)
function getJavaFeatureVersionFor(mcVersion) {
  const [major, minor] = String(mcVersion).split(".").map((n) => parseInt(n, 10) || 0);
  // 1.21.x / 1.20.5 이상 -> Java 21
  if (major === 1 && (minor > 20 || (minor === 20 && String(mcVersion).split(".")[2] >= "5"))) {
    return 21;
  }
  // 1.17 ~ 1.20.4 -> Java 17
  if (major === 1 && minor >= 17) return 17;
  // 1.16 이하 -> Java 8
  return 8;
}

ipcMain.handle("servers:list", () => {
  const mode = store.get("launch_mode") || "server";
  const selected = getSelectedServer();
  const serverLastPlayed = store.get("server_last_played") || {};
  return CONFIG.SERVERS.map((s) => ({
    ...s,
    selected: mode === "server" && s.id === selected.id,
    lastPlayedAt: serverLastPlayed[s.id] || null,
  }));
});

ipcMain.handle("servers:select", (_e, serverId) => {
  const found = CONFIG.SERVERS.find((s) => s.id === serverId);
  if (!found) return { ok: false, error: "존재하지 않는 서버예요." };
  store.set("selected_server_id", serverId);
  store.set("launch_mode", "server"); // 서버를 고르면 프로필 선택은 자동으로 풀림
  return { ok: true, server: found };
});

// ----------------------------------------------------------------------------
// 프로필 (유저가 직접 만드는 인스턴스 - 서버와는 별개로 자기만의 모드/리소스팩/쉐이더 구성)
// ----------------------------------------------------------------------------
function getProfilesDir() {
  return path.join(getRoot(), "profiles");
}
function getProfileRoot(profileId) {
  return path.join(getProfilesDir(), profileId);
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

// 기본(Default) 프로필: 앱을 처음 켰을 때 무조건 하나 존재하고, 삭제할 수 없음.
// 아이콘은 따로 지정 안 하면 Nova 앱 아이콘을 그대로 사용함.
const DEFAULT_PROFILE_ID = "default";
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
  if (list.some((p) => p.id === DEFAULT_PROFILE_ID)) return;
  const fallbackVersion = (CONFIG.SERVERS && CONFIG.SERVERS[0] && CONFIG.SERVERS[0].version) || "1.21.11";
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
}

// ----------------------------------------------------------------------------
// 프리셋 (모드/리소스팩이 미리 구성된 프로필 템플릿 - 새 프로필 만들 때 골라서 바로 적용)
// ----------------------------------------------------------------------------
function getPresetsDir() {
  return path.join(getRoot(), "presets");
}
function getPresetRoot(presetId) {
  return path.join(getPresetsDir(), presetId);
}
function getPresets() {
  return store.get("presets") || [];
}
function savePresets(list) {
  store.set("presets", list);
}
function generatePresetId() {
  return "preset_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  return getProfiles().map((p) => ({
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

ipcMain.handle("profiles:create", async (_e, { name, mcVersion, memoryGB, width, height, fullscreen, jvmArgs, presetId, loader, iconTempPath, description }) => {
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

    // 프로필은 완전히 빈 상태로 시작함. 서버 전용 모드/리소스팩(예: Luna World)은
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

    // 프리셋을 골랐으면 그 프리셋의 모드/리소스팩/쉐이더 파일(+메타)을 가져옴.
    // 15-3(4차): 고른 버전이 프리셋 원본 버전과 같으면 그냥 파일 복사(빠름). 다르면(=버전
    // 카드 그리드에서 자동 생성된 다른 버전을 고른 경우) 프리셋에 들어있던 모드들을
    // 그 버전에 맞는 빌드로 Modrinth에서 새로 받아옴 - presets:create에서 이미
    // computePresetAvailableVersions()로 "그 버전에서 전부 호환됨"을 확인해둔 상태이므로
    // 여기서 실패하는 모드가 있으면 그 모드만 건너뛰고 로그를 남김(전체 실패로 막지 않음)
    if (presetId) {
      const preset = getPresets().find((p) => p.id === presetId);
      if (preset) {
        profile.loader = "fabric"; // 프리셋엔 항상 Fabric 모드가 들어있으므로 바닐라 선택은 무시함
        const presetRoot = getPresetRoot(presetId);
        const sameVersion = !mcVersion || mcVersion === preset.mcVersion;
        // 15-6(6차): 리소스팩/쉐이더 기본 포함 여부는 프리셋마다 각각 독립적으로 저장됨
        // (하위호환: 예전 프리셋엔 includeOptional만 있을 수 있음)
        const includeRp = preset.includeResourcepack !== undefined ? !!preset.includeResourcepack : !!preset.includeOptional;
        const includeSh = preset.includeShader !== undefined ? !!preset.includeShader : !!preset.includeOptional;
        const kindsAllowed = ["mods"];
        if (includeRp) kindsAllowed.push("resourcepacks");
        if (includeSh) kindsAllowed.push("shaderpacks");

        if (sameVersion) {
          for (const kind of kindsAllowed) {
            const srcDir = path.join(presetRoot, kind);
            if (!fs.existsSync(srcDir)) continue;
            const destDir = path.join(profileRoot, kind);
            const files = await fsp.readdir(srcDir);
            for (const f of files) {
              await fsp.copyFile(path.join(srcDir, f), path.join(destDir, f));
            }
          }
        } else {
          // 리소스팩/쉐이더는 버전에 안 묶이는 경우가 대부분이라 그대로 복사
          for (const kind of kindsAllowed.filter((k) => k !== "mods")) {
            const srcDir = path.join(presetRoot, kind);
            if (!fs.existsSync(srcDir)) continue;
            const destDir = path.join(profileRoot, kind);
            const files = await fsp.readdir(srcDir);
            for (const f of files) {
              await fsp.copyFile(path.join(srcDir, f), path.join(destDir, f));
            }
          }
          // 모드는 target 버전(mcVersion)에 맞는 빌드를 새로 받아옴
          const modMeta = await readModMeta(presetRoot, "mods");
          for (const [, m] of Object.entries(modMeta)) {
            if (!m.projectId) continue; // 프로젝트 정보 없는 모드는 버전 변환 불가 - 건너뜀
            try {
              const versions = await fetchModVersionsForGame(m.projectId, mcVersion, "mod");
              const best = versions.find((v) => v.versionType === "release") || versions[0];
              if (!best) continue;
              await downloadAndInstallModFile(profileRoot, "mods", {
                fileUrl: best.fileUrl,
                fileName: best.fileName,
                projectId: m.projectId,
                versionId: best.id,
                projectTitle: m.title,
                icon: m.icon,
                author: m.author,
              });
            } catch (err) {
              logToFile(`프리셋 버전 변환 중 모드 설치 실패(${m.title || m.projectId}): ` + (err?.message || err));
            }
          }
        }
        profile.fromPreset = true;
        profile.presetName = preset.name;
        profile.presetCategory = preset.category;
      }
    }

    const list = getProfiles();
    list.push(profile);
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
    list[idx].name = String(partial.name).trim() || list[idx].name;
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

  list.splice(idx, 1);
  saveProfiles(list);

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
    await fsp.rm(getProfileRoot(id), { recursive: true, force: true });
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
function pngBufferToIcoBuffer(pngBuf) {
  if (!pngBuf || pngBuf.length < 33) return null;
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!pngBuf.subarray(0, 8).equals(pngSig)) return null; // PNG가 아님
  if (pngBuf.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 256 || height > 256) return null;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width === 256 ? 0 : width, 0);
  entry.writeUInt8(height === 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // color count (0 = 안 쓰는 팔레트)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8); // 이미지 데이터 크기
  entry.writeUInt32LE(header.length + entry.length, 12); // 이미지 데이터 오프셋

  return Buffer.concat([header, entry, pngBuf]);
}

// 프로필 아이콘(png)을 바로가기용 .ico로 변환해서 임시 파일 경로를 돌려줌.
// 변환 불가한 경우 null + 사유 문자열을 돌려줌
function makeShortcutIconForProfile(profileId) {
  const found = findProfileIconFile(profileId);
  if (!found) return { icoPath: null, reason: null }; // 아이콘 미설정 - 폴백은 정상 동작이라 사유 없음
  if (found.ext !== "png") {
    return { icoPath: null, reason: `프로필 아이콘이 .${found.ext} 형식이라 바로가기 아이콘으로 변환할 수 없어요 (png만 지원)` };
  }
  try {
    const pngBuf = fs.readFileSync(found.path);
    const icoBuf = pngBufferToIcoBuffer(pngBuf);
    if (!icoBuf) {
      return { icoPath: null, reason: "프로필 아이콘 이미지가 너무 커서(256x256 초과) 바로가기 아이콘으로 변환할 수 없어요" };
    }
    const icoDir = path.join(app.getPath("userData"), "shortcut-icons");
    fs.mkdirSync(icoDir, { recursive: true });
    const icoPath = path.join(icoDir, `${profileId}.ico`);
    fs.writeFileSync(icoPath, icoBuf);
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

// 모드/리소스팩/쉐이더 활성화 ↔ 비활성화 전환 (확장자 뒤에 .disabled 를 붙였다 뗐다 함)
ipcMain.handle("profiles:toggle-file", async (_e, { id, kind, fileName }) => {
  try {
    const dir = path.join(getProfileRoot(id), kind);
    const disabled = fileName.toLowerCase().endsWith(".disabled");
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

// 15(4차): 프리셋 카테고리는 딱 이 5개로 고정 (사용자 지정 문구 그대로)
const PRESET_CATEGORIES = ["PVP", "야생", "마인팜", "최적화", "낭만"];

// 프리셋 목록 (새 프로필 만들 때 선택지로 보여줌)
ipcMain.handle("presets:list", () => {
  return getPresets();
});

ipcMain.handle("presets:categories", () => PRESET_CATEGORIES);

// 15-3(4차): 프리셋에 들어있는 모드들이 target 마인크래프트 버전에서도 전부 Fabric 빌드가
// 있는지 확인함. 정책(문서화 필수):
//  - Explore로 설치되지 않은(=프로젝트 정보가 없는) 모드가 하나라도 있으면, 그 프리셋 전체를
//    "자동 버전 생성 불가"로 보고 원본 버전 하나만 쓸 수 있게 함 (그 모드가 target 버전에
//    맞는지 알아낼 방법이 Modrinth API로는 없기 때문)
//  - Explore로 설치된 모드들은 각각 target 버전 + fabric 로더로 Modrinth에 버전이 있는지 확인.
//  - 확인한 모드 중 단 하나라도 target 버전에서 안 맞으면, 그 target 버전 전체를 스킵함
//    (부분적으로만 호환되는 프리셋을 만들지 않음 - "일부 모드 없으면 스킵"을 프리셋 전체
//    단위로 안전하게 해석함)
async function computePresetAvailableVersions(presetRoot, baseMcVersion) {
  const modMeta = await readModMeta(presetRoot, "mods");
  const modEntries = Object.entries(modMeta);
  const trackedMods = modEntries.filter(([, m]) => m.projectId);
  const untrackedCount = modEntries.length - trackedMods.length;

  if (modEntries.length === 0) {
    // 모드가 하나도 없는 프리셋(예: 리소스팩/쉐이더 전용)은 버전 제약이 없으니
    // 앱이 아는 모든 지원 버전에서 다 쓸 수 있다고 봄
    // 24-11차: 모드 제약이 없는 프리셋은 API 호출 부담도 없으니 더 넉넉하게 보여줌
    const all = await fetchFabricSupportedVersions();
    return { availableMcVersions: all && all.length ? all.slice(0, 60) : [baseMcVersion], note: null };
  }

  if (untrackedCount > 0) {
    return {
      availableMcVersions: [baseMcVersion],
      note: `모드 ${untrackedCount}개가 Explore가 아닌 방식으로 추가돼 있어서(프로젝트 정보 없음) 자동으로 다른 버전용을 만들 수 없어요. 원본 버전(${baseMcVersion})만 사용할 수 있어요.`,
    };
  }

  const candidates = await fetchFabricSupportedVersions();
  // 24-11차: "고를 수 있는 버전이 너무 적다" - 모드 호환 확인은 Modrinth API를 호출해야
  // 해서(모드 개수 × 버전 개수) 무한정 늘리긴 어렵지만, 15개는 너무 적었어서 30개로 늘림
  const pool = (candidates && candidates.length ? candidates : [baseMcVersion]).slice(0, 30); // API 호출량 제한
  if (!pool.includes(baseMcVersion)) pool.unshift(baseMcVersion);

  const available = [];
  for (const mcVersion of pool) {
    if (mcVersion === baseMcVersion) {
      available.push(mcVersion); // 원본 버전은 이미 파일이 있으므로 항상 사용 가능
      continue;
    }
    try {
      let allOk = true;
      for (const [, m] of trackedMods) {
        const versions = await fetchModVersionsForGame(m.projectId, mcVersion, "mod");
        if (!versions || versions.length === 0) {
          allOk = false;
          break;
        }
      }
      if (allOk) available.push(mcVersion);
    } catch (err) {
      logToFile(`프리셋 버전 호환성 확인 실패(${mcVersion}): ` + (err?.message || err));
      // 확인 실패한 버전은 그냥 스킵(과감히 포함시키지 않음 - 안전 우선)
    }
  }
  return { availableMcVersions: available, note: null };
}

// 프로필(또는 특정 소스 폴더)의 모드/리소스팩/쉐이더 구성을 프리셋으로 저장.
// category(5개 고정 카테고리 중 하나) + includeOptional(리소스팩/쉐이더도 같이 담을지)을 받고,
// 저장 직후 지원 가능한 모든 마인크래프트 버전을 자동으로 계산해서 preset.availableMcVersions에 담아둠
// ("너가 모든 버전의 프리셋을 만들고(모드 없으면 스킵)" 요청 - 실제로 매 버전마다 파일을
// 미리 다 받아두진 않고, 호환 가능한 버전 목록만 미리 계산해둔 뒤 사용자가 특정 버전을 실제로
// 골라서 프로필을 만들 때(profiles:create) 그 버전에 맞는 모드 파일을 그때 받아옴 - 매 프리셋마다
// 지원 버전 수만큼 전체 모드를 미리 다운로드하면 용량/시간이 과도하게 커지기 때문의 절충)
ipcMain.handle("presets:create", async (_e, { profileId, name, category, includeResourcepack, includeShader, includeOptional }) => {
  try {
    // 프리셋 생성은 관리자(개발자 계정)만 가능함 - 프리셋은 관리자가 유저들에게 배포하는
    // 용도라서 일반 유저는 프리셋을 만들 수 없고 고르기(설치)만 할 수 있어야 함
    const isAdmin = isDevAccount();
    if (!isAdmin) return { ok: false, error: "권한이 없어요." };

    const profile = findProfile(profileId);
    if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
    // 24-11차: "프리셋은 Fabric으로만 만들 수 있어야지, 바닐라 프로필로 만들면 안 되지" -
    // 렌더러 쪽 소스 목록에서도 걸러주지만(방어적으로) 여기서도 한 번 더 막음
    if ((profile.loader || "fabric") !== "fabric") {
      return { ok: false, error: "Fabric 프로필만 프리셋으로 만들 수 있어요." };
    }
    if (!PRESET_CATEGORIES.includes(category)) return { ok: false, error: "카테고리를 골라주세요." };

    // 17차: "프리셋은 갯수가 아니야, 카테고리마다 그 프리셋 하나만 있어" - 카테고리당 프리셋을
    // 하나로 강제함. 같은 카테고리에 이미 프리셋이 있으면, 새로 만들면서 기존 걸 교체(삭제)함
    const existingList = getPresets();
    const replaced = existingList.find((p) => p.category === category) || null;
    if (replaced) {
      try {
        await fsp.rm(getPresetRoot(replaced.id), { recursive: true, force: true });
      } catch (_) {}
    }

    const presetId = generatePresetId();
    const presetRoot = getPresetRoot(presetId);
    const profileRoot = getProfileRoot(profileId);
    // 하위호환: 예전 렌더러가 includeOptional(단일 토글) 하나만 보내는 경우
    // resourcepack/shader 둘 다 그 값을 따르도록 함. 새 렌더러는 두 값을 각각 보냄.
    const includeRp = includeResourcepack !== undefined ? !!includeResourcepack : !!includeOptional;
    const includeSh = includeShader !== undefined ? !!includeShader : !!includeOptional;

    const kindsToCopy = ["mods"];
    if (includeRp) kindsToCopy.push("resourcepacks");
    if (includeSh) kindsToCopy.push("shaderpacks");
    for (const kind of ["mods", "resourcepacks", "shaderpacks"]) {
      await fsp.mkdir(path.join(presetRoot, kind), { recursive: true });
    }
    for (const kind of kindsToCopy) {
      const srcDir = path.join(profileRoot, kind);
      const destDir = path.join(presetRoot, kind);
      if (!fs.existsSync(srcDir)) continue;
      const files = await fsp.readdir(srcDir);
      for (const f of files) {
        await fsp.copyFile(path.join(srcDir, f), path.join(destDir, f));
      }
    }

    const preset = {
      id: presetId,
      name: name?.trim() || `${profile.name} 프리셋`,
      category,
      mcVersion: profile.mcVersion,
      includeResourcepack: includeRp,
      includeShader: includeSh,
      createdAt: new Date().toISOString(),
      availableMcVersions: [profile.mcVersion],
      versionGenerationNote: "버전별 호환성을 확인하는 중...",
    };
    const list = existingList.filter((p) => p.category !== category); // 같은 카테고리 기존 프리셋 제거
    list.push(preset);
    savePresets(list);

    // 버전 호환성 계산은 시간이 걸릴 수 있어서(모드 개수 x 버전 개수만큼 Modrinth API 호출),
    // 프리셋 생성 응답은 먼저 보내고 계산이 끝나면 프리셋을 갱신해둠. 렌더러는 presets:list를
    // 다시 불러서 최신 availableMcVersions를 받아갈 수 있음
    computePresetAvailableVersions(presetRoot, profile.mcVersion)
      .then(({ availableMcVersions, note }) => {
        const list2 = getPresets();
        const idx = list2.findIndex((p) => p.id === presetId);
        if (idx < 0) return;
        list2[idx].availableMcVersions = availableMcVersions;
        list2[idx].versionGenerationNote = note;
        savePresets(list2);
      })
      .catch((err) => {
        logToFile("프리셋 버전 자동 생성 실패: " + (err?.stack || err));
        const list2 = getPresets();
        const idx = list2.findIndex((p) => p.id === presetId);
        if (idx >= 0) {
          list2[idx].versionGenerationNote = "버전별 호환성 확인에 실패했어요. 원본 버전만 사용할 수 있어요.";
          savePresets(list2);
        }
      });

    return { ok: true, preset, replacedPresetId: replaced?.id || null, replacedPresetName: replaced?.name || null };
  } catch (err) {
    logToFile("프리셋 생성 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("presets:delete", async (_e, presetId) => {
  // 삭제도 생성과 마찬가지로 관리자만 가능하게 함(일관성)
  const isAdmin = isDevAccount();
  if (!isAdmin) return { ok: false, error: "권한이 없어요." };

  const list = getPresets();
  const idx = list.findIndex((p) => p.id === presetId);
  if (idx < 0) return { ok: false, error: "존재하지 않는 프리셋이에요." };
  list.splice(idx, 1);
  savePresets(list);
  try {
    await fsp.rm(getPresetRoot(presetId), { recursive: true, force: true });
  } catch (_) {}
  return { ok: true };
});

// ----------------------------------------------------------------------------
// Explore (Modrinth에서 Fabric 클라이언트 모드/리소스팩 검색 + 설치)
// ----------------------------------------------------------------------------
const MODRINTH_API = "https://api.modrinth.com/v2";

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
ipcMain.handle("explore:search", async (_e, { query, projectType, gameVersion, sort, page, categories, clientOnly }) => {
  try {
    const facets = [[`project_type:${projectType}`]];
    // 10차 신규(모드): 개별 모드는 이 앱이 프로필 "모드" 탭에서 Fabric 모드만 다루므로 Fabric용만 보여줌
    // 24-2차: 모드팩은 이제 Forge/NeoForge도 설치할 수 있게 됐으므로 Fabric 제한을 풀어줌
    // (모드팩 안에 어떤 로더가 들어있는지는 explore:install-modpack에서 실제로 감지함)
    if (projectType === "mod") facets.push(["categories:fabric"]);
    // 24-14차: "모드에서 클라이언트 모드만 따로 볼 수 있게" - client_side가 required/optional인
    // (=클라이언트에서 쓸 수 있는) 모드만 남기고, 서버 전용(unsupported)은 검색 결과에서 뺌
    if (projectType === "mod" && clientOnly) facets.push(["client_side:required", "client_side:optional"]);
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (Array.isArray(categories) && categories.length > 0) {
      // 같은 facet 그룹 안에 여러 값을 넣으면 Modrinth 쪽에서 OR로 처리됨
      facets.push(categories.map((c) => `categories:${c}`));
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const offset = (pageNum - 1) * EXPLORE_PAGE_SIZE;

    const params = new URLSearchParams({
      query: query || "",
      index: sort || "downloads", // 항상 인기순/다운로드순 기본
      limit: String(EXPLORE_PAGE_SIZE),
      offset: String(offset),
      facets: JSON.stringify(facets),
    });

    const res = await fetch(`${MODRINTH_API}/search?${params.toString()}`);
    if (!res.ok) throw new Error("Modrinth 검색 실패");
    const data = await res.json();

    // 24-46차: Fabric API는 이제 모든 Fabric 프로필에 항상 자동으로 들어있어서 유저가
    // Explore에서 따로 찾아 설치/관리할 대상이 아님 - 검색 결과(모드 검색일 때만)에서 빼서
    // "모드 까는 곳"에 별도로 뜨지 않게 함. 24-50차: Mod Menu도 같은 이유로 같이 뺌.
    const hits = (data.hits || []).filter(
      (h) =>
        !(
          projectType === "mod" &&
          (h.project_id === FABRIC_API_PROJECT_ID || h.project_id === MOD_MENU_PROJECT_ID)
        )
    );

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
      })),
      page: pageNum,
      totalHits: data.total_hits || 0,
      totalPages: Math.max(1, Math.ceil((data.total_hits || 0) / EXPLORE_PAGE_SIZE)),
    };
  } catch (err) {
    logToFile("Modrinth 검색 실패: " + (err?.message || err));
    return { hits: [], page: 1, totalHits: 0, totalPages: 1 };
  }
});

// 17차 신규: 모드 상세 설명이 대부분 영어라, 구글 번역(비공식 무료 엔드포인트, API 키 불필요)로
// 그 자리에서 한국어로 바꿔볼 수 있게 함. 원문이 너무 길면 한 번에 다 못 보내니 앞부분만 잘라서 보냄
ipcMain.handle("explore:translate", async (_e, text) => {
  if (!text || !text.trim()) return { ok: false, error: "번역할 내용이 없어요." };
  try {
    const params = new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: "ko",
      dt: "t",
      q: text.slice(0, 4500),
    });
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
    if (!res.ok) throw new Error("번역 요청 실패");
    const data = await res.json();
    const translated = (data[0] || []).map((seg) => seg[0]).join("");
    return { ok: true, text: translated };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// 프로젝트 상세 정보 (앱 안에서 설명을 보여주기 위함 - Modrinth 페이지로 안 나가도 됨)
ipcMain.handle("explore:get-project", async (_e, projectId) => {
  try {
    const res = await fetch(`${MODRINTH_API}/project/${projectId}`);
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
      fetch(`${MODRINTH_API}/user/${encodeURIComponent(uname)}`),
      fetch(`${MODRINTH_API}/user/${encodeURIComponent(uname)}/projects`),
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

    const res = await fetch(`${MODRINTH_API}/project/${projectId}/version?${params.toString()}`);
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
      const res = await fetch(`${MODRINTH_API}/project/${m.projectId}/version?${params.toString()}`);
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

// Nova Site 서버의 런처 전용 계정 API(app/api/app/account/*) 호출 헬퍼. 브라우저처럼 쿠키
// 세션을 못 들고 있어서, 응답으로 받은 session_token을 직접 저장해뒀다가 매 요청마다 body에
// 같이 실어보내는 방식(로그인 성공 시 새 토큰이 발급되면서 다른 기기의 기존 세션은 끊김).
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
ipcMain.handle("siteauth:register", async (_e, email, nickname, password) => {
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
    const res = await novaSiteFetch("heartbeat", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
    });
    if (res?.kicked) {
      const device = res.device || "다른 기기";
      clearSiteSessionLocally();
      return { ok: true, kicked: true, device };
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

ipcMain.handle("account:link-discord", async (_e, discordTag) => {
  if (!cachedSiteSession) return { ok: false, error: "먼저 사이트 계정으로 로그인해주세요." };
  const tag = String(discordTag || "").trim();
  if (!tag) return { ok: false, error: "디스코드 태그를 입력해주세요." };
  try {
    // "이미 다른 계정에 연동된 태그인지" 체크 + 기존 내 링크가 있으면 갱신/없으면 새로
    // 만들기, 전부 서버(Nova Site) 쪽 launcherLinkDiscord 함수 안에서 세션 확인과 함께 처리됨.
    const res = await novaSiteFetch("link-discord", {
      accountId: cachedSiteSession.accountId,
      sessionToken: cachedSiteSession.sessionToken,
      tag,
    });
    if (!res?.ok) return { ok: false, error: res?.error || "디스코드를 연동하지 못했어요." };
    applySiteAccountRow(res.account);
    return { ok: true, account: cachedSiteAccountFull };
  } catch (err) {
    logToFile("디스코드 연동 실패: " + (err?.message || err));
    return { ok: false, error: "디스코드를 연동하지 못했어요." };
  }
});

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
// statusText: 지금 뭘 하고 있는지(예: "Luna World 플레이 중", "런처에서 대기 중") - 친구 목록에 그대로 보여줌
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
async function uploadGamePresenceInfo(fields) {
  const me = getMySiteIdentity();
  if (!me.id) return; // 사이트 계정 로그인 안 된 상태(이론상 게임 실행 자체가 막혀있어 거의 안 옴)
  try {
    await supabaseFetch("/site_presence", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        nova_account_id: me.id,
        nickname: me.name,
        updated_at: new Date().toISOString(),
        ...fields,
      }),
    });
  } catch (err) {
    logToFile("게임 접속 정보(site_presence) 업로드 실패: " + (err?.message || err));
  }
}

// 게임 폴더의 .nova-presence.json(Nova-Mod가 20초마다 남김 - 49-27차)을 읽어 서버/닉네임
// 정보를 뽑음. 모드가 없는 프로필(바닐라/Forge/NeoForge)이거나, Fabric이라도 모드가 아직
// 한 번도 파일을 안 썼으면 조용히 null을 돌려줌(정상 상태 - 로그 스팸 안 남김).
// ⚠️ 모드 쪽 실제 필드 이름을 이 세션에서 직접 확인하지 못했음(모드는 사용자가 별도로 작업
// 중) - snake_case/camelCase 후보를 모두 시도하도록 방어적으로 짰음. 실제로 안 맞으면 이
// 함수의 후보 목록만 넓히면 됨(라이브 테스트 필요 항목 참고).
async function readModPresenceFile(runRoot) {
  try {
    const raw = await fsp.readFile(path.join(runRoot, ".nova-presence.json"), "utf-8");
    const data = JSON.parse(raw);
    const serverAddress = data.server_address || data.serverAddress || data.server || data.address || null;
    const serverName = data.server_name || data.serverName || null;
    const mcName = data.mc_name || data.mcName || data.name || null;
    presenceFileWarned = false;
    if (!serverAddress && !serverName && !mcName) return null;
    return { serverAddress, serverName, mcName };
  } catch (err) {
    if (err?.code !== "ENOENT" && !presenceFileWarned) {
      presenceFileWarned = true; // 파일이 없는 건 정상(모드 미설치 등)이라 ENOENT는 아예 로그 안 남김
      logToFile("[접속 정보] .nova-presence.json 읽기 실패: " + (err?.message || err));
    }
    return null;
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
    uploadGamePresenceInfo({ server_address: null, server_name: null, mc_name: null }).catch(() => {});
  }
}

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
    if ((rows || []).length >= FORUM_POST_DAILY_LIMIT) {
      return { ok: false, error: `글은 하루에 최대 ${FORUM_POST_DAILY_LIMIT}개까지만 쓸 수 있어요. 내일 다시 시도해주세요.` };
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
    if ((rows || []).length >= FORUM_REPLY_DAILY_LIMIT) {
      return { ok: false, error: `답글은 하루에 최대 ${FORUM_REPLY_DAILY_LIMIT}개까지만 쓸 수 있어요. 내일 다시 시도해주세요.` };
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

ipcMain.handle("profiles:share", async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (profile.fromPreset) {
    return { ok: false, error: "프리셋으로 만든 프로필은 공유할 수 없어요." };
  }

  // 이미 공유 코드를 만든 적이 있으면, 새로 만들지 않고 그 코드를 그대로 다시 알려줌
  // (프로필에 귀속되어 계속 재사용됨 - 삭제하기 전까진 코드가 안 바뀜)
  if (profile.shareCode) {
    return { ok: true, code: profile.shareCode, reused: true };
  }

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
      saveProfiles(list);
    }

    return { ok: true, code };
  } catch (err) {
    logToFile("프로필 공유 실패: " + (err?.message || err));
    const raw = String(err?.message || err);
    const friendly = raw.startsWith("STORAGE_RLS:")
      ? "지금은 공유 파일 업로드가 서버에서 막혀있어요 (관리자에게 알려주세요). 잠시 후 다시 시도해주세요."
      : raw;
    return { ok: false, error: friendly };
  }
});

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

    await downloadSharedProfileFiles(profileRoot, shared);

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
      updateSync: true,
      sharedUpdatedAtSeen: shared.updated_at || new Date().toISOString(),
    };
    const list = getProfiles();
    list.push(profile);
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
    };
  } catch (err) {
    logToFile("공유 프로필 미리보기 실패: " + (err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
});

// 2-5(7차): "프로필 갱신" - 공유 코드를 만든 원작자만 쓸 수 있음. 지금 로컬 mods/resourcepacks/
// shaderpacks/아이콘 상태를 같은 코드에 다시 올리고, 로컬에서 지워진 파일은 Storage에서도 정리함
ipcMain.handle("profiles:refresh-share", async (_e, profileId) => {
  const profile = findProfile(profileId);
  if (!profile) return { ok: false, error: "존재하지 않는 프로필이에요." };
  if (!profile.shareCode) return { ok: false, error: "아직 공유한 적 없는 프로필이에요." };

  try {
    const code = profile.shareCode;
    // 지금까지 올라가 있던 파일 목록을 먼저 조회 - 로컬에서 지워진 파일의 Storage 오브젝트를
    // 정확히 알아야 정리할 수 있음
    const rows = await supabaseFetch(`/shared_profiles?code=eq.${code}&select=*`);
    const prevShared = rows[0] || {};

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
        updated_at: nowIso,
      }),
    });

    return { ok: true, updatedAt: nowIso };
  } catch (err) {
    logToFile("프로필 갱신(공유 재업로드) 실패: " + (err?.message || err));
    const raw = String(err?.message || err);
    const friendly = raw.startsWith("STORAGE_RLS:")
      ? "지금은 공유 파일 업로드가 서버에서 막혀있어요 (관리자에게 알려주세요). 잠시 후 다시 시도해주세요."
      : raw;
    return { ok: false, error: friendly };
  }
});

// 2-6(7차): "업데이트 연동"이 켜진(불러온) 프로필들을 훑어서, 원작자가 "프로필 갱신"한 뒤로
// 새 버전이 있으면 전체 재동기화함 (부분 diff가 아니라 항상 전체 재다운로드 - 정확성 우선,
// 코드가 훨씬 단순해지는 대신 매번 필요 이상으로 다시 받을 수 있다는 트레이드오프가 있음.
// updateSync가 꺼져있으면 그 프로필은 여기서 아예 건드리지 않음 - 최초로 받은 그대로 유지)
ipcMain.handle("profiles:check-share-updates", async () => {
  const list = getProfiles();
  const targets = list.filter((p) => p.importedFrom && p.updateSync !== false);
  if (targets.length === 0) return { ok: true, updated: [] };

  const updated = [];
  for (const profile of targets) {
    try {
      const rows = await supabaseFetch(`/shared_profiles?code=eq.${profile.importedFrom}&select=*`);
      const shared = rows[0];
      if (!shared) continue; // 원본 공유가 지워졌으면 조용히 건너뜀 (지금 프로필은 그대로 둠)

      const seen = profile.sharedUpdatedAtSeen ? new Date(profile.sharedUpdatedAtSeen).getTime() : 0;
      const current = shared.updated_at ? new Date(shared.updated_at).getTime() : 0;
      if (!(current > seen)) continue; // 새 버전 없음

      logToFile(`[업데이트 연동] "${profile.name}" (코드 ${profile.importedFrom}) 새 버전 감지 - 재동기화 시작`);
      const profileRoot = getProfileRoot(profile.id);
      await downloadSharedProfileFiles(profileRoot, shared, { removeStale: true });

      const idx = list.findIndex((p) => p.id === profile.id);
      if (idx >= 0) {
        list[idx].mcVersion = shared.mc_version;
        list[idx].sharedUpdatedAtSeen = shared.updated_at || new Date().toISOString();
      }
      updated.push(profile.id);

      // 버전이 바뀌었을 수도 있으니 자바/에셋도 새로 미리 받아둠 (fire-and-forget)
      prefetchAssetsForProfile({ ...profile, mcVersion: shared.mc_version }).catch(() => {});
    } catch (err) {
      logToFile(`[업데이트 연동] "${profile.name}" 재동기화 실패: ` + (err?.message || err));
    }
  }
  if (updated.length > 0) saveProfiles(list);
  return { ok: true, updated };
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

function getModsSourceDir(mcVersion) {
  // 개발 중(npm start)에는 프로젝트 폴더의 mods/<버전>/, 빌드 후에는 extraResources 로 복사된 resources/mods/<버전>
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mods", mcVersion);
  }
  return path.join(__dirname, "mods", mcVersion);
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

// 24-46차: 모든 Fabric 프로필에 Fabric API를 기본으로 자동 주입 - "패브릭 모드 깔 때마다
// Fabric API 없어서 안 켜진다"는 문제를 아예 없애기 위해, 노바 내장 모드와 완전히 같은
// "숨김 자동 주입" 방식을 그대로 재사용함. 차이점은 노바 모드는 이 저장소 안(novamod/)에
// 미리 빌드해둔 jar를 복사하는 것이고, Fabric API는 남의 프로젝트라 Modrinth(공식 프로젝트 ID
// P7dR8mSH)에서 그 마인크래프트 버전에 맞는 빌드를 매번 조회해서 받아온다는 점뿐 - 나머지
// (모드 관리 화면에 안 보임 / 삭제 불가능 / 모드팩 내보내기·공유 코드에 안 실림) 규칙은 동일함.
const FABRIC_API_PROJECT_ID = "P7dR8mSH"; // Modrinth의 "Fabric API" 공식 프로젝트 ID
const FABRIC_API_FILE_PREFIX = "novaclient-fabricapi-";

// 24-50차: "모드 리스트 모드를 자체적으로 내장시키고" - 게임 안에서 설치된 모드 목록을
// 보여주는 Fabric 모드 "Mod Menu"도 Fabric API와 완전히 같은 패턴으로 모든 Fabric
// 프로필에 기본 자동 주입함. Mod Menu 자체가 Fabric API에 의존하는 모드라, 이미 항상
// 같이 주입되고 있는 Fabric API 덕분에 별도 처리 없이 의존성이 항상 충족됨.
const MOD_MENU_PROJECT_ID = "mOgUt4GM"; // Modrinth의 "Mod Menu" 공식 프로젝트 ID
const MOD_MENU_FILE_PREFIX = "novaclient-modmenu-";

// 노바 내장 모드 + Fabric API + Mod Menu 셋 다 "유저가 관리하는 모드"가 아니므로, 모드
// 목록/모드팩 내보내기/공유 코드 어디에도 노출되면 안 됨 - 그 판단 기준을 한 군데로
// 모아둠(함수 선언이라 파일 어디서든 먼저 써도 안전함 - 호이스팅됨).
function isHiddenModFileName(fileName) {
  return (
    fileName.startsWith(NOVA_MOD_FILE_PREFIX) ||
    fileName.startsWith(FABRIC_API_FILE_PREFIX) ||
    fileName.startsWith(MOD_MENU_FILE_PREFIX)
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
    fabricApiVersionCache[mcVersion] = picked;
    return picked;
  } catch (err) {
    logToFile("[Fabric API] 버전 조회 실패: " + (err?.message || err));
    fabricApiVersionCache[mcVersion] = null;
    return null;
  }
}

// syncNovaMod와 동일한 패턴: 이 버전에 안 맞는(옛날) Fabric API jar는 정리하고, 필요한 게
// 이미 있으면 재다운로드하지 않음. 조회/다운로드가 실패해도 실행 자체는 막지 않음(이 버전을
// Fabric API가 아직 지원 안 하는 아주 최신/구버전일 수도 있으므로 조용히 건너뜀).
async function syncFabricApiMod(mcVersion, runRoot) {
  try {
    const destDir = path.join(runRoot, "mods");
    await fsp.mkdir(destDir, { recursive: true });

    const picked = await resolveFabricApiFile(mcVersion);
    const wantedName = picked ? FABRIC_API_FILE_PREFIX + picked.fileName : null;

    const existing = (await fsp.readdir(destDir)).filter(
      (f) => f.startsWith(FABRIC_API_FILE_PREFIX) && f !== wantedName
    );
    for (const f of existing) {
      await fsp.unlink(path.join(destDir, f)).catch(() => {});
    }

    if (!picked || !picked.fileUrl) {
      logToFile(`[Fabric API] ${mcVersion}에 맞는 버전을 찾지 못해 주입을 건너뜀`);
      return;
    }

    const destPath = path.join(destDir, wantedName);
    if (!fs.existsSync(destPath)) {
      const res = await fetch(picked.fileUrl);
      if (!res.ok) throw new Error("Fabric API 다운로드 실패");
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(destPath, buffer);
      logToFile(`[Fabric API] 주입: ${wantedName}`);
    }
  } catch (err) {
    logToFile("[Fabric API] 주입 실패(실행은 계속함): " + (err?.message || err));
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
    modMenuVersionCache[mcVersion] = picked;
    return picked;
  } catch (err) {
    logToFile("[Mod Menu] 버전 조회 실패: " + (err?.message || err));
    modMenuVersionCache[mcVersion] = null;
    return null;
  }
}

async function syncModMenuMod(mcVersion, runRoot) {
  try {
    const destDir = path.join(runRoot, "mods");
    await fsp.mkdir(destDir, { recursive: true });

    const picked = await resolveModMenuFile(mcVersion);
    const wantedName = picked ? MOD_MENU_FILE_PREFIX + picked.fileName : null;

    const existing = (await fsp.readdir(destDir)).filter(
      (f) => f.startsWith(MOD_MENU_FILE_PREFIX) && f !== wantedName
    );
    for (const f of existing) {
      await fsp.unlink(path.join(destDir, f)).catch(() => {});
    }

    if (!picked || !picked.fileUrl) {
      logToFile(`[Mod Menu] ${mcVersion}에 맞는 버전을 찾지 못해 주입을 건너뜀`);
      return;
    }

    const destPath = path.join(destDir, wantedName);
    if (!fs.existsSync(destPath)) {
      const res = await fetch(picked.fileUrl);
      if (!res.ok) throw new Error("Mod Menu 다운로드 실패");
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsp.writeFile(destPath, buffer);
      logToFile(`[Mod Menu] 주입: ${wantedName}`);
    }
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

function getNovaModDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "novamod");
  }
  return path.join(__dirname, "novamod");
}

function findNovaModJarFor(mcVersion) {
  const dir = getNovaModDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".jar"));
  // jar 이름 규칙: novaclient-mod-<버전>-<모드버전>+mc<버전>.jar (Nova-Mod의 Gradle 설정 기준)
  const found = files.find((f) => f.startsWith(NOVA_MOD_FILE_PREFIX) && f.endsWith(`+mc${mcVersion}.jar`));
  return found ? path.join(dir, found) : null;
}

async function syncNovaMod(mcVersion, runRoot) {
  try {
    const destDir = path.join(runRoot, "mods");
    await fsp.mkdir(destDir, { recursive: true });

    const srcPath = findNovaModJarFor(mcVersion);
    const wantedName = srcPath ? path.basename(srcPath) : null;

    // 다른 버전용/옛날 노바 모드 jar가 남아있으면 정리 (버전을 바꿔 실행하거나 런처를
    // 업데이트했을 때 두 개가 중복 로드되는 사고 방지)
    const existing = (await fsp.readdir(destDir)).filter(
      (f) => f.startsWith(NOVA_MOD_FILE_PREFIX) && f !== wantedName
    );
    for (const f of existing) {
      await fsp.unlink(path.join(destDir, f)).catch(() => {});
    }

    if (!srcPath) {
      logToFile(`[노바 모드] ${mcVersion}용 jar가 novamod/에 없어 주입을 건너뜀`);
      return;
    }

    const destPath = path.join(destDir, wantedName);
    let needCopy = true;
    try {
      const [s1, s2] = await Promise.all([fsp.stat(srcPath), fsp.stat(destPath)]);
      needCopy = s1.size !== s2.size;
    } catch (_) {
      needCopy = true;
    }
    if (needCopy) {
      await fsp.copyFile(srcPath, destPath);
      logToFile(`[노바 모드] 주입: ${wantedName}`);
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
// 진단 로그(mountSkinViewer의 window.luna.logClient 호출)를 그대로 로그 파일에도 남겨서,
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
    width: 1280,
    height: 800,
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
    const waitForBootReady = rendererBootReady
      ? Promise.resolve()
      : Promise.race([bootReadyPromise, new Promise((resolve) => setTimeout(resolve, BOOT_READY_TIMEOUT_MS))]);

    waitForBootReady.then(() => {
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
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", true);
    // 24-23차: 최대화되면 body도 각지게 바뀌므로(is-fullscreen), 셰이프도 같이 꽉 찬
    // 사각형으로 맞춰서 셰이프가 CSS보다 안쪽으로 파고들어 클릭이 씹히는 일이 없게 함
    applyRoundedWindowShape();
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", false);
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

  // 창을 닫으면(다운로드 도중 포함) 진행 중인 다운로드를 즉시 중단
  mainWindow.on("close", () => {
    if (currentAbortController) {
      currentAbortController.abort();
      logToFile("창 종료로 인해 다운로드 중단됨");
    }
  });
}

app.whenReady().then(() => {
  applyProfileArgFromArgv(process.argv);
  migrateOldAccountFormat();
  resetAttendanceOnce();
  migrateCoinsToPerAccount();
  migrateProfileDefaultsFromSettings();
  resetLocalMcAccountsForSingleAccountModel();
  setupDiscordRpc();
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
    const javaFeatureVersion = getJavaFeatureVersionFor(defaultVersion);
    if (!getJavaExecutable(javaFeatureVersion)) {
      logToFile(`첫 실행 - 자바(JRE ${javaFeatureVersion}) 미리 준비 시작`);
      await ensureJava(undefined, javaFeatureVersion, { silent: true });
      logToFile("첫 실행 - 자바 미리 준비 완료");
    }
    // 10-6(7차): 자바뿐 아니라 마인크래프트 버전 매니페스트/라이브러리/클라이언트 jar/에셋도
    // 앱을 켜자마자 조용히 미리 받아둠 (Play를 처음 눌렀을 때부터 기다리지 않도록)
    prefetchMinecraftAssets(defaultVersion, getRoot()).catch((err) => {
      logToFile("첫 실행 - 마인크래프트 에셋 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
    });
  } catch (err) {
    // 미리 준비가 실패해도 실제 실행할 때 다시 시도되니까 조용히 넘어감
    logToFile("첫 실행 자바 미리 준비 실패(나중에 실행 시 다시 시도됨): " + (err?.message || err));
  }
}

// 10-5: 새 프로필을 만든 직후, 그 프로필의 마인크래프트 버전에 맞는 자바를 조용히 미리 받아둠
// (prefetchCommonAssetsOnce와 같은 방식, ensureJava의 silent 옵션을 그대로 재사용)
async function prefetchAssetsForProfile(profile) {
  if (!profile?.mcVersion) return;
  const javaFeatureVersion = getJavaFeatureVersionFor(profile.mcVersion);
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

function setupAutoUpdate() {
  if (!app.isPackaged) return; // 개발 중(npm start)에는 업데이트 확인 안 함

  autoUpdater.autoDownload = false; // 자동으로 받지 않고, 버튼을 눌러야만 받기 시작함
  autoUpdater.autoInstallOnAppQuit = true;

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
    } else {
      createUpdateWindow();
    }
    autoUpdater.downloadUpdate().catch((err) => {
      logToFile("업데이트 자동 다운로드 실패: " + (err?.stack || err));
      // 다운로드 자체가 실패하면 무한정 막아두지 않고 잠금을 풀어서 평소대로 쓸 수 있게 되돌림
      // (다음 5분 주기 확인 때 다시 시도됨)
      isForcedUpdating = false;
      pendingForcedInstallAfterGame = false;
      allowUpdateWindowClose = true;
      if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
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

async function checkOneServerStatus(server) {
  try {
    const [res, pingMs] = await Promise.all([
      fetch(`https://api.mcsrvstat.us/3/${server.host}:${server.port}`),
      measurePingMs(server.host, server.port),
    ]);
    const data = await res.json();
    return { serverId: server.id, online: !!data.online, playersOnline: data.players?.online, playersMax: data.players?.max, pingMs };
  } catch (err) {
    return { serverId: server.id, online: false, playersOnline: undefined, playersMax: undefined, pingMs: undefined };
  }
}

// 13차: "서버 목록에 서버별로 오프라인/온라인을 동그라미 빛으로 보여달라" - 예전엔 지금
// 선택된 서버 하나만 확인해서 텍스트로 보여줬는데, 목록의 서버 전부를 각자 따로 확인해야
// 항목별 점을 켤 수 있어서 전체 서버를 한 번에(동시에) 핑 체크하도록 바꿈
async function checkAllServersStatus() {
  const results = await Promise.all((CONFIG.SERVERS || []).map((s) => checkOneServerStatus(s)));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("servers:status-all", results);
  }
}

let serverStatusInterval = null;
let periodicTickCount = 0;

app.whenReady().then(() => {
  checkAllServersStatus();
  checkAnnouncementPeriodic();
  checkStatusPeriodic();

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
  clearDiscordActivity();
  if (process.platform !== "darwin") app.quit();
});

// 24-42차: 트레이 아이콘을 항상 띄워두게 되면서, 앱이 완전히 종료될 때 트레이 아이콘도 같이
// 정리해야 작업표시줄에 아이콘이 남아있다가 마우스를 올려야 사라지는 "유령 아이콘" 현상을
// 피할 수 있음(Windows 트레이의 흔한 증상 - 프로세스는 끝났는데 아이콘 잔상만 남는 것)
app.on("before-quit", () => {
  if (appTray && !appTray.isDestroyed()) {
    appTray.destroy();
    appTray = null;
  }
});

// ----------------------------------------------------------------------------
// IPC: 창 컨트롤 (최소화 / 닫기) - 최대화/리사이즈는 불가능한 고정 크기 창
// ----------------------------------------------------------------------------
ipcMain.on("window:minimize", () => mainWindow?.minimize());
// X 버튼은 완전 종료함
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
  if (!account) return null;

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

ipcMain.handle("auth:login", async () => {
  try {
    const authManager = new Auth("select_account");
    // msmc 가 자체 팝업(Electron BrowserWindow)을 띄워 마이크로소프트 로그인을 진행합니다.
    const xboxManager = await authManager.launch("electron");
    const token = await xboxManager.getMinecraft();

    const mclcAuth = token.mclc();
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
    if (cachedSiteSession) {
      const mcAccessToken = mclcAuth?.access_token || mclcAuth?.accessToken;
      const linkResult = await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
      if (!linkResult.linked) siteLinkWarning = linkResult.warning || null;
    }

    return { ok: true, profile, siteLinkWarning };
  } catch (err) {
    logToFile("로그인 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
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
    if (cachedSiteSession) {
      const mcAccessToken = mclcAuth?.access_token || mclcAuth?.accessToken;
      const linkResult = await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
      if (!linkResult.linked) siteLinkWarning = linkResult.warning || null;
    }

    return { ok: true, profile, siteLinkWarning };
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
  return {
    site: { id: me.id, name: me.name },
    supabase: { url: CONFIG.SUPABASE_URL, anonKey: CONFIG.SUPABASE_ANON_KEY },
    activeUuid: activeUuid ? normalizeUuid(activeUuid) : null,
    accounts: list,
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
    if (profile?.uuid) await linkMinecraftUuidToActiveSiteAccount(profile.uuid, profile.name, mcAccessToken);
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

function reportProgress(phase, percentInPhase, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const idx = PHASE_ORDER.indexOf(phase);
  let base = 0;
  for (let i = 0; i < idx; i++) base += PHASE_WEIGHT[PHASE_ORDER[i]];

  const clampedPhasePct = Math.max(0, Math.min(100, percentInPhase));
  const overall = base + (PHASE_WEIGHT[phase] || 0) * (clampedPhasePct / 100);

  mainWindow.webContents.send("launch:progress", {
    phase,
    percent: Math.max(0, Math.min(100, Math.round(overall))),
    detail: detail || "",
  });
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
    if (!silent) reportProgress("java", pct, `자바(JRE ${javaFeatureVersion}) 다운로드 중...`);
  });

  if (!silent) reportProgress("java", 100, "자바 압축 해제 중...");
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
      if (!silent) reportProgress("mods-meta", 15 + pct * 0.35, "Forge 설치 프로그램 받는 중...");
    });

    if (!silent) reportProgress("mods-meta", 55, "Forge 설치 중... (시간이 조금 걸릴 수 있어요)");
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
      if (!silent) reportProgress("mods-meta", 15 + pct * 0.35, "NeoForge 설치 프로그램 받는 중...");
    });

    if (!silent) reportProgress("mods-meta", 55, "NeoForge 설치 중... (시간이 조금 걸릴 수 있어요)");
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

// ----------------------------------------------------------------------------
// 3) 모드 파일 동기화 (런처 내장 mods/ -> 인스턴스 mods 폴더)
// ----------------------------------------------------------------------------
// 모드 파일을 "미러" 방식으로 동기화합니다.
// 즉, mods/ 폴더에 넣어둔 목록과 정확히 똑같아지도록:
//  - 목록에 없는 옛날 모드는 삭제
//  - 목록에 있는데 없거나 내용이 다른 모드는 새로 복사
async function syncMods(mcVersion) {
  const src = getModsSourceDir(mcVersion);
  const dest = path.join(getRoot(), "mods");
  await fsp.mkdir(dest, { recursive: true });

  const srcFiles = fs.existsSync(src)
    ? (await fsp.readdir(src)).filter((f) => f.toLowerCase().endsWith(".jar"))
    : [];
  const srcSet = new Set(srcFiles);

  // 1) 목록에 없는 옛날 모드 파일 정리
  const destFiles = (await fsp.readdir(dest)).filter((f) => f.toLowerCase().endsWith(".jar"));
  for (const file of destFiles) {
    if (!srcSet.has(file)) {
      await fsp.unlink(path.join(dest, file)).catch(() => {});
      logToFile("오래된 모드 삭제: " + file);
    }
  }

  // 2) 목록에 있는 모드는 없거나 바뀌었을 때만 복사(같으면 건너뜀 -> 빠름)
  for (let i = 0; i < srcFiles.length; i++) {
    const file = srcFiles[i];
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);

    let needCopy = true;
    try {
      const [s1, s2] = await Promise.all([fsp.stat(srcPath), fsp.stat(destPath)]);
      needCopy = s1.size !== s2.size;
    } catch (_) {
      needCopy = true;
    }

    if (needCopy) await fsp.copyFile(srcPath, destPath);
    reportProgress("mods", ((i + 1) / (srcFiles.length || 1)) * 100, `모드 설치 중: ${file}`);
  }
  reportProgress("mods", 100, "모드 설치 완료");
}

// ----------------------------------------------------------------------------
// 3-0) 모드팩 서버 자동 설치 (50차)
// 모드가 300개 넘는 서버(하이의 놀이터 / Society: Sunlit Valley 등)는 jar을 설치 파일에
// 동봉할 수 없습니다 - 설치 파일이 1.5GB를 넘고, 모드 하나 고칠 때마다 전체 재배포가 되며,
// 자동 업데이트도 매번 그 용량을 다시 받게 되기 때문입니다. 그래서 이 서버들은 GitHub
// Release에 올려둔 클라이언트용 zip을 받아서 인스턴스 폴더에 풀어 씁니다.
//
// 동작:
//   1) 인스턴스에 남겨둔 설치 표시(.nova-modpack.json)와 CONFIG의 modpack.version을 비교
//   2) 같으면 아무것도 안 함 -> 두 번째 실행부터는 즉시 통과(네트워크도 안 씀)
//   3) 다르면 zip을 받아서 mods/를 통째로 비우고 새로 풀어씀(버전이 섞이는 사고 방지)
//
// 실패하면 예외를 그대로 던집니다 - 모드가 반쯤 깔린 채로 게임이 켜지면 크래시 로그만
// 복잡해지므로, 차라리 실행을 멈추고 에러를 보여주는 편이 낫습니다.
// ----------------------------------------------------------------------------
const MODPACK_MARKER_FILE = ".nova-modpack.json";

function readModpackMarker(runRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runRoot, MODPACK_MARKER_FILE), "utf-8"));
  } catch (_) {
    return null; // 파일이 없거나 깨졌으면 "안 깔린 것"으로 취급해서 새로 받음
  }
}

// 모드팩 zip 으로 들어온 리소스팩은 런처 내장분(resourcepacks/<버전>/)이 아니라 인스턴스
// 폴더에 직접 풀립니다. 그래서 syncResourcePacks 가 못 찾고, 빈 목록이 넘어가면
// options.txt 에 resourcePacks:[] 가 기록되면서 팩이 있는데도 전부 꺼져버립니다.
//
// 모드팩은 "기본으로 켜둘 리소스팩"과 그 순서가 정해져 있고, 그 정보는 원본 인스턴스의
// options.txt 에만 있습니다. make-client-pack.ps1 이 그 목록을 nova-resourcepacks.json
// 으로 zip 에 같이 넣어주므로 여기서 그 순서를 그대로 씁니다.
// 매니페스트가 없으면 폴더를 훑어 이름순으로 켭니다(순서는 보장 못 해도 꺼지진 않음).
const MODPACK_RESOURCEPACK_MANIFEST = "nova-resourcepacks.json";

// 50-4차: 모드팩 zip 에는 "처음 들어왔을 때의 기본 설정"이 같이 들어있습니다.
// 키 설정, 켜둘 리소스팩, 수직동기화, 전체화면, 셰이더 같은 것들이죠.
// 첫 설치 때는 그대로 적용하지만, 그 뒤로는 유저가 바꾼 값을 절대 건드리지 않습니다.
// (모드팩을 업데이트해도 유저 설정은 유지 - 압축을 푼 직후 원래 값으로 되돌립니다)
const USER_PREF_FILES = [
  "options.txt",              // 키 설정, 리소스팩, 수직동기화, 전체화면, 음량...
  "optionsshaders.txt",       // 셰이더 선택 (Iris/Oculus 구버전)
  "config/oculus.properties", // 셰이더 켜짐 여부와 선택한 팩
  "config/iris.properties",
  "config/embeddium-options.json", // 그래픽 세부 설정
];

async function listInstanceResourcePacks(runRoot) {
  try {
    const raw = await fsp.readFile(path.join(runRoot, MODPACK_RESOURCEPACK_MANIFEST), "utf-8");
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.length > 0) {
      logToFile(`[리소스팩] 모드팩 지정 목록 사용: ${list.length}개 -> ${list.join(", ")}`);
      return list;
    }
  } catch (_) {
    /* 없거나 깨졌으면 아래로 */
  }

  try {
    const entries = await fsp.readdir(path.join(runRoot, "resourcepacks"), { withFileTypes: true });
    const files = entries
      .filter((e) => e.isDirectory() || e.name.toLowerCase().endsWith(".zip"))
      .map((e) => e.name);
    files.sort();
    logToFile(`[리소스팩] 인스턴스 폴더에서 찾음: ${files.length}개 -> ${files.join(", ")}`);
    return files;
  } catch (_) {
    return [];
  }
}

// 저장소의 modpack.json 을 먼저 읽어서 배포 버전/주소를 정합니다.
// 실패하거나 해당 서버 항목이 없으면 main.js 에 박아둔 값을 그대로 씁니다.
async function resolveModpackSource(server) {
  const local = server.modpack || {};
  try {
    const res = await globalThis.fetch(CONFIG.MODPACK_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const remote = data && data[server.id];
    if (remote && remote.version && remote.url) {
      if (String(remote.version) !== String(local.version || "")) {
        logToFile(
          `[모드팩] 원격 지정 버전 사용: ${server.id} ${local.version || "-"} -> ${remote.version}`
        );
      }
      return { ...local, version: String(remote.version), url: String(remote.url) };
    }
    logToFile(`[모드팩] modpack.json 에 ${server.id} 항목이 없어 내장 값을 씁니다`);
  } catch (err) {
    logToFile("[모드팩] modpack.json 조회 실패, 내장 값 사용: " + (err?.message || err));
  }
  return local;
}

async function syncServerModpack(server, runRoot, signal) {
  const pack = await resolveModpackSource(server);
  const wantVersion = String(pack.version || "1");
  const marker = readModpackMarker(runRoot);

  if (marker && marker.id === server.id && String(marker.version) === wantVersion) {
    logToFile(`[모드팩] ${server.id} ${wantVersion} - 이미 설치돼 있어 건너뜀`);
    reportProgress("mods", 100, "모드팩 최신 상태");
    return null; // 이미 설치돼 있으면 설정은 유저 것 그대로 둡니다
  }

  await fsp.mkdir(runRoot, { recursive: true });
  const tmpZip = path.join(runRoot, `.nova-modpack-${Date.now()}.zip`);

  // 모드팩 zip 에는 팩이 정해둔 기본 설정(options.txt)이 같이 들어있습니다. 이건 화면 밝기,
  // FOV, 켜둘 리소스팩 같은 "처음 들어왔을 때의 기본값"이라 첫 설치 때는 그대로 쓰는 게 맞지만,
  // 이미 플레이하던 사람에게는 키 설정·음량까지 초기화돼 버립니다.
  // 그래서 기존 options.txt 가 있으면 압축을 푼 뒤 원래대로 되돌려 놓습니다.
  const savedPrefs = {};
  let hadAnyPref = false;
  for (const rel of USER_PREF_FILES) {
    try {
      savedPrefs[rel] = await fsp.readFile(path.join(runRoot, rel), "utf-8");
      hadAnyPref = true;
    } catch (_) {
      savedPrefs[rel] = null; // 없던 파일은 모드팩 것을 그대로 씀
    }
  }
  logToFile(
    hadAnyPref
      ? "[모드팩] 기존 개인 설정을 보관해 뒀다가 설치 후 되돌립니다"
      : "[모드팩] 첫 설치 - 모드팩의 기본 설정(키/리소스팩/셰이더 등)을 그대로 적용합니다"
  );

  try {
    logToFile(`[모드팩] 다운로드 시작: ${pack.url}`);
    reportProgress("mods", 0, "모드팩 다운로드 중...");
    await downloadFileWithProgress(pack.url, tmpZip, signal, (pct) => {
      // 다운로드가 이 단계의 대부분이라 0~80% 구간을 씀(나머지 20%는 정리/압축해제)
      reportProgress("mods", pct * 0.8, `모드팩 다운로드 중... ${Math.round(pct)}%`);
    });

    // 예전 모드를 확실히 지우고 새로 깔아야 버전이 섞이지 않음
    reportProgress("mods", 82, "이전 모드 정리 중...");
    await fsp.rm(path.join(runRoot, "mods"), { recursive: true, force: true }).catch(() => {});

    reportProgress("mods", 86, "모드팩 설치 중...");
    await extractZip(tmpZip, { dir: runRoot });

    // 쓰던 설정이 있었으면 되돌림 (첫 설치면 모드팩 기본값이 그대로 남음)
    for (const rel of USER_PREF_FILES) {
      if (savedPrefs[rel] === null) continue;
      await fsp.writeFile(path.join(runRoot, rel), savedPrefs[rel], "utf-8").catch(() => {});
    }

    await fsp.writeFile(
      path.join(runRoot, MODPACK_MARKER_FILE),
      JSON.stringify(
        { id: server.id, version: wantVersion, url: pack.url, installedAt: new Date().toISOString() },
        null,
        2
      ),
      "utf-8"
    );

    logToFile(`[모드팩] 설치 완료: ${server.id} ${wantVersion}`);
    reportProgress("mods", 100, "모드팩 설치 완료");
    // 첫 설치면 모드팩이 정한 리소스팩 목록을 켜줍니다.
    // 이미 쓰던 사람이면 null 을 돌려줘서 options.txt 를 아예 건드리지 않습니다.
    return hadAnyPref ? null : await listInstanceResourcePacks(runRoot);
  } finally {
    await fsp.unlink(tmpZip).catch(() => {}); // 성공/실패 상관없이 임시 zip은 지움
  }
}

// ----------------------------------------------------------------------------
// 3-1) 리소스팩 동기화 + 자동 장착
//   resourcepacks/ 폴더에 넣어둔 .zip을 인스턴스로 복사(모드와 동일한 미러 방식)한 뒤,
//   options.txt의 resourcePacks 목록에 강제로 넣어서 매번 켜질 때 자동으로 켜져 있게 합니다.
// ----------------------------------------------------------------------------
function getResourcePacksSourceDir(mcVersion) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "resourcepacks", mcVersion);
  }
  return path.join(__dirname, "resourcepacks", mcVersion);
}

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

async function syncResourcePacks(mcVersion) {
  const src = getResourcePacksSourceDir(mcVersion);
  const dest = path.join(getRoot(), "resourcepacks");
  await fsp.mkdir(dest, { recursive: true });

  const srcFiles = fs.existsSync(src)
    ? (await fsp.readdir(src)).filter((f) => f.toLowerCase().endsWith(".zip")).sort()
    : [];
  const srcSet = new Set(srcFiles);

  logToFile(`[리소스팩] 소스 폴더: ${src} (존재함: ${fs.existsSync(src)}) / 찾은 파일: ${JSON.stringify(srcFiles)}`);

  // 유저가 설정에서 직접 추가한 리소스팩은 미러 삭제 대상에서 제외
  const userPacks = new Set(store.get("user_resource_packs") || []);

  const destFiles = (await fsp.readdir(dest)).filter((f) => f.toLowerCase().endsWith(".zip"));
  for (const file of destFiles) {
    if (!srcSet.has(file) && !userPacks.has(file)) {
      await fsp.unlink(path.join(dest, file)).catch(() => {});
      logToFile("[리소스팩] 오래된 리소스팩 삭제: " + file);
    }
  }

  for (let i = 0; i < srcFiles.length; i++) {
    const file = srcFiles[i];
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    let needCopy = true;
    try {
      const [s1, s2] = await Promise.all([fsp.stat(srcPath), fsp.stat(destPath)]);
      needCopy = s1.size !== s2.size || !isZipHealthy(destPath);
    } catch (_) {
      needCopy = true;
    }
    if (needCopy) await fsp.copyFile(srcPath, destPath);

    patchResourcePackFormat(destPath); // 버전 호환성 강제로 맞춰줌 (구버전 팩도 켜지게)

    reportProgress(
      "resourcepacks",
      ((i + 1) / (srcFiles.length || 1)) * 100,
      `리소스팩 설치 중: ${file}`
    );
  }
  reportProgress("resourcepacks", 100, "리소스팩 설치 완료");

  // 실제로 폴더에 남아있는 유저 추가 팩만 최종 목록에 포함(지워진 건 자동 제외)
  const stillExistingUserPacks = [];
  for (const f of userPacks) {
    if (fs.existsSync(path.join(dest, f))) {
      patchResourcePackFormat(path.join(dest, f));
      stillExistingUserPacks.push(f);
    }
  }

  const result = [...srcFiles, ...stillExistingUserPacks];
  logToFile(`[리소스팩] 최종 활성화 목록: ${JSON.stringify(result)}`);
  return result; // 자동으로 켤 리소스팩 파일 이름 목록(번들 + 유저 추가)
}

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
      mcVersion = activeProfile.mcVersion;
      runRoot = getProfileRoot(activeProfile.id);
      memoryGB = activeProfile.memoryGB;
      windowWidth = activeProfile.width;
      windowHeight = activeProfile.height;
      fullscreen = activeProfile.fullscreen;

      // 마지막으로 플레이한 시각 기록 (프로필 편집 화면에 "몇 시간 전" 형태로 표시하기 위함)
      const list = getProfiles();
      const idx = list.findIndex((p) => p.id === activeProfile.id);
      if (idx >= 0) {
        list[idx].lastPlayedAt = new Date().toISOString();
        saveProfiles(list);
        activeProfile.lastPlayedAt = list[idx].lastPlayedAt;
      }
    } else {
      selectedServer = getSelectedServer();
      mcVersion = selectedServer.version; // 플레이어가 아니라 서버가 버전을 정함
      runRoot = getRoot();
      const settings = getSettings();
      memoryGB = Math.max(1, Math.min(32, Number(settings.memoryGB) || 4));
      // 50차: 모드팩 서버는 기본 4GB로는 로딩 중에 죽어버림 - 서버가 요구하는 최소치보다
      // 낮게 잡혀 있으면 그 값까지 자동으로 올려줌(설정 자체를 바꾸진 않고 이번 실행만).
      if (selectedServer && selectedServer.minMemoryGB) {
        const needMem = Math.max(1, Math.min(32, Number(selectedServer.minMemoryGB) || 0));
        if (needMem > memoryGB) {
          logToFile(`[실행] ${selectedServer.name}: 메모리 ${memoryGB}G -> ${needMem}G 로 자동 상향`);
          memoryGB = needMem;
        }
      }
      // 24-24차: "설정 화면에서 전체화면 + 해상도 기능 넣어주고" - 하드코딩돼 있던 1280x720을
      // 설정에서 고른 값으로 바꿈(값이 없거나 이상하면 기존 기본값 1280x720으로 폴백)
      windowWidth = Math.max(640, Math.min(7680, Number(settings.mcResolutionWidth) || 1280));
      windowHeight = Math.max(480, Math.min(4320, Number(settings.mcResolutionHeight) || 720));
      fullscreen = settings.mcFullscreen;

      // 13차: "서버도 프로필처럼 최근 플레이순 고정 정렬" 요청 - 서버는 CONFIG.SERVERS가
      // 고정 설정값이라 그 자체엔 기록을 못 남기니, 프로필과 같은 패턴으로 별도 store 키에
      // 서버별 마지막 플레이 시각을 기록해둠 (servers:list에서 이 값을 같이 내려줌)
      const serverLastPlayed = store.get("server_last_played") || {};
      serverLastPlayed[selectedServer.id] = new Date().toISOString();
      store.set("server_last_played", serverLastPlayed);
    }

    const javaFeatureVersion = getJavaFeatureVersionFor(mcVersion);
    const javaPathRaw = await ensureJava(signal, javaFeatureVersion);
    const javaPath = await ensureCustomIconJavaw(javaPathRaw);
    // 15차: "바닐라로 할건지 패브릭으로 할 건지" - 프로필 모드에서 loader가 "vanilla"로
    // 지정된 프로필은 Fabric 준비 단계 자체를 건너뛰고 순정 마인크래프트 버전으로 실행함.
    // 서버 모드/기존 프로필(loader 필드 없음)은 예전 그대로 항상 Fabric을 준비함
    // 24-2차: Forge/NeoForge 지원 추가 - 프로필의 loader가 forge/neoforge면 해당 준비 함수를
    // 대신 호출함(둘 다 --installClient 설치 프로그램 방식). 서버 모드는 항상 Fabric 고정.
    const isVanillaProfile = mode === "profile" && activeProfile?.loader === "vanilla";
    // 50차: 서버 모드도 서버별 loader를 따라감(예전엔 서버 모드가 항상 Fabric 고정이었음).
    // 서버에 loader가 안 적혀 있으면 CONFIG.LOADER(fabric)라서 기존 동작과 완전히 같음.
    const profileLoader =
      mode === "profile"
        ? activeProfile?.loader
        : (selectedServer && selectedServer.loader) || CONFIG.LOADER;
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

    if (mode === "server") {
      // 서버 모드: 개발자가 배포한 모드/리소스팩으로 항상 동일하게 맞춰줌(자동 동기화)
      // 50차: modpack이 지정된 서버는 설치 파일 동봉분 대신 릴리스 zip을 받아서 씀
      if (selectedServer && selectedServer.modpack && selectedServer.modpack.url) {
        // 모드팩 서버: 첫 설치 때만 팩이 정한 리소스팩을 켜주고,
        // 그 뒤로는 유저가 고른 설정을 그대로 둡니다(null 이 돌아옴).
        const firstRunPacks = await syncServerModpack(selectedServer, runRoot, signal);
        if (firstRunPacks) await ensureResourcePacksEnabled(firstRunPacks, runRoot);
      } else {
        await syncMods(mcVersion);
        await ensureResourcePacksEnabled(await syncResourcePacks(mcVersion), runRoot);
      }
    }
    // 프로필 모드: 유저가 직접 넣은 모드/리소스팩을 그대로 씀(자동 동기화 안 함)

    // 25차: 노바 내장 모드는 예외 - 프로필/서버 어느 쪽이든 Fabric으로 실행할 때 항상
    // 자동 주입함(유저가 넣은 모드가 아니라 클라이언트 자체 기능이므로. syncNovaMod 주석 참고).
    // 24-46차: Fabric API도 같은 이유로 항상 자동 주입함(syncFabricApiMod 주석 참고).
    // 24-50차: Mod Menu도 같은 이유로 항상 자동 주입함(syncModMenuMod 주석 참고).
    // ⚠️ 서버 모드에서는 반드시 syncMods 다음에 불러야 함 - syncMods가 "목록에 없는 jar 정리"
    // 단계에서 먼저 넣어둔 노바 모드/Fabric API/Mod Menu jar를 지워버리기 때문.
    if (!isVanillaProfile && profileLoader !== "forge" && profileLoader !== "neoforge") {
      await syncNovaMod(mcVersion, runRoot);
      await syncFabricApiMod(mcVersion, runRoot);
      await syncModMenuMod(mcVersion, runRoot);

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
        await fsp.writeFile(path.join(runRoot, ".nova-launch.json"), JSON.stringify({ ts, sig, ...social }), "utf-8");
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
    if (selectedServer) {
      opts.server = { host: selectedServer.host, port: selectedServer.port };
      opts.quickPlay = {
        type: "multiplayer",
        identifier: `${selectedServer.host}:${selectedServer.port}`,
      };
    }

    launcher.on("progress", (e) => {
      if (e && e.total) {
        reportProgress("game", (e.task / e.total) * 100, `${e.type} 다운로드 중...`);
      }
    });
    launcher.on("download-status", (e) => {
      if (e && e.total) {
        reportProgress("game", (e.current / e.total) * 100, "다운로드 중...");
      }
    });
    launcher.on("data", (line) => logToFile(String(line)));
    launcher.on("debug", (line) => logToFile("[debug] " + String(line)));
    let weLaunchedThis = false; // 우리가 실제로 이 게임을 켰는지 확인용 안전장치
    const launchStartedAtMs = Date.now(); // 24-14차: 이번 실행 시작 시각 - 예전 세션의 남은 크래시 리포트를 걸러내는 기준

    launcher.on("close", async (code) => {
      logToFile("게임 프로세스 종료, 코드: " + code);
      gameProcess = null;
      stopPresenceUpload(true); // 24-67차: 접속 정보 업로드 중단 + 서버 정보 비우기

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

      setDiscordActivity({ state: "메인 화면" });

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
        mainWindow.show();
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

    gameProcess = await launcher.launch(opts);
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

    setDiscordActivity({
      state: selectedServer ? `${selectedServer.name} 플레이 중` : `${activeProfile?.name || "프로필"}로 플레이 중`,
      playing: true,
    });

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
  try {
    const activeProfile = findProfile(store.get("selected_profile_id"));
    if (!activeProfile) throw new Error("선택된 프로필이 없어요. 먼저 프로필을 골라주세요.");

    const mcVersion = activeProfile.mcVersion;
    const runRoot = getProfileRoot(activeProfile.id);
    const memoryGB = activeProfile.memoryGB;
    const windowWidth = activeProfile.width;
    const windowHeight = activeProfile.height;
    const fullscreen = activeProfile.fullscreen;

    const authorization = await getAuthorizationForLaunch();
    const javaFeatureVersion = getJavaFeatureVersionFor(mcVersion);
    const javaPathRaw = await ensureJava(undefined, javaFeatureVersion, { silent: true });
    const javaPath = await ensureCustomIconJavaw(javaPathRaw);

    const isVanillaProfile = activeProfile?.loader === "vanilla";
    const profileLoader = activeProfile?.loader;
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

    if (!isVanillaProfile && profileLoader !== "forge" && profileLoader !== "neoforge") {
      await syncNovaMod(mcVersion, runRoot);
      await syncFabricApiMod(mcVersion, runRoot);
      await syncModMenuMod(mcVersion, runRoot);
      try {
        const ts = Date.now();
        const sig = crypto.createHmac("sha256", NOVA_LAUNCH_SECRET).update("NovaClient::" + ts).digest("hex");
        const social = await collectSocialBridgeForMod().catch((err) => {
          logToFile("[노바 모드][복제 실행] 소셜 정보 수집 실패: " + (err?.message || err));
          return {};
        });
        await fsp.writeFile(path.join(runRoot, ".nova-launch.json"), JSON.stringify({ ts, sig, ...social }), "utf-8");
      } catch (err) {
        logToFile("[노바 모드][복제 실행] 실행 토큰 기록 실패: " + (err?.message || err));
      }
    }

    await applyConfiguredOptions(runRoot, fullscreen);

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

    await launcher.launch(opts);
    return { ok: true };
  } catch (err) {
    logToFile("[복제 실행] 실패: " + (err?.stack || err));
    return { ok: false, error: String(err?.message || err) };
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
    const neededVersions = new Set(profiles.map((p) => p.mcVersion).filter(Boolean));
    if (neededVersions.size === 0) neededVersions.add((CONFIG.SERVERS && CONFIG.SERVERS[0] && CONFIG.SERVERS[0].version) || "1.21.11");

    // 자바 버전(8/17/21) 하나당 이걸 필요로 하는 마인크래프트 버전들을 묶음
    const byFeatureVersion = new Map();
    for (const mcVersion of neededVersions) {
      const fv = getJavaFeatureVersionFor(mcVersion);
      if (!byFeatureVersion.has(fv)) byFeatureVersion.set(fv, []);
      byFeatureVersion.get(fv).push(mcVersion);
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
    dir = getRoot();
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
const ATTENDANCE_DAILY_AMOUNT = 2;
const ATTENDANCE_SATURDAY_BONUS = 5;

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
    dailyAmount: ATTENDANCE_DAILY_AMOUNT,
    saturdayBonus: ATTENDANCE_SATURDAY_BONUS,
    saturdays,
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

  addCoins(ATTENDANCE_DAILY_AMOUNT, `출석체크 ${s.today}일`, uuid);

  let bonus = 0;
  const now = new Date();
  if (isSaturday(now.getFullYear(), now.getMonth(), s.today)) {
    bonus = ATTENDANCE_SATURDAY_BONUS;
    addCoins(bonus, "토요일 출석 보너스", uuid);
  }

  const claimedDays = getPlayerData(uuid).attendanceClaimedDays || [];
  if (!claimedDays.includes(s.today)) claimedDays.push(s.today);
  setPlayerField(uuid, "attendanceClaimedDays", claimedDays);

  return {
    ok: true,
    amount: ATTENDANCE_DAILY_AMOUNT,
    bonus,
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

ipcMain.handle("quests:get-status", () => getQuestStatus());

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

ipcMain.handle("quests:claim-weekly", (_e, hours) => {
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
    // 24-66차 신규: 소모품(닉네임 변경권 등) 보유 개수 - { [consumableField]: count }
    consumables: data.consumables || {},
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
  if (color?.category === "fulltheme") {
    setPlayerField(uuid, "equippedThemeMode", colorId);
    return { ok: true, equipped: getPlayerData(uuid).equippedColor || null, equippedMode: colorId };
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
  else setPlayerField(uuid, "equippedColor", null);
  return { ok: true };
});

// ----------------------------------------------------------------------------
// 리딤 코드 (로그인한 계정 UUID 기준으로 1인당 1회만 사용 가능)
// ----------------------------------------------------------------------------
// 개발자 계정으로 로그인했을 때만 코드 목록을 볼 수 있음 (원문 코드는 아무도 못 봄, 라벨+코인만 보임)
ipcMain.handle("redeem:get-codes-dev", () => {
  if (!isDevAccount()) return null;
  return REDEEM_CODES.map(({ label, amount }) => ({ label, amount }));
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

