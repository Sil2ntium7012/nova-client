-- Nova Client — 친구 상태표시/귓속말/자기소개 기능용 Supabase 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- (이전에 보내드린 2026-08-18_friends_and_profile_share.sql 을 먼저 실행하셨어야 friends 테이블이 있어요)

-- ============================================================
-- 1) user_profiles에 상태 문구 / 자기소개 컬럼 추가
-- ============================================================
alter table public.user_profiles
  add column if not exists status_text text;

alter table public.user_profiles
  add column if not exists bio text;


-- ============================================================
-- 2) 귓속말: whispers 테이블 신규 생성
-- ============================================================
create table if not exists public.whispers (
  id uuid primary key default gen_random_uuid(),
  sender_uuid uuid not null,
  sender_name text not null,
  receiver_uuid uuid not null,
  receiver_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists whispers_sender_idx on public.whispers (sender_uuid);
create index if not exists whispers_receiver_idx on public.whispers (receiver_uuid);
create index if not exists whispers_pair_time_idx on public.whispers (least(sender_uuid, receiver_uuid), greatest(sender_uuid, receiver_uuid), created_at);

alter table public.whispers enable row level security;

-- 다른 테이블들과 동일하게 anon 역할로 열어둠 (앱이 Supabase Auth 없이 anon 키만 씀)
drop policy if exists "whispers_select_anon" on public.whispers;
create policy "whispers_select_anon" on public.whispers
  for select to anon using (true);

drop policy if exists "whispers_insert_anon" on public.whispers;
create policy "whispers_insert_anon" on public.whispers
  for insert to anon with check (true);
