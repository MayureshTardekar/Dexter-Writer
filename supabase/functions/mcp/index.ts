import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.2';
import { z } from 'npm:zod@4.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const PUBLISHABLE_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SECRET_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const LATEX_LAMBDA_URL = Deno.env.get('LATEX_LAMBDA_URL') ?? '';
const COMPILE_CLOUD = (Deno.env.get('COMPILE_CLOUD') ?? 'on').toLowerCase() !== 'off';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_READ_CHARS = 160_000;
const MAX_SEARCH_FILES = 80;
const MAX_SEARCH_HITS = 40;
const TOOL_CALL_LIMIT = 100;
const COMPILE_LIMIT = 10;
const MAX_COMPILE_BYTES = 4 * 1024 * 1024;

type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

interface ProjectRef {
  id: string;
  name: string;
  active_path: string | null;
}

interface FileRef {
  id: string;
  path: string;
  content: string;
  mode: string;
  version: number;
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePath(raw: string): string {
  const value = raw.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!value) throw new Error('A file path is required.');
  if (value.length > 300) throw new Error('File paths are limited to 300 characters.');
  if (value.includes('\0')) throw new Error('File paths cannot contain null bytes.');
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('File paths cannot be empty, absolute, or contain . or .. segments.');
  }
  return value;
}

function modeForPath(path: string): 'markdown' | 'latex' | 'typst' {
  if (path.endsWith('.tex')) return 'latex';
  if (path.endsWith('.typ')) return 'typst';
  return 'markdown';
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertTextSize(path: string, content: string): void {
  if (utf8Bytes(content) > MAX_TEXT_BYTES) {
    throw new Error(`${path} is larger than 2 MB. Split the file before staging it.`);
  }
}

async function resolveProject(db: Db, projectId?: string): Promise<ProjectRef> {
  if (projectId) {
    const { data, error } = await db
      .from('projects')
      .select('id,name,active_path')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('That cloud project was not found.');
    return data as ProjectRef;
  }
  const { data, error } = await db
    .from('projects')
    .select('id,name,active_path')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const project = (data ?? [])[0] as ProjectRef | undefined;
  if (!project) throw new Error('No cloud project exists yet. Import a project from Dexter Write first.');
  return project;
}

async function findFile(db: Db, projectId: string, path: string): Promise<FileRef | null> {
  const { data, error } = await db
    .from('files')
    .select('id,path,content,mode,version')
    .eq('project_id', projectId)
    .eq('path', path)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FileRef | null) ?? null;
}

async function recordToolCall(admin: Db, userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from('usage_daily')
    .select('tool_calls')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (error) return true;
  const used = (data as { tool_calls: number } | null)?.tool_calls ?? 0;
  if (used >= TOOL_CALL_LIMIT) return false;
  await admin
    .from('usage_daily')
    .upsert({ user_id: userId, day, tool_calls: used + 1 }, { onConflict: 'user_id,day' });
  return true;
}

async function recordCompile(admin: Db, userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from('usage_daily')
    .select('compiles')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (error) return true;
  const used = (data as { compiles: number } | null)?.compiles ?? 0;
  if (used >= COMPILE_LIMIT) return false;
  await admin
    .from('usage_daily')
    .upsert({ user_id: userId, day, compiles: used + 1 }, { onConflict: 'user_id,day' });
  return true;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function chooseMainFile(project: ProjectRef, files: FileRef[], requested?: string): FileRef {
  if (requested) {
    const path = normalizePath(requested);
    const exact = files.find((file) => file.path === path);
    if (!exact) throw new Error(`Main file not found: ${path}`);
    if (!path.endsWith('.tex')) throw new Error('Remote compilation supports LaTeX (.tex) files only.');
    return exact;
  }

  const latexFiles = files.filter((file) => file.path.endsWith('.tex'));
  if (latexFiles.length === 0) {
    throw new Error('This project has no .tex file. Remote compilation supports LaTeX only; compile Typst or Markdown in the browser.');
  }
  const active = project.active_path
    ? latexFiles.find((file) => file.path === project.active_path)
    : undefined;
  if (active) return active;
  const main = latexFiles.find((file) => file.path === 'main.tex');
  if (main) return main;
  const root = latexFiles.find((file) => !file.path.includes('/'));
  return root ?? latexFiles[0];
}

async function finishCompile(db: Db, jobId: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .from('compile_jobs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', jobId);
}

function buildServer(db: Db, admin: Db, userId: string): McpServer {
  const server = new McpServer({ name: 'dexter-write', version: '0.1.0' });

  server.registerTool(
    'dexter_list_projects',
    {
      title: 'List Dexter Write projects',
      description: 'List the cloud writing projects available to the signed-in GitHub user. The newest project is the default when a tool omits project_id.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const { data, error } = await db
        .from('projects')
        .select('id,name,active_path,updated_at')
        .order('updated_at', { ascending: false });
      if (error) return fail(error.message);
      return json(data ?? []);
    },
  );

  server.registerTool(
    'dexter_list_files',
    {
      title: 'List files in a project',
      description: 'List every text file in a project with its path, syntax mode, and current version. Call this before editing so the next stage_edit uses the right base_version.',
      inputSchema: z.object({
        project_id: z.string().uuid().optional().describe('Project id. Omit to use the most recently updated project.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const project = await resolveProject(db, project_id);
      const { data, error } = await db
        .from('files')
        .select('path,mode,version,updated_at')
        .eq('project_id', project.id)
        .order('path');
      if (error) return fail(error.message);
      return json({ project, files: data ?? [] });
    },
  );

  server.registerTool(
    'dexter_read_file',
    {
      title: 'Read a project file',
      description: 'Read one text file. Large files are truncated; use stage_edit with old_text and new_text to change a specific passage without replacing the whole file.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Exact file path, for example chapters/intro.md or main.tex.'),
        project_id: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const project = await resolveProject(db, project_id);
      const file = await findFile(db, project.id, normalizePath(path));
      if (!file) return fail(`File not found: ${path}`);
      const truncated = file.content.length > MAX_READ_CHARS;
      const content = truncated
        ? `${file.content.slice(0, MAX_READ_CHARS)}\n\n[truncated: showing ${MAX_READ_CHARS} of ${file.content.length} characters]`
        : file.content;
      return json({ project_id: project.id, path: file.path, mode: file.mode, version: file.version, truncated, content });
    },
  );

  server.registerTool(
    'dexter_search_project',
    {
      title: 'Search a project',
      description: 'Search file contents for a case-insensitive string and return matching lines with line numbers. Useful for finding a section before editing it.',
      inputSchema: z.object({
        query: z.string().min(2),
        path_prefix: z.string().optional().describe('Only search paths starting with this prefix.'),
        project_id: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, path_prefix, project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const project = await resolveProject(db, project_id);
      const { data, error } = await db
        .from('files')
        .select('path,content')
        .eq('project_id', project.id)
        .order('path')
        .limit(MAX_SEARCH_FILES);
      if (error) return fail(error.message);
      const needle = query.toLowerCase();
      const prefix = path_prefix ? normalizePath(path_prefix) : '';
      const hits: Array<{ path: string; line: number; text: string }> = [];
      for (const file of (data ?? []) as Array<{ path: string; content: string }>) {
        if (prefix && !file.path.startsWith(prefix)) continue;
        const lines = file.content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].toLowerCase().includes(needle)) continue;
          hits.push({
            path: file.path,
            line: index + 1,
            text: lines[index].trim().slice(0, 240),
          });
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
        if (hits.length >= MAX_SEARCH_HITS) break;
      }
      return json({ project_id: project.id, query, hits, truncated: hits.length >= MAX_SEARCH_HITS });
    },
  );

  server.registerTool(
    'dexter_stage_edit',
    {
      title: 'Stage an AI edit for human review',
      description: 'Stage a change without applying it. The human must accept the edit in Dexter Write. Pass new_content to replace the whole file, or old_text/new_text to replace one exact passage. base_version must match the version returned by list_files or read_file.',
      inputSchema: z.object({
        path: z.string().min(1),
        base_version: z.number().int().nonnegative().describe('Current file version. Use 0 only when creating a new file.'),
        new_content: z.string().optional(),
        old_text: z.string().min(1).optional(),
        new_text: z.string().optional(),
        summary: z.string().min(1).max(500).describe('One sentence describing the change for the human reviewer.'),
        project_id: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, base_version, new_content, old_text, new_text, summary, project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const project = await resolveProject(db, project_id);
      const cleanPath = normalizePath(path);
      const file = await findFile(db, project.id, cleanPath);
      if (!file) return fail(`File not found: ${cleanPath}. Use dexter_create_file for a new file.`);
      if (file.version !== base_version) {
        return fail(`Stale base_version ${base_version}; the file is now version ${file.version}. Read it again before staging.`);
      }

      let content: string;
      if (typeof new_content === 'string') {
        content = new_content;
      } else if (old_text !== undefined && new_text !== undefined) {
        const count = file.content.split(old_text).length - 1;
        if (count === 0) return fail('old_text was not found in the current file.');
        if (count > 1) return fail(`old_text matched ${count} places. Include more surrounding text so it matches exactly once.`);
        content = file.content.replace(old_text, new_text);
      } else {
        return fail('Provide either new_content or both old_text and new_text.');
      }

      assertTextSize(cleanPath, content);
      if (content === file.content) return fail('The staged content is identical to the current file.');

      const { data, error } = await db
        .from('staged_edits')
        .insert({
          project_id: project.id,
          file_id: file.id,
          path: cleanPath,
          base_version,
          new_content: content,
          summary,
          created_by: 'ai',
        })
        .select('id,path,base_version,status,created_at')
        .single();
      if (error) return fail(error.message);
      return json({ staged: data, message: 'Edit staged. It will not change the file until the human accepts it in Dexter Write.' });
    },
  );

  server.registerTool(
    'dexter_create_file',
    {
      title: 'Stage a new file',
      description: 'Stage a brand-new text file for human review. The file appears only after the human accepts it in Dexter Write.',
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        summary: z.string().min(1).max(500),
        project_id: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, content, summary, project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const project = await resolveProject(db, project_id);
      const cleanPath = normalizePath(path);
      const existing = await findFile(db, project.id, cleanPath);
      if (existing) return fail(`${cleanPath} already exists. Use dexter_stage_edit instead.`);
      assertTextSize(cleanPath, content);

      const { data, error } = await db
        .from('staged_edits')
        .insert({
          project_id: project.id,
          file_id: null,
          path: cleanPath,
          base_version: 0,
          new_content: content,
          summary,
          created_by: 'ai',
        })
        .select('id,path,base_version,status,created_at')
        .single();
      if (error) return fail(error.message);
      return json({ staged: data, mode: modeForPath(cleanPath), message: 'New file staged. It appears after the human accepts it.' });
    },
  );

  server.registerTool(
    'dexter_pending_edits',
    {
      title: 'List pending AI edits',
      description: 'List edits that are waiting for human review. This does not include the full replacement text.',
      inputSchema: z.object({
        project_id: z.string().uuid().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      let query = db
        .from('staged_edits')
        .select('id,project_id,file_id,path,base_version,summary,status,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);
      if (project_id) query = query.eq('project_id', project_id);
      const { data, error } = await query;
      if (error) return fail(error.message);
      return json(data ?? []);
    },
  );

  server.registerTool(
    'dexter_compile_document',
    {
      title: 'Compile a LaTeX project in the cloud',
      description: 'Compile the current cloud files with Tectonic on AWS Lambda and return a signed PDF URL plus page count. This compiles accepted files only; accept staged edits in Dexter Write first. LaTeX only.',
      inputSchema: z.object({
        project_id: z.string().uuid().optional(),
        main_path: z.string().optional().describe('The root .tex file. Defaults to the active file, main.tex, or the first root .tex file.'),
        include_assets: z.boolean().optional().default(true).describe('Include project images from cloud storage (4 MB total limit).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ project_id, main_path, include_assets }) => {
      if (!COMPILE_CLOUD) {
        return fail('Cloud compilation is disabled (COMPILE_CLOUD=off).');
      }
      if (!LATEX_LAMBDA_URL) {
        return fail('Remote compilation is not configured. Set the LATEX_LAMBDA_URL secret for the mcp function.');
      }
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      if (!(await recordCompile(admin, userId))) return fail('Daily compile limit reached (10). Try again tomorrow.');

      const project = await resolveProject(db, project_id);
      const { data: fileRows, error: fileError } = await db
        .from('files')
        .select('id,path,content,mode,version')
        .eq('project_id', project.id)
        .order('path');
      if (fileError) return fail(fileError.message);
      const files = (fileRows ?? []) as FileRef[];
      if (files.length === 0) return fail('This project has no files to compile.');
      if (files.length > 200) return fail('This project has more than 200 files; the cloud compiler limit is 200.');

      let main: FileRef;
      try {
        main = chooseMainFile(project, files, main_path);
      } catch (error) {
        return fail(errorText(error));
      }

      const encoder = new TextEncoder();
      const payloadFiles: Array<{ path: string; base64: string }> = [];
      let totalBytes = encoder.encode(main.content).byteLength;
      for (const file of files) {
        if (file.id === main.id) continue;
        const bytes = encoder.encode(file.content);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_COMPILE_BYTES) {
          return fail('Project text exceeds the 4 MB cloud compile limit. Remove files or compile locally.');
        }
        payloadFiles.push({ path: file.path, base64: bytesToBase64(bytes) });
      }

      if (include_assets) {
        const { data: assetRows, error: assetError } = await db
          .from('assets')
          .select('path,size')
          .eq('project_id', project.id)
          .order('path');
        if (assetError) return fail(assetError.message);
        for (const asset of (assetRows ?? []) as Array<{ path: string; size: number }>) {
          if (payloadFiles.length >= 200) {
            return fail('Project has more than 200 support files; the cloud compiler limit is 200.');
          }
          if (totalBytes + asset.size > MAX_COMPILE_BYTES) {
            return fail(`Assets exceed the 4 MB cloud compile limit (at ${asset.path}). Compile locally or remove large images.`);
          }
          const objectPath = `${userId}/${project.id}/${asset.path}`;
          const { data: blob, error: downloadError } = await db.storage.from('project-assets').download(objectPath);
          if (downloadError || !blob) {
            return fail(`Could not read asset ${asset.path}: ${downloadError?.message ?? 'not found'}`);
          }
          const buffer = await blob.arrayBuffer();
          totalBytes += buffer.byteLength;
          if (totalBytes > MAX_COMPILE_BYTES) {
            return fail('Project files exceed the 4 MB cloud compile limit. Compile locally or remove large images.');
          }
          payloadFiles.push({ path: asset.path, base64: bytesToBase64(new Uint8Array(buffer)) });
        }
      }

      const { count: running, error: runningError } = await db
        .from('compile_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .eq('status', 'running')
        .gte('created_at', new Date(Date.now() - 60_000).toISOString());
      if (runningError) return fail(runningError.message);
      if ((running ?? 0) > 0) return fail('A compile is already running for this project. Wait for it to finish.');

      const { data: job, error: jobError } = await db
        .from('compile_jobs')
        .insert({
          project_id: project.id,
          engine: 'lambda',
          status: 'running',
          main_path: main.path,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (jobError) return fail(jobError.message);
      const jobId = (job as { id: string }).id;

      let response: Response;
      try {
        response = await fetch(LATEX_LAMBDA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tex: main.content, files: payloadFiles }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        const message = `Cloud compiler unreachable: ${errorText(error)}`;
        await finishCompile(db, jobId, { status: 'error', error: message.slice(0, 4000) });
        return fail(message);
      }

      if (!response.ok) {
        const raw = await response.text();
        let message = raw.slice(0, 4000);
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) message = parsed.error.slice(0, 4000);
        } catch {
          // Keep the raw body when the compiler returns HTML or plain text.
        }
        await finishCompile(db, jobId, { status: 'error', error: message });
        return fail(`Compilation failed (${response.status}):\n${message}`);
      }

      const pdf = await response.arrayBuffer();
      const pageCount = Number(response.headers.get('x-page-count') ?? '') || null;
      const compileMs = Number(response.headers.get('x-compile-ms') ?? '') || null;
      const objectPath = `${userId}/${project.id}/_builds/${jobId}.pdf`;
      const { error: uploadError } = await db.storage
        .from('project-assets')
        .upload(objectPath, pdf, { upsert: true, contentType: 'application/pdf' });
      if (uploadError) {
        await finishCompile(db, jobId, { status: 'error', error: uploadError.message.slice(0, 4000) });
        return fail(`Compiled, but storing the PDF failed: ${uploadError.message}`);
      }

      await finishCompile(db, jobId, {
        status: 'ok',
        pdf_path: objectPath,
        page_count: pageCount,
        compile_ms: compileMs,
        log: 'Compiled remotely with Tectonic.',
        error: null,
      });

      const { data: signed, error: signError } = await db.storage
        .from('project-assets')
        .createSignedUrl(objectPath, 3600);
      if (signError) return fail(`Compiled, but creating the PDF link failed: ${signError.message}`);
      return json({
        job_id: jobId,
        project_id: project.id,
        main_path: main.path,
        pdf_url: signed?.signedUrl ?? null,
        page_count: pageCount,
        compile_ms: compileMs,
        expires_in: 3600,
      });
    },
  );

  server.registerTool(
    'dexter_get_compile_status',
    {
      title: 'Check a cloud compile',
      description: 'Return the status, diagnostics, and signed PDF link (when ready) for a compile job created by dexter_compile_document.',
      inputSchema: z.object({
        job_id: z.string().uuid(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_id }) => {
      if (!(await recordToolCall(admin, userId))) return fail('Daily tool call limit reached (100). Try again tomorrow.');
      const { data, error } = await db
        .from('compile_jobs')
        .select('id,project_id,status,main_path,pdf_path,page_count,compile_ms,error,created_at,finished_at')
        .eq('id', job_id)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail('Compile job not found.');
      const job = data as {
        pdf_path: string | null;
        [key: string]: unknown;
      };
      let pdfUrl: string | null = null;
      if (job.pdf_path) {
        const { data: signed, error: signError } = await db.storage
          .from('project-assets')
          .createSignedUrl(job.pdf_path, 3600);
        if (signError) return fail(`Could not create the PDF link: ${signError.message}`);
        pdfUrl = signed?.signedUrl ?? null;
      }
      return json({ ...job, pdf_url: pdfUrl, expires_in: 3600 });
    },
  );

  return server;
}

const supabaseConfig = {
  auth: 'user' as const,
  env: {
    url: SUPABASE_URL,
    publishableKeys: { default: PUBLISHABLE_KEY },
    secretKeys: { default: SECRET_KEY },
  },
};

Deno.serve(
  withOAuthProtectedResource(
    withSupabase(supabaseConfig, async (req, { supabase, supabaseAdmin, userClaims }) => {
      if (!userClaims) {
        return Response.json({ error: 'Authentication required.' }, { status: 401 });
      }

      const { data: allowed, error: allowError } = await supabase.rpc('is_allowed_user');
      if (allowError) {
        return Response.json({ error: allowError.message }, { status: 500 });
      }
      if (allowed !== true) {
        return Response.json({ error: 'This GitHub account is not on the Dexter Write allowlist.' }, { status: 403 });
      }

      try {
        const handler = createMcpHandler(() => buildServer(supabase as Db, supabaseAdmin as Db, userClaims.id));
        return await handler.fetch(req);
      } catch (error) {
        return Response.json({ error: errorText(error) }, { status: 500 });
      }
    }),
  ),
);
