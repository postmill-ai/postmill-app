import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'designer-sharing-e2e';
const TOKEN = 'designer-sharing-client-token';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==', 'base64');

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installSharingMocks(page: Page) {
  const state = {
    share: null as any,
    comments: [] as any[],
    approvedAt: null as string | null,
    approvedBy: null as string | null,
  };
  const metadata = (publicMode: boolean) => ({
    name: 'Client campaign',
    mode: 'image',
    outputs: [{ outputIndex: 0, name: 'Square', width: 1080, height: 1080, pages: [{ pageNumber: 0, name: 'Page 1' }] }],
    commentsEnabled: state.share?.commentsEnabled ?? true,
    expiresAt: publicMode ? state.share?.expiresAt ?? null : null,
    approvedAt: state.approvedAt,
    approvedBy: state.approvedBy,
    comments: state.comments,
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
    if (url.hostname.endsWith('.ingest.us.sentry.io')) return json(route, {});
    if (method === 'GET' && pathname === '/user/self') {
      return json(route, { id: 'e2e-user', email: 'qa@example.test', orgId: 'e2e-org', role: 'owner', isSuperAdmin: true, activated: true, setupCompleted: true, profile: {} });
    }
    if (method === 'GET' && pathname === '/settings/roles/me') return json(route, { role: 'owner', permissions: [], isSuperAdmin: true });
    if (method === 'GET' && pathname === '/user/organizations') return json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
    if (method === 'GET' && ['/announcements', '/notifications', '/integrations/list', '/brands', '/media/fonts', '/files/folders'].includes(pathname)) return json(route, []);
    if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) return json(route, {});
    if (method === 'GET' && pathname === '/media/tools/status') return json(route, { operations: {}, tools: {} });
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}`) {
      return json(route, {
        id: DESIGN_ID,
        name: 'Client campaign',
        doc: {
          version: 14,
          mode: 'image',
          outputs: [{ id: 'output-1', formatId: 'square', name: 'Square', width: 1080, height: 1080, background: '#ffffff', children: [] }],
        },
      });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/versions`) return json(route, []);
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/share`) return json(route, state.share);
    if (method === 'PUT' && pathname === `/media/designs/${DESIGN_ID}/share`) {
      const body = request.postDataJSON();
      state.share = { token: TOKEN, approvedAt: null, approvedBy: null, comments: [], ...body };
      return json(route, state.share);
    }
    if (method === 'DELETE' && pathname === `/media/designs/${DESIGN_ID}/share`) {
      state.share = { ...state.share, enabled: false };
      return json(route, state.share);
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/preview`) return json(route, metadata(false));
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/preview/0/0`) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (method === 'GET' && pathname === `/public/design-share/${TOKEN}`) return json(route, metadata(true));
    if (method === 'GET' && pathname === `/public/design-share/${TOKEN}/preview/0/0`) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (method === 'POST' && pathname === `/public/design-share/${TOKEN}/comments`) {
      const body = request.postDataJSON();
      const comment = { id: `comment-${state.comments.length + 1}`, authorName: body.name, content: body.content, createdAt: new Date().toISOString() };
      state.comments.push(comment);
      return json(route, comment, 201);
    }
    if (method === 'POST' && pathname === `/public/design-share/${TOKEN}/approve`) {
      state.approvedAt = new Date().toISOString();
      state.approvedBy = request.postDataJSON().name;
      return json(route, { approvedAt: state.approvedAt, approvedBy: state.approvedBy });
    }
    if (method === 'POST' && pathname === '/media/designs/render') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (method === 'POST' && pathname === '/files/upload-simple') return json(route, { id: 'preview-file', path: '/preview.png' }, 201);
    if (url.origin === 'https://api.postmill.ai') {
      return method === 'GET' ? json(route, {}) : json(route, { message: 'Unexpected API mutation blocked' }, 503);
    }
    return route.continue();
  });
  return state;
}

test('team view links and account-free client feedback work from Share design', async ({ page }) => {
  const state = await installSharingMocks(page);
  await page.goto(`/media/designer?designId=${DESIGN_ID}`);
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Client campaign', { timeout: 60_000 });
  await page.getByTitle('Enable real-time collaboration').click();
  const dialog = page.getByRole('dialog', { name: 'Share design', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Team link', { exact: true })).toHaveValue(new RegExp(`/media/designer\\?designId=${DESIGN_ID}$`));

  await dialog.getByLabel('Team access', { exact: true }).selectOption('view');
  await expect(dialog.getByLabel('Team link', { exact: true })).toHaveValue(new RegExp(`/media/designer/view\\?designId=${DESIGN_ID}$`));
  await dialog.getByText('Allow client comments', { exact: true }).evaluate((element) => {
    (element.parentElement!.firstElementChild as HTMLElement).click();
  });
  await dialog.getByRole('button', { name: 'Enable client link', exact: true }).click();
  await expect(dialog.getByLabel('Client preview link', { exact: true })).toHaveValue(new RegExp(`/share/design/${TOKEN}$`));
  expect(state.share.commentsEnabled).toBe(true);
  expect(state.share.enabled).toBe(true);

  await page.goto(`/media/designer/view?designId=${DESIGN_ID}`);
  await expect(page.getByRole('heading', { name: 'Client campaign', exact: true })).toBeVisible();
  await expect(page.getByText('View-only design preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Client campaign — Page 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

  await page.goto(`/share/design/${TOKEN}`);
  await page.getByLabel('Your name', { exact: true }).fill('Acme client');
  await page.getByLabel('Leave a comment', { exact: true }).fill('Please use the blue logo');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Please use the blue logo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText(/Approved by Acme client/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});
