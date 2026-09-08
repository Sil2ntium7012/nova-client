-- 24-4차: "클라이언트도 사이트처럼 전용 계정 로그인통해서 하게 할 거고 마크 계정
-- 등록하게 해줘 마크 계정 등록 안하면 게스트로 판단하고 계정에서 스킨 등을 구매하면
-- 등록한 마크 계정 모두가 사용할 수 있는 시스템으로 하고 클라이언트는 한 곳에서만
-- 로그인할 수 있게 해줘 여러 곳에서 동시 로그인이 안되게" - Phase 2
--
-- 24차 Phase 1(site_accounts / site_account_links)에 로그인 정보(아이디/비번)와
-- "지금 이 계정이 어느 기기에 로그인해있는지"를 나타내는 세션 정보, 그리고 연동된
-- 마인크래프트 계정들이 공유해서 쓸 코인/상점/출석/퀘스트 데이터(shared_player_data)를
-- 추가함. 이 파일을 실행하기 전에 sql/2026-08-27_site_accounts.sql 이 먼저 실행돼서
-- site_accounts/site_account_links 테이블이 있어야 함.
--
-- * 보안 주의 *: 이 프로젝트는 모든 테이블의 RLS를 열어둔 상태(anon key만으로 전체
-- read/write 허용)라서, 여기서 추가하는 password_hash(비밀번호 해시)나
-- active_session_token(세션 토큰)도 "클라이언트 코드가 그 규칙을 지킬 때만" 의미가 있는
-- 보호일 뿐 DB 자체가 막아주는 건 아님. main.js 쪽에도 같은 주석을 크게 남겨둠 - 실제
-- 서비스에서 쓰는 비밀번호는 여기 재사용하지 않도록 클라이언트 화면에서 안내함.

alter table public.site_accounts
  add column if not exists login_id text,
  add column if not exists password_hash text,
  add column if not exists active_session_token text,
  add column if not exists active_session_device text,
  add column if not exists active_session_started_at timestamptz,
  add column if not exists active_session_heartbeat_at timestamptz,
  add column if not exists shared_player_data jsonb not null default '{}'::jsonb;

-- 로그인 아이디는 있을 때만 유일해야 함(대소문자 구분 없이) - 24차 Phase 1 때 만들어진
-- site_accounts 행들(마이그레이션 이전, login_id가 비어있는 행)은 이 제약에서 제외됨
create unique index if not exists site_accounts_login_id_unique_idx
  on public.site_accounts (lower(login_id))
  where login_id is not null;

-- RLS는 site_accounts/site_account_links 둘 다 24차 Phase 1에서 이미 열어뒀으므로(using
-- (true) with check(true)) 여기서 새로 만질 건 없음 - 위 보안 주의 참고
