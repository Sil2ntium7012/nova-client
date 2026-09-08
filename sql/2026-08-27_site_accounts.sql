-- 24차: "계정 시스템을 바꿀 거야 마크 계정별 활동이 아니라 우리 사이트 전용 계정을 새로
-- 만들어서 그 계정에 마크계정을 모두 연결하고 디스코드도 연결하는 식으로" - Phase 1 (연동 뼈대만)
--
-- 지금 포럼/코인/친구/출석/상점 등 백엔드 전체가 마인크래프트 uuid로 키가 잡혀있어서,
-- 그걸 전부 "사이트 계정" 기준으로 바꾸는 건 이번 한 번에 하기엔 너무 크고 위험함
-- (라이브 DB 접근/테스트 없이 한 번에 바꾸면 잘못됐을 때 되돌리기 어려움).
-- 그래서 이번엔 "site_accounts"(사이트 전용 계정)와 "site_account_links"(그 계정에 연결된
-- 마인크래프트 계정들/디스코드)만 먼저 만들어서 연동 뼈대를 깔아두고, 기존 시스템은 지금처럼
-- 계속 마크 uuid 기준으로 동작함. 나중에 여기(site_account_links)를 이용해서 포럼/코인 등을
-- "같은 사이트 계정의 여러 마크 계정을 하나로 묶어서 보여주기" 식으로 점진적으로 옮길 수 있음.

create table if not exists public.site_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  display_name text
);

create table if not exists public.site_account_links (
  id uuid primary key default gen_random_uuid(),
  site_account_id uuid not null references public.site_accounts(id) on delete cascade,
  provider text not null check (provider in ('minecraft', 'discord')),
  provider_uid text not null,
  provider_name text,
  linked_at timestamptz not null default now(),
  unique (provider, provider_uid)
);

create index if not exists site_account_links_site_account_id_idx
  on public.site_account_links (site_account_id);

-- 권한 체크는 지금처럼 main.js 쪽(IPC 핸들러)에서 처리하고, 다른 테이블들과 동일한 패턴으로
-- RLS는 열어둠(select/insert/update/delete 전부 허용)
alter table public.site_accounts enable row level security;
alter table public.site_account_links enable row level security;

drop policy if exists "site_accounts_all" on public.site_accounts;
create policy "site_accounts_all" on public.site_accounts
  for all using (true) with check (true);

drop policy if exists "site_account_links_all" on public.site_account_links;
create policy "site_account_links_all" on public.site_account_links
  for all using (true) with check (true);
