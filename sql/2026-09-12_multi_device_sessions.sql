-- 24-79차: 여러 기기 동시 로그인 허용
--
-- 배경
--   지금까지 런처 세션은 nova_accounts 테이블의 active_session_token 컬럼 "하나"에만 저장됐습니다.
--   로그인할 때마다 그 컬럼을 새 토큰으로 덮어쓰기 때문에, 구조적으로 한 계정에 세션이 하나뿐이고
--   새 기기에서 로그인하면 먼저 쓰던 기기는 토큰이 달라져서 끊겼습니다("한 곳에서만 로그인").
--
--   이제 세션을 이 별도 테이블에 "기기당 한 행"으로 저장합니다. 로그인은 행을 하나 INSERT 할 뿐
--   다른 행을 건드리지 않으므로, 데스크톱/노트북 등에서 동시에 로그인한 채로 쓸 수 있습니다.
--   (로그인이 INSERT 하나라서 동시에 로그인해도 서로 덮어쓰는 경합이 없습니다.)
--
-- 실행 순서 ⚠️
--   1) 이 SQL을 Supabase SQL Editor에서 먼저 실행하세요.
--   2) 그 다음에 Nova Site를 배포하세요.
--   순서가 바뀌면(테이블 없이 새 코드가 먼저 뜨면) 로그인이 실패합니다.
--   여러 번 실행해도 안전합니다(전부 if not exists / on conflict do nothing).

-- ── 1) 세션 테이블 ──────────────────────────────────────────────────────────
-- account_id를 text로 둔 이유: nova_accounts.id가 uuid든 무엇이든 항상 문자열로 비교하게 해서
-- 타입이 어긋날 여지를 없애기 위함입니다(서버 코드도 String(accountId)로 넘깁니다).
create table if not exists public.nova_account_sessions (
  token        text primary key,
  account_id   text not null,
  device       text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists nova_account_sessions_account_idx
  on public.nova_account_sessions (account_id);

create index if not exists nova_account_sessions_last_seen_idx
  on public.nova_account_sessions (account_id, last_seen_at desc);

-- ── 2) RLS ────────────────────────────────────────────────────────────────
-- 이 테이블은 서버(service_role 키를 쓰는 Nova Site API)만 접근합니다. RLS를 켜두고 정책을
-- 하나도 만들지 않으면 anon/authenticated 키로는 아무것도 못 읽고 못 씁니다(service_role은
-- RLS를 우회하므로 서버 코드는 그대로 동작합니다).
alter table public.nova_account_sessions enable row level security;

-- ── 3) 기존 로그인 이어받기(백필) ───────────────────────────────────────────
-- 지금 로그인해 있는 사람들이 배포 직후 한꺼번에 로그아웃되지 않도록, 현재 active_session_token을
-- 그대로 세션 테이블로 옮겨 적습니다.
insert into public.nova_account_sessions (token, account_id, device, created_at, last_seen_at)
select
  a.active_session_token,
  a.id::text,
  a.active_session_device,
  coalesce(a.active_session_started_at, now()),
  coalesce(a.active_session_heartbeat_at, now())
from public.nova_accounts a
where a.active_session_token is not null
  and a.active_session_token <> ''
on conflict (token) do nothing;

-- ── 참고 ──────────────────────────────────────────────────────────────────
-- nova_accounts의 active_session_* 컬럼은 지우지 않았습니다. 이제 인증 판단에는 쓰이지 않지만
-- "가장 최근에 로그인한 기기"를 보여주는 표시용으로 계속 갱신되고, 혹시 이 컬럼을 읽는 다른
-- 코드가 있어도 깨지지 않게 하기 위해 남겨둡니다.
--
-- 되돌리려면: Nova Site를 이전 버전으로 배포하면 됩니다(이 테이블이 남아 있어도 예전 코드는
-- active_session_token만 보므로 그대로 동작합니다). 테이블까지 지우려면:
--   drop table if exists public.nova_account_sessions;
