-- Nova Client — 친구 시스템 정체성을 마인크래프트 계정 -> 노바 계정으로 전환
-- Supabase 대시보드 > SQL Editor에서 실행해주세요.
--
-- 배경: "친구도 싹 없애고 다시 해야지 지금 마크 계정끼리가 아니라 노바클 계정끼리
-- 친구추가가 되게 해야 하는데 노바클 닉네임으로 하게 해야지" - 지금까지 friends/whispers
-- 테이블은 전부 마인크래프트 uuid(requester_uuid/addressee_uuid/sender_uuid/receiver_uuid)를
-- 정체성으로 썼음. 그런데 24-23차에 "사이트 계정 하나에 마인크래프트 계정을 여러 개 연동"할
-- 수 있게 되면서, 같은 사람이 어떤 마인크래프트 계정으로 접속 중이냐에 따라 친구 관계가
-- 서로 다른 사람처럼 갈라지는 문제가 생김 - 친구는 "노바 계정" 단위여야 함.
--
-- 변경 사항:
-- 1) friends/whispers는 스키마 자체는 그대로 둠(두 컬럼 다 이미 uuid 타입이고,
--    nova_accounts.id도 uuid라 그대로 담을 수 있음) - 다만 이제 그 안에 들어가는 값의
--    "의미"가 마인크래프트 uuid에서 노바 계정 id(nova_accounts.id)로 바뀜. 예전 방식으로
--    쌓인 기존 행은 새 정체성 기준으로는 의미가 없어져서(마인크래프트 uuid가 노바 계정 id로
--    안 읽힘) 전부 지움 - "친구도 싹 없애고 다시" 요청 그대로.
-- 2) 온라인/상태표시(user_profiles.status_text 등)도 마인크래프트 uuid 기준이었는데, 이제
--    노바 계정 기준 접속 상태가 필요해서 site_presence 테이블을 새로 만듦(user_profiles와
--    똑같은 상태 컬럼 구성, 정체성 컬럼만 nova_account_id로 다름).

truncate table public.friends;
truncate table public.whispers;

create table if not exists public.site_presence (
  nova_account_id uuid primary key,
  nickname text not null,
  updated_at timestamptz not null default now(),
  status_text text,
  status_kind text,   -- 'server' | 'profile' | null
  status_ref text,    -- server면 CONFIG.SERVERS의 id, profile이면 프로필 id
  status_version text -- 그 서버/프로필이 쓰는 마인크래프트 버전 문자열
);

alter table public.site_presence enable row level security;

-- 다른 테이블들과 동일하게 anon 역할로 열어둠(앱이 Supabase Auth 없이 anon 키만 씀).
-- nova_accounts/nova_account_links와 달리 여기 담기는 건 닉네임 + 온라인 상태 문구뿐이라
-- (이메일/비밀번호 등 민감 정보 없음) anon으로 열어둬도 지금까지의 다른 공개 테이블들과
-- 같은 수준의 노출입니다.
drop policy if exists "site_presence_select_anon" on public.site_presence;
create policy "site_presence_select_anon" on public.site_presence
  for select to anon using (true);

drop policy if exists "site_presence_upsert_anon" on public.site_presence;
create policy "site_presence_upsert_anon" on public.site_presence
  for insert to anon with check (true);

drop policy if exists "site_presence_update_anon" on public.site_presence;
create policy "site_presence_update_anon" on public.site_presence
  for update to anon using (true);
