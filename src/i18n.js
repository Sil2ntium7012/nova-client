// 7-1: 가벼운 i18n 유틸리티.
// 전체 텍스트를 다 옮기는 대신, 가장 눈에 잘 띄는 정적 UI 문구(타이틀바 버튼,
// 설정 카테고리, 자주 쓰는 버튼 등)만 우선 옮겼습니다. 나머지(포럼/상점/모드 목록 등
// 동적으로 생성되는 대부분의 한국어 문구)는 이번 패스에서는 그대로 한국어로 남아있습니다.
(function () {
  const DICT = {
    nav_back: { ko: "뒤로가기", en: "Back" },
    nav_forward: { ko: "앞으로가기", en: "Forward" },
    // 17차: "사이드바가 아직 영어로 나온다 - 한국어로 바꿔줘" - 사이드바 아이콘 툴팁
    sidebar_launch: { ko: "플레이", en: "Play" },
    sidebar_versions: { ko: "프로필 만들기", en: "Create Profile" },
    sidebar_explore: { ko: "콘텐츠 설치", en: "Install Content" },
    sidebar_forum: { ko: "커뮤니티", en: "Community" },
    sidebar_shop: { ko: "상점", en: "Shop" },
    sidebar_inventory: { ko: "보관함", en: "Inventory" },
    sidebar_profile: { ko: "프로필", en: "Profile" },
    sidebar_settings: { ko: "설정", en: "Settings" },
    // 18차: 보관함 바로 아래 "더보기" 화살표로 펼쳐지는 스킨/서버/소식/업데이트 로그 바로가기
    sidebar_more: { ko: "더보기", en: "More" },
    sidebar_more_skin: { ko: "스킨", en: "Skin" },
    sidebar_more_server: { ko: "서버 (준비 중)", en: "Server (Coming Soon)" },
    sidebar_more_news: { ko: "소식", en: "News" },
    sidebar_more_changelog: { ko: "업데이트 로그", en: "Update Log" },
    sidebar_soon_badge: { ko: "곧", en: "Soon" },
    tb_minimize: { ko: "최소화", en: "Minimize" },
    tb_close: { ko: "닫기", en: "Close" },
    settings_title: { ko: "설정", en: "Settings" },
    settings_nav_skin: { ko: "스킨", en: "Skin" },
    settings_nav_sound: { ko: "소리", en: "Sound" },
    settings_nav_display: { ko: "화면", en: "Display" },
    settings_nav_client: { ko: "클라이언트", en: "Client" },
    settings_nav_language: { ko: "언어", en: "Language" },
    settings_nav_profile: { ko: "내 프로필", en: "My Profile" },
    // 24-24차: "AI 진단 도우미를 정보 말고 전용 설정에서 따로 창 하나 주고" - "정보" 탭
    // 안에 묻혀있던 AI 진단 도우미를 독립된 카테고리로 분리
    settings_nav_ai: { ko: "AI 도우미", en: "AI Assistant" },
    settings_nav_about: { ko: "정보", en: "About" },
    btn_save: { ko: "저장", en: "Save" },
    btn_cancel: { ko: "취소", en: "Cancel" },
    btn_close: { ko: "닫기", en: "Close" },
    btn_install: { ko: "설치", en: "Install" },
    btn_delete: { ko: "삭제", en: "Delete" },
    language_setting_label: { ko: "언어", en: "Language" },

    // 9차: "영어 번역이 빈약하다"는 피드백으로 설정/상점/Contents/프로필 등 자주 보이는
    // 정적 문구를 대폭 추가함 (포럼/모드 목록처럼 동적으로 만들어지는 문구는 이번에도 범위 밖)
    btn_apply: { ko: "적용", en: "Apply" },
    btn_refresh: { ko: "새로고침", en: "Refresh" },
    // 24-156차: 스킨 팝업의 망토 목록
    skin_cape_title: { ko: "내 망토", en: "My capes" },
    skin_cape_loading: { ko: "망토를 불러오는 중이에요...", en: "Loading capes..." },
    skin_cape_empty: { ko: "이 계정에는 망토가 없어요", en: "This account has no capes" },
    skin_cape_none: { ko: "안 쓰기", en: "None" },
    skin_cape_wearing: { ko: "착용 중", en: "Wearing" },
    btn_more: { ko: "더보기", en: "More" },
    btn_add_friend: { ko: "친구 추가", en: "Add Friend" },
    // 24-53차
    btn_download: { ko: "다운로드", en: "Download" },
    btn_share_whisper: { ko: "친구에게 귓속말로 공유", en: "Share with a friend via whisper" },
    btn_revert: { ko: "되돌리기", en: "Revert" },
    btn_send_short: { ko: "보내기", en: "Send" },
    btn_block: { ko: "차단", en: "Block" },
    btn_unblock: { ko: "차단 해제", en: "Unblock" },
    btn_view_profile: { ko: "프로필 보기", en: "View Profile" },
    btn_join: { ko: "참가하기", en: "Join" },
    whisper_title_prefix: { ko: "귓속말", en: "Whisper" },
    profile_settings_title: { ko: "프로필 설정", en: "Profile Settings" },

    settings_skin_model: { ko: "모델", en: "Model" },
    settings_skin_classic: { ko: "기본형(Classic)", en: "Classic" },
    settings_skin_slim: { ko: "슬림형(Slim)", en: "Slim" },
    settings_skin_pick_file: { ko: "파일 선택...", en: "Choose File..." },
    settings_skin_default_title: { ko: "기본 스킨", en: "Default Skins" },
    settings_skin_default_hint: {
      ko: "클릭 한 번으로 마인크래프트 기본 스킨으로 바꿀 수 있어요",
      en: "Switch to a Minecraft default skin with one click",
    },
    settings_skin_default_loading: { ko: "불러오는 중...", en: "Loading..." },
    // 19차
    settings_skin_custom_title: { ko: "내가 추가한 스킨", en: "My Added Skins" },
    settings_skin_custom_empty: { ko: "아직 직접 추가한 스킨이 없어요", en: "You haven't added any skins yet" },
    // 24-53차: 스킨 변경 기록(되돌리기)
    settings_skin_history_title: { ko: "최근 변경 기록", en: "Recent Changes" },
    settings_skin_history_empty: { ko: "아직 변경 기록이 없어요", en: "No changes yet" },
    news_empty: { ko: "불러오는 중...", en: "Loading..." },
    news_empty_list: { ko: "아직 올라온 소식이 없어요", en: "No news yet" },
    settings_my_profile: { ko: "내 프로필", en: "My Profile" },
    settings_bio_label: { ko: "자기소개 (친구에게만 보여요)", en: "Bio (visible to friends only)" },
    // 24-24차: "계정 추가하는 거 프로필로 옮겨주고" - 사이트 계정 연동 패널이 클라이언트
    // 탭에서 내 프로필 탭으로 옮겨오면서, 원래 없어서 그냥 키 이름이 그대로 보이던
    // (settings_site_account_title) 문제도 같이 고침
    // 24-54차: "사이트 계정이 아니라 마인크래프트 계정이라고 해놔야지" - 이 섹션은 실제로는
    // 로그인 자체(사이트 계정)가 아니라 연동된 마인크래프트 계정/디스코드를 관리하는
    // 곳이라(renderSiteAccountPanel 참고), 그 실제 내용에 맞게 이름을 바꿈
    settings_site_account_title: { ko: "마인크래프트 계정", en: "Minecraft Account" },
    settings_sfx_volume: { ko: "효과음 볼륨", en: "Sound Effects Volume" },
    settings_theme: { ko: "테마", en: "Theme" },
    settings_theme_dark: { ko: "다크", en: "Dark" },
    settings_theme_light: { ko: "화이트", en: "Light" },
    settings_theme_system: { ko: "시스템", en: "System" },
    // 24-24차: "설정 화면에서 전체화면 + 해상도 기능 넣어주고" - 서버 모드로 플레이할 때
    // 쓰이던 하드코딩 1280x720 해상도를 설정에서 직접 바꿀 수 있게 함(프로필 모드는 원래부터
    // 프로필별 해상도/전체화면 설정을 따로 씀)
    settings_mc_resolution_label: { ko: "마인크래프트 실행 해상도", en: "Minecraft Launch Resolution" },
    settings_mc_fullscreen_label: { ko: "전체화면으로 시작", en: "Start in Fullscreen" },
    settings_mc_resolution_hint: {
      ko: "서버로 플레이할 때 적용돼요. 프로필로 플레이할 때는 각 프로필의 설정을 따로 써요.",
      en: "Applies when playing via a server. Profile play uses each profile's own settings.",
    },
    settings_installed_size: { ko: "설치 용량", en: "Installed Size" },
    settings_checking: { ko: "확인 중...", en: "Checking..." },
    settings_folder: { ko: "폴더", en: "Folder" },
    settings_open_game_folder: { ko: "게임 폴더 열기", en: "Open Game Folder" },
    // 24-63차 신규: "클라이언트" 탭에 새로 추가된 "게임 파일 전부 삭제" 버튼(기존엔 버튼 자체가
    // 화면 어디에도 없어서 못 누르던 기능 - index.html #btn-reset-install 참고)
    settings_game_files: { ko: "게임 파일", en: "Game Files" },
    settings_reset_install: { ko: "다운로드한 게임 파일 모두 삭제", en: "Delete All Downloaded Game Files" },
    settings_java_location: { ko: "자바 위치", en: "Java Location" },
    // 24-63차: "업데이트 확인"/"런처 재시작"이 "정보" 탭에서 "클라이언트" 탭으로 옮겨짐(그
    // 아래 참고 주석은 24-31차 당시 남긴 것 - 이제 다시 쓰이는 키라 최신화)
    settings_update: { ko: "업데이트", en: "Update" },
    settings_check_update: { ko: "업데이트 확인", en: "Check for Updates" },
    settings_restart_launcher: { ko: "런처 재시작", en: "Restart Launcher" },
    // 24-123차: 설정 > 클라이언트에서 바로 제거하기
    settings_uninstall_title: { ko: "클라이언트 삭제", en: "Uninstall" },
    settings_uninstall: { ko: "Nova Client 삭제", en: "Uninstall Nova Client" },
    // 17차 신규: 규칙 기반 AI 진단 도우미 진입점
    settings_help_title: { ko: "도움말", en: "Help" },
    settings_ai_assistant: { ko: "AI 진단 도우미", en: "AI Troubleshooter" },
    settings_community: { ko: "커뮤니티 · 정보", en: "Community · About" },
    // 24-31차: "루나 디스코드 > 디스코드로 바꾸고" - 표시 문구만 짧게 줄임(id/링크는 그대로)
    // 24-137차: 키 이름에 남아있던 luna 도 nova 로 정리(표시 문구는 그대로 "디스코드")
    settings_nova_discord: { ko: "디스코드", en: "Discord" },
    settings_nova_website: { ko: "Nova Client 사이트", en: "Nova Client Website" },
    // 24-31차 신규: 코인 구매(충전) 페이지로 바로 이동하는 버튼
    settings_coins_shop: { ko: "상점", en: "Shop" },
    settings_license_terms: { ko: "라이선스 및 이용약관", en: "License & Terms" },
    // 24-11차: 설정 > 클라이언트의 "게임 실행 시 런처" 섹션에 i18n 키가 아예 없어서
    // 영어 모드에서 키 이름이 그대로 노출되던 문제를 고쳤어요
    // 24-23차: "설명이 너무 구구절절 길어" - 중복 섹션 제목(settings_launch_behavior_title)을
    // 없애고 행 라벨/선택지 문구를 짧게 줄임. 자동 실행은 select 대신 체크박스 2개로,
    // "친구에게 지금 뭐하는지 공유 안 하기"는 긍정형 "친구에게 상태 공유"로 바꿈
    // 24-31차: "게임 실행 시 설명이 너무 이상해 유지/종료 이런식으로 해야지" - 문구를 짧게 줄임(값은 그대로)
    settings_launch_behavior_label: { ko: "게임 실행 시", en: "When game launches" },
    settings_launch_behavior_stay: { ko: "유지", en: "Keep open" },
    settings_launch_behavior_background: { ko: "백그라운드", en: "Background" },
    settings_launch_behavior_quit: { ko: "종료", en: "Quit" },
    settings_autostart_label: { ko: "컴퓨터 시작 시 자동 실행", en: "Launch on system startup" },
    settings_autostart_background_label: { ko: "백그라운드로 시작", en: "Start in background" },
    settings_hide_presence_label: { ko: "친구에게 상태 공유", en: "Share status with friends" },

    shop_cat_all: { ko: "전체", en: "All" },
    shop_cat_theme_color: { ko: "색상", en: "Colors" },
    shop_cat_fulltheme: { ko: "테마", en: "Themes" },
    shop_cat_cosmetic: { ko: "코스메틱", en: "Cosmetics" },
    shop_cat_special: { ko: "스페셜", en: "Special" },
    shop_cat_misc: { ko: "기타", en: "Misc" },
    shop_coin_history: { ko: "코인 내역", en: "Coin History" },

    explore_type_mod: { ko: "모드", en: "Mods" },
    explore_type_resourcepack: { ko: "리소스팩", en: "Resource Packs" },
    explore_type_shader: { ko: "쉐이더", en: "Shaders" },
    // 10차 신규: 모드팩 - 설치하면 이 모드팩용 새 프로필이 통째로 만들어짐
    explore_type_modpack: { ko: "모드팩", en: "Modpacks" },

    // ── 24-83차 신규: 리소스팩/폰트 만들기 ──────────────────────────────────
    packmaker_open: { ko: "리소스팩/폰트 만들기", en: "Make a Pack / Font" },
    packmaker_open_title: {
      ko: "폰트/리소스팩을 이 프로필 버전에 맞게 만들어서 넣어요",
      en: "Build or convert a pack to match this profile's version",
    },
    packmaker_title: { ko: "리소스팩/폰트 만들기", en: "Make a Pack / Font" },
    packmaker_desc: {
      ko: "폰트 파일(.ttf/.otf)을 고르면 그 폰트를 쓰는 리소스팩을 만들어 넣어주고, 리소스팩(.zip)을 고르면 프로필 버전에 맞게 고쳐서 넣어줘요.",
      en: "Pick a font file (.ttf/.otf) and it becomes a resource pack that uses it. Pick a resource pack (.zip) and it is rebuilt to match the profile's version.",
    },
    packmaker_target: { ko: "넣을 프로필", en: "Install into" },
    packmaker_source: { ko: "폰트 / 리소스팩 파일", en: "Font or resource pack file" },
    packmaker_pick: { ko: "파일 고르기", en: "Choose a file" },
    packmaker_no_file: { ko: "아직 고른 파일이 없어요", en: "No file chosen yet" },
    packmaker_name: { ko: "이름", en: "Name" },
    packmaker_name_ph: { ko: "리소스팩 이름", en: "Resource pack name" },
    packmaker_description: { ko: "설명", en: "Description" },
    packmaker_desc_ph: { ko: "게임 리소스팩 목록에 보이는 설명", en: "Shown in the in-game pack list" },
    packmaker_icon: { ko: "아이콘 (png, 선택)", en: "Icon (png, optional)" },
    packmaker_pick_icon: { ko: "이미지 고르기", en: "Choose an image" },
    packmaker_icon_clear: { ko: "빼기", en: "Remove" },
    packmaker_font_size: { ko: "게임 안 글자 크기", en: "In-game text size" },
    packmaker_font_size_hint: {
      ko: "마인크래프트 기본 글꼴이 11이에요. 글자가 작아 보이면 올려주세요.",
      en: "Minecraft's own font is 11. Raise it if the text looks too small.",
    },
    packmaker_create: { ko: "만들어서 넣기", en: "Create and install" },
    packmaker_kind_font: { ko: "폰트 → 리소스팩으로 만들기", en: "Font → new resource pack" },
    packmaker_kind_pack: { ko: "리소스팩 → 이 버전에 맞게 변환", en: "Resource pack → converted for this version" },
    packmaker_format_hint: {
      ko: "{name} ({version}) - pack_format {format}으로 만들어요",
      en: "{name} ({version}) - built with pack_format {format}",
    },
    packmaker_no_profile: { ko: "먼저 프로필을 만들어주세요", en: "Create a profile first" },
    packmaker_need_file: { ko: "폰트나 리소스팩 파일을 먼저 골라주세요", en: "Choose a font or resource pack file first" },
    packmaker_working: { ko: "만드는 중...", en: "Building..." },
    packmaker_done: { ko: "{file} 을(를) 넣었어요", en: "Installed {file}" },
    packmaker_done_toast: { ko: "리소스팩을 프로필에 넣었어요", en: "Resource pack added to the profile" },
    packmaker_note_ingame: {
      ko: "게임 안에서 [설정 > 리소스팩]에 들어가 켜주면 적용돼요.",
      en: "Turn it on in the game under Options > Resource Packs.",
    },
    packmaker_note_flattened: {
      ko: "폴더가 한 겹 더 있어서 게임이 못 읽던 팩이라, 안쪽 폴더를 바깥으로 펴서 넣었어요.",
      en: "The pack was nested one folder deep (which the game can't read), so it was flattened.",
    },
    packmaker_note_no_reference: {
      ko: "이 버전(1.20 미만)은 기본 글꼴을 함께 쓰는 기능이 없어서, 고른 폰트에 없는 글자는 안 보일 수 있어요.",
      en: "This version (below 1.20) can't fall back to the default font, so characters missing from your font may not show.",
    },
    packmaker_note_kept_vanilla: {
      ko: "고른 폰트에 없는 글자는 마인크래프트 기본 글꼴로 나와요.",
      en: "Characters missing from your font fall back to Minecraft's own font.",
    },

    // ── 24-83차 신규: 설정 > 폰트 ─────────────────────────────────────────
    settings_nav_font: { ko: "폰트", en: "Font" },
    settings_font_label: { ko: "런처 글꼴", en: "Launcher font" },
    settings_font_default: { ko: "지금 쓰고 있는 글꼴", en: "The current font" },
    settings_font_custom: { ko: "직접 추가하기", en: "Add my own" },
    settings_font_custom_hint: {
      ko: "글꼴 파일 (.ttf · .otf · .woff)",
      en: "Font file (.ttf · .otf · .woff)",
    },
    settings_font_hint: {
      ko: "고른 글꼴 파일은 런처 안에 복사해둬요. 원본을 옮기거나 지워도 계속 쓸 수 있어요.",
      en: "The font file is copied into the launcher, so it keeps working even if you move or delete the original.",
    },
    settings_font_applied: { ko: "글꼴을 바꿨어요", en: "Font changed" },
    settings_font_reverted: { ko: "기본 글꼴로 되돌렸어요", en: "Back to the default font" },
    // 24-136차: 커스텀 글꼴 크기 배율
    settings_font_scale_label: { ko: "글꼴 크기", en: "Font Size" },
    settings_font_scale_reset: { ko: "되돌리기", en: "Reset" },
    settings_font_scale_hint: { ko: "직접 추가한 글꼴에만 적용돼요.", en: "Only applies to a font you added yourself." },
    settings_font_scale_hint_on: { ko: "글자 크기만 바뀌고 버튼·칸 크기는 그대로예요.", en: "Only the text scales - buttons and boxes stay the same." },
    settings_font_scale_reverted: { ko: "글꼴 크기를 원래대로 되돌렸어요", en: "Font size reset" },
    // 24-145차: 상점에서 이미 산 물건을 그 자리에서 착용
    shop_equip_now: { ko: "장착", en: "Equip" },
    // 24-146/147차
    shop_refund_title: { ko: "청약철회", en: "Refund" },
    shop_refund_hint: {
      ko: "구매한 지 24시간이 지나지 않은 상품은 환불할 수 있어요. 환불하면 쓴 코인을 그대로 돌려드리고, 착용 중이던 색이나 테마는 기본으로 되돌아가요.",
      en: "Items bought within the last 24 hours can be refunded. You get your coins back, and an equipped color or theme returns to default.",
    },
    settings_auto_apply_packs_label: { ko: "시작할 때 리소스팩·쉐이더 자동 적용", en: "Auto-apply packs on launch" },
    settings_auto_apply_packs_hint: {
      ko: "프로필에서 활성화해둔 팩이 게임에서도 그대로 켜져요. 끄면 게임 안에서 직접 골라야 해요.",
      en: "Packs you enable in a profile are turned on in-game too. Turn this off to pick them yourself.",
    },

    ph_server_search: { ko: "서버 검색", en: "Search servers" },
    ph_profile_search: { ko: "프로필 검색", en: "Search profiles" },
    ph_nickname: { ko: "클라이언트 닉네임", en: "Client nickname" },
    ph_share_code: { ko: "공유 코드를 입력하세요", en: "Enter a share code" },
    ph_profile_name: { ko: "예: 내 서바이벌", en: "e.g. My Survival" },
    ph_jvm_default: { ko: "비워두면 기본값", en: "Leave blank for default" },
    ph_jvm_example: { ko: "예: -XX:+UseG1GC", en: "e.g. -XX:+UseG1GC" },
    ph_explore_search: { ko: "Modrinth에서 검색...", en: "Search Modrinth..." },
    ph_forum_search: { ko: "게시글 검색...", en: "Search posts..." },
    ph_forum_title: { ko: "제목을 입력하세요", en: "Enter a title" },
    ph_forum_content: { ko: "내용을 입력하세요 (링크는 텍스트로 붙여넣으면 자동으로 링크가 돼요)", en: "Enter content (paste a link as plain text and it becomes clickable)" },
    ph_manage_mods_search: { ko: "모드 검색", en: "Search mods" },
    ph_manage_rp_search: { ko: "리소스팩 검색", en: "Search resource packs" },
    ph_manage_shader_search: { ko: "쉐이더팩 검색", en: "Search shaders" },
    ph_redeem_code: { ko: "코드를 입력하세요", en: "Enter a code" },
    ph_report_detail: { ko: "자세한 내용을 적어주세요 (선택)", en: "Add details (optional)" },
    ph_whisper_input: { ko: "메시지를 입력하세요", en: "Type a message" },
    settings_bio_placeholder: { ko: "한 줄 소개를 남겨보세요", en: "Write a short bio" },

    // 13차: "영어가 안 먹는 부분"으로 지적받은 상점/보관함/환영합니다/모드 세부 카테고리/
    // 서버·프로필 전환/최근 플레이순/프로필 닫기/코인·작성글/포럼 카테고리/신고 목록/Install
    // 화면 문구를 대거 보강함
    home_welcome: { ko: "환영합니다, {name}님!", en: "Welcome, {name}!" },
    home_default_name: { ko: "플레이어", en: "Player" },
    home_guest_name: { ko: "게스트", en: "Guest" },
    home_login_required: { ko: "로그인이 필요해요", en: "Login required" },

    hero_mode_server: { ko: "서버", en: "Servers" },
    hero_mode_profile: { ko: "프로필", en: "Profiles" },
    // 24-94차: 서버 설정(서버별로 들어갈 프로필 고르기)
    server_profile_unset: { ko: "프로필 선택", en: "Select profile" },
    server_profile_settings_tip: { ko: "서버 설정", en: "Server settings" },
    server_profile_title: { ko: "{name} 설정", en: "{name} Settings" },
    server_profile_desc: {
      ko: "이 서버에 들어갈 때 쓸 프로필을 골라주세요. {version} 프로필만 고를 수 있어요.",
      en: "Choose the profile to join this server with. Only {version} profiles can be used.",
    },
    server_profile_desc_play: {
      ko: "{name}에 들어갈 프로필을 먼저 골라주세요. {version} 프로필만 고를 수 있어요.",
      en: "Choose a profile to join {name} with first. Only {version} profiles can be used.",
    },
    server_profile_pick_title: { ko: "들어갈 프로필", en: "Profile to use" },
    server_profile_empty: {
      ko: "아직 {version} 프로필이 없어요. 아래에서 바로 만들 수 있어요.",
      en: "You don't have a {version} profile yet. You can create one below.",
    },
    server_profile_current: { ko: "사용 중", en: "In use" },
    server_profile_saved: { ko: "{server}에 \"{profile}\" 프로필로 들어가요", en: "Joining {server} with \"{profile}\"" },
    server_profile_create_btn: { ko: "+ {version} 프로필 만들기", en: "+ Create {version} profile" },
    // 24-95차: 서버 카드
    server_state_online: { ko: "온라인", en: "Online" },
    // 24-96차
    home_server_col_hint: { ko: "멀티플레이 · 서버", en: "Multiplayer · servers" },
    home_profile_col_hint: { ko: "싱글 · 자유 플레이", en: "Singleplayer · free play" },
    server_profile_choose_short: { ko: "프로필 고르기", en: "Choose profile" },
    server_profile_edit_tip: { ko: "{profile} 프로필 수정", en: "Edit {profile} profile" },
    server_profile_tip_linked: { ko: "접속 프로필: {profile} (눌러서 변경)", en: "Joins with {profile} (click to change)" },
    server_profile_tip_unset: { ko: "{version} 프로필을 골라주세요", en: "Choose a {version} profile" },
    server_state_offline: { ko: "오프라인", en: "Offline" },
    server_state_checking: { ko: "확인 중", en: "Checking" },
    server_players_tip: { ko: "접속 중인 인원", en: "Players online" },
    server_ping_tip: { ko: "응답 속도", en: "Latency" },
    server_profile_label: { ko: "접속 프로필", en: "Joins with" },
    server_profile_change: { ko: "변경", en: "Change" },
    server_profile_choose: { ko: "들어갈 프로필 고르기", en: "Choose a profile" },
    server_profile_version_only: { ko: "{version} 전용", en: "{version} only" },

    sort_tooltip: { ko: "정렬", en: "Sort" },
    refresh_tooltip: { ko: "새로고침", en: "Refresh" },
    sort_by_name: { ko: "이름순", en: "By Name" },
    sort_by_recent: { ko: "최근 플레이순", en: "Recently Played" },
    sort_by_added: { ko: "등록순", en: "By Added" },

    btn_close_x: { ko: "닫기", en: "Close" },

    forum_coins_label: { ko: "코인", en: "Coins" },
    forum_postcount_label: { ko: "작성글", en: "Posts" },

    forum_cat_all: { ko: "전체", en: "All" },
    forum_cat_notice: { ko: "공지사항", en: "Notice" },
    forum_cat_info: { ko: "정보", en: "Info" },
    forum_cat_question: { ko: "질문", en: "Question" },
    forum_cat_chat: { ko: "잡담", en: "Chat" },
    forum_cat_opinion: { ko: "의견", en: "Opinion" },
    forum_tag_all: { ko: "말머리 전체", en: "All Tags" },
    forum_sort_latest: { ko: "최신순", en: "Latest" },
    forum_sort_popular: { ko: "인기순", en: "Popular" },
    forum_open_reports: { ko: "신고 목록", en: "Reports" },
    forum_reports_title: { ko: "신고 목록", en: "Reports" },
    forum_reports_empty: { ko: "신고된 글이 없어요", en: "No reports" },
    forum_reporter_prefix: { ko: "신고자: {name}", en: "Reported by: {name}" },
    forum_reporter_unknown: { ko: "알 수 없음", en: "Unknown" },

    inventory_tab_items: { ko: "보관함", en: "Inventory" },
    inventory_tab_attendance: { ko: "출석체크", en: "Attendance" },
    inventory_purchased_title: { ko: "구매한 아이템", en: "Purchased Items" },
    inventory_reset_theme_label: { ko: "기본 색상으로 변경하기", en: "Reset to default color" },
    inventory_empty: { ko: "아직 구매한 아이템이 없어요. 상점에서 먼저 구매해주세요.", en: "No items purchased yet. Visit the shop first." },
    btn_go_to_shop: { ko: "상점으로 가기", en: "Go to Shop" },
    shop_empty_category: { ko: "이 카테고리는 곧 채워질 예정이에요!", en: "This category will be filled in soon!" },
    shop_owned: { ko: "구매함", en: "Owned" },
    shop_buying: { ko: "구매 중...", en: "Purchasing..." },
    shop_buy_fail: { ko: "구매 실패", en: "Purchase failed" },
    shop_buy_success: { ko: "{name} 구매 완료! 보관함에서 착용할 수 있어요", en: "{name} purchased! You can equip it from your inventory." },
    shop_buy_success_consumable: { ko: "{name} 구매 완료! 내 프로필 화면에서 사용할 수 있어요", en: "{name} purchased! You can use it from your profile screen." },
    shop_featured_main: { ko: "메인 상품", en: "Featured" },
    shop_featured_sub: { ko: "서브 메인 상품", en: "Highlighted" },
    shop_no_item: { ko: "상품 없음", en: "No item" },
    shop_buy_now: { ko: "바로 구매하기", en: "Buy Now" },
    coin_suffix: { ko: "코인", en: "Coins" },
    equip_equipped: { ko: "착용 중", en: "Equipped" },
    equip_wear: { ko: "착용하기", en: "Equip" },

    explore_cat_adventure: { ko: "어드벤처", en: "Adventure" },
    explore_cat_technology: { ko: "기술", en: "Technology" },
    explore_cat_magic: { ko: "마법", en: "Magic" },
    explore_cat_decoration: { ko: "꾸미기", en: "Decoration" },
    explore_cat_storage: { ko: "인벤토리", en: "Storage" },
    explore_cat_utility: { ko: "유틸리티", en: "Utility" },
    explore_cat_optimization: { ko: "최적화", en: "Optimization" },
    explore_cat_food: { ko: "음식", en: "Food" },
    explore_cat_fantasy: { ko: "판타지", en: "Fantasy" },
    explore_cat_realistic: { ko: "사실적", en: "Realistic" },
    explore_cat_unique: { ko: "독특한", en: "Unique" },
    explore_cat_lowspec: { ko: "저사양", en: "Low-spec" },
    explore_cat_highspec: { ko: "고사양", en: "High-spec" },
    explore_cat_vanillastyle: { ko: "바닐라풍", en: "Vanilla-style" },
    explore_cat_theme: { ko: "테마", en: "Theme" },
    explore_no_info: { ko: "정보 없음", en: "No info" },
    explore_install_new_profile: { ko: "새 프로필로 설치", en: "Install as new profile" },
    // 20차: "콘텐츠 설치는 친구창 위치에 친구창 대신 프로필 리스트로 교체" - 그 자리에 뜨는
    // 제목
    explore_profile_list_title: { ko: "설치할 프로필", en: "Install to profile" },

    versions_import_by_code: { ko: "공유 코드로 불러오기", en: "Import via Share Code" },
    btn_import: { ko: "불러오기", en: "Import" },
    btn_back_to_list: { ko: "← 목록으로", en: "← Back to List" },
    btn_back_to_version_list: { ko: "← 버전 목록으로", en: "← Back to Versions" },
    create_profile_title: { ko: "새 프로필 만들기 ({version})", en: "New Profile ({version})" },
    create_profile_name_label: { ko: "프로필 이름", en: "Profile Name" },
    create_profile_memory_label: { ko: "메모리 할당", en: "Memory Allocation" },
    create_profile_resolution_label: { ko: "실행 해상도", en: "Launch Resolution" },
    create_profile_fullscreen_label: { ko: "전체화면으로 시작", en: "Start in Fullscreen" },
    create_profile_jvmargs_label: { ko: "JVM 인수 (고급, 선택)", en: "JVM Arguments (advanced, optional)" },
    // 17차: "프로필마다 만들 때, 수정할 때 설명 적을 수 있게 해줘"
    create_profile_description_label: { ko: "설명 (선택)", en: "Description (optional)" },
    ph_profile_description: { ko: "이 프로필에 대한 설명을 적어보세요", en: "Write a description for this profile" },
    btn_create_profile: { ko: "프로필 만들기", en: "Create Profile" },
    toast_profile_name_required: { ko: "프로필 이름을 입력해주세요", en: "Please enter a profile name" },

    // 24-38차: "영어 모드에 해석이 아직 덜 돼있어" - index.html 전수 조사로 찾아낸
    // 미번역 정적 UI 텍스트 293곳(+넓은 재조사로 추가 발견된 7곳)을 전부 채움. 폰트
    // 이름(맑은 고딕/돋움/바탕/궁서/Consolas/Georgia)과 색상 견본 글자("가")처럼 번역
    // 대상이 아닌 항목은 의도적으로 제외함.
    account_add_btn: { ko: "+ 다른 계정 추가", en: "+ Add Another Account" },
    ai_assistant_back_btn: { ko: "← 이전", en: "← Back" },
    ai_assistant_disclaimer: { ko: "딥러닝이나 외부 AI 없이, 정해진 선택지와 키워드로만 답을 찾아드려요", en: "No deep learning or external AI - answers come from a fixed set of choices and keyword matching" },
    ai_assistant_input_ph: { ko: "화면에 뜬 문구를 그대로 적어주세요", en: "Type exactly what's shown on screen" },
    ai_assistant_restart_btn: { ko: "처음으로", en: "Start Over" },
    ai_assistant_title: { ko: "AI 진단 도우미", en: "AI Troubleshooter" },
    attendance_title: { ko: "출석체크", en: "Attendance" },
    author_page_empty: { ko: "이 제작자의 프로젝트를 찾을 수 없어요", en: "No projects found for this author" },
    author_page_stat_downloads: { ko: "전체 다운로드", en: "Total Downloads" },
    avatar_crop_save_btn: { ko: "저장", en: "Save" },
    avatar_crop_title: { ko: "프로필 사진 설정", en: "Set Profile Picture" },
    btn_add_short: { ko: "추가", en: "Add" },
    btn_back_to_profile_list: { ko: "← 프로필 목록으로", en: "← Back to Profile List" },
    btn_confirm: { ko: "확인", en: "Confirm" },
    btn_login: { ko: "로그인", en: "Log In" },
    btn_logout: { ko: "로그아웃", en: "Log Out" },
    btn_purchase: { ko: "구매하기", en: "Purchase" },
    btn_send: { ko: "전송", en: "Send" },
    btn_signup: { ko: "회원가입", en: "Sign Up" },
    btn_start: { ko: "시작하기", en: "Start" },
    btn_use: { ko: "사용하기", en: "Use" },
    crash_copy_log_btn: { ko: "로그 복사", en: "Copy Log" },
    crash_desc: { ko: "게임이 비정상 종료됐어요. 크래시 로그를 복사해서 디스코드에 올려주시면 빠르게 도와드릴게요.", en: "The game closed unexpectedly. Copy the crash log and post it on Discord and we'll help you out quickly." },
    create_profile_icon_pick_title: { ko: "아이콘 선택", en: "Choose an Icon" },
    create_profile_loader_label: { ko: "로더", en: "Loader" },
    create_profile_vanilla_warning: { ko: "Nova Client 기본 기능을 이용하실 수 없습니다", en: "Nova Client's core features aren't available with this loader" },
    duration_1h: { ko: "1시간", en: "1 Hour" },
    duration_24h: { ko: "24시간", en: "24 Hours" },
    duration_30d: { ko: "30일", en: "30 Days" },
    duration_7d: { ko: "7일", en: "7 Days" },
    duration_indefinite: { ko: "무기한", en: "Indefinite" },
    explore_client_mod_only: { ko: "클라이언트 모드만 보기", en: "Client-side mods only" },
    explore_modpack_notice_desc: { ko: "이 모드팩용 새 프로필이 자동으로 만들어져요. 아이콘도 모드팩 아이콘으로 설정돼요.", en: "A new profile is automatically created for this modpack, with its icon set to match." },
    explore_modpack_notice_title: { ko: "모드팩을 설치하면", en: "When you install a modpack" },
    explore_page_next10_title: { ko: "다음 10페이지", en: "Next 10 pages" },
    explore_page_prev10_title: { ko: "이전 10페이지", en: "Previous 10 pages" },
    explore_sort_downloads: { ko: "다운로드순", en: "Downloads" },
    explore_sort_updated: { ko: "업데이트순", en: "Recently Updated" },
    force_update_desc: { ko: "이 버전은 너무 오래됐어요. 업데이트가 필요해요.", en: "This version is too outdated. An update is required." },
    force_update_open_btn: { ko: "업데이트 페이지 열기", en: "Open Update Page" },
    forum_attach_share_code: { ko: "내 프로필 공유 코드 첨부 (선택)", en: "Attach my profile share code (optional)" },
    forum_category_placeholder_opt: { ko: "카테고리를 선택해주세요", en: "Please choose a category" },
    forum_draft_save_btn: { ko: "임시저장", en: "Save Draft" },
    forum_moderate_read_write: { ko: "읽기+쓰기 금지", en: "Ban from Reading + Posting" },
    forum_moderate_reason_ph: { ko: "사유를 적어주세요 (선택)", en: "Write a reason (optional)" },
    forum_moderate_submit_btn: { ko: "제재하기", en: "Restrict" },
    forum_moderate_title: { ko: "유저 제재", en: "Restrict User" },
    forum_moderate_unrestrict_btn: { ko: "제재 해제", en: "Remove Restriction" },
    forum_moderate_write: { ko: "글쓰기 금지", en: "Ban from Posting" },
    forum_report_reason_abuse: { ko: "욕설/비방", en: "Abusive Language" },
    forum_report_reason_flood: { ko: "도배", en: "Flooding" },
    forum_report_reason_inappropriate: { ko: "부적절한 내용", en: "Inappropriate Content" },
    forum_report_reason_spam: { ko: "스팸", en: "Spam" },
    forum_report_submit_btn: { ko: "신고 접수", en: "Submit Report" },
    forum_report_title: { ko: "게시글 신고", en: "Report Post" },
    forum_submit_btn: { ko: "게시하기", en: "Post" },
    forum_tag_label: { ko: "말머리 (선택)", en: "Tag (optional)" },
    forum_tag_none_opt: { ko: "없음", en: "None" },
    forum_user_locked_msg: { ko: "친구만 이 프로필을 볼 수 있어요", en: "Only friends can view this profile" },
    forum_write_btn: { ko: "글쓰기", en: "Write Post" },
    hero_export_modpack_btn: { ko: "모드팩으로 내보내기 (.mrpack)", en: "Export as Modpack (.mrpack)" },
    hero_open_folder_btn: { ko: "폴더 열기", en: "Open Folder" },
    hero_share_code_btn: { ko: "프로필 코드 공유", en: "Share Profile Code" },
    hero_shortcut_btn: { ko: "바로가기 만들기", en: "Create Shortcut" },
    // 24-61차 신규: 친구 목록 줄 우클릭 컨텍스트 메뉴 항목
    // 24-71차 신규: 좌클릭이 하던 "프로필 보기"가 이 메뉴로 옮겨오면서 추가된 항목
    friend_ctx_profile: { ko: "프로필 보기", en: "View Profile" },
    friend_ctx_whisper: { ko: "귓속말", en: "Whisper" },
    friend_ctx_join: { ko: "참가하기", en: "Join" },
    friend_ctx_remove: { ko: "친구 삭제하기", en: "Remove Friend" },
    friend_ctx_block: { ko: "차단하기", en: "Block" },
    home_friends_empty: { ko: "아직 친구가 없어요", en: "No friends yet" },
    home_friends_online_suffix: { ko: "명 접속중", en: " online" },
    home_friends_title: { ko: "친구", en: "Friends" },
    // 24-53차: 친구창 "친구 | 친구추가 | 차단 관련" 세 섹션(이후 가로 탭 방식으로 변경 -
    // home_friends_add_tab/home_friends_block_tab이 실제 탭 라벨, 위 두 개는 미사용으로 남겨둠)
    home_friends_add_title: { ko: "친구 추가", en: "Add Friend" },
    home_friends_block_title: { ko: "차단 관련", en: "Blocking" },
    home_friends_add_tab: { ko: "친구추가", en: "Add" },
    home_friends_block_tab: { ko: "차단", en: "Block" },
    home_friends_blocked_empty: { ko: "차단한 사용자가 없어요", en: "No blocked users" },
    home_notice_title: { ko: "공지사항", en: "Notices" },
    home_profile_select_default: { ko: "프로필 선택", en: "Select a Profile" },
    home_recent_updates_title: { ko: "최근 업데이트", en: "Recent Updates" },
    home_server_select_default: { ko: "서버 선택", en: "Select a Server" },
    label_author: { ko: "제작자", en: "Author" },
    label_category: { ko: "카테고리", en: "Category" },
    label_description: { ko: "설명", en: "Description" },
    label_project: { ko: "프로젝트", en: "Project" },
    label_select_all: { ko: "전체 선택", en: "Select All" },
    lang_option_ko: { ko: "한국어", en: "Korean" },
    login_site_account_sub: { ko: "사이트 계정으로 로그인해주세요", en: "Please log in with your site account" },
    manage_bulk_delete: { ko: "선택 삭제", en: "Delete Selected" },
    manage_bulk_disable: { ko: "선택 비활성화", en: "Disable Selected" },
    manage_bulk_enable: { ko: "선택 활성화", en: "Enable Selected" },
    manage_col_actions: { ko: "작업", en: "Actions" },
    manage_col_version: { ko: "버전", en: "Version" },
    // 24-102차: 목록이 비었을 때 안내
    manage_empty_mods_title: { ko: "아직 추가한 모드가 없어요", en: "No mods added yet" },
    manage_empty_rp_title: { ko: "아직 추가한 리소스팩이 없어요", en: "No resource packs added yet" },
    manage_empty_shader_title: { ko: "아직 추가한 쉐이더팩이 없어요", en: "No shader packs added yet" },
    manage_empty_all_title: { ko: "아직 추가한 콘텐츠가 없어요", en: "No content added yet" },
    manage_empty_subtitle: { ko: "파일을 직접 추가하거나 Contents에서 찾아보세요", en: "Add files yourself or find them in Contents" },
    manage_empty_mods_browse: { ko: "모드 추가하러 가기", en: "Browse Mods" },
    manage_empty_rp_browse: { ko: "리소스팩 추가하러 가기", en: "Browse Resource Packs" },
    manage_empty_shader_browse: { ko: "쉐이더팩 추가하러 가기", en: "Browse Shader Packs" },
    manage_file_upload_label: { ko: "파일 업로드", en: "Upload File" },
    manage_mods_browse_btn: { ko: "모드 추가", en: "Add Mods" },
    manage_profile_default_badge: { ko: "기본 프로필 · 삭제 불가", en: "Default Profile · Cannot Delete" },
    manage_profile_icon_edit_title: { ko: "아이콘 바꾸기", en: "Change Icon" },
    // 24-188차: 이름 옆 연필(이름을 바꿀 수 있다는 표시)
    manage_profile_name_edit_title: { ko: "이름 바꾸기", en: "Rename" },
    // 24-191차: 서버 설정 창에서 프로필 연결 해제
    server_profile_unlink: { ko: "해제", en: "Unlink" },
    server_profile_unlink_title: { ko: "연결 해제", en: "Unlink this profile" },
    server_profile_unlinked: { ko: "{server} 연결을 해제했어요", en: "Unlinked the profile from {server}" },
    // 24-192차: 추천인
    welcome_gift_referral_label: { ko: "추천인 (선택)", en: "Referrer (optional)" },
    welcome_gift_referral_placeholder: { ko: "추천인의 노바 닉네임", en: "Referrer's Nova nickname" },
    welcome_gift_referral_hint: {
      ko: "추천인을 넣으면 나와 추천인 모두에게 {coins}코인이 지급돼요. 한 번만 넣을 수 있어요.",
      en: "Both you and your referrer get {coins} coins. You can only do this once.",
    },
    // 24-194차: 목록의 "플레이 중" 알약
    launch_list_playing: { ko: "플레이 중", en: "Playing" },
    // 24-195차: 클라이언트로 서버 열기
    host_title: { ko: "내 컴퓨터로 서버 열기", en: "Host a server on this PC" },
    host_my_servers: { ko: "내 서버", en: "My servers" },
    host_new: { ko: "+ 새 서버 만들기", en: "+ New server" },
    host_create: { ko: "만들기", en: "Create" },
    host_empty: { ko: "서버를 고르세요", en: "Pick a server" },
    host_list_empty: { ko: "아직 만든 서버가 없어요", en: "No servers yet" },
    host_f_name: { ko: "서버 이름", en: "Server name" },
    host_f_version: { ko: "마인크래프트 버전", en: "Minecraft version" },
    host_f_loader: { ko: "종류", en: "Type" },
    host_f_memory: { ko: "메모리 (GB)", en: "Memory (GB)" },
    host_f_port: { ko: "포트", en: "Port" },
    host_f_players: { ko: "최대 인원", en: "Max players" },
    host_start: { ko: "▶ 서버 시작", en: "▶ Start server" },
    host_stop: { ko: "■ 서버 끄기", en: "■ Stop server" },
    host_folder: { ko: "폴더 열기", en: "Open folder" },
    host_copy_mods: { ko: "프로필 모드 넣기", en: "Copy mods from profile" },
    host_remove: { ko: "목록에서 지우기", en: "Remove from list" },
    host_state_running: { ko: "켜짐", en: "Running" },
    // 24-208차: 상태 뱃지에 host_state_stopped 같은 키 이름이 그대로 뜨던 문제
    // (t() 는 못 찾으면 키를 그대로 돌려주므로 폴백이 안 먹었다) - 나머지 상태도 다 채운다
    host_state_stopped: { ko: "꺼짐", en: "Stopped" },
    // 24-209차: 설정 묶음 제목 / 켜져 있을 때 요약
    host_group_basic: { ko: "기본", en: "Basics" },
    // 24-210차: 화이트리스트 / 모드팩
    // 24-211차: 아이콘 / MOTD 색
    host_icon_title: { ko: "서버 아이콘", en: "Server icon" },
    host_icon_sub: { ko: "64x64 PNG", en: "64x64 PNG" },
    host_icon_pick: { ko: "고르기", en: "Choose" },
    host_icon_clear: { ko: "지우기", en: "Remove" },
    host_icon_none: { ko: "없음", en: "None" },
    host_motd_from: { ko: "색", en: "Color" },
    host_motd_to: { ko: "끝 색", en: "End color" },
    host_motd_gradient: { ko: "그라데이션", en: "Gradient" },
    host_motd_apply: { ko: "색 입히기", en: "Apply color" },
    host_motd_plain: { ko: "색 빼기", en: "Clear color" },
    host_motd_empty: { ko: "글자를 적으면 여기에 보여요", en: "Type above to preview" },
    host_wl_title: { ko: "화이트리스트", en: "Whitelist" },
    host_wl_ph: { ko: "마인크래프트 닉네임", en: "Minecraft username" },
    host_wl_add: { ko: "추가", en: "Add" },
    host_wl_remove: { ko: "빼기", en: "Remove" },
    host_wl_empty: { ko: "없음", en: "None" },
    host_wl_on: { ko: "켜짐", en: "On" },
    host_wl_off: { ko: "꺼짐", en: "Off" },
    host_wl_working: { ko: "확인 중", en: "Checking" },
    host_wl_added: { ko: "{name}", en: "{name}" },
    host_modpack_title: { ko: "모드팩으로 만들기", en: "Create from a modpack" },
    host_modpack_pick: { ko: "모드팩 파일 고르기", en: "Choose a modpack file" },
    host_modpack_create: { ko: "이 모드팩으로 서버 만들기", en: "Create server from this modpack" },
    host_modpack_working: { ko: "푸는 중", en: "Unpacking" },
    host_modpack_noversion: { ko: "버전은 위에서 고른 값", en: "version from the form above" },
    host_group_world: { ko: "월드 설정", en: "World" },
    host_group_toggle: { ko: "게임 규칙", en: "Game rules" },
    host_group_pack: { ko: "리소스팩 설정", en: "Resource pack" },
    host_live_info: { ko: "지금 돌고 있는 설정", en: "Running with" },
    host_live_hint: { ko: "설정을 바꾸려면 서버를 끄고 다시 켜 주세요.", en: "Stop the server to change these settings." },
    host_state_preparing: { ko: "준비 중", en: "Preparing" },
    host_state_starting: { ko: "켜는 중", en: "Starting" },
    host_state_stopping: { ko: "끄는 중", en: "Stopping" },
    host_eula: { ko: "마인크래프트 EULA에 동의합니다", en: "I agree to the Minecraft EULA" },
    host_eula_link: { ko: "EULA 원문 보기", en: "Read the EULA" },
    host_addr_title: { ko: "서버 정보", en: "Server info" },
    host_addr_copy: { ko: "복사", en: "Copy" },
    host_addr_copied: { ko: "복사했어요", en: "Copied" },
    host_addr_hint: {
      ko: "같은 공유기(집) 안에서는 위 주소로 바로 들어와요. 밖에 있는 친구가 들어오려면 공유기에서 이 포트를 열어줘야 해요.",
      en: "On the same network, use the address above. For friends outside, forward this port on your router.",
    },
    host_cmd_ph: { ko: "서버 명령 (예: op 닉네임)", en: "Server command (e.g. op <name>)" },
    host_cmd_send: { ko: "보내기", en: "Send" },
    // 24-197차
    host_eula_need: { ko: "EULA 동의 필요", en: "EULA consent required" },
    host_settings: { ko: "서버 설정", en: "Server settings" },
    host_settings_save: { ko: "설정 저장", en: "Save settings" },
    host_settings_saved: { ko: "저장됨", en: "Saved" },
    host_settings_restart: { ko: "저장됨", en: "Saved" },
    host_port_title: { ko: "외부 접속", en: "Outside access" },
    host_port_open: { ko: "다시 시도", en: "Retry" },
    host_port_retry: { ko: "다시 시도", en: "Retry" },
    host_port_close: { ko: "포트 닫기", en: "Close port" },
    host_addr_local: { ko: "와이파이 공유기", en: "Wi-Fi router" },
    host_addr_have_hint: { ko: "집 IP가 바뀌어도 런처가 알아서 맞춰줘요.", en: "The launcher keeps it pointed at your IP." },
    host_port_working: { ko: "공유기에 요청하는 중...", en: "Asking the router..." },
    host_port_done: { ko: "밖에서는 {ip}:{port} 로 들어오면 돼요", en: "Outside, friends connect to {ip}:{port}" },
    host_port_done_plain: { ko: "포트를 열었어요", en: "Port opened" },
    host_port_closed: { ko: "포트를 닫았어요", en: "Port closed" },
    host_port_manual: { ko: "공유기 포트포워딩 필요", en: "Port forwarding required" },
    // 24-198차: 서버 주소
    host_addrname_title: { ko: "서버 주소", en: "Server address" },
    host_addrname_claim: { ko: "주소 만들기", en: "Create address" },
    host_addrname_release: { ko: "주소 떼기", en: "Release" },
    host_addrname_working: { ko: "주소를 만드는 중...", en: "Creating address..." },
    host_addrname_done: { ko: "{fqdn} 로 들어올 수 있어요", en: "Friends can join at {fqdn}" },
    host_addrname_hint: { ko: "", en: "" },
    // 24-212차: 주소는 떼는 게 아니라 고치는 것 + 안 될 때 짚어주기
    // 24-213차
    // 24-217차: 멤버 구독
    notify_sub_post: { ko: "{name} 님의 새 글", en: "New post by {name}" },
    // 24-218차
    notify_new_follower: { ko: "{name} 님이 구독했어요", en: "{name} subscribed to you" },
    // 24-221차: 친구 폴더
    friend_folder_new: { ko: "폴더 만들기", en: "New folder" },
    // 24-224차
    inventory_tab_tier: { ko: "티어", en: "Tier" },
    // 24-225차
    profile_share_off: { ko: "공유 끄기", en: "Turn off sharing" },
    profile_share_reissue_btn: { ko: "새 코드 만들기", en: "Issue new code" },
    host_pick: { ko: "서버 선택", en: "Pick a server" },
    host_none: { ko: "서버 없음", en: "No servers" },
    host_count_suffix: { ko: "개", en: "" },
    tier_score: { ko: "점수", en: "Score" },
    tier_how: { ko: "점수 올리는 법", en: "How to earn" },
    tier_table: { ko: "티어별 혜택", en: "Tier perks" },
    host_f_seed: { ko: "시드", en: "Seed" },
    host_f_seed_ph: { ko: "비우면 무작위", en: "Random if blank" },
    host_f_leveltype: { ko: "월드 종류", en: "World type" },
    friend_folder_btn: { ko: "폴더", en: "Folder" },
    friend_search_ph: { ko: "친구 검색", en: "Search friends" },
    friend_ctx_folder: { ko: "폴더로 옮기기", en: "Move to folder" },
    forum_subs_btn: { ko: "구독", en: "Subscriptions" },
    forum_subs_mine: { ko: "내가 구독한 사람", en: "Subscribed to" },
    forum_subs_followers: { ko: "나를 구독한 사람", en: "Subscribers" },
    forum_subs_feed: { ko: "구독한 사람들의 글", en: "Posts from subscriptions" },
    host_loading: { ko: "불러오는 중", en: "Loading" },
    host_group_advanced: { ko: "고급 설정", en: "Advanced" },
    forum_subscribe: { ko: "구독", en: "Subscribe" },
    forum_subscribed: { ko: "구독 중", en: "Subscribed" },
    host_my_addr: { ko: "내 접속 주소", en: "My address" },
    host_addr_need: { ko: "접속 주소를 입력해주세요.", en: "Enter an address." },
    host_close_blocked: { ko: "서버를 먼저 종료해주세요", en: "Stop the server first" },
    host_stat_memory: { ko: "메모리", en: "Memory" },
    host_stat_players: { ko: "접속", en: "Players" },
    host_stat_uptime: { ko: "가동", en: "Uptime" },
    host_my_addr_hint: { ko: "", en: "" },
    host_addr_edit: { ko: "수정", en: "Edit" },
    host_addr_check: { ko: "주소 확인", en: "Check" },
    host_addr_checking: { ko: "확인 중", en: "Checking" },
    host_addr_name: { ko: "주소", en: "Address" },
    host_addrname_pending: { ko: ".(도메인 준비 중)", en: ".(domain pending)" },
    // 24-207차: 서버 설정(server.properties) 이름과 서버 자체 값 수정
    host_prop_motd: { ko: "서버 소개", en: "MOTD" },
    "host_prop_max-players": { ko: "최대 인원", en: "Max players" },
    host_prop_difficulty: { ko: "난이도", en: "Difficulty" },
    host_prop_gamemode: { ko: "게임 모드", en: "Gamemode" },
    host_prop_pvp: { ko: "PvP 허용", en: "Allow PvP" },
    "host_prop_white-list": { ko: "화이트리스트", en: "Whitelist" },
    "host_prop_spawn-protection": { ko: "스폰 보호 반경", en: "Spawn protection" },
    "host_prop_view-distance": { ko: "시야 거리(청크)", en: "View distance" },
    "host_prop_simulation-distance": { ko: "연산 거리(청크)", en: "Simulation distance" },
    "host_prop_allow-flight": { ko: "비행 허용", en: "Allow flight" },
    "host_prop_enable-command-block": { ko: "커맨드 블록", en: "Command blocks" },
    "host_prop_resource-pack": { ko: "리소스팩 주소(URL)", en: "Resource pack URL" },
    "host_prop_resource-pack-sha1": { ko: "리소스팩 SHA-1 (선택)", en: "Resource pack SHA-1 (optional)" },
    "host_prop_require-resource-pack": { ko: "리소스팩 필수", en: "Require resource pack" },
    host_cmd_adopted: {
      ko: "런처를 다시 켠 뒤에는 명령을 보낼 수 없어요",
      en: "Commands are unavailable after restarting the launcher",
    },
    // 24-204차: 서버 열기 창 정리
    host_f_name_ph: { ko: "예: 망고네 서버", en: "e.g. My server" },
    host_eula_legacy: { ko: "EULA 동의 필요", en: "EULA consent required" },
    host_addrname_preview: { ko: "친구는 {addr} 로 들어와요", en: "Friends join at {addr}" },
    host_port_idle: { ko: "", en: "" },
    host_port_trying: { ko: "", en: "" },
    host_port_ok: { ko: "밖에서도 들어올 수 있어요", en: "Friends outside can join" },
    host_port_fail: { ko: "포트를 열지 못했어요", en: "Couldn't open the port" },
    // 24-200차: 알림함
    notify_title: { ko: "알림함", en: "Inbox" },
    notify_empty: { ko: "새 알림이 없어요", en: "Nothing new" },
    // 24-201차: 알림/선물함 창
    // 24-202차: 설정 카테고리 재편
    settings_nav_av: { ko: "비디오 / 오디오", en: "Video / Audio" },
    settings_group_play: { ko: "플레이", en: "Play" },
    sidebar_more_server: { ko: "서버 열기", en: "Host a server" },
    notify_tab_alerts: { ko: "알림", en: "Alerts" },
    notify_tab_gifts: { ko: "선물함", en: "Gifts" },
    notify_empty_alerts: { ko: "새 알림이 없어요", en: "No new alerts" },
    notify_empty_gifts: { ko: "받을 선물이 없어요", en: "No gifts to claim" },
    notify_go_claim: { ko: "받으러 가기", en: "Claim" },
    notify_go_open: { ko: "열기", en: "Open" },
    notify_reward: { ko: "받을 보상이 있어요", en: "Rewards to claim" },
    notify_reward_desc: { ko: "출석체크 · 퀘스트", en: "Attendance · quests" },
    notify_welcome: { ko: "가입 축하 선물이 남아 있어요", en: "Your welcome gift is waiting" },
    notify_welcome_desc: { ko: "테마 1개 + 색상 1개", en: "1 theme + 1 color" },
    notify_request: { ko: "받은 친구 요청이 있어요", en: "Friend requests" },
    notify_request_desc: { ko: "친구추가 탭에서 수락할 수 있어요", en: "Accept them in the Add tab" },
    notify_whisper: { ko: "안 읽은 귓속말이 있어요", en: "Unread whispers" },
    notify_whisper_desc: { ko: "친구 목록에서 빨간 점이 붙은 친구를 눌러보세요", en: "Open the friend with a red dot" },
    notify_notice: { ko: "새 공지가 있어요", en: "New announcement" },
    // 24-200차: 마인크래프트 공식 소식
    news_mc_title: { ko: "마인크래프트 공식 소식", en: "Minecraft news" },
    news_mc_sub: { ko: "minecraft.net · 자동 번역", en: "minecraft.net · auto-translated" },
    news_mc_loading: { ko: "불러오는 중...", en: "Loading..." },
    news_mc_empty: { ko: "공식 소식을 불러오지 못했어요", en: "Couldn't load official news" },
    news_mc_open: { ko: "원문 기사 열기", en: "Read the article" },
    settings_updates_group: { ko: "업데이트", en: "Updates" },
    host_addrname_notready: { ko: "도메인 준비 중", en: "Domain not ready" },
    host_port_cgnat: { ko: "포트는 열렸지만 통신사 쪽에서 한 번 더 막혀 있어요(CGNAT). 밖에서는 못 들어올 수 있어요.", en: "Port opened, but your ISP uses CGNAT - outside connections may still fail." },
    welcome_gift_referral_item: { ko: "추천인 보상 {coins}코인", en: "{coins} referral coins" },
    welcome_gift_referral_done: {
      ko: "{name}님을 추천인으로 등록했어요 - 서로 {coins}코인씩 받았어요",
      en: "{name} set as your referrer - you both got {coins} coins",
    },
    manage_profile_icon_remove_title: { ko: "기본 아이콘으로", en: "Reset to Default Icon" },
    manage_refresh_share_btn: { ko: "변경 사항 올리기", en: "Push Changes" },
    manage_refresh_share_title: { ko: "공유 코드에 지금 구성을 다시 올리고, 받은 사람들에게 알릴지 고르기", en: "Push the current setup to the share code and choose whether to notify people who got it" },
    manage_rp_browse_btn: { ko: "리소스팩 추가", en: "Add Resource Packs" },
    manage_shader_browse_btn: { ko: "쉐이더팩 추가", en: "Add Shaders" },
    manage_tab_all: { ko: "전체", en: "All" },
    manage_tab_mods: { ko: "모드", en: "Mods" },
    manage_tab_rp: { ko: "리소스팩", en: "Resource Packs" },
    manage_tab_shaders: { ko: "쉐이더팩", en: "Shader Packs" },
    // 24-139차: 탭 줄이 한 줄에 안 들어가서 라벨을 줄임(뜻은 그대로, 툴팁에 설명 있음)
    manage_update_all: { ko: "업데이트", en: "Update" },
    // 24-140차: 추가 실행 직후 마인크래프트 창이 뜰 때까지 보여주는 버튼 문구
    play_connecting: { ko: "접속 중...", en: "Connecting..." },
    // 24-154차: PLAY 옆 종료 아이콘 버튼 - 가장 먼저 켠 인스턴스부터 끈다
    play_stop_oldest: { ko: "가장 먼저 켠 게임 종료", en: "Close the oldest running game" },
    // 24-155차: 메인 화면 선물 버튼
    home_gift_title: { ko: "출석체크 / 퀘스트 보상", en: "Daily check-in / quest rewards" },
    manage_update_all_hint_title: { ko: "업데이트 가능한 모드를 한 번에 반영", en: "Apply all available mod updates at once" },
    manage_updatesync_label: { ko: "알림", en: "Alerts" },
    manage_updatesync_title: { ko: "공유자가 프로필을 업데이트하면 알림을 받을지", en: "Whether to get notified when the sharer updates this profile" },
    mc_gate_login_btn: { ko: "마인크래프트 계정으로 로그인", en: "Log In with Minecraft Account" },
    mc_gate_logout_btn: { ko: "사이트 계정 로그아웃", en: "Log Out of Site Account" },
    mc_gate_text_1: { ko: "이 계정에서 사용할 마인크래프트 계정으로 로그인해주세요.", en: "Please log in with the Minecraft account you'll use with this account." },
    mc_gate_text_2: { ko: "로그인하면 이 사이트 계정에 자동으로 연동돼요.", en: "Logging in will automatically link it to this site account." },
    mc_gate_title: { ko: "마지막 한 단계만 더 하면 돼요", en: "Just one more step" },
    mod_detail_open_modrinth_title: { ko: "Modrinth 페이지 열기", en: "Open Modrinth Page" },
    mod_detail_show_beta: { ko: "베타 버전도 보기", en: "Show beta versions too" },
    mod_detail_side_mcversion: { ko: "마인크래프트 버전", en: "Minecraft Version" },
    mod_detail_side_tags: { ko: "태그", en: "Tags" },
    mod_detail_tab_gallery: { ko: "스크린샷", en: "Screenshots" },
    mod_detail_translate_btn: { ko: "번역", en: "Translate" },
    mod_gallery_next_aria: { ko: "다음", en: "Next" },
    mod_gallery_prev_aria: { ko: "이전", en: "Previous" },
    mod_install_version_prefix: { ko: "버전", en: "Version" },
    mod_install_version_suffix: { ko: "에 설치돼요", en: " will be installed" },
    mod_version_select_title: { ko: "버전 선택", en: "Choose a Version" },
    mods_update_title: { ko: "업데이트 가능한 모드", en: "Mods with Available Updates" },
    ph_site_email: { ko: "이메일", en: "Email" },
    // 24-177차: 서버 직접 추가
    server_add_title: { ko: "서버 추가", en: "Add a server" },
    server_add_desc: { ko: "서버 주소만 입력하면 포트와 버전은 런처가 알아서 찾아요.", en: "Just enter the address - the launcher finds the port and version for you." },
    server_add_probe: { ko: "서버 확인", en: "Check server" },
    server_add_save: { ko: "목록에 추가", en: "Add to list" },
    server_add_version_hint: { ko: "이 버전과 같은 프로필로만 접속할 수 있어요. 자동으로 찾은 값이 틀리면 직접 고쳐주세요.", en: "You can only join with a profile on this exact version. If the detected value is wrong, edit it." },
    ph_server_address: { ko: "예: mc.example.com", en: "e.g. mc.example.com" },
    ph_server_name: { ko: "목록에 보일 이름", en: "Name shown in the list" },
    ph_server_version: { ko: "마인크래프트 버전 (예: 1.21.11)", en: "Minecraft version (e.g. 1.21.11)" },
    ph_site_id: { ko: "이메일 또는 아이디(닉네임)", en: "Email or ID (nickname)" },
    ph_site_password: { ko: "비밀번호 (8자 이상)", en: "Password (8+ characters)" },
    // 24-169차: 계정 찾기(아이디/비밀번호)
    ph_password_again: { ko: "새 비밀번호 확인", en: "Confirm new password" },
    find_id_link: { ko: "아이디 찾기", en: "Find ID" },
    find_pw_link: { ko: "비밀번호 찾기", en: "Reset password" },
    recover_title: { ko: "계정 찾기", en: "Account Recovery" },
    recover_id_desc: {
      ko: "이 계정에 연동해둔 마인크래프트 계정으로 로그인하면 아이디를 알려드려요.",
      en: "Sign in with the Minecraft account linked to your Nova account and we'll show your ID.",
    },
    recover_pw_desc: {
      ko: "가입할 때 쓴 이메일로 6자리 인증 코드를 보내드려요.",
      en: "We'll email a 6-digit code to the address you signed up with.",
    },
    recover_pw_code_desc: {
      ko: "메일로 받은 6자리 코드와 새 비밀번호를 입력해주세요. 코드는 10분간 유효해요.",
      en: "Enter the 6-digit code from the email and your new password. The code is valid for 10 minutes.",
    },
    recover_send_code: { ko: "인증 코드 받기", en: "Send code" },
    recover_resend_code: { ko: "코드를 못 받았어요 · 다시 보내기", en: "Didn't get it? Send again" },
    recover_pw_submit: { ko: "비밀번호 바꾸기", en: "Change password" },
    ph_reset_code: { ko: "인증 코드 6자리", en: "6-digit code" },
    recover_mc_verify: { ko: "마인크래프트 계정으로 확인", en: "Verify with Minecraft account" },
    profile_account_menu_title: { ko: "계정 메뉴", en: "Account Menu" },
    profile_add_custom_desc: { ko: "버전과 로더를 직접 골라 빈 프로필을 만들어요", en: "Pick a version and loader to create an empty profile" },
    profile_add_custom_name: { ko: "커스텀 프로필", en: "Custom Profile" },
    profile_add_find_modpack_desc: { ko: "Modrinth에서 완성된 모드팩을 검색해서 설치해요", en: "Search and install a finished modpack from Modrinth" },
    profile_add_find_modpack_name: { ko: "모드팩 찾기", en: "Find a Modpack" },
    profile_add_title: { ko: "프로필 추가", en: "Add Profile" },
    profile_add_upload_modpack_desc: { ko: "갖고 있는 .mrpack 파일을 직접 골라서 설치해요", en: "Pick your own .mrpack file to install" },
    profile_add_upload_modpack_name: { ko: "모드팩 업로드", en: "Upload a Modpack" },
    profile_manage_tab_profiles: { ko: "내 프로필", en: "My Profiles" },
    profile_settings_danger_desc: { ko: "이 프로필을 삭제하면 안에 있는 모드/리소스팩도 함께 삭제되고, 되돌릴 수 없어요.", en: "Deleting this profile also deletes the mods/resource packs inside it, and cannot be undone." },
    profile_settings_delete_btn: { ko: "이 프로필 삭제", en: "Delete This Profile" },
    profile_settings_disk_label: { ko: "용량", en: "Storage Used" },
    profile_settings_java_label: { ko: "사용중인 자바", en: "Java in Use" },
    profile_settings_jvmargs_label: { ko: "JVM 인수 (고급)", en: "JVM Arguments (Advanced)" },
    profile_settings_tab_advanced: { ko: "고급", en: "Advanced" },
    profile_settings_tab_danger: { ko: "위험 구역", en: "Danger Zone" },
    profile_settings_tab_run: { ko: "실행", en: "Run" },
    profile_share_blocked_note: { ko: "프리셋으로 만든 프로필은 공유할 수 없어요", en: "Profiles created from a preset can't be shared" },
    profile_share_copy_btn: { ko: "코드 복사", en: "Copy Code" },
    profile_share_hint: { ko: "이 코드를 알려주면 다른 사람이 이 프로필을 그대로 받아갈 수 있어요", en: "Give this code to someone else so they can get an exact copy of this profile" },
    profile_share_loading: { ko: "코드를 만드는 중...", en: "Generating code..." },
    profile_share_title: { ko: "프로필 공유", en: "Share Profile" },
    // 24-100차: 공유 옵션 + 업데이트 알림
    profile_share_loading_info: { ko: "불러오는 중...", en: "Loading..." },
    profile_share_include_title: { ko: "같이 공유할 것", en: "Include" },
    profile_share_opt_files: { ko: "모드 · 리소스팩 · 쉐이더", en: "Mods · Resource Packs · Shaders" },
    profile_share_opt_files_desc: { ko: "항상 포함돼요", en: "Always included" },
    profile_share_opt_modsettings: { ko: "노바 모드 설정", en: "Nova Mod Settings" },
    profile_share_opt_modsettings_desc: { ko: "기능 · HUD 배치", en: "Modules · HUD layout" },
    profile_share_opt_configs: { ko: "모드 설정", en: "Mod settings" },
    profile_share_opt_configs_desc: { ko: "저니맵 · 미니맵 · 소듐 등", en: "JourneyMap · minimap · Sodium etc." },
    profile_share_updates_title: { ko: "업데이트", en: "Updates" },
    profile_share_opt_updates: { ko: "업데이트 공유", en: "Share Updates" },
    profile_share_opt_updates_desc: { ko: "나중에 이 프로필을 수정(추가·삭제)해서 올리면, 이 코드로 받은 사람들에게 업데이트 알림이 가고 각자 따라 업데이트할 수 있어요. 끄면 받은 사람들은 처음 받은 그대로 유지돼요", en: "When you later edit this profile (add/remove) and push it, people who imported this code get an update alert and can follow along. If off, they keep what they first got" },
    profile_share_opt_notify: { ko: "받은 사람들에게 업데이트 알리기", en: "Notify people who got this profile" },
    profile_share_opt_notify_desc: { ko: "이 코드로 받아간 사람들에게 업데이트 알림이 가고, 각자 받을지 골라요. 끄면 새로 받는 사람만 바뀐 구성을 받아요", en: "People who imported this code get an update alert and choose whether to apply it. If off, only new imports get the changes" },
    profile_share_create_btn: { ko: "공유 코드 만들기", en: "Create Share Code" },
    profile_share_push_btn: { ko: "변경 사항 올리기", en: "Push Changes" },
    profile_share_files_count: { ko: "{n}개", en: "{n}" },
    profile_share_none: { ko: "없음", en: "none" },
    profile_share_last: { ko: "마지막으로 올린 때: {when}", en: "Last pushed: {when}" },
    profile_share_pushed_notify: { ko: "변경 사항을 올리고 받은 사람들에게 알렸어요", en: "Pushed changes and notified people who got this profile" },
    profile_share_pushed_silent: { ko: "변경 사항을 올렸어요(알림은 보내지 않음)", en: "Pushed changes (no alert sent)" },
    profile_share_skipped_configs: { ko: "크기 제한으로 빠진 컨피그 파일 {n}개", en: "{n} config files skipped (size limit)" },
    share_update_title: { ko: "\"{name}\" 프로필에 업데이트가 있어요", en: "Update available for \"{name}\"" },
    share_update_sub: { ko: "{author}님이 공유한 구성이 바뀌었어요. 받을지 골라주세요.", en: "{author} changed the shared setup. Choose whether to apply it." },
    share_update_sub_noauthor: { ko: "공유된 구성이 바뀌었어요. 받을지 골라주세요.", en: "The shared setup changed. Choose whether to apply it." },
    share_update_later: { ko: "나중에", en: "Later" },
    share_update_skip: { ko: "이번 건 건너뛰기", en: "Skip This One" },
    share_update_apply: { ko: "업데이트", en: "Update" },
    share_update_added: { ko: "추가", en: "Added" },
    share_update_removed: { ko: "삭제", en: "Removed" },
    share_update_kind_mods: { ko: "모드", en: "Mods" },
    share_update_kind_rp: { ko: "리소스팩", en: "Resource Packs" },
    share_update_kind_shaders: { ko: "쉐이더", en: "Shaders" },
    share_update_modsettings: { ko: "노바 모드 설정이 바뀌어요(내 노바 모드 설정을 덮어써요)", en: "Nova mod settings change (overwrites your Nova mod settings)" },
    share_update_configs: { ko: "모드 컨피그 파일이 바뀌어요(같은 이름의 내 설정 파일을 덮어써요)", en: "Mod config files change (overwrites your files with the same name)" },
    share_update_version: { ko: "마인크래프트 버전: {from} → {to}", en: "Minecraft version: {from} → {to}" },
    share_update_unknown: { ko: "파일 구성이 바뀌었어요(이 프로필은 예전 방식으로 받아서 자세한 변경 내역을 몰라요)", en: "Files changed (this profile was imported the old way, so the exact changes are unknown)" },
    share_update_nothing: { ko: "파일 목록은 그대로고 파일 내용이 바뀌었어요", en: "Same file list, updated contents" },
    share_update_keep_mine: { ko: "내가 직접 넣은 모드는 그대로 남아요", en: "Mods you added yourself are kept" },
    share_update_done: { ko: "\"{name}\" 프로필을 업데이트했어요", en: "Updated \"{name}\"" },
    share_update_skipped: { ko: "이번 업데이트는 건너뛰었어요", en: "Skipped this update" },
    profile_view_mode_default_title: { ko: "기본 보기", en: "Default View" },
    profile_view_mode_gallery_title: { ko: "갤러리 보기 (큰 박스)", en: "Gallery View (Large Icons)" },
    profile_view_mode_group_aria: { ko: "보기 방식", en: "View Mode" },
    profile_view_mode_list_title: { ko: "자세히 보기 (목록)", en: "List View (Detailed)" },
    quest_daily_sub: { ko: "런처로 플레이한 시간 · 출석체크 후 받을 수 있어요", en: "Time played via the launcher · claimable after attendance check-in" },
    quest_daily_title: { ko: "일일 퀘스트", en: "Daily Quests" },
    quest_title: { ko: "퀘스트", en: "Quests" },
    quest_weekly_sub: { ko: "이번 주 누적 플레이 시간", en: "Total time played this week" },
    quest_weekly_title: { ko: "주간 퀘스트", en: "Weekly Quests" },
    reason_other: { ko: "기타", en: "Other" },
    // 24-84차: 번역이 빠져있던 고정 문구들
    settings_nickname_change_label: { ko: "닉네임 변경", en: "Change Nickname" },
    settings_change_avatar_btn: { ko: "프로필 사진 변경", en: "Change Picture" },
    ph_new_nickname: { ko: "새 닉네임", en: "New nickname" },
    btn_change: { ko: "변경", en: "Change" },
    editor_color_letter: { ko: "가", en: "A" },
    // 24-85차: 가입 축하 선물
    welcome_gift_title: { ko: "가입 축하 선물", en: "Welcome Gift" },
    welcome_gift_desc: {
      ko: "가입을 축하드립니다. 테마 1개와 색상 1개를 무료로 선택하실 수 있습니다.",
      en: "Welcome to Nova Client. You may select one theme and one color free of charge.",
    },
    // 24-89차: "이름변경권 지급 메시지 아예 치우라고" - welcome_gift_ticket_note /
    // welcome_gift_ticket_toast 두 키를 삭제했습니다(변경권 지급 자체는 그대로).
    welcome_gift_preview: { ko: "미리보기", en: "Preview" },
    welcome_gift_preview_hint: {
      ko: "선택한 테마와 색상이 실제 메인 화면에 적용된 모습입니다.",
      en: "A preview of your selection applied to the actual main screen.",
    },
    welcome_gift_pick_theme: { ko: "테마 선택", en: "Select a theme" },
    welcome_gift_pick_color: { ko: "색상 선택", en: "Select a color" },
    welcome_gift_later: { ko: "나중에 선택", en: "Later" },
    welcome_gift_claim: { ko: "선택 완료", en: "Confirm" },
    welcome_gift_banner: {
      ko: "아직 수령하지 않은 가입 축하 선물이 있습니다 (테마 1개 + 색상 1개)",
      en: "You have an unclaimed welcome gift (1 theme + 1 color)",
    },
    welcome_gift_banner_btn: { ko: "수령하기", en: "Claim" },
    // 24-89차: 이미 보유한 항목도 목록에 보이므로 그 표시 + 전부 보유했을 때의 코인 대체 안내
    welcome_gift_owned: { ko: "보유 중", en: "Owned" },
    welcome_gift_all_owned_theme: {
      ko: "보유하지 않은 테마가 없어 코인 {coins}개로 지급됩니다.",
      en: "You already own every theme, so {coins} coins will be granted instead.",
    },
    welcome_gift_all_owned_color: {
      ko: "보유하지 않은 색상이 없어 코인 {coins}개로 지급됩니다.",
      en: "You already own every color, so {coins} coins will be granted instead.",
    },
    welcome_gift_coin_item: { ko: "코인 {coins}개", en: "{coins} coins" },
    welcome_gift_done: { ko: "{items} 지급이 완료되었습니다", en: "{items} have been added to your account" },
    welcome_gift_done_plain: { ko: "선물 지급이 완료되었습니다", en: "Your gift has been claimed" },
    welcome_gift_failed: { ko: "선물을 수령하지 못했습니다", en: "The gift could not be claimed" },
    reconnect_ended_text: { ko: "게임이 종료됐어요.", en: "The game has closed." },
    reconnect_now_btn: { ko: "지금 재접속", en: "Reconnect Now" },
    rt_align_center: { ko: "가운데 정렬", en: "Align Center" },
    rt_align_left: { ko: "왼쪽 정렬", en: "Align Left" },
    rt_align_right: { ko: "오른쪽 정렬", en: "Align Right" },
    rt_bold: { ko: "굵게", en: "Bold" },
    rt_emoji: { ko: "스티커(이모지)", en: "Sticker (Emoji)" },
    rt_file: { ko: "파일 첨부", en: "Attach File" },
    rt_font_name_title: { ko: "폰트", en: "Font" },
    rt_font_size_default_opt: { ko: "16px (기본)", en: "16px (Default)" },
    rt_font_size_title: { ko: "글씨 크기", en: "Font Size" },
    rt_font_suit_opt: { ko: "SUIT (기본)", en: "SUIT (Default)" },
    rt_highlight_box: { ko: "강조 박스", en: "Highlight Box" },
    rt_hr: { ko: "구분선", en: "Divider" },
    rt_image: { ko: "사진 삽입", en: "Insert Image" },
    rt_italic: { ko: "기울임", en: "Italic" },
    rt_quote: { ko: "인용구", en: "Quote" },
    rt_strike: { ko: "취소선", en: "Strikethrough" },
    rt_table: { ko: "표 삽입", en: "Insert Table" },
    rt_table_cols_label: { ko: "열", en: "Columns" },
    rt_table_insert_btn: { ko: "삽입", en: "Insert" },
    rt_table_rows_label: { ko: "행", en: "Rows" },
    rt_text_color: { ko: "글자색", en: "Text Color" },
    rt_underline: { ko: "밑줄", en: "Underline" },
    settings_business_info_title: { ko: "사업자 정보", en: "Business Information" },
    settings_checking_calc: { ko: "계산하는 중...", en: "Calculating..." },
    shop_all_items_title: { ko: "전체 상품", en: "All Items" },
    shop_redeem_admin_list_title: { ko: "전체 리딤 코드 목록 (개발자 전용)", en: "All Redeem Codes (Developer Only)" },
    shop_redeem_title: { ko: "리딤 코드", en: "Redeem Code" },
    skin_preview_alt: { ko: "현재 스킨", en: "Current Skin" },
    sort_recent_short: { ko: "최근순", en: "Recent" },
    tb_donate_tooltip: { ko: "후원하기 (준비 중)", en: "Donate (Coming Soon)" },
    tb_fullscreen_tooltip: { ko: "전체화면 (F11)", en: "Fullscreen (F11)" },
    tb_update_available_tooltip: { ko: "새 버전이 있어요 - 눌러서 업데이트", en: "New version available - click to update" },
    terms_agree_start: { ko: "동의하고 시작하기", en: "Agree and Start" },
    terms_checkbox_label: { ko: "위 내용을 모두 확인했으며 동의합니다.", en: "I have reviewed and agree to all of the above." },
    terms_guide_title: { ko: "Nova Client 이용 안내", en: "Nova Client Guide" },
    terms_intro_text: { ko: "Nova Client는 마인크래프트용 비공식 서드파티 런처입니다. Mojang, Microsoft와 아무런 제휴 관계가 없고, 정식으로 구매한 마인크래프트를 더 편하게 즐기시라고 만든 도구예요. 게임 파일은 런처가 따로 갖고 있지 않고, 실행할 때 Mojang 공식 서버에서 바로 내려받습니다.", en: "Nova Client is an unofficial third-party Minecraft launcher. It is not affiliated with Mojang or Microsoft in any way - it is just a tool to make playing your legitimately purchased copy of Minecraft easier. The launcher does not hold any game files itself; it downloads them from Mojang's official servers when you play." },
    terms_li_1: { ko: "Microsoft 계정의 비밀번호는 런처가 볼 수 없고, 로그인 정보는 이 기기에만 저장됩니다. 다만 마인크래프트 계정을 Nova 계정에 연동하거나 아이디를 찾을 때는, 정말 본인 계정이 맞는지 확인하려고 접속 토큰을 Nova 서버로 한 번 보내 Mojang에 확인합니다. 이 토큰은 확인에만 쓰고 저장하지 않아요.", en: "The launcher never sees your Microsoft password, and your sign-in is stored only on this device. When you link a Minecraft account to your Nova account or recover your ID, your access token is sent to the Nova server once so it can ask Mojang whether the account really is yours. The token is used only for that check and is not stored." },
    terms_li_2: { ko: "런처는 마인크래프트 실행에 필요한 자바, 게임 파일, 모드, 리소스팩을 사용자의 PC에 다운로드합니다.", en: "The launcher downloads the Java runtime, game files, mods, and resource packs required to run Minecraft onto your PC." },
    terms_li_3: { ko: "Nova Client는 모드나 리소스팩을 직접 배포하지 않습니다. 콘텐츠 설치 화면에서 고르신 것을 Modrinth에서 그때그때 내려받아 프로필에 넣어드릴 뿐이고, 모든 모드는 각 원저작자의 것이며 각자의 라이선스를 따릅니다.", en: "Nova Client does not distribute mods or resource packs itself. It downloads what you pick in the content browser from Modrinth and drops it into your profile - every mod belongs to its original author and is covered by that author\u0027s own license." },
    terms_li_4: { ko: "개인이 만들어 무료로 배포하는 런처라, 이용 중 생긴 문제에 대해 제작자가 법적인 책임을 지기는 어렵습니다. 대신 문제가 생기면 디스코드로 알려주세요 - 고칠 수 있는 건 최대한 고칩니다.", en: "This is a free launcher made by one person, so the developer cannot take legal responsibility for problems that come up while using it. Please do tell us on Discord if something breaks - we fix what we can." },
    terms_li_account: { ko: "Nova 사이트 계정(이메일/아이디와 비밀번호로 만드는 계정)은 Microsoft 계정과는 별개로, Nova Client와 Nova 사이트(웹)에서 함께 사용하는 자체 계정입니다. 계정 인증과 코인/구매 내역 관리를 위해 자체 서버에 안전하게 저장됩니다.", en: "Your Nova site account (created with an email/ID and password) is separate from your Microsoft account - it's a dedicated account shared by Nova Client and the Nova website, and is stored securely on our own servers for account verification and coin/purchase history." },
    // 24-174차: 결제 전 고지 + 로그 보관 안내
    terms_li_commerce: { ko: "코인과 상점은 지금 실제 결제 없이 무료로만 운영하고 있어요. 나중에 유료 결제를 열게 되면, 그 전에 사업자 정보와 환불 정책을 이 화면에 먼저 표시하고 다시 안내드릴게요.", en: "Coins and the shop currently run without any real payments - everything is free. If paid purchases are ever enabled, we will show business and refund information on this screen and tell you before that happens." },
    terms_li_logs: { ko: "문제가 생겼을 때 원인을 찾으려고 실행 기록(로그)이 이 PC의 Nova Client 폴더에 남습니다. 이 기록은 자동으로 어디에도 전송되지 않고, 문의하실 때 직접 보내주실 때만 저희가 봅니다.", en: "Run logs are kept in the Nova Client folder on this PC so problems can be diagnosed. They are never uploaded anywhere automatically - we only see them if you send them to us yourself." },
    terms_license_title: { ko: "라이선스", en: "License" },
    terms_tab_label: { ko: "이용 안내 및 약관 동의", en: "Terms & Guide" },
    theme_onboarding_desc: { ko: "마음에 드는 테마로 시작해보세요. 다른 테마는 나중에 설정이나 상점에서 언제든 바꿀 수 있어요.", en: "Start with a theme you like. You can always change it later in Settings or the Shop." },
    theme_onboarding_tab_label: { ko: "테마를 골라주세요", en: "Choose a Theme" },
    updates_current_version_title: { ko: "지금 쓰는 버전", en: "Current Version" },
    updates_github_btn: { ko: "깃허브에서 전체 업데이트 기록 보기 ↗", en: "View Full Update History on GitHub ↗" },
    updates_history_title: { ko: "업데이트 내역", en: "Update History" },
  };

  // 지금 적용 중인 언어 ("ko" | "en") - main 프로세스의 resolveEffectiveLanguage()와
  // 같은 규칙(설정이 system이면 OS 언어 판단)을 렌더러 쪽에서도 최대한 따라감
  let currentLang = "ko";

  // 13차: "영어 번역이 상점/보관함/환영합니다/포럼 카테고리 등 여러 군데서 안 먹는다"는
  // 피드백으로 동적으로 만들어지는 문구(이름/개수 등을 끼워넣어야 하는 문구)도 옮길 수 있도록
  // 간단한 {변수} 치환을 지원하는 두 번째 인자(vars)를 추가함
  function t(key, vars) {
    const entry = DICT[key];
    let str = entry ? entry[currentLang] || entry.ko || key : key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
      });
    }
    return str;
  }

  // data-i18n="키" 가 붙은 요소는 textContent를, data-i18n-title="키" 가 붙은 요소는
  // title 속성을, data-i18n-placeholder="키" 가 붙은 요소는(9차 추가) placeholder 속성을
  // 지금 언어로 갱신함
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      el.setAttribute("title", t(key));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.setAttribute("placeholder", t(key));
    });
    // 24-38차: 이미지 alt 속성(스킨 미리보기 등)도 옮길 수 있게 추가
    document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
      const key = el.getAttribute("data-i18n-alt");
      el.setAttribute("alt", t(key));
    });
    // 17차: 사이드바 아이콘의 data-tooltip(CSS의 attr(data-tooltip)로 그려지는 커스텀
    // 툴팁)은 title 속성이 아니라서 위 data-i18n-title로는 못 바꿈 - 전용 속성 추가
    document.querySelectorAll("[data-i18n-tooltip]").forEach((el) => {
      const key = el.getAttribute("data-i18n-tooltip");
      el.setAttribute("data-tooltip", t(key));
    });
    // 24-38차: aria-label(스크린리더용, 닫기/이전/다음 아이콘 버튼 등)도 옮길 수 있게 추가
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria-label");
      el.setAttribute("aria-label", t(key));
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 24-84차 신규: 화면에 실제로 그려진 한국어를 영어로 바꿔주는 자동 번역 레이어
  //
  // "지금 영어가 번역이 안된 부분이 많은 듯 해 조금 더 신경 써주라, 모드 부분에 설치,
  //  메인화면 추가실행 환영합니다 등등 많아"
  //
  // 위의 DICT(키 -> 문장)는 index.html의 고정 문구에는 잘 맞지만, renderer.js가 JS로 만들어
  // 내는 문구(모드 목록의 "설치" 버튼, 토스트, 빈 화면 안내 등)에는 하나하나 키를 붙여야 해서
  // 500곳이 넘습니다. 그래서 gettext처럼 "한국어 원문 자체를 키로" 쓰는 표를 따로 두고,
  // 화면에 붙은 텍스트를 보면서 바꿔주는 방식으로 만들었습니다.
  //   · renderer.js를 건드리지 않아도 되고, 앞으로 새 문구가 생기면 아래 표에만 넣으면 됨
  //   · 표에 없는 문구는 한국어 그대로 남음(빈칸이 되거나 깨지지 않음)
  //   · 한국어로 되돌릴 때는 우리가 바꾼 노드만 기억해뒀다가 정확히 원문으로 복원함
  // ══════════════════════════════════════════════════════════════════════════

  const UI_KO_EN = window.NOVA_UI_KO_EN || {};
  const UI_KO_EN_RE = window.NOVA_UI_KO_EN_RE || [];

  const HANGUL_RE = /[가-힣]/;
  const UI_ATTRS = ["title", "placeholder", "alt", "aria-label", "data-tooltip"];
  // 사용자가 직접 입력하는 칸이나 스크립트/스타일 안은 건드리지 않음
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE"]);

  let uiObserver = null;
  // 우리가 바꾼 것만 기억해뒀다가 한국어로 되돌릴 때 씀(원문 복원이라 추측이 없음)
  const touchedTexts = new Set();
  const touchedEls = new Set();

  // 한국어 원문 -> 영어. 표에 없으면 null(=바꾸지 않음)
  function lookupEn(core) {
    const exact = UI_KO_EN[core];
    if (typeof exact === "string" && exact !== core) return exact;
    for (let i = 0; i < UI_KO_EN_RE.length; i++) {
      const [re, rep] = UI_KO_EN_RE[i];
      // 이름/개수가 끼어드는 문장은 통째로 텍스트 노드 하나가 되므로 정규식으로 맞춤
      re.lastIndex = 0;
      if (re.test(core)) {
        const out = core.replace(re, rep);
        if (out !== core) return out;
      }
    }
    return null;
  }

  // 앞뒤 공백은 그대로 두고 가운데 문구만 바꿈(레이아웃이 붙어버리지 않게)
  function translatedValue(raw) {
    if (!raw || !HANGUL_RE.test(raw)) return null;
    const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2];
    if (!core) return null;
    const en = lookupEn(core);
    return en === null ? null : m[1] + en + m[3];
  }

  function translateTextNode(node) {
    const parent = node.parentNode;
    if (parent && parent.nodeType === 1) {
      if (SKIP_TAGS.has(parent.tagName)) return;
      if (parent.isContentEditable) return;
    }
    const next = translatedValue(node.nodeValue);
    if (next === null) return;
    node.__i18nKo = node.nodeValue;
    node.__i18nEn = next;
    node.nodeValue = next;
    touchedTexts.add(node);
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    for (let i = 0; i < UI_ATTRS.length; i++) {
      const name = UI_ATTRS[i];
      const raw = el.getAttribute(name);
      if (!raw) continue;
      const next = translatedValue(raw);
      if (next === null) continue;
      el.__i18nAttrKo = el.__i18nAttrKo || {};
      el.__i18nAttrEn = el.__i18nAttrEn || {};
      el.__i18nAttrKo[name] = raw;
      el.__i18nAttrEn[name] = next;
      el.setAttribute(name, next);
      touchedEls.add(el);
    }
  }

  function translateTree(root) {
    if (currentLang !== "en" || !root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    translateAttrs(root);
    const els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (let i = 0; i < els.length; i++) translateAttrs(els[i]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (let i = 0; i < texts.length; i++) translateTextNode(texts[i]);
  }

  // 되돌릴 때: 우리가 써넣은 영어가 아직 그대로일 때만 원래 한국어로 복원
  // (그 사이에 화면이 다시 그려졌으면 이미 새 내용이라 건드리면 안 됨)
  function restoreKorean() {
    touchedTexts.forEach((node) => {
      if (node.nodeValue === node.__i18nEn) node.nodeValue = node.__i18nKo;
    });
    touchedTexts.clear();
    touchedEls.forEach((el) => {
      const ko = el.__i18nAttrKo || {};
      const en = el.__i18nAttrEn || {};
      Object.keys(ko).forEach((name) => {
        if (el.getAttribute(name) === en[name]) el.setAttribute(name, ko[name]);
      });
    });
    touchedEls.clear();
  }

  // 화면이 새로 그려질 때마다(모드 목록, 토스트 등) 새로 붙은 부분만 번역함.
  // 우리가 바꾼 값은 더 이상 한국어가 아니라서 다시 매칭되지 않으므로 무한 반복이 아닙니다.
  function startUiObserver() {
    if (uiObserver || typeof MutationObserver === "undefined" || !document.body) return;
    uiObserver = new MutationObserver((records) => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type === "childList") {
          for (let j = 0; j < r.addedNodes.length; j++) translateTree(r.addedNodes[j]);
        } else if (r.type === "characterData") {
          translateTextNode(r.target);
        } else if (r.type === "attributes") {
          translateAttrs(r.target);
        }
      }
      // 영어로 쓰는 동안 목록을 계속 새로 그리면 떨어져 나간 노드가 쌓일 수 있어서 가끔 정리
      if (touchedTexts.size > 20000) {
        touchedTexts.forEach((n) => {
          if (!n.isConnected) touchedTexts.delete(n);
        });
      }
    });
    uiObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: UI_ATTRS,
    });
  }

  function stopUiObserver() {
    if (!uiObserver) return;
    uiObserver.disconnect();
    uiObserver = null;
  }

  function applyUiLanguage() {
    if (currentLang === "en") {
      translateTree(document.body);
      startUiObserver();
    } else {
      stopUiObserver();
      restoreKorean();
    }
  }

  async function initI18n() {
    try {
      currentLang = (await window.nova?.getEffectiveLanguage?.()) || "ko";
    } catch (_) {
      currentLang = "ko";
    }
    applyI18n();
    applyUiLanguage();
  }

  function setLang(lang) {
    currentLang = lang === "en" ? "en" : "ko";
    applyI18n();
    applyUiLanguage();
  }

  window.NovaI18n = {
    t,
    applyI18n,
    initI18n,
    setLang,
    getLang: () => currentLang,
    // 표에 없는 문구를 찾을 때 쓰라고 열어둠(개발자 콘솔에서 확인용)
    translateTree,
  };
})();
