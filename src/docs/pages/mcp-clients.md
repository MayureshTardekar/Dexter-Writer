Dexter Write exposes a standard MCP server, so any client that supports local stdio servers or remote Streamable HTTP servers can use it. The local bridge is the recommended starting point.

## Easiest path: in-app Connect wizard

Open **Settings → Connections → Local bridge**, click **Start local bridge**, choose your client, and copy the
generated config. The wizard detects the project folder and absolute script path for you.

The shared daemon is independent of any one client. Antigravity, Claude Desktop, and Cursor can connect
at the same time; closing one client does not break the others. You do not need to run a separate
`npm run mcp` for each client.

```bash
npm run mcp:status   # health and connected tabs
npm run mcp:stop     # stop the shared daemon
```

## Local stdio clients

To print the exact configuration manually:

```bash
npm run mcp:config
```

The output has this shape:

```json
{
  "mcpServers": {
    "dexter-write": {
      "command": "node",
      "args": ["/absolute/path/to/Dexter write/bin/dexter-mcp.mjs"],
      "cwd": "/absolute/path/to/Dexter write"
    }
  }
}
```

Keep Dexter Write open with the browser bridge enabled. The MCP client starts a stdio proxy; the shared
daemon is started automatically if it is not already running.

### Claude Desktop

1. Open **Settings → Developer → Edit Config**.
2. Add the printed server under `mcpServers`.
3. Save and restart Claude Desktop.
4. Ask Claude to list the Dexter Write tools, then try a read request.

### Cursor

1. Open **Settings → MCP**.
2. Add a new stdio server.
3. Use `node` as the command and the absolute path to `bin/dexter-mcp.mjs` as the argument.
4. Restart the MCP connection after saving.

### Antigravity

The Connect wizard can copy this exact block. Antigravity reads MCP configuration from the workspace
or global config:

- Workspace: `.agents/mcp_config.json`
- Global: `~/.gemini/config/mcp_config.json`

Local server entry:

```json
{
  "mcpServers": {
    "dexter-write": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\Projects\\Dexter write\\bin\\dexter-mcp.mjs"],
      "cwd": "C:\\Users\\YOU\\Projects\\Dexter write",
      "timeoutSeconds": 300
    }
  }
}
```

Remote entry, after the Supabase backend is deployed:

```json
{
  "mcpServers": {
    "dexter-write-cloud": {
      "serverUrl": "https://<project-ref>.supabase.co/functions/v1/mcp",
      "timeoutSeconds": 600
    }
  }
}
```

Antigravity uses `serverUrl`, not the legacy `url` or `httpUrl` fields. Use **MCP Servers → Manage MCP Servers → View raw config** to edit the file from the IDE.

### ChatGPT web

ChatGPT web reaches the local bridge through OpenAI's outbound-only tunnel. The bridge is not exposed on a public port.

1. Install the OpenAI `tunnel-client`.
2. Create a tunnel and runtime API key in the OpenAI platform tunnel settings.
3. Run `npm run mcp:tunnel` and follow the printed setup command.
4. Start the tunnel profile.
5. In ChatGPT, add a custom MCP server using the tunnel connection and no authentication.
6. Keep Dexter Write open with the bridge enabled.

Custom MCP server access depends on your ChatGPT plan, workspace, and permissions.

### Generic stdio client

Use the command and arguments from `npm run mcp:config`. The transport is stdio. The server relays to the open browser tab through `127.0.0.1:3088`.

## Remote clients

Use **Copy connector URL** in **Settings → Connections → Cloud project** after deploying Supabase and importing a project.

```text
https://<project-ref>.supabase.co/functions/v1/mcp
```

Remote clients use Streamable HTTP with OAuth. Supabase provides discovery and dynamic client registration. The first connection may open a consent screen. Your GitHub username must be on the allowlist.

## Which setup should I use?

| Situation | Use |
|---|---|
| Working in the app now | Local bridge |
| Antigravity, Cursor, or Claude Desktop | Local bridge |
| ChatGPT web | Local bridge through the OpenAI tunnel |
| Agent must work while the tab is closed | Remote MCP with a cloud project |
| Multiple devices or a shared cloud copy | Remote MCP |

## Validate the connection

Ask the client to do a read-only check first:

```text
Use dexter_list_project_files and tell me the active file. Do not edit anything yet.
```

Then try a small edit:

```text
Use dexter_read_project_file on the active file, then add one sentence to the
end of the introduction. Apply it and tell me what changed.
```

Finish with:

```text
Call dexter_compile_document and report the diagnostics.
```

## Common mistakes

**Using a relative path in the config.** MCP clients start from a different working directory. Always use an absolute path to `bin/dexter-mcp.mjs`.

**Forgetting the app tab.** The shared daemon relays to the open tab. Minimized is usually fine; closed is not.

**Editing config while the client is running.** Restart the client or reload its MCP connection.

**Using an old per-client server config.** The newest build uses one shared daemon and lightweight stdio proxies. Re-copy the config from the Connect wizard if a client still starts its own bridge on port 3088.

**Using remote mode without the new migration.** Apply `0002_direct_ai_edits.sql` before testing remote writes.

**Expecting the remote endpoint to work without OAuth.** The endpoint is protected; sign in through the client's OAuth flow.
