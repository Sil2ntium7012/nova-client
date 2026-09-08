-- Nova Client — 포럼 글 고정(핀) 기능용 Supabase 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.

alter table public.forum_posts
  add column if not exists pinned boolean not null default false;

alter table public.forum_posts
  add column if not exists pinned_at timestamptz;

create index if not exists forum_posts_pinned_idx on public.forum_posts (pinned, pinned_at);
