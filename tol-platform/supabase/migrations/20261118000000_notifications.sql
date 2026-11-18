create extension if not exists pg_net;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_read_created_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, delete on public.notifications from anon, authenticated;

create or replace function public.notify(
  p_user uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
$$;

revoke all on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can manage their own push subscriptions" on public.push_subscriptions;
create policy "Users can manage their own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can view their own push subscriptions" on public.push_subscriptions;
create policy "Users can view their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

grant select (user_id, endpoint) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

create or replace function public.save_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_expiration_time timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be signed in to enable browser push.';
  end if;
  if target_endpoint is null or target_endpoint not like 'https://%'
     or nullif(target_p256dh, '') is null or nullif(target_auth, '') is null then
    raise exception 'The browser returned an invalid push subscription.';
  end if;

  if exists (
    select 1
      from public.push_subscriptions subscription
     where subscription.endpoint = target_endpoint
       and (subscription.p256dh <> target_p256dh or subscription.auth <> target_auth)
  ) then
    raise exception 'That browser push endpoint belongs to a different subscription.';
  end if;

  delete from public.push_subscriptions
   where endpoint = target_endpoint;

  insert into public.push_subscriptions (
    user_id, endpoint, p256dh, auth, expiration_time, updated_at
  ) values (
    current_user_id, target_endpoint, target_p256dh, target_auth,
    target_expiration_time, now()
  );
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, timestamptz) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, timestamptz) to authenticated;

create or replace function public.dispatch_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault, pg_temp
as $$
declare
  push_url text;
  webhook_secret text;
begin
  select secret.decrypted_secret into push_url
    from vault.decrypted_secrets secret
   where secret.name = 'notification_push_url';

  select secret.decrypted_secret into webhook_secret
    from vault.decrypted_secrets secret
   where secret.name = 'notification_push_secret';

  if nullif(push_url, '') is null or nullif(webhook_secret, '') is null then
    return new;
  end if;

  perform net.http_post(
    url := push_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end;
$$;

revoke all on function public.dispatch_notification_push() from public, anon, authenticated;

drop trigger if exists notifications_dispatch_push on public.notifications;
create trigger notifications_dispatch_push
  after insert on public.notifications
  for each row execute function public.dispatch_notification_push();

create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sender_name text;
  recipient record;
begin
  select coalesce(profile.full_name, 'A TOL member')
    into sender_name
    from public.profiles profile
   where profile.id = new.sender_id;

  for recipient in
    select participant.user_id
      from public.conversation_participants participant
     where participant.conversation_id = new.conversation_id
       and participant.user_id <> new.sender_id
  loop
    perform public.notify(
      recipient.user_id,
      'message',
      'New message',
      sender_name || ' sent you a message.',
      jsonb_build_object(
        'from', new.sender_id,
        'path', '/messages?with=' || new.sender_id::text
      )
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_direct_message() from public, anon, authenticated;

drop trigger if exists messages_notify_recipient on public.messages;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify_recipient
  after insert on public.messages
  for each row execute function public.notify_direct_message();

create or replace function public.notify_social_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  post_author uuid;
  commenter_name text;
begin
  select post.author_id
    into post_author
    from public.social_feed_posts post
   where post.id = new.post_id
     and post.removed_at is null;

  if post_author is null or post_author = new.author_id then
    return new;
  end if;

  select coalesce(profile.full_name, 'A TOL member')
    into commenter_name
    from public.profiles profile
   where profile.id = new.author_id;

  perform public.notify(
    post_author,
    'post_comment',
    'New comment on your post',
    commenter_name || ' commented on your post.',
    jsonb_build_object('post_id', new.post_id, 'path', '/home?post=' || new.post_id::text)
  );
  return new;
end;
$$;

revoke all on function public.notify_social_comment() from public, anon, authenticated;

drop trigger if exists social_feed_comments_notify on public.social_feed_comments;
create trigger social_feed_comments_notify
  after insert on public.social_feed_comments
  for each row execute function public.notify_social_comment();

create or replace function public.notify_social_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  post_author uuid;
  liker_name text;
begin
  select post.author_id
    into post_author
    from public.social_feed_posts post
   where post.id = new.post_id
     and post.removed_at is null;

  if post_author is null or post_author = new.user_id then
    return new;
  end if;

  select coalesce(profile.full_name, 'A TOL member')
    into liker_name
    from public.profiles profile
   where profile.id = new.user_id;

  perform public.notify(
    post_author,
    'post_like',
    'New like on your post',
    liker_name || ' liked your post.',
    jsonb_build_object('post_id', new.post_id, 'path', '/home?post=' || new.post_id::text)
  );
  return new;
end;
$$;

revoke all on function public.notify_social_like() from public, anon, authenticated;

drop trigger if exists social_feed_likes_notify on public.social_feed_likes;
create trigger social_feed_likes_notify
  after insert on public.social_feed_likes
  for each row execute function public.notify_social_like();

create or replace function public.notify_network_declined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  responder_name text;
begin
  if old.status <> 'pending' or new.status <> 'declined' then
    return new;
  end if;

  select coalesce(profile.full_name, 'A TOL member')
    into responder_name
    from public.profiles profile
   where profile.id = new.recipient_id;

  perform public.notify(
    new.requester_id,
    'network_declined',
    'Network Request Declined',
    responder_name || ' declined your network request.',
    jsonb_build_object('from', new.recipient_id, 'path', '/connections')
  );
  return new;
end;
$$;

revoke all on function public.notify_network_declined() from public, anon, authenticated;

drop trigger if exists network_requests_notify_declined on public.network_requests;
create trigger network_requests_notify_declined
  after update of status on public.network_requests
  for each row execute function public.notify_network_declined();

create or replace function public.join_builtin_group(target_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  group_record public.builtin_groups%rowtype;
  membership_added boolean;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to join a group.';
  end if;

  select * into group_record
    from public.builtin_groups
   where id = target_group_id;

  if not found then
    raise exception 'That group could not be found.';
  end if;

  insert into public.builtin_group_memberships (group_id, user_id)
  values (target_group_id, current_user_id)
  on conflict do nothing;
  membership_added := found;

  if membership_added then
    insert into public.notifications (user_id, type, title, body, data)
    select membership.user_id,
           'community_activity',
           'New community member',
           coalesce(profile.full_name, 'A TOL member') || ' joined ' || group_record.group_value || '.',
           jsonb_build_object('group_id', target_group_id, 'path', '/communities')
      from public.builtin_group_memberships membership
      left join public.profiles profile on profile.id = current_user_id
     where membership.group_id = target_group_id
       and membership.user_id <> current_user_id;
  end if;
end;
$$;

revoke all on function public.join_builtin_group(uuid) from public;
grant execute on function public.join_builtin_group(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
