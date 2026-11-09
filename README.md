5# ⚡ Dexter Write

> **The Open-Source, BYOK & MCP-Native Collaborative Document & Resume Platform**  
> *An Overleaf alternative designed for the AI era: Bring Your Own Key, connect any MCP server, and let AI directly assist, typeset, and write across Markdown and LaTeX.*

---

## 🌟 The Vision

Traditional document preparation tools fall into two extremes:
1. **The Overleaf Model**: Established for LaTeX and academia, but charges for basic collaboration, has rigid formatting toolchains, and offers negligible AI assistance.
2. **Proprietary AI Editors**: Tools that lock users into monthly SaaS subscriptions, charge exorbitant markups on AI tokens, and keep AI confined to an isolated sidebar chatbot where users must endlessly copy and paste text.

**Dexter Write** bridges this gap by creating a **100% open-source, client-first, privacy-respecting document workspace**. It pairs a high-performance **dual-mode code editor (Markdown & LaTeX)** with an **AI Playground (Chat & Voice)** backed by **Virtual Model Context Protocol (MCP)** tools.

The AI doesn't just chat—**it directly inspects, patches, and typesets your document in real-time.**

---

## 🚀 Key Highlights & Differentiators

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Dexter Write Ecosystem                          │
├────────────────────┬─────────────────────────────┬─────────────────────┤
│   Zero Lock-In     │      Virtual MCP Core       │   Multi-Provider    │
│  Bring Your Own    │   AI directly reads, edits, │   Gemini, OpenAI,   │
│   Key (BYOK)       │   and diffs document code   │   Claude, Ollama    │
├────────────────────┼─────────────────────────────┼─────────────────────┤
│  Overleaf Suite    │     Interactive Voice       │   Universal Export  │
│  TOC, Word Count,  │  Speak ideas, metrics, and  │   PDF, LaTeX, MD,   │
│  Linting & Math    │  prompts to write live docs │   HTML, Plain Text  │
└────────────────────┴─────────────────────────────┴─────────────────────┘
```

### 1. 🔑 True Bring Your Own Key (BYOK)
- Plug in your **Google Gemini, OpenAI, Anthropic**, or local **Ollama** API keys.
- **Zero markup**: You only pay raw token costs directly to the provider (or $0 with local models).
- **Client-Side Privacy Vault**: Keys are stored locally in encrypted browser storage; they never pass through any middleman server.

### 2. 🤖 Native MCP (Model Context Protocol) Integration
- **In-Browser Virtual MCP Server**: The active document buffer is exposed to the AI as a native MCP server (`read_document`, `replace_lines`, `insert_text`, `get_outline`).
- **Desktop MCP Bridge** uses one shared daemon. Open **Settings → Connections → Local bridge** for setup, or run `npm run mcp:config` for a client configuration. Local edits apply immediately and can be undone in Dexter Write.
- **ChatGPT Web via Secure MCP Tunnel**: Connect the same bridge to `chatgpt.com` as a custom MCP server through OpenAI's outbound-only tunnel. Run `npm run mcp:tunnel` for exact commands; no public port is opened.
- **External MCP Client**: Connect external MCP servers (such as GitHub, Web Search, or local repos) over SSE/HTTP to inject real code, commit logs, and citations into your documentation or resume.

#### ChatGPT web (Secure MCP Tunnel)

ChatGPT web can reach the local bridge without exposing `127.0.0.1:3088` to the public internet:

1. Install [OpenAI `tunnel-client`](https://github.com/openai/tunnel-client/releases/latest).
2. Create a tunnel and runtime API key in [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), then associate the tunnel with your ChatGPT workspace.
3. Run `npm run mcp:tunnel` and execute the printed `tunnel-client init` command with your tunnel ID.
4. Start it with `tunnel-client run --profile dexter-write`. The tunnel process connects to the shared Dexter Write daemon.
5. At `chatgpt.com/plugins`, add a custom MCP server with `Connection: Tunnel`, select the tunnel, and choose `No authentication`.
6. Keep Dexter Write open with the bridge enabled. Edits and inserts apply immediately and can be undone in Dexter Write.

Custom MCP server access in ChatGPT depends on your plan, workspace, and permissions. The tunnel is outbound-only and the daemon still accepts browser connections only from local Dexter Write origins.

### 3. 🎙️ Two-in-One Voice & Chat Playground
- Interactive sidebar with continuous conversational memory.
- **Voice-to-Document**: Tap the microphone, speak instructions or resume bullets, and let the AI draft and format them automatically.
- **Highlight to Discuss**: Select any equation, table, or paragraph in the editor and send it to the AI for targeted refinement.

### 4. 📝 Dual-Mode Typesetting (Markdown + LaTeX)
- Write technical documentation in **GitHub Flavored Markdown** with full **KaTeX mathematical expressions** (`$E=mc^2$`).
- Write academic papers and resumes in **LaTeX (`.tex`)** with instant syntax highlighting and structural navigation.

### 5. 🔍 Inline Diff & Review Control
- Avoid destructive AI rewrites.
- Toggle between **Auto-Apply** and **Diff Review Mode** (side-by-side comparison with one-click *Accept* or *Reject*).

### 6. 📦 Multi-Format Universal Export
- One-click export to:
  - **PDF** (High-quality print engine)
  - **LaTeX Source (`.tex`)**
  - **Markdown (`.md`)**
  - **Standalone Styled HTML (`.html`)**
  - **Plain Text (`.txt`)**

---

## 🏗️ Architecture at a Glance

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │                           Dexter Write UI                             │
 ├───────────────────┬───────────────────────────┬───────────────────────┤
 │   AI Playground   │       Monaco Editor       │     Live Preview      │
 │  (Chat & Voice)   │    (Markdown / LaTeX)     │ (Markdown + KaTeX/PDF)│
 └─────────┬─────────┴─────────────▲─────────────┴───────────────────────┘
           │                       │
           ▼                       │
 ┌─────────────────────────────────┴─────────────────────────────────────┐
 │                         Client-Side Engine                            │
 │                                                                       │
 │  [BYOK Provider Gateway]         [Virtual MCP Document Server]        │
 │  - Google Gemini 2.5             - get_document_content               │
 │  - OpenAI GPT-4o                 - replace_lines / insert_block       │
 │  - Anthropic Claude 3.5          - get_document_outline               │
 │  - Local Ollama                  - apply_diff                         │
 │                                                                       │
 │  [Local Desktop MCP Bridge]                                           │
 │  - node bin/dexter-mcp.mjs (stdio <-> localhost SSE)                  │
 │  - Read, edit, compile, diagnostics, resources, prompts               │
 │                                                                       │
 │  [External MCP Client]                                                │
 │  - Connects to SSE / HTTP MCP endpoints (GitHub, Web Search, etc.)    │
 └───────────────────────────────────────────────────────────────────────┘
```

---

## 📑 Starter Templates Included

1. **Software Engineer Resume**: Industry-tested resume template optimized for ATS systems (available in both Markdown and LaTeX formats).
2. **Academic Research Paper**: Standard academic format with abstract, sections, bibliography support, and LaTeX equation typesetting.
3. **Technical API Documentation**: Clean markdown documentation template with code snippets, parameter tables, and architecture blocks.

---

## 🚀 Deployment

The production frontend is deployed on **Vercel** from the `main` branch. Vercel runs `npm run build`, serves `dist`, and applies the SPA rewrites in `vercel.json` so routes like `/oauth/consent` resolve correctly.

Supabase provides authentication, cloud sync, and the hosted MCP function. The optional LaTeX compiler in `lambda/` can be deployed separately as an AWS Lambda function.

The [in-app documentation](https://dexter-writer.vercel.app/docs) includes the workspace and cloud setup guides.

---

## 🧪 Development & Testing

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Run unit tests (Vitest)
npm test

# Run linter (Oxlint)
npm run lint

# Build production bundle
npm run build
```

---

## ✈️ 100% Offline Capability (PWA)

Dexter Write features a built-in Service Worker (`public/sw.js`). Once loaded, all critical editor components, Monaco workers, KaTeX math fonts, and Typst WASM binaries are stored in your browser cache. You can write and edit papers on airplanes or with no network connection—your data never leaves your device.

---

## 🧭 Project Structure

- `src/` — React application, editor, AI tools, and cloud/MCP logic.
- `supabase/` — database migrations, RLS policies, and Edge Functions.
- `lambda/` — optional serverless LaTeX compiler.
- `tests/` — unit and browser tests.

---

## 📄 License & Community

Dexter Write is open-source under the **Apache-2.0 License**.  
Contributions, feedback, and feature requests are welcome!

