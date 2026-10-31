# Dexter Write — MCP Product Plan

**Status:** implemented locally and in the cloud workflow; remote OAuth still needs Supabase dashboard setup
**Constraint:** $0 bill, 1–10 users, open source, not a SaaS
**Goal:** A user can paste one URL into Claude.ai or ChatGPT, say "add a diagram to Section 3 and compile," and Dexter Write performs the work on their cloud project. No API keys, no per-token billing, no local daemon required.

---

## 1. Non-goals

- No scalability work, no queues beyond one compile job table, no Kubernetes.
- No organizations, teams, roles, invites, billing, or tenant model.
- No real-time multi-user co-editing in v1.
- No mobile app, no desktop app, no browser extension.
- No guarantee of 24/7 uptime. Free-tier pause is acceptable.

---

## 2. Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Data location | Supabase Postgres + Storage | Free tier, Auth/RLS/Realtime included |
| MCP host | Supabase Edge Function at `/functions/v1/mcp` | Free 500K invocations/mo, OAuth helper exists |
| Auth | Supabase Auth (GitHub OAuth) + Supabase OAuth 2.1 server with DCR | Claude and ChatGPT both support OAuth 2.1 + DCR |
| Access control | 10-username allowlist + RLS | Keeps free tier from being burned by strangers |
| Compile (app open) | Browser WASM (`busytex` + `pdfjs-dist`) | $0, already in the repo |
| Compile (app closed) | Existing AWS Lambda (Tectonic, `lambda/`) | Already deployed and warm in ~1–2s; free tier covers 10 users |
| Diagrams (app open) | Browser Mermaid / Typst / LaTeX | $0, best fidelity |
| Diagrams (app closed) | Edge Function with Graphviz WASM and/or Typst WASM | No headless Chrome, fits 2s CPU for small diagrams |
| Literature search | OpenAlex + Crossref + arXiv public APIs | No keys, no cost |
| Hosting (frontend) | Cloudflare Pages or Vercel Hobby | Free static hosting |
| Keep-alive | Supabase `pg_cron` (or cron-job.org) hitting `/health` | Prevents Supabase 7-day pause without CI |
| Realtime | Supabase Realtime for compile job pickup only | 2M messages/mo free is plenty |

**Explicitly rejected**

- `bin/dexter-mcp.mjs` + local daemon relay: requires the app open and a Node process. Good for desktop MCP, not for "any user anywhere."
- Cloudflare Worker relay: extra moving part, same local-daemon dependency.
- GitHub Actions as the compiler: 45–90s queue, extra secrets, and a second CI contract. The existing Lambda compiles in ~1–2s.
- Vercel Functions for compile: no TeX Live, small bundle limit, short duration. Static frontend only.
- AWS Lambda as a *hard dependency*: it requires a card and can bill overage. Use it only as the app-closed fallback, capped by reserved concurrency and an AWS budget alert. `COMPILE_CLOUD=off` disables it entirely for a literal no-card guarantee.
- Supabase Edge Function for full LaTeX compile: 2s CPU and 256MB RAM are not enough for real TeX. Edge is for MCP + light WASM only.

---

## 3. Why "app closed" matters

With data in Supabase, **reads, direct edits, revision undo, citations, and project browsing work when the Dexter tab is closed**. Claude talks to the Edge Function, the Edge Function talks to Postgres. No browser involved. When the tab reopens, linked projects pull applied cloud edits automatically.

Only **compilation** needs compute. That is the single reason the browser matters:

| Situation | Compile path | Latency |
|---|---|---|
| Dexter tab open | Browser claims job via Realtime, compiles with `busytex` | 1–10s |
| Dexter tab closed | Edge Function calls the existing Tectonic Lambda | 1–5s |
| Lambda unavailable | Job `error`, or queued until the next tab open | — |

The Lambda already exists at `lambda/handler.mjs` and is deployed behind a Function URL. It is an optional accelerator, not a new service. If you want a literal no-card guarantee, set `COMPILE_CLOUD=off`; compile then requires Dexter to be open, and the rest of the product is unchanged.

---

## 4. Architecture

```
Claude.ai / ChatGPT / Cursor / any MCP client
        │  HTTPS + OAuth 2.1 (DCR)
        ▼
Supabase Edge Function  /functions/v1/mcp
        │  RLS-scoped Supabase client
        ├──────────────► Postgres (projects, files, jobs, revisions)
        ├──────────────► Storage  (assets, PDFs, snapshots)
        ├──────────────► Realtime (browser picks up compile jobs)
        └──────────────► Tectonic Lambda (compile when browser is closed)
                                │
                                ▼
                        PDF → Storage → compile_jobs row

Cloudflare Pages
        │  GitHub OAuth login
        ├──────────────► Supabase Auth (session + consent screen)
        └──────────────► Supabase JS (Realtime, Storage, DB)

Dexter tab (Monaco + WASM engines)
        ├── reads/writes files via Supabase
        ├── claims queued compile jobs
        └── renders Mermaid / TikZ / Typst previews
```

---

## 5. Free-tier budget

| Resource | Free limit | Expected at 10 users | Guardrail |
|---|---|---|---|
| Supabase DB | 500 MB | < 20 MB text | 2 MB per text file |
| Supabase Storage | 1 GB | < 500 MB | 50 MB assets/user |
| Supabase egress | 5 GB/mo | < 1 GB | PDFs compressed, SVG not PNG |
| Supabase Edge invocations | 500K/mo | ~30K/mo | 100 tool calls/user/day |
| Supabase Realtime | 2M msgs/mo, 200 connections | trivial | 10 concurrent users |
| Supabase MAU | 50K | 10 | allowlist |
| AWS Lambda | 1M requests + 400K GB-s/mo (permanent free tier) | ~3K compiles/mo | reserved concurrency 1; 10 compiles/user/day |
| Frontend hosting | Free tier | static | none |
| Claude / ChatGPT | User's own plan | — | not our bill |

Supabase free projects **pause after 7 days of inactivity**. A daily ping to a tiny `/health` Edge Function keeps it awake. If the project is paused anyway, the MCP tool returns a clear "project waking, retry in a minute" error.

Lambda free tier is permanent but requires a card on file. The code enforces `reserved concurrency = 1` and a 4MB payload cap; add an AWS Budget alert at $0.01. For a strict zero-card setup, set `COMPILE_CLOUD=off` and use the browser compiler only.

---

## 6. Data model

```sql
-- identity
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_username text unique not null,
  created_at timestamptz default now()
);

create table allowed_users (
  github_username text primary key,
  note text,
  created_at timestamptz default now()
);

-- content
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  mode text not null check (mode in ('markdown','latex','typst','bib','text')),
  content text not null default '',
  version integer not null default 1,
  updated_at timestamptz default now(),
  unique (project_id, path)
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  storage_path text not null,
  mime text not null,
  bytes bigint not null,
  created_at timestamptz default now(),
  unique (project_id, path)
);

create table revisions (
  id bigserial primary key,
  file_id uuid not null references files(id) on delete cascade,
  version integer not null,
  content text not null,
  author uuid,
  created_at timestamptz default now()
);

-- applied edits are recorded here and can be restored from the UI
alter table revisions add column summary text not null default '';

create index revisions_ai_created_idx
  on revisions (project_id, actor, created_at desc);

-- apply_ai_edit() checks base_version, snapshots the previous content as an
-- actor='ai' revision, then updates the file in one transaction.
-- restore_cloud_revision() snapshots current content and restores a revision.
-- The old staged_edits table may remain for older rows but is no longer used.

-- compile
create table compile_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_path text not null,
  status text not null default 'queued'
    check (status in ('queued','running','ok','error','cancelled')),
  engine text not null check (engine in ('browser','github','lambda')),
  requested_by uuid,
  snapshot_path text,
  pdf_path text,
  log text,
  diagnostics jsonb default '[]'::jsonb,
  github_run_url text,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- quotas
create table usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  tool_calls integer not null default 0,
  compiles integer not null default 0,
  bytes_written bigint not null default 0,
  primary key (user_id, day)
);

-- browser presence for compile routing
create table presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now()
);
```

RLS: every table keyed by `project_id` checks `exists (select 1 from projects p where p.id = project_id and p.owner = auth.uid())`. `profiles` and `usage_daily` check `user_id = auth.uid()`. `allowed_users` is service-role only.

**Edits apply directly.** The AI cannot bypass the `base_version` check, but it does not need a human confirmation step. Every applied edit writes a revision snapshot first; the human can Undo from the applied notice, the cloud revision list, or document history. The AI has no restore/undo tool, so undo stays a human action.

---

## 7. Auth and security

1. User signs in to Dexter with **GitHub OAuth via Supabase Auth** (avoids email rate limits).
2. After login, the app checks `allowed_users` for the GitHub username. Not listed → sign out with "private demo."
3. Claude/ChatGPT connect to the MCP URL with **OAuth 2.1**. Supabase Auth acts as the authorization server:
   - asymmetric JWT signing key (ES256 or RS256), not legacy HS256
   - OAuth server enabled
   - dynamic client registration enabled
   - consent screen hosted at `/oauth/consent` on the frontend
   - Claude redirect URI: `https://claude.ai/api/mcp/auth_callback`
   - ChatGPT registers itself via DCR
4. Edge Function uses `@supabase/server`:
   - `withOAuthProtectedResource()` for RFC 9728 discovery and the `401` challenge
   - `withSupabase({ auth: 'user' })` for a user-scoped client
   - `verify_jwt = false` in `supabase/config.toml`; the middleware verifies
5. Every tool call re-checks the allowlist and runs under RLS.
6. Edit calls carry `base_version`. A stale edit is rejected before any write; the client must read the file again. Applied edits snapshot the previous content in `revisions`.
7. Secrets: GitHub PAT or GitHub App token in Supabase secrets only. No service-role key in the frontend. GitHub workflow uploads via short-lived signed upload URLs and calls back with HMAC, not a long-lived service key.
8. MCP server `instructions` explicitly say: read first, apply with `base_version`, report only what the tool result confirms, and never claim a compile passed without a job result.

---

## 8. MCP surface

### Read tools

| Tool | Purpose |
|---|---|
| `dexter_list_project_files` | paths, modes, line counts, active file |
| `dexter_read_project_file` | read by path with line range |
| `dexter_get_outline` | headings/sections with line numbers |
| `dexter_search_project` | text/regex search across files |
| `dexter_get_diagnostics` | last compile diagnostics |
| `dexter_get_compile_status` | poll a job |

### Write tools (applied immediately, undoable)

| Tool | Purpose |
|---|---|
| `dexter_stage_edit` | replace whole content or one exact passage; checks `base_version` and applies |
| `dexter_insert_content` | insert before/after a line; checks `base_version` and applies |
| `dexter_create_file` | create a new file immediately; the creation is undoable |
| `dexter_add_bibtex` | append deduped BibTeX entry |
| `dexter_add_citation` | insert `\cite{key}` or `[@key]` and add BibTeX |

### Diagram tools

| Tool | Purpose |
|---|---|
| `dexter_create_diagram` | accepts `mermaid`, `tikz`, `typst`, or `dot` source; renders preview; applies the figure block + source |
| `dexter_render_preview` | render a page/file to SVG/PNG |
| `dexter_get_figure` | return the latest rendered diagram |

`dexter_create_diagram` input sketch:

```json
{
  "format": "mermaid | tikz | typst | dot",
  "source": "diagram source",
  "caption": "Figure 1: ...",
  "label": "fig:architecture",
  "target_file": "main.tex",
  "placement": "after_section | end | line",
  "target_line": 42,
  "base_version": 7
}
```

Behavior:

- Markdown target → insert a fenced `mermaid` block.
- LaTeX target → insert a `figure` environment with either inline `tikzpicture` or `\includegraphics` pointing at a generated asset.
- Typst target → insert `#figure(...)` with the rendered asset or inline `cetz`.
- Return `structuredContent` with the SVG plus a text fallback.
- If the diagram is invalid, return the parser error; never apply broken source.

### Research tools

| Tool | Purpose |
|---|---|
| `dexter_search_papers` | OpenAlex/Crossref/arXiv query; returns title, authors, year, DOI, BibTeX |
| `dexter_fetch_paper` | metadata by DOI/arXiv ID |
| `dexter_search_project` (alias `search`) | lets ChatGPT Deep Research search the project |
| `dexter_read_project_file` (alias `fetch`) | lets Deep Research fetch a specific file |

### Resources

```
dexter://project/files
dexter://project/outline
dexter://file/{path}
dexter://compile/latest
dexter://figure/latest
```

### Prompts

```
write-section        draft a section from evidence in the project
make-figure          design + insert a diagram
audit-paper          structural, citation, and build review
add-citation         find and insert a citation
fix-build            diagnose and patch a failing compile
```

---

## 9. Compile pipeline

### 9.1 Job lifecycle

```
queued → running → ok | error
```

`dexter_compile_document` never blocks. It creates a job and returns:

```json
{ "job_id": "...", "status": "queued", "engine": "browser" }
```

The model then calls `dexter_get_compile_status` or the MCP App widget polls.

### 9.2 Browser path (preferred)

1. Edge Function reads `presence.last_seen`. Fresh (< 30s) → `engine = browser`.
2. Insert `compile_jobs` row.
3. Dexter tab is subscribed to its own jobs via Supabase Realtime.
4. Tab claims the job with an atomic update (`where status = 'queued'`), sets `running`.
5. Compiles with the existing WASM engine, rasterizes with `pdfjs-dist`.
6. Uploads PDF to Storage, updates `compile_jobs` with `ok` + diagnostics.
7. Tool polls and returns the result.

### 9.3 Lambda path (app closed)

1. Edge Function sets `engine = lambda`, reads the active file, and packs referenced project files as base64 (the same payload shape the browser already sends to the Lambda).
2. POSTs `{ tex, files }` to `LATEX_LAMBDA_URL`. The existing `lambda/handler.mjs` compiles with Tectonic (`--untrusted`, 25s timeout, 4MB project cap).
3. On success, upload the returned PDF to Storage, write `compile_jobs` (`ok`, page count, compile ms), and return a signed URL plus diagnostics to the model.
4. On failure, store the Lambda error text in `log`, mark the job `error`, and return the tail.
5. If the Lambda is cold or unreachable, either retry once or leave the job `queued`; the next Dexter tab open claims it and compiles locally.

Security:

- `LATEX_LAMBDA_URL` lives in Supabase Edge Function secrets, never in the browser bundle.
- Enforce the 4MB payload cap before calling Lambda.
- Keep `reserved concurrency = 1` and an AWS Budget alert at $0.01.
- The Lambda already uses `--untrusted`, so `\write18` and shell escape are blocked.
- Source is written to a temp file; no user input is interpolated into a command line.

#### 9.3.1 Lambda diagnostics (small change)

Add `Accept: application/json` (or `?format=json`) to the handler:

- success: `{ pdfBase64, pageCount, compileMs, log }`
- failure: `{ error, log, pageCount: 0 }`

Keep the current `application/pdf` response as the default so the browser path does not change.

### 9.4 Timeouts

| Path | Timeout | On timeout |
|---|---|---|
| Browser | 90s | job `error`, ask user to retry |
| GitHub | 5 min | job `error`, return log tail |
| MCP client | 60s per call | model polls with status tool |

---

## 10. Diagram pipeline

| Format | App open | App closed |
|---|---|---|
| Mermaid (Markdown) | browser `mermaid.render` → SVG | source applied; preview renders next open |
| TikZ (LaTeX) | compile page → PNG via `pdfjs` | compile via Tectonic Lambda |
| Typst | `typst-ts-renderer` → SVG | Typst WASM in Edge Function for small diagrams |
| Graphviz DOT | browser or Edge | `@viz-js/viz` WASM in Edge Function |

Do not attempt Mermaid server-side: it needs a DOM. Store the source and let the host model describe the diagram; the widget shows the last render.

### MCP App widget

- Resource: `ui://dexter/figure.html`
- MIME: `text/html;profile=mcp-app`
- Displays the SVG, caption, and a "Open in Dexter" button.
- No external scripts, no external images; inline SVG only.
- Fallback for hosts that do not render apps: base64 PNG plus a text URL.
- Note: image rendering in Claude/ChatGPT chat can be collapsed or dropped; the widget is the reliable path, images are secondary.

---

## 11. Migration from IndexedDB

1. Add an "Import to cloud" screen after login.
2. Read existing projects from IndexedDB (`projectFiles` / `vault` / `importProject` helpers).
3. Upload text files to `files`, binaries to Storage, create `projects` rows.
4. Keep local data untouched as a backup until the user confirms.
5. After import, cloud is the source of truth. Local autosave remains an optional cache.
6. Provide export (zip) so users are never locked in.

No dual-write in v1. One-way import, then cloud-only. This avoids sync conflicts.

---

## 12. Keep-alive

Supabase pauses a free project after 7 days without activity.

- Preferred: enable `pg_cron` in the Supabase dashboard and schedule a daily `select 1`.
- Alternative: a free external cron (cron-job.org) calls `GET /functions/v1/health` once a day.
- `/health` returns `{ ok: true, ts }`; it also proves Edge Functions are awake.
- If paused anyway: MCP tool returns `"Dexter is waking up. Restore the Supabase project, then retry."`

---

## 13. Quotas (fail-closed)

These are guardrails, not monetization. They exist so 10 users never trip a free-tier cap.

| Quota | Limit | On exceed |
|---|---|---|
| Allowed users | 10 GitHub usernames | login denied |
| Tool calls | 100/user/day | tool returns `quota_exceeded` |
| Compiles | 10/user/day | `queued` rejected |
| Assets | 50 MB/user | upload rejected |
| Text file | 2 MB | write rejected |
| Project files | 200 | create rejected |
| Concurrent compiles | 1/user | queued behind |
| Global storage | 900 MB | hard stop |

No external service is called after a quota failure. Supabase free tier itself fails closed on overage; this is a second layer.

---

## 14. Milestones

### M1 — Data layer (1–2 days)

- Create Supabase project; enable GitHub Auth, OAuth server, DCR, asymmetric JWT.
- Apply schema + RLS + allowlist.
- Add frontend Supabase client, login screen, consent route.
- Import from IndexedDB.
- `/health` function.

### M2 — MCP layer (2–3 days)

- Edge Function `/mcp` with `@supabase/server`.
- Read tools + direct write tools + resources + prompts.
- OAuth connect flow verified in Claude and ChatGPT.
- Applied-edit notice + revision undo in Dexter.
- Version checks before each write.

### M3 — Compute layer (2–3 days)

- `compile_jobs` + Realtime pickup in the browser.
- Lambda compile path (Edge Function → Tectonic Lambda → Storage).
- Optional JSON diagnostics mode in the Lambda.
- `dexter_compile_document` + `dexter_get_compile_status`.
- `dexter_create_diagram` for Mermaid/TikZ/Typst/DOT.
- Edge WASM diagram fallback.

### M4 — Polish (1–2 days)

- `dexter_search_papers`, `dexter_add_citation`, `dexter_add_bibtex`.
- MCP App widget.
- Quotas + usage counters.
- Keep-alive cron.
- README, self-host guide, screenshots.

### Implementation status (current working tree)

- M1 code complete: schema, RLS, allowlist, `/health`, browser Supabase client, GitHub sign-in, OAuth consent route, IndexedDB import.
- M2 code complete: `/mcp` Edge Function tools (projects, files, read, search, apply edit, create file, recent edits, compile, compile status), allowlist + 100 calls/day, direct edits with optimistic version checks and revision undo. The local bridge applies edits directly too. Resources/prompts and live Claude/ChatGPT OAuth validation are still pending.
- M3 partially complete: `dexter_compile_document` calls the Tectonic Lambda, stores the PDF in `project-assets/_builds`, and returns a signed URL. `dexter_get_compile_status` is implemented. Browser Realtime pickup, the optional Lambda JSON diagnostics mode, and diagram tools are not implemented.
- `supabase/functions/mcp/index.ts` type-checks with `deno check`. `npm run lint`, `npm test` (274 tests), and `npm run build` pass.

### First deploy checklist

1. Create a Supabase project, enable GitHub auth, asymmetric JWT signing, and the OAuth 2.1 server with `/oauth/consent` as the authorization path.
2. Run `supabase link --project-ref <ref>` then `supabase db push`. The migration now allows `application/pdf` in `project-assets`.
3. Seed the allowlist in the SQL editor: `insert into public.allowed_users (github_username) values ('your-github-login');`
4. Set the edge secrets: `supabase secrets set LATEX_LAMBDA_URL=https://<lambda-url>/`.
5. Deploy: `supabase functions deploy health --no-verify-jwt` and `supabase functions deploy mcp --no-verify-jwt`.
6. Add the production redirect URL (including `/**`) in Auth > URL Configuration.
7. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the frontend build, then connect `<project>.supabase.co/functions/v1/mcp` in Claude/ChatGPT.

---

## 15. Definition of done

- [ ] A new user signs in with GitHub, imports a project, and sees it in the cloud.
- [ ] They add the MCP URL in Claude and in ChatGPT via OAuth.
- [ ] "List my files and read Section 3" works.
- [ ] "Add a TikZ diagram after Section 3 and compile" applies the edit, renders a preview, compiles, and returns diagnostics.
- [ ] The edit bumps the version immediately and Undo restores the previous content from revision history.
- [ ] A stale edit is rejected, not applied.
- [ ] Compile works with the Dexter tab closed (Tectonic Lambda path).
- [ ] Another user cannot read the first user's project (RLS test).
- [ ] Non-allowlisted GitHub user cannot sign in.
- [ ] Quotas return clean errors, no external call.
- [ ] The Supabase project stays awake for 30 days via cron.
- [ ] Total monthly bill: $0.

---

## 16. Risks and tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| Supabase free pause | MCP fails until restored | daily cron + clear error |
| Edge 2s CPU / 256MB | heavy WASM render fails | small diagrams only; fall back to browser/Lambda |
| Lambda cold start or outage | 1–10s or failure | job status + retry; queue until tab opens |
| Lambda card on file | possible overage bill | reserved concurrency 1 + AWS Budget alert; `COMPILE_CLOUD=off` |
| Prompt injection in papers | malicious tool calls | allowlist + RLS + base_version checks + revision undo |
| Platform plan gating | some users cannot add connector | document Claude paid plan and ChatGPT workspace requirements |
| MCP Apps rendering bugs | widget not shown | text + SVG fallback |
| TeX package mismatch | local vs server output differs | pin the Tectonic bundle/cache in the Lambda image |
| Free-tier fair use | extreme usage throttled | quotas |

---

## 17. Open decisions

1. Keep the Lambda fallback, or require Dexter to be open for compile? (`COMPILE_CLOUD=off` gives a literal no-card guarantee.)
2. One project per user, or multiple projects? (Schema supports multiple; UI can start with one.)
3. Mermaid source for closed-app diagrams: apply without preview, or auto-convert simple flowcharts to DOT for an Edge-rendered preview?
4. Keep the existing `bin/dexter-mcp.mjs` stdio bridge for desktop users? (Yes, it costs nothing and serves Claude Desktop/Cursor.)
