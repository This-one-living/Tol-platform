create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  direct_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists conversation_participants_user_id_idx
  on public.conversation_participants (user_id, conversation_id);
create index if not exists messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at desc);

create or replace function public.is_conversation_participant(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_participants participant
    where participant.conversation_id = target_conversation_id
      and participant.user_id = auth.uid()
  );
$$;

create or replace function public.start_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  conversation_id uuid;
  conversation_key text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to start a conversation.';
  end if;

  if other_user_id is null or other_user_id = current_user_id then
    raise exception 'Choose another person to start a conversation.';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = other_user_id) then
    raise exception 'That profile could not be found.';
  end if;

  conversation_key := least(current_user_id::text, other_user_id::text)
    || ':' || greatest(current_user_id::text, other_user_id::text);

  insert into public.conversations (direct_key)
  values (conversation_key)
  on conflict (direct_key) do update set direct_key = excluded.direct_key
  returning id into conversation_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conversation_id, current_user_id), (conversation_id, other_user_id)
  on conflict do nothing;

  return conversation_id;
end;
$$;

create or replace function public.search_message_people(search_text text)
returns table (id uuid, full_name text, niche text, community text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.id,
         coalesce(profile.full_name, 'TOL member')::text,
         profile.niche::text,
         profile.community::text
  from public.profiles profile
  where auth.uid() is not null
    and profile.id <> auth.uid()
    and coalesce(profile.full_name, '') ilike '%' || coalesce(search_text, '') || '%'
  order by profile.full_name
  limit 30;
$$;

create or replace function public.get_message_inbox()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  full_name text,
  niche text,
  community text,
  last_message text,
  last_message_at timestamptz,
  last_sender_id uuid,
  last_read_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select conversation.id,
         other_participant.user_id,
         coalesce(profile.full_name, 'TOL member')::text,
         profile.niche::text,
         profile.community::text,
         latest_message.body,
         latest_message.created_at,
         latest_message.sender_id,
         my_participant.last_read_at
  from public.conversation_participants my_participant
  join public.conversations conversation
    on conversation.id = my_participant.conversation_id
  join public.conversation_participants other_participant
    on other_participant.conversation_id = conversation.id
   and other_participant.user_id <> my_participant.user_id
  left join public.profiles profile
    on profile.id = other_participant.user_id
  left join lateral (
    select message.body, message.created_at, message.sender_id
    from public.messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest_message on true
  where my_participant.user_id = auth.uid()
  order by coalesce(latest_message.created_at, conversation.created_at) desc;
$$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Participants can view their conversations" on public.conversations;
create policy "Participants can view their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_participant(id));

drop policy if exists "Participants can view conversation members" on public.conversation_participants;
create policy "Participants can view conversation members"
  on public.conversation_participants for select to authenticated
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "Users can update their own read position" on public.conversation_participants;
create policy "Users can update their own read position"
  on public.conversation_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Participants can read conversation messages" on public.messages;
create policy "Participants can read conversation messages"
  on public.messages for select to authenticated
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "Participants can send their own messages" on public.messages;
create policy "Participants can send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

grant select on public.conversations, public.conversation_participants, public.messages to authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;
revoke all on function public.is_conversation_participant(uuid) from public;
revoke all on function public.start_direct_conversation(uuid) from public;
revoke all on function public.search_message_people(text) from public;
revoke all on function public.get_message_inbox() from public;
grant execute on function public.is_conversation_participant(uuid) to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.search_message_people(text) to authenticated;
grant execute on function public.get_message_inbox() to authenticated;

create or replace function public.update_conversation_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.update_conversation_timestamp() from public;

drop trigger if exists update_conversation_timestamp on public.messages;
create trigger update_conversation_timestamp
  after insert on public.messages
  for each row execute function public.update_conversation_timestamp();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
