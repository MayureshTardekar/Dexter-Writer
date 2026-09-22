# 🗺️ Dexter Write — Development Roadmap

This document outlines the phased development roadmap, milestones, and technical deliverables for **Dexter Write**.

---

## 🎯 Release Horizons Overview

```
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 1: MVP (Minimum Viable Product)                       │
  │ Core 3-pane UI + BYOK + Virtual MCP + Dual Editor + Export │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 2: v1.0 (Power & Typesetting)                         │
  │ Typst WASM Engine + External MCP UI + Multi-File Tabs       │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 3: v2.0 (Collaborative Cloud & Git Sync)              │
  │ Real-Time Yjs Collaboration + GitHub Git Sync + Docker Hub  │
  └─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Phase 1: MVP (Current Phase)

**Objective**: Deliver a complete, functional, client-side open-source application that solves the core problem of AI-powered document authoring with zero server costs and zero data lock-in.

### Deliverables:
- [x] **Project Architecture & Specifications** (`README.md`, `ARCHITECTURE.md`, `PRODUCT_SPEC.md`, `MCP_SPEC.md`, `ROADMAP.md`).
- [ ] **Modern 3-Pane Workspace Shell**:
  - Resizable split-pane layout: [ AI Playground \| Monaco Editor \| Live Preview ].
  - Dark Mode and Light Mode theme toggle.
- [ ] **BYOK Security Vault**:
  - Encrypted browser local storage for API keys.
  - Multi-provider support: Google Gemini, OpenAI, Anthropic, and local Ollama (`http://localhost:11434`).
- [ ] **Dual-Mode Document Editor (Monaco)**:
  - Markdown (`.md`) and LaTeX (`.tex`) syntax highlighting.
  - Line numbers, code folding, find & replace (`Ctrl+F`).
- [ ] **Virtual MCP Document Server**:
  - In-browser tool execution loop: `read_document_content`, `insert_content`, `replace_lines`, `get_document_outline`.
  - Atomic edits preserving Monaco `Ctrl+Z` undo history.
- [ ] **AI Playground with Voice Input**:
  - Conversational chat sidebar retaining document context.
  - Web Speech API microphone integration for voice-to-text dictation.
  - Floating "Ask AI about selection" trigger.
- [ ] **Live Preview with Mathematical Typography**:
  - Real-time Markdown rendering (GitHub Flavored Markdown).
  - KaTeX math engine for inline (`$E=mc^2$`) and block equations.
- [ ] **Overleaf Features**:
  - Document Outline / Table of Contents navigation bar.
  - Live Word and Character count metrics.
- [ ] **Universal Multi-Format Export**:
  - Export to **PDF** (print-styled engine), **LaTeX (`.tex`)**, **Markdown (`.md`)**, **Styled HTML (`.html`)**, and **Plain Text (`.txt`)**.
- [ ] **Built-in Starter Templates**:
  - Software Engineer ATS Resume (Markdown & LaTeX).
  - Academic Research Paper (LaTeX).
  - Technical Product & API Documentation (Markdown).

---

## ⚡ Phase 2: v1.0 (Advanced Typesetting & Extensibility)

**Objective**: Upgrade typesetting performance to sub-second PDF generation and expose external MCP connectivity.

### Deliverables:
- [x] **Typst WebAssembly Engine Integration**:
  - Embed `@myriaddreamin/typst.ts` directly into the client.
  - Render Typst documents to vector PDF in milliseconds without external LaTeX toolchains.
- [x] **External MCP Server Manager**:
  - In-app UI to register remote MCP endpoints (GitHub, Web Search, Filesystem) over SSE/HTTP.
  - Granular permission prompts before external tools access sensitive resources.
- [x] **Side-by-Side Monaco Diff Review**:
  - Visual red/green diff review modal before committing AI edits.
  - Per-chunk *Accept* / *Reject* controls.
- [x] **Multi-File & Tab Manager**:
  - File tree sidebar for multi-chapter books, thesis projects, and document collections.
  - Export entire project bundles as ZIP archives.

---

## 🌐 Phase 3: v2.0 (Real-Time Collaboration & Cloud Ecosystem)

**Objective**: Complete Overleaf feature parity with real-time multi-user collaboration and automated version control.

### Deliverables:
- [x] **Peer-to-Peer & WebRTC Collaboration**:
  - Decentralized real-time multiplayer editing using **Yjs CRDTs**.
  - Invite collaborators via a simple URL room link with zero central database requirements.
- [x] **Native GitHub Git Sync**:
  - OAuth login with GitHub to directly clone, commit, branch, and push LaTeX/Markdown repositories.
- [x] **One-Click Self-Hosting**:
  - Official Dockerfile and Docker Compose configurations for self-hosting on private VPS or home servers.

---

## 🤝 Contribution & Open-Source Community

Dexter Write is built for developers, researchers, and writers worldwide.

### Ways to Contribute:
1. **Templates**: Contribute new LaTeX and Markdown templates (resumes, thesis formats, grant proposals).
2. **MCP Tool Integrations**: Add connectors for academic databases (arXiv, Zotero) and developer tools.
3. **Localization**: Help translate the user interface into multiple languages.

---

*Roadmap maintained by the Dexter Write Open Source Team.*
