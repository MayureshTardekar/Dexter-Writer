Start with the smallest check that isolates the layer: editor, provider, MCP bridge, cloud, or compiler. Most failures are configuration or a stale connection, not lost data.

## The editor will not load

- Run `npm run dev` from the repository root.
- Confirm the terminal shows the Vite URL and no port conflict.
- Hard-refresh the browser after a build change.
- Check that `index.html` and `src/main.tsx` are unchanged.

## My files disappeared

Documents are stored in browser storage for the current origin. A different port, hostname, or browser profile is a different storage area.

- Confirm the URL and port.
- Check the project file tree before assuming loss.
- Look in **History** and browser storage for the project.
- Restore from a project ZIP if you have one.

Use `npm run dev` consistently, or run the production build on a stable origin.

## AI requests fail

Check in this order:

1. Provider and model are selected.
2. The API key is present and not expired.
3. The account has quota for the model.
4. The base URL is correct for custom endpoints.
5. The browser can reach the provider (network panel, CORS).
6. Ollama is running and allows the app origin.

A 401 usually means a bad key. A 404 usually means a wrong model ID or base URL. A browser CORS error means the provider does not allow browser requests from this origin.

## The AI changed the wrong file

Use **Undo AI** immediately. Undo is blocked if the file changed after the AI action. For project-wide changes, review the diff before applying, or ask the AI to read the outline first.

## Local MCP will not connect

- Open **MCP → Connect an AI writer** and click **Test connection**.
- Is Dexter Write open with the browser bridge enabled?
- Does the client use the absolute path from the Connect wizard?
- Did you restart the MCP client after editing its config?
- Run `npm run mcp:status` and `npm run mcp:stop` if an older process owns port 3088.
- On the hosted Vercel app, double-click **Start Dexter Bridge.cmd** once; a hosted page cannot launch local processes.

The current build uses one shared daemon plus lightweight stdio proxies. Do not start a separate bridge for each client.

## The agent says it edited a file but nothing changed

Ask it to call `dexter_read_project_file` and show the current content. If the apply failed, the result should contain the conflict or error. If the agent only read the file, it did not apply anything.

## Remote MCP returns 401 or 403

- Sign in to the Cloud panel.
- Confirm your GitHub username is in `allowed_users`.
- Complete the OAuth consent flow in the client.
- Confirm the function is deployed and its environment is set.
- Check the Edge Function logs for the exact rejection.

A 401 is usually authentication. A 403 is usually authorization or the allowlist.

## Remote edits do not appear in the app

- Confirm the project is linked in the Cloud panel.
- Keep the tab open long enough for the poll interval.
- Check **Cloud → Recent MCP edits** for the revision.
- If the local file has changes, the app preserves it and reports a conflict.
- Use **Load** from the cloud project if you want the cloud copy to win.

## Undo is blocked

The target file changed after the AI or MCP action. The app refuses to overwrite newer work. Review the current file, then make the change manually or apply a new AI edit.

For cloud revisions, open the revision list and try Undo again after the local conflict is resolved.

## LaTeX compile fails or hangs

- Check the preview diagnostics.
- Confirm the root file has `\documentclass`.
- Wait for the first-use engine download to finish.
- Try the cloud compiler URL if the local engine is unavailable.
- Check referenced images and support files exist.
- Ask the AI to fix the exact diagnostic, then compile again.

## Typst compile fails

- Confirm the active file is the Typst root.
- Check the diagnostics for the failing package or path.
- Use the Typst source export to inspect the current file outside the app.

## Export is blank or incomplete

- Compile the preview first.
- Confirm the active document is in the matching mode.
- Use the project ZIP export for a complete backup.
- For PDF, check the print dialog and page range if the browser's print path is used.

## A live session will not connect

- Both peers need network access to the WebRTC signaling path.
- Corporate networks and restrictive firewalls can block peer connections.
- Re-copy the invite link, including the key if a password was set.
- Try a new room if the old room state is stale.
- Use cloud sync or a ZIP handoff when peer-to-peer is blocked.

## Still stuck?

Collect the exact error text, the browser network response, and the relevant tool result. Do not paste secrets, API keys, or private document content into a public issue. Reproduce with a minimal project when possible.
