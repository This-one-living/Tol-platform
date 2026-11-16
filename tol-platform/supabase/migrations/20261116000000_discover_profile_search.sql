create or replace function public.search_discover_profiles(
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
  skills text[]
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
         )
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

revoke all on function public.search_discover_profiles(text, text, text) from public;
grant execute on function public.search_discover_profiles(text, text, text) to authenticated;
