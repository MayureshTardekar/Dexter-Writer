# 📋 Dexter Write — Product Specification (MVP to v1.0)

This document outlines the detailed product requirements, target audience, feature specifications, and user experience flows for **Dexter Write**.

---

## 1. Product Summary & Mission

**Dexter Write** is an open-source, BYOK-enabled, AI-native document and resume workbench. It allows users to write, collaborate, and typeset technical and academic documents across Markdown and LaTeX with zero lock-in, zero privacy compromises, and infinite extensibility through the Model Context Protocol (MCP).

### Target Personas
1. **Software Engineers & Developers**: Creating ATS-optimized resumes and high-fidelity technical documentation synced with real GitHub repositories.
2. **Researchers & Academics**: Drafting scientific papers, mathematical proofs, and conference submissions without paying Overleaf monthly fees.
3. **Privacy-Conscious Power Users**: Demanding local or BYOK AI models without third-party middleware reading their sensitive documents.

---

## 2. Core Feature Specifications

### 2.1 Workspace & Layout

The user interface utilizes a sleek **3-Pane Resizable Layout**:

```
┌─────────────────┬───────────────────────────────┬───────────────────────────────┐
│  AI Playground  │       Document Editor         │         Live Preview          │
│     (25-30%)    │           (35-40%)            │           (35-40%)            │
│                 │                               │                               │
│ - Chat / Voice  │ - Monaco Editor Buffer        │ - Live Rendered Markdown      │
│ - BYOK Switcher │ - Line Numbers & Folding      │ - KaTeX Math Formulations     │
│ - Context Stats │ - LaTeX / Markdown Syntax     │ - LaTeX Outline & Structure   │
│ - Tool Activity │ - Inline Diff Review          │ - Print-Ready Styling         │
└─────────────────┴───────────────────────────────┴───────────────────────────────┘
```

- **Collapsible Panes**: Each pane can be toggled or resized via draggable divider handles.
- **Zen Mode**: Option to expand the Editor or Preview to full screen for focused writing.
- **Theme Support**: Polished Dark Mode (default, developer-focused) and Clean Light Mode.

---

### 2.2 Overleaf Feature Parity

Dexter Write brings the most valued features of Overleaf into a modern, responsive web application:

| Overleaf Feature | Dexter Write Implementation |
| :--- | :--- |
| **Document Outline (TOC)** | Live AST parser automatically extracts `#`, `##`, `\section{}`, `\subsection{}` into an interactive sidebar table of contents. Clicking jumps to the exact line in the editor. |
| **Word & Character Metrics** | Real-time counter displaying total words, characters, estimated reading time, and line count in the bottom status bar. |
| **Find & Replace** | Full regex and match-case support integrated directly within Monaco Editor (`Ctrl+F` / `Ctrl+H`). |
| **Syntax Highlighting & Linting** | Instant error markers for unclosed brackets, missing LaTeX tags, and markdown syntax issues. |
| **Split-Screen Sync** | Scrolling in the editor smoothly synchronizes preview position with debounce. |

---

### 2.3 The AI Playground & Voice Input

#### Conversational Playground
- Threaded chat keeping document context in active prompt history.
- Displays tool execution badges in the chat stream:
  - `🛠️ Read lines 20-45`
  - `✨ Inserted \section{Work Experience}`
  - `⚡ Fixed unclosed KaTeX formula`

#### Voice-to-Document
- Direct microphone button leveraging the browser's native **Web Speech API** (`webkitSpeechRecognition` / `SpeechRecognition`).
- Enables users to dictate resume accomplishments or document ideas hands-free.
- Transcribed text streams directly into the prompt box for immediate AI expansion.

#### Highlight-to-Discuss ("Ask AI")
- When the user selects any code block or paragraph in the editor, a floating action button appears: **"Ask AI"**.
- Clicking injects the selected snippet into the chat prompt with reference line numbers (`Lines 32-40`).

---

### 2.4 Virtual MCP Document Tools

The AI model receives access to a set of in-memory tools that give it direct control over the editor:

```typescript
interface VirtualDocumentTools {
  // Read document content
  getDocumentContent(params: { startLine?: number; endLine?: number }): string;

  // Insert content at specific line
  insertContent(params: { targetLine: number; position: 'before' | 'after'; text: string }): boolean;

  // Replace a block of lines
  replaceLines(params: { startLine: number; endLine: number; newText: string }): boolean;

  // Get structural outline
  getDocumentOutline(): Array<{ title: string; level: number; line: number }>;

  // Propose diff for review
  proposeDiff(params: { summary: string; originalText: string; proposedText: string }): void;
}
```

#### Diff Review Workflow
- **Auto-Apply Mode**: AI updates the Monaco buffer immediately (great for rapid brainstorming).
- **Diff Review Mode**: Opens a side-by-side Monaco Diff Editor:
  - Left: Current document state.
  - Right: AI proposed update.
  - Controls: **[Accept Changes]** or **[Discard Changes]**.

---

### 2.5 Multi-Format Universal Export Matrix

Users can export their work at any time without registration or watermarks:

```
                  ┌──────────────────────┐
                  │    Export Button     │
                  └──────────┬───────────┘
                             │
     ┌──────────────┬────────┼──────────────┬──────────────┐
     ▼              ▼        ▼              ▼              ▼
 ┌───────┐     ┌────────┐ ┌──────┐     ┌─────────┐    ┌─────────┐
 │ .pdf  │     │  .tex  │ │ .md  │     │  .html  │    │  .txt   │
 │ Print │     │ LaTeX  │ │ GFM  │     │ Stand-  │    │ Clean   │
 │Engine │     │ Source │ │Format│     │  alone  │    │ Extract │
 └───────┘     └────────┘ └──────┘     └─────────┘    └─────────┘
```

1. **PDF Export**: Uses browser print media queries (`@media print`) and vector styling for clean, pagination-aware PDF generation.
2. **LaTeX (`.tex`) Export**: Raw downloadable `.tex` file with UTF-8 encoding.
3. **Markdown (`.md`) Export**: Standard markdown export ready for GitHub repositories.
4. **Standalone Styled HTML (`.html`)**: Self-contained HTML file with embedded CSS and KaTeX fonts for offline viewing.
5. **Plain Text (`.txt`)**: Strips formatting tags for clean text sharing or clipboard copying.

---

## 3. Starter Templates Specification

Dexter Write ships with built-in, production-ready templates:

### Template 1: Software Engineer Resume (ATS Optimized)
- Formats: Available in both **LaTeX** and **Markdown**.
- Sections:
  - Header (Name, Contact, GitHub, LinkedIn, Portfolio)
  - Technical Skills (Languages, Frameworks, Cloud, Databases)
  - Professional Experience (Action-verb bullet points with metrics)
  - Featured Projects (Live links, tech stack badges)
  - Education & Certifications

### Template 2: Academic & Research Paper
- Formats: Available in **LaTeX** (`article` class) and **Markdown**.
- Sections:
  - Title, Authors, Affiliations, Date
  - Abstract & Keywords
  - 1. Introduction
  - 2. Methodology & Mathematical Formulations (KaTeX equations)
  - 3. Results & Comparative Data Table
  - 4. Discussion & Conclusion
  - 5. References / Bibliography

### Template 3: Technical Product & API Specification
- Format: **Markdown**.
- Sections:
  - Project Overview & Architecture Diagram
  - Installation & Quickstart commands
  - REST & GraphQL API Endpoints
  - Error Codes & Rate Limits
  - Security & Authentication

---

## 4. Non-Functional Requirements

- **Security**: No user keys or documents stored unencrypted; zero analytics tracking by default.
- **Offline Capability**: Core editor, preview, and local templates work 100% offline (PWA-ready).
- **Cross-Browser Compatibility**: Chrome, Firefox, Safari, Edge, Arc, Brave.
- **Accessibility**: ARIA labels on all interactive controls, full keyboard navigation shortcuts (`Ctrl+S`, `Ctrl+Enter`, `Ctrl+P`).
