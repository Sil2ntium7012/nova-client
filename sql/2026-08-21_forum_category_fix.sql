-- Nova Client — 포럼 글쓰기 실패("forum_posts_category_check" 위반) 수정용 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
--
-- 원인: forum_posts 테이블의 category 체크 제약조건이 지금 클라이언트가 실제로 보내는
-- 카테고리 값들("공지사항","정보","질문","잡담","의견")과 어긋나 있어서, 이 값들 중 하나로
-- 글을 쓰면 "new row for relation \"forum_posts\" violates check constraint
-- \"forum_posts_category_check\"" 오류가 났음.
--
-- 기존 제약조건을 지우고, 클라이언트(src/index.html의 #forum-category-menu,
-- main.js의 forum:create-post/forum:update-post)가 실제로 쓰는 카테고리 값 그대로
-- 다시 만들어서 항상 서로 맞도록 함.

alter table public.forum_posts drop constraint if exists forum_posts_category_check;

alter table public.forum_posts
  add constraint forum_posts_category_check
  check (category in ('공지사항', '정보', '질문', '잡담', '의견'));
