-- Nova Client — 친구(friends) 테이블에 "차단(blocked)" 상태 추가
-- Supabase 대시보드 > SQL Editor에서 실행해주세요.
--
-- 배경: "친구 추가 버튼을 저렇게 두지 말고 친구 | 친구추가/받은요청/보낸요청 | 차단 관련
-- 이렇게 따로 있으면 좋을 거같아" - 친구창에 새 "차단 관련" 섹션을 추가하면서, 기존
-- friends 테이블(requester_uuid/addressee_uuid/status)을 그대로 재사용해 status 값으로
-- "blocked"를 하나 더 쓰기로 함(pending/accepted에 이어 세 번째 상태). 새 테이블 없이
-- 기존 친구 요청/수락 로직과 동일한 방식으로 차단도 처리할 수 있어서 이 방식을 택함.
--
-- 이 파일이 필요한 경우: friends.status 컬럼에 예전에 걸어둔 CHECK 제약(예:
-- status in ('pending','accepted'))이 있다면 status="blocked"로 저장할 때 그 제약에
-- 막혀 에러가 남(main.js의 friends:block 핸들러가 실패하고 로그에 남음). 제약이 원래
-- 없었다면(지금까지 다른 테이블들처럼 자유 텍스트 컬럼이었다면) 이 파일은 그냥 아무 일도
-- 안 하고 조용히 끝나므로, 차단 기능이 이미 잘 된다면 안 돌려도 무방합니다.

do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.friends'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.friends drop constraint %I', con.conname);
  end loop;
end $$;

-- 혹시 나중에 다시 값 범위를 제한하고 싶어지면 아래처럼 세 값만 허용하게 다시 걸 수 있음
-- (지금 당장은 안 걸어둠 - 다른 status류 컬럼들도 이 프로젝트에서는 대부분 자유 텍스트로 둠):
-- alter table public.friends
--   add constraint friends_status_check check (status in ('pending','accepted','blocked'));
