-- ============================================================================
-- site_presence: "자리 비움" 컬럼 1개 추가 (49-201차)
--   Nova-Mod의 [자리 비움] 기능이 켜져 있고 한참 가만히 있으면 .nova-presence.json에 afk=true를 쓰고,
--   런처가 그 값을 game_afk로 올립니다. 같은 서버에 있는 노바 유저는 탭리스트와 머리 위 이름 뒤에
--   회색 "Zzz"로 그 사람이 자리 비움인 걸 봅니다.
--   Supabase > SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다(if not exists).
--
--   실행 전에도 런처는 망가지지 않습니다 - 컬럼이 없어서 올리기가 실패하면 game_afk만 빼고 다시 올리고,
--   그 뒤로는 이 값을 안 보냅니다(런처를 다시 켜면 다시 시도).
--
-- 누가 쓰는가
--   쓰기: 런처 main.js  startPresenceUpload() → uploadGamePresenceInfo({ ..., game_afk })
--   읽기: Nova-Mod  NovaSocial.pollServerBadges()  GET /site_presence?...&select=*
-- ============================================================================

alter table public.site_presence
  add column if not exists game_afk boolean not null default false;

comment on column public.site_presence.game_afk is
  '게임 안에서 자리 비움(Nova-Mod [자리 비움] 기능이 판단). 같은 서버의 노바 유저에게 Zzz로 보임. 게임을 끄면 false.';

-- 확인용: 아래를 실행해서 한 줄이 나오면 정상입니다.
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'site_presence'
--    and column_name = 'game_afk';
