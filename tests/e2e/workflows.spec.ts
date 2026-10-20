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
