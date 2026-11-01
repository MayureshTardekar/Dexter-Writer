Dexter Write is an open-source, local-first writing workspace for **Markdown, LaTeX, and Typst**. It pairs a real code editor and compile preview with bring-your-own-key AI, MCP agents, cloud sync, and peer-to-peer collaboration.

The project is built for people who want AI help without giving up control of their documents, their keys, or their workflow. Files stay in your browser by default. AI requests go directly to the provider you choose. Agents can edit the open project only when you enable a bridge or connect a cloud project.

## Why Dexter Write exists

Most writing tools force a choice: a mature typesetting tool with limited AI, or a proprietary AI editor that locks your content and keys inside a subscription. Dexter Write takes a different path.

- **Local-first by default.** Autosave uses browser storage. You can export a full project ZIP at any time.
- **Bring your own key.** Connect Gemini, OpenAI, Anthropic, an OpenAI-compatible endpoint, or a local Ollama model.
- **MCP-native.** Claude, Cursor, ChatGPT, and Antigravity can read and edit the project through the Model Context Protocol.
- **Real typesetting.** Markdown with math and Mermaid, LaTeX with diagnostics, and native Typst support.
- **Undo is structural.** AI and MCP edits snapshot the previous content, so Undo is available after the change applies.

## The surfaces

| Surface | What it does | Start here |
|---|---|---|
| Editor and preview | Write in Markdown, LaTeX, or Typst with live preview and compile diagnostics | [Writing and the editor](/docs#editor) |
| AI Playground | Chat, voice, project tools, diff review, and undoable edits | [AI writing](/docs#ai) |
| MCP bridge | Let external agents read and edit the open local project | [Local MCP](/docs#mcp-local) |
| Cloud and remote MCP | Keep a Supabase copy and let agents work while the tab is closed | [Cloud sync](/docs#cloud) |
| Live collaboration | Edit the same project peer-to-peer with a room link | [Live collaboration](/docs#collaboration) |
| Compile and export | PDF, LaTeX, Typst, Markdown, HTML, TXT, and project ZIP | [Compile and export](/docs#compile-export) |

## How the pieces fit

```text
Browser workspace
  ├─ Editor + preview + local autosave
  ├─ AI Playground ── direct HTTPS ──► your provider
  ├─ Local MCP bridge ── localhost ──► Claude / Cursor / Antigravity
  └─ Live collaboration ── WebRTC ──► collaborators

Optional cloud
  ├─ Supabase project files + revisions
  ├─ Remote MCP endpoint ── OAuth ──► Claude / ChatGPT / Antigravity
  └─ Linked browser tab pulls applied edits
```

## Design principles

**Your machine is the default host.** The app works without an account. Cloud sync is optional and only moves project files and images into the Supabase project you configure.

**The model does not get unrestricted writes.** Every MCP edit carries a base version. A stale edit is rejected instead of overwriting newer work. Applied edits create a revision snapshot first.

**One behavior everywhere.** Local MCP and remote MCP both apply edits directly and keep an undo path. There is no separate "accept the AI edit" mode for external agents.

**Professional writing first.** The editor is not a chat wrapper. Structure, validation, compilation, citations, history, and export are first-class parts of the workspace.

## Next steps

Start with the [quickstart](/docs#quickstart) if you want to run the app now. If you are setting up an agent, go straight to [Local MCP](/docs#mcp-local) or [Remote MCP](/docs#mcp-remote).
