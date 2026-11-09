begin;

create function pg_temp.assert_count(actual bigint, expected bigint, context text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception '%: expected %, got %', context, expected, actual;
  end if;
end;
$$;

create function pg_temp.assert_denied(statement text)
returns void language plpgsql as $$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Unauthorized statement affected % rows: %', affected, statement;
  end if;
exception when insufficient_privilege then
  return;
end;
$$;

insert into public.allowed_users (github_username) values ('mcp-rls-test-owner');
insert into auth.users (id, raw_user_meta_data)
values ('10000000-0000-0000-0000-000000000001', '{"user_name":"mcp-rls-test-owner"}');

insert into auth.oauth_clients (id, registration_type, redirect_uris, grant_types, client_type)
values
  ('60000000-0000-0000-0000-000000000001', 'manual', 'http://localhost:5173/callback', 'authorization_code', 'public'),
  ('60000000-0000-0000-0000-000000000002', 'manual', 'http://localhost:5173/callback', 'authorization_code', 'public');

insert into auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope)
values ('70000000-0000-0000-0000-000000000001', 'request-one', '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'http://localhost:5173/callback', 'email');

insert into public.projects (id, owner, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Shared'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Private');

insert into public.files (id, project_id, path, content, mode) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'main.tex', 'Shared text', 'latex'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'main.tex', 'Private text', 'latex');

insert into storage.objects (bucket_id, name) values
  ('project-assets', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/image.png'),
  ('project-assets', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/image.png');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","user_metadata":{"user_name":"mcp-rls-test-owner"}}';

select pg_temp.assert_count((select count(*) from public.projects), 2, 'direct user can see both projects');
select pg_temp.assert_count(public.prepare_mcp_project_grant(
  '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, 'request-one'
)::int, 1, 'direct user can prepare consent');
select pg_temp.assert_count(public.prepare_mcp_project_grant(
  '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', true, 'request-one'
)::int, 0, 'a concurrent approval cannot change the pending project or edit permission');
select pg_temp.assert_count((select count(*) from public.activate_mcp_project_grant('request-one')), 0, 'Auth must approve before activation');

reset role;
insert into auth.sessions (id, user_id, oauth_client_id, created_at) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', now() - interval '1 minute'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', now() + interval '1 minute'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', now() + interval '1 minute');
insert into auth.oauth_consents (id, user_id, client_id, scopes)
values ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'email');
update auth.oauth_authorizations set status = 'approved', approved_at = now(), authorization_code = 'test-authorization-code'
where authorization_id = 'request-one';

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000002","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.current_mcp_project()), 0, 'pending consent grants no access');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.activate_mcp_project_grant('request-one') where authorization_code = 'test-authorization-code'), 1, 'direct user activates consent and receives the existing code');
create temp table initial_activation as select activated_at from public.mcp_project_grants;
select pg_temp.assert_count((select count(*) from public.activate_mcp_project_grant('request-one')), 1, 'activation is safe to retry');
select pg_temp.assert_count((select count(*) from public.mcp_project_grants where activated_at = (select activated_at from initial_activation)), 1, 'retry preserves session cutoff');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000001","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.projects), 0, 'older tokens stay blocked');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000003","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.projects), 0, 'a session from another client cannot use the grant');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000002","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.projects), 1, 'connector can list only the granted project');
select pg_temp.assert_count((select count(*) from public.projects where name = 'Private'), 0, 'non-granted project is hidden');
select pg_temp.assert_count((select count(*) from public.files where content ilike '%text%'), 1, 'connector can search only shared files');
select pg_temp.assert_count((select count(*) from public.mcp_project_grants), 0, 'connector cannot read grants');
select pg_temp.assert_count((select count(*) from public.activate_mcp_project_grant('request-one')), 0, 'connector cannot recover a code');
select pg_temp.assert_count((select count(*) from storage.objects where bucket_id = 'project-assets'), 1, 'connector can read only shared storage');
select pg_temp.assert_denied($sql$update public.mcp_project_grants set can_edit = true$sql$);
select pg_temp.assert_denied($sql$insert into public.mcp_project_grants (client_id, project_id, pending_authorization_id)
  values ('test-client-2', '20000000-0000-0000-0000-000000000002', 'fake-request')$sql$);
select pg_temp.assert_denied($sql$delete from public.mcp_project_grants$sql$);
select pg_temp.assert_denied($sql$insert into public.projects (name) values ('Unauthorized')$sql$);
select pg_temp.assert_denied($sql$update public.projects set name = 'Unauthorized'$sql$);
select pg_temp.assert_denied($sql$delete from public.projects$sql$);
select pg_temp.assert_denied($sql$update public.files set content = 'Unauthorized'$sql$);
select pg_temp.assert_denied($sql$select * from public.apply_ai_edit(
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'main.tex', 1, 'Unauthorized', ''
)$sql$);
select pg_temp.assert_denied($sql$select * from public.apply_ai_edit(
  '20000000-0000-0000-0000-000000000001', null, 'new.tex', null, 'Unauthorized', ''
)$sql$);
select pg_temp.assert_denied($sql$insert into storage.objects (bucket_id, name) values (
  'project-assets', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/unapproved.png'
)$sql$);

insert into public.compile_jobs (id, project_id, engine, status, main_path) values (
  '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'lambda', 'running', 'main.tex'
);
select pg_temp.assert_denied($sql$insert into public.compile_jobs (project_id, engine, status, main_path) values (
  '20000000-0000-0000-0000-000000000002', 'lambda', 'running', 'main.tex'
)$sql$);
select pg_temp.assert_denied($sql$insert into storage.objects (bucket_id, name) values (
  'project-assets', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/_builds/forged.pdf'
)$sql$);
insert into storage.objects (bucket_id, name) values (
  'project-assets', '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/_builds/50000000-0000-0000-0000-000000000001.pdf'
);
update public.compile_jobs set status = 'ok',
  pdf_path = '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/_builds/50000000-0000-0000-0000-000000000001.pdf';
select pg_temp.assert_count((select count(*) from public.compile_jobs where status = 'ok'), 1, 'read-only connector can finish a compile');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
update public.mcp_project_grants set can_edit = true;

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000002","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_denied($sql$update public.files set content = 'Bypass revision history'$sql$);
select pg_temp.assert_denied($sql$select * from public.apply_ai_edit(
  '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'main.tex', 1, 'Unauthorized', ''
)$sql$);
select pg_temp.assert_count((select count(*) from public.apply_ai_edit(
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'main.tex', 1, 'Authorized edit', 'Test edit'
)), 1, 'edit grant permits audited writes');
select pg_temp.assert_count((select count(*) from public.revisions where actor = 'ai'), 1, 'edit saves revision');
select pg_temp.assert_denied($sql$select * from public.restore_cloud_revision((select min(id) from public.revisions))$sql$);
select pg_temp.assert_count((select count(*) from public.apply_ai_edit(
  '20000000-0000-0000-0000-000000000001', null, 'new.tex', null, 'Authorized creation', 'Test creation'
)), 1, 'edit grant also permits audited file creation');
select pg_temp.assert_denied($sql$select * from dexter_private.apply_ai_edit(
  '20000000-0000-0000-0000-000000000001', null, 'bypass.tex', null, 'Unauthorized', ''
)$sql$);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.restore_cloud_revision((select min(id) from public.revisions))), 1, 'owner can undo');
select pg_temp.assert_count((select count(*) from public.files where content = 'Shared text'), 1, 'undo restores prior content');
delete from public.mcp_project_grants where client_id = '60000000-0000-0000-0000-000000000001';

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","client_id":"60000000-0000-0000-0000-000000000001","session_id":"40000000-0000-0000-0000-000000000002","user_metadata":{"user_name":"mcp-rls-test-owner"}}';
select pg_temp.assert_count((select count(*) from public.current_mcp_project()), 0, 'revocation immediately blocks the MCP request gate');
select pg_temp.assert_count((select count(*) from public.files), 0, 'revocation immediately blocks direct file reads');
select pg_temp.assert_count((select count(*) from storage.objects where bucket_id = 'project-assets'), 0, 'revocation blocks storage');

select '1..1';
select 'ok 1 - Connector grant isolation, compile, edits, undo, and revocation';
rollback;
