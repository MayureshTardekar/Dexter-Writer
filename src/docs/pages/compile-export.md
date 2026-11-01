Dexter Write separates the editor from the preview engine. Markdown renders directly, LaTeX compiles in the browser or through a configured compiler, and Typst compiles natively in the browser.

## Preview modes

| Mode | Engine | Notes |
|---|---|---|
| Markdown | Browser renderer | GFM, tables, task lists, KaTeX, and Mermaid |
| LaTeX | Browser WASM or cloud compiler | First local run downloads the TeX engine |
| Typst | Browser WASM | Fast local compile with PDF output |

Switch preview engines with the active document mode. The toolbar format buttons control the document mode, not just the preview skin.

## LaTeX compile paths

**Local browser compile** is the default when the engine is available. The first run downloads roughly 120 MB of compiler assets, then caches them. This keeps source on the device.

**Cloud compiler** is configured in **Project → LaTeX compiler location**. The current project source and referenced files are sent to that address during compilation. This is useful on low-memory devices or when you do not want a large local download.

Compile diagnostics appear in the preview pane. Use **Fix with AI** to send the failure and nearby source to the AI pane.

## Compile shortcuts

- **Ctrl/Cmd + Enter** recompiles when focus is outside an input.
- **Recompile** in the toolbar triggers the active preview engine.
- Double-click a preview line to attempt inverse search back to the source.

Inverse search depends on the engine and the document. It works best with the local LaTeX path.

## Export formats

Use the **Export** menu in the toolbar.

| Format | Best for |
|---|---|
| PDF | Final delivery, print, and sharing |
| LaTeX `.tex` | Journals, arXiv, and collaborators who use TeX |
| Typst `.typ` | Modern typesetting source |
| Markdown `.md` | Portable text and Git-based workflows |
| Styled HTML | Web publishing with document styling |
| Plain text | Maximum portability |
| Project ZIP | Full backup with documents and images |

Format-specific exports are disabled when the active document is in a different mode. For example, LaTeX source export requires a LaTeX document.

## Printing

**Ctrl/Cmd + P** opens the browser print dialog for the document. Use the PDF export when you need the styled output instead of the browser's print layout.

## Project ZIP backups

The ZIP export is the safest complete backup. It includes:

- Every document
- Image files
- Relative project paths

Keep a ZIP before a large import, a project replace, or a risky multi-file AI change.

## Compile troubleshooting

**A blank preview after compile.** Check the preview pane's diagnostics and confirm the active file is the document root. For LaTeX, the root file usually contains `\documentclass`.

**The first LaTeX compile is slow.** The local engine is downloading. Wait for the download to finish, or configure a cloud compiler.

**Cloud compile fails immediately.** Confirm the compiler URL is reachable over HTTPS and that it accepts the payload shape the app sends. Check the browser network panel for the response.

**Exports look different from the preview.** PDF and HTML use their own layout rules. Review the export before sending it to a publisher.

**Mermaid does not render.** Check the diagram syntax. Invalid Mermaid source fails independently of the rest of the Markdown document.
