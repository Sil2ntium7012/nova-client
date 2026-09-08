-- Nova Client — 24-45차: 답글(댓글) 시스템 개편 (좋아요 / 사진 첨부 / 신고)
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- 기존 마이그레이션 파일은 건드리지 않고 새 파일로 추가함.

-- 1) 답글에 사진 첨부 가능하게 (기존 forum_posts.image_url과 같은 패턴)
alter table public.forum_replies
  add column if not exists image_url text;

-- 2) 답글 좋아요 - 게시글의 forum_likes/like_count와 완전히 같은 패턴을 답글에도 적용
alter table public.forum_replies
  add column if not exists like_count integer not null default 0;

create table if not exists public.forum_reply_likes (
  id uuid primary key default gen_random_uuid(),
  reply_id uuid not null references public.forum_replies(id) on delete cascade,
  author_uuid text not null,
  created_at timestamptz not null default now(),
  unique (reply_id, author_uuid)
);
create index if not exists forum_reply_likes_reply_idx on public.forum_reply_likes (reply_id);

alter table public.forum_reply_likes enable row level security;
drop policy if exists "forum_reply_likes_read_all" on public.forum_reply_likes;
create policy "forum_reply_likes_read_all" on public.forum_reply_likes
  for select using (true);
drop policy if exists "forum_reply_likes_write_all" on public.forum_reply_likes;
create policy "forum_reply_likes_write_all" on public.forum_reply_likes
  for all using (true) with check (true);

-- 3) 답글도 신고할 수 있게 (기존엔 게시글만 신고 가능했음)
--    reply_id가 null이면 기존처럼 "게시글 신고", 값이 있으면 "답글 신고"로 구분해서 씀.
--    게시글처럼 삭제돼도 신고 내역(스냅샷)은 남도록 on delete set null.
alter table public.forum_reports
  add column if not exists reply_id uuid references public.forum_replies(id) on delete set null;
alter table public.forum_reports
  add column if not exists reply_content text;

-- 기존 unique(post_id, reporter_uuid) 제약은 "게시글당 신고 1회"만 막던 것인데, 이제 같은
-- 사람이 한 게시글 안에서 게시글도 신고하고(별개로) 답글 여러 개도 각각 신고할 수 있어야
-- 하므로, reply_id 유무로 나눠서 검사하는 부분 유니크 인덱스 2개로 교체함.
--
-- ⚠️ 24-46차 추가: 실제로 이 파일을 처음 실행했을 때 "could not create unique index...
-- is duplicated" 오류가 났음 - 17차(2026-08-25_forum_moderation.sql)에서 만들려던
-- unique(post_id, reporter_uuid) 제약이 그 당시에도 같은 이유(중복 신고 데이터)로 실제로는
-- 한 번도 성공적으로 만들어진 적이 없었던 것으로 보임(그 파일도 실패했을 가능성이 높음 - 그
-- 파일의 ALTER TABLE ADD CONSTRAINT 부분만 조용히 안 걸렸고 나머지는 반영됐을 수 있음).
-- 즉 지금까지 DB에는 "게시글당 신고 1회 제한"이 실제로 걸려있지 않았고(앱 쪽 체크로만 대략
-- 막고 있었음), 그 사이 쌓인 중복 신고 행이 남아있던 것 - 아래 DELETE로 그 중복을 먼저
-- 정리(같은 post_id+reporter_uuid 조합 중 가장 오래된 것 하나만 남기고 나머지 삭제)한 뒤에
-- 인덱스를 만들도록 이 파일 자체에 포함시켜서, 이 파일 하나만 다시 실행하면 한 번에 되게 함.
delete from public.forum_reports a using public.forum_reports b
  where a.id < b.id
    and a.post_id = b.post_id
    and a.reporter_uuid = b.reporter_uuid
    and a.reply_id is null
    and b.reply_id is null;

alter table public.forum_reports
  drop constraint if exists forum_reports_post_reporter_unique;
create unique index if not exists forum_reports_post_reporter_unique_idx
  on public.forum_reports (post_id, reporter_uuid) where reply_id is null;
create unique index if not exists forum_reports_reply_reporter_unique_idx
  on public.forum_reports (reply_id, reporter_uuid) where reply_id is not null;
