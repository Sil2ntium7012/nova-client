-- Nova Client — 2026-08-18 업데이트용 Supabase 마이그레이션
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- (앱이 Supabase Auth 로그인 없이 anon 키만 쓰는 구조라, 아래 정책들도 전부 anon 역할 기준으로 열어뒀어요.
--  실제 서비스라면 좀 더 촘촘한 정책이 좋겠지만, 지금 구조에 맞춰 최소한으로 작성했습니다.)

-- ============================================================
-- 0) shared-profile-files 버킷이 없다면 자동 생성 (이미 있으면 그냥 넘어가요)
-- ============================================================
-- 프로필 공유 기능은 예전 버전부터 있던 거라 이 버킷은 이미 만들어져 있을 가능성이 높지만,
-- 혹시 몰라 안전하게 없으면 만들도록 넣었어요. 이미 있으면 아무 일도 안 일어나요.
insert into storage.buckets (id, name, public)
values ('shared-profile-files', 'shared-profile-files', true)
on conflict (id) do nothing;

-- ============================================================
-- 1) 친구 기능: friends 테이블 신규 생성
-- ============================================================
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  requester_uuid uuid not null,
  requester_name text not null,
  addressee_uuid uuid not null,
  addressee_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now()
);

-- 같은 두 사람 사이에 중복 요청이 쌓이지 않도록 (요청자/수신자 방향 무관하게) 유니크 제약
create unique index if not exists friends_pair_unique
  on public.friends (least(requester_uuid, addressee_uuid), greatest(requester_uuid, addressee_uuid));

create index if not exists friends_requester_idx on public.friends (requester_uuid);
create index if not exists friends_addressee_idx on public.friends (addressee_uuid);

alter table public.friends enable row level security;

-- anon 키로 조회/추가/수정/삭제 모두 가능하게 (다른 테이블들과 동일한 방식)
drop policy if exists "friends_select_anon" on public.friends;
create policy "friends_select_anon" on public.friends
  for select to anon using (true);

drop policy if exists "friends_insert_anon" on public.friends;
create policy "friends_insert_anon" on public.friends
  for insert to anon with check (true);

drop policy if exists "friends_update_anon" on public.friends;
create policy "friends_update_anon" on public.friends
  for update to anon using (true) with check (true);

drop policy if exists "friends_delete_anon" on public.friends;
create policy "friends_delete_anon" on public.friends
  for delete to anon using (true);


-- ============================================================
-- 2) 프로필 공유에 아이콘 포함: shared_profiles.icon_file 컬럼 추가
-- ============================================================
alter table public.shared_profiles
  add column if not exists icon_file text;


-- ============================================================
-- 3) 프로필 재공유 시 403 오류 원인: shared-profile-files 스토리지 정책
-- ============================================================
-- 지금 두 번째 공유(재업로드/새 아이콘 업로드 등)에서 403 "row-level security policy" 에러가 나는 건
-- storage.objects에 shared-profile-files 버킷용 insert/update 정책이 비어있거나 too narrow하기 때문일 가능성이 높습니다.
-- 아래 정책으로 anon이 이 버킷에 자유롭게 읽고 쓰고 지울 수 있게 열어주세요.

drop policy if exists "shared_profile_files_select_anon" on storage.objects;
create policy "shared_profile_files_select_anon" on storage.objects
  for select to anon
  using (bucket_id = 'shared-profile-files');

drop policy if exists "shared_profile_files_insert_anon" on storage.objects;
create policy "shared_profile_files_insert_anon" on storage.objects
  for insert to anon
  with check (bucket_id = 'shared-profile-files');

drop policy if exists "shared_profile_files_update_anon" on storage.objects;
create policy "shared_profile_files_update_anon" on storage.objects
  for update to anon
  using (bucket_id = 'shared-profile-files')
  with check (bucket_id = 'shared-profile-files');

drop policy if exists "shared_profile_files_delete_anon" on storage.objects;
create policy "shared_profile_files_delete_anon" on storage.objects
  for delete to anon
  using (bucket_id = 'shared-profile-files');

-- 참고: 버킷 자체가 "Public" 으로 안 되어있으면 위 select 정책과 별개로
-- Storage > shared-profile-files 버킷 설정에서 Public bucket 옵션도 켜져 있는지 확인해주세요.
-- (아이콘 다운로드를 public URL로 바로 가져오는 방식이라 필요해요)
