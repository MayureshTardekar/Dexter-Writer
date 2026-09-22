# 🏛️ Dexter Write — System Architecture

This document describes the technical architecture, security model, and data flow of **Dexter Write**.

---

## 1. Architectural Philosophy

Dexter Write is designed around four foundational principles:

1. **Client-First & Zero-Knowledge Security**: User data, documents, and API keys reside exclusively in the client's browser. No proprietary backend proxies user credentials or stores unencrypted documents.
2. **Standardized Protocol (MCP-Native)**: Document manipulation is treated as a standard **Model Context Protocol (MCP)** service. This makes the editor model-agnostic and directly accessible to any LLM supporting tool calling.
3. **Multi-Model BYOK Freedom**: Users have total agency over which model writes their documents, switching seamlessly between Google Gemini, OpenAI, Claude, and local Ollama instances.
4. **Instant Typesetting**: Fast preview feedback loop utilizing WebAssembly and KaTeX, avoiding cumbersome 30-second LaTeX compilation cycles.

---

## 2. High-Level Component Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BROWSER RUNTIME                                 │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            UI View Layer                              │  │
│  │  ┌───────────────────┬───────────────────────┬─────────────────────┐  │  │
│  │  │   AI Playground   │     Monaco Editor     │    Live Preview     │  │  │
│  │  │  - Chat Feed      │  - Monaco Buffer      │  - GFM Markdown     │  │  │
│  │  │  - Speech-to-Text │  - Syntax Highlighter │  - KaTeX Math       │  │  │
│  │  │  - Key Vault UI   │  - Diff Review Modal  │  - Structure TOC    │  │  │
│  │  └─────────┬─────────┴───────────▲───────────┴──────────▲──────────┘  │  │
│  └────────────┼─────────────────────┼──────────────────────┼─────────────┘  │
│               │ Events / Prompts    │ Edits & Patches      │ Real-time AST  │
│               ▼                     │                      │                │
│  ┌──────────────────────────────────┴──────────────────────┴─────────────┐  │
│  │                       Client Core Engine                              │  │
│  │                                                                       │  │
│  │   ┌────────────────────────┐         ┌────────────────────────────┐   │  │
│  │   │  BYOK Security Vault   │         │  Virtual MCP Doc Server    │   │  │
│  │   │  - AES-GCM Encrypted   │         │  - get_document_content    │   │  │
│  │   │  - localStorage store  │         │  - replace_lines           │   │  │
│  │   │  - Session validation  │         │  - insert_content          │   │  │
│  │   └───────────┬────────────┘         │  - get_document_outline    │   │  │
│  │               │                      └─────────────▲──────────────┘   │  │
│  │               ▼                                    │                  │  │
│  │   ┌────────────────────────┐                       │                  │  │
│  │   │   AI Gateway Adapter   │───────────────────────┘ Tool Calls       │  │
│  │   │   - Google Gemini SDK  │                                          │  │
│  │   │   - OpenAI Stream API  │                                          │  │
│  │   │   - Anthropic Fetch    │                                          │  │
│  │   │   - Ollama Local Proxy │                                          │  │
│  │   └───────────┬────────────┘                                          │  │
│  │               │                                                       │  │
│  │   ┌───────────▼────────────┐                                          │  │
│  │   │  External MCP Client   │                                          │  │
│  │   │  - SSE Transport       │                                          │  │
│  │   │  - HTTP Stream Client  │                                          │  │
│  │   └───────────┬────────────┘                                          │  │
│  └───────────────┼───────────────────────────────────────────────────────┘  │
└──────────────────┼──────────────────────────────────────────────────────────┘
                   │
                   ▼ (Direct HTTPS / SSE over network)
┌─────────────────────────────────────────────────────────────────────────────┐
│                             EXTERNAL SERVICES                               │
│                                                                             │
│   ┌──────────────────┐   ┌──────────────────┐   ┌───────────────────────┐   │
│   │ Google Gemini    │   │ OpenAI / Claude  │   │ Remote MCP Servers    │   │
│   │ API Endpoints    │   │ API Endpoints    │   │ (GitHub / Web / Docs) │   │
│   └──────────────────┘   └──────────────────┘   └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Virtual MCP (Model Context Protocol) Layer

### 3.1 What is the Virtual MCP Server?
In traditional MCP implementations, an MCP server is a standalone process communicating over standard I/O (`stdio`). In a browser environment, Web Workers and JavaScript runtimes cannot execute arbitrary local OS processes.

Dexter Write solves this with an **In-Memory Virtual MCP Server**:
1. It registers the document editor buffer as an MCP resource and tool registry.
2. It exposes strict JSON Schemas to LLMs via function calling.
3. When the LLM decides to update text, it issues an MCP tool call which is parsed and safely applied to the Monaco editor.

### 3.2 Virtual MCP Tools Specification

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `get_document_content` | `start_line?: number, end_line?: number` | Returns the entire document or a specific line slice to provide context to the LLM. |
| `replace_lines` | `start_line: number, end_line: number, new_text: string` | Replaces a continuous block of lines with new content (for section rewrites or formula fixes). |
| `insert_content` | `target_line: number, position: 'before' \| 'after', text: string` | Inserts a new block of text at a specific line without disrupting surrounding code. |
| `get_document_outline` | *none* | Returns a structural summary of the document (headings `#`, `\section`, `\subsection`) with line numbers for fast navigation. |
| `propose_diff` | `summary: string, patches: Array<Patch>` | Generates a structured diff preview before applying changes to the editor. |

### 3.3 Execution Loop: Prompt to Document Mutation

```
[User speaks/types: "Add a Skills section for a Full-Stack Engineer"]
                             │
                             ▼
                 [AI Gateway receives prompt]
                             │
                             ▼
               [Attached Virtual MCP Tools Schema]
                             │
                             ▼
         [LLM streams response and decides tool call]
                             │
                             ▼
     tool_call: insert_content(target_line: 45, text: "\section{Skills}...")
                             │
                             ▼
              [Virtual MCP Router intercepts call]
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [Mode: Auto-Apply]               [Mode: Diff Review]
            │                                 │
 [Monaco Buffer updated]             [Side-by-Side Diff Modal]
            │                                 │
 [Live Preview Re-rendered]          [User clicks 'Accept']
                                              │
                                     [Monaco Buffer updated]
```

---

## 4. BYOK (Bring Your Own Key) Security Model

### 4.1 Client-Side Key Storage
- **Encryption at Rest**: Keys entered into the BYOK modal are encrypted using the Web Cryptography API (`SubtleCrypto` with AES-GCM 256-bit) before storage in `localStorage`.
- **Zero Transit Leakage**: Requests to LLM providers are made **directly from the client browser to the official provider endpoint** (`generativelanguage.googleapis.com`, `api.openai.com`, `api.anthropic.com`).
- **No Third-Party Proxy**: Unlike SaaS AI wrappers, Dexter Write does not proxy your API key through an intermediary cloud server.
- **Local Model Support**: Supports local endpoints such as `http://localhost:11434/v1` for Ollama, enabling 100% offline, private AI document generation.

---

## 5. Typesetting & Preview Engine

### 5.1 Dual-Engine Strategy
Dexter Write uses a dual-engine approach to ensure sub-second rendering latency:

1. **Markdown + Math Engine**:
   - `react-markdown` parses the AST.
   - `remark-gfm` adds GitHub Flavored Markdown (tables, autolinks, task lists, strikethrough).
   - `remark-math` + `rehype-katex` renders inline (`$x$`) and display (`$$\sum$$`) math formulas instantly in DOM without server trips.
2. **LaTeX Mode**:
   - Live lexical highlighter in Monaco.
   - AST parser extracting sections (`\section`, `\chapter`, `\textbf`, `\begin{itemize}`) into a structured real-time preview and document outline.
   - Quick export to `.tex` and Browser Print-to-PDF engine with custom print stylesheets.

---

## 6. Overleaf Comparison Matrix

| Architectural Feature | Overleaf (Traditional) | Dexter Write |
| :--- | :--- | :--- |
| **Hosting Model** | Centralized Cloud Server | Client-First / Self-Hostable |
| **Pricing / Access** | Subscription for collaboration & features | 100% Free & Open-Source (Apache-2.0) |
| **AI Integration** | Proprietary add-on / third-party MCP hacks | Native Virtual MCP + Multi-Provider BYOK |
| **LLM Support** | Limited / Hardcoded | Gemini, OpenAI, Claude, Ollama, DeepSeek |
| **Tool Extensibility** | None | Model Context Protocol (MCP) clients & servers |
| **Voice Playground** | Not supported | Native Web Speech & Audio Multi-Modal |
| **Typesetting Engines** | LaTeX (PdfLaTeX / XeLaTeX backend) | Markdown + KaTeX + LaTeX AST (Fast preview) |
| **Export Options** | PDF, ZIP | PDF, LaTeX (`.tex`), Markdown (`.md`), HTML, TXT |
| **Data Privacy** | Stored on company servers | 100% Local / Zero-Knowledge client |

---

## 7. Performance & Scalability Benchmarks

- **Bundle Size**: Under 2.5MB initial payload (lazy-loading Monaco and KaTeX assets).
- **Preview Latency**: Under 16ms (60 FPS) debounce on keystrokes.
- **AI Streaming Latency**: Direct HTTP/2 Server-Sent Events (SSE) from provider gives real-time token streaming with zero added server latency.
