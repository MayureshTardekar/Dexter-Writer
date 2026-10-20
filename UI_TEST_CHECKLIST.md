# Dexter Write — manual UI acceptance checklist

Use test information first. Download a project backup before replacing your real documents. Record browser, provider, model and any failing step.

## Start and saving

- [ ] Open the app. A first-time workspace shows the project hub and a blank document.
- [ ] Reopen the hub using the left **+** icon or **Project / Import** in the status bar.
- [ ] Create `docs/report.md`. Confirm the folder tree and tab show the right path.
- [ ] Type a heading. Confirm Saving changes to Saved, reload, and verify text and active document survive.
- [ ] Rename/move it to `notes/report.md` using the pencil button. Confirm references and active selection remain sensible.

## AI setup

- [ ] Open AI Settings, choose a provider, enter the key and load available models. Select a model rather than assuming a default exists.
- [ ] Run the model/tool connection test. Confirm errors and unsupported tools are visible.
- [ ] Optionally run the image-input probe. This should send only a test pixel.
- [ ] Try an invalid model/key. Confirm the app preserves work and does not pretend an edit succeeded.

## Jake resume and missing facts

Use this fictional test prompt:

> Create my resume using Jake's template. My name is Priya Raman. I studied BSc Computer Science at Pune University from 2022 to 2026. My skills are Python and SQL. I built a personal library tracker using Python and SQLite. I have no work experience and no measured performance metrics. Ask for other required details or mark them with visible placeholders. Do not invent achievements or contact information.

- [ ] The request creates exactly one new staged `.tex` document and preserves the original document.
- [ ] If the AI asks questions, answer them. Confirm no live edits happen while waiting.
- [ ] Confirm no invented employers, metrics, dates or contact links are introduced.
- [ ] Check that remaining sample data and `[[NEEDS INPUT: ...]]` fields cause visible warnings.
- [ ] Close the sidebar or switch to Files/Outline while a question or proposal is pending, then reopen AI. Confirm work remains in this session.
- [ ] Cancel a question. Confirm that request's staged changes are discarded and live documents remain unchanged.
- [ ] In a separate request, force a provider error after answering, then use Regenerate. Confirm the original task and supplied facts are retained.

## Unified review, conflicts and Undo

- [ ] Ask AI to edit two existing documents and create a cover letter. One review should list all affected files.
- [ ] Reject individual chunks and switch file tabs. Check rendered preview and code diff.
- [ ] Choose Review later, close/reopen AI, and confirm selections/proposal remain.
- [ ] Discard all. Confirm no live file was created or modified.
- [ ] Repeat, then Apply. Confirm only accepted content is applied.
- [ ] Wait for Saved, reload, then Undo AI. Confirm all files and the previous active file are restored.
- [ ] Before Apply, manually change a proposed file's text. Apply should report a conflict and overwrite nothing.
- [ ] Repeat with a rename/move or format change while the text is unchanged. Apply should still report a conflict.
- [ ] After applying a newly created file, rename or edit it. Undo should report a conflict instead of deleting newer work.
- [ ] Reload with an unaccepted proposal only to confirm the documented limitation: pending work is session-only. Apply/reject first when preserving it matters.

## Images in Markdown, LaTeX and Typst

Repeat the applicable steps for all three formats.

- [ ] Upload PNG and JPEG; upload WebP and confirm conversion to PNG.
- [ ] Select an image, change alt text/caption/width/alignment, and insert it.
- [ ] Confirm the image appears, not its raw markup. Check caption, size and alignment.
- [ ] Paste an image into the editor and drop an image onto it. Confirm no AI request is required.
- [ ] For LaTeX, test both an empty file and an existing template. The figure should be in the document body, with `graphicx` available.
- [ ] Test an image in `assets/` referenced from a document in `docs/`. Verify relative paths.
- [ ] Reload. Confirm the image and its dimensions remain available.
- [ ] Rename/move the image. Confirm recognized source references update and preview still works.
- [ ] Delete an image after confirming the dialog. Its references should display/report a missing image.
- [ ] Try an unsupported format or oversized image. Confirm an understandable error with no corruption.

## AI image references and privacy

- [ ] Insert an image with sharing unchecked. Confirm no image is sent to AI.
- [ ] Check Share this image with the selected AI provider, then send a request using a model that accepts images.
- [ ] Confirm the image can be used as reference without being inserted into the document.
- [ ] Send an unrelated new task afterward. Confirm references are not automatically reused without selection.

## Import, backup and exports

- [ ] Import `.md`, `.tex`, `.typ`, `.txt` and a project ZIP. Check the incoming preview before confirming.
- [ ] Import a colliding filename while merging. Check the proposed renamed path and confirm old content remains.
- [ ] Download a backup ZIP containing nested documents and images, then import it and verify references resolve.
- [ ] Test Replace documents only after making a backup. Confirm snapshots exist for replaced documents.
- [ ] Import a PDF and DOCX. Confirm the text-extraction limitation is shown and extracted text is reviewable.
- [ ] Export Markdown HTML. Open it separately: headings/tables should be rendered and embedded project images should appear.
- [ ] Print Markdown PDF while preview is visible and hidden. Confirm images load and the document is printable.
- [ ] Compile/export LaTeX and Typst PDFs with images and nested document paths. Inspect the actual PDF, including captions and page breaks.
- [ ] Export source-only files and project ZIP. Confirm the ZIP contains the image bytes; source-only exports retain relative paths.
- [ ] If using a cloud compiler, deploy the updated server first and test its project-file header/payload support. Confirm an older/unsupported endpoint falls back explicitly.

## Validation and preferences

- [ ] Validate a document with a missing image/include, unfinished fact and broken fence/environment. Confirm issues name the document.
- [ ] Fix the issues and validate again. For LaTeX/Typst, PDF compiled should appear only after a successful compile.
- [ ] Change the document while validation is running. It should require another validation instead of claiming the new version was checked.
- [ ] Put important details in Saved facts/context, choose a writing style, reload/reopen the conversation and verify both are retained.
- [ ] Save a personal template. Confirm it appears in the visual picker and AI template catalog.
- [ ] In a live session, check the local-image warning. Share the ZIP with a collaborator to supply the image files.

## Suggested bug report

```text
Checklist section/step:
Browser:
Provider/model (if relevant):
Document format:
Steps to reproduce:
Expected:
Actual:
Screenshot or exact error:
Did reload change the result?:
```

Automated tests are available as `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e`. They were not fully rerun after the final edits because longer checks were stopped at your request.
