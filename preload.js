const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("luna", {
  // 창 컨트롤
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),
  // 17차: 전체화면 토글 (F11 또는 타이틀바 버튼)
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  onFullscreenChanged: (cb) => ipcRenderer.on("window:fullscreen-changed", (_e, isFullscreen) => cb(isFullscreen)),

  // 로그인
  getCachedProfile: () => ipcRenderer.invoke("auth:get-cached"),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  // 24-35차: 시작 시 사이트 계정 확인 + 마인크래프트 계정 자동 로그인(위 getCachedProfile 등)이
  // 끝났다는 걸 메인 프로세스에 알려줌 - 메인 프로세스는 이 신호를 스플래시를 닫을 시점을
  // 정하는 데 씀(고정 대기 대신 실제 로딩 완료 시점을 씀 - main.js의 app:boot-ready 참고)
  notifyBootReady: () => ipcRenderer.send("app:boot-ready"),

  // 여러 계정 빠른 전환
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  switchAccount: (uuid) => ipcRenderer.invoke("accounts:switch", uuid),

  // 실행
  startLaunch: () => ipcRenderer.invoke("launch:start"),
  stopLaunch: () => ipcRenderer.invoke("launch:stop"),
  // 24-51차: "프로필은 중복실행 버튼을 따로 만들어서" - PLAY/Stop과 완전히 독립된 별도 실행
  startDuplicateLaunch: () => ipcRenderer.invoke("launch:start-duplicate"),
  onProgress: (cb) => ipcRenderer.on("launch:progress", (_e, data) => cb(data)),
  onGameClosed: (cb) => ipcRenderer.on("launch:game-closed", (_e, data) => cb(data)),
  onGameCrashed: (cb) => ipcRenderer.on("game:crashed", (_e, data) => cb(data)),

  // 서버 상태 (13차: 선택된 서버 하나가 아니라 목록의 서버 전부를 한 번에 확인해서
  // 배열로 내려줌 - 서버 목록 항목마다 온라인/오프라인 점을 각자 표시하기 위함)
  onServersStatusAll: (cb) => ipcRenderer.on("servers:status-all", (_e, data) => cb(data)),

  // 서버 선택 (여러 서버 중 고르기)
  listServers: () => ipcRenderer.invoke("servers:list"),
  selectServer: (serverId) => ipcRenderer.invoke("servers:select", serverId),

  // 프로필 (유저가 직접 만드는 인스턴스)
  getLaunchMode: () => ipcRenderer.invoke("launch:get-mode"),
  listAvailableVersions: () => ipcRenderer.invoke("profiles:list-available-versions"),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  selectProfile: (profileId) => ipcRenderer.invoke("profiles:select", profileId),
  createProfile: (data) => ipcRenderer.invoke("profiles:create", data),
  // 15차: "모드팩 업로드" - 로컬에 이미 갖고 있는 .mrpack 파일을 직접 골라 설치
  installModpackFile: () => ipcRenderer.invoke("profiles:install-modpack-file"),
  // 22차: "프로필을 .mrpack으로 뽑는 모드팩 파일로 만드는 기능" - 위 installModpackFile의 반대
  exportModpack: (id) => ipcRenderer.invoke("profiles:export-modpack", id),
  // 15차: 새 프로필 만들기 화면에서 프로필이 생기기 전에 아이콘부터 미리 고름
  pickProfileIconTemp: () => ipcRenderer.invoke("profiles:pick-icon-temp"),
  updateProfile: (data) => ipcRenderer.invoke("profiles:update", data),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  openProfileFolder: (id) => ipcRenderer.invoke("profiles:open-folder", id),
  createProfileShortcut: (id) => ipcRenderer.invoke("profiles:create-shortcut", id),
  onProfileSelectedExternally: (cb) => ipcRenderer.on("profiles:selected-externally", () => cb()),
  setProfileIcon: (id) => ipcRenderer.invoke("profiles:set-icon", id),
  removeProfileIcon: (id) => ipcRenderer.invoke("profiles:remove-icon", id), // 17차 신규
  listProfileFiles: (id, kind) => ipcRenderer.invoke("profiles:list-files", { id, kind }),
  addProfileFile: (id, kind) => ipcRenderer.invoke("profiles:add-file", { id, kind }),
  removeProfileFile: (id, kind, fileName) => ipcRenderer.invoke("profiles:remove-file", { id, kind, fileName }),
  restoreProfileFile: (id, kind, fileName) => ipcRenderer.invoke("profiles:restore-file", { id, kind, fileName }),
  toggleProfileFile: (id, kind, fileName) => ipcRenderer.invoke("profiles:toggle-file", { id, kind, fileName }),
  toggleProfileFilePin: (id, kind, fileName) => ipcRenderer.invoke("profiles:toggle-pin", { id, kind, fileName }),

  // 프리셋 (15, 4차: 카테고리 + 리소스팩/쉐이더 포함 여부 + 버전별 자동 생성)
  listPresets: () => ipcRenderer.invoke("presets:list"),
  presetCategories: () => ipcRenderer.invoke("presets:categories"),
  createPreset: (profileId, name, category, includeResourcepack, includeShader) =>
    ipcRenderer.invoke("presets:create", { profileId, name, category, includeResourcepack, includeShader }),
  deletePreset: (presetId) => ipcRenderer.invoke("presets:delete", presetId),

  // Explore (Modrinth)
  // 24-14차: "클라이언트 모드만 따로 볼 수 있게" - clientOnly 옵션 추가(옵션이라 기존 호출부는 그대로 동작)
  exploreSearch: (query, projectType, gameVersion, sort, page, categories, clientOnly) =>
    ipcRenderer.invoke("explore:search", { query, projectType, gameVersion, sort, page, categories, clientOnly }),
  exploreGetProject: (projectId) => ipcRenderer.invoke("explore:get-project", projectId),
  exploreTranslate: (text) => ipcRenderer.invoke("explore:translate", text), // 17차 신규
  exploreGetVersions: (projectId, gameVersion, projectType) =>
    ipcRenderer.invoke("explore:get-versions", { projectId, gameVersion, projectType }),
  exploreCheckInstalled: (profileId, kind, projectId) =>
    ipcRenderer.invoke("explore:check-installed", { profileId, kind, projectId }),
  exploreInstall: (data) => ipcRenderer.invoke("explore:install", data),
  // 10차 신규: 모드팩 설치 - 지금 프로필에 추가가 아니라 새 프로필을 통째로 만듦
  exploreInstallModpack: (data) => ipcRenderer.invoke("explore:install-modpack", data),
  onModpackInstallProgress: (cb) => ipcRenderer.on("modpack:install-progress", (_e, data) => cb(data)),
  exploreUninstall: (profileId, kind, fileName) =>
    ipcRenderer.invoke("explore:uninstall", { profileId, kind, fileName }),
  exploreCheckUpdates: (profileId, kind) => ipcRenderer.invoke("explore:check-updates", { profileId, kind }),
  exploreApplyUpdate: (data) => ipcRenderer.invoke("explore:apply-update", data),
  // 17차 신규: 제작자 페이지(그 사람의 모드/리소스팩/쉐이더 전부 + 다운로드 합계)
  exploreAuthorProjects: (authorUsername) => ipcRenderer.invoke("explore:author-projects", authorUsername),

  // Forum
  forumListPosts: (category, search, sort, authorUuid, tag) => ipcRenderer.invoke("forum:list-posts", { category, search, sort, authorUuid, tag }),
  forumGetPost: (postId) => ipcRenderer.invoke("forum:get-post", postId),
  forumCreatePost: (data) => ipcRenderer.invoke("forum:create-post", data),
  forumUploadFile: () => ipcRenderer.invoke("forum:upload-file"),
  forumUpdatePost: (data) => ipcRenderer.invoke("forum:update-post", data),
  forumDeletePost: (id) => ipcRenderer.invoke("forum:delete-post", id),
  forumPinPost: (id) => ipcRenderer.invoke("forum:pin-post", id),
  forumUnpinPost: (id) => ipcRenderer.invoke("forum:unpin-post", id),
  // 24-45차: 답글에 사진 첨부 가능하게 imageUrl 인자 추가
  forumCreateReply: (postId, parentId, content, imageUrl) => ipcRenderer.invoke("forum:create-reply", { postId, parentId, content, imageUrl }),
  forumUpdateReply: (id, content) => ipcRenderer.invoke("forum:update-reply", { id, content }),
  forumDeleteReply: (id) => ipcRenderer.invoke("forum:delete-reply", id),
  forumReportPost: (postId, postTitle, reason, detail) => ipcRenderer.invoke("forum:report-post", { postId, postTitle, reason, detail }),
  forumHasReported: (postId) => ipcRenderer.invoke("forum:has-reported", postId), // 17차 신규
  // 24-45차 신규: 답글 신고 / 답글 좋아요
  forumReportReply: (replyId, postId, reason, detail) => ipcRenderer.invoke("forum:report-reply", { replyId, postId, reason, detail }),
  forumHasReportedReply: (replyId) => ipcRenderer.invoke("forum:has-reported-reply", replyId),
  forumToggleReplyLike: (replyId) => ipcRenderer.invoke("forum:toggle-reply-like", replyId),
  forumListReports: () => ipcRenderer.invoke("forum:list-reports"),
  // 17차 신규: 글쓰기 임시저장 / 정지 상태 확인 / 관리자 정지(글쓰기금지·읽기쓰기금지)
  forumGetDraft: () => ipcRenderer.invoke("forum:get-draft"),
  forumSaveDraft: (draft) => ipcRenderer.invoke("forum:save-draft", draft),
  forumClearDraft: () => ipcRenderer.invoke("forum:clear-draft"),
  forumCheckRestriction: () => ipcRenderer.invoke("forum:check-restriction"),
  forumListRestrictions: () => ipcRenderer.invoke("forum:list-restrictions"),
  forumModerateUser: (data) => ipcRenderer.invoke("forum:moderate-user", data),
  forumUnmoderateUser: (targetUuid) => ipcRenderer.invoke("forum:unmoderate-user", targetUuid),
  forumTagUsageCounts: () => ipcRenderer.invoke("forum:tag-usage-counts"), // 17차 신규: 말머리 많이 쓴 순 정렬용
  forumToggleLike: (postId) => ipcRenderer.invoke("forum:toggle-like", postId),
  forumGetUserInfo: (uuid) => ipcRenderer.invoke("forum:get-user-info", uuid),
  // 9차: skinview3d로 모자/망토까지 그리기 위한 실제 텍스처 URL 조회 (main.js 참고)
  getSkinTextures: (uuid) => ipcRenderer.invoke("skin:get-textures", uuid),
  // 24-54차: 렌더러의 3D 스킨 뷰어가 조용히 실패할 때(캔버스 오염, 라이브러리 로드 실패 등)
  // launcher.log에 원인을 남기기 위한 채널 (main.js의 log:client 참고)
  logClient: (line) => ipcRenderer.send("log:client", line),
  forumUploadImage: () => ipcRenderer.invoke("forum:upload-image"),
  isAdmin: () => ipcRenderer.invoke("app:is-admin"),
  shareProfile: (id) => ipcRenderer.invoke("profiles:share", id),
  importProfile: (code) => ipcRenderer.invoke("profiles:import", code),
  // 11차 신규: 포럼 글에 고정된 공유 코드 미리보기(새 프로필을 만들지 않고 구성만 조회)
  previewSharedProfile: (code) => ipcRenderer.invoke("profiles:preview-share", code),
  // 2-5/2-6(7차): 공유 코드 "프로필 갱신"(원작자용) / 업데이트 연동 재동기화 확인
  refreshShareProfile: (id) => ipcRenderer.invoke("profiles:refresh-share", id),
  checkShareUpdates: () => ipcRenderer.invoke("profiles:check-share-updates"),
  // 5-12(7차): 프로필 설정 모달의 "용량" - 이 프로필 폴더 하나만의 용량
  getProfileFolderSize: (id) => ipcRenderer.invoke("profiles:get-folder-size", id),

  // 자동 업데이트
  installUpdateNow: () => ipcRenderer.invoke("update:install-now"),
  onUpdateAvailable: (cb) => ipcRenderer.on("update:available", (_e, data) => cb(data)),
  startUpdateDownload: () => ipcRenderer.send("update:start-download"),
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getCreator: () => ipcRenderer.invoke("app:get-creator"),
  getLastUpdate: () => ipcRenderer.invoke("app:get-last-update"),
  getLicense: () => ipcRenderer.invoke("app:get-license"),
  getBusinessInfo: () => ipcRenderer.invoke("app:get-business-info"), // 17차 신규
  hasUnseenUpdate: () => ipcRenderer.invoke("app:has-unseen-update"),
  markUpdateSeen: () => ipcRenderer.invoke("app:mark-update-seen"),

  // 설정
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (partial) => ipcRenderer.invoke("settings:set", partial),
  // 7-1: 언어 설정 (system이면 OS 언어를 따라감)
  getEffectiveLanguage: () => ipcRenderer.invoke("settings:get-effective-language"),
  // 7-2: 설정에 필요한 자바 버전/설치 위치 읽기 전용 목록 + 폴더 열기
  getJavaInfo: () => ipcRenderer.invoke("settings:get-java-info"),
  openJavaFolder: (javaFeatureVersion) => ipcRenderer.invoke("settings:open-java-folder", javaFeatureVersion),

  // 24-58차: 런처 배경음악 브릿지(getMusicFiles/onMusicPause/onMusicResume) 제거 - main.js의
  // music:list 핸들러가 없어짐에 맞춰 함께 정리함

  // 홈 화면 스크린샷 슬라이드쇼
  getScreenshots: () => ipcRenderer.invoke("screenshots:list"),

  // 효과음
  getCoinSfx: () => ipcRenderer.invoke("sfx:get-coin"),

  // 디스코드
  openDiscord: () => ipcRenderer.invoke("app:open-discord"),
  openWebsite: () => ipcRenderer.invoke("app:open-website"),
  openCoinsShop: () => ipcRenderer.invoke("app:open-coins-shop"), // 24-31차 신규

  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openReleases: () => ipcRenderer.invoke("app:open-releases"),
  openInstanceFolder: () => ipcRenderer.invoke("app:open-folder"),
  openGameFolder: () => ipcRenderer.invoke("app:open-game-folder"),
  checkUpdateNow: () => ipcRenderer.invoke("app:check-update-now"),
  getSystemIsDark: () => ipcRenderer.invoke("app:get-system-is-dark"),
  onSystemThemeChanged: (cb) => ipcRenderer.on("system-theme-changed", (_e, isDark) => cb(isDark)),
  restartApp: () => ipcRenderer.invoke("app:restart"),

  // 업데이트 내역
  getChangelog: () => ipcRenderer.invoke("app:get-changelog"),

  // 19차: 소식(이벤트) - 포럼과 별개인 개발자 직접 게시 소식
  getNews: () => ipcRenderer.invoke("news:get"),

  // 스킨
  getCurrentSkin: () => ipcRenderer.invoke("skin:get-current"),
  pickSkinFile: () => ipcRenderer.invoke("skin:pick-file"),
  uploadSkin: (filePath, variant, opts) =>
    ipcRenderer.invoke("skin:upload", { filePath, variant, saveToList: opts?.saveToList, name: opts?.name }),
  // 18차: 마인크래프트 기본 스킨(스티브/알렉스 등) 목록 - 설치된 게임 파일에서 직접 꺼내옴
  getDefaultSkinPresets: (mcVersion) => ipcRenderer.invoke("skin:get-default-presets", mcVersion),
  // 19차: "내가 추가한 스킨" 목록 - 직접 올린 스킨을 여러 개 저장해두고 바로 스위치할 수 있게 함
  listCustomSkins: () => ipcRenderer.invoke("skin:list-custom"),
  removeCustomSkin: (id) => ipcRenderer.invoke("skin:remove-custom", id),
  // 24-53차: 스킨 변경 기록 + 되돌리기 / 파일 다운로드
  getSkinHistory: () => ipcRenderer.invoke("skin:get-history"),
  revertSkin: (id) => ipcRenderer.invoke("skin:revert-to", id),
  downloadSkinFile: (filePath, suggestedName) => ipcRenderer.invoke("skin:download-file", { filePath, suggestedName }),
  downloadSharedSkin: (dataUrl, suggestedName) => ipcRenderer.invoke("skin:download-dataurl", { dataUrl, suggestedName }),
  applySharedSkin: (dataUrl, variant, name) => ipcRenderer.invoke("skin:apply-shared-dataurl", { dataUrl, variant, name }),

  // 유저 추가 리소스팩
  addResourcePack: () => ipcRenderer.invoke("resourcepack:add-file"),
  listUserResourcePacks: () => ipcRenderer.invoke("resourcepack:list-user"),
  removeUserResourcePack: (fileName) => ipcRenderer.invoke("resourcepack:remove-user", fileName),

  // 첫 실행 약관 동의
  getTermsAgreed: () => ipcRenderer.invoke("terms:get-agreed"),
  agreeTerms: () => ipcRenderer.invoke("terms:agree"),
  // 24-11차: 최초 실행 무료 테마 선택 화면
  getThemeOnboardingSeen: () => ipcRenderer.invoke("onboarding:get-theme-seen"),
  setThemeOnboardingSeen: () => ipcRenderer.invoke("onboarding:set-theme-seen"),

  // 코인 / 7일 출석
  getRewardStatus: () => ipcRenderer.invoke("rewards:get-status"),
  claimReward: (day) => ipcRenderer.invoke("rewards:claim", day),
  getCoinLog: () => ipcRenderer.invoke("coins:get-log"),

  // 15차 신규: 퀘스트(일일/주간 플레이타임)
  getQuestStatus: () => ipcRenderer.invoke("quests:get-status"),
  claimDailyQuest: (hours) => ipcRenderer.invoke("quests:claim-daily", hours),
  claimWeeklyQuest: (hours) => ipcRenderer.invoke("quests:claim-weekly", hours),

  // 꾸미기 상점
  getShopCatalog: () => ipcRenderer.invoke("shop:get-catalog"),
  getShopState: () => ipcRenderer.invoke("shop:get-state"),
  buyColor: (colorId) => ipcRenderer.invoke("shop:buy", colorId),
  equipColor: (colorId) => ipcRenderer.invoke("shop:equip", colorId),
  // 17차: 색상/완전 테마 슬롯 중 하나만 콕 집어 해제(다른 슬롯은 그대로 유지)
  unequipShopCategory: (category) => ipcRenderer.invoke("shop:unequip-category", category),
  // 24-66차 신규: 상점 "기타" 탭에서 산 닉네임 변경권을 실제로 소비해서 닉네임을 바꿈
  useNicknameTicket: (newNickname) => ipcRenderer.invoke("account:use-nickname-ticket", newNickname),
  submitRedeemCode: (code) => ipcRenderer.invoke("redeem:submit", code),
  getRedeemCodesDev: () => ipcRenderer.invoke("redeem:get-codes-dev"),

  // 공지사항 배너
  getAnnouncement: () => ipcRenderer.invoke("announcement:get"),
  onAnnouncementUpdate: (cb) => ipcRenderer.on("announcement:update", (_e, data) => cb(data)),
  onStatusUpdate: (cb) => ipcRenderer.on("status:update", (_e, data) => cb(data)),

  // 설치 용량 / 전체 삭제
  getInstalledSize: () => ipcRenderer.invoke("app:get-installed-size"),
  resetInstall: () => ipcRenderer.invoke("app:reset-install"),
  dismissAnnouncement: (id) => ipcRenderer.invoke("announcement:dismiss", id),

  // 설치된 모드 목록 (읽기 전용)
  listInstalledMods: () => ipcRenderer.invoke("mods:list-installed"),

  // 친구
  friendsHeartbeat: (statusText, statusKind, statusRef, statusVersion) =>
    ipcRenderer.invoke("friends:heartbeat", statusText, statusKind, statusRef, statusVersion),
  friendsSearch: (query) => ipcRenderer.invoke("friends:search", query),
  friendsAdd: (name) => ipcRenderer.invoke("friends:add", name),
  friendsList: () => ipcRenderer.invoke("friends:list"),
  friendsAccept: (requestId) => ipcRenderer.invoke("friends:accept", requestId),
  friendsRemove: (requestId) => ipcRenderer.invoke("friends:remove", requestId),
  // 24-53차: "차단 관련" - 차단은 새 핸들러, 차단 해제는 friendsRemove(행 삭제) 재사용
  friendsBlock: (nickname) => ipcRenderer.invoke("friends:block", nickname),

  // 귓속말 (친구끼리만)
  whisperSend: (toUuid, message) => ipcRenderer.invoke("whisper:send", { toUuid, message }),
  whisperSendSkin: (toUuid, filePath, name, variant) =>
    ipcRenderer.invoke("whisper:send-skin", { toUuid, filePath, name, variant }),
  whisperList: (otherUuid) => ipcRenderer.invoke("whisper:list", otherUuid),
  whisperMarkRead: (otherUuid) => ipcRenderer.invoke("whisper:mark-read", otherUuid),
  whisperUnreadSenders: (friendUuids) => ipcRenderer.invoke("whisper:unread-senders", friendUuids),

  // 24-23차 신규: 친구 목록(노바 계정 id)에서 그 친구의 대표 마인크래프트 계정을 찾아서
  // 전체 프로필 팝업(스킨/게시글)을 열 때 씀
  resolveAccountMinecraft: (accountId) => ipcRenderer.invoke("social:resolve-account-mc", accountId),

  // 프로필 자기소개
  setProfileBio: (bio) => ipcRenderer.invoke("profile:set-bio", bio),

  // 17차 신규: 홈 화면 공지사항(커뮤니티 공지사항 카테고리 연동)
  getLatestForumNotice: () => ipcRenderer.invoke("forum:get-latest-notice"),
  dismissForumNotice: (id) => ipcRenderer.invoke("forum:dismiss-notice", id),

  // 24-4차: 사이트 전용 계정 로그인 - 클라이언트를 쓰려면 먼저 이걸로 로그인해야 함
  // (마이크로소프트 로그인과는 별개 - 그건 사이트 계정 로그인 후에 PLAY를 누르면 그때 뜸)
  // 24-10차: "진짜 계정 통합"으로 이 계정이 Nova Site 웹사이트 계정(nova_accounts)과
  // 완전히 같은 계정이 됨 - 회원가입은 이메일/닉네임/비밀번호 3개를 받음(웹사이트 가입과 동일).
  siteRegister: (email, nickname, password) => ipcRenderer.invoke("siteauth:register", email, nickname, password),
  siteLogin: (loginId, password) => ipcRenderer.invoke("siteauth:login", loginId, password),
  siteLogout: () => ipcRenderer.invoke("siteauth:logout"),
  siteHeartbeat: () => ipcRenderer.invoke("siteauth:heartbeat"),
  getCachedSiteAccount: () => ipcRenderer.invoke("siteauth:get-cached"),

  // 24차 신규(24-4차에서 로그인 방식이 바뀜): 사이트 계정에 마인크래프트 계정 여러 개 +
  // 디스코드를 하나로 묶어두는 연동 관리
  getSiteAccount: () => ipcRenderer.invoke("account:get-site-account"),
  linkMinecraftAccount: (uuid) => ipcRenderer.invoke("account:link-minecraft-account", uuid),
  linkDiscordAccount: (tag) => ipcRenderer.invoke("account:link-discord", tag),
  unlinkSiteAccountLink: (linkId) => ipcRenderer.invoke("account:unlink", linkId),
  // 24-45차 신규: 프로필 사진(아바타) 선택+업로드
  pickAvatarTemp: () => ipcRenderer.invoke("account:pick-avatar-temp"),
  uploadAvatar: (dataUrl) => ipcRenderer.invoke("account:upload-avatar", { dataUrl }),
  getAvatar: () => ipcRenderer.invoke("account:get-avatar"),
});
