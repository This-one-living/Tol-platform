-- TOL migration 004: niche communities + category-based discussion forum + moderation.
-- Structure: one community per major niche (plus Other) -> topics = that niche's categories
-- -> posts (discussion or question) -> flat comments.
-- All writes go through RPCs (membership, rate limits, restrictions enforced server-side).
-- Run AFTER 001, 002, 003.

-- ------------------------------------------------------------ communities / topics
create table public.niche_communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  niche_name  text not null references public.niches(name) on update cascade,
  description text,
  status      text not null default 'approved' check (status in ('approved','hidden')),
  created_at  timestamptz not null default now()
);

create table public.community_topics (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.niche_communities(id) on delete cascade,
  category_id  uuid unique references public.categories(id) on delete set null,
  name         text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (community_id, name)
);

create table public.community_members (
  community_id uuid not null references public.niche_communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

-- ------------------------------------------------------------ posts / comments / likes
create table public.posts (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references public.community_topics(id) on delete cascade,
  author_id        uuid not null references public.profiles(id) on delete cascade,
  kind             text not null default 'discussion' check (kind in ('discussion','question')),
  title            text not null check (char_length(btrim(title)) between 3 and 150),
  body             text not null check (char_length(btrim(body)) between 1 and 5000),
  comment_count    int  not null default 0,
  like_count       int  not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references auth.users(id),
  removal_reason   text
);
create index posts_topic_new_idx    on public.posts (topic_id, created_at desc) where removed_at is null;
create index posts_topic_active_idx on public.posts (topic_id, last_activity_at desc) where removed_at is null;
create index posts_author_idx       on public.posts (author_id);

create table public.comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete cascade,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     uuid references auth.users(id),
  removal_reason text
);
create index comments_post_idx   on public.comments (post_id, created_at) where removed_at is null;
create index comments_author_idx on public.comments (author_id);

create table public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Counters are maintained by the database
create or replace function public.forum_counters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'comments' then
    if tg_op = 'INSERT' then
      update posts set comment_count = comment_count + 1, last_activity_at = now() where id = new.post_id;
    elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
      update posts set comment_count = greatest(comment_count - 1, 0) where id = new.post_id;
    end if;
  elsif tg_table_name = 'post_likes' then
    if tg_op = 'INSERT' then update posts set like_count = like_count + 1 where id = new.post_id;
    else update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id; end if;
  end if;
  return null;
end $$;
create trigger comments_counters after insert or update of removed_at on public.comments
  for each row execute function public.forum_counters();
create trigger likes_counters after insert or delete on public.post_likes
  for each row execute function public.forum_counters();

-- ------------------------------------------------------------ moderation tables
create table public.community_restrictions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.niche_communities(id) on delete cascade,  -- null = all communities
  reason       text not null,
  until        timestamptz,                                                     -- null = until lifted
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz
);
create index restrictions_user_idx on public.community_restrictions (user_id) where lifted_at is null;

create table public.community_suggestions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('community','topic')),
  community_id uuid references public.niche_communities(id) on delete cascade,  -- required for 'topic'
  name         text not null check (char_length(btrim(name)) between 3 and 80),
  details      text check (char_length(details) <= 500),
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note   text,
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (kind = 'community' or community_id is not null)
);

-- One open report per reporter per target (stops report spam)
create unique index reports_open_once on public.reports (reporter_id, target_type, target_id) where status = 'open';

-- ------------------------------------------------------------ seed + keep in sync with niches/categories
insert into public.niche_communities (name, niche_name, description)
select n.name || ' Community', n.name,
       'Discussions for members working or interested in ' || n.name || '.'
  from public.niches n;

insert into public.community_topics (community_id, category_id, name)
select c.id, k.id, k.name || ' Discussions'
  from public.categories k
  join public.niche_communities c on c.niche_name = k.niche
 where k.status = 'approved';

create or replace function public.sync_niche_community()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into niche_communities (name, niche_name) values (new.name || ' Community', new.name) on conflict do nothing;
  return new;
end $$;
create trigger niches_sync after insert on public.niches for each row execute function public.sync_niche_community();

create or replace function public.sync_category_topic()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' then
    insert into community_topics (community_id, category_id, name)
    select c.id, new.id, new.name || ' Discussions'
      from niche_communities c where c.niche_name = new.niche order by c.created_at limit 1
    on conflict (category_id) do update set name = excluded.name;
  end if;
  return new;
end $$;
create trigger categories_sync after insert or update of name, status on public.categories
  for each row execute function public.sync_category_topic();

-- ------------------------------------------------------------ settings
insert into public.platform_settings (key, value, note) values
  ('post_limit_per_hour',        10, 'Max new posts per member per hour'),
  ('comment_limit_per_10min',    30, 'Max comments per member per 10 minutes');

-- ------------------------------------------------------------ RLS
alter table public.niche_communities     enable row level security;
alter table public.community_topics      enable row level security;
alter table public.community_members     enable row level security;
alter table public.posts                 enable row level security;
alter table public.comments              enable row level security;
alter table public.post_likes            enable row level security;
alter table public.community_restrictions enable row level security;
alter table public.community_suggestions enable row level security;

create policy nc_read  on public.niche_communities for select to authenticated using (status = 'approved' or public.is_admin());
create policy nc_admin on public.niche_communities for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ct_read  on public.community_topics  for select to authenticated using (is_active or public.is_admin());
create policy ct_admin on public.community_topics  for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy cm_own   on public.community_members for select using (user_id = auth.uid() or public.is_admin());
create policy posts_read on public.posts for select to authenticated
  using ((removed_at is null and not public.is_blocked(auth.uid(), author_id)) or public.is_staff());
create policy comments_read on public.comments for select to authenticated
  using ((removed_at is null and not public.is_blocked(auth.uid(), author_id)) or public.is_staff());
create policy likes_own on public.post_likes for select using (user_id = auth.uid());
create policy restr_read on public.community_restrictions for select using (user_id = auth.uid() or public.is_staff());
create policy sugg_read  on public.community_suggestions for select using (user_id = auth.uid() or public.is_admin());

-- No direct writes from members: everything is via the RPCs below.
revoke insert, update, delete on public.community_members, public.posts, public.comments, public.post_likes,
  public.community_restrictions, public.community_suggestions from anon, authenticated;
-- (admins manage communities/topics through the table policies above)

-- ------------------------------------------------------------ helpers
create or replace function public.assert_can_participate(p_community uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then raise exception 'Account not active'; end if;
  if not exists (select 1 from community_members where community_id = p_community and user_id = me) then
    raise exception 'Join this community first';
  end if;
  if exists (select 1 from community_restrictions r
              where r.user_id = me and r.lifted_at is null and (r.until is null or r.until > now())
                and (r.community_id is null or r.community_id = p_community)) then
    raise exception 'You are currently restricted from posting in this community';
  end if;
end $$;
revoke all on function public.assert_can_participate(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ member API: browse
create or replace function public.list_communities(p_query text default null)
returns table (id uuid, name text, niche_name text, description text,
               member_count int, topic_count int, joined boolean, is_my_niche boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.niche_name, c.description,
         (select count(*)::int from community_members m where m.community_id = c.id),
         (select count(*)::int from community_topics t where t.community_id = c.id and t.is_active),
         exists (select 1 from community_members m where m.community_id = c.id and m.user_id = auth.uid()),
         (c.niche_name = (select p.niche from profiles p where p.id = auth.uid()))
    from niche_communities c
   where auth.uid() is not null and c.status = 'approved'
     and (p_query is null or c.name ilike '%' || p_query || '%' or c.niche_name ilike '%' || p_query || '%')
   order by 8 desc nulls last, c.name;
$$;

create or replace function public.list_topics(p_community uuid)
returns table (id uuid, name text, category_id uuid, post_count int, last_activity_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.category_id,
         (select count(*)::int from posts p where p.topic_id = t.id and p.removed_at is null),
         (select max(p.last_activity_at) from posts p where p.topic_id = t.id and p.removed_at is null)
    from community_topics t
   where auth.uid() is not null and t.community_id = p_community and t.is_active
   order by 5 desc nulls last, t.name;
$$;

create or replace function public.list_topic_posts(p_topic uuid, p_sort text default 'new', p_limit int default 20, p_offset int default 0)
returns table (id uuid, kind text, title text, body text, author_id uuid, author_name text, author_avatar text,
               created_at timestamptz, comment_count int, like_count int, liked_by_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.title, p.body, p.author_id, a.full_name, a.avatar_url, p.created_at,
         p.comment_count, p.like_count,
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid())
    from posts p join profiles a on a.id = p.author_id
   where auth.uid() is not null and p.topic_id = p_topic and p.removed_at is null
     and not is_blocked(auth.uid(), p.author_id)
   order by case when p_sort = 'active' then p.last_activity_at else p.created_at end desc
   limit least(coalesce(p_limit, 20), 50) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_post(p_post uuid)
returns table (id uuid, topic_id uuid, topic_name text, community_id uuid, community_name text, kind text, title text,
               body text, author_id uuid, author_name text, author_avatar text, created_at timestamptz,
               comment_count int, like_count int, liked_by_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.topic_id, t.name, c.id, c.name, p.kind, p.title, p.body, p.author_id, a.full_name, a.avatar_url,
         p.created_at, p.comment_count, p.like_count,
         exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid())
    from posts p join profiles a on a.id = p.author_id
    join community_topics t on t.id = p.topic_id join niche_communities c on c.id = t.community_id
   where auth.uid() is not null and p.id = p_post and p.removed_at is null
     and not is_blocked(auth.uid(), p.author_id);
$$;

create or replace function public.list_comments(p_post uuid, p_limit int default 50, p_offset int default 0)
returns table (id uuid, author_id uuid, author_name text, author_avatar text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.author_id, a.full_name, a.avatar_url, c.body, c.created_at
    from comments c join profiles a on a.id = c.author_id
   where auth.uid() is not null and c.post_id = p_post and c.removed_at is null
     and not is_blocked(auth.uid(), c.author_id)
   order by c.created_at
   limit least(coalesce(p_limit, 50), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ------------------------------------------------------------ member API: participate
create or replace function public.join_community(p_community uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from niche_communities where id = p_community and status = 'approved') then
    raise exception 'Community not found';
  end if;
  insert into community_members (community_id, user_id) values (p_community, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.leave_community(p_community uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.community_members where community_id = p_community and user_id = auth.uid();
$$;

create or replace function public.create_post(p_topic uuid, p_kind text, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare comm uuid; pid uuid;
begin
  select t.community_id into comm from community_topics t
    join niche_communities c on c.id = t.community_id
   where t.id = p_topic and t.is_active and c.status = 'approved';
  if comm is null then raise exception 'Topic not found'; end if;
  perform assert_can_participate(comm);
  if (select count(*) from posts where author_id = auth.uid() and created_at > now() - interval '1 hour') >= setting('post_limit_per_hour') then
    raise exception 'You are posting too fast. Please try again later.';
  end if;
  insert into posts (topic_id, author_id, kind, title, body)
    values (p_topic, auth.uid(), coalesce(p_kind, 'discussion'), btrim(p_title), btrim(p_body)) returning id into pid;
  return pid;
end $$;

create or replace function public.create_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare comm uuid; auth_id uuid; ptitle text; cid uuid; nm text;
begin
  select t.community_id, p.author_id, p.title into comm, auth_id, ptitle
    from posts p join community_topics t on t.id = p.topic_id
   where p.id = p_post and p.removed_at is null;
  if comm is null then raise exception 'Post not found'; end if;
  if is_blocked(auth.uid(), auth_id) then raise exception 'Post not found'; end if;
  perform assert_can_participate(comm);
  if (select count(*) from comments where author_id = auth.uid() and created_at > now() - interval '10 minutes') >= setting('comment_limit_per_10min') then
    raise exception 'You are commenting too fast. Please slow down.';
  end if;
  insert into comments (post_id, author_id, body) values (p_post, auth.uid(), btrim(p_body)) returning id into cid;
  if auth_id <> auth.uid() then
    select full_name into nm from profiles where id = auth.uid();
    perform notify(auth_id, 'community_reply', 'New reply to your post',
                   nm || ' replied to "' || left(ptitle, 60) || '"', jsonb_build_object('post_id', p_post, 'comment_id', cid));
  end if;
  return cid;
end $$;

-- Returns true if now liked, false if like removed
create or replace function public.toggle_post_like(p_post uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare comm uuid;
begin
  select t.community_id into comm from posts p join community_topics t on t.id = p.topic_id
   where p.id = p_post and p.removed_at is null;
  if comm is null then raise exception 'Post not found'; end if;
  perform assert_can_participate(comm);
  if exists (select 1 from post_likes where post_id = p_post and user_id = auth.uid()) then
    delete from post_likes where post_id = p_post and user_id = auth.uid();
    return false;
  end if;
  insert into post_likes (post_id, user_id) values (p_post, auth.uid());
  return true;
end $$;

create or replace function public.delete_own_content(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type = 'post' then
    update posts set removed_at = now(), removal_reason = 'Deleted by author'
     where id = p_id and author_id = auth.uid() and removed_at is null;
  elsif p_type = 'comment' then
    update comments set removed_at = now(), removal_reason = 'Deleted by author'
     where id = p_id and author_id = auth.uid() and removed_at is null;
  else raise exception 'Invalid type'; end if;
  if not found then raise exception 'Not found'; end if;
end $$;

-- Missing community/topic suggestions (reviewed by admin)
create or replace function public.suggest_community_item(p_kind text, p_name text, p_details text default null, p_community uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_kind = 'topic' and not exists (select 1 from niche_communities where id = p_community) then
    raise exception 'Choose the community this topic belongs to';
  end if;
  if (select count(*) from community_suggestions where user_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'You already have 5 suggestions awaiting review';
  end if;
  insert into community_suggestions (user_id, kind, community_id, name, details)
    values (auth.uid(), p_kind, case when p_kind = 'topic' then p_community end, btrim(p_name), p_details)
    returning id into sid;
  return sid;
end $$;

-- ------------------------------------------------------------ moderation API (moderators + admins)
create or replace function public.mod_remove_content(p_type text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid; ttl text;
begin
  if not public.is_staff() then raise exception 'Moderators only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if p_type = 'post' then
    update posts set removed_at = now(), removed_by = auth.uid(), removal_reason = p_reason
     where id = p_id and removed_at is null returning author_id, title into owner, ttl;
  elsif p_type = 'comment' then
    update comments set removed_at = now(), removed_by = auth.uid(), removal_reason = p_reason
     where id = p_id and removed_at is null returning author_id, left(body, 60) into owner, ttl;
  else raise exception 'Invalid type'; end if;
  if owner is null then raise exception 'Content not found or already removed'; end if;
  update reports set status = 'actioned' where target_type = p_type and target_id = p_id and status = 'open';
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'content_removed', p_type, p_id, jsonb_build_object('author', owner, 'reason', p_reason));
  perform notify(owner, 'content_removed', 'Your ' || p_type || ' was removed', p_reason,
                 jsonb_build_object('type', p_type, 'id', p_id));
end $$;

create or replace function public.mod_restrict_user(p_user uuid, p_community uuid, p_hours int, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_staff() then raise exception 'Moderators only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if exists (select 1 from user_roles where user_id = p_user) then raise exception 'Cannot restrict staff accounts'; end if;
  insert into community_restrictions (user_id, community_id, reason, until, created_by)
    values (p_user, p_community, p_reason, case when p_hours is null then null else now() + make_interval(hours => p_hours) end, auth.uid())
    returning id into rid;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'user_restricted', 'user', p_user, jsonb_build_object('community', p_community, 'hours', p_hours, 'reason', p_reason));
  perform notify(p_user, 'restricted', 'Posting restricted', p_reason, '{}');
  return rid;
end $$;

create or replace function public.mod_lift_restriction(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Moderators only'; end if;
  update community_restrictions set lifted_at = now() where id = p_id and lifted_at is null;
  if not found then raise exception 'Restriction not found'; end if;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'restriction_lifted', 'restriction', p_id, '{}');
end $$;

create or replace function public.mod_list_reports(p_status text default 'open', p_limit int default 30, p_offset int default 0)
returns table (report_id uuid, target_type text, target_id uuid, reason text, status text, created_at timestamptz,
               reporter_name text, content_title text, content_snippet text, content_author_id uuid,
               content_author_name text, already_removed boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at, rp.full_name,
         case r.target_type when 'post' then po.title end,
         case r.target_type when 'post' then left(po.body, 200) when 'comment' then left(co.body, 200) end,
         coalesce(po.author_id, co.author_id, case when r.target_type = 'user' then r.target_id end),
         coalesce(pa.full_name, ca.full_name, ua.full_name),
         coalesce(po.removed_at, co.removed_at) is not null
    from reports r
    join profiles rp on rp.id = r.reporter_id
    left join posts po on r.target_type = 'post' and po.id = r.target_id
    left join comments co on r.target_type = 'comment' and co.id = r.target_id
    left join profiles pa on pa.id = po.author_id
    left join profiles ca on ca.id = co.author_id
    left join profiles ua on r.target_type = 'user' and ua.id = r.target_id
   where public.is_staff() and (p_status is null or r.status = p_status)
   order by r.created_at
   limit least(coalesce(p_limit, 30), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ------------------------------------------------------------ admin API: suggestions
create or replace function public.admin_review_suggestion(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s community_suggestions; cid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into s from community_suggestions where id = p_id and status = 'pending' for update;
  if not found then raise exception 'Suggestion not found or already reviewed'; end if;
  if p_approve then
    begin
      if s.kind = 'community' then
        insert into niche_communities (name, niche_name, description) values (s.name, 'Other', s.details);
      else
        insert into community_topics (community_id, name) values (s.community_id, s.name);
      end if;
    exception when unique_violation then
      raise exception 'A community or topic with this name already exists';
    end;
  elsif coalesce(btrim(p_note),'') = '' then
    raise exception 'A reason is required to reject';
  end if;
  update community_suggestions set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), case when p_approve then 'suggestion_approved' else 'suggestion_rejected' end,
            'suggestion', s.id, jsonb_build_object('kind', s.kind, 'name', s.name, 'note', p_note));
  perform notify(s.user_id, 'suggestion_reviewed',
                 case when p_approve then 'Your suggestion was approved' else 'Your suggestion was not approved' end,
                 s.name || coalesce(': ' || p_note, ''), '{}');
end $$;

-- ------------------------------------------------------------ function access
revoke all on function public.list_communities(text), public.list_topics(uuid),
  public.list_topic_posts(uuid,text,int,int), public.get_post(uuid), public.list_comments(uuid,int,int),
  public.join_community(uuid), public.leave_community(uuid), public.create_post(uuid,text,text,text),
  public.create_comment(uuid,text), public.toggle_post_like(uuid), public.delete_own_content(text,uuid),
  public.suggest_community_item(text,text,text,uuid), public.mod_remove_content(text,uuid,text),
  public.mod_restrict_user(uuid,uuid,int,text), public.mod_lift_restriction(uuid),
  public.mod_list_reports(text,int,int), public.admin_review_suggestion(uuid,boolean,text)
  from public, anon;
grant execute on function public.list_communities(text), public.list_topics(uuid),
  public.list_topic_posts(uuid,text,int,int), public.get_post(uuid), public.list_comments(uuid,int,int),
  public.join_community(uuid), public.leave_community(uuid), public.create_post(uuid,text,text,text),
  public.create_comment(uuid,text), public.toggle_post_like(uuid), public.delete_own_content(text,uuid),
  public.suggest_community_item(text,text,text,uuid), public.mod_remove_content(text,uuid,text),
  public.mod_restrict_user(uuid,uuid,int,text), public.mod_lift_restriction(uuid),
  public.mod_list_reports(text,int,int), public.admin_review_suggestion(uuid,boolean,text)
  to authenticated;
revoke all on function public.forum_counters(), public.sync_niche_community(), public.sync_category_topic()
  from public, anon, authenticated;
