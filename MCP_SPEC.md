# 🔌 Dexter Write — Model Context Protocol (MCP) Specification

This document provides the definitive architectural specification for the **Model Context Protocol (MCP)** implementation in **Dexter Write**.

---

## 1. What is MCP & Why is it Critical for Dexter Write?

The **Model Context Protocol (MCP)** is an open standard designed to enable AI models to securely interface with tools, data sources, and runtime environments.

In typical document editors, the AI model is isolated in an external chat bubble:
- It cannot observe the document cursor.
- It cannot inspect specific sections without manual copy-pasting.
- It cannot write directly into the text editor buffer.

**Dexter Write implements a dual-tier MCP architecture:**
1. **Tier 1 (Virtual In-Browser Document Server)**: The active Monaco editor buffer is exposed to the AI model as a standard MCP server running entirely in browser memory.
2. **Tier 2 (External Remote MCP Client)**: A browser-based client that connects to external MCP servers over Server-Sent Events (SSE) or HTTP streams (e.g., GitHub, Web Search, File Repositories).

---

## 2. Tier 1: Virtual Document MCP Server

### 2.1 Server Manifest
```json
{
  "name": "dexter-write-document-server",
  "version": "1.0.0",
  "description": "Exposes the active Dexter Write document buffer as controllable MCP tools",
  "capabilities": {
    "tools": true,
    "resources": true
  }
}
```

---

### 2.2 Tool Definitions & Schemas

#### Tool 1: `read_document_content`
Reads the entire document or a targeted range of lines.
```json
{
  "name": "read_document_content",
  "description": "Reads text lines from the active document editor to analyze content, structure, or formatting.",
  "parameters": {
    "type": "object",
    "properties": {
      "start_line": {
        "type": "integer",
        "description": "Optional starting line number (1-indexed). Defaults to 1."
      },
      "end_line": {
        "type": "integer",
        "description": "Optional ending line number (inclusive). Defaults to total line count."
      }
    }
  }
}
```

#### Tool 2: `insert_content`
Inserts text at a specific line without overwriting existing content.
```json
{
  "name": "insert_content",
  "description": "Inserts a block of LaTeX or Markdown text into the document at a specific line number.",
  "parameters": {
    "type": "object",
    "properties": {
      "target_line": {
        "type": "integer",
        "description": "Line number where insertion should occur (1-indexed)."
      },
      "position": {
        "type": "string",
        "enum": ["before", "after"],
        "description": "Whether to insert before or after target_line."
      },
      "text": {
        "type": "string",
        "description": "The exact text or LaTeX/Markdown block to insert."
      }
    },
    "required": ["target_line", "position", "text"]
  }
}
```

#### Tool 3: `replace_lines`
Replaces a specific line range with updated content (used for section rewrites, math formula fixes, and error corrections).
```json
{
  "name": "replace_lines",
  "description": "Replaces a continuous block of lines with new content.",
  "parameters": {
    "type": "object",
    "properties": {
      "start_line": {
        "type": "integer",
        "description": "The starting line number of the block to replace (1-indexed)."
      },
      "end_line": {
        "type": "integer",
        "description": "The ending line number of the block to replace (inclusive)."
      },
      "new_text": {
        "type": "string",
        "description": "The replacement LaTeX or Markdown text."
      }
    },
    "required": ["start_line", "end_line", "new_text"]
  }
}
```

#### Tool 4: `get_document_outline`
Extracts document structure without dumping thousands of lines of raw text, saving tokens and speeding up navigation.
```json
{
  "name": "get_document_outline",
  "description": "Returns a structural outline of the document (headings #, ##, \\section, \\subsection) with line numbers.",
  "parameters": {
    "type": "object",
    "properties": {}
  }
}
```

---

### 2.3 Editor Buffer Mutation & Undo Safety

When a tool call executes, Dexter Write does not perform crude string concatenation. Instead, it utilizes Monaco Editor's native `ITextModel.pushEditOperations`:

```typescript
// Safe, atomic buffer patch preserving Undo / Redo history
monacoEditor.executeEdits('virtual-mcp-ai', [
  {
    range: new monaco.Range(startLine, 1, endLine, maxColumn),
    text: newText,
    forceMoveMarkers: true,
  }
]);
```

- **Undo History Preserved**: The user can simply press `Ctrl+Z` to revert any AI-initiated modification.
- **Diff Preview Option**: If *Diff Review Mode* is enabled, the patch is directed to a side-by-side modal before applying to the model.

---

## 3. Tier 2: External MCP Client Architecture

Dexter Write includes an in-browser MCP client that allows users to connect external MCP servers:

```
┌────────────────────────────────────────────────────────┐
│               External MCP Server Panel                │
├────────────────────┬──────────────────┬────────────────┤
│    Server Name     │     Endpoint     │     Status     │
├────────────────────┼──────────────────┼────────────────┤
│ GitHub MCP         │ https://.../sse  │  🟢 Connected  │
│ Brave Search MCP   │ https://.../sse  │  🟢 Connected  │
│ Local Repo Server  │ http://localhost │  🟢 Connected  │
└────────────────────┴──────────────────┴────────────────┘
```

### 3.1 Transport Layer
- **SSE (Server-Sent Events)**: Communicates with remote cloud MCP servers or local daemons over HTTP streaming.
- **JSON-RPC 2.0**: Implements the official MCP standard specification for:
  - `initialize`
  - `tools/list`
  - `tools/call`

### 3.2 Real-World Use Cases
1. **GitHub Repository Sync**: The AI queries the GitHub MCP server to read the user's latest commit history and automatically populates their project experience on their resume.
2. **Academic Citations**: The AI queries an arXiv or PubMed MCP server to find paper DOIs and format correct BibTeX / LaTeX citation keys directly into the document.
3. **API Documentation**: The AI queries a local Swagger/OpenAPI or source repository MCP server to generate interactive markdown documentation.

---

## 4. Multi-Provider Protocol Translation

Different LLM providers format tool schemas differently. Dexter Write handles this with an automatic **Provider Adapter**:

```
                 [Virtual MCP Tool Definitions]
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 [Google Gemini Format]                [OpenAI / Claude Format]
 functionDeclarations: [               tools: [{
   {                                     type: "function",
     name: "replace_lines",              function: {
     parameters: { ... }                   name: "replace_lines",
   }                                       parameters: { ... }
 ]                                     }]
```

This ensures that whether a user brings a **Google AI Studio Key**, an **OpenAI API Key**, or connects to **Ollama**, the document tools work seamlessly without code changes.
