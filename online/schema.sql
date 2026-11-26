-- AbuZamel POS: online mode (Supabase). Run once in the Supabase SQL editor.
-- All app access goes through the az_* functions below. Tables are closed to direct access.

create table if not exists public.az_records (
  store      text   not null,
  key        text   not null,
  idn        bigint,
  data       jsonb  not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (store, key)
);
create index if not exists az_records_date_idx on public.az_records (store, ((data->>'date')) collate "C");

create table if not exists public.az_counters (
  store   text primary key,
  next_id bigint not null default 1
);

create table if not exists public.az_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text not null,
  role         text not null check (role in ('owner','seller')),
  agent_id     bigint,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.az_reqs (
  req_id     text primary key,
  store      text,
  key        text,
  created_at timestamptz not null default now()
);

alter table public.az_records  enable row level security;
alter table public.az_counters enable row level security;
alter table public.az_profiles enable row level security;
alter table public.az_reqs     enable row level security;
revoke all on public.az_records, public.az_counters, public.az_profiles, public.az_reqs from anon, authenticated;

-- ---------- helpers ----------
create or replace function public.az__profile() returns public.az_profiles
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  select * into p from public.az_profiles where user_id = auth.uid() and active;
  if not found then raise exception 'not_authorized'; end if;
  return p;
end $$;

create or replace function public.az__strip(p_store text, p_data jsonb) returns jsonb
language plpgsql immutable as $$
declare items jsonb;
begin
  if p_store = 'products' then
    return p_data - 'purchasePrice';
  elsif p_store = 'invoices' and jsonb_typeof(p_data->'items') = 'array' then
    select coalesce(jsonb_agg(i - 'purchasePrice'), '[]'::jsonb) into items from jsonb_array_elements(p_data->'items') i;
    return jsonb_set(p_data, '{items}', items);
  end if;
  return p_data;
end $$;

create or replace function public.az__seller_read(p_store text) returns boolean
language sql immutable as $$
  select p_store = any (array['products','customers','agents','invoices','customerPayments','returns','inventoryLog','dayClosures']);
$$;

-- ---------- identity ----------
create or replace function public.az_me() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  return jsonb_build_object('user_id', p.user_id, 'username', p.username, 'name', p.display_name, 'role', p.role, 'agent_id', p.agent_id);
end $$;

create or replace function public.az__create_user(p_username text, p_password text, p_name text, p_role text, p_agent bigint) returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid := gen_random_uuid(); em text; uname text := lower(trim(p_username));
begin
  if uname !~ '^[a-z0-9._-]{3,30}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'weak_password'; end if;
  if p_role not in ('owner','seller') then raise exception 'bad_role'; end if;
  if exists (select 1 from public.az_profiles where username = uname) then raise exception 'username_taken'; end if;
  em := uname || '@abuzamel.app';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now());
  insert into public.az_profiles (user_id, username, display_name, role, agent_id)
  values (uid, uname, coalesce(nullif(trim(p_name),''), uname), p_role, p_agent);
  return uid;
end $$;
revoke all on function public.az__create_user(text,text,text,text,bigint) from public, anon, authenticated;

-- First-time setup: works only while no account exists.
create or replace function public.az_setup_owner(p_username text, p_password text, p_name text) returns boolean
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if exists (select 1 from public.az_profiles) then raise exception 'already_setup'; end if;
  perform public.az__create_user(p_username, p_password, p_name, 'owner', null);
  return true;
end $$;

create or replace function public.az_needs_setup() returns boolean
language sql security definer set search_path = public as $$
  select not exists (select 1 from public.az_profiles);
$$;

create or replace function public.az_list_users() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('username', username, 'name', display_name, 'role', role, 'agent_id', agent_id, 'active', active) order by created_at) from public.az_profiles), '[]'::jsonb);
end $$;

create or replace function public.az_create_user(p_username text, p_password text, p_name text, p_agent bigint default null) returns boolean
language plpgsql security definer set search_path = public, auth, extensions as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  perform public.az__create_user(p_username, p_password, p_name, 'seller', p_agent);
  return true;
end $$;

create or replace function public.az_set_password(p_username text, p_password text) returns boolean
language plpgsql security definer set search_path = public, auth, extensions as $$
declare p public.az_profiles; t public.az_profiles;
begin
  p := public.az__profile();
  select * into t from public.az_profiles where username = lower(trim(p_username));
  if not found then raise exception 'no_such_user'; end if;
  if p.role <> 'owner' and p.user_id <> t.user_id then raise exception 'owner_only'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'weak_password'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = t.user_id;
  return true;
end $$;

create or replace function public.az_set_active(p_username text, p_active boolean) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  if lower(trim(p_username)) = p.username then raise exception 'cannot_disable_self'; end if;
  update public.az_profiles set active = p_active where username = lower(trim(p_username));
  return true;
end $$;

-- ---------- reads ----------
create or replace function public.az_get_all(p_store text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles; res jsonb;
begin
  p := public.az__profile();
  if p.role <> 'owner' and not public.az__seller_read(p_store) then raise exception 'forbidden'; end if;
  if p.role = 'owner' then
    select coalesce(jsonb_agg(data order by idn nulls last, key), '[]'::jsonb) into res from public.az_records where store = p_store;
  else
    select coalesce(jsonb_agg(public.az__strip(p_store, data) order by idn nulls last, key), '[]'::jsonb) into res from public.az_records where store = p_store;
  end if;
  return res;
end $$;

create or replace function public.az_get(p_store text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles; d jsonb;
begin
  p := public.az__profile();
  if p.role <> 'owner' and not public.az__seller_read(p_store) then raise exception 'forbidden'; end if;
  select data into d from public.az_records where store = p_store and key = p_key;
  if d is null then return null; end if;
  if p.role <> 'owner' then d := public.az__strip(p_store, d); end if;
  return d;
end $$;

create or replace function public.az_range(p_store text, p_from text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles; res jsonb;
begin
  p := public.az__profile();
  if p.role <> 'owner' and not public.az__seller_read(p_store) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(case when p.role = 'owner' then data else public.az__strip(p_store, data) end order by (data->>'date') collate "C", idn nulls last, key), '[]'::jsonb)
    into res
    from public.az_records
   where store = p_store
     and (data->>'date') collate "C" >= p_from collate "C"
     and (data->>'date') collate "C" <= (coalesce(p_to, p_from) || chr(65535)) collate "C";
  return res;
end $$;

-- ---------- writes ----------
-- p_deltas: numeric fields that change relative to what the client last read (stock, balance).
create or replace function public.az_put(p_store text, p_data jsonb, p_deltas jsonb default '{}'::jsonb, p_req text default null, p_absolute boolean default false) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  p public.az_profiles; k text; n bigint; cur jsonb; nd jsonb; f text; is_new boolean := false;
  delta_fields text[]; it jsonb; items jsonb := '[]'::jsonb; pr jsonb; cost numeric; sold numeric; unitmul numeric; below boolean := false;
  stores_all text[] := array['products','customers','suppliers','purchases','audits','dayClosures','agents','invoices','expenses','inventoryLog','settlements','returns','users','customerPayments','supplierPayments'];
begin
  p := public.az__profile();
  if not (p_store = any (stores_all)) then raise exception 'bad_store'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'bad_data'; end if;

  if p_req is not null then
    select key into k from public.az_reqs where req_id = p_req;
    if found then return jsonb_build_object('key', k, 'id', case when k ~ '^[0-9]+$' then to_jsonb(k::bigint) else to_jsonb(k) end, 'data', (select data from public.az_records where store = p_store and key = k)); end if;
  end if;

  if p_store = 'dayClosures' then
    k := p_data->>'date';
    if k is null then raise exception 'bad_data'; end if;
  elsif p_data ? 'id' and p_data->>'id' is not null and p_data->>'id' ~ '^[0-9]+$' then
    k := p_data->>'id';
  else
    insert into public.az_counters (store, next_id) values (p_store, 2)
      on conflict (store) do update set next_id = public.az_counters.next_id + 1
      returning next_id - 1 into n;
    k := n::text;
    is_new := true;
  end if;

  select data into cur from public.az_records where store = p_store and key = k for update;
  if cur is null then is_new := true; end if;

  -- seller permissions
  if p.role <> 'owner' then
    if p_store not in ('invoices','customers','customerPayments','returns','inventoryLog','products') then raise exception 'forbidden'; end if;
    if p_store in ('customerPayments','inventoryLog','returns') and not is_new then raise exception 'forbidden'; end if;
    if p_store = 'invoices' and not is_new then
      -- seller may only reduce an invoice (return), never raise or reprice it
      if coalesce((p_data->>'total')::numeric, 0) > coalesce((cur->>'total')::numeric, 0) + 0.001
         or coalesce((p_data->>'paid')::numeric, 0) <> coalesce((cur->>'paid')::numeric, 0)
         or (p_data->>'date') is distinct from (cur->>'date') then
        raise exception 'forbidden';
      end if;
    end if;
    if p_store = 'products' then
      if is_new or cur is null then raise exception 'forbidden'; end if;
      p_data := cur;      -- sellers can only move stock, through the delta
      p_absolute := false;
    end if;
    if p_store = 'customers' and not is_new then
      p_absolute := false;
    end if;
  end if;

  nd := p_data;
  if p_store <> 'dayClosures' then nd := jsonb_set(nd, '{id}', to_jsonb(k::bigint)); end if;

  -- relative numeric fields
  delta_fields := case p_store when 'products' then array['stock'] when 'customers' then array['balance'] when 'suppliers' then array['balance'] else array[]::text[] end;
  if cur is not null and not p_absolute then
    foreach f in array delta_fields loop
      if p_deltas ? f then
        nd := jsonb_set(nd, array[f], to_jsonb(round(coalesce((cur->>f)::numeric, 0) + (p_deltas->>f)::numeric, 4)));
      elsif p.role <> 'owner' then
        nd := jsonb_set(nd, array[f], coalesce(cur->f, to_jsonb(0)));
      end if;
    end loop;
  end if;

  if is_new and p_store in ('invoices','customerPayments','returns') then
    nd := nd || jsonb_build_object('createdBy', p.username, 'createdByName', p.display_name, 'createdById', p.user_id);
    if p_store = 'invoices' and (nd->>'agentId' is null or nd->>'agentId' = '') and p.agent_id is not null then
      nd := nd || jsonb_build_object('agentId', p.agent_id::text);
    end if;
  elsif cur is not null and p_store in ('invoices','customerPayments','returns') then
    nd := nd || jsonb_build_object('createdBy', cur->'createdBy', 'createdByName', cur->'createdByName', 'createdById', cur->'createdById');
  end if;

  -- invoice lines: real cost from the product table, below-cost flag, original vs sold price
  if p_store = 'invoices' and jsonb_typeof(nd->'items') = 'array' then
    for it in select * from jsonb_array_elements(nd->'items') loop
      select data into pr from public.az_records where store = 'products' and key = (it->>'id');
      cost := null;
      if pr is not null then
        cost := coalesce((pr->>'purchasePrice')::numeric, 0);
        unitmul := case when it->>'selectedUnit' = 'علبة' then coalesce(nullif((pr->>'piecesPerBox')::numeric, 0), 1) else 1 end;
        cost := cost * unitmul;
        it := it || jsonb_build_object('purchasePrice', cost);
      end if;
      sold := coalesce((it->>'soldPrice')::numeric, (it->>'salePrice')::numeric);
      if cost is not null and sold is not null and sold < cost - 0.0001 then
        it := it || jsonb_build_object('belowCost', true);
        below := true;
      else
        it := it - 'belowCost';
      end if;
      items := items || jsonb_build_array(it);
    end loop;
    nd := jsonb_set(nd, '{items}', items);
    if below then nd := nd || jsonb_build_object('belowCost', true); else nd := nd - 'belowCost'; end if;
  end if;

  insert into public.az_records (store, key, idn, data, updated_at, updated_by)
  values (p_store, k, case when k ~ '^[0-9]+$' then k::bigint end, nd, now(), p.user_id)
  on conflict (store, key) do update set data = excluded.data, updated_at = now(), updated_by = p.user_id;

  if p_req is not null then
    insert into public.az_reqs (req_id, store, key) values (p_req, p_store, k) on conflict do nothing;
  end if;
  return jsonb_build_object('key', k, 'id', case when k ~ '^[0-9]+$' then to_jsonb(k::bigint) else to_jsonb(k) end, 'data', public.az__strip(p_store, nd) );
end $$;

create or replace function public.az_delete(p_store text, p_key text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  delete from public.az_records where store = p_store and key = p_key;
  return true;
end $$;

-- Owner only: wipe (factory reset) and bulk restore from a backup file (keeps ids).
create or replace function public.az_clear_all() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare p public.az_profiles;
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  delete from public.az_records where true;
  delete from public.az_counters where true;
  delete from public.az_reqs where true;
  return true;
end $$;

create or replace function public.az_import(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  p public.az_profiles; s text; r jsonb; k text; cnt jsonb := '{}'::jsonb; c int; mx bigint;
  stores_all text[] := array['products','customers','suppliers','purchases','audits','dayClosures','agents','invoices','expenses','inventoryLog','settlements','returns','users','customerPayments','supplierPayments'];
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'bad_data'; end if;
  delete from public.az_records where true;
  delete from public.az_counters where true;
  delete from public.az_reqs where true;
  foreach s in array stores_all loop
    c := 0; mx := 0;
    if jsonb_typeof(p_data->s) = 'array' then
      for r in select * from jsonb_array_elements(p_data->s) loop
        if s = 'dayClosures' then k := r->>'date'; else k := r->>'id'; end if;
        if k is null then continue; end if;
        insert into public.az_records (store, key, idn, data, updated_by)
        values (s, k, case when k ~ '^[0-9]+$' then k::bigint end, r, p.user_id)
        on conflict (store, key) do update set data = excluded.data;
        if s <> 'dayClosures' and k ~ '^[0-9]+$' and k::bigint > mx then mx := k::bigint; end if;
        c := c + 1;
      end loop;
    end if;
    if s <> 'dayClosures' then
      insert into public.az_counters (store, next_id) values (s, mx + 1)
        on conflict (store) do update set next_id = excluded.next_id;
    end if;
    cnt := cnt || jsonb_build_object(s, c);
  end loop;
  return cnt;
end $$;

-- ---------- grants ----------
revoke all on function public.az__profile(), public.az__strip(text,jsonb), public.az__seller_read(text) from public, anon, authenticated;
revoke all on function public.az_me(), public.az_list_users(), public.az_create_user(text,text,text,bigint), public.az_set_password(text,text), public.az_set_active(text,boolean),
  public.az_get_all(text), public.az_get(text,text), public.az_range(text,text,text), public.az_put(text,jsonb,jsonb,text,boolean), public.az_delete(text,text),
  public.az_clear_all(), public.az_import(jsonb), public.az_setup_owner(text,text,text), public.az_needs_setup() from public, anon, authenticated;
grant execute on function public.az_me(), public.az_list_users(), public.az_create_user(text,text,text,bigint), public.az_set_password(text,text), public.az_set_active(text,boolean),
  public.az_get_all(text), public.az_get(text,text), public.az_range(text,text,text), public.az_put(text,jsonb,jsonb,text,boolean), public.az_delete(text,text),
  public.az_clear_all(), public.az_import(jsonb) to authenticated;
grant execute on function public.az_setup_owner(text,text,text), public.az_needs_setup() to anon, authenticated;
