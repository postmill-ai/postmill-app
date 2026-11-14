import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'designer-editing-ux-e2e';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==';

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
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      fontFamily: 'Arial',
      fontSize: 32,
      fill: '#111111',
    }, {
      id: 'drop-target',
      type: 'image',
      src: PNG_DATA_URL,
      fileId: 'old-image-file',
      x: 40,
      y: 200,
      width: 160,
      height: 120,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      naturalWidth: 1,
      naturalHeight: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fitMode: 'cover',
      focalPoint: { x: 0.25, y: 0.75 },
    }],
  }],
};

const initialVideoDoc = {
  version: 13,
  mode: 'video',
  outputs: [{
    id: 'editing-video-output',
    width: 400,
    height: 400,
    durationMs: 5000,
    tracks: [{
      id: 'video-track',
      type: 'video',
      clips: [{
        id: 'video-clip', startMs: 0, endMs: 5000, src: '/video.mp4', mediaType: 'video',
        x: 220, y: 40, width: 140, height: 100, opacity: 1,
      }],
    }, {
      id: 'image-track',
      type: 'image',
      clips: [{
        id: 'still-clip', startMs: 0, endMs: 5000, src: PNG_DATA_URL, mediaType: 'image',
        fileId: 'old-still-file', x: 40, y: 200, width: 160, height: 120, opacity: 1,
        naturalWidth: 1, naturalHeight: 1,
        crop: { x: 0, y: 0, width: 1, height: 1 }, fitMode: 'cover', focalPoint: { x: 0.25, y: 0.75 },
      }],
    }],
  }],
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page, doc: any = initialDoc) {
  if (process.env.E2E_SKIP_AUTH_SETUP === '1') {
    await page.context().addCookies([{
      name: 'auth',
      value: 'mocked-designer-e2e',
      url: `${process.env.E2E_BASE || 'http://localhost:4201'}/`,
    }]);
  }
  const state = {
    doc: structuredClone(doc),
    suggestionCalls: 0,
    saveDocs: [] as unknown[],
    renderDocs: [] as unknown[],
    generationCalls: 0,
    uploads: 0,
    uploadPath: PNG_DATA_URL,
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
      return json(route, { operations: {}, tools: { 'text-to-image': { available: true } } });
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
      if (request.postDataBuffer()?.includes(Buffer.from('design-preview'))) {
        return json(route, { id: 'design-preview-file', path: PNG_DATA_URL }, 201);
      }
      state.uploads++;
      return json(route, { id: `dropped-file-${state.uploads}`, path: state.uploadPath });
    }
    if (method === 'POST' && pathname === '/media/generate-image-with-prompt') {
      state.generationCalls++;
      return json(route, {
        id: 'paid-generation', path: PNG_DATA_URL, name: 'Paid generation result',
      });
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
  await stage.dblclick({ position: { x: outputX + 100 * scale, y: outputY + 60 * scale } });
  await expect(page.locator('[data-text-editor-id="body-copy"]')).toBeVisible();
}

async function selectBodyCopy(page: Page) {
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  const row = page.locator('[data-element-id="body-copy"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText('Text Styles', { exact: true })).toBeVisible();
}

async function editBodyCopyWithPointer(page: Page) {
  const layersPanel = page.getByRole('dialog', { name: 'Layers', exact: true });
  if (await layersPanel.count()) {
    await layersPanel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(layersPanel).toHaveCount(0);
  }
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
  expect(state.doc.outputs[0].children).toHaveLength(3);
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

async function dragImageFile(
  page: Page,
  x: number,
  y: number,
  options: {
    altKey?: boolean;
    eventName?: 'dragover' | 'drop';
    type?: string;
    contents?: string;
  } = {}
) {
  const stage = page.locator('.konva-stage').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const scale = Math.min(box.width / 400, box.height / 400) * 0.85;
  const outputX = (box.width - 400 * scale) / 2;
  const outputY = (box.height - 400 * scale) / 2;
  const clientX = box.x + outputX + x * scale;
  const clientY = box.y + outputY + y * scale;
  await page.getByRole('application', { name: 'Design canvas' }).evaluate((container, point) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([point.contents], 'replacement', { type: point.type }));
    container.dispatchEvent(new DragEvent(point.eventName, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: point.clientX,
      clientY: point.clientY,
      altKey: point.altKey,
    }));
  }, {
    clientX,
    clientY,
    altKey: !!options.altKey,
    eventName: options.eventName || 'drop',
    type: options.type || 'image/png',
    contents: options.contents || 'replacement',
  });
}

async function dropPng(page: Page, x: number, y: number, altKey = false) {
  await dragImageFile(page, x, y, { altKey });
}

test('desktop workspace tabs switch the visible panel and keep View display-only', async ({ page }) => {
  await installMocks(page);
  await openDesigner(page);
  await expect(page.locator('[data-workspace-panel="inspector"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Versions', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Browse templates', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await expect(page.locator('[data-workspace-panel="layers"]')).toBeVisible();
  await expect(page.locator('[data-workspace-panel="brand"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Brand', exact: true }).click();
  await expect(page.locator('[data-workspace-panel="brand"]')).toBeVisible();
  await expect(page.locator('[data-workspace-panel="layers"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.locator('[data-workspace-panel="ai"]')).toBeVisible();
  await expect(page.locator('[data-workspace-panel="brand"]')).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Layers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'History', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const panel = page.locator('[data-workspace-panel="ai"]');
  const dark = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => {
    document.querySelectorAll('.dark').forEach((element) => element.classList.remove('dark'));
    document.body.classList.add('light');
  });
  const light = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(light).not.toBe(dark);

  await page.evaluate(() => { document.dir = 'rtl'; });
  const rtl = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { panelLeft: rect.left, parentLeft: element.parentElement!.getBoundingClientRect().left };
  });
  expect(Math.abs(rtl.panelLeft - rtl.parentLeft)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  const expand = page.getByRole('button', { name: 'Expand properties panel', exact: true });
  await expect(expand).toHaveClass(/rounded-s-md/);
  const arrowRotation = await expand.locator('span').evaluate((element) =>
    getComputedStyle(element).rotate
  );
  expect(arrowRotation).toBe('180deg');
});

test('Layers selection stays sticky and desktop workspace preferences survive reload', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.locator('[data-element-id="body-copy"]').click();
  await expect(page.locator('[data-workspace-panel="layers"]')).toBeVisible();
  await page.locator('[data-element-id="drop-target"]').click({ modifiers: ['Control'] });
  await expect(page.locator('[data-element-id="body-copy"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-element-id="drop-target"]')).toHaveAttribute('aria-selected', 'true');

  await page.locator('[data-element-id="body-copy"]').dblclick();
  const rename = page.locator('[data-element-id="body-copy"] input');
  await expect(rename).toBeVisible();
  await rename.fill('Renamed body copy');
  await rename.press('Enter');
  await expect(rename).toHaveCount(0);
  await expect(page.locator('[data-workspace-panel="layers"]')).toBeVisible();
  await expect.poll(() => state.doc.outputs[0].children[0].name).toBe('Renamed body copy');

  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('designer-workspace-panel-e2e-org') || '{}').activeTab
  )).toBe('ai');
  await page.reload();
  await expect(page.locator('[data-workspace-panel="ai"]')).toBeVisible();

  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('designer-workspace-panel-e2e-org') || '{}').collapsed
  )).toBe(true);
  await page.reload();
  await expect(page.locator('[data-workspace-panel="ai"]')).toBeHidden();
  await page.getByRole('button', { name: 'Expand properties panel', exact: true }).click();
  await expect(page.locator('[data-workspace-panel="ai"]')).toBeVisible();
});

test('AI results survive tab and collapse changes without another request', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByPlaceholder('Describe the image...').fill('A non-paid mocked result');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByAltText('Paid generation result')).toBeVisible();
  expect(state.generationCalls).toBe(1);

  await page.getByRole('tab', { name: 'Brand', exact: true }).click();
  await expect(page.getByAltText('Paid generation result')).toBeHidden();
  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await page.getByRole('button', { name: 'Expand properties panel', exact: true }).click();
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(page.getByAltText('Paid generation result')).toBeVisible();
  expect(state.generationCalls).toBe(1);
});

test('mobile keeps Inspector and Brand in sheets instead of desktop tabs', async ({ page }) => {
  await installMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesigner(page);
  await expect(page.getByRole('region', { name: 'Canvas', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Canvas', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Layers', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Brand', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Brand', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Brand', exact: true })
    .getByRole('button', { name: 'Collapse panel', exact: true }).click();

  await page.getByRole('menuitem', { name: 'More menus', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Layers', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'More menus', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Layers', exact: true })).toHaveCount(0);
});

test('font-size shortcuts respect selection, text focus, bounds and help', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await editText(page);
  await page.locator('[data-text-editor-id="body-copy"]').press('Escape');
  await page.getByRole('application', { name: 'Design canvas' }).press('Control+Shift+>');
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(33);
  await expect.poll(() => state.doc.outputs[0].children[0].height).toBe(40);

  await page.getByRole('textbox', { name: 'Design name' }).press('Control+Shift+>');
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(state.doc.outputs[0].children[0].fontSize).toBe(33);
  await page.getByRole('application', { name: 'Design canvas' }).evaluate((canvas) => {
    canvas.dispatchEvent(new KeyboardEvent('keydown', {
      key: '<', code: 'IntlBackslash', ctrlKey: true, shiftKey: false,
      bubbles: true, cancelable: true,
    }));
  });
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(32);
  await page.getByRole('application', { name: 'Design canvas' }).evaluate((canvas) => {
    canvas.dispatchEvent(new KeyboardEvent('keydown', {
      key: '.', code: 'Period', ctrlKey: true, shiftKey: true,
      bubbles: true, cancelable: true,
    }));
  });
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(33);
  await page.getByRole('application', { name: 'Design canvas' }).press('Control+Shift+<');
  await expect.poll(() => state.doc.outputs[0].children[0].fontSize).toBe(32);

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: /Keyboard Shortcuts/ }).click();
  await expect(page.getByText('Increase font size', { exact: true })).toBeVisible();
  await expect(page.getByText('Decrease font size', { exact: true })).toBeVisible();
});

test('ordinary drops insert while Alt-drop shows Replace and replaces once', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await dropPng(page, 120, 260);
  await expect.poll(() => state.uploads).toBe(1);
  await expect.poll(() => state.doc.outputs[0].children.length).toBe(3);
  expect(state.doc.outputs[0].children[1].fileId).toBe('old-image-file');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect.poll(() => state.doc.outputs[0].children.length).toBe(2);

  await dragImageFile(page, 120, 260, { eventName: 'dragover', altKey: true });
  await expect(page.locator('[data-drop-mode="replace"]')).toHaveText('Replace image…');
  await dropPng(page, 120, 260, true);
  await expect.poll(() => state.uploads).toBe(2);
  await expect.poll(() => state.doc.outputs[0].children[1].fileId).toBe('dropped-file-2');
  expect(state.doc.outputs[0].children[1]).toMatchObject({
    x: 40, y: 200, width: 160, height: 120,
    naturalWidth: 1, naturalHeight: 1,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fitMode: 'cover', focalPoint: { x: 0.25, y: 0.75 },
  });

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect.poll(() => state.doc.outputs[0].children[1].fileId).toBe('old-image-file');
  await dropPng(page, 350, 350);
  await expect.poll(() => state.uploads).toBe(3);
  await expect.poll(() => state.doc.outputs[0].children.length).toBe(3);
  expect(state.doc.outputs[0].children[1].fileId).toBe('old-image-file');
});

test('Alt-drop replaces a still clip but never a video clip', async ({ page }) => {
  const state = await installMocks(page, initialVideoDoc);
  await openDesigner(page);
  await dropPng(page, 120, 260, true);
  await expect.poll(() => state.uploads).toBe(1);
  await expect.poll(() => state.doc.outputs[0].tracks[1].clips[0].fileId).toBe('dropped-file-1');
  expect(state.doc.outputs[0].tracks[1].clips[0]).toMatchObject({
    x: 40, y: 200, width: 160, height: 120,
    naturalWidth: 1, naturalHeight: 1,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fitMode: 'cover', focalPoint: { x: 0.25, y: 0.75 },
  });

  await dropPng(page, 290, 90, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(state.uploads).toBe(1);
  expect(state.doc.outputs[0].tracks[0].clips[0].src).toBe('/video.mp4');

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect.poll(() => state.doc.outputs[0].tracks[1].clips[0].fileId).toBe('old-still-file');
});

test('Alt-drop does not modify a locked target', async ({ page }) => {
  const doc = structuredClone(initialDoc);
  doc.outputs[0].children[1].locked = true;
  const state = await installMocks(page, doc);
  await openDesigner(page);
  await dropPng(page, 120, 260, true);

  await expect.poll(() => state.uploads).toBe(1);
  await expect.poll(() => state.doc.outputs[0].children.length).toBe(3);
  expect(state.doc.outputs[0].children[1]).toMatchObject({
    fileId: 'old-image-file', locked: true,
  });
});

test('Alt-drop over an image retains editable SVG import routing', async ({ page }) => {
  const state = await installMocks(page);
  await openDesigner(page);
  await dragImageFile(page, 120, 260, {
    altKey: true,
    type: 'image/svg+xml',
    contents: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/></svg>',
  });

  await expect.poll(() => state.doc.outputs[0].children.length).toBe(3);
  expect(state.uploads).toBe(0);
  expect(state.doc.outputs[0].children[1].fileId).toBe('old-image-file');
  expect(state.doc.outputs[0].children[2].type).toBe('path');
});

test('an undecodable Alt-drop keeps the old target and reports decode failure', async ({ page }) => {
  const state = await installMocks(page);
  state.uploadPath = '/broken-image.png';
  await openDesigner(page);
  await dropPng(page, 120, 260, true);

  await expect.poll(() => state.uploads).toBe(1);
  await expect(page.getByText('Failed to load dropped image', { exact: true })).toBeVisible();
  expect(state.doc.outputs[0].children).toHaveLength(2);
  expect(state.doc.outputs[0].children[1].fileId).toBe('old-image-file');
});
