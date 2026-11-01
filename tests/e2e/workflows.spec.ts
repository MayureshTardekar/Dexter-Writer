import { test, expect, type Page } from '@playwright/test';

async function createDocument(page: Page, name = 'docs/report.md') {
  await page.goto('/');
  await page.getByRole('dialog', { name: 'Project start and import' }).waitFor();
  await page.getByLabel('Document name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
}
async function pixel(page: Page) {
  const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4f46e5'; ctx.fillRect(0, 0, 32, 24); return canvas.toDataURL('image/png').split(',')[1]; });
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

test('image upload, nested document insertion, reload and HTML/ZIP exports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await createDocument(page);
  await page.getByRole('button', { name: 'Images and attachments', exact: true }).click();
  await page.getByLabel('Upload images').setInputFiles(await pixel(page));
  await page.getByRole('button', { name: /assets\/photo.png/ }).click();
  await page.getByRole('textbox', { name: 'Alt text' }).fill('Architecture diagram');
  await page.getByRole('button', { name: 'Insert into docs/report.md' }).click();
  await expect(page.locator('.preview-doc img')).toHaveAttribute('alt', 'Architecture diagram');
  await expect.poll(() => page.locator('.preview-doc img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(32);
  await expect(page.locator('.statusbar')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('.preview-doc img')).toHaveAttribute('alt', 'Architecture diagram');
  await expect.poll(() => page.locator('.preview-doc img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(32);
  const download = page.waitForEvent('download');
  await page.getByRole('combobox').filter({ has: page.locator('option[value="html"]') }).selectOption('html');
  expect((await download).suggestedFilename()).toBe('report.html');
  const zip = page.waitForEvent('download');
  await page.getByRole('combobox').filter({ has: page.locator('option[value="zip"]') }).selectOption('zip');
  expect((await zip).suggestedFilename()).toMatch(/project.*\.zip/);
  await page.screenshot({ path: 'test-results/image-workflow.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Escape closes the active dialog, including review, project hub, and asset library', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await createDocument(page);

  await page.getByRole('button', { name: 'Document Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Autonomous Document Review Agent' });
  await expect(review).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review).toBeHidden();

  await page.getByRole('button', { name: 'Project start', exact: true }).click();
  const hub = page.getByRole('dialog', { name: 'Project start and import' });
  await expect(hub).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hub).toBeHidden();

  await page.getByRole('button', { name: 'Images and attachments', exact: true }).click();
  const assets = page.getByRole('dialog', { name: 'Images and attachments' });
  await expect(assets).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(assets).toBeHidden();

  expect(errors).toEqual([]);
});

test('MCP connect wizard exposes one shared AI writer path', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await createDocument(page);
  await page.getByRole('button', { name: 'External MCP', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'MCP server manager' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Connect an AI writer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('One shared local bridge serves every AI client.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Start local bridge|Copy .* config/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('Cloud panel hides developer setup behind a self-host section', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await createDocument(page);
  await page.getByRole('button', { name: 'Cloud sync and remote MCP', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cloud and remote MCP' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Cloud sync is not configured on this deployment')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Read the cloud setup guide' })).toBeVisible();
  await expect(dialog.getByText('VITE_SUPABASE_URL', { exact: false })).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('documentation site navigates, searches, scrolls sections, and opens mobile navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/docs');
  await expect(page).toHaveTitle(/Dexter Write Documentation/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dexter Write Documentation' })).toBeVisible();
  await expect(page.locator('.docs-nav-link')).toHaveCount(14);

  await page.locator('.docs-nav-link').filter({ hasText: 'Writing and the editor' }).click();
  await expect(page.locator('.docs-hero h1')).toHaveText('Writing and the editor');
  await page.locator('.docs-toc nav button').filter({ hasText: 'Autosave, history, and undo' }).click();
  await expect(page).toHaveURL(/#editor\/autosave-history-and-undo$/);
  await expect.poll(() => page.locator('.docs-main').evaluate((element) => element.scrollTop)).toBeGreaterThan(200);

  const search = page.getByLabel('Search documentation');
  await search.fill('MCP');
  await expect(page.locator('.docs-search-result').first()).toContainText('Local MCP bridge');
  await page.locator('.docs-search-result').first().click();
  await expect(page.locator('.docs-hero h1')).toHaveText('Local MCP bridge');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs#editor');
  await expect(page.locator('.docs-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Open documentation navigation' }).click();
  await expect(page.locator('.docs-sidebar')).toBeVisible();
  await expect(page.locator('.docs-nav-scrim')).toBeVisible();
  expect(errors).toEqual([]);
});

test('local import preview preserves existing work and validation finds missing assets', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import project files').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported\n\n![missing](assets/missing.png)') });
  await expect(page.locator('.import-preview')).toContainText('notes.md');
  await page.getByRole('button', { name: 'Import reviewed files' }).click();
  await expect(page.locator('.preview-doc')).toContainText('Imported');
  await expect(page.locator('.missing-image')).toContainText('assets/missing.png');
  await page.getByRole('button', { name: 'Project start' }).click();
  await page.getByRole('button', { name: 'Validate project' }).click();
  await expect(page.locator('.validation-report')).toContainText('Missing project file');
  await page.screenshot({ path: 'test-results/import-validation.png', fullPage: true });
});

test('template tool creates and edits a staged file; sidebar switching, Apply and Undo after reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dexter-write:provider', 'ollama'); localStorage.setItem('dexter-write:model', 'test-model'); localStorage.setItem('dexter-write:baseUrl', 'http://127.0.0.1:9999/v1');
  });
  let round = 0;
  await page.route('http://127.0.0.1:9999/v1/chat/completions', async (route) => {
    const calls = [
      { name: 'create_from_template', arguments: { template: 'Jake', name: 'resume.tex' } },
      { name: 'read_document_content', arguments: {} },
      { name: 'edit_document', arguments: { old_string: 'Your Name', new_string: 'Priya Raman' } },
    ];
    const call = calls[round++];
    const delta = call ? { tool_calls: [{ index: 0, id: `call_${round}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { content: 'Draft ready for review.' };
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n` });
  });
  await createDocument(page, 'original.md');
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await page.getByLabel('AI prompt').fill('Create my resume using Jake. My name is Priya Raman. Use visible placeholders for missing facts.');
  await page.getByLabel('AI prompt').press('Enter');
  const review = page.getByRole('dialog', { name: 'Review AI workspace changes' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Code diff', exact: true }).click();
  await review.getByRole('button', { name: 'Review later' }).click();
  await page.getByRole('button', { name: 'Project Files', exact: true }).click();
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Review 1 file', exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Apply 1 file', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('resume.tex');
  await expect(page.getByRole('button', { name: 'Undo AI', exact: true })).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'Undo AI', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('original.md');
  await expect(page.locator('.filebar')).not.toContainText('resume.tex');
});
