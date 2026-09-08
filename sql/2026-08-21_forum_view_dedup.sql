-- Nova Client — 포럼 게시글 조회수 중복 방지 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- (계정당 게시글 조회수가 1회만 올라가도록, 이미 조회한 기록을 저장하는 테이블)

create table if not exists public.forum_post_views (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  viewer_uuid text not null,
  viewed_at timestamptz not null default now(),
  primary key (post_id, viewer_uuid)
);

create index if not exists forum_post_views_viewer_idx on public.forum_post_views (viewer_uuid);

-- RLS를 켜둔 프로젝트라면 익명 키로 읽기/쓰기가 가능하도록 정책을 열어주세요.
alter table public.forum_post_views enable row level security;

drop policy if exists "forum_post_views_select" on public.forum_post_views;
create policy "forum_post_views_select" on public.forum_post_views
  for select using (true);

drop policy if exists "forum_post_views_insert" on public.forum_post_views;
create policy "forum_post_views_insert" on public.forum_post_views
  for insert with check (true);
