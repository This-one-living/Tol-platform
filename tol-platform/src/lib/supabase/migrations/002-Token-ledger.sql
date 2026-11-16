-- TOL migration 002: Token Coin ledger (Priority 1), audit log, hardening of 001.
-- Rules enforced IN THE DATABASE:
--   * 0.1 token per sender per qualifying minute (unique index = hard guarantee)
--   * receiving never earns; only a sent message in an accepted, non-blocked connection
--   * client cannot set created_at, cannot touch balances or the ledger
--   * ledger is append-only; corrections are new rows, logged in admin_audit_log

-- ------------------------------------------------------------ settings
create table public.platform_settings (
  key   text primary key,
  value numeric not null,
  note  text
);
insert into public.platform_settings (key, value, note) values
  ('token_per_minute',    0.1, 'Token Coins per qualifying minute'),
  ('naira_per_token',     4,   'Reference value only. Not a cash liability.'),
  ('msg_rate_limit_60s',  20,  'Max messages one member may send in any 60 seconds'),
  ('flag_minutes_per_day',240, 'Flag members earning in more than this many minutes/day');
alter table public.platform_settings enable row level security;
create policy settings_read  on public.platform_settings for select using (auth.uid() is not null);
create policy settings_admin on public.platform_settings for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.setting(p_key text)
returns numeric language sql stable security definer set search_path = public as $$
  select value from public.platform_settings where key = p_key;
$$;

-- ------------------------------------------------------------ audit log
create table public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users(id),
  action      text not null,
  target_type text,
  target_id   uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
create policy audit_read on public.admin_audit_log for select using (public.is_admin());
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;

-- ------------------------------------------------------------ ledger
alter table public.profiles add column token_balance numeric(14,4) not null default 0;
-- (not in any column grant from 001, so members cannot write it)

create table public.token_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  entry_type    text not null check (entry_type in ('earn','adjustment','reversal')),
  amount        numeric(14,4) not null,
  minute_bucket timestamptz,                       -- set for 'earn' only
  message_id    uuid references public.messages(id) on delete set null,
  counterpart_id uuid references public.profiles(id) on delete set null,
  reverses_id   uuid references public.token_ledger(id),
  status        text not null default 'credited' check (status in ('credited')),
  reason        text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  check ((entry_type = 'earn' and minute_bucket is not null and amount > 0)
      or (entry_type <> 'earn'))
);
-- THE rule: one earn per sender per minute, enforced by the database.
create unique index token_one_earn_per_minute
  on public.token_ledger (user_id, minute_bucket) where entry_type = 'earn';
-- A ledger row can be reversed at most once.
create unique index token_reversal_once
  on public.token_ledger (reverses_id) where reverses_id is not null;
create index token_ledger_user_idx on public.token_ledger (user_id, created_at desc);

-- Append-only, even for the table owner / admins
create or replace function public.token_ledger_immutable()
returns trigger language plpgsql as $$
begin raise exception 'token_ledger is append-only'; end $$;
create trigger token_ledger_no_update before update or delete on public.token_ledger
  for each row execute function public.token_ledger_immutable();

-- Balance is maintained by the database from ledger inserts only
create or replace function public.token_ledger_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set token_balance = token_balance + new.amount where id = new.user_id;
  return new;
end $$;
create trigger token_ledger_balance after insert on public.token_ledger
  for each row execute function public.token_ledger_apply();

alter table public.token_ledger enable row level security;
create policy ledger_own   on public.token_ledger for select using (user_id = auth.uid());
create policy ledger_admin on public.token_ledger for select using (public.is_admin());
revoke insert, update, delete on public.token_ledger from anon, authenticated;

-- ------------------------------------------------------------ messages hardening
-- Client may only supply who/what; never created_at (would allow backdating to farm minutes).
revoke insert on public.messages from anon, authenticated;
grant insert (sender_id, recipient_id, body) on public.messages to authenticated;

create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.read_at    := null;
  new.deleted_at := null;
  if (select count(*) from messages
       where sender_id = new.sender_id and created_at > now() - interval '60 seconds')
     >= public.setting('msg_rate_limit_60s') then
    raise exception 'You are sending messages too fast. Please slow down.';
  end if;
  return new;
end $$;
create trigger messages_guard before insert on public.messages
  for each row execute function public.messages_before_insert();

-- Award: runs AFTER INSERT, server-side, with the same eligibility as the message policy.
create or replace function public.messages_award_tokens()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null
     and exists (select 1 from profiles where id = new.sender_id    and status = 'active')
     and exists (select 1 from profiles where id = new.recipient_id and status = 'active')
     and exists (select 1 from network_requests
                  where status = 'accepted'
                    and ((requester_id = new.sender_id and recipient_id = new.recipient_id)
                      or (requester_id = new.recipient_id and recipient_id = new.sender_id)))
     and not exists (select 1 from blocks
                      where (blocker_id = new.sender_id and blocked_id = new.recipient_id)
                         or (blocker_id = new.recipient_id and blocked_id = new.sender_id))
  then
    insert into token_ledger (user_id, entry_type, amount, minute_bucket, message_id, counterpart_id)
    values (new.sender_id, 'earn', public.setting('token_per_minute'),
            date_trunc('minute', new.created_at), new.id, new.recipient_id)
    on conflict (user_id, minute_bucket) where entry_type = 'earn' do nothing;
  end if;
  return new;
end $$;
create trigger messages_award after insert on public.messages
  for each row execute function public.messages_award_tokens();

-- ------------------------------------------------------------ member read API
create or replace function public.my_token_summary()
returns table (balance numeric, earned_today_minutes int, per_minute numeric,
               naira_per_token numeric, redemption_status text)
language sql stable security definer set search_path = public as $$
  select p.token_balance,
         (select count(*)::int from token_ledger l
           where l.user_id = p.id and l.entry_type = 'earn'
             and l.created_at >= date_trunc('day', now())),
         public.setting('token_per_minute'), public.setting('naira_per_token'), 'coming_soon'
    from profiles p where p.id = auth.uid();
$$;

-- ------------------------------------------------------------ admin tools
create or replace function public.admin_adjust_tokens(p_user uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if p_amount = 0 then raise exception 'Amount cannot be zero'; end if;
  insert into token_ledger (user_id, entry_type, amount, reason, created_by)
    values (p_user, 'adjustment', p_amount, p_reason, auth.uid()) returning id into lid;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'token_adjust', 'user', p_user,
            jsonb_build_object('amount', p_amount, 'reason', p_reason, 'ledger_id', lid));
  return lid;
end $$;

create or replace function public.admin_reverse_token_entry(p_ledger uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r token_ledger; lid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into r from token_ledger where id = p_ledger;
  if not found or r.entry_type = 'reversal' then raise exception 'Entry not found or not reversible'; end if;
  insert into token_ledger (user_id, entry_type, amount, reverses_id, reason, created_by)
    values (r.user_id, 'reversal', -r.amount, r.id, p_reason, auth.uid()) returning id into lid;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'token_reverse', 'user', r.user_id,
            jsonb_build_object('reversed', r.id, 'amount', -r.amount, 'reason', p_reason));
  return lid;
end $$;

-- Members whose balance does not equal the ledger sum (should always be empty)
create or replace function public.admin_token_reconcile()
returns table (user_id uuid, balance numeric, ledger_sum numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.token_balance, coalesce(s.total, 0)
    from profiles p
    left join (select l.user_id, sum(l.amount) total from token_ledger l group by l.user_id) s on s.user_id = p.id
   where public.is_admin() and p.token_balance <> coalesce(s.total, 0);
$$;

-- Abuse flags: heavy daily earners, or earning almost only with one partner
create or replace function public.admin_suspicious_token_activity(p_days int default 7)
returns table (user_id uuid, full_name text, day date, earn_minutes int,
               top_partner_id uuid, top_partner_share numeric, reason text)
language sql stable security definer set search_path = public as $$
  with d as (
    select l.user_id, (l.created_at at time zone 'Africa/Lagos')::date as day,
           count(*)::int as mins
      from token_ledger l
     where l.entry_type = 'earn' and l.created_at > now() - make_interval(days => p_days)
     group by 1, 2
  ), partner as (
    select distinct on (l.user_id, (l.created_at at time zone 'Africa/Lagos')::date)
           l.user_id, (l.created_at at time zone 'Africa/Lagos')::date as day,
           l.counterpart_id, count(*) over (partition by l.user_id, (l.created_at at time zone 'Africa/Lagos')::date, l.counterpart_id) as c
      from token_ledger l
     where l.entry_type = 'earn' and l.created_at > now() - make_interval(days => p_days)
     order by l.user_id, (l.created_at at time zone 'Africa/Lagos')::date,
              count(*) over (partition by l.user_id, (l.created_at at time zone 'Africa/Lagos')::date, l.counterpart_id) desc
  )
  select d.user_id, p.full_name, d.day, d.mins, pt.counterpart_id,
         round(pt.c::numeric / d.mins, 2),
         case when d.mins > public.setting('flag_minutes_per_day') then 'very high daily minutes'
              else 'almost all earnings with one partner' end
    from d
    join partner pt on pt.user_id = d.user_id and pt.day = d.day
    join profiles p on p.id = d.user_id
   where public.is_admin()
     and (d.mins > public.setting('flag_minutes_per_day') or (d.mins >= 60 and pt.c::numeric / d.mins >= 0.95))
   order by d.mins desc;
$$;

-- ------------------------------------------------------------ privacy hardening of 001 helpers
-- is_blocked / are_connected were callable by anyone for any pair (could probe other people's
-- connections). Restrict them to pairs that include the caller. Server contexts (auth.uid() null) are unaffected.
create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or auth.uid() in (a, b))
     and exists (select 1 from public.network_requests
                  where status = 'accepted'
                    and ((requester_id = a and recipient_id = b) or (requester_id = b and recipient_id = a)));
$$;
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or auth.uid() in (a, b))
     and exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
create or replace function public.network_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.network_requests
   where status = 'accepted' and (requester_id = p_user or recipient_id = p_user)
     and (p_user = auth.uid() or public.is_admin()
          or exists (select 1 from public.profiles p where p.id = p_user and p.network_list_visibility <> 'hidden'));
$$;

-- Lock function execution to signed-in members (anon/public get nothing)
revoke all on function public.are_connected(uuid,uuid)  from public, anon;
revoke all on function public.is_blocked(uuid,uuid)     from public, anon;
revoke all on function public.network_count(uuid)       from public, anon;
-- NOTE: is_admin()/is_staff() stay callable by anon: reference-table policies call them at signup (they just return false).
revoke all on function public.setting(text)             from public, anon;
revoke all on function public.my_token_summary()        from public, anon;
revoke all on function public.admin_adjust_tokens(uuid,numeric,text)     from public, anon;
revoke all on function public.admin_reverse_token_entry(uuid,text)       from public, anon;
revoke all on function public.admin_token_reconcile()                    from public, anon;
revoke all on function public.admin_suspicious_token_activity(int)       from public, anon;
grant execute on function public.are_connected(uuid,uuid), public.is_blocked(uuid,uuid),
  public.network_count(uuid), public.setting(text),
  public.my_token_summary(), public.admin_adjust_tokens(uuid,numeric,text),
  public.admin_reverse_token_entry(uuid,text), public.admin_token_reconcile(),
  public.admin_suspicious_token_activity(int) to authenticated;

-- Live balance updates: the member's own ledger rows stream to them (RLS applies)
alter publication supabase_realtime add table public.token_ledger;
