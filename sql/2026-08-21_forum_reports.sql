-- Nova Client — 게시글 신고 기능용 Supabase 마이그레이션 (4차 라운드, 3-2)
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- 기존 마이그레이션 파일은 건드리지 않고 새 파일로 추가함.

create table if not exists public.forum_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  post_title text not null default '',
  reporter_uuid text not null,
  reporter_name text not null default '',
  reason text not null,           -- 스팸 / 욕설_비방 / 도배 / 부적절한_내용 / 기타
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists forum_reports_post_idx on public.forum_reports (post_id);
create index if not exists forum_reports_created_idx on public.forum_reports (created_at desc);

-- RLS: 신고 등록은 누구나(로그인 사용자) 가능해야 하고, 조회는 앱단(main.js)에서
-- isAdmin 체크 후에만 IPC를 통해 호출되므로 select도 열어둠 (다른 테이블들과 동일한 패턴).
alter table public.forum_reports enable row level security;

drop policy if exists "forum_reports_select" on public.forum_reports;
create policy "forum_reports_select" on public.forum_reports
  for select using (true);

drop policy if exists "forum_reports_insert" on public.forum_reports;
create policy "forum_reports_insert" on public.forum_reports
  for insert with check (true);
