import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'designer-editing-ux-e2e';

const initialDoc = {
  version: 13,
  mode: 'image',
  outputs: [{
    id: 'editing-output',
    width: 400,
    height: 400,
    background: '#ffffff',
    children: [{
      id: 'body-copy',
      type: 'text',
      text: 'Hello world',
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
  }],
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page) {
  if (process.env.E2E_SKIP_AUTH_SETUP === '1') {
    await page.context().addCookies([{
      name: 'auth',
      value: 'mocked-designer-e2e',
      url: `${process.env.E2E_BASE || 'http://localhost:4201'}/`,
    }]);
  }
  const state = {
    doc: structuredClone(initialDoc),
    suggestionCalls: 0,
    saveDocs: [] as unknown[],
    renderDocs: [] as unknown[],
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;

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
    if (method === 'GET' && ['/announcements', '/notifications', '/integrations/list', '/brands', '/media/fonts', '/files/folders'].includes(pathname)) {
      return json(route, []);
    }
    if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) {
      return json(route, {});
    }
    if (method === 'GET' && pathname === '/media/tools/status') {
      return json(route, { operations: {}, tools: {} });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}`) {
      return json(route, { id: DESIGN_ID, name: 'Editing UX', doc: state.doc });
    }
    if (method === 'PUT' && pathname === `/media/designs/${DESIGN_ID}`) {
      const body = request.postDataJSON() as { doc?: typeof state.doc };
      if (body.doc) {
        state.saveDocs.push(body.doc);
        state.doc = body.doc;
      }
      return json(route, { id: DESIGN_ID, name: 'Editing UX', doc: state.doc });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/versions`) {
      return json(route, []);
    }
    if (method === 'POST' && pathname === '/media/designs/render') {
      const body = request.postDataJSON() as { doc?: unknown };
      state.renderDocs.push(body.doc);
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==', 'base64'),
      });
    }
    if (method === 'POST' && pathname === '/files/upload-simple') {
      return json(route, { id: 'exported-file', path: '/mock-export/editing.png' }, 201);
    }
    if (method === 'GET' && pathname === '/mock-export/editing.png') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==', 'base64'),
      });
    }
    if (method === 'POST' && pathname === '/media/designer-assistant/suggestions') {
      state.suggestionCalls++;
      return json(route, {
        suggestions: [{
          category: 'color',
          title: 'Use the saved accent',
          rationale: 'This suggestion must survive deselection.',
          style: { fill: '#123456' },
        }],
      });
    }

    const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN;
    if (frontendOrigin && url.origin === 'https://app.postmill.ai' && !pathname.startsWith('/api/')) {
      const frontend = new URL(frontendOrigin);
      if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(frontend.hostname)) {
        throw new Error('E2E_FRONTEND_ORIGIN must be a loopback HTTP origin');
      }
      const headers = { ...request.headers() };
      delete headers.host;
      delete headers['content-length'];
      const response = await fetch(`${frontendOrigin}${pathname}${url.search}`, {
        method,
        headers,
        body: request.postDataBuffer() ?? undefined,
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) {
          responseHeaders[key] = value;
        }
      });
      return route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body: Buffer.from(await response.arrayBuffer()),
      });
    }

    if (url.origin === 'https://api.postmill.ai') {
      return method === 'GET' ? json(route, {}) : json(route, { message: 'Unexpected API mutation blocked' }, 503);
    }
    return route.continue();
  });
  return state;
}

async function openDesigner(page: Page) {
  await page.goto(`/media/designer?designId=${DESIGN_ID}`);
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX', { timeout: 60_000 });
  await expect(page.locator('.konva-stage').first()).toBeVisible({ timeout: 60_000 });
}

async function editText(page: Page) {
  const stage = page.locator('.konva-stage').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const scale = Math.min(box.width / 400, box.height / 400) * 0.85;
  const outputX = (box.width - 400 * scale) / 2;
  const outputY = (box.height - 400 * scale) / 2;
  await stage.dblclick({ position: { x: outputX + 100 * scale, y: outputY + 100 * scale } });
  await expect(page.locator('[data-text-editor-id="body-copy"]')).toBeVisible();
}

async function selectBodyCopy(page: Page) {
  if (await page.getByRole('listbox', { name: 'Layers' }).count() === 0) {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Layers', exact: true }).click();
  }
  const row = page.locator('[data-element-id="body-copy"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText('Text Styles', { exact: true })).toBeVisible();
}

async function editBodyCopyWithPointer(page: Page) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
  const stage = page.locator('.konva-stage').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const scale = Math.min(box.width / 400, box.height / 400) * 0.85;
  const outputX = (box.width - 400 * scale) / 2;
  const outputY = (box.height - 400 * scale) / 2;
  await stage.click({ position: { x: outputX + 10 * scale, y: outputY + 390 * scale } });
  await stage.dblclick({ position: { x: outputX + 230 * scale, y: outputY + 50 * scale } });
  await expect(page.locator('[data-text-editor-id="body-copy"]')).toBeVisible();
}

test('selected words retain independent colors through autosave and reopen', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await editText(page);

  await page.locator('[data-text-editor-id="body-copy"]').evaluate((editor) => {
    const range = document.createRange();
    range.setStart(editor.firstChild!, 6);
    range.setEnd(editor.firstChild!, 11);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const colorInput = page.getByLabel('Text color', { exact: true });
  await colorInput.dispatchEvent('mousedown');
  await colorInput.evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#ff0000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#00ff00');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('textbox', { name: 'Design name' }).click();

  await expect.poll(() => {
    const children = state.doc.outputs[0].children as Array<Record<string, unknown>>;
    return JSON.stringify(children[0]?.richText);
  }).toContain('rgb(0, 255, 0)');
  const children = state.doc.outputs[0].children as Array<Record<string, unknown>>;
  expect(children[0]?.text).toBe('Hello world');
  expect(JSON.stringify(children[0]?.richText)).toContain('Hello ');
  expect(JSON.stringify(children[0]?.richText)).toContain('world');

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX');
  await editText(page);
  await expect(page.locator('[data-text-editor-id="body-copy"]')).toContainText('Hello world');
});

test('text effects remain editable through Paint layers, preview, undo, reopen, and export', async ({ page }) => {
  const state = await installMocks(page);
  const children = state.doc.outputs[0].children as Array<Record<string, unknown>>;
  children.push({
    id: 'empty-paint', type: 'raster', name: 'Paint layer', x: 0, y: 0,
    width: 400, height: 400, rotation: 0, opacity: 1, locked: false, hidden: false,
  });
  await openDesigner(page);
  await editText(page);
  await page.getByRole('textbox', { name: 'Design name' }).click();

  const textEffects = page.getByText('Text Effects', { exact: true }).locator('..');
  for (const name of ['Arc', 'Wave', 'Circle', 'Drop shadow']) {
    await textEffects.getByRole('button', { name, exact: true }).click();
  }
  await expect.poll(() => JSON.stringify(state.doc.outputs[0].children[0])).toContain('textShadow');
  expect(state.doc.outputs[0].children).toHaveLength(2);
  expect(state.doc.outputs[0].children[0].type).toBe('text');
  await editBodyCopyWithPointer(page);
  await page.getByRole('textbox', { name: 'Design name' }).click();

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect.poll(() => state.doc.outputs[0].children[0].textShadow).toBeUndefined();
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await expect.poll(() => state.doc.outputs[0].children[0].textShadow).toBeDefined();
  await selectBodyCopy(page);

  const heading = page.getByRole('button', { name: /H Heading 1/ });
  await heading.hover();
  await expect(page.getByRole('spinbutton', { name: 'Size', exact: true })).toHaveValue('32');
  await page.waitForTimeout(2300);
  expect(state.doc.outputs[0].children[0].fontSize).toBe(32);
  const designName = page.getByRole('textbox', { name: 'Design name' });
  // A rename dirties the real design without cancelling the render-only preview.
  await designName.fill('Editing UX preview save');
  expect(await heading.evaluate((button) => button.matches(':hover'))).toBe(true);
  const savesBeforePreview = state.saveDocs.length;
  await page.keyboard.press('Control+s');
  await expect.poll(() => state.saveDocs.length).toBeGreaterThan(savesBeforePreview);
  expect(JSON.stringify(state.saveDocs.at(-1))).toContain('"fontSize":32');
  expect(JSON.stringify(state.saveDocs.at(-1))).not.toContain('"fontSize":24');
  await designName.fill('Editing UX');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: 'Next: Export 1 file' }).click();
  await page.getByRole('button', { name: 'Export 1 file', exact: true }).click();
  await expect(page.getByRole('link', { name: /\.png$/ })).toBeVisible();
  expect(JSON.stringify(state.renderDocs.at(-1))).toContain('"fontSize":32');
  expect(JSON.stringify(state.renderDocs.at(-1))).not.toContain('"fontSize":24');
  await page.getByText('Close', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Design name' }).hover();
  await expect(page.getByRole('spinbutton', { name: 'Size', exact: true })).toHaveValue('32');
  await heading.click();
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(24);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(32);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(24);

  await expect.poll(() => JSON.stringify(state.saveDocs.at(-1) ?? {})).toContain('"fontSize":24');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX');
  await expect(page.locator('.konva-stage').first()).toBeVisible();
  await selectBodyCopy(page);
  await editBodyCopyWithPointer(page);
  await page.getByRole('textbox', { name: 'Design name' }).click();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: 'Next: Export 1 file' }).click();
  await page.getByRole('button', { name: 'Export 1 file', exact: true }).click();
  await expect(page.getByRole('link', { name: /\.png$/ })).toBeVisible();
  expect(JSON.stringify(state.renderDocs.at(-1))).toContain('textShadow');
  expect(JSON.stringify(state.renderDocs.at(-1))).toContain('textPath');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: /\.png$/ }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
});

test('touchpad mode pans without changing zoom and pinches to zoom', async ({ page }) => {
  await installMocks(page);
  await openDesigner(page);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Touchpad mode' }).click();

  const zoom = page.getByRole('button', { name: 'Zoom out' }).locator('xpath=following-sibling::span[1]');
  const before = await zoom.textContent();
  const stage = page.locator('.konva-stage').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(80, 40);
  await expect(zoom).toHaveText(before || '');

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText(before || '');
});

test('Smart suggestions restore for the same layer without another request', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await editText(page);
  await page.getByRole('button', { name: 'Smart suggestions' }).click();
  await expect(page.getByText('Use the saved accent')).toBeVisible();
  expect(state.suggestionCalls).toBe(1);

  await page.getByRole('textbox', { name: 'Design name' }).click();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await editText(page);
  await expect(page.getByText('Use the saved accent')).toBeVisible();
  expect(state.suggestionCalls).toBe(1);
});
