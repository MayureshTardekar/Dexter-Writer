Get a working Dexter Write workspace in about five minutes. You do not need an account, an API key, or a cloud project to start writing.

## Before you start

- **Node.js 20.19+** or **22.12+** and npm.
- A modern browser with IndexedDB and WebAssembly support.
- Optional: an API key from Gemini, OpenAI, or Anthropic, or a local Ollama install.
- Optional: a Supabase project for cloud sync and remote MCP.

## 1. Run the app locally

Clone the repository, install dependencies, and start the Vite dev server.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`. The first launch opens the project hub.

## 2. Create or import a document

Open **Project → New, import, or browse templates** to create or import documents.

1. **Create a document** — pick a name and a format: Markdown, LaTeX, or Typst.
2. **New from template** — start from a resume, paper, or technical documentation template.
3. **Import files** — bring in Markdown, LaTeX, Typst, text, ZIP, PDF text, DOCX text, or images. You review every file before it is imported.

Use **Settings → GitHub sync** to clone a repository and import its text files.

The editor autosaves to browser storage. Use **Project → Download backup ZIP** before a large import or a destructive change.

## 3. Write and preview

- Use the **Document format** selector beside the active filename to switch between Markdown, LaTeX, and Typst.
- Markdown supports GitHub-flavored tables, task lists, KaTeX math, and Mermaid diagrams.
- LaTeX and Typst show compile diagnostics in the preview pane.
- Press **Ctrl/Cmd + Enter** to recompile when focus is outside an input.
- Double-click a preview line to jump back to the source when the engine supports inverse search.

## 4. Connect AI (optional)

Open **Settings → Models and API keys** to choose a provider, select a model, and save your API key. Keys are stored in an AES-GCM encrypted browser vault and sent directly to the provider.

```text
Settings → Models and API keys → Provider → Model → Save
```

Open **Assistant** and try a small request.

```text
Tighten the introduction and keep the citations unchanged.
```

Review the proposed change in diff mode before applying it. Every applied AI action can be undone from the toolbar or the document history.

## 5. Connect a local agent (optional)

Keep the app open, open **Settings → Connections → Local bridge**, and click **Start local bridge**. Choose Claude Desktop, Cursor, Antigravity, or another stdio-capable client and copy its config from the wizard.

If you are using the hosted Vercel app, double-click **Start Dexter Bridge.cmd** in the project folder first; the hosted page cannot start local processes by itself.

One shared daemon serves every client, so you can leave more than one AI app connected. The agent can read project files, apply edits, compile, and read diagnostics. See [Local MCP](/docs#mcp-local) for the full setup.

## 6. Compile and export

Open the preview pane and compile the document. Then use the **Export** menu for:

- PDF
- LaTeX source (`.tex`)
- Typst source (`.typ`)
- Markdown (`.md`)
- Styled HTML
- Plain text
- Full project ZIP

A project ZIP is the safest backup because it includes every document and image.

## Where your data lives

| Data | Default location |
|---|---|
| Documents and project files | Browser storage (IndexedDB/local storage) |
| Images | Browser storage |
| AI keys | Encrypted browser vault |
| Undo snapshots | Browser storage |
| Cloud copy | Your Supabase project, only after you import |
| Live session | Peer-to-peer browser connection |

Nothing is uploaded until you sign in to the cloud, connect an external agent, or call an AI provider.

## Common first-run fixes

**The editor looks empty.** Open the project hub and create a document, or check that the active file is selected in the file tree.

**LaTeX compile is slow the first time.** The local TeX engine downloads about 120 MB once, then runs from cache. You can configure a cloud compiler URL instead.

**An MCP client cannot see Dexter Write.** Keep the app tab open, enable the bridge, and restart the client after changing its config.

**AI requests fail.** Confirm the key, model name, and provider base URL. For local Ollama, make sure the server allows requests from the browser origin.
