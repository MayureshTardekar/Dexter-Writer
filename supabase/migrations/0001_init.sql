-- Dexter Write cloud schema.
-- Run with: supabase db push   (or paste into the SQL editor)
--
-- Model: one owner per project, at most ten allowlisted GitHub usernames.
-- The AI can only write rows into staged_edits. Accepting an edit is a human
-- action performed by the Dexter Write UI after a base_version check.

-- ---------------------------------------------------------------------------
-- Identity and allowlist
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  github_username text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_github_username_lower_idx
  on public.profiles (lower(github_username));

create table if not exists public.allowed_users (
  github_username text primary key,
  note text,
  created_at timestamptz not null default now(),
  constraint allowed_users_lowercase check (github_username = lower(github_username))
);

create unique index if not exists allowed_users_github_username_lower_idx
  on public.allowed_users (lower(github_username));

alter table public.allowed_users enable row level security;
-- No policies: only the service role and the security-definer helper below
-- may read or write the allowlist.

-- The GitHub login claim differs slightly between providers. Try the common
-- keys, then fall back to null. Never trust a client-supplied username.
create or replace function public.current_github_username()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'user_metadata' ->> 'user_name',
    auth.jwt() -> 'user_metadata' ->> 'preferred_username',
    auth.jwt() -> 'user_metadata' ->> 'login'
  );
$$;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.allowed_users a
    where lower(a.github_username) = lower(public.current_github_username())
  );
$$;

revoke all on function public.is_allowed_user() from public;
grant execute on function public.is_allowed_user() to authenticated;



-- Create a profile for every new GitHub user. The app still refuses to use a
-- cloud project when is_allowed_user() is false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gh text;
begin
  gh := coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    new.raw_user_meta_data ->> 'login',
    new.email,
    new.id::text
  );

  insert into public.profiles (id, github_username, display_name)
  values (new.id, gh, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update
    set github_username = excluded.github_username,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Projects and files
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  active_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner, updated_at desc);

create or replace function public.owns_project(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target
      and p.owner = auth.uid()
  );
$$;

revoke all on function public.owns_project(uuid) from public;
grant execute on function public.owns_project(uuid) to authenticated;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  path text not null check (char_length(path) between 1 and 300),
  content text not null default '',
  mode text not null default 'markdown' check (mode in ('markdown', 'latex', 'typst')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path),
  constraint files_content_size check (octet_length(content) <= 2097152)
);

create index if not exists files_project_path_idx
  on public.files (project_id, path);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  path text not null check (char_length(path) between 1 and 300),
  name text not null,
  mime text not null,
  size integer not null check (size >= 0 and size <= 52428800),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create index if not exists assets_project_idx
  on public.assets (project_id);

create table if not exists public.revisions (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  path text not null,
  content text not null,
  version integer not null,
  actor text not null default 'human' check (actor in ('human', 'ai')),
  created_at timestamptz not null default now(),
  constraint revisions_content_size check (octet_length(content) <= 2097152)
);

create index if not exists revisions_project_created_idx
  on public.revisions (project_id, created_at desc);

create table if not exists public.staged_edits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  file_id uuid references public.files (id) on delete cascade,
  path text not null,
  base_version integer not null,
  new_content text not null,
  summary text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'stale')),
  created_by text not null default 'ai' check (created_by in ('human', 'ai')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint staged_edits_content_size check (octet_length(new_content) <= 2097152)
);

create index if not exists staged_edits_pending_idx
  on public.staged_edits (project_id, status, created_at desc);

create table if not exists public.compile_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  engine text not null default 'browser' check (engine in ('browser', 'lambda')),
  status text not null default 'queued' check (status in ('queued', 'running', 'ok', 'error', 'canceled')),
  main_path text not null,
  pdf_path text,
  log text,
  page_count integer,
  compile_ms integer,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists compile_jobs_project_created_idx
  on public.compile_jobs (project_id, created_at desc);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  tool_calls integer not null default 0 check (tool_calls >= 0),
  compiles integer not null default 0 check (compiles >= 0),
  bytes_written bigint not null default 0 check (bytes_written >= 0),
  primary key (user_id, day)
);

create table if not exists public.presence (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists assets_touch_updated_at on public.assets;
create trigger assets_touch_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

create or replace function public.bump_file_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.content is distinct from old.content then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists files_bump_version on public.files;
create trigger files_bump_version
  before update on public.files
  for each row execute function public.bump_file_version();

drop trigger if exists files_touch_updated_at on public.files;
create trigger files_touch_updated_at
  before update on public.files
  for each row execute function public.touch_updated_at();

-- Prevent a staged edit or revision from pointing at a file in another
-- project. RLS protects the project, this protects the relationship.
create or replace function public.validate_file_relationship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.file_id is not null and not exists (
    select 1
    from public.files f
    where f.id = new.file_id
      and f.project_id = new.project_id
  ) then
    raise exception 'file_id does not belong to project_id';
  end if;
  return new;
end;
$$;

drop trigger if exists staged_edits_validate_file on public.staged_edits;
create trigger staged_edits_validate_file
  before insert or update of file_id, project_id on public.staged_edits
  for each row execute function public.validate_file_relationship();

drop trigger if exists revisions_validate_file on public.revisions;
create trigger revisions_validate_file
  before insert or update of file_id, project_id on public.revisions
  for each row execute function public.validate_file_relationship();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.files enable row level security;
alter table public.assets enable row level security;
alter table public.revisions enable row level security;
alter table public.staged_edits enable row level security;
alter table public.compile_jobs enable row level security;
alter table public.usage_daily enable row level security;
alter table public.presence enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
  for select to authenticated
  using (owner = auth.uid() and public.is_allowed_user());

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (owner = auth.uid() and public.is_allowed_user());

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
  for update to authenticated
  using (owner = auth.uid() and public.is_allowed_user())
  with check (owner = auth.uid() and public.is_allowed_user());

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
  for delete to authenticated
  using (owner = auth.uid() and public.is_allowed_user());

do $$
declare
  table_name text;
begin
  foreach table_name in array array['files', 'assets', 'revisions', 'staged_edits', 'compile_jobs'] loop
    execute format('drop policy if exists %I_select_own on public.%I', table_name, table_name);
    execute format(
      'create policy %I_select_own on public.%I for select to authenticated using (public.owns_project(project_id) and public.is_allowed_user())',
      table_name, table_name
    );

    execute format('drop policy if exists %I_insert_own on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert_own on public.%I for insert to authenticated with check (public.owns_project(project_id) and public.is_allowed_user())',
      table_name, table_name
    );

    execute format('drop policy if exists %I_update_own on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update_own on public.%I for update to authenticated using (public.owns_project(project_id) and public.is_allowed_user()) with check (public.owns_project(project_id) and public.is_allowed_user())',
      table_name, table_name
    );

    execute format('drop policy if exists %I_delete_own on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete_own on public.%I for delete to authenticated using (public.owns_project(project_id) and public.is_allowed_user())',
      table_name, table_name
    );
  end loop;
end;
$$;

-- Revisions are append-only history.
drop policy if exists revisions_update_own on public.revisions;
drop policy if exists revisions_delete_own on public.revisions;

-- A compile job must belong to the caller as well as the project.
drop policy if exists compile_jobs_insert_own on public.compile_jobs;
create policy compile_jobs_insert_own on public.compile_jobs
  for insert to authenticated
  with check (
    owner = auth.uid()
    and public.owns_project(project_id)
    and public.is_allowed_user()
  );

drop policy if exists compile_jobs_update_own on public.compile_jobs;
create policy compile_jobs_update_own on public.compile_jobs
  for update to authenticated
  using (
    owner = auth.uid()
    and public.owns_project(project_id)
    and public.is_allowed_user()
  )
  with check (
    owner = auth.uid()
    and public.owns_project(project_id)
    and public.is_allowed_user()
  );

drop policy if exists usage_select_self on public.usage_daily;
create policy usage_select_self on public.usage_daily
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists presence_select_own on public.presence;
create policy presence_select_own on public.presence
  for select to authenticated
  using (user_id = auth.uid() and public.owns_project(project_id));

drop policy if exists presence_insert_own on public.presence;
create policy presence_insert_own on public.presence
  for insert to authenticated
  with check (user_id = auth.uid() and public.owns_project(project_id) and public.is_allowed_user());

drop policy if exists presence_update_own on public.presence;
create policy presence_update_own on public.presence
  for update to authenticated
  using (user_id = auth.uid() and public.owns_project(project_id))
  with check (user_id = auth.uid() and public.owns_project(project_id) and public.is_allowed_user());

drop policy if exists presence_delete_own on public.presence;
create policy presence_delete_own on public.presence
  for delete to authenticated
  using (user_id = auth.uid() and public.owns_project(project_id));

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, objects keyed by <user-id>/<project-id>/<path>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  false,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists project_assets_select_own on storage.objects;
create policy project_assets_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_allowed_user()
  );

drop policy if exists project_assets_insert_own on storage.objects;
create policy project_assets_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_allowed_user()
  );

drop policy if exists project_assets_update_own on storage.objects;
create policy project_assets_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_allowed_user()
  )
  with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_allowed_user()
  );

drop policy if exists project_assets_delete_own on storage.objects;
create policy project_assets_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_allowed_user()
  );

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------
--
-- Add yourself before signing in:
--   insert into public.allowed_users (github_username, note)
--   values ('your-github-handle', 'owner')
--   on conflict (github_username) do nothing;
--
-- Keep the list at ten or fewer. Removing a username blocks new reads and
-- writes immediately because every policy calls is_allowed_user().
