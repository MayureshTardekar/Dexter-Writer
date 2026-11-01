The AI Playground is a project-aware writing panel. It can read the current document, inspect project files, propose edits, and apply changes with an undo trail. It is not a separate chatbot that asks you to copy and paste.

## Bring your own key

Dexter Write does not resell model access. You connect a provider and pay that provider directly.

- Google Gemini
- OpenAI
- Anthropic
- OpenAI-compatible endpoints
- Local Ollama models

Open the **AI** activity, choose a provider, paste the key, and select a model. Keys are encrypted with AES-GCM in browser storage and sent only to the provider endpoint you configure.

The vault key also lives in the browser profile. This protects against casual inspection of storage, not against someone who already controls your browser session. Use a dedicated browser profile or clear the vault on shared machines.

## Chat, selection, and voice

The panel supports three ways to start:

1. **Chat** — ask for a new section, a rewrite, a critique, or a project-level change.
2. **Selection context** — select text in the editor and ask the AI to work on that passage.
3. **Voice** — use the microphone to dictate an instruction or a draft.

The AI can inspect project files through built-in tools such as listing files, reading a file, reading the outline, and searching the project. That means a request like "update every chapter that mentions the old API" can be handled against the real project tree.

## Review before apply

When a response proposes changes, you can inspect them before they land.

- **Diff review** shows the proposed change against the current content.
- **Auto-apply** applies the change immediately.
- **Discard** leaves the document untouched.

The external MCP path is different: MCP agents apply edits directly, then keep Undo available. This documentation keeps the two flows explicit because they have different review models.

## Undo and history

Every applied AI action stores enough information to reverse it:

- The affected file IDs
- The content before and after the change
- The active file at the time
- A short summary

Use **Undo AI** in the toolbar, the inline applied notice, or **History**. If a file changed after the action, undo is blocked rather than overwriting the newer work.

## Prompt patterns that work

**Scope the change.**

```text
Rewrite only section 3. Keep the citations and the heading structure unchanged.
```

**Ask for a plan first.**

```text
Read the project outline and list the five weakest transitions. Do not edit yet.
```

**Use the project tools.**

```text
Find every file that mentions the old endpoint, then update those files consistently.
```

**Set a hard constraint.**

```text
Keep the document under 8 pages. Do not add new citations.
```

## Providers and models

Model names change frequently. If a request fails, check the provider console for the current model ID. For custom OpenAI-compatible endpoints, set the base URL and model name exactly as the provider documents them.

A local Ollama server must allow requests from the app origin. If the browser blocks the request, configure Ollama's allowed origins or use a provider that supports browser CORS.

## AI versus MCP

| Flow | Who starts it | Review model |
|---|---|---|
| AI Playground | You, inside Dexter Write | Diff review or auto-apply |
| Local MCP | Claude, Cursor, Antigravity, or another client | Applies immediately; Undo remains |
| Remote MCP | Cloud-connected agent | Applies immediately; revision Undo in Cloud |

Use the Playground for exploratory work where you want to compare options. Use MCP when an agent should operate the project directly.

## Privacy checklist

- Confirm which provider endpoint is selected before sending sensitive material.
- Prefer a local model for confidential drafts.
- Clear the provider key and the vault on a shared machine.
- Use the cloud only when you need remote agents or cross-device access.
- Read [Security and privacy](/docs#security) before connecting a cloud project.
