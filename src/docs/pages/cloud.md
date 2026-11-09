Cloud sync stores a copy of a project in your own Supabase project. It enables remote MCP, cross-device access, and a shared cloud history. It is optional; local writing works without it.

## Why use cloud sync

- An authorized agent can read the project while the tab is closed. File edits require a separate opt-in.
- A project can be loaded on another device.
- Applied MCP edits have a server-side revision trail.
- Cloud assets and compile output can live beside the project files.

Dexter Write is still local-first. The browser project remains the working copy unless you load a cloud project over it.

## Setup

1. Create a Supabase project.
2. Apply the migrations in `supabase/migrations`, including `0003_connector_grants.sql`.
3. Enable GitHub authentication.
4. Add your GitHub username to `allowed_users`.
5. Configure the OAuth consent route.
6. Build the frontend with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
7. Deploy the `mcp` Edge Function if you need remote agents.

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy mcp
```

## Sign in and allowlist

Open **Settings → Cloud sync** and sign in with GitHub. The panel shows whether your username is allowed.

The allowlist is deliberate: the free tier should not be burned by strangers. It is checked during sign-in and again by the backend on every protected request.

If you are not allowed, add your login in the Supabase SQL editor:

```sql
insert into public.allowed_users (github_username, note)
values ('your-github-login', 'owner')
on conflict (github_username) do nothing;
```

Sign out and back in after changing the allowlist.

## Import, push, load, and delete

| Action | What it does |
|---|---|
| **Import current project** | Creates a new cloud project from the open local files and images |
| **Push** | Replaces the cloud file tree with the current local tree |
| **Load** | Replaces the local project with the cloud copy |
| **Delete** | Removes the cloud project; the local copy stays |

Import and push are not the same. Import creates a new project. Push overwrites the selected cloud project's tree, including removing cloud-only files.

Load replaces local documents and assets. Download a backup ZIP first if the local copy matters.

## Linked projects and auto-pull

After an import, push, or load, the project is linked to the cloud project. The link is stored locally.

While the tab is open, Dexter Write polls file metadata in the background:

- If a cloud file changed and the local copy is clean, the local file updates.
- If the local copy has unsaved changes relative to the last sync, the app keeps the local version and reports a conflict.
- New cloud files are added locally.
- The baseline is stored in browser storage so a reload does not re-apply old versions.

This is how a remote MCP edit reaches the open editor without a manual refresh.

## MCP edits and undo

The **MCP edits and undo** section lists recent AI revisions with the following details.

- File path
- Project
- Version before the edit, or "created"
- Time
- Edit summary

Each row has **Undo**. Undo restores the previous content through `restore_cloud_revision`, which creates another revision before writing. The revision trail is append-only.

If a cloud edit was made while the tab was open, the background pull applies it and the notice points you to this list. If the file was dirty locally, the conflict is reported instead.

## What is stored

- Project metadata
- File paths and content
- Image metadata and storage objects
- AI and human revisions
- Compile jobs and optional PDF output

The database uses row-level security. The browser uses the public anon key; row policies and the allowlist enforce access.

## Free-tier behavior

Supabase free projects can pause after a period of inactivity. A paused project makes remote MCP and cloud sync unavailable until it is restored. The repository includes a health endpoint and guidance for a keep-alive ping.

Remote MCP also has a daily tool-call limit in the function configuration. Check the Edge Function logs when a call is rejected.

## Signing out

Signing out removes the cloud session and hides cloud projects. It does not delete local documents or the local project link automatically. Use **Delete** to remove a cloud copy, and clear the link by importing a different project if you want to stop syncing.
