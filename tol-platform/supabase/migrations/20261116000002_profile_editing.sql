alter table public.profiles
  add column if not exists avatar_url text;

create or replace function public.get_my_profile()
returns table (
  full_name text,
  phone text,
  lga text,
  community text,
  niche text,
  category text,
  other_niche text,
  interests jsonb,
  skills jsonb,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile.full_name::text,
         profile.phone::text,
         profile.lga::text,
         profile.community::text,
         profile.niche::text,
         profile.category::text,
         profile.other_niche::text,
         to_jsonb(profile.interests),
         to_jsonb(profile.skills),
         profile.avatar_url::text
  from public.profiles profile
  where profile.id = auth.uid();
$$;

create or replace function public.update_my_profile(profile_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be signed in to update your profile.';
  end if;

  if jsonb_typeof(profile_data) <> 'object' then
    raise exception 'Invalid profile data.';
  end if;

  if nullif(btrim(profile_data ->> 'full_name'), '') is null then
    raise exception 'Full name is required.';
  end if;

  if regexp_replace(coalesce(profile_data ->> 'phone', ''), '[[:space:]]', '', 'g')
     !~ '^(\+234|0)[789][0-9]{9}$' then
    raise exception 'Enter a valid Nigerian phone number.';
  end if;

  update public.profiles as profile
  set full_name = fields.full_name,
      phone = fields.phone,
      lga = fields.lga,
      community = fields.community,
      niche = fields.niche,
      category = fields.category,
      other_niche = fields.other_niche,
      interests = fields.interests,
      skills = fields.skills,
      avatar_url = fields.avatar_url
  from jsonb_populate_record(null::public.profiles, profile_data) as fields
  where profile.id = current_user_id;

  if not found then
    raise exception 'Your profile could not be found.';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can view their own profile photo objects" on storage.objects;
create policy "Users can view their own profile photo objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can upload their own profile photo" on storage.objects;
create policy "Users can upload their own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

revoke all on function public.get_my_profile() from public;
revoke all on function public.update_my_profile(jsonb) from public;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(jsonb) to authenticated;

drop policy if exists "Users can replace their own profile photo" on storage.objects;
create policy "Users can replace their own profile photo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
