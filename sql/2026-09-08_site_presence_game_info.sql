-- ============================================================================
-- site_presence: "지금 어느 서버에서 뭘 하고 있는지" 컬럼 3개 추가
--   24-67차에서 런처가(그리고 49-27차부터 Nova-Mod가) 올리기 시작한 값인데,
--   테이블에 컬럼이 없으면 upsert가 400으로 실패해서 친구 목록의 [참가]가
--   영원히 안 뜹니다. Supabase > SQL Editor 에 통째로 붙여넣고 실행하세요.
--   여러 번 실행해도 안전합니다(if not exists).
--
-- 누가 쓰는가
--   쓰기: 런처 main.js  uploadGamePresenceInfo()  - 게임이 켜져 있는 동안 20초마다
--         POST /site_presence  (Prefer: resolution=merge-duplicates)
--         { nova_account_id, nickname, updated_at, server_address, server_name, mc_name }
--   읽기: 런처 renderer 친구 목록, 그리고 Nova-Mod 인게임 소셜 화면
--         GET /site_presence?nova_account_id=in.(...)&select=*
--
-- 값의 출처
--   서버 모드로 켜면 런처가 아는 주소/이름이 즉시 올라가고, 그 뒤로는 게임 폴더의
--   .nova-presence.json(모드가 20초마다 갱신)을 읽어 덮어씁니다 - 자유 플레이로 켠 뒤
--   인게임에서 직접 다른 서버로 들어간 경우까지 반영하려고.
--   싱글플레이면 server_address는 빈 값(친구가 참가할 수 없으므로).
-- ============================================================================

alter table public.site_presence
  add column if not exists server_address text,   -- "host:port" (싱글이면 null/빈 문자열)
  add column if not exists server_name    text,   -- 사람이 읽는 서버 이름(없으면 null)
  add column if not exists mc_name        text;   -- 그 사람이 지금 쓰는 마인크래프트 닉네임

comment on column public.site_presence.server_address is
  '지금 접속 중인 마인크래프트 서버 host:port. 친구 목록의 [참가]가 이 값을 씀. 싱글/오프라인이면 비움.';
comment on column public.site_presence.server_name is
  '지금 접속 중인 서버의 표시 이름. 런처에 등록된 서버면 그 이름, 아니면 인게임 서버 목록의 이름.';
comment on column public.site_presence.mc_name is
  '지금 로그인해서 쓰는 마인크래프트 닉네임(노바 계정 닉네임과 다를 수 있음). 귓속말 대상 이름으로 씀.';

-- 게임을 껐을 때 런처가 이 세 값을 null로 비웁니다(온라인 여부 자체는 updated_at으로 판단).
-- 런처가 비우지 못하고 죽은 경우를 대비해, 읽는 쪽에서도 updated_at이 오래된 행은
-- offline로 보고 서버 정보를 무시합니다(런처 90초/5분, 모드도 동일한 창).

-- 확인용: 아래를 실행해서 세 줄이 나오면 정상입니다.
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'site_presence'
--    and column_name in ('server_address', 'server_name', 'mc_name')
--  order by column_name;
