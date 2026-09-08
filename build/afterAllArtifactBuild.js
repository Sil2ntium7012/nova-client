// electron-builder "afterAllArtifactBuild" 훅.
//
// 배경: 서명 안 된(코드사이닝 인증서 없는) exe를 브라우저로 직접 다운로드하면 Windows
// Defender/SmartScreen이 빌드마다 새로 생기는 파일을 "본 적 없는 실행파일"로 보고 랜덤하게
// 오탐(예: Trojan:Win32/Wacatac.B!ml)을 내는 경우가 잦음 - 특히 브라우저가 .exe 확장자를
// 직접 받을 때 거는 다운로드 시점 검사에서 자주 걸림. exe를 zip으로 한 번 감싸서 배포하면
// 그 시점 검사를 우회하는 경우가 많아서, NSIS 설치 파일(NovaClient-Setup.exe)이 다 만들어진
// 뒤 같은 폴더에 NovaClient-Setup.zip을 추가로 만들어서 GitHub Release에 같이 올라가게 함.
//
// electron-builder가 --publish always로 실행되면(dist:win:publish) 이 훅이 반환하는 파일도
// exe와 함께 자동으로 GitHub Releases에 첨부됨.
const path = require("path");
const AdmZip = require("adm-zip");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const exePath = (buildResult.artifactPaths || []).find((p) =>
    /Setup\.exe$/i.test(p)
  );
  if (!exePath) return [];

  const zip = new AdmZip();
  zip.addLocalFile(exePath);
  const zipPath = path.join(path.dirname(exePath), "NovaClient-Setup.zip");
  zip.writeZip(zipPath);

  return [zipPath];
};
