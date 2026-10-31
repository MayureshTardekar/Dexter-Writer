-- Direct MCP edits with an append-only revision trail.
--
-- The old flow staged every AI edit for human acceptance. This migration keeps
-- the same optimistic version check but applies the edit in one transaction and
-- stores the previous content in public.revisions so Undo is always available.

alter table public.revisions
  add column if not exists summary text not null default '';

create index if not exists revisions_ai_created_idx
  on public.revisions (project_id, actor, created_at desc);

create or replace function public.apply_ai_edit(
  p_project_id uuid,
  p_file_id uuid,
  p_path text,
  p_base_version integer,
  p_new_content text,
  p_summary text
)
returns table (
  file_id uuid,
  file_path text,
  version integer,
  previous_version integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target public.files%rowtype;
  v_updated public.files%rowtype;
  v_path text := trim(p_path);
  v_mode text;
begin
  if auth.uid() is null or not public.is_allowed_user() or not public.owns_project(p_project_id) then
    raise exception 'You do not have access to that project.';
  end if;
  if p_new_content is null then
    raise exception 'No content supplied.';
  end if;
  if octet_length(p_new_content) > 2097152 then
    raise exception 'The file would be larger than 2 MB.';
  end if;
  if v_path is null or v_path = '' or char_length(v_path) > 300 then
    raise exception 'A valid file path is required.';
  end if;

  if p_file_id is not null then
    select * into v_target
    from public.files
    where id = p_file_id
      and project_id = p_project_id
    for update;

    if not found then
      raise exception 'The target file no longer exists.';
    end if;
    if v_target.version <> p_base_version then
      raise exception 'Stale base_version %; the file is now version %.', p_base_version, v_target.version;
    end if;

    insert into public.revisions (project_id, file_id, path, content, version, actor, summary)
    values (p_project_id, v_target.id, v_target.path, v_target.content, v_target.version, 'ai', left(coalesce(p_summary, ''), 500));

    update public.files
    set content = p_new_content
    where id = v_target.id
    returning * into v_updated;

    update public.projects set updated_at = now() where id = p_project_id;

    return query
    select v_updated.id, v_updated.path, v_updated.version, v_target.version;
    return;
  end if;

  if exists (
    select 1 from public.files
    where project_id = p_project_id
      and path = v_path
  ) then
    raise exception 'A file with that path already exists. Edit it instead.';
  end if;

  v_mode := case
    when v_path like '%.tex' then 'latex'
    when v_path like '%.typ' then 'typst'
    else 'markdown'
  end;

  insert into public.files (project_id, path, content, mode)
  values (p_project_id, v_path, p_new_content, v_mode)
  returning * into v_updated;

  insert into public.revisions (project_id, file_id, path, content, version, actor, summary)
  values (p_project_id, v_updated.id, v_updated.path, '', 0, 'ai', left(coalesce(p_summary, ''), 500));

  update public.projects set updated_at = now() where id = p_project_id;

  return query
  select v_updated.id, v_updated.path, v_updated.version, 0;
end;
$$;

revoke all on function public.apply_ai_edit(uuid, uuid, text, integer, text, text) from public;
grant execute on function public.apply_ai_edit(uuid, uuid, text, integer, text, text) to authenticated;

create or replace function public.restore_cloud_revision(p_revision_id bigint)
returns table (
  project_id uuid,
  file_id uuid,
  file_path text,
  version integer,
  deleted boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_revision public.revisions%rowtype;
  v_target public.files%rowtype;
  v_updated public.files%rowtype;
begin
  select * into v_revision
  from public.revisions
  where id = p_revision_id;

  if not found then
    raise exception 'That revision no longer exists.';
  end if;
  if auth.uid() is null or not public.is_allowed_user() or not public.owns_project(v_revision.project_id) then
    raise exception 'You do not have access to that revision.';
  end if;

  select f.* into v_target
  from public.files f
  where f.project_id = v_revision.project_id
    and (
      (v_revision.file_id is not null and f.id = v_revision.file_id)
      or (v_revision.file_id is null and f.path = v_revision.path)
    )
  for update;

  if not found then
    raise exception 'The file for that revision no longer exists.';
  end if;

  insert into public.revisions (project_id, file_id, path, content, version, actor, summary)
  values (
    v_target.project_id,
    v_target.id,
    v_target.path,
    v_target.content,
    v_target.version,
    'human',
    left('Before undo: ' || coalesce(v_revision.summary, ''), 500)
  );

  if v_revision.version = 0 then
    delete from public.files where id = v_target.id;
    update public.projects set updated_at = now() where id = v_target.project_id;

    return query
    select v_target.project_id, v_target.id, v_target.path, 0, true;
    return;
  end if;

  update public.files
  set content = v_revision.content
  where id = v_target.id
  returning * into v_updated;

  update public.projects set updated_at = now() where id = v_target.project_id;

  return query
  select v_updated.project_id, v_updated.id, v_updated.path, v_updated.version, false;
end;
$$;

revoke all on function public.restore_cloud_revision(bigint) from public;
grant execute on function public.restore_cloud_revision(bigint) to authenticated;
