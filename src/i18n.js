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
    sidebar_explore: { ko: "컨텐츠 설치", en: "Install Content" },
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
    // 17차 신규: 규칙 기반 AI 진단 도우미 진입점
    settings_help_title: { ko: "도움말", en: "Help" },
    settings_ai_assistant: { ko: "AI 진단 도우미", en: "AI Troubleshooter" },
    settings_community: { ko: "커뮤니티 · 정보", en: "Community · About" },
    // 24-31차: "루나 디스코드 > 디스코드로 바꾸고" - 표시 문구만 짧게 줄임(id/링크는 그대로)
    settings_luna_discord: { ko: "디스코드", en: "Discord" },
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
    ph_preset_name: { ko: "예: 오늘의 PVP 세팅", en: "e.g. Today's PVP setup" },
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
    // 20차: "컨텐츠 설치는 친구창 위치에 친구창 대신 프로필 리스트로 교체" - 그 자리에 뜨는
    // 제목
    explore_profile_list_title: { ko: "설치할 프로필", en: "Install to profile" },

    versions_make_by_preset: { ko: "프리셋으로 만들기", en: "Create from Preset" },
    versions_import_by_code: { ko: "공유 코드로 불러오기", en: "Import via Share Code" },
    btn_import: { ko: "불러오기", en: "Import" },
    btn_back_to_list: { ko: "← 목록으로", en: "← Back to List" },
    btn_back_to_preset_list: { ko: "← 프리셋 목록으로", en: "← Back to Presets" },
    btn_back_to_version_list: { ko: "← 버전 목록으로", en: "← Back to Versions" },
    preset_browse_default_title: { ko: "프리셋", en: "Presets" },
    preset_browse_version_default_title: { ko: "버전을 골라주세요", en: "Choose a version" },
    preset_browse_version_title: { ko: "\"{name}\" - 버전을 골라주세요", en: "\"{name}\" - Choose a version" },
    preset_version_original: { ko: "원본 버전", en: "Original version" },
    preset_version_generated: { ko: "자동 생성됨", en: "Auto-generated" },
    preset_browse_category_count: { ko: "{count}개 프리셋", en: "{count} preset(s)" },
    preset_browse_list_title: { ko: "{category} 프리셋", en: "{category} Presets" },
    preset_browse_empty: { ko: "이 카테고리에는 아직 프리셋이 없어요. 프리셋 관리 화면에서 먼저 만들어주세요.", en: "No presets in this category yet. Create one in the preset manager first." },
    preset_browse_none: { ko: "아직 프리셋 없음", en: "No preset yet" },
    preset_preselect_note: { ko: "\"{name}\" 프리셋({category}) · {version} 버전으로 만들어요", en: "Using preset \"{name}\" ({category}) · version {version}" },
    preset_none_for_version: { ko: "이 버전에 맞는 프리셋이 없어요", en: "No presets available for this version" },
    create_profile_title: { ko: "새 프로필 만들기 ({version})", en: "New Profile ({version})" },
    create_profile_name_label: { ko: "프로필 이름", en: "Profile Name" },
    create_profile_memory_label: { ko: "메모리 할당", en: "Memory Allocation" },
    create_profile_resolution_label: { ko: "실행 해상도", en: "Launch Resolution" },
    create_profile_fullscreen_label: { ko: "전체화면으로 시작", en: "Start in Fullscreen" },
    create_profile_jvmargs_label: { ko: "JVM 인수 (고급, 선택)", en: "JVM Arguments (advanced, optional)" },
    create_profile_use_preset_label: { ko: "프리셋 이용하기", en: "Use a Preset" },
    create_profile_preset_picker_label: { ko: "프리셋 선택", en: "Choose a Preset" },
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
    hero_goto_preset_btn: { ko: "프리셋 관리에서 이 구성으로 만들기", en: "Create Preset from This Setup" },
    hero_open_folder_btn: { ko: "폴더 열기", en: "Open Folder" },
    hero_share_code_btn: { ko: "프로필 코드 공유", en: "Share Profile Code" },
    hero_shortcut_btn: { ko: "바로가기 만들기", en: "Create Shortcut" },
    // 24-61차 신규: 친구 목록 줄 우클릭 컨텍스트 메뉴 항목
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
    manage_file_upload_label: { ko: "파일 업로드", en: "Upload File" },
    manage_mods_browse_btn: { ko: "모드 추가", en: "Add Mods" },
    manage_profile_default_badge: { ko: "기본 프로필 · 삭제 불가", en: "Default Profile · Cannot Delete" },
    manage_profile_icon_edit_title: { ko: "아이콘 바꾸기", en: "Change Icon" },
    manage_profile_icon_remove_title: { ko: "기본 아이콘으로", en: "Reset to Default Icon" },
    manage_refresh_share_btn: { ko: "프로필 갱신", en: "Refresh Profile" },
    manage_refresh_share_title: { ko: "공유 코드에 지금 구성 다시 올리기", en: "Push current setup to the share code" },
    manage_rp_browse_btn: { ko: "리소스팩 추가", en: "Add Resource Packs" },
    manage_shader_browse_btn: { ko: "쉐이더팩 추가", en: "Add Shaders" },
    manage_tab_all: { ko: "전체", en: "All" },
    manage_tab_mods: { ko: "모드", en: "Mods" },
    manage_tab_rp: { ko: "리소스팩", en: "Resource Packs" },
    manage_tab_shaders: { ko: "쉐이더팩", en: "Shader Packs" },
    manage_update_all: { ko: "전체 업데이트", en: "Update All" },
    manage_update_all_hint_title: { ko: "업데이트 가능한 모드를 한 번에 반영", en: "Apply all available mod updates at once" },
    manage_updatesync_label: { ko: "업데이트 연동", en: "Update Sync" },
    manage_updatesync_title: { ko: "원작자가 프로필을 갱신하면 자동으로 받아올지", en: "Whether to auto-receive updates when the original author updates this profile" },
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
    ph_site_id: { ko: "이메일 또는 아이디(닉네임)", en: "Email or ID (nickname)" },
    ph_site_password: { ko: "비밀번호 (8자 이상)", en: "Password (8+ characters)" },
    preset_create_name_label: { ko: "프리셋 이름", en: "Preset Name" },
    preset_create_rp_label: { ko: "리소스팩 기본 포함", en: "Include Resource Packs by Default" },
    preset_create_shader_label: { ko: "쉐이더 기본 포함", en: "Include Shaders by Default" },
    preset_create_source_label: { ko: "어느 프로필의 구성을 쓸까요?", en: "Use which profile's setup?" },
    preset_create_submit_btn: { ko: "프리셋 만들기", en: "Create Preset" },
    preset_create_title: { ko: "새 프리셋 만들기", en: "Create a New Preset" },
    preset_my_list_title: { ko: "내 프리셋", en: "My Presets" },
    profile_account_menu_title: { ko: "계정 메뉴", en: "Account Menu" },
    profile_add_custom_desc: { ko: "버전과 로더를 직접 골라 빈 프로필을 만들어요", en: "Pick a version and loader to create an empty profile" },
    profile_add_custom_name: { ko: "커스텀 프로필", en: "Custom Profile" },
    profile_add_find_modpack_desc: { ko: "Modrinth에서 완성된 모드팩을 검색해서 설치해요", en: "Search and install a finished modpack from Modrinth" },
    profile_add_find_modpack_name: { ko: "모드팩 찾기", en: "Find a Modpack" },
    profile_add_title: { ko: "프로필 추가", en: "Add Profile" },
    profile_add_upload_modpack_desc: { ko: "갖고 있는 .mrpack 파일을 직접 골라서 설치해요", en: "Pick your own .mrpack file to install" },
    profile_add_upload_modpack_name: { ko: "모드팩 업로드", en: "Upload a Modpack" },
    profile_manage_tab_presets: { ko: "프리셋 관리", en: "Manage Presets" },
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
    terms_intro_text: { ko: "Nova Client는 마인크래프트용 비공식 서드파티 런처입니다. Mojang, Microsoft 와 직접적인 제휴 관계가 없으며, 마인크래프트 정식 실행을 돕기 위한 도구입니다.", en: "Nova Client is an unofficial third-party launcher for Minecraft. It has no direct affiliation with Mojang or Microsoft, and is a tool to help you run the official Minecraft client." },
    terms_li_1: { ko: "로그인 시 사용하는 Microsoft 계정 인증 정보는 이 기기에만 저장되며, 외부 서버로 전송되지 않습니다.", en: "Microsoft account credentials used to log in are stored only on this device and are never sent to any external server." },
    terms_li_2: { ko: "런처는 마인크래프트 실행에 필요한 자바, 게임 파일, 모드, 리소스팩을 사용자의 PC에 다운로드합니다.", en: "The launcher downloads the Java runtime, game files, mods, and resource packs required to run Minecraft onto your PC." },
    terms_li_3: { ko: "제공되는 모드/리소스팩은 각 원저작자의 라이선스를 따르며, 이 클라이언트는 배포 편의를 위한 묶음일 뿐입니다.", en: "Bundled mods/resource packs follow their original authors' licenses - this client is just a convenient bundle for distribution." },
    terms_li_4: { ko: "클라이언트 이용 중 발생하는 문제에 대해 제작자는 책임을 지지 않으며, 문제 발생 시 디스코드로 문의해주세요.", en: "The developer is not responsible for issues that occur while using the client - please reach out on Discord if something goes wrong." },
    terms_li_account: { ko: "Nova 사이트 계정(이메일/아이디와 비밀번호로 만드는 계정)은 Microsoft 계정과는 별개로, Nova Client와 Nova 사이트(웹)에서 함께 사용하는 자체 계정입니다. 계정 인증과 코인/구매 내역 관리를 위해 자체 서버에 안전하게 저장됩니다.", en: "Your Nova site account (created with an email/ID and password) is separate from your Microsoft account - it's a dedicated account shared by Nova Client and the Nova website, and is stored securely on our own servers for account verification and coin/purchase history." },
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

  async function initI18n() {
    try {
      currentLang = (await window.luna?.getEffectiveLanguage?.()) || "ko";
    } catch (_) {
      currentLang = "ko";
    }
    applyI18n();
  }

  function setLang(lang) {
    currentLang = lang === "en" ? "en" : "ko";
    applyI18n();
  }

  window.NovaI18n = { t, applyI18n, initI18n, setLang, getLang: () => currentLang };
})();
