create table if not exists public.builtin_groups (
  id uuid primary key default gen_random_uuid(),
  group_type text not null check (group_type in ('niche', 'lga')),
  group_value text not null,
  created_at timestamptz not null default now(),
  unique (group_type, group_value)
);

create table if not exists public.builtin_group_memberships (
  group_id uuid not null references public.builtin_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists builtin_group_memberships_user_id_idx
  on public.builtin_group_memberships (user_id, group_id);

insert into public.builtin_groups (group_type, group_value) values
  ('niche', 'Technology / Digital Innovation'),
  ('niche', 'Creative Arts / Entertainment'),
  ('niche', 'Business / Entrepreneurship'),
  ('niche', 'Health / Medicine'),
  ('niche', 'Engineering'),
  ('niche', 'Education / Research'),
  ('niche', 'Agriculture / Agribusiness'),
  ('niche', 'Food / Hospitality'),
  ('niche', 'Construction / Real Estate'),
  ('niche', 'Law / Governance'),
  ('niche', 'Science / Research'),
  ('niche', 'Finance / Accounting'),
  ('niche', 'Media / Communication'),
  ('niche', 'Sports / Fitness'),
  ('niche', 'Fashion / Beauty'),
  ('niche', 'Transportation / Logistics'),
  ('niche', 'Skilled Trades'),
  ('niche', 'Students / Academic Development'),
  ('niche', 'Personal Development'),
  ('niche', 'Other'),
  ('lga', 'Abakaliki'),
  ('lga', 'Afikpo North'),
  ('lga', 'Afikpo South'),
  ('lga', 'Ebonyi'),
  ('lga', 'Ezza North'),
  ('lga', 'Ezza South'),
  ('lga', 'Ikwo'),
  ('lga', 'Ishielu'),
  ('lga', 'Ivo'),
  ('lga', 'Izzi'),
  ('lga', 'Ohaozara'),
  ('lga', 'Ohaukwu'),
  ('lga', 'Onicha')
on conflict (group_type, group_value) do nothing;

alter table public.builtin_groups enable row level security;
alter table public.builtin_group_memberships enable row level security;

drop policy if exists "Authenticated users can view built-in groups" on public.builtin_groups;
create policy "Authenticated users can view built-in groups"
  on public.builtin_groups for select to authenticated
  using (true);

drop policy if exists "Users can view their own built-in group memberships" on public.builtin_group_memberships;
create policy "Users can view their own built-in group memberships"
  on public.builtin_group_memberships for select to authenticated
  using (user_id = auth.uid());

grant select on public.builtin_groups, public.builtin_group_memberships to authenticated;

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
  order by builtin_group.group_type, builtin_group.group_value;
$$;

create or replace function public.join_builtin_group(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to join a group.';
  end if;

  if not exists (
    select 1 from public.builtin_groups builtin_group where builtin_group.id = target_group_id
  ) then
    raise exception 'That group could not be found.';
  end if;

  insert into public.builtin_group_memberships (group_id, user_id)
  values (target_group_id, auth.uid())
  on conflict do nothing;
end;
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

  delete from public.builtin_group_memberships
  where group_id = target_group_id
    and user_id = auth.uid();
end;
$$;

revoke all on function public.get_builtin_groups(text, text) from public;
revoke all on function public.join_builtin_group(uuid) from public;
revoke all on function public.leave_builtin_group(uuid) from public;
grant execute on function public.get_builtin_groups(text, text) to authenticated;
grant execute on function public.join_builtin_group(uuid) to authenticated;
grant execute on function public.leave_builtin_group(uuid) to authenticated;
