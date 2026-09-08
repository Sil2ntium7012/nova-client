// 24-57차 신규: 스플래시(로딩) 창 전용 preload - 지금까지 splash.html은 완전히 독립된
// 파일이라 preload/IPC가 전혀 없었음(메인 앱 창의 preload.js와는 별개). 이번에 "실제
// SUIT 폰트로 그려진 카드의 진짜 크기를 재서 main.js에 보고한다"는 기능 하나만 필요해서,
// 메인 앱의 preload.js(window.luna, 기능이 훨씬 많음)를 그대로 재사용하는 대신 이렇게
// 최소한의 전용 파일을 새로 둠 - 스플래시 창엔 그 많은 기능이 전혀 필요 없고, 노출 범위를
// 꼭 필요한 것 하나로 좁혀두는 게 더 안전함(contextIsolation은 그대로 유지).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaSplash", {
  // width/height: splash.html이 document.fonts.ready 이후 자기 카드(.splash-card)를
  // getBoundingClientRect()로 실측한 값(+창 테두리 여백) - main.js의 createSplashWindow가
  // 이 값을 받아 창을 그 크기로 맞추고 화면 정중앙에 배치한 뒤에야 보여줌
  reportSplashSize: (width, height) => ipcRenderer.send("splash:size", width, height),
});
