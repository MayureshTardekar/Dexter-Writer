import { expect, test, type Page } from '@playwright/test';

const CLOUD = 'https://dexter-test.supabase.co';
const PROJECT = '10000000-0000-0000-0000-000000000001';
const ACCOUNT = { id: '20000000-0000-0000-0000-000000000001', email: 'writer@example.com', user_metadata: { user_name: 'writer' } };
const CLIENT = { id: 'client-1', name: 'Test AI', uri: 'https://example.com' };
const PROJECT_ROW = { id: PROJECT, name: 'Thesis', active_path: 'main.tex', updated_at: '2026-01-01T00:00:00Z' };

async function mockCloud(page: Page, options: { projects?: boolean; approve?: boolean; connected?: boolean; failFirstActivation?: boolean } = {}) {
  const calls: string[] = [];
  const redirectUri = 'http://127.0.0.1:4175/accepted';
  const redirectUrl = `${redirectUri}?code=test-code`;
  let canEdit = false;
  let projectGrant = options.connected ?? false;
  let oauthGrant = projectGrant;
  let approved = false;
  let failActivation = options.failFirstActivation;
  await page.addInitScript((user) => {
    localStorage.setItem('dexter-write:started', '1');
    localStorage.setItem('sb-dexter-test-auth-token', JSON.stringify({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { sessionStorage.setItem('copied-text', text); } },
    });
  }, ACCOUNT);

  await page.route(`${CLOUD}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.endsWith('/is_allowed_user')) return route.fulfill({ json: true, headers });
    if (path === '/rest/v1/projects') return route.fulfill({ json: options.projects === false ? [] : [PROJECT_ROW], headers });
    if (path === '/rest/v1/revisions') return route.fulfill({ json: [], headers });
    if (path === '/auth/v1/oauth/authorizations/test-request') {
      if (approved) {
        return route.fulfill({ status: 400, json: { msg: 'authorization request cannot be processed' }, headers });
      }
      return route.fulfill({
        json: { authorization_id: 'test-request', client: CLIENT, user: ACCOUNT, scope: 'openid email', redirect_uri: 'http://127.0.0.1:4175/accepted' },
        headers,
      });
    }
    if (path.endsWith('/prepare_mcp_project_grant')) {
      calls.push('prepare');
      expect(request.postDataJSON()).toEqual({
        p_client_id: CLIENT.id, p_project_id: PROJECT, p_can_edit: false, p_authorization_id: 'test-request',
      });
      return route.fulfill({ json: true, headers });
    }
    if (path.endsWith('/test-request/consent')) {
      calls.push(request.postDataJSON().action);
      if (options.approve === false) {
        return route.fulfill({ status: 400, json: { msg: 'Approval expired.' }, headers });
      }
      approved = true;
      return route.fulfill({ json: { redirect_url: redirectUrl }, headers });
    }
    if (path.endsWith('/activate_mcp_project_grant')) {
      calls.push('activate');
      expect(request.postDataJSON()).toEqual({ p_authorization_id: 'test-request' });
      if (failActivation) {
        failActivation = false;
        return route.fulfill({ status: 500, json: { message: 'Project access could not be saved.' }, headers });
      }
      return route.fulfill({ json: [{ redirect_uri: redirectUri, authorization_code: 'test-code', oauth_state: null }], headers });
    }
    if (path === '/auth/v1/user/oauth/grants') {
      if (method === 'DELETE') {
        calls.push('revoke-oauth');
        oauthGrant = false;
        return route.fulfill({ status: 204, headers });
      }
      return route.fulfill({
        json: oauthGrant ? [{ client: CLIENT, scopes: ['openid', 'email'], granted_at: '2026-01-01T00:00:00Z' }] : [],
        headers,
      });
    }
    if (path === '/rest/v1/mcp_project_grants') {
      if (method === 'DELETE') {
        const authorization = new URL(request.url()).searchParams.get('pending_authorization_id');
        calls.push(authorization === 'eq.test-request' ? 'discard-pending' : 'remove-project-grant');
        projectGrant = false;
        return route.fulfill({ status: 204, headers });
      }
      if (method === 'PATCH') {
        canEdit = request.postDataJSON().can_edit;
        calls.push('toggle-edit');
        return route.fulfill({ json: { client_id: CLIENT.id }, headers });
      }
      return route.fulfill({
        json: projectGrant ? [{ client_id: CLIENT.id, project_id: PROJECT, can_edit: canEdit, activated_at: '2026-01-01T00:00:00Z' }] : [],
        headers,
      });
    }
    throw new Error(`Unexpected cloud request ${method} ${path}`);
  });
  return calls;
}

test('Connections owns hosted setup, advanced paths and permission management', async ({ page }) => {
  const calls = await mockCloud(page, { connected: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('region', { name: 'Settings' }).getByRole('button', { name: 'Connections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connections' });
  await expect(dialog.getByRole('heading', { name: 'Connect an AI client' })).toBeVisible();
  await expect(dialog.getByText('Read only', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy connector URL' }).click();
  await expect(dialog.getByRole('status')).toContainText('Connector URL copied');
  expect(await page.evaluate(() => sessionStorage.getItem('copied-text'))).toBe(`${CLOUD}/functions/v1/mcp`);

  await dialog.getByRole('checkbox', { name: 'Allow edits to project files' }).click();
  await expect(dialog.getByText('Can edit', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke access' }).click();
  await dialog.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(dialog.getByText('No AI clients authorized yet.')).toBeVisible();
  expect(calls).toEqual(['toggle-edit', 'remove-project-grant', 'revoke-oauth']);

  await dialog.getByRole('button', { name: 'Local bridge', exact: true }).click();
  await expect(dialog.getByText('Advanced setup', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Custom servers' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Server URL' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cloud project', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sync this project' }).click();
  const cloud = page.getByRole('dialog', { name: 'Cloud sync' });
  await expect(cloud).toBeVisible();
  await expect(cloud.getByRole('button', { name: 'Copy connector URL' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('consent chooses a project and activates access only after approval', async ({ page }) => {
  const calls = await mockCloud(page);
  await page.route('**/accepted?*', (route) => route.fulfill({ body: 'Authorized' }));
  await page.goto('/oauth/consent?authorization_id=test-request');
  await expect(page.getByText('Identity scopes', { exact: true })).toBeVisible();
  await expect(page.getByText(/Dexter project permissions separately control database access/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dexter project access' })).toBeVisible();
  await expect(page.getByText(/stage edits|review every change/i)).toHaveCount(0);
  const approve = page.getByRole('button', { name: 'Approve connection' });
  await expect(approve).toBeDisabled();
  await page.getByLabel('Cloud project', { exact: true }).selectOption(PROJECT);
  await expect(page.getByRole('checkbox', { name: 'Allow edits to project files' })).not.toBeChecked();
  await approve.click();
  await expect(page).toHaveURL(/\/accepted\?code=test-code$/);
  expect(calls).toEqual(['prepare', 'approve', 'activate']);
});

test('approved OAuth can finish project access after an activation failure and reload', async ({ page }) => {
  const calls = await mockCloud(page, { failFirstActivation: true });
  await page.route('**/accepted?*', (route) => route.fulfill({ body: 'Authorized' }));
  await page.goto('/oauth/consent?authorization_id=test-request');
  await page.getByLabel('Cloud project', { exact: true }).selectOption(PROJECT);
  await page.getByRole('button', { name: 'Approve connection' }).click();
  await expect(page.getByRole('alert')).toContainText('Project access could not be saved');
  await expect(page.getByRole('button', { name: 'Finish connection' })).toBeEnabled();
  expect(calls).toEqual(['prepare', 'approve', 'activate']);
  await page.reload();
  await expect(page).toHaveURL(/\/accepted\?code=test-code$/);
  expect(calls).toEqual(['prepare', 'approve', 'activate', 'activate']);
});

test('failed authorization removes only the pending request and can be retried', async ({ page }) => {
  const calls = await mockCloud(page, { approve: false });
  await page.goto('/oauth/consent?authorization_id=test-request');
  await page.getByLabel('Cloud project', { exact: true }).selectOption(PROJECT);
  await page.getByRole('button', { name: 'Approve connection' }).click();
  await expect(page.getByRole('alert')).toContainText('Approval expired');
  await expect(page.getByRole('button', { name: 'Approve connection' })).toBeEnabled();
  expect(calls).toEqual(['prepare', 'approve', 'discard-pending']);
});

test('consent offers cloud sync when no project is available', async ({ page }) => {
  const calls = await mockCloud(page, { projects: false });
  await page.goto('/oauth/consent?authorization_id=test-request');
  await expect(page.getByRole('button', { name: 'Approve connection' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Sync this project' })).toHaveAttribute('href', '/?cloud-sync=1');
  expect(calls).toEqual([]);
});
