alter table public.builtin_groups
  drop constraint if exists builtin_groups_group_type_check;
alter table public.builtin_groups
  add constraint builtin_groups_group_type_check
  check (group_type in ('general', 'niche', 'lga'));

insert into public.builtin_groups (group_type, group_value)
values ('general', 'General')
on conflict (group_type, group_value) do nothing;

create or replace function public.add_default_builtin_groups()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.builtin_group_memberships (group_id, user_id)
  select builtin_group.id, new.id
    from public.builtin_groups builtin_group
   where (builtin_group.group_type = 'general' and builtin_group.group_value = 'General')
      or (builtin_group.group_type = 'niche' and builtin_group.group_value = new.niche)
      or (builtin_group.group_type = 'lga' and builtin_group.group_value = new.lga)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_add_default_builtin_groups on public.profiles;
create trigger profiles_add_default_builtin_groups
  after insert or update of niche, lga on public.profiles
  for each row execute function public.add_default_builtin_groups();
revoke all on function public.add_default_builtin_groups() from public, anon, authenticated;

insert into public.builtin_group_memberships (group_id, user_id)
select builtin_group.id, profile.id
  from public.builtin_groups builtin_group
 cross join public.profiles profile
 where (builtin_group.group_type = 'general' and builtin_group.group_value = 'General')
    or (builtin_group.group_type = 'niche' and builtin_group.group_value = profile.niche)
    or (builtin_group.group_type = 'lga' and builtin_group.group_value = profile.lga)
on conflict do nothing;

create or replace function public.get_builtin_groups(
  search_text text default '',
  group_type_filter text default null
)
returns table (
  group_id uuid,
  group_type text,
  group_value text,
  member_count bigint,
  is_member boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select builtin_group.id,
         builtin_group.group_type,
         builtin_group.group_value,
         count(membership.user_id)::bigint,
         coalesce(bool_or(membership.user_id = auth.uid()), false)
    from public.builtin_groups builtin_group
    left join public.builtin_group_memberships membership
      on membership.group_id = builtin_group.id
   where auth.uid() is not null
     and (group_type_filter is null or builtin_group.group_type = group_type_filter)
     and (
       nullif(btrim(coalesce(search_text, '')), '') is null
       or strpos(lower(builtin_group.group_value), lower(btrim(search_text))) > 0
     )
   group by builtin_group.id
   order by case when builtin_group.group_type = 'general' then 0
                 when builtin_group.group_type = 'niche' then 1
                 else 2 end,
            builtin_group.group_value;
$$;

create or replace function public.leave_builtin_group(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to leave a group.';
  end if;
  if exists (
    select 1 from public.builtin_groups
     where id = target_group_id and group_type = 'general'
  ) then
    raise exception 'The General community is for all members and cannot be left.';
  end if;
  delete from public.builtin_group_memberships
   where group_id = target_group_id and user_id = auth.uid();
end;
$$;
