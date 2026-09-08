-- Nova Client — 포럼 조회수 + 말머리(태그) 기능용 Supabase 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.

alter table public.forum_posts
  add column if not exists view_count integer not null default 0;

alter table public.forum_posts
  add column if not exists tag text; -- 말머리(선택), 예: "PVP", "건의사항" 등 - 안 고르면 null

create index if not exists forum_posts_tag_idx on public.forum_posts (tag);

-- 도배 방지(1분에 1개)용으로 작성자별 최근 글 작성 시각을 빨리 찾기 위한 인덱스
create index if not exists forum_posts_author_created_idx on public.forum_posts (author_uuid, created_at desc);
