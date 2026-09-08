# Luna Client — lunarworld.kro.kr 전용 마인크래프트 런처

Electron 기반 커스텀 마인크래프트 런처입니다. VS Code로 열어서 바로 작업할 수 있습니다.

## 포함된 기능
- Minecraft **1.21.11** + **Fabric** 모드로더
- `mods/` 폴더에 넣은 모드 자동 배포 (exe 안에 내장됨)
- 독립된 실행 파일(런처) — cmd 창 없이 실행
- **Microsoft 계정 로그인** (msmc)
- 초록색 톤의 깔끔한 커스텀 창 (최소화 / 최대화 / 닫기 버튼 직접 구현)
- 최초 실행 시 **Java 21 자동 다운로드**, 마인크래프트 파일 다운로드를 **퍼센트(%)**로 표시, 창을 닫으면 즉시 중단
- 메모리 4GB 고정 할당
- 실행 시 **lunarworld.kro.kr** 서버로 자동 접속

---

## 1. VS Code에서 시작하기

```bash
cd luna-client
npm install
npm start
```

`npm install` 시 인터넷 연결이 필요합니다 (electron, msmc 등 다운로드).
처음 실행하면 로그인 화면이 뜨고, Microsoft 로그인 후 PLAY 버튼을 누르면
자바 → Fabric → 모드 → 마인크래프트 순서로 자동 설치되며 진행률이 표시됩니다.

## 2. 모드 추가하기

`mods/` 폴더에 Fabric용 `.jar` 모드 파일을 그대로 넣으면 됩니다.
(반드시 Fabric API를 포함해서 넣어주세요. 모드는 1.21.11과 호환되는 버전이어야 합니다)

## 3. 설정 바꾸기 (버전 / 서버 / 메모리)

`main.js` 상단의 `CONFIG` 객체에서 전부 수정할 수 있습니다.

```js
const CONFIG = {
  MC_VERSION: "1.21.11",
  SERVER_HOST: "lunarworld.kro.kr",
  SERVER_PORT: "25565",
  MEMORY_MAX: "4G",
  MEMORY_MIN: "4G",
  JAVA_FEATURE_VERSION: 21,
  INSTANCE_NAME: "LunaClient",
};
```

## 4. 배포용 exe(Luna Client.exe) 만들기

```bash
npm run dist:win
```

빌드가 끝나면 `dist/LunaClient-Setup.exe` 파일이 생성됩니다.
이 설치 파일 하나만 배포하면, 사용자가 실행 → 설치 → 첫 실행 시
자동으로 자바/마인크래프트/모드가 설치되고 게임이 켜집니다.

원한다면 `build/icon.ico` 파일을 넣어서 아이콘도 원하는 이미지로 바꿀 수 있습니다
(`build/README.txt` 참고).

---

## 5. 이미 설치한 사람들에게 자동 업데이트 (GitHub Releases)

런처 자체(코드/디자인)를 나중에 고쳐서 새 버전을 배포하고 싶을 때, 이미 설치한 사람들이
새로 다운로드할 필요 없이 앱을 켤 때 자동으로 (바뀐 부분만) 업데이트되도록 설정할 수 있습니다.

### 1) GitHub 저장소 준비
1. github.com 에서 새 저장소를 만듭니다 (예: `luna-client`). Public이든 Private이든 상관없습니다.
2. `package.json` 의 `build.publish` 부분을 실제 정보로 바꿉니다.

```json
"publish": [
  {
    "provider": "github",
    "owner": "실제_깃허브_아이디",
    "repo": "luna-client"
  }
]
```

3. `https://github.com/settings/tokens/new` 에서 개인 액세스 토큰(Personal Access Token)을
   발급받습니다. `repo` 권한 체크박스를 켜고 생성하세요.

### 2) 배포하기
터미널에서 토큰을 환경변수로 설정한 뒤 배포 명령어를 실행합니다.

```powershell
$env:GH_TOKEN="발급받은_토큰_붙여넣기"
npm run dist:win -- --publish always
```

`package.json` 의 `"version"` 값을 새로 배포할 때마다 올려주세요 (예: `1.0.0` → `1.0.1`).
버전을 안 올리면 업데이트로 인식되지 않습니다.

이 명령어가 끝나면 GitHub 저장소의 "Releases" 탭에 새 버전이 자동으로 올라갑니다.
이미 이전 버전을 설치한 사용자들은 런처를 켤 때 자동으로 감지 → 백그라운드 다운로드 →
화면 위에 "새 버전이 준비됐어요" 배너가 뜨고, 눌러야 재시작 및 적용됩니다
(원하면 그냥 종료할 때 자동 적용되게 할 수도 있어요).

### 참고
- 이 기능은 `npm run dist:win` 으로 만든 실제 설치 버전(exe)에서만 동작합니다.
  개발 중(`npm start`)에는 업데이트 확인을 하지 않습니다.
- 서명(코드사인) 없이 배포하면 Windows Defender/SmartScreen이 "알 수 없는 게시자"
  경고를 띄울 수 있습니다. 정식 코드사인 인증서가 있으면 더 매끄럽지만, 없어도
  업데이트 기능 자체는 정상 동작합니다.



- 실제 `.minecraft` 폴더와 완전히 분리된 `%AppData%/LunaClient` 폴더를 인스턴스 루트로 사용합니다.
  (기존에 설치되어 있는 정식 런처와 충돌하지 않습니다)
- 게임이 켜지면 런처 창은 자동으로 숨겨지고, 게임을 종료하면 다시 나타납니다.
- 로그인 정보는 `electron-store`로 로컬에 저장되어, 다음 실행부터는
  토큰이 자동 갱신되어 매번 로그인할 필요가 없습니다.
- 자바는 Eclipse Adoptium(Temurin) JRE 21을 공식 API에서 받아옵니다.
- Fabric 로더 프로필은 Fabric 공식 메타 API(meta.fabricmc.net)에서 가져옵니다.
- 서버 자동 접속은 최신 버전용 `quickPlay` 옵션과 구버전 호환용 `server` 옵션을
  둘 다 넣어뒀습니다. 사용 중인 `minecraft-launcher-core` 버전에 따라 옵션 이름이
  약간 다를 수 있으니, 자동 접속이 안 되면 `main.js`의 `opts.quickPlay` 부분을
  설치된 `minecraft-launcher-core` 패키지의 README(옵션 목록)와 비교해서 조정해주세요.

## 문제 해결

- **로그인 창이 안 뜸**: `msmc` 패키지 버전에 따라 `authManager.launch("electron")`
  대신 `authManager.launch("raw")` 등을 써야 할 수 있습니다. 설치된 msmc 버전의
  README를 확인하세요.
- **자바 다운로드 실패**: 방화벽/네트워크에서 `api.adoptium.net` 접속이 막혀있는지 확인하세요.
- **모드가 로드되지 않음**: 모드가 Fabric 1.21.11과 정확히 호환되는 버전인지,
  Fabric API가 `mods/` 폴더에 함께 들어있는지 확인하세요.
- 이 프로젝트는 코드 생성 환경(샌드박스)에서 인터넷 없이 작성되어, `npm install` 후
  실제 실행/빌드 테스트는 아직 거치지 않았습니다. 처음 `npm start` 했을 때 에러가
  나면 에러 메시지를 캡처해서 알려주시면 바로 수정해드릴 수 있습니다.
