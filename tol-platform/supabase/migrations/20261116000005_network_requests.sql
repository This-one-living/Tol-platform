drop function if exists public.search_discover_profiles(text, text, text);

create function public.search_discover_profiles(
  search_text text default '',
  niche_filter text default null,
  lga_filter text default null
)
returns table (
  profile_id uuid,
  full_name text,
  niche text,
  category text,
  other_niche text,
  lga text,
  community text,
  skills text[],
  network_status text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with search_input as (
    select lower(btrim(coalesce(search_text, ''))) as term
  )
  select profile.id,
         coalesce(profile.full_name, 'TOL member')::text,
         profile.niche::text,
         profile.category::text,
         profile.other_niche::text,
         profile.lga::text,
         profile.community::text,
         array(
           select jsonb_array_elements_text(coalesce(to_jsonb(profile.skills), '[]'::jsonb))
         ),
         coalesce((
           select case
             when request.status = 'accepted' then 'connected'
             when request.requester_id = auth.uid() then 'request_sent'
             else 'request_received'
           end
           from public.network_requests request
           where request.status in ('pending', 'accepted')
             and (
               (request.requester_id = auth.uid() and request.recipient_id = profile.id)
               or (request.requester_id = profile.id and request.recipient_id = auth.uid())
             )
           limit 1
         ), 'none')::text
  from public.profiles profile
  cross join search_input
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and (niche_filter is null or profile.niche = niche_filter)
    and (lga_filter is null or profile.lga = lga_filter)
    and (
      search_input.term = ''
      or strpos(lower(coalesce(profile.full_name, '')), search_input.term) > 0
      or strpos(lower(coalesce(profile.community, '')), search_input.term) > 0
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(to_jsonb(profile.skills), '[]'::jsonb)) as skill_value(value)
        where strpos(lower(skill_value.value), search_input.term) > 0
      )
    )
  order by profile.full_name
  limit 100;
$$;

create or replace function public.get_my_network_requests()
returns table (
  request_id uuid,
  requester_id uuid,
  full_name text,
  niche text,
  lga text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select request.id,
         profile.id,
         profile.full_name::text,
         profile.niche::text,
         profile.lga::text,
         request.created_at
  from public.network_requests request
  join public.profiles profile on profile.id = request.requester_id
  where auth.uid() is not null
    and request.recipient_id = auth.uid()
    and request.status = 'pending'
    and profile.status = 'active'
    and not public.is_blocked(auth.uid(), request.requester_id)
  order by request.created_at;
$$;

revoke all on function public.search_discover_profiles(text, text, text) from public;
grant execute on function public.search_discover_profiles(text, text, text) to authenticated;
revoke all on function public.get_my_network_requests() from public;
grant execute on function public.get_my_network_requests() to authenticated;
revoke all on function public.send_network_request(uuid) from public, anon;
grant execute on function public.send_network_request(uuid) to authenticated;
revoke all on function public.respond_network_request(uuid, boolean) from public, anon;
grant execute on function public.respond_network_request(uuid, boolean) to authenticated;
