-- TOL migration 003: TOL Community Savings (voluntary, record-keeping only) + storage buckets.
-- The software records member-submitted payments and admin-CONFIRMED contributions.
-- It never collects, holds or moves money. A screenshot is a claim, not proof: an admin must
-- verify the real transaction in the receiving account before approving.
--
-- Run AFTER 001 and 002.

-- ------------------------------------------------------------ config
create table public.savings_config (
  id                   int primary key default 1 check (id = 1),
  programme_name       text not null default 'TOL Community Savings',
  payment_instructions text,          -- account details: ADMIN MUST ENTER (not provided in brief)
  rules_text           text,          -- published written rules (custody, withdrawals, fees, exit...)
  is_open              boolean not null default false   -- stays closed until admin opens it
);
insert into public.savings_config (id) values (1);
alter table public.savings_config enable row level security;
create policy savings_config_read  on public.savings_config for select using (auth.uid() is not null);
create policy savings_config_admin on public.savings_config for all using (public.is_admin()) with check (public.is_admin());

insert into public.platform_settings (key, value, note) values
  ('savings_min_amount', 100,       'Minimum single savings submission (NGN). Confirm with client.'),
  ('savings_max_amount', 5000000,   'Maximum single savings submission (NGN). Confirm with client.');

-- ------------------------------------------------------------ membership (voluntary)
create table public.savings_members (
  user_id        uuid primary key references public.profiles(id) on delete restrict,
  reference_code text not null unique,      -- member quotes this in the transfer description
  joined_at      timestamptz not null default now(),
  left_at        timestamptz
);
alter table public.savings_members enable row level security;
create policy savings_members_own   on public.savings_members for select using (user_id = auth.uid());
create policy savings_members_admin on public.savings_members for select using (public.is_admin());
revoke insert, update, delete on public.savings_members from anon, authenticated;

-- ------------------------------------------------------------ submissions
create table public.savings_submissions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete restrict,
  amount             numeric(14,2) not null check (amount > 0),
  transfer_reference text not null check (char_length(btrim(transfer_reference)) between 4 and 64),
  paid_at            timestamptz not null,
  proof_path         text not null,
  member_note        text check (char_length(member_note) <= 1000),
  status             text not null default 'pending'
                      check (status in ('pending','approved','rejected','clarification')),
  admin_note         text,
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
-- The same bank transfer reference (or the same proof file) cannot be live twice.
-- Rejected claims free the reference so a corrected submission is possible.
create unique index savings_ref_live_uniq
  on public.savings_submissions (lower(btrim(transfer_reference))) where status <> 'rejected';
create unique index savings_proof_live_uniq
  on public.savings_submissions (proof_path) where status <> 'rejected';
create index savings_sub_user_idx   on public.savings_submissions (user_id, created_at desc);
create index savings_sub_status_idx on public.savings_submissions (status, created_at);

alter table public.savings_submissions enable row level security;
create policy savings_sub_own   on public.savings_submissions for select using (user_id = auth.uid());
create policy savings_sub_admin on public.savings_submissions for select using (public.is_admin());
revoke insert, update, delete on public.savings_submissions from anon, authenticated;

-- ------------------------------------------------------------ confirmed ledger (append-only)
alter table public.profiles add column savings_total numeric(14,2) not null default 0;

create table public.savings_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  entry_type    text not null check (entry_type in ('contribution','adjustment','reversal')),
  amount        numeric(14,2) not null check (amount <> 0),
  submission_id uuid references public.savings_submissions(id),
  reverses_id   uuid references public.savings_ledger(id),
  reason        text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  check (entry_type <> 'contribution' or (submission_id is not null and amount > 0)),
  check (entry_type = 'contribution' or coalesce(btrim(reason), '') <> '')
);
-- A submission can be credited at most once.
create unique index savings_credit_once on public.savings_ledger (submission_id) where entry_type = 'contribution';
create unique index savings_reversal_once on public.savings_ledger (reverses_id) where reverses_id is not null;
create index savings_ledger_user_idx on public.savings_ledger (user_id, created_at desc);

create trigger savings_ledger_no_update before update or delete on public.savings_ledger
  for each row execute function public.token_ledger_immutable();   -- generic "append-only" trigger from 002

create or replace function public.savings_ledger_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set savings_total = savings_total + new.amount where id = new.user_id;
  return new;
end $$;
create trigger savings_ledger_balance after insert on public.savings_ledger
  for each row execute function public.savings_ledger_apply();

alter table public.savings_ledger enable row level security;
create policy savings_ledger_own   on public.savings_ledger for select using (user_id = auth.uid());
create policy savings_ledger_admin on public.savings_ledger for select using (public.is_admin());
revoke insert, update, delete on public.savings_ledger from anon, authenticated;

-- ------------------------------------------------------------ storage buckets
-- Private proof bucket: images + PDF, 5 MB. Path convention: <user_id>/<anything>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('savings-proof', 'savings-proof', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- Public avatar bucket (profile pictures only): images, 2 MB. Path: <user_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Proof: upload into your own folder only; read your own folder or (admin) any. No update/delete,
-- so evidence cannot be swapped after submission.
create policy proof_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'savings-proof' and (storage.foldername(name))[1] = auth.uid()::text);
create policy proof_select on storage.objects for select to authenticated
  using (bucket_id = 'savings-proof'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy avatar_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_select on storage.objects for select using (bucket_id = 'avatars');

-- ------------------------------------------------------------ member API
create or replace function public.join_savings()
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); code text;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then raise exception 'Account not active'; end if;
  if not (select is_open from savings_config where id = 1) then
    raise exception 'The savings programme is not open yet';
  end if;
  select reference_code into code from savings_members where user_id = me;
  if found then
    update savings_members set left_at = null where user_id = me;   -- re-join keeps the same code
    return code;
  end if;
  loop
    code := 'TOL-' || upper(substr(md5(random()::text || me::text || clock_timestamp()::text), 1, 6));
    begin
      insert into savings_members (user_id, reference_code) values (me, code);
      return code;
    exception when unique_violation then
      if exists (select 1 from savings_members where user_id = me) then return code; end if;  -- else code clash: retry
    end;
  end loop;
end $$;

create or replace function public.leave_savings()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from savings_submissions where user_id = auth.uid() and status in ('pending','clarification')) then
    raise exception 'Please wait until your pending submissions are resolved before opting out';
  end if;
  update savings_members set left_at = now() where user_id = auth.uid() and left_at is null;
  if not found then raise exception 'You are not in the savings programme'; end if;
end $$;

create or replace function public.submit_savings(
  p_amount numeric, p_reference text, p_paid_at timestamptz, p_proof_path text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sid uuid; nm text; adm record;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then raise exception 'Account not active'; end if;
  if not exists (select 1 from savings_members where user_id = me and left_at is null) then
    raise exception 'Join the savings programme first';
  end if;
  if p_amount is null or p_amount < setting('savings_min_amount') or p_amount > setting('savings_max_amount') then
    raise exception 'Amount must be between % and %', setting('savings_min_amount'), setting('savings_max_amount');
  end if;
  if p_paid_at > now() + interval '5 minutes' or p_paid_at < now() - interval '90 days' then
    raise exception 'Payment date must be within the last 90 days and not in the future';
  end if;
  if char_length(btrim(coalesce(p_reference,''))) < 4 then raise exception 'Enter the bank transaction reference'; end if;
  if split_part(coalesce(p_proof_path,''), '/', 1) <> me::text
     or not exists (select 1 from storage.objects where bucket_id = 'savings-proof' and name = p_proof_path) then
    raise exception 'Upload your proof of payment first';
  end if;
  if (select count(*) from savings_submissions where user_id = me and status in ('pending','clarification')) >= 10 then
    raise exception 'You have too many unresolved submissions';
  end if;
  begin
    insert into savings_submissions (user_id, amount, transfer_reference, paid_at, proof_path, member_note)
    values (me, round(p_amount, 2), btrim(p_reference), p_paid_at, p_proof_path, p_note) returning id into sid;
  exception when unique_violation then
    raise exception 'This transfer reference or proof file has already been submitted';
  end;
  select full_name into nm from profiles where id = me;
  perform notify(me, 'savings_received', 'Savings submission received',
                 'Your payment of NGN ' || round(p_amount, 2) || ' is awaiting admin confirmation.',
                 jsonb_build_object('submission_id', sid));
  for adm in select user_id from user_roles where role = 'admin' loop
    perform notify(adm.user_id, 'savings_admin_new', 'New savings submission',
                   nm || ' submitted NGN ' || round(p_amount, 2), jsonb_build_object('submission_id', sid));
  end loop;
  return sid;
end $$;

-- Member answers an admin's clarification request (optionally with a corrected proof file)
create or replace function public.respond_savings_clarification(p_id uuid, p_note text, p_proof_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if coalesce(btrim(p_note),'') = '' then raise exception 'Please add a note'; end if;
  if p_proof_path is not null and (split_part(p_proof_path, '/', 1) <> me::text
     or not exists (select 1 from storage.objects where bucket_id = 'savings-proof' and name = p_proof_path)) then
    raise exception 'Upload your proof of payment first';
  end if;
  begin
    update savings_submissions
       set status = 'pending', member_note = p_note, proof_path = coalesce(p_proof_path, proof_path)
     where id = p_id and user_id = me and status = 'clarification';
  exception when unique_violation then
    raise exception 'This proof file has already been submitted';
  end;
  if not found then raise exception 'Submission not found or not awaiting clarification'; end if;
end $$;

create or replace function public.my_savings_summary()
returns table (joined boolean, reference_code text, confirmed_total numeric, pending_count int,
               pending_amount numeric, programme_open boolean, programme_name text,
               payment_instructions text, rules_text text, show_on_profile boolean)
language sql stable security definer set search_path = public as $$
  select (m.user_id is not null and m.left_at is null),
         m.reference_code,
         case when m.user_id is not null then p.savings_total else 0 end,
         (select count(*)::int from savings_submissions s where s.user_id = p.id and s.status in ('pending','clarification')),
         coalesce((select sum(s.amount) from savings_submissions s where s.user_id = p.id and s.status in ('pending','clarification')), 0),
         c.is_open, c.programme_name,
         case when m.user_id is not null and m.left_at is null then c.payment_instructions end,
         c.rules_text, p.show_savings
    from profiles p
    cross join savings_config c
    left join savings_members m on m.user_id = p.id
   where p.id = auth.uid();
$$;

-- ------------------------------------------------------------ admin API
create or replace function public.admin_review_savings(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s savings_submissions; lid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_decision not in ('approve','reject','clarify') then raise exception 'Decision must be approve, reject or clarify'; end if;
  if p_decision <> 'approve' and coalesce(btrim(p_note),'') = '' then raise exception 'A reason is required'; end if;
  select * into s from savings_submissions where id = p_id for update;
  if not found or s.status <> 'pending' then raise exception 'Submission not found or not pending'; end if;

  if p_decision = 'approve' then
    insert into savings_ledger (user_id, entry_type, amount, submission_id, created_by)
      values (s.user_id, 'contribution', s.amount, s.id, auth.uid()) returning id into lid;
    update savings_submissions set status='approved', admin_note=p_note, reviewed_by=auth.uid(), reviewed_at=now() where id = s.id;
    perform notify(s.user_id, 'savings_approved', 'Savings confirmed',
                   'Your payment of NGN ' || s.amount || ' has been confirmed.', jsonb_build_object('submission_id', s.id));
  elsif p_decision = 'reject' then
    update savings_submissions set status='rejected', admin_note=p_note, reviewed_by=auth.uid(), reviewed_at=now() where id = s.id;
    perform notify(s.user_id, 'savings_rejected', 'Savings submission rejected', p_note, jsonb_build_object('submission_id', s.id));
  else
    update savings_submissions set status='clarification', admin_note=p_note, reviewed_by=auth.uid(), reviewed_at=now() where id = s.id;
    perform notify(s.user_id, 'savings_clarification', 'Savings: more information needed', p_note, jsonb_build_object('submission_id', s.id));
  end if;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'savings_' || p_decision, 'savings_submission', s.id,
            jsonb_build_object('user_id', s.user_id, 'amount', s.amount, 'reference', s.transfer_reference, 'note', p_note, 'ledger_id', lid));
end $$;

create or replace function public.admin_adjust_savings(p_user uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  insert into savings_ledger (user_id, entry_type, amount, reason, created_by)
    values (p_user, 'adjustment', p_amount, p_reason, auth.uid()) returning id into lid;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'savings_adjust', 'user', p_user, jsonb_build_object('amount', p_amount, 'reason', p_reason, 'ledger_id', lid));
  return lid;
end $$;

create or replace function public.admin_reverse_savings_entry(p_ledger uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r savings_ledger; lid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into r from savings_ledger where id = p_ledger;
  if not found or r.entry_type = 'reversal' then raise exception 'Entry not found or not reversible'; end if;
  begin
    insert into savings_ledger (user_id, entry_type, amount, reverses_id, reason, created_by)
      values (r.user_id, 'reversal', -r.amount, r.id, p_reason, auth.uid()) returning id into lid;
  exception when unique_violation then
    raise exception 'This entry has already been reversed';
  end;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'savings_reverse', 'user', r.user_id, jsonb_build_object('reversed', r.id, 'amount', -r.amount, 'reason', p_reason));
  return lid;
end $$;

-- Per-member report: confirmed totals and outstanding pending confirmations
create or replace function public.admin_savings_summary()
returns table (user_id uuid, full_name text, reference_code text, joined boolean,
               confirmed_total numeric, pending_count int, pending_amount numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, m.reference_code, (m.left_at is null), p.savings_total,
         (select count(*)::int from savings_submissions s where s.user_id = p.id and s.status in ('pending','clarification')),
         coalesce((select sum(s.amount) from savings_submissions s where s.user_id = p.id and s.status in ('pending','clarification')), 0)
    from savings_members m join profiles p on p.id = m.user_id
   where public.is_admin()
   order by p.savings_total desc;
$$;

create or replace function public.admin_savings_reconcile()
returns table (user_id uuid, savings_total numeric, ledger_sum numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.savings_total, coalesce(s.total, 0)
    from profiles p left join (select l.user_id, sum(l.amount) total from savings_ledger l group by l.user_id) s on s.user_id = p.id
   where public.is_admin() and p.savings_total <> coalesce(s.total, 0);
$$;

-- ------------------------------------------------------------ privacy: savings total on public profiles
-- Visible only if the member opted in (show_savings) AND is currently in the programme.
create or replace view public.public_profiles as
  select p.id, p.full_name, p.avatar_url, p.bio, p.state, p.lga, p.community,
         p.niche, p.category, p.other_niche, p.interests, p.skills,
         p.network_list_visibility, p.created_at,
         case when p.show_savings
                   and exists (select 1 from public.savings_members m where m.user_id = p.id and m.left_at is null)
              then p.savings_total end as savings_total
    from public.profiles p
   where p.status = 'active'
     and not public.is_blocked(auth.uid(), p.id);

-- ------------------------------------------------------------ function access
revoke all on function public.join_savings()                                         from public, anon;
revoke all on function public.leave_savings()                                        from public, anon;
revoke all on function public.submit_savings(numeric,text,timestamptz,text,text)     from public, anon;
revoke all on function public.respond_savings_clarification(uuid,text,text)          from public, anon;
revoke all on function public.my_savings_summary()                                   from public, anon;
revoke all on function public.admin_review_savings(uuid,text,text)                   from public, anon;
revoke all on function public.admin_adjust_savings(uuid,numeric,text)                from public, anon;
revoke all on function public.admin_reverse_savings_entry(uuid,text)                 from public, anon;
revoke all on function public.admin_savings_summary()                                from public, anon;
revoke all on function public.admin_savings_reconcile()                              from public, anon;
revoke all on function public.savings_ledger_apply()                                 from public, anon, authenticated;
grant execute on function public.join_savings(), public.leave_savings(),
  public.submit_savings(numeric,text,timestamptz,text,text), public.respond_savings_clarification(uuid,text,text),
  public.my_savings_summary(), public.admin_review_savings(uuid,text,text), public.admin_adjust_savings(uuid,numeric,text),
  public.admin_reverse_savings_entry(uuid,text), public.admin_savings_summary(), public.admin_savings_reconcile()
  to authenticated;

alter publication supabase_realtime add table public.savings_ledger;

-- ------------------------------------------------------------ admin checklist (not SQL)
-- 1. Enter payment_instructions and rules_text:
--      update public.savings_config set payment_instructions = '...', rules_text = '...' where id = 1;
-- 2. Only when legal/compliance advice is obtained and rules are published:
--      update public.savings_config set is_open = true where id = 1;
