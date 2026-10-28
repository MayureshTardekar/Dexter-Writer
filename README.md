# ⚡ Dexter Write

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
- **Desktop MCP Bridge**: Run `npm run mcp` and register `bin/dexter-mcp.mjs` in Claude Desktop or Cursor (`npm run mcp:config` prints the JSON). External agents can read any project file, stage exact-string edits and inserts for review, compile LaTeX/Typst, and read diagnostics.
- **ChatGPT Web via Secure MCP Tunnel**: Connect the same bridge to `chatgpt.com` as a custom MCP server through OpenAI's outbound-only tunnel. Run `npm run mcp:tunnel` for exact commands; no public port is opened.
- **External MCP Client**: Connect external MCP servers (such as GitHub, Web Search, or local repos) over SSE/HTTP to inject real code, commit logs, and citations into your documentation or resume.

#### ChatGPT web (Secure MCP Tunnel)

ChatGPT web can reach the local bridge without exposing `127.0.0.1:3088` to the public internet:

1. Install [OpenAI `tunnel-client`](https://github.com/openai/tunnel-client/releases/latest).
2. Create a tunnel and runtime API key in [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), then associate the tunnel with your ChatGPT workspace.
3. Run `npm run mcp:tunnel` and execute the printed `tunnel-client init` command with your tunnel ID.
4. Start it with `tunnel-client run --profile dexter-write`. This starts the Dexter Write MCP daemon, so do not also run `npm run mcp`.
5. At `chatgpt.com/plugins`, add a custom MCP server with `Connection: Tunnel`, select the tunnel, and choose `No authentication`.
6. Keep Dexter Write open with the bridge enabled. Reads run immediately; edits and inserts are staged for review.

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
 │  - Read, stage, compile, diagnostics, resources, prompts              │
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

## 🐳 Self-Hosting with Docker

You can self-host Dexter Write on any VPS, home server, or local machine using Docker:

```bash
# Clone the repository
git clone https://github.com/MayureshTardekar/Dexter-Writer.git
cd Dexter-Writer

# Start using Docker Compose
docker compose up -d
```

Open your browser at `http://localhost:3000`. The multi-stage Nginx container will serve the app with full client-side WASM, PWA offline caching, and sub-second load times.

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

## 🧭 Documentation Directory

For in-depth technical documentation, please refer to:
- 📐 [**ARCHITECTURE.md**](./ARCHITECTURE.md) — Comprehensive technical architecture, data flows, and security model.
- 📋 [**PRODUCT_SPEC.md**](./PRODUCT_SPEC.md) — Complete product requirements, feature specifications, and Overleaf parity checklist.
- 🔌 [**MCP_SPEC.md**](./MCP_SPEC.md) — Model Context Protocol specifications, tool schemas, and external server bridging.
- 🗺️ [**ROADMAP.md**](./ROADMAP.md) — Development milestones from MVP to v2.0 collaborative cloud platform.

---

## 📄 License & Community

Dexter Write is open-source under the **Apache-2.0 License**.  
Contributions, feedback, and feature requests are welcome!

