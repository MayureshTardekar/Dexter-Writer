Remote MCP lets Claude, ChatGPT, or another MCP client work on a **cloud project** even when the Dexter Write tab is closed. The MCP server is a Supabase Edge Function; the project lives in Postgres and Storage.

This is optional. The local bridge is simpler and needs no account.

## What you need

- A Supabase project on the free tier.
- The repository migrations applied, including `0001_init.sql` and `0002_direct_ai_edits.sql`.
- The `mcp` Edge Function deployed.
- GitHub OAuth configured in Supabase Auth.
- The frontend built with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Your GitHub username in the `allowed_users` table.

## Deploy the backend

```bash
supabase link --project-ref <your-project-ref>
supabase db push
supabase functions deploy mcp
```

Set the function secrets required by your deployment. The exact values depend on the compile path and GitHub setup you use.

The direct-edit migration adds:

- `revisions.summary`
- `apply_ai_edit(...)` for version-checked writes and revision snapshots
- `restore_cloud_revision(...)` for Undo

Without `0002_direct_ai_edits.sql`, the remote edit tools cannot apply changes.

## Configure the frontend

Add the Supabase values to `.env` and rebuild:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
npm run build
```

The anon key is public by design. Row-level security and the allowlist protect every row and storage object.

## Connect the cloud project

1. Open **Cloud** in Dexter Write.
2. Sign in with GitHub.
3. Confirm your username appears as allowed.
4. Import the current project, or load an existing cloud project.
5. Copy the **Remote MCP endpoint** shown in the Cloud panel.

The endpoint has this shape:

```text
https://<project-ref>.supabase.co/functions/v1/mcp
```

Add it to your MCP client as a remote Streamable HTTP server. In Antigravity the field is `serverUrl`; in Claude and ChatGPT use the custom connector flow.

OAuth discovery and dynamic client registration are handled by Supabase. Your client may open a consent screen on first connection.

## What the remote agent can do

Remote tools include project listing, file reading, project search, apply edit, create file, recent edits, compile, and compile-status tools. Reads work against the cloud copy. Writes apply immediately after a version check.

The editor does not need to be open for an agent to work on the cloud project.

## Auto-pull into the open tab

When a cloud project is linked, the browser tab polls file metadata while it is open.

- A clean local file is updated when the cloud version changes.
- A file with local edits is preserved and reported as a conflict.
- A new cloud file is added to the local project.
- The last synchronized version is stored as a baseline in browser storage.

If you see a conflict, either load the cloud project again or push the local version. The app does not silently choose one side.

## Recent MCP edits and Undo

Every applied remote edit creates an AI revision with the previous content. Open **Cloud → Recent MCP edits** to see the path, project, version, time, and summary.

Select **Undo** to restore that revision. The restore itself creates a new revision, so the history remains append-only. A created file can be undone as well; the creation is removed.

Undo does not run through the AI. It is a human action in the browser.

## Version conflicts

Remote edits send a base version. If another writer or agent changed the file first, the server rejects the write and asks the client to read again. This prevents the last writer from silently winning.

## Limits and operational notes

- Supabase free projects pause after inactivity. Keep the `/health` function warm if remote agents must work every day.
- The MCP function has a daily call limit in the deployment configuration.
- Edge runtime limits apply to long compiles; heavier compiles use the configured cloud compiler.
- Cloud storage and database quotas apply to your Supabase project.

## Security model

- Authentication is OAuth through Supabase.
- The allowlist is checked again on every request.
- Row-level security scopes projects, files, revisions, and assets.
- Remote edits are version-checked.
- Revision restore is available only to an authenticated project owner on the allowlist.

See [Security and privacy](/docs#security) for the full model.
