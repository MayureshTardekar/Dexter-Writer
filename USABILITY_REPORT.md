# Dexter Write — usability changes and verification handoff

Date: 20 October 2026

Status: implementation changes are in the working tree, uncommitted. Final UI acceptance and a complete final automated run are pending. Long-running checks were stopped at your request.

## What changed

### 1. AI facts, questions and recovery

The earlier Phase 1 work remains: missing-information questions pause the agent, answers retain the original request, cancellation stops that flow, and retry metadata preserves the complete task and answers. Template sample fields and missing-input placeholders produce warnings. Resume writing formulas are optional rather than mandatory.

Added during this pass:

- Saved facts/context and an optional writing style are kept with each conversation.
- The agent prioritizes complete user messages within a context budget, rather than clipping every message to 2,000 characters. It reports omitted history.
- Full source text of new user requests is stored separately from trimmed transcript display text.
- Retry metadata can retain the original document target across tab changes.
- The agent has a validation tool and is instructed to describe staged work as a draft ready for review, rather than claiming a PDF was compiled.

This reduces unwanted claims; it cannot guarantee the factual accuracy of arbitrary model output. Review the supplied facts and warnings.

### 2. Review all proposed files and Undo

The existing combined workspace review is retained. AI document edits, cross-file edits and new files stay staged until accepted.

Completed the remaining review findings in this checkout:

- Closing the AI sidebar, switching to Files/Outline, or changing layout keeps the AI component mounted so pending proposals and questions are retained in the current session.
- Apply and Undo check filenames and document formats as well as content. A renamed or reformatted file is treated as a conflict.
- Undo records retain the previous active file, and Undo restores it when it still exists.
- Persistent Undo records now use a project-scoped IndexedDB store; legacy localStorage records can still be read.
- The workspace takes a snapshot of the base file access at turn start.

Pending proposals/questions are still session state; reloading the entire page does not restore an unaccepted workspace. Accepted-action Undo is persisted.

### 3. Templates through chat

- Added `list_templates` and `create_from_template` tools.
- Template queries such as “Jake” resolve against the catalog. Ambiguous requests return choices.
- Creation stages a new uniquely named file, preserving the current document.
- The newly created template becomes the agent's staged active document so subsequent read/edit tools operate on it.
- The template catalog is included in the prompt; sample fields remain examples, not user facts.
- Added a visual New from template picker and personal template saving.
- Existing destructive template replacement now asks for confirmation and saves a snapshot first.

### 4. Images and reference attachments

Open Images and attachments from the image icon in the activity bar or from Project / Import.

- Upload multiple images; paste or drop images into the editor for direct insertion.
- PNG and JPEG are supported. WebP is converted to PNG for compatibility across formats.
- Images and metadata are stored as Blobs in a project-scoped IndexedDB library, outside localStorage.
- Thumbnail search, rename/move, deletion confirmation and storage usage are available.
- Insertion offers alt text, caption, percentage width and alignment.
- Markdown, LaTeX and Typst each receive the appropriate source syntax and relative path.
- LaTeX insertion adds `graphicx` when needed and creates a basic document around an image inserted into an empty file.
- Image renames update recognized document references and save source snapshots.
- Inserting an image never calls an AI provider.
- A separate unchecked-by-default control authorizes selected images as AI references for the next task. Images are encoded for the existing OpenAI-compatible, Gemini and Anthropic transports.
- AI references are limited to 5 MB per request; uploads are limited to 10 MB and 40 megapixels per image.

Image library contents remain local to this device. Live collaborators need the project ZIP to obtain the image files; images are not automatically synchronized through the existing P2P session.

### 5. Preview, compilers and exports

- Markdown preview resolves project-relative image paths to object URLs and labels missing images.
- LaTeX and Typst compiler calls receive binary image inputs and referenced source files.
- Typst uses the document's real project path and resets shadow files between serialized compiler operations.
- Compiler cache keys include file names and bytes, so equal-sized image replacements invalidate cached output.
- Project ZIP includes nested sources, image bytes and a small manifest recording the active document.
- Markdown HTML export renders the document instead of putting its source in a `<pre>` block. Project images are embedded.
- Markdown PDF/print uses a dedicated printable document and waits for fonts/images, including when the preview pane is hidden.
- Typst PDF export uses the vector compiler.
- Source exports retain relative references. Use project ZIP to carry the referenced image files.
- HTML export is offered for Markdown; LaTeX/Typst users should use PDF or ZIP.
- The baked-in cloud compiler endpoint was removed. Local compilation is the default unless a compiler URL is explicitly configured in project settings or the environment.
- The Lambda and local compiler server source support additional project files, validated paths and payload limits. These server changes have not been deployed.
- A remote compiler that does not confirm project-file support falls back to the local compiler.

### 6. Files, folders and import

- Nested relative project paths are supported by the file tools and UI; traversal outside the project is rejected.
- Files are displayed in a collapsible folder tree.
- Documents can be renamed/moved; recognized references are updated. Changing a filename extension warns that it does not convert the source language.
- Project / Import accepts Markdown, LaTeX, Typst, text, ZIP, PDF text and DOCX text, plus supported image files and text support files.
- Incoming files are previewed before import. Document name collisions show their proposed new names.
- Merge preserves existing work. Replace is an explicit checkbox and saves snapshots before replacing documents.
- ZIP import supports stored and deflated entries, validates checksums, rejects duplicate/unsafe paths and bounds expanded size.
- PDF and DOCX import extract text; they do not reproduce layout or embedded images. Scanned PDFs need OCR, which is not implemented.

### 7. Validation and saving

- Project validation reports unfinished facts, missing project references, basic Markdown fence errors and LaTeX environment mismatches.
- For the active LaTeX/Typst document, the validation action attempts PDF compilation and reports the actual result.
- A document changed during validation is marked as needing validation again.
- The status bar distinguishes Draft, Needs review/attention, Validated and PDF compiled.
- Export warns when draft issues remain rather than hiding them.
- Autosave distinguishes Saving, Saved and Save failed. Failures are visible; Ctrl+S checks its result.
- Project files and active file are saved in one versioned localStorage record. Older flat project records are still read.
- A backup ZIP is available from the project hub and export menu.

### 8. AI setup and starting experience

- Fresh projects begin with a blank document instead of several unrelated sample files.
- A project hub exposes Create document, Import, Templates, Images, Backup, Validate and Edit with AI.
- Removed hardcoded default model IDs. Existing saved selections are retained; new users explicitly select a model.
- AI Settings can load the provider's model list and test the selected connection's tool calling.
- Optional image-input probing sends only a test pixel, never a project image.
- Unsupported editing tools produce an explicit error instead of silently retrying as plain chat.
- The Monaco editor and its worker are loaded from installed app assets rather than its default CDN.

## Verification performed

Follow-up after independent verification: fixed the two remaining test assertions, removed the unnecessary template-literal apostrophe escape, and changed Markdown registration to the actual Monaco 0.56 module (`monaco-editor/languages/definitions/markdown/register.js`). The two affected test suites now pass: **37 tests** in approximately one second. The production build and complete test suite have not been rerun after these fixes, following the request to avoid long commands.

- The previously reviewed baseline passed 236 tests, lint and build.
- During implementation, a completed run passed 237 tests at an intermediate checkpoint.
- After adding workflow regressions, the latest completed full unit run had 248 passing tests and two failures asserting the old hardcoded model defaults. Those expectations were updated for explicit model selection; the final rerun was stopped before completion.
- New workflow unit coverage includes staged Jake creation/editing, ambiguous template selection, rename/format conflicts, image syntax, relative paths, cache invalidation, ZIP round-trip/checksum checks, missing references, HTML rendering, provider image encoding, context budgeting and save failures.
- TypeScript and lint passed at an intermediate checkpoint. Subsequent final edits have not had a complete final check.
- Three Playwright workflows were added for images/reload/export, import/validation, and staged template creation/review/Undo after reload. They have not completed successfully yet.
- Browser validation initially exposed an editor worker import problem; the import was corrected against the installed Monaco package exports.
- Final longer checks were stopped at your request. A stopped check also reported a Node memory error. No live-provider resume quality or real compiler output has been certified in this pass.

## UI handoff and remaining limits

Follow `UI_TEST_CHECKLIST.md` before treating the changes as ready to release.

Important limits:

1. Pending, unaccepted AI work is not recovered after a full page reload.
2. PDF/DOCX import is text extraction; OCR and layout reconstruction are not included.
3. SVG, GIF, HEIC and other image formats are not currently accepted by the image library.
4. Images are not automatically shared through P2P collaboration.
5. Context budgeting preserves selected complete turns and user-maintained facts; automatic model-generated conversation summaries are not implemented.
6. Validation is a practical set of checks, not a complete language parser or proof of factual accuracy. Reference rewriting covers recognized document syntax.
7. Cloud compiler source changes require deployment to an endpoint you control; no external deployment was performed.
8. Provider capabilities and generated output still need testing using your chosen provider/model. A successful capability probe is not a guarantee of writing quality.

No commit or deployment was made.
