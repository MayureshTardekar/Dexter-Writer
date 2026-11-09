The Dexter Write editor is a Monaco workspace with a file tree, document outline, validation, and a live preview. It is designed for multi-file projects, not a single text box.

## Project files

Every project is a tree of documents and images. File paths can contain folders.

```text
paper/
  main.tex
  sections/
    introduction.tex
    results.tex
  figures/
    system.png
  references.bib
```

Use the file tree to select, rename, create, or delete files. **Files → Outline** follows the active document and lets you jump to headings and sections. Use **Files → References** to manage citations.

## Choose the right format

| Format | Best for | Preview and compile |
|---|---|---|
| Markdown (`.md`) | Documentation, notes, README files, resumes | GFM, KaTeX, Mermaid, styled HTML and PDF |
| LaTeX (`.tex`) | Papers, equations, citation-heavy work | Local WASM compiler or configured cloud compiler |
| Typst (`.typ`) | Fast modern typesetting | Native browser compiler |

The toolbar format buttons change the active document mode. Keep the file extension and the mode aligned; a `.tex` file should use LaTeX mode.

## Markdown

Markdown documents support GitHub-flavored Markdown, tables, task lists, footnotes, math, and diagrams.

````markdown
# Results

The measured latency is $42 \pm 3$ ms.

| Run | Latency |
|---|---:|
| cold | 118 ms |
| warm | 42 ms |

```mermaid
flowchart LR
  Draft --> Review --> Publish
```
````

Inline math uses `$...$` and display math uses `$$...$$`. Mermaid blocks render in the preview and export to the styled HTML output.

## LaTeX

LaTeX mode provides syntax highlighting, structure navigation, compile diagnostics, and inverse search where supported.

- The local compiler runs in the browser after a one-time engine download of roughly 120 MB.
- A cloud compiler URL can be configured in **Settings → Workspace → LaTeX compiler**.
- Compile errors appear in the preview pane; use **Fix with AI** to send the failure and surrounding source to the AI pane.
- Referenced project files and images are passed to the compiler with the document.

## Typst

Typst documents compile natively in the browser. Use Typst when you want fast iteration and modern layout control without a TeX installation.

The editor supports `.typ` syntax, outline navigation, compile diagnostics, and PDF export.

## Autosave, history, and undo

The project autosaves locally. **Ctrl/Cmd + S** forces a save. Manual editing uses the editor's normal undo stack.

AI and MCP changes also create snapshots:

- The toolbar **Undo AI** action reverses the most recent applied AI action.
- **History** shows saved document versions and AI snapshots.
- Local MCP applies changes immediately and shows an inline notice with Undo.
- Cloud MCP edits appear in **Settings → Cloud sync → MCP edits and undo** with a per-revision Undo.

Undo is blocked if the target file changed after the AI action, so a newer manual edit is never silently overwritten.

## Images and attachments

Open **Files → Images and attachments**. Uploaded images are stored with the project and can be inserted into Markdown, LaTeX, or Typst.

Images do not travel through a live session automatically. Share a project ZIP with collaborators if they need the image files.

## Validation

**Project → Validate project** checks the active project for common problems such as missing paths or broken references. Validation is read-only; it does not change your files.

## Practical editing tips

- Use the command palette (**Ctrl/Cmd + K**) for files, templates, layout, export, and actions.
- Use **Ctrl/Cmd + F** for find and replace inside the active document.
- Use the split, code, and preview layout buttons to focus on one pane.
- Double-click a pane divider to reset its size.
- Download a project ZIP before a large import, a replace operation, or a risky refactor.
