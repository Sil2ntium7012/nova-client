-- Nova Client — 프로필 공유 "업데이트 연동"용 Supabase 마이그레이션 (7차 라운드, 2-5)
-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행해주세요.
-- 기존 마이그레이션 파일은 건드리지 않고 새 파일로 추가함.
--
-- shared_profiles 테이블에 updated_at 컬럼을 추가합니다. "업데이트 연동"이 켜진(불러온)
-- 프로필들이, 원작자가 "프로필 갱신"을 누른 뒤로 새 버전이 있는지 이 값 하나만 보고
-- 판단합니다 (main.js의 profiles:check-share-updates). DB 트리거로 자동 갱신되는지
-- 확인할 방법이 없어서, main.js가 공유(profiles:share)/갱신(profiles:refresh-share)할
-- 때마다 이 값을 직접 명시적으로 채웁니다.

alter table public.shared_profiles
  add column if not exists updated_at timestamptz not null default now();

create index if not exists shared_profiles_updated_at_idx on public.shared_profiles (updated_at desc);
