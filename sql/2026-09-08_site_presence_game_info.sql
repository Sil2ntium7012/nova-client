-- Nova Client — site_presence에 "지금 어디서 뭘 하고 있는지" 컬럼 3개 추가
-- Supabase 대시보드 > SQL Editor에서 실행해주세요.
--
-- 배경(24-67차): "친구가 지금 어느 서버에 있는지 게임 안(모드)/런처 양쪽에서 보이면 좋겠다"는
-- 이전 라운드(49-27차, Nova-Mod)에서 미리 설계해둔 기능 - 모드의 소셜 화면(NovaSocialScreen)이
-- 친구 목록을 보여줄 때 site_presence에서 이 3개 컬럼을 같이 읽어(select=* 이라 컬럼이 없어도
-- 안전하게 동작하긴 하지만, 이 SQL을 실행해야 실제 값이 채워짐) 접속 서버/닉네임을 표시함.
-- 이번 라운드에서 런처(main.js)가 게임이 켜져 있는 동안 이 컬럼들을 주기적으로 채우도록
-- 구현했으니, 실제로 값이 들어오려면 이 마이그레이션이 먼저 실행돼야 함.
--
--   server_address: 접속한 서버 주소 (예: "hellosunlit.kro.kr:25565")
--   server_name   : 사람이 보는 서버 이름 (예: "하이의 놀이터") - 서버 모드로 켰을 때만 채워짐
--   mc_name       : 그 세션에서 실제로 쓴 마인크래프트 계정 이름
--
-- 기존 friends:heartbeat가 쓰는 status_text/status_kind/status_ref/status_version과는
-- 별개 컬럼이라 서로 덮어쓰지 않습니다.
alter table public.site_presence
  add column if not exists server_address text,
  add column if not exists server_name text,
  add column if not exists mc_name text;
