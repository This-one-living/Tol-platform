create table if not exists public.account_activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'account_created',
    'signed_in',
    'signed_out',
    'password_changed',
    'password_reset',
    'profile_updated',
    'profile_photo_updated',
    'joined_group',
    'left_group'
  )),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists account_activity_log_user_created_idx
  on public.account_activity_log (user_id, created_at desc);

alter table public.account_activity_log enable row level security;

create or replace function public.record_new_profile_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.account_activity_log (user_id, event_type)
  values (new.id, 'account_created');
  return new;
end;
$$;

revoke all on function public.record_new_profile_activity() from public;

drop trigger if exists record_new_profile_activity on public.profiles;
create trigger record_new_profile_activity
  after insert on public.profiles
  for each row execute function public.record_new_profile_activity();

drop policy if exists "Users can view their own account activity" on public.account_activity_log;
create policy "Users can view their own account activity"
  on public.account_activity_log for select to authenticated
  using (user_id = auth.uid());

create or replace function public.log_account_activity(
  activity_type text,
  target_group_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  activity_details jsonb := '{}'::jsonb;
  target_group_type text;
  target_group_value text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to record account activity.';
  end if;

  if activity_type not in (
    'account_created',
    'signed_in',
    'signed_out',
    'password_changed',
    'password_reset',
    'profile_updated',
    'profile_photo_updated',
    'joined_group',
    'left_group'
  ) then
    raise exception 'Unsupported account activity type.';
  end if;

  if activity_type in ('joined_group', 'left_group') then
    select group_record.group_type, group_record.group_value
    into target_group_type, target_group_value
    from public.builtin_groups group_record
    where group_record.id = target_group_id;

    if not found then
      raise exception 'That group could not be found.';
    end if;

    activity_details := jsonb_build_object(
      'group_type', target_group_type,
      'group_value', target_group_value
    );
  elsif target_group_id is not null then
    raise exception 'A group can only be attached to a group activity.';
  end if;

  insert into public.account_activity_log (user_id, event_type, details)
  values (current_user_id, activity_type, activity_details);
end;
$$;

create or replace function public.get_my_activity(result_limit integer default 50)
returns table (
  id bigint,
  event_type text,
  details jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select activity.id, activity.event_type, activity.details, activity.created_at
  from public.account_activity_log activity
  where auth.uid() is not null
    and activity.user_id = auth.uid()
  order by activity.created_at desc, activity.id desc
  limit greatest(1, least(coalesce(result_limit, 50), 100));
$$;

revoke all on function public.log_account_activity(text, uuid) from public;
revoke all on function public.get_my_activity(integer) from public;
grant execute on function public.log_account_activity(text, uuid) to authenticated;
grant execute on function public.get_my_activity(integer) to authenticated;
