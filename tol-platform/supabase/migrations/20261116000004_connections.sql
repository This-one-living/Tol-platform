create or replace function public.get_my_connections()
returns table (
  user_id uuid,
  full_name text,
  phone text,
  lga text,
  niche text,
  skills text[],
  interests text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.id,
         profile.full_name::text,
         nullif(profile.phone, '')::text,
         profile.lga::text,
         profile.niche::text,
         coalesce(profile.skills, array[]::text[]),
         coalesce(profile.interests, array[]::text[])
  from public.network_requests request
  join public.profiles profile
    on profile.id = case
      when request.requester_id = auth.uid() then request.recipient_id
      else request.requester_id
    end
  where auth.uid() is not null
    and request.status = 'accepted'
    and (request.requester_id = auth.uid() or request.recipient_id = auth.uid())
    and profile.status = 'active'
    and not public.is_blocked(auth.uid(), profile.id)
  order by profile.full_name;
$$;

revoke all on function public.get_my_connections() from public;
grant execute on function public.get_my_connections() to authenticated;
