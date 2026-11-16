-- TOL core schema: reference data, profiles, roles, network, blocks, reports,
-- notifications, private messaging. Matches the existing frontend contract
-- (text-based lga / community / niche / category on profiles).
-- Run in Supabase SQL editor, or as a migration.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- reference
create table public.lgas (
  name  text primary key,
  state text not null default 'Ebonyi'
);

-- Towns/communities under an LGA (frontend queries this as `communities`)
create table public.communities (
  id     uuid primary key default gen_random_uuid(),
  lga    text not null references public.lgas(name) on update cascade,
  name   text not null,
  status text not null default 'approved' check (status in ('approved','pending')),
  unique (lga, name)
);

create table public.niches (
  name       text primary key,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table public.categories (
  id     uuid primary key default gen_random_uuid(),
  niche  text not null references public.niches(name) on update cascade,
  name   text not null,
  status text not null default 'approved' check (status in ('approved','pending')),
  unique (niche, name)
);

-- -------------------------------------------------------------------- roles
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role    text not null check (role in ('admin','moderator')),
  primary key (user_id, role)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid());
$$;

-- ----------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 2 and 100),
  phone       text not null,
  state       text not null default 'Ebonyi',
  lga         text not null references public.lgas(name) on update cascade,
  community   text not null,
  niche       text not null references public.niches(name) on update cascade,
  category    text,
  other_niche text,
  interests   text[] not null default '{}',
  skills      text[] not null default '{}',
  bio         text check (char_length(bio) <= 500),
  avatar_url  text,
  network_list_visibility text not null default 'connections'
    check (network_list_visibility in ('everyone','connections','hidden')),
  show_savings boolean not null default false,
  status      text not null default 'active' check (status in ('active','suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint other_niche_required check (niche <> 'Other' or coalesce(other_niche,'') <> '')
);

-- Obvious duplicate-phone abuse: same last 10 digits
create unique index profiles_phone_uniq
  on public.profiles ((right(regexp_replace(phone, '\D', '', 'g'), 10)));
create index profiles_lga_idx       on public.profiles (lga);
create index profiles_community_idx on public.profiles (lga, community);
create index profiles_niche_idx     on public.profiles (niche, category);
create index profiles_name_trgm     on public.profiles using gin (full_name gin_trgm_ops);
create index profiles_skills_gin    on public.profiles using gin (skills);
create index profiles_interests_gin on public.profiles using gin (interests);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------- blocks/reports
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user','message','post','comment')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 3 and 1000),
  status      text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------ notifications
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create or replace function public.notify(p_user uuid, p_type text, p_title text, p_body text default null, p_data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user, p_type, p_title, p_body, p_data);
$$;
revoke all on function public.notify(uuid,text,text,text,jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ network
create table public.network_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled','removed')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> recipient_id)
);
-- One live (pending/accepted) relationship per pair, in either direction
create unique index network_pair_live_uniq
  on public.network_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status in ('pending','accepted');
create index network_recipient_idx on public.network_requests (recipient_id, status);
create index network_requester_idx on public.network_requests (requester_id, status);

create or replace function public.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.network_requests
    where status = 'accepted'
      and ((requester_id = a and recipient_id = b) or (requester_id = b and recipient_id = a))
  );
$$;

create or replace function public.network_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.network_requests
  where status = 'accepted' and (requester_id = p_user or recipient_id = p_user);
$$;

create or replace function public.send_network_request(p_recipient uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; nm text;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if me = p_recipient then raise exception 'You cannot add yourself'; end if;
  if not exists (select 1 from profiles where id = p_recipient and status = 'active') then
    raise exception 'Member not found';
  end if;
  if is_blocked(me, p_recipient) then raise exception 'Request not allowed'; end if;
  begin
    insert into network_requests (requester_id, recipient_id) values (me, p_recipient) returning id into rid;
  exception when unique_violation then
    raise exception 'A request or connection already exists with this member';
  end;
  select full_name into nm from profiles where id = me;
  perform notify(p_recipient, 'network_request', 'New Network Request', nm || ' wants to join your Network',
                 jsonb_build_object('request_id', rid, 'from', me));
  return rid;
end $$;

create or replace function public.respond_network_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r network_requests; nm text;
begin
  select * into r from network_requests where id = p_request for update;
  if not found or r.recipient_id <> me or r.status <> 'pending' then
    raise exception 'Request not found or not pending';
  end if;
  if p_accept and is_blocked(r.requester_id, me) then raise exception 'Request not allowed'; end if;
  update network_requests
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_request;
  if p_accept then
    select full_name into nm from profiles where id = me;
    perform notify(r.requester_id, 'network_accepted', 'Network Request Accepted',
                   nm || ' accepted your request', jsonb_build_object('from', me));
  end if;
end $$;

create or replace function public.cancel_network_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update network_requests set status = 'cancelled', responded_at = now()
   where id = p_request and requester_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Request not found or not pending'; end if;
end $$;

create or replace function public.remove_connection(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update network_requests set status = 'removed', responded_at = now()
   where status = 'accepted'
     and ((requester_id = auth.uid() and recipient_id = p_other)
       or (requester_id = p_other and recipient_id = auth.uid()));
  if not found then raise exception 'No such connection'; end if;
end $$;

-- Blocking also tears down any live relationship
create or replace function public.block_user(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_other = auth.uid() then raise exception 'Invalid'; end if;
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), p_other) on conflict do nothing;
  update network_requests set status = 'removed', responded_at = now()
   where status in ('pending','accepted')
     and ((requester_id = auth.uid() and recipient_id = p_other)
       or (requester_id = p_other and recipient_id = auth.uid()));
end $$;

-- ---------------------------------------------------------------- messaging
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  deleted_at   timestamptz,
  check (sender_id <> recipient_id)
);
create index messages_pair_idx  on public.messages (sender_id, recipient_id, created_at desc);
create index messages_inbox_idx on public.messages (recipient_id, read_at, created_at desc);

-- New-message notification, throttled to one unread per sender
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not exists (
    select 1 from notifications
    where user_id = new.recipient_id and type = 'message' and read_at is null
      and data->>'from' = new.sender_id::text
  ) then
    select full_name into nm from profiles where id = new.sender_id;
    perform notify(new.recipient_id, 'message', 'New message', 'You have a new message from ' || nm,
                   jsonb_build_object('from', new.sender_id));
  end if;
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.mark_conversation_read(p_other uuid)
returns void language sql security definer set search_path = public as $$
  update public.messages set read_at = now()
   where recipient_id = auth.uid() and sender_id = p_other and read_at is null;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and type = 'message' and read_at is null and data->>'from' = p_other::text;
$$;

create or replace function public.list_conversations()
returns table (other_id uuid, full_name text, avatar_url text, last_body text, last_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  with m as (
    select case when sender_id = auth.uid() then recipient_id else sender_id end as other,
           body, created_at, sender_id, read_at
      from messages
     where (sender_id = auth.uid() or recipient_id = auth.uid()) and deleted_at is null
  ), last_m as (
    select distinct on (other) other, body, created_at from m order by other, created_at desc
  )
  select l.other, p.full_name, p.avatar_url, l.body, l.created_at,
         (select count(*)::int from m x where x.other = l.other and x.sender_id <> auth.uid() and x.read_at is null)
    from last_m l
    join profiles p on p.id = l.other
   where are_connected(auth.uid(), l.other) and not is_blocked(auth.uid(), l.other)
   order by l.created_at desc;
$$;

-- ----------------------------------------------------------------- discovery
-- Public-safe projection: NO phone. Use this (not `profiles`) for discovery.
create view public.public_profiles as
  select p.id, p.full_name, p.avatar_url, p.bio, p.state, p.lga, p.community,
         p.niche, p.category, p.other_niche, p.interests, p.skills,
         p.network_list_visibility, p.created_at
    from public.profiles p
   where p.status = 'active'
     and not public.is_blocked(auth.uid(), p.id);

create or replace function public.search_people(
  p_lga text default null, p_community text default null, p_niche text default null,
  p_category text default null, p_interest text default null, p_skill text default null,
  p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, full_name text, avatar_url text, lga text, community text,
               niche text, category text, other_niche text, network_status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, p.lga, p.community, p.niche, p.category, p.other_niche,
         coalesce((
           select case when n.status = 'accepted' then 'connected'
                       when n.requester_id = auth.uid() then 'request_sent'
                       else 'request_received' end
             from network_requests n
            where n.status in ('pending','accepted')
              and ((n.requester_id = auth.uid() and n.recipient_id = p.id)
                or (n.requester_id = p.id and n.recipient_id = auth.uid()))
            limit 1), 'none')
    from profiles p
   where auth.uid() is not null
     and p.status = 'active' and p.id <> auth.uid()
     and not is_blocked(auth.uid(), p.id)
     and (p_lga       is null or p.lga = p_lga)
     and (p_community is null or p.community = p_community)
     and (p_niche     is null or p.niche = p_niche)
     and (p_category  is null or p.category = p_category)
     and (p_interest  is null or exists (select 1 from unnest(p.interests) i where i ilike p_interest))
     and (p_skill     is null or exists (select 1 from unnest(p.skills) s where s ilike p_skill))
     and (p_query     is null or p.full_name ilike '%' || p_query || '%'
                              or p.other_niche ilike '%' || p_query || '%'
                              or p.category ilike '%' || p_query || '%')
   order by p.created_at desc
   limit least(coalesce(p_limit,20), 50) offset greatest(coalesce(p_offset,0), 0);
$$;

-- --------------------------------------------------------------------- RLS
alter table public.lgas             enable row level security;
alter table public.communities      enable row level security;
alter table public.niches           enable row level security;
alter table public.categories       enable row level security;
alter table public.user_roles       enable row level security;
alter table public.profiles         enable row level security;
alter table public.blocks           enable row level security;
alter table public.reports          enable row level security;
alter table public.notifications    enable row level security;
alter table public.network_requests enable row level security;
alter table public.messages         enable row level security;

-- Reference data: readable by everyone (needed at signup, before login), admin-managed
create policy ref_lgas_read  on public.lgas       for select using (true);
create policy ref_comm_read  on public.communities for select using (status = 'approved' or public.is_admin());
create policy ref_niche_read on public.niches     for select using (true);
create policy ref_cat_read   on public.categories for select using (status = 'approved' or public.is_admin());
create policy ref_lgas_admin  on public.lgas        for all using (public.is_admin()) with check (public.is_admin());
create policy ref_comm_admin  on public.communities for all using (public.is_admin()) with check (public.is_admin());
create policy ref_niche_admin on public.niches      for all using (public.is_admin()) with check (public.is_admin());
create policy ref_cat_admin   on public.categories for all using (public.is_admin()) with check (public.is_admin());

create policy roles_read_own on public.user_roles for select using (user_id = auth.uid() or public.is_admin());

-- Profiles: owner or admin sees the full row (incl. phone). Everyone else uses public_profiles / search_people.
create policy profiles_select_own   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_insert_own   on public.profiles for insert with check (id = auth.uid());
create policy profiles_update_own   on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- Column-level grants stop members editing status / ids
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, full_name, phone, state, lga, community, niche, category, other_niche, interests, skills)
  on public.profiles to authenticated;
grant update (full_name, phone, lga, community, niche, category, other_niche, interests, skills,
              bio, avatar_url, network_list_visibility, show_savings)
  on public.profiles to authenticated;
grant update (status) on public.profiles to authenticated;  -- only effective via profiles_update_admin policy

-- (status column update is blocked for members by this trigger, since RLS cannot restrict columns)
create or replace function public.guard_profile_status()
returns trigg