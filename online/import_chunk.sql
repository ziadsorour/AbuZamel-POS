-- Chunked, fault-tolerant restore (owner only). Safe to run more than once. Adds a function only; touches no data.
create or replace function public.az_import_chunk(p_store text, p_rows jsonb, p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  p public.az_profiles; r jsonb; k text; ok int := 0; mx bigint := 0; fails jsonb := '[]'::jsonb;
  stores_all text[] := array['products','customers','suppliers','purchases','audits','dayClosures','agents','invoices','expenses','inventoryLog','settlements','returns','users','customerPayments','supplierPayments'];
begin
  p := public.az__profile();
  if p.role <> 'owner' then raise exception 'owner_only'; end if;
  if not (p_store = any (stores_all)) then raise exception 'bad_store'; end if;
  if p_reset then
    delete from public.az_records where true;
    delete from public.az_counters where true;
    delete from public.az_reqs where true;
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) = 'array' then
    for r in select * from jsonb_array_elements(p_rows) loop
      begin
        if jsonb_typeof(r) <> 'object' then raise exception 'row_not_object'; end if;
        if p_store = 'dayClosures' then k := r->>'date'; else k := r->>'id'; end if;
        if k is null or k = '' then raise exception 'row_without_id'; end if;
        insert into public.az_records (store, key, idn, data, updated_by)
        values (p_store, k, case when k ~ '^[0-9]{1,15}$' then k::bigint end, r, p.user_id)
        on conflict (store, key) do update set data = excluded.data;
        if p_store <> 'dayClosures' and k ~ '^[0-9]{1,15}$' and k::bigint > mx then mx := k::bigint; end if;
        ok := ok + 1;
      exception when others then
        if jsonb_array_length(fails) < 20 then fails := fails || jsonb_build_array(jsonb_build_object('key', coalesce(k, '?'), 'error', sqlerrm)); end if;
      end;
    end loop;
  end if;
  if p_store <> 'dayClosures' then
    insert into public.az_counters (store, next_id) values (p_store, mx + 1)
      on conflict (store) do update set next_id = greatest(public.az_counters.next_id, excluded.next_id);
  end if;
  return jsonb_build_object('ok', ok, 'failed', fails);
end $$;
revoke all on function public.az_import_chunk(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.az_import_chunk(text, jsonb, boolean) to authenticated;
