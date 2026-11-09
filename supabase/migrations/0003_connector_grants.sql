create table public.mcp_project_grants (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pending_authorization_id text,
  activated_at timestamptz,
  primary key (user_id, client_id, project_id),
  unique (user_id, client_id),
  check ((pending_authorization_id is null) = (activated_at is not null))
);

alter table public.mcp_project_grants enable row level security;
revoke all on public.mcp_project_grants from public, anon;
grant select, insert, update, delete on public.mcp_project_grants to authenticated;

create policy manage_own_mcp_grants on public.mcp_project_grants for all to authenticated
  using (user_id = auth.uid() and (auth.jwt() ->> 'client_id') is null and public.is_allowed_user())
  with check (
    user_id = auth.uid() and (auth.jwt() ->> 'client_id') is null
    and public.is_allowed_user() and public.owns_project(project_id)
  );

create schema dexter_private;
grant usage on schema dexter_private to authenticated;

-- A previous access token stays blocked after reconnecting the same client.
-- OAuth sessions are created at code exchange, after the grant is activated.
create function dexter_private.mcp_grant(target_project uuid default null)
returns table (project_id uuid, can_edit boolean)
language sql stable security definer set search_path = ''
as $$
  select g.project_id, g.can_edit
  from public.mcp_project_grants g
  join auth.sessions s on s.id = (auth.jwt() ->> 'session_id')::uuid
    and s.user_id = g.user_id and s.oauth_client_id::text = g.client_id
    and s.created_at >= g.activated_at
  join auth.oauth_consents c on c.user_id = s.user_id and c.client_id = s.oauth_client_id
    and c.revoked_at is null
  where g.user_id = auth.uid()
    and g.client_id = (auth.jwt() ->> 'client_id')
    and (target_project is null or g.project_id = target_project)
    and public.owns_project(g.project_id)
    and public.is_allowed_user();
$$;

revoke all on function dexter_private.mcp_grant(uuid) from public;
grant execute on function dexter_private.mcp_grant(uuid) to authenticated;

create function public.current_mcp_project()
returns table (project_id uuid, can_edit boolean)
language sql stable set search_path = ''
as $$
  select * from dexter_private.mcp_grant();
$$;

create function public.prepare_mcp_project_grant(
  p_client_id text, p_project_id uuid, p_can_edit boolean, p_authorization_id text
)
returns boolean
language sql set search_path = ''
as $$
  with prepared as (
    insert into public.mcp_project_grants (client_id, project_id, can_edit, pending_authorization_id)
    values (p_client_id, p_project_id, p_can_edit, p_authorization_id)
    on conflict (user_id, client_id) do update
      set project_id = excluded.project_id, can_edit = excluded.can_edit,
          pending_authorization_id = excluded.pending_authorization_id, updated_at = now()
      where mcp_project_grants.activated_at is null
        and mcp_project_grants.updated_at < now() - interval '10 minutes'
    returning 1
  )
  select exists (select from prepared);
$$;

create function public.activate_mcp_project_grant(p_authorization_id text)
returns table (redirect_uri text, authorization_code text, oauth_state text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_auth auth.oauth_authorizations%rowtype;
begin
  if auth.uid() is null or (auth.jwt() ->> 'client_id') is not null or not public.is_allowed_user() then
    return;
  end if;

  -- Supabase creates the OAuth session only when the client exchanges the
  -- code. Finish project access before returning that code to the client.
  select a.* into v_auth
  from auth.oauth_authorizations a
  join auth.oauth_consents c on c.user_id = a.user_id and c.client_id = a.client_id and c.revoked_at is null
  where a.authorization_id = p_authorization_id and a.user_id = auth.uid()
    and a.status = 'approved' and a.authorization_code is not null and a.expires_at > now();
  if not found then
    return;
  end if;

  update public.mcp_project_grants g
  set activated_at = clock_timestamp(), pending_authorization_id = null, updated_at = now()
  where g.user_id = auth.uid() and g.client_id = v_auth.client_id::text
    and g.pending_authorization_id = p_authorization_id and g.activated_at is null
    and public.owns_project(g.project_id);

  -- A lost response or an OAuth login for an existing connection can safely
  -- reuse the grant without resetting the session cutoff or changing access.
  return query
    select v_auth.redirect_uri, v_auth.authorization_code, v_auth.state
    from public.mcp_project_grants g
    where g.user_id = auth.uid() and g.client_id = v_auth.client_id::text
      and g.activated_at is not null and public.owns_project(g.project_id);
end;
$$;

revoke all on function public.current_mcp_project() from public, anon;
revoke all on function public.prepare_mcp_project_grant(text, uuid, boolean, text) from public, anon;
revoke all on function public.activate_mcp_project_grant(text) from public, anon;
grant execute on function public.current_mcp_project() to authenticated;
grant execute on function public.prepare_mcp_project_grant(text, uuid, boolean, text) to authenticated;
grant execute on function public.activate_mcp_project_grant(text) to authenticated;

-- Restrictive policies intersect with the existing owner policies, including
-- when a connector calls the REST API directly.
create policy mcp_project_read on public.projects as restrictive for select to authenticated
  using ((auth.jwt() ->> 'client_id') is null or exists (select from dexter_private.mcp_grant(id)));

do $$
declare
  table_name text;
begin
  foreach table_name in array array['files', 'assets', 'revisions', 'staged_edits', 'compile_jobs'] loop
    execute format(
      'create policy mcp_project_read on public.%I as restrictive for select to authenticated
       using ((auth.jwt() ->> ''client_id'') is null or exists (select from dexter_private.mcp_grant(project_id)))',
      table_name
    );
  end loop;

  foreach table_name in array array['projects', 'files', 'assets', 'revisions', 'staged_edits', 'profiles', 'presence', 'usage_daily'] loop
    execute format(
      'create policy mcp_human_insert on public.%I as restrictive for insert to authenticated
       with check ((auth.jwt() ->> ''client_id'') is null)', table_name
    );
    execute format(
      'create policy mcp_human_update on public.%I as restrictive for update to authenticated
       using ((auth.jwt() ->> ''client_id'') is null) with check ((auth.jwt() ->> ''client_id'') is null)', table_name
    );
    execute format(
      'create policy mcp_human_delete on public.%I as restrictive for delete to authenticated
       using ((auth.jwt() ->> ''client_id'') is null)', table_name
    );
  end loop;

  foreach table_name in array array['profiles', 'presence', 'usage_daily'] loop
    execute format(
      'create policy mcp_human_read on public.%I as restrictive for select to authenticated
       using ((auth.jwt() ->> ''client_id'') is null)', table_name
    );
  end loop;
end;
$$;

alter table public.compile_jobs
  add column connector_client_id text default (auth.jwt() ->> 'client_id');

create policy mcp_compile_insert on public.compile_jobs as restrictive for insert to authenticated
  with check (
    (auth.jwt() ->> 'client_id') is null or (
      connector_client_id = (auth.jwt() ->> 'client_id') and engine = 'lambda'
      and status = 'running' and pdf_path is null
      and exists (select from dexter_private.mcp_grant(project_id))
    )
  );

create policy mcp_compile_update on public.compile_jobs as restrictive for update to authenticated
  using (
    (auth.jwt() ->> 'client_id') is null or (
      connector_client_id = (auth.jwt() ->> 'client_id')
      and exists (select from dexter_private.mcp_grant(project_id))
    )
  )
  with check (
    (auth.jwt() ->> 'client_id') is null or (
      connector_client_id = (auth.jwt() ->> 'client_id') and engine = 'lambda'
      and (pdf_path is null or pdf_path = owner || '/' || project_id || '/_builds/' || id || '.pdf')
      and exists (select from dexter_private.mcp_grant(project_id))
    )
  );

create policy mcp_compile_delete on public.compile_jobs as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'client_id') is null);

create policy mcp_project_storage_read on storage.objects as restrictive for select to authenticated
  using (
    (auth.jwt() ->> 'client_id') is null or (
      bucket_id = 'project-assets' and split_part(name, '/', 1) = auth.uid()::text
      and exists (
        select from dexter_private.mcp_grant() g
        where g.project_id::text = split_part(name, '/', 2)
      )
    )
  );

create policy mcp_build_upload on storage.objects as restrictive for insert to authenticated
  with check (
    (auth.jwt() ->> 'client_id') is null or (
      bucket_id = 'project-assets' and exists (
        select from public.compile_jobs j
        where name = j.owner || '/' || j.project_id || '/_builds/' || j.id || '.pdf'
          and j.owner = auth.uid() and j.status = 'running'
          and j.connector_client_id = (auth.jwt() ->> 'client_id')
      )
    )
  );

create policy mcp_storage_human_update on storage.objects as restrictive for update to authenticated
  using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);

create policy mcp_storage_human_delete on storage.objects as restrictive for delete to authenticated
  using ((auth.jwt() ->> 'client_id') is null);

-- Keep the original transactional edit and undo logic behind checked wrappers.
alter function public.apply_ai_edit(uuid, uuid, text, integer, text, text) set schema dexter_private;
alter function public.restore_cloud_revision(bigint) set schema dexter_private;
revoke all on function dexter_private.apply_ai_edit(uuid, uuid, text, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function dexter_private.restore_cloud_revision(bigint) from public, anon, authenticated, service_role;

create function public.apply_ai_edit(
  p_project_id uuid, p_file_id uuid, p_path text, p_base_version integer, p_new_content text, p_summary text
)
returns table (file_id uuid, file_path text, version integer, previous_version integer)
language plpgsql security definer set search_path = ''
as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    -- Serialize edits with permission changes and revocation.
    perform from public.mcp_project_grants g
    where g.user_id = auth.uid() and g.client_id = (auth.jwt() ->> 'client_id')
      and g.project_id = p_project_id
    for share;
    if not exists (select from dexter_private.mcp_grant(p_project_id) g where g.can_edit) then
      raise exception 'File editing is disabled for this connection. Enable it in Dexter Write > Connections.'
        using errcode = '42501';
    end if;
  end if;

  return query select * from dexter_private.apply_ai_edit(
    p_project_id, p_file_id, p_path, p_base_version, p_new_content, p_summary
  );
end;
$$;

create function public.restore_cloud_revision(p_revision_id bigint)
returns table (project_id uuid, file_id uuid, file_path text, version integer, deleted boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'Undo is available from a direct Dexter Write session.' using errcode = '42501';
  end if;

  return query select * from dexter_private.restore_cloud_revision(p_revision_id);
end;
$$;

revoke all on function public.apply_ai_edit(uuid, uuid, text, integer, text, text) from public, anon;
revoke all on function public.restore_cloud_revision(bigint) from public, anon;
grant execute on function public.apply_ai_edit(uuid, uuid, text, integer, text, text) to authenticated;
grant execute on function public.restore_cloud_revision(bigint) to authenticated;
