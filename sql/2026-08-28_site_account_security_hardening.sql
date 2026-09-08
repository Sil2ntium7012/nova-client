-- Nova Client — 24-8차: site_accounts / site_account_links 진짜 보안 강화
--
-- 지금까지 이 두 테이블은 RLS가 `using(true) with check(true)`로 완전히 열려있어서,
-- 앱에 내장된 Supabase anon key만 있으면 누구나:
--   - 모든 사이트 계정의 password_hash(비밀번호 해시)/active_session_token(세션 토큰)을
--     직접 읽을 수 있었고 (해시를 가져가 오프라인으로 무제한 크랙 시도 가능)
--   - 아무 계정의 active_session_token을 직접 덮어써서 세션을 훔치거나
--   - shared_player_data(코인/상점/출석/퀘스트)를 마음대로 조작하거나
--   - site_account_links를 직접 조작해서 다른 사람의 마인크래프트 계정을 가로챌 수 있었음.
-- main.js(Electron 메인 프로세스)는 각 사용자 PC에서 그대로 실행되는 코드라서 "서버"가
-- 아니고, 그 안의 권한 체크는 전부 클라이언트 쪽 코드일 뿐이라 전부 우회 가능했음.
--
-- 이제 anon 역할은 이 두 테이블에 절대 직접 접근할 수 없게 완전히 막고(RLS 정책을 하나도
-- 안 두는 deny-by-default + 테이블 권한 자체를 revoke), 대신 아래 SECURITY DEFINER 함수
-- (Postgres 안, 즉 진짜 서버 쪽에서 실행됨)를 통해서만 접근하게 함. 비밀번호 해시 비교나
-- 세션 토큰 확인은 전부 이 함수들 내부에서 SQL로 처리되고, main.js는 이제 password_hash나
-- active_session_token 값 자체를 절대 직접 읽거나 다루지 않음.
--
-- * 기존 계정 호환성 *: main.js가 지금까지 쓰던 비밀번호 해시 방식(salt를 앞에 붙인
-- "salt:scrypt해시" 형식, Node crypto.scryptSync)을 그대로 유지합니다. 알고리즘을 바꾸지
-- 않고, "그 해시를 어디서 계산/비교하느냐"만 서버(Postgres) 쪽으로 옮긴 것이라, 이미
-- 가입된 계정의 비밀번호도 그대로 로그인됩니다(솔트만 새 rpc_get_login_salt 함수로 조회해서
-- 클라이언트가 예전과 똑같은 방식으로 후보 해시를 계산하고, 최종 비교만 서버가 함).

-- ============================================================
-- 0) 테이블 잠그기: anon 역할의 직접 접근을 전부 차단
-- ============================================================
drop policy if exists "site_accounts_all" on public.site_accounts;
drop policy if exists "site_account_links_all" on public.site_account_links;

alter table public.site_accounts enable row level security;
alter table public.site_account_links enable row level security;
-- 정책을 하나도 안 만들면 RLS가 켜진 테이블은 기본적으로 전부 거부됨(deny-by-default).
-- 아래 함수들은 SECURITY DEFINER라 이 RLS를 우회해서 항상 정상 동작함.

revoke all on public.site_accounts from anon, authenticated, public;
revoke all on public.site_account_links from anon, authenticated, public;

-- ============================================================
-- 내부 헬퍼: account+links를 앱이 쓰는 JSON 모양으로 변환 (password_hash 등 절대 포함 안 함)
-- ============================================================
create or replace function public.rpc_site_account_to_json(v_row public.site_accounts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', (v_row).id,
    'login_id', (v_row).login_id,
    'display_name', (v_row).display_name,
    'active_session_device', (v_row).active_session_device,
    'created_at', (v_row).created_at,
    'shared_player_data', coalesce((v_row).shared_player_data, '{}'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'provider', l.provider, 'provider_uid', l.provider_uid,
        'provider_name', l.provider_name, 'linked_at', l.linked_at
      ) order by l.linked_at asc)
      from public.site_account_links l where l.site_account_id = (v_row).id
    ), '[]'::jsonb)
  );
$$;

-- 내부 헬퍼: 계정id+세션토큰이 일치하는 행을 돌려줌(불일치/없으면 null) - 여러 함수가 재사용
create or replace function public.rpc_verify_site_session_row(p_account_id uuid, p_session_token text)
returns public.site_accounts
language sql
stable
security definer
set search_path = public
as $$
  select * from public.site_accounts
  where id = p_account_id and active_session_token = p_session_token;
$$;

-- 위 두 헬퍼는 다른 RPC 함수들 안에서만 쓰이면 되고, 밖에서 직접 호출될 이유가 없음.
-- Postgres는 함수를 만들면 기본적으로 PUBLIC(=anon 포함)에게 실행 권한을 자동으로 주기
-- 때문에, 명시적으로 걷어내서 "공식 입구"(아래 grant된 함수들)로만 드나들게 함. (SECURITY
-- DEFINER 함수 안에서 다른 함수를 호출하는 건 이 실행 권한과 무관하게 항상 되므로, 아래처럼
-- 걷어내도 다른 RPC 함수들의 동작에는 전혀 영향 없음 - 실제로 로컬 Postgres로 검증함.)
revoke execute on function public.rpc_site_account_to_json(public.site_accounts) from public;
revoke execute on function public.rpc_verify_site_session_row(uuid, text) from public;

-- ============================================================
-- 1) 로그인용 salt 조회 (비밀번호 해시 자체는 절대 안 돌려줌)
-- ============================================================
-- (jsonb로 감싸서 돌려줌 - 이 마이그레이션의 다른 모든 함수와 동일한 규칙: PostgREST가
-- RPC 함수의 반환값을 스칼라 타입이냐 jsonb냐에 따라 다르게 감쌀 수 있어서, 전부 jsonb
-- 하나로 통일해두면 그 애매함이 아예 없어짐 - main.js도 항상 res.xxx 형태로 꺼내 씀)
create or replace function public.rpc_get_login_salt(p_login_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_salt text;
begin
  select split_part(password_hash, ':', 1) into v_salt
  from public.site_accounts where lower(login_id) = lower(trim(p_login_id));
  if v_salt is null or v_salt = '' then
    -- 계정이 없을 때도 매번 같은 모양의(그럴듯한) salt를 돌려줘서, 이 salt 조회 응답만
    -- 보고 "이 아이디가 존재하는지"를 구분할 수 없게 함(로그인 실패 메시지는 항상 동일).
    v_salt := md5('nova-client-decoy-salt:' || lower(trim(p_login_id)));
  end if;
  return jsonb_build_object('salt', v_salt);
end;
$$;

-- ============================================================
-- 2) 회원가입 (main.js가 salt/hash를 예전과 동일한 방식으로 미리 계산해서 넘겨줌)
-- ============================================================
create or replace function public.rpc_site_register(p_login_id text, p_salt text, p_hash text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := trim(p_login_id);
  v_token text := gen_random_uuid()::text;
  v_row public.site_accounts;
begin
  if length(v_id) < 3 then
    return jsonb_build_object('ok', false, 'error', '아이디는 3자 이상이어야 해요.');
  end if;
  if p_salt is null or p_salt = '' or p_hash is null or p_hash = '' then
    return jsonb_build_object('ok', false, 'error', '비밀번호는 4자 이상이어야 해요.');
  end if;
  if exists (select 1 from public.site_accounts where lower(login_id) = lower(v_id)) then
    return jsonb_build_object('ok', false, 'error', '이미 있는 아이디예요.');
  end if;

  insert into public.site_accounts (
    display_name, login_id, password_hash,
    active_session_token, active_session_device,
    active_session_started_at, active_session_heartbeat_at,
    shared_player_data
  ) values (
    v_id, v_id, p_salt || ':' || p_hash,
    v_token, coalesce(p_device, '이 기기'),
    now(), now(), '{}'::jsonb
  ) returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'account', public.rpc_site_account_to_json(v_row)
  );
end;
$$;

-- ============================================================
-- 3) 로그인 (main.js가 rpc_get_login_salt로 받은 salt로 후보 해시를 미리 계산해서 넘겨줌)
-- ============================================================
create or replace function public.rpc_site_login(p_login_id text, p_hash text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := trim(p_login_id);
  v_token text := gen_random_uuid()::text;
  v_row public.site_accounts;
begin
  select * into v_row from public.site_accounts where lower(login_id) = lower(v_id);
  if v_row.id is null or p_hash is null or p_hash = ''
     or split_part(v_row.password_hash, ':', 2) <> p_hash then
    return jsonb_build_object('ok', false, 'error', '아이디 또는 비밀번호가 올바르지 않아요.');
  end if;

  update public.site_accounts set
    active_session_token = v_token,
    active_session_device = coalesce(p_device, '이 기기'),
    active_session_started_at = now(),
    active_session_heartbeat_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'account', public.rpc_site_account_to_json(v_row)
  );
end;
$$;

-- ============================================================
-- 4) 세션 확인 (앱 재시작 시 세션 복원 + 설정 화면에서 계정 정보 새로고침, 둘 다 여기로 통일)
-- ============================================================
create or replace function public.rpc_site_verify_session(p_account_id uuid, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
begin
  select * into v_row from public.rpc_verify_site_session_row(p_account_id, p_session_token);
  if v_row.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'account', public.rpc_site_account_to_json(v_row));
end;
$$;

-- ============================================================
-- 5) 하트비트 (45초마다 - 다른 기기가 로그인해서 세션이 끊겼는지 확인)
-- ============================================================
create or replace function public.rpc_site_heartbeat(p_account_id uuid, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
begin
  select * into v_row from public.site_accounts where id = p_account_id;
  if v_row.id is null then
    return jsonb_build_object('ok', true, 'kicked', false);
  end if;
  if v_row.active_session_token is distinct from p_session_token then
    return jsonb_build_object('ok', true, 'kicked', true, 'device', coalesce(v_row.active_session_device, '다른 기기'));
  end if;
  update public.site_accounts set active_session_heartbeat_at = now() where id = p_account_id;
  return jsonb_build_object('ok', true, 'kicked', false);
end;
$$;

-- ============================================================
-- 6) 로그아웃 (서버 쪽 세션 토큰도 같이 비움 - 기존엔 로컬에서만 지우고 서버는 안 건드렸음)
-- ============================================================
create or replace function public.rpc_site_logout(p_account_id uuid, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.site_accounts set active_session_token = null
  where id = p_account_id and active_session_token = p_session_token;
  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- 7) 공용 데이터(코인/상점/출석/퀘스트) 저장
-- ============================================================
create or replace function public.rpc_site_set_shared_data(p_account_id uuid, p_session_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
begin
  select * into v_row from public.rpc_verify_site_session_row(p_account_id, p_session_token);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', '세션이 만료됐어요. 다시 로그인해주세요.');
  end if;
  update public.site_accounts set shared_player_data = coalesce(p_data, '{}'::jsonb) where id = p_account_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- 8) 마인크래프트 계정 연동(등록)
-- ============================================================
create or replace function public.rpc_site_link_minecraft(p_account_id uuid, p_session_token text, p_uuid text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
  v_existing public.site_account_links;
begin
  select * into v_row from public.rpc_verify_site_session_row(p_account_id, p_session_token);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', '세션이 만료됐어요. 다시 로그인해주세요.');
  end if;

  select * into v_existing from public.site_account_links
  where provider = 'minecraft' and provider_uid = p_uuid;

  if v_existing.id is not null then
    if v_existing.site_account_id = p_account_id then
      select * into v_row from public.site_accounts where id = p_account_id;
      return jsonb_build_object('ok', true, 'linked', true, 'account', public.rpc_site_account_to_json(v_row));
    else
      return jsonb_build_object('ok', true, 'linked', false, 'warning', '이미 다른 사이트 계정에 등록된 마인크래프트 계정이에요.');
    end if;
  end if;

  insert into public.site_account_links (site_account_id, provider, provider_uid, provider_name)
  values (p_account_id, 'minecraft', p_uuid, p_name);

  select * into v_row from public.site_accounts where id = p_account_id;
  return jsonb_build_object('ok', true, 'linked', true, 'account', public.rpc_site_account_to_json(v_row));
end;
$$;

-- ============================================================
-- 9) 디스코드 태그 연동
-- ============================================================
create or replace function public.rpc_site_link_discord(p_account_id uuid, p_session_token text, p_tag text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
  v_other public.site_account_links;
  v_mine public.site_account_links;
  v_tag text := trim(p_tag);
begin
  select * into v_row from public.rpc_verify_site_session_row(p_account_id, p_session_token);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', '세션이 만료됐어요. 다시 로그인해주세요.');
  end if;
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'error', '디스코드 태그를 입력해주세요.');
  end if;

  select * into v_other from public.site_account_links
  where provider = 'discord' and provider_uid = v_tag and site_account_id <> p_account_id;
  if v_other.id is not null then
    return jsonb_build_object('ok', false, 'error', '이미 다른 사이트 계정에 연동된 디스코드예요.');
  end if;

  select * into v_mine from public.site_account_links
  where provider = 'discord' and site_account_id = p_account_id;

  if v_mine.id is not null then
    update public.site_account_links set provider_uid = v_tag, provider_name = v_tag where id = v_mine.id;
  else
    insert into public.site_account_links (site_account_id, provider, provider_uid, provider_name)
    values (p_account_id, 'discord', v_tag, v_tag);
  end if;

  select * into v_row from public.site_accounts where id = p_account_id;
  return jsonb_build_object('ok', true, 'account', public.rpc_site_account_to_json(v_row));
end;
$$;

-- ============================================================
-- 10) 연동 해제 (본인 사이트 계정 소유의 링크인지 서버가 직접 확인 - 예전엔 이 확인이 없었음)
-- ============================================================
create or replace function public.rpc_site_unlink(p_account_id uuid, p_session_token text, p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_accounts;
  v_deleted int;
begin
  select * into v_row from public.rpc_verify_site_session_row(p_account_id, p_session_token);
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', '세션이 만료됐어요. 다시 로그인해주세요.');
  end if;

  delete from public.site_account_links where id = p_link_id and site_account_id = p_account_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', '연동 정보를 찾을 수 없어요.');
  end if;

  select * into v_row from public.site_accounts where id = p_account_id;
  return jsonb_build_object('ok', true, 'account', public.rpc_site_account_to_json(v_row));
end;
$$;

-- ============================================================
-- 실행 권한 부여 (테이블 자체는 revoke했지만, 이 함수들만 anon이 호출 가능)
-- ============================================================
grant execute on function public.rpc_get_login_salt(text) to anon;
grant execute on function public.rpc_site_register(text, text, text, text) to anon;
grant execute on function public.rpc_site_login(text, text, text) to anon;
grant execute on function public.rpc_site_verify_session(uuid, text) to anon;
grant execute on function public.rpc_site_heartbeat(uuid, text) to anon;
grant execute on function public.rpc_site_logout(uuid, text) to anon;
grant execute on function public.rpc_site_set_shared_data(uuid, text, jsonb) to anon;
grant execute on function public.rpc_site_link_minecraft(uuid, text, text, text) to anon;
grant execute on function public.rpc_site_link_discord(uuid, text, text) to anon;
grant execute on function public.rpc_site_unlink(uuid, text, uuid) to anon;
