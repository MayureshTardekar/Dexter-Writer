import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { ProjectAsset } from '../assets';
import { modeForName, type ProjectFile } from '../projectFiles';
import { assertTextSize, projectFileToRow, rowToProjectFile, type CloudFileRow } from './mapping';
import { requireSupabase, supabase } from './supabase';

const ASSET_BUCKET = 'project-assets';

export interface CloudAccount {
  session: Session;
  username: string;
  allowed: boolean;
}

export interface CloudProject {
  id: string;
  name: string;
  activePath: string | null;
  updatedAt: string;
}

export interface CloudProjectBundle {
  files: ProjectFile[];
  assets: ProjectAsset[];
  activeName: string | null;
  warnings: string[];
}

export interface ImportProjectInput {
  name: string;
  files: ProjectFile[];
  assets: ProjectAsset[];
  activeName: string;
}

export interface CloudStagedEdit {
  id: string;
  projectId: string;
  fileId: string | null;
  path: string;
  baseVersion: number;
  summary: string;
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
  createdAt: string;
}

export interface CloudStagedEditDetail extends CloudStagedEdit {
  newContent: string;
}

export interface AcceptedCloudEdit {
  projectId: string;
  path: string;
  version: number;
}

export interface CloudRevision {
  id: number;
  projectId: string;
  fileId: string | null;
  path: string;
  version: number;
  actor: 'human' | 'ai';
  summary: string;
  createdAt: string;
}

export interface CloudRevisionRestore {
  projectId: string;
  fileId: string | null;
  path: string;
  version: number;
  deleted: boolean;
}

export interface CloudFileMeta {
  id: string;
  path: string;
  version: number;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  active_path: string | null;
  updated_at: string;
}

interface AssetRow {
  path: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

interface StagedEditRow {
  id: string;
  project_id: string;
  file_id: string | null;
  path: string;
  base_version: number;
  new_content: string;
  summary: string;
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
  created_at: string;
}

interface FileVersionRow {
  id: string;
  content: string;
  version: number;
}

interface RevisionRow {
  id: number;
  project_id: string;
  file_id: string | null;
  path: string;
  version: number;
  actor: 'human' | 'ai';
  summary: string | null;
  created_at: string;
}

interface FileMetaRow {
  id: string;
  path: string;
  version: number;
  updated_at: string;
}

function revisionFromRow(row: RevisionRow): CloudRevision {
  return {
    id: Number(row.id),
    projectId: row.project_id,
    fileId: row.file_id,
    path: row.path,
    version: row.version,
    actor: row.actor,
    summary: row.summary ?? '',
    createdAt: row.created_at,
  };
}

function stagedEditFromRow(row: StagedEditRow): CloudStagedEdit {
  return {
    id: row.id,
    projectId: row.project_id,
    fileId: row.file_id,
    path: row.path,
    baseVersion: row.base_version,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
  };
}

function usernameFromSession(session: Session): string {
  const meta = session.user.user_metadata as Record<string, unknown> | undefined;
  const candidate = meta?.user_name ?? meta?.preferred_username ?? meta?.login ?? session.user.email ?? session.user.id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : session.user.id;
}

async function currentUser(db: SupabaseClient) {
  const { data: { user }, error } = await db.auth.getUser();
  if (error) throw new Error(error.message);
  if (!user) throw new Error('Sign in with GitHub first.');
  return user;
}

async function isAllowed(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('is_allowed_user');
  if (error) {
    throw new Error(`${error.message}. Run supabase/migrations/0001_init.sql before using cloud sync.`);
  }
  return data === true;
}

async function accountFromSession(db: SupabaseClient, session: Session): Promise<CloudAccount> {
  return {
    session,
    username: usernameFromSession(session),
    allowed: await isAllowed(db),
  };
}

export async function getCloudAccount(): Promise<CloudAccount | null> {
  const db = supabase;
  if (!db) return null;
  const { data: { session }, error } = await db.auth.getSession();
  if (error) throw new Error(error.message);
  if (!session) return null;
  return accountFromSession(db, session);
}

export function onCloudAuthChange(cb: (session: Session | null) => void): () => void {
  const db = supabase;
  if (!db) return () => {};
  const { data } = db.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGitHub(redirectTo?: string): Promise<void> {
  const db = requireSupabase();
  const target = redirectTo ?? `${window.location.origin}${window.location.pathname}`;
  const { error } = await db.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: target, scopes: 'read:user' },
  });
  if (error) throw new Error(error.message);
}

export async function signOutFromCloud(): Promise<void> {
  const db = requireSupabase();
  const { error } = await db.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function listCloudProjects(): Promise<CloudProject[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('projects')
    .select('id,name,active_path,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProjectRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    activePath: row.active_path,
    updatedAt: row.updated_at,
  }));
}

async function uploadAssets(db: SupabaseClient, userId: string, projectId: string, assets: ProjectAsset[]): Promise<void> {
  for (const asset of assets) {
    if (asset.size > 50 * 1024 * 1024) throw new Error(`${asset.path} is larger than 50 MB.`);
    const objectPath = `${userId}/${projectId}/${asset.path}`;
    const { error: uploadError } = await db.storage
      .from(ASSET_BUCKET)
      .upload(objectPath, asset.blob, { upsert: true, contentType: asset.mime });
    if (uploadError) throw new Error(`${asset.path}: ${uploadError.message}`);

    const { error: rowError } = await db.from('assets').upsert(
      {
        project_id: projectId,
        path: asset.path,
        name: asset.name,
        mime: asset.mime,
        size: asset.size,
        width: asset.width,
        height: asset.height,
      },
      { onConflict: 'project_id,path' },
    );
    if (rowError) throw new Error(`${asset.path}: ${rowError.message}`);
  }
}

export async function importProject(input: ImportProjectInput): Promise<string> {
  const db = requireSupabase();
  const user = await currentUser(db);
  for (const file of input.files) assertTextSize(file.name, file.content);

  const name = input.name.trim().slice(0, 120) || 'Untitled project';
  const { data, error } = await db
    .from('projects')
    .insert({ owner: user.id, name, active_path: input.activeName || null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const projectId = (data as { id: string } | null)?.id;
  if (!projectId) throw new Error('The cloud project was not created.');

  if (input.files.length > 0) {
    const rows = input.files.map((file) => projectFileToRow(file, projectId));
    const { error: fileError } = await db.from('files').insert(rows);
    if (fileError) throw new Error(fileError.message);
  }

  await uploadAssets(db, user.id, projectId, input.assets);
  return projectId;
}

export async function pushProject(
  projectId: string,
  files: ProjectFile[],
  activeName: string,
  assets: ProjectAsset[],
): Promise<void> {
  const db = requireSupabase();
  const user = await currentUser(db);
  for (const file of files) assertTextSize(file.name, file.content);

  const { data: existing, error: existingError } = await db
    .from('files')
    .select('path')
    .eq('project_id', projectId);
  if (existingError) throw new Error(existingError.message);

  if (files.length > 0) {
    const rows = files.map((file) => projectFileToRow(file, projectId));
    const { error } = await db.from('files').upsert(rows, { onConflict: 'project_id,path' });
    if (error) throw new Error(error.message);
  }

  const nextPaths = new Set(files.map((file) => file.name));
  const stalePaths = ((existing ?? []) as Array<{ path: string }>)
    .map((row) => row.path)
    .filter((path) => !nextPaths.has(path));
  if (stalePaths.length > 0) {
    const { error } = await db.from('files').delete().eq('project_id', projectId).in('path', stalePaths);
    if (error) throw new Error(error.message);
  }

  const { error: projectError } = await db
    .from('projects')
    .update({ active_path: activeName || null })
    .eq('id', projectId);
  if (projectError) throw new Error(projectError.message);

  await uploadAssets(db, user.id, projectId, assets);
}

export async function loadProject(
  projectId: string,
  localProjectId: string,
): Promise<CloudProjectBundle> {
  const db = requireSupabase();
  const user = await currentUser(db);

  const { data: projectData, error: projectError } = await db
    .from('projects')
    .select('id,name,active_path,updated_at')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!projectData) throw new Error('That cloud project no longer exists.');

  const [fileResult, assetResult] = await Promise.all([
    db.from('files').select('id,path,content,mode,version,updated_at').eq('project_id', projectId).order('path'),
    db.from('assets').select('path,name,mime,size,width,height').eq('project_id', projectId).order('path'),
  ]);
  if (fileResult.error) throw new Error(fileResult.error.message);
  if (assetResult.error) throw new Error(assetResult.error.message);

  const files = ((fileResult.data ?? []) as CloudFileRow[])
    .map(rowToProjectFile)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) throw new Error('That cloud project has no files. Push a local project first.');

  const assets: ProjectAsset[] = [];
  const warnings: string[] = [];
  for (const row of (assetResult.data ?? []) as AssetRow[]) {
    const objectPath = `${user.id}/${projectId}/${row.path}`;
    const { data: blob, error } = await db.storage.from(ASSET_BUCKET).download(objectPath);
    if (error || !blob) {
      warnings.push(`${row.path}: ${error?.message ?? 'download failed'}`);
      continue;
    }
    assets.push({
      id: crypto.randomUUID(),
      projectId: localProjectId,
      path: row.path,
      name: row.name,
      mime: row.mime,
      size: row.size,
      width: row.width ?? 0,
      height: row.height ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blob,
    });
  }

  const project = projectData as ProjectRow;
  return {
    files,
    assets,
    activeName: project.active_path ?? files[0]?.name ?? null,
    warnings,
  };
}

export async function deleteCloudProject(projectId: string): Promise<void> {
  const db = requireSupabase();
  const user = await currentUser(db);

  const { data: assets, error: assetError } = await db
    .from('assets')
    .select('path')
    .eq('project_id', projectId);
  if (assetError) throw new Error(assetError.message);

  const paths = ((assets ?? []) as Array<{ path: string }>)
    .map((row) => `${user.id}/${projectId}/${row.path}`);
  if (paths.length > 0) {
    await db.storage.from(ASSET_BUCKET).remove(paths);
  }

  const { error } = await db.from('projects').delete().eq('id', projectId);
  if (error) throw new Error(error.message);
}

export async function listRecentRevisions(projectId?: string): Promise<CloudRevision[]> {
  const db = requireSupabase();
  let query = db
    .from('revisions')
    .select('id,project_id,file_id,path,version,actor,summary,created_at')
    .eq('actor', 'ai')
    .order('created_at', { ascending: false })
    .limit(50);
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as RevisionRow[]).map(revisionFromRow);
}

export async function restoreCloudRevision(revisionId: number): Promise<CloudRevisionRestore> {
  const db = requireSupabase();
  const { data, error } = await db.rpc('restore_cloud_revision', { p_revision_id: revisionId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The revision could not be restored.');
  const restored = row as {
    project_id: string;
    file_id: string | null;
    file_path: string;
    version: number;
    deleted: boolean;
  };
  return {
    projectId: restored.project_id,
    fileId: restored.file_id,
    path: restored.file_path,
    version: restored.version,
    deleted: restored.deleted,
  };
}

export async function listCloudFileMeta(projectId: string): Promise<CloudFileMeta[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('files')
    .select('id,path,version,updated_at')
    .eq('project_id', projectId)
    .order('path');
  if (error) throw new Error(error.message);
  return ((data ?? []) as FileMetaRow[]).map((row) => ({
    id: row.id,
    path: row.path,
    version: row.version,
    updatedAt: row.updated_at,
  }));
}

export async function fetchCloudFiles(projectId: string, paths: string[]): Promise<CloudFileRow[]> {
  if (paths.length === 0) return [];
  const db = requireSupabase();
  const { data, error } = await db
    .from('files')
    .select('id,path,content,mode,version,updated_at')
    .eq('project_id', projectId)
    .in('path', paths);
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudFileRow[];
}

export async function listPendingEdits(): Promise<CloudStagedEdit[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('staged_edits')
    .select('id,project_id,file_id,path,base_version,summary,status,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as StagedEditRow[]).map(stagedEditFromRow);
}

export async function getStagedEdit(editId: string): Promise<CloudStagedEditDetail> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('staged_edits')
    .select('id,project_id,file_id,path,base_version,new_content,summary,status,created_at')
    .eq('id', editId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That staged edit no longer exists.');
  const row = data as StagedEditRow;
  return { ...stagedEditFromRow(row), newContent: row.new_content };
}

async function markEditStale(db: SupabaseClient, editId: string): Promise<void> {
  await db
    .from('staged_edits')
    .update({ status: 'stale', resolved_at: new Date().toISOString() })
    .eq('id', editId)
    .eq('status', 'pending');
}

export async function acceptStagedEdit(editId: string): Promise<AcceptedCloudEdit> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('staged_edits')
    .select('id,project_id,file_id,path,base_version,new_content,summary,status,created_at')
    .eq('id', editId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That staged edit is no longer pending.');
  const edit = data as StagedEditRow;

  let version = 1;
  if (edit.file_id) {
    const { data: fileData, error: fileError } = await db
      .from('files')
      .select('id,content,version')
      .eq('id', edit.file_id)
      .maybeSingle();
    if (fileError) throw new Error(fileError.message);
    const file = fileData as FileVersionRow | null;
    if (!file) {
      await markEditStale(db, edit.id);
      throw new Error('The target file was deleted. This edit is now stale.');
    }
    if (file.version !== edit.base_version) {
      await markEditStale(db, edit.id);
      throw new Error(`The file changed to version ${file.version}; this edit was based on ${edit.base_version}. Ask the AI to reread the file.`);
    }

    const { data: updated, error: updateError } = await db
      .from('files')
      .update({ content: edit.new_content })
      .eq('id', edit.file_id)
      .eq('version', edit.base_version)
      .select('id,version')
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      await markEditStale(db, edit.id);
      throw new Error('The file changed while accepting. This edit is now stale.');
    }
    version = (updated as { version: number }).version;

    const { error: revisionError } = await db.from('revisions').insert({
      project_id: edit.project_id,
      file_id: edit.file_id,
      path: edit.path,
      content: file.content,
      version: file.version,
      actor: 'human',
    });
    if (revisionError) throw new Error(revisionError.message);
  } else {
    const { data: existing, error: existingError } = await db
      .from('files')
      .select('id')
      .eq('project_id', edit.project_id)
      .eq('path', edit.path)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      await markEditStale(db, edit.id);
      throw new Error('A file with that path already exists. This edit is now stale.');
    }

    const { data: inserted, error: insertError } = await db
      .from('files')
      .insert({
        project_id: edit.project_id,
        path: edit.path,
        content: edit.new_content,
        mode: modeForName(edit.path),
      })
      .select('id,version')
      .single();
    if (insertError) throw new Error(insertError.message);
    version = (inserted as { version: number }).version;
  }

  const { error: resolveError } = await db
    .from('staged_edits')
    .update({ status: 'accepted', resolved_at: new Date().toISOString() })
    .eq('id', edit.id)
    .eq('status', 'pending');
  if (resolveError) throw new Error(resolveError.message);

  await db.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', edit.project_id);
  return { projectId: edit.project_id, path: edit.path, version };
}

export async function rejectStagedEdit(editId: string): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from('staged_edits')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', editId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
}
