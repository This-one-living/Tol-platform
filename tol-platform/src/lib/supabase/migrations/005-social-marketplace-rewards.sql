-- TOL migration 005: public social feed, Marketplace listings, and daily activity rewards.
-- Run after 001-004.

-- ------------------------------------------------------------ TOL Coin daily task rewards
drop trigger if exists messages_award on public.messages;
drop function if exists public.messages_award_tokens();

alter table public.token_ledger add column daily_reward_date date;
alter table public.token_ledger drop constraint if exists token_ledger_check;
alter table public.token_ledger
  add constraint token_ledger_earn_source_check
  check (
    (entry_type = 'earn' and amount > 0
      and (minute_bucket is not null or daily_reward_date is not null))
    or (entry_type <> 'earn' and daily_reward_date is null)
  );
create unique index token_daily_reward_once
  on public.token_ledger (user_id, daily_reward_date)
  where daily_reward_date is not null;

insert into public.platform_settings (key, value, note) values
  ('daily_activity_reward', 1, 'TOL Coins awarded after all daily activities are approved'),
  ('social_post_limit_per_hour', 10, 'Max public feed posts per member per hour'),
  ('social_comment_limit_per_10min', 30, 'Max public feed comments per member per 10 minutes')
on conflict (key) do update set note = excluded.note;

create table public.tol_activity_submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  activity_type text not null check (activity_type in (
    'message', 'useful_post', 'constructive_comment', 'appropriate_share',
    'learning_task', 'community_support', 'useful_activity'
  )),
  details       text not null check (char_length(btrim(details)) between 10 and 1000),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note    text,
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  submitted_at  timestamptz not null default now()
);
create unique index tol_activity_one_open_or_approved
  on public.tol_activity_submissions (user_id, activity_date, activity_type)
  where status in ('pending','approved');
create index tol_activity_review_queue
  on public.tol_activity_submissions (status, submitted_at);

alter table public.tol_activity_submissions enable row level security;
create policy tol_activity_read_own_or_admin
  on public.tol_activity_submissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.tol_activity_submissions from anon, authenticated;
grant select on public.tol_activity_submissions to authenticated;

create or replace function public.my_token_activities()
returns table (
  id uuid, activity_date date, activity_type text, details text,
  status text, admin_note text, submitted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.activity_date, s.activity_type, s.details, s.status, s.admin_note, s.submitted_at
    from tol_activity_submissions s
   where s.user_id = auth.uid()
     and s.activity_date = (now() at time zone 'Africa/Lagos')::date
   order by s.submitted_at;
$$;

create or replace function public.submit_tol_activity(p_activity_type text, p_details text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  activity_id uuid;
  today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if p_activity_type is null or p_activity_type not in (
    'message', 'useful_post', 'constructive_comment', 'appropriate_share',
    'learning_task', 'community_support', 'useful_activity'
  ) then raise exception 'Unknown activity type'; end if;
  if char_length(btrim(coalesce(p_details, ''))) not between 10 and 1000 then
    raise exception 'Describe your activity in 10 to 1000 characters';
  end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then
    raise exception 'An active profile is required';
  end if;

  insert into tol_activity_submissions (user_id, activity_date, activity_type, details)
    values (me, today, p_activity_type, btrim(p_details))
    on conflict (user_id, activity_date, activity_type)
      where status in ('pending','approved') do nothing
    returning id into activity_id;
  if activity_id is null then
    raise exception 'You already have a pending or approved submission for this activity today';
  end if;
  return activity_id;
end $$;

create or replace function public.admin_list_tol_activities(p_status text default 'pending')
returns table (
  id uuid, user_id uuid, full_name text, activity_date date, activity_type text,
  details text, status text, admin_note text, submitted_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status is null or p_status not in ('pending','approved','rejected','all') then
    raise exception 'Invalid status filter';
  end if;
  return query
    select s.id, s.user_id, p.full_name, s.activity_date, s.activity_type,
           s.details, s.status, s.admin_note, s.submitted_at
      from tol_activity_submissions s
      join profiles p on p.id = s.user_id
     where p_status = 'all' or s.status = p_status
     order by case when s.status = 'pending' then 0 else 1 end, s.submitted_at;
end $$;

create or replace function public.admin_review_tol_activity(
  p_submission uuid, p_decision text, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s tol_activity_submissions;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Invalid decision';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A reason is required to reject an activity';
  end if;

  select * into s from tol_activity_submissions where id = p_submission for update;
  if not found or s.status <> 'pending' then
    raise exception 'Pending activity submission not found';
  end if;
  perform 1 from profiles where id = s.user_id for update;
  update tol_activity_submissions
     set status = p_decision, admin_note = nullif(btrim(p_note), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = s.id;

  insert into admin_audit_log (admin_id, action, target_type, target_id, details)
    values (auth.uid(), 'tol_activity_' || p_decision, 'tol_activity', s.id,
            jsonb_build_object('user_id', s.user_id, 'activity_type', s.activity_type,
                               'activity_date', s.activity_date, 'note', p_note));

  if p_decision = 'approved'
     and (select count(distinct activity_type) from tol_activity_submissions
           where user_id = s.user_id and activity_date = s.activity_date and status = 'approved') = 7 then
    insert into token_ledger (
      user_id, entry_type, amount, daily_reward_date, reason, created_by
    ) values (
      s.user_id, 'earn', public.setting('daily_activity_reward'), s.activity_date,
      'All seven daily activities approved', auth.uid()
    )
    on conflict (user_id, daily_reward_date) where daily_reward_date is not null
    do nothing;
  end if;
  return s.id;
end $$;

drop function if exists public.my_token_summary();
create function public.my_token_summary()
returns table (
  balance numeric, earned_today numeric, approved_activities int,
  required_activities int, daily_reward numeric, naira_per_token numeric,
  redemption_status text
)
language sql stable security definer set search_path = public as $$
  select p.token_balance,
         coalesce((select sum(l.amount) from token_ledger l
                    where l.user_id = p.id and l.daily_reward_date = (now() at time zone 'Africa/Lagos')::date), 0),
         (select count(distinct s.activity_type)::int from tol_activity_submissions s
           where s.user_id = p.id and s.activity_date = (now() at time zone 'Africa/Lagos')::date
             and s.status = 'approved'),
         7, public.setting('daily_activity_reward'), public.setting('naira_per_token'), 'coming_soon'
    from profiles p where p.id = auth.uid();
$$;

-- ------------------------------------------------------------ public social feed
create table public.social_feed_posts (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 5000),
  like_count   int not null default 0,
  comment_count int not null default 0,
  share_count  int not null default 0,
  created_at   timestamptz not null default now(),
  removed_at   timestamptz
);
create index social_feed_posts_new_idx
  on public.social_feed_posts (created_at desc) where removed_at is null;
create index social_feed_posts_author_idx on public.social_feed_posts (author_id);

create table public.social_feed_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.social_feed_posts(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
create index social_feed_comments_post_idx
  on public.social_feed_comments (post_id, created_at) where removed_at is null;

create table public.social_feed_likes (
  post_id uuid not null references public.social_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.social_feed_shares (
  post_id uuid not null references public.social_feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create or replace function public.social_feed_counters()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'social_feed_comments' then
    if tg_op = 'INSERT' then
      update social_feed_posts set comment_count = comment_count + 1 where id = new.post_id;
    elsif old.removed_at is null and new.removed_at is not null then
      update social_feed_posts set comment_count = greatest(comment_count - 1, 0) where id = new.post_id;
    end if;
  elsif tg_table_name = 'social_feed_likes' then
    if tg_op = 'INSERT' then
      update social_feed_posts set like_count = like_count + 1 where id = new.post_id;
    else
      update social_feed_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    end if;
  elsif tg_table_name = 'social_feed_shares' then
    if tg_op = 'INSERT' then
      update social_feed_posts set share_count = share_count + 1 where id = new.post_id;
    else
      update social_feed_posts set share_count = greatest(share_count - 1, 0) where id = old.post_id;
    end if;
  end if;
  return null;
end $$;
create trigger social_feed_comments_counters
  after insert or update of removed_at on public.social_feed_comments
  for each row execute function public.social_feed_counters();
create trigger social_feed_likes_counters
  after insert or delete on public.social_feed_likes
  for each row execute function public.social_feed_counters();
create trigger social_feed_shares_counters
  after insert or delete on public.social_feed_shares
  for each row execute function public.social_feed_counters();

alter table public.social_feed_posts enable row level security;
alter table public.social_feed_comments enable row level security;
alter table public.social_feed_likes enable row level security;
alter table public.social_feed_shares enable row level security;
create policy social_feed_posts_read on public.social_feed_posts for select to authenticated
  using (removed_at is null and not public.is_blocked(auth.uid(), author_id));
create policy social_feed_comments_read on public.social_feed_comments for select to authenticated
  using (removed_at is null and not public.is_blocked(auth.uid(), author_id));
create policy social_feed_likes_read on public.social_feed_likes for select to authenticated
  using (user_id = auth.uid());
create policy social_feed_shares_read on public.social_feed_shares for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.social_feed_posts, public.social_feed_comments,
  public.social_feed_likes, public.social_feed_shares from anon, authenticated;
revoke all on function public.social_feed_counters() from public, anon, authenticated;

create or replace function public.list_social_feed(p_limit int default 20, p_offset int default 0)
returns table (
  id uuid, body text, author_id uuid, author_name text, author_avatar text,
  created_at timestamptz, like_count int, comment_count int, share_count int, liked_by_me boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.body, p.author_id, a.full_name, a.avatar_url, p.created_at,
         p.like_count, p.comment_count, p.share_count,
         exists (select 1 from social_feed_likes l where l.post_id = p.id and l.user_id = auth.uid())
    from social_feed_posts p join profiles a on a.id = p.author_id
   where auth.uid() is not null and p.removed_at is null and a.status = 'active'
     and not is_blocked(auth.uid(), p.author_id)
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.list_social_comments(p_post uuid)
returns table (id uuid, author_id uuid, author_name text, author_avatar text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.author_id, a.full_name, a.avatar_url, c.body, c.created_at
    from social_feed_comments c
    join profiles a on a.id = c.author_id
    join social_feed_posts p on p.id = c.post_id
   where auth.uid() is not null and c.post_id = p_post
     and c.removed_at is null and p.removed_at is null and a.status = 'active'
     and not is_blocked(auth.uid(), c.author_id)
   order by c.created_at
   limit 100;
$$;

create or replace function public.create_social_post(p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  post_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Post must be between 1 and 5000 characters';
  end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then
    raise exception 'An active profile is required';
  end if;
  if (select count(*) from social_feed_posts
       where author_id = me and created_at > now() - interval '1 hour') >= setting('social_post_limit_per_hour') then
    raise exception 'You are posting too fast. Please try again later.';
  end if;
  insert into social_feed_posts (author_id, body) values (me, btrim(p_body)) returning id into post_id;
  return post_id;
end $$;

create or replace function public.create_social_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  post_author uuid;
  comment_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Comment must be between 1 and 2000 characters';
  end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then
    raise exception 'An active profile is required';
  end if;
  select author_id into post_author from social_feed_posts
   where id = p_post and removed_at is null;
  if post_author is null or is_blocked(me, post_author) then raise exception 'Post not found'; end if;
  if (select count(*) from social_feed_comments
       where author_id = me and created_at > now() - interval '10 minutes') >= setting('social_comment_limit_per_10min') then
    raise exception 'You are commenting too fast. Please try again later.';
  end if;
  insert into social_feed_comments (post_id, author_id, body)
    values (p_post, me, btrim(p_body)) returning id into comment_id;
  return comment_id;
end $$;

create or replace function public.toggle_social_post_like(p_post uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and status = 'active') then
    raise exception 'An active profile is required';
  end if;
  if not exists (select 1 from social_feed_posts p
                  where p.id = p_post and p.removed_at is null
                    and not is_blocked(auth.uid(), p.author_id)) then
    raise exception 'Post not found';
  end if;
  if exists (select 1 from social_feed_likes where post_id = p_post and user_id = auth.uid()) then
    delete from social_feed_likes where post_id = p_post and user_id = auth.uid();
    return false;
  end if;
  insert into social_feed_likes (post_id, user_id) values (p_post, auth.uid());
  return true;
end $$;

create or replace function public.share_social_post(p_post uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare inserted boolean := false;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and status = 'active') then
    raise exception 'An active profile is required';
  end if;
  if not exists (select 1 from social_feed_posts p
                  where p.id = p_post and p.removed_at is null
                    and not is_blocked(auth.uid(), p.author_id)) then
    raise exception 'Post not found';
  end if;
  insert into social_feed_shares (post_id, user_id) values (p_post, auth.uid())
    on conflict do nothing returning true into inserted;
  return coalesce(inserted, false);
end $$;

create or replace function public.delete_own_social_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update social_feed_posts set removed_at = now()
   where id = p_post and author_id = auth.uid() and removed_at is null;
  if not found then raise exception 'Post not found'; end if;
end $$;

-- ------------------------------------------------------------ Marketplace listings
create table public.marketplace_listings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles(id) on delete cascade,
  item_type   text not null check (item_type in ('product','service')),
  title       text not null check (char_length(btrim(title)) between 3 and 100),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  price       numeric(14,2) check (price is null or price >= 0),
  status      text not null default 'active' check (status in ('active','removed')),
  created_at  timestamptz not null default now()
);
create index marketplace_listings_active_idx
  on public.marketplace_listings (created_at desc) where status = 'active';
create index marketplace_listings_seller_idx on public.marketplace_listings (seller_id, created_at desc);
alter table public.marketplace_listings enable row level security;
create policy marketplace_listings_read on public.marketplace_listings for select to authenticated
  using (status = 'active' and not public.is_blocked(auth.uid(), seller_id));
revoke insert, update, delete on public.marketplace_listings from anon, authenticated;

create or replace function public.list_marketplace_listings(
  p_query text default null, p_item_type text default null, p_limit int default 30, p_offset int default 0
)
returns table (
  id uuid, seller_id uuid, item_type text, title text, description text, price numeric,
  created_at timestamptz, seller_name text, seller_avatar text, seller_lga text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.seller_id, l.item_type, l.title, l.description, l.price,
         l.created_at, p.full_name, p.avatar_url, p.lga
    from marketplace_listings l join profiles p on p.id = l.seller_id
   where auth.uid() is not null and l.status = 'active' and p.status = 'active'
     and not is_blocked(auth.uid(), l.seller_id)
     and (p_item_type is null or l.item_type = p_item_type)
     and (coalesce(btrim(p_query), '') = ''
       or l.title ilike '%' || btrim(p_query) || '%'
       or l.description ilike '%' || btrim(p_query) || '%')
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 60)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.create_marketplace_listing(
  p_item_type text, p_title text, p_description text, p_price numeric default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  listing_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if p_item_type is null or p_item_type not in ('product','service') then
    raise exception 'Choose a product or service';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 100 then
    raise exception 'Title must be between 3 and 100 characters';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 10 and 2000 then
    raise exception 'Description must be between 10 and 2000 characters';
  end if;
  if p_price < 0 then raise exception 'Price cannot be negative'; end if;
  if not exists (select 1 from profiles where id = me and status = 'active') then
    raise exception 'An active profile is required';
  end if;
  insert into marketplace_listings (seller_id, item_type, title, description, price)
    values (me, p_item_type, btrim(p_title), btrim(p_description), p_price)
    returning id into listing_id;
  return listing_id;
end $$;

create or replace function public.delete_own_marketplace_listing(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update marketplace_listings set status = 'removed'
   where id = p_listing and seller_id = auth.uid() and status = 'active';
  if not found then raise exception 'Listing not found'; end if;
end $$;

-- ------------------------------------------------------------ function access
revoke all on function public.submit_tol_activity(text,text),
  public.my_token_activities(),
  public.admin_list_tol_activities(text), public.admin_review_tol_activity(uuid,text,text),
  public.my_token_summary(),
  public.list_social_feed(int,int), public.list_social_comments(uuid),
  public.create_social_post(text), public.create_social_comment(uuid,text),
  public.toggle_social_post_like(uuid), public.share_social_post(uuid),
  public.delete_own_social_post(uuid),
  public.list_marketplace_listings(text,text,int,int),
  public.create_marketplace_listing(text,text,text,numeric),
  public.delete_own_marketplace_listing(uuid)
  from public, anon;
grant execute on function public.submit_tol_activity(text,text),
  public.my_token_activities(),
  public.my_token_summary(),
  public.list_social_feed(int,int), public.list_social_comments(uuid),
  public.create_social_post(text), public.create_social_comment(uuid,text),
  public.toggle_social_post_like(uuid), public.share_social_post(uuid),
  public.delete_own_social_post(uuid),
  public.list_marketplace_listings(text,text,int,int),
  public.create_marketplace_listing(text,text,text,numeric),
  public.delete_own_marketplace_listing(uuid)
  to authenticated;
grant execute on function public.admin_list_tol_activities(text),
  public.admin_review_tol_activity(uuid,text,text)
  to authenticated;
