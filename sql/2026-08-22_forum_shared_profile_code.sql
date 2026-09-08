-- Nova Client — 포럼 글에 "프로필 공유 코드" 고정 첨부 기능용 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
--
-- 11차: 글쓰기 화면에서 내 프로필 중 하나를 골라 공유 코드를 본문과 별개로 글 상단에
-- 고정할 수 있게 해달라는 요청 - forum_posts 테이블에 그 코드를 저장할 컬럼을 추가함.
-- (shared_profiles 테이블은 이미 있음 - 거기서 코드로 프로필 이름/버전/모드 목록 등을
-- 조회해서 미리보기로 보여줌)

alter table public.forum_posts
  add column if not exists shared_profile_code text;
