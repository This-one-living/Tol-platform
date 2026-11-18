-- TOL migration 006: restore capped message-minute rewards and retire the
-- task-reward and Marketplace APIs from migration 005.
-- Run after migrations 001-005 and the direct-messaging migration.

-- Keep any past task submissions available as an archive; the earning/review APIs are retired.
drop function if exists public.submit_tol_activity(text,text);
drop function if exists public.my_token_activities();
drop function if exists public.admin_list_tol_activities(text);
drop function if exists public.admin_review_tol_activity(uuid,text,text);
do $$
begin
  if to_regclass('public.tol_activity_submissions') is not null
     and to_regclass('public.tol_activity_submissions_archive') is null then
    alter table public.tol_activity_submissions rename to tol_activity_submissions_archive;
  end if;
end $$;
delete from public.platform_settings where key = 'daily_activity_reward';

drop function if exists public.list_marketplace_listings(text,text,int,int);
drop function if exists public.create_marketplace_listing(text,text,text,numeric);
drop function if exists public.delete_own_marketplace_listing(uuid);
-- The Marketplace feature and its listing data are intentionally removed.
drop table if exists public.marketplace_listings;

-- Existing daily task credits, if any, remain in the immutable ledger and balance.
insert into public.platform_settings (key, value, note) values
  ('token_per_minute', 0.1, 'TOL Coins per qualifying message minute'),
  ('naira_per_token', 4, 'Reference value only; redemption is coming soon'),
  ('token_daily_minute_cap', 1440, 'Maximum qualifying message minutes credited per Lagos-local day')
on conflict (key) do update set value = excluded.value, note = excluded.note;

-- Works with both the legacy sender/recipient message row and the current
-- conversation_id row; current direct conversations must have exactly two participants.
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  message_data jsonb;
  sender uuid;
begin
  message_data := to_jsonb(new);
  sender := nullif(message_data->>'sender_id', '')::uuid;
  if sender is null then raise exception 'A sender is required'; end if;

  if (select count(*) from public.messages
       where sender_id = sender and created_at > now() - interval '60 seconds')
     >= public.setting('msg_rate_limit_60s') then
    raise exception 'You are sending messages too fast. Please slow down.';
  end if;

  new.created_at := now();
  return new;
end $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.messages_award_tokens()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  message_data jsonb;
  sender uuid;
  recipient uuid;
  conversation uuid;
  message_id uuid;
  posted_at timestamptz;
  message_body text;
  participant_count int;
  minute_count int;
  local_day date;
begin
  message_data := to_jsonb(new);
  sender := nullif(message_data->>'sender_id', '')::uuid;
  message_id := nullif(message_data->>'id', '')::uuid;
  conversation := nullif(message_data->>'conversation_id', '')::uuid;
  recipient := nullif(message_data->>'recipient_id', '')::uuid;
  posted_at := coalesce(nullif(message_data->>'created_at', '')::timestamptz, now());
  message_body := message_data->>'body';

  if sender is null or message_id is null or btrim(coalesce(message_body, '')) = ''
     or nullif(message_data->>'deleted_at', '') is not null then
    return new;
  end if;

  if conversation is not null then
    select count(*)::int into participant_count
      from public.conversation_participants
     where conversation_id = conversation;
    if participant_count <> 2
       or not exists (
         select 1 from public.conversation_participants
          where conversation_id = conversation and user_id = sender
       ) then
      return new;
    end if;
    select user_id into recipient
      from public.conversation_participants
     where conversation_id = conversation and user_id <> sender
     limit 1;
  end if;

  if recipient is null or recipient = sender
     or not exists (select 1 from profiles where id = sender and status = 'active')
     or not exists (select 1 from profiles where id = recipient and status = 'active')
     or not exists (
       select 1 from network_requests
        where status = 'accepted'
          and ((requester_id = sender and recipient_id = recipient)
            or (requester_id = recipient and recipient_id = sender))
     )
     or exists (
       select 1 from blocks
        where (blocker_id = sender and blocked_id = recipient)
           or (blocker_id = recipient and blocked_id = sender)
     ) then
    return new;
  end if;

  -- Serialize per member so simultaneous sends cannot exceed the daily cap.
  perform 1 from profiles where id = sender for update;
  local_day := (posted_at at time zone 'Africa/Lagos')::date;
  select count(*)::int into minute_count
    from token_ledger
   where user_id = sender and entry_type = 'earn' and minute_bucket is not null
     and (minute_bucket at time zone 'Africa/Lagos')::date = local_day;
  if minute_count >= public.setting('token_daily_minute_cap') then
    return new;
  end if;

  insert into token_ledger (user_id, entry_type, amount, minute_bucket, message_id, counterpart_id)
    values (sender, 'earn', public.setting('token_per_minute'),
            date_trunc('minute', posted_at), message_id, recipient)
    on conflict (user_id, minute_bucket) where entry_type = 'earn' do nothing;
  return new;
end $$;

drop trigger if exists messages_award on public.messages;
create trigger messages_award after insert on public.messages
  for each row execute function public.messages_award_tokens();

revoke all on function public.messages_before_insert() from public, anon, authenticated;
revoke all on function public.messages_award_tokens() from public, anon, authenticated;

drop function if exists public.my_token_summary();
create function public.my_token_summary()
returns table (
  balance numeric, earned_today_minutes int, per_minute numeric,
  naira_per_token numeric, daily_cap_minutes int, redemption_status text
)
language sql stable security definer set search_path = public as $$
  select p.token_balance,
         (select count(*)::int from token_ledger l
           where l.user_id = p.id and l.entry_type = 'earn' and l.minute_bucket is not null
             and (l.minute_bucket at time zone 'Africa/Lagos')::date =
                 (now() at time zone 'Africa/Lagos')::date),
         public.setting('token_per_minute'), public.setting('naira_per_token'),
         public.setting('token_daily_minute_cap')::int, 'coming_soon'
    from profiles p where p.id = auth.uid();
$$;
revoke all on function public.my_token_summary() from public, anon;
grant execute on function public.my_token_summary() to authenticated;
