Dexter Write can start from an empty document, a template, a folder of files, or a GitHub repository. Imports are reviewed before they change the project.

## Import files and backups

Open **Project → Import files or restore a backup**. Supported inputs include:

- Markdown (`.md`, `.markdown`)
- LaTeX (`.tex`)
- Typst (`.typ`)
- Plain text (`.txt`)
- ZIP archives
- PDF text
- DOCX text
- Images (`.png`, `.jpg`, `.jpeg`, `.webp`)
- LaTeX support files such as `.bib`, `.sty`, and `.cls`

The import preview lists every document and image. If a name collides with an existing file, the app shows the renamed target before you commit.

### Merge or replace

- **Merge** adds imported files to the current project and renames collisions.
- **Replace** removes the current documents and assets first.

Replace is destructive. Download a project ZIP before using it.

## Templates

The project hub includes templates for:

- Software engineering resumes
- Academic papers
- Technical documentation

Templates are starting points, not locked formats. Edit the content and structure like any other document. You can also save the current document as a personal template.

## GitHub sync

Open **GitHub** from the activity rail. The panel supports both a fine-grained personal access token and the GitHub device flow.

### Connect

1. Paste a fine-grained token with repository contents read/write access, or configure a GitHub OAuth client ID and use the device flow.
2. Validate the connection.
3. Choose a repository and branch.
4. Clone the repository's text files.

### Import

Cloning imports `.md`, `.tex`, and `.typ` files from the repository. If you clone over an existing project, review the replace prompt before continuing.

### Push

1. Clone a repository first.
2. Make your edits in Dexter Write.
3. Enter a commit message.
4. Push the project files to the selected branch.

The panel shows the commit SHA and progress log. The push writes the project's text files; images are managed separately from the Git workflow.

## Tokens and access

GitHub tokens are stored in the browser's encrypted vault. Use a fine-grained token scoped to the repositories you need, and revoke it when you are done.

For device flow, create a GitHub OAuth App and use its client ID. The token exchange still happens directly between the browser and GitHub.

## Practical rules

- Pull or clone before pushing if someone else may have changed the branch.
- Use a backup ZIP before replacing a project.
- Keep binary images out of the document import review unless you actually need them.
- Check the target branch before pushing.
- Treat repository access tokens like passwords.
