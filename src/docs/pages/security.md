Dexter Write is designed around local control. This page explains what leaves the browser, what stays local, and what each integration trusts.

## Default data flow

| Data | Default handling |
|---|---|
| Documents | Browser storage; local autosave |
| Images | Browser storage |
| AI keys | Encrypted browser vault |
| AI prompts and content | Sent directly to the selected provider |
| Local MCP | Localhost bridge to the open tab |
| Live collaboration | Peer-to-peer WebRTC |
| Cloud copy | Your Supabase project, only after import |

No cloud account is required for writing, local compile, local AI providers, or the local MCP bridge.

## BYOK vault

Provider keys are encrypted with AES-256-GCM in browser storage. The device key is also stored in the browser profile.

This protects against casual inspection of storage. It does **not** protect against someone who already controls your browser session, a malicious browser extension, or a compromised device. Use a dedicated profile or clear the vault on shared machines.

AI requests go to the provider endpoint you configure. Dexter Write does not proxy model calls through its own server.

## Local MCP bridge

- Binds to `127.0.0.1` by default.
- Accepts the local Dexter Write origin.
- Requires the app tab to be open and the bridge enabled.
- Can require a first-use pairing token stored under `~/.dexter-write/mcp-token`.
- Relays tool calls to the open project.
- Does not expose the project to the public internet.

The local MCP server is a separate process launched by your MCP client. Treat the client's configuration and the local machine account as part of your trust boundary.

## Remote MCP and cloud

Remote MCP uses Supabase Auth, OAuth discovery, and dynamic client registration. Identity scopes describe account information. Dexter Write separately enforces the approved project and edit permissions in the database.

Cloud data is stored in your Supabase project:

- Projects
- Files and paths
- Images and storage objects
- Revisions and compile jobs

The browser uses the public anon key. Access control lives in row-level security and the allowlist, not in the anon key.

Remote edits are version-checked. Undo creates a new revision and never rewrites history.

## Live collaboration

Live sessions use Yjs and WebRTC. Text flows between peers. A signaling service helps peers connect. The room link and optional password are the access material.

Images are not part of the live document. Use a project ZIP when collaborators need them.

Do not use a live room for confidential material unless you trust every peer and the network path between them.

## AI review model

The in-app AI Playground can use diff review before applying changes. External MCP agents apply edits immediately, but every applied change has an undo path:

- Local MCP: inline notice and AI undo action
- Remote MCP: revision list with Undo

Undo is blocked when the target changed after the AI action, so a newer manual edit is protected.

## Operational hygiene

- Revoke unused provider and GitHub tokens.
- Keep dependencies updated.
- Use a dedicated Supabase project for a deployment.
- Keep the allowlist small.
- Review the migration before applying it to a production database.
- Download project ZIP backups for important work.
- Clear browser storage when retiring a device.

## What this is not

Dexter Write is not an end-to-end encrypted cloud editor. Live collaboration is peer-to-peer but not a full anonymity system. The local vault protects keys at rest, not a compromised browser session. The docs are explicit about these boundaries so you can choose the right mode for the material.
