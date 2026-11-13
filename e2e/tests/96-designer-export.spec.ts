import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'designer-export-e2e';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==',
  'base64',
);

const doc = {
  version: 13,
  mode: 'image',
  outputs: ['A', 'B'].map((name, index) => ({
    id: `output-${name.toLowerCase()}`,
    formatId: `ig-export-${index}`,
    name,
    width: 400,
    height: 400,
    background: '#ffffff',
    children: [{
      id: `text-${name.toLowerCase()}`,
      type: 'text',
      text: name,
      x: 40,
      y: 40,
      width: 300,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fontFamily: 'Arial',
      fontSize: 32,
      fill: '#111111',
    }],
  })),
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page) {
  const state = {
    renders: [] as Array<{ format: string; pixelRatio: number; outputs: number }>,
    uploads: 0,
    failSecondUpload: true,
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const isApi = url.pathname.startsWith('/api/');
    const pathname = isApi ? url.pathname.slice(4) : url.pathname;

    if (url.hostname.endsWith('.ingest.us.sentry.io')) return json(route, {});
    if (url.hostname === 'www.gravatar.com') return route.fulfill({ status: 204 });
    if (method === 'GET' && pathname === '/user/self') {
      return json(route, {
        id: 'e2e-user', email: 'qa@example.test', orgId: 'e2e-org', role: 'owner',
        isSuperAdmin: true, activated: true, setupCompleted: true, profile: {},
      });
    }
    if (method === 'GET' && pathname === '/settings/roles/me') {
      return json(route, { role: 'owner', permissions: [], isSuperAdmin: true });
    }
    if (method === 'GET' && pathname === '/user/organizations') {
      return json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
    }
    if (method === 'GET' && [
      '/announcements', '/notifications', '/integrations/list', '/brands', '/media/fonts', '/files/folders',
    ].includes(pathname)) {
      return json(route, []);
    }
    if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) {
      return json(route, {});
    }
    if (method === 'GET' && pathname === '/media/tools/status') {
      return json(route, { operations: {}, tools: {} });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}`) {
      return json(route, { id: DESIGN_ID, name: 'Export reliability', doc });
    }
    if (method === 'PUT' && pathname === `/media/designs/${DESIGN_ID}`) {
      return json(route, { id: DESIGN_ID, name: 'Export reliability', doc });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/versions`) {
      return json(route, []);
    }
    if (method === 'POST' && pathname === '/media/designs/render') {
      const body = request.postDataJSON() as {
        format: string;
        pixelRatio: number;
        doc: { outputs: unknown[] };
      };
      state.renders.push({
        format: body.format,
        pixelRatio: body.pixelRatio,
        outputs: body.doc.outputs.length,
      });
      return route.fulfill({
        status: 200,
        contentType: body.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        body: PNG,
      });
    }
    if (method === 'POST' && pathname === '/files/upload-simple') {
      state.uploads++;
      if (state.uploads === 2 && state.failSecondUpload) {
        state.failSecondUpload = false;
        return json(route, { message: 'Temporary storage rejection' }, 500);
      }
      return json(route, { id: `file-${state.uploads}`, path: `/files/${state.uploads}.jpg` }, 201);
    }

    if (url.origin === 'https://api.postmill.ai' || isApi) {
      return method === 'GET'
        ? json(route, {})
        : json(route, { message: 'Unexpected API mutation blocked' }, 503);
    }
    if (url.origin !== 'http://127.0.0.1:4200') return route.abort('blockedbyclient');
    return route.continue();
  });
  return state;
}

test('production export keeps preview counts, JPEG 3x settings, and completed outputs on retry', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto(`/media/designer?designId=${DESIGN_ID}`);
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Export reliability');
  await expect(page.locator('.konva-stage').first()).toBeVisible();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: '3x', exact: true }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: 'Next: Export 2 files' }).click();

  await expect(page.getByRole('img', { name: 'Output 2' })).toBeVisible();
  await expect.poll(() => state.renders.filter((render) => render.pixelRatio === 0.25)).toHaveLength(2);
  await page.waitForTimeout(300);
  expect(state.renders.filter((render) => render.pixelRatio === 0.25)).toHaveLength(2);

  await page.getByRole('button', { name: 'Export 2 files', exact: true }).click();
  await expect(page.getByText('Some exports need attention')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export reliability - A.jpg' })).toBeVisible();
  expect(state.renders.filter((render) => render.pixelRatio === 3)).toHaveLength(2);
  expect(state.renders.filter((render) => render.pixelRatio === 3).every((render) => render.format === 'jpeg')).toBe(true);
  expect(state.uploads).toBe(2);

  await page.getByRole('button', { name: 'Retry output' }).click();
  await expect(page.getByText('Saved to /files')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export reliability - A.jpg' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export reliability - B.jpg' })).toBeVisible();
  expect(state.uploads).toBe(3);
  expect(state.renders).toHaveLength(4);
});
