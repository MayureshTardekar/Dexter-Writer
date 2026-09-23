# 🗺️ Dexter Write — Development Roadmap

This document outlines the phased development roadmap, milestones, and technical deliverables for **Dexter Write**.

---

## 🎯 Release Horizons Overview

```
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 1: MVP (Minimum Viable Product)                 [COMPLETED] │
  │ Core 3-pane UI + BYOK + Virtual MCP + Dual Editor + Export │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 2: v1.0 (Power & Typesetting)                   [COMPLETED] │
  │ Typst WASM Engine + External MCP UI + Multi-File Tabs       │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ Phase 3: v2.0 (Collaboration, CI/CD & Offline Engine) [COMPLETED] │
  │ Yjs WebRTC + Git Sync + Review Agent + PWA + Docker + Vitest│
  └─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Phase 1: MVP (Completed)

**Objective**: Deliver a complete, functional, client-side open-source application that solves the core problem of AI-powered document authoring with zero server costs and zero data lock-in.

### Deliverables:
- [x] **Project Architecture & Specifications** (`README.md`, `ARCHITECTURE.md`, `PRODUCT_SPEC.md`, `MCP_SPEC.md`, `ROADMAP.md`).
- [x] **Modern 3-Pane Workspace Shell**:
  - Resizable split-pane layout: [ AI Playground | Monaco Editor | Live Preview ].
  - Dark Mode and Light Mode theme toggle.
- [x] **BYOK Security Vault**:
  - Encrypted browser local storage (Web Crypto AES-GCM) for API keys.
  - Multi-provider support: Google Gemini, OpenAI, Anthropic, and local Ollama (`http://localhost:11434`).
- [x] **Dual-Mode Document Editor (Monaco)**:
  - Markdown (`.md`) and LaTeX (`.tex`) syntax highlighting.
  - Line numbers, code folding, find & replace (`Ctrl+F`).
- [x] **Virtual MCP Document Server**:
  - In-browser tool execution loop: `read_document_content`, `insert_content`, `replace_lines`, `get_document_outline`.
  - Atomic edits preserving Monaco `Ctrl+Z` undo history.
- [x] **AI Playground with Voice Input**:
  - Conversational chat sidebar retaining document context.
  - Web Speech API microphone integration for voice-to-text dictation.
  - Floating "Ask AI about selection" trigger.
- [x] **Live Preview with Mathematical Typography**:
  - Real-time Markdown rendering (GitHub Flavored Markdown).
  - KaTeX math engine for inline (`$E=mc^2$`) and block equations.
- [x] **Overleaf Features**:
  - Document Outline / Table of Contents navigation bar.
  - Live Word and Character count metrics.
- [x] **Universal Multi-Format Export**:
  - Export to **PDF** (print-styled engine), **LaTeX (`.tex`)**, **Markdown (`.md`)**, **Styled HTML (`.html`)**, and **Plain Text (`.txt`)**.
- [x] **Built-in Starter Templates**:
  - Software Engineer ATS Resume (Markdown & LaTeX).
  - Academic Research Paper (LaTeX).
  - Technical Product & API Documentation (Markdown).

---

## ⚡ Phase 2: v1.0 (Advanced Typesetting & Extensibility) (Completed)

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

## 🌐 Phase 3: v2.0 (Real-Time Collaboration, Offline & Quality Engine) (Completed)

**Objective**: Complete Overleaf feature parity with real-time multi-user collaboration, automated version control, and production self-hosting.

### Deliverables:
- [x] **Peer-to-Peer & WebRTC Collaboration**:
  - Decentralized real-time multiplayer editing using **Yjs CRDTs**.
  - Invite collaborators via a simple URL room link with zero central database requirements.
- [x] **Native GitHub Git Sync**:
  - OAuth and personal access token login with GitHub to directly clone, commit, branch, and push LaTeX/Markdown repositories via `isomorphic-git`.
- [x] **Autonomous Document Review Agent**:
  - Multi-pass rule audit for ATS Resumes, Academic Papers (LaTeX math delimiters), and Technical Documentation.
  - 1-click batch auto-fixing in descending line order.
- [x] **Citations & Bibliography Manager**:
  - BibTeX parser, auto-formatting, in-text insertion (`\cite{}` and `[@]`), and live Crossref DOI search.
- [x] **Continuous Version History**:
  - IndexedDB snapshot engine capturing edits with time-travel inspection and instant rollback.
- [x] **Interactive Mermaid.js Diagramming**:
  - Live flowchart, sequence, and architecture diagram rendering with automatic dark/light theme switching.
- [x] **100% Offline PWA & Service Worker**:
  - Progressive Web App with `sw.js` caching shell assets, KaTeX fonts, and Monaco scripts for flight/disconnected usage.
- [x] **Vitest Automated Test Suite**:
  - Unit tests covering `virtualMcp`, `citations`, `lineDiff`, and `reviewAgent`.
- [x] **One-Click Self-Hosting (Docker)**:
  - Production-ready multi-stage `Dockerfile`, `docker-compose.yml`, and optimized `nginx.conf`.
- [x] **Continuous Deployment**:
  - GitHub Actions workflow (`deploy.yml`) for automated builds and deployment to GitHub Pages.

---

## 🤝 Contribution & Open-Source Community

Dexter Write is built for developers, researchers, and writers worldwide.

### Future Horizon & Community Ideas:
1. **Zotero & arXiv Direct Sync**: Two-way library synchronization for academic researchers.
2. **Community Templates Registry**: User-contributed resume formats and conference paper templates.
3. **Multi-Language UI**: Localization for global developer and academic communities.

---

*Roadmap maintained by the Dexter Write Open Source Team.*
