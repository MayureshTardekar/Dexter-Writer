The local MCP bridge lets an external agent work on the project that is currently open in Dexter Write. The agent runs in Claude Desktop, Cursor, ChatGPT through a tunnel, Antigravity, or any other MCP-capable client. Dexter Write stays the editor and the source of truth.

The bridge is a local stdio MCP server plus a localhost connection to the open browser tab. It does not expose the project to the public internet.

## What the agent can do

| Tool | Purpose |
|---|---|
| `dexter_read_active_document` | Read the active document, mode, and content |
| `dexter_read_project_file` | Read any project file by path |
| `dexter_list_project_files` | List files, modes, line counts, and the active file |
| `dexter_get_outline` | Read headings and section structure |
| `dexter_stage_edit` | Replace the whole file or one exact passage; applies immediately |
| `dexter_insert_content` | Insert content before or after a specific line; applies immediately |
| `dexter_compile_document` | Compile LaTeX or Typst and return diagnostics |
| `dexter_get_diagnostics` | Read the latest compile diagnostics |

The server also exposes resources and prompts for reviewing the project, tightening a section, and fixing a failed build.

## Setup

### 1. Start Dexter Write

```bash
npm run dev
```

Open the app and load the project the agent should work on. The bridge only sees the open tab.

### 2. Open MCP → Connect an AI writer

Open **Settings → Connections → Local bridge**. The Connect wizard detects the project folder,
starts the shared local bridge, and prepares a config for Antigravity, Claude Desktop, Cursor, or another
MCP client.

In local development you can click **Start local bridge**. From a terminal, the same thing is:

```bash
npm run mcp:daemon
```

You no longer need a separate server per client.

### Using the hosted Vercel app

A hosted page cannot launch a process on your computer. If you want the AI to edit the tab at
`https://dexter-writer.vercel.app`, start the bridge once locally, then keep that tab open.

On Windows, double-click **Start Dexter Bridge.cmd** in the Dexter Write folder. It opens the hosted app
and starts the shared bridge in a minimized window. Double-click **Stop Dexter Bridge.cmd** when finished.

Or run:

```bash
npm run mcp:daemon
```

The daemon re-pairs automatically with the next browser tab when no tab is currently connected. If a tab is
connected, run `npm run mcp:stop` before switching between localhost and Vercel.

### 3. Copy the client config

Choose the client in the wizard and click **Copy config**. The block looks like this:

```json
{
  "mcpServers": {
    "dexter-write": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\Projects\\Dexter write\\bin\\dexter-mcp.mjs"],
      "cwd": "C:\\Users\\YOU\\Projects\\Dexter write"
    }
  }
}
```

Paste it into the client configuration. Client-specific paths are in
[MCP client setup](/docs#mcp-clients). Restart the client or reconnect its MCP server.

### 4. Keep the browser bridge enabled

The shared daemon owns `127.0.0.1:3088`; the browser tab connects to it through the local bridge.
Keep one Dexter tab open with the browser bridge enabled while an agent is writing.

### 5. Ask for a real change

```text
Read the project, then tighten the introduction and add one sentence about the
warm-cache result. Keep every citation. Compile afterwards and report diagnostics.
```

The agent reads first, applies the edit, and then verifies with the compile tools.

## Multiple AI clients

The shared daemon is designed for more than one client:

- Antigravity, Claude Desktop, and Cursor can stay connected at the same time.
- Closing one client does not stop the bridge.
- Each stdio client is a thin proxy to the same daemon.
- Only the active Dexter tab is edited. Use one project tab while agents are writing.
- Concurrent edits to the same file still need ordering; the daemon serializes requests, but agents
  should read before writing.

## Daemon controls

```bash
npm run mcp:daemon   # start the shared bridge
npm run mcp:status   # show health, connected tabs, and pairing state
npm run mcp:stop     # stop the shared bridge
npm run mcp:setup    # print detected paths and client configs
```

The daemon keeps running after an AI client closes. Stop it when you are finished, or leave it running
for the next session.

## How editing works

The tool names still say "stage" for compatibility, but local edits apply immediately.

1. The agent reads the current file and receives its content.
2. The edit call includes the exact target text or the replacement content.
3. Dexter Write checks the target against the current project state.
4. The change applies in the open tab, and Dexter Write switches to the edited file so the change is visible immediately.
5. The previous content is saved as a snapshot.
6. An applied notice appears with **Undo**.

If the target file changed between the read and the write, the apply fails with a conflict message instead of overwriting newer work.

## Sequential edits

The bridge updates its project snapshot after every applied change. An agent can make several edits in one turn. Keep the instructions explicit about ordering when a later edit depends on an earlier one.

## Security boundaries

- The bridge listens on `127.0.0.1` by default and accepts the local Dexter Write origin.
- The browser tab must be open and the bridge must be enabled.
- First use can require a pairing token stored under `~/.dexter-write/mcp-token`.
- The agent cannot edit another project just because the server is running.
- No project content is proxied through a Dexter Write server.

## Troubleshooting

**The client says the server is disconnected.** Open the Connect wizard, click **Test connection**, and confirm the Node path is absolute. Restart the MCP client after editing its config.

**The bridge is running but the client cannot reach the tab.** Open Dexter Write, enable the browser bridge, and keep the tab visible. The daemon relays to the browser session.

**Port 3088 is already in use.** The newest build reuses one shared daemon and should not hit this. If it does, run `npm run mcp:status`. An older or unrelated process may own the port; run `npm run mcp:stop`, or set a different `DEXTER_MCP_PORT` for advanced setups.

**A client still starts its own server.** Update its config to the Connect wizard block. The client should spawn `bin/dexter-mcp.mjs` as a stdio proxy; the shared daemon is started automatically when needed.

**Undo is blocked.** The file changed after the agent edit. Review the current content first; the newer edit is intentionally protected.

**The agent claims success without evidence.** The server instructions tell it not to. Ask it to call `dexter_compile_document` and report the actual result.
