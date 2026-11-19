import { test, expect, type Page, type Route, type Locator } from '@playwright/test';

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

const VIDEO_DESIGN_ID = 'designer-edit-as-video-e2e';
const editAsVideoSourceDoc = {
  version: 14,
  mode: 'image',
  outputs: [{
    id: 'burger-square', formatId: 'custom-square', name: 'Burger Square', width: 400, height: 400,
    background: '#ffffff',
    children: [
      { id: 'burger-bg', type: 'shape', shape: 'rect', fill: '#fff3d6', x: 0, y: 0, width: 400, height: 400, rotation: 0, opacity: 1, locked: false, hidden: false },
      { id: 'burger-photo', type: 'image', src: PNG_DATA_URL, x: 70, y: 50, width: 260, height: 180, rotation: 0, opacity: 1, locked: false, hidden: false },
      { id: 'burger-icon', type: 'icon', src: PNG_DATA_URL, x: 20, y: 20, width: 32, height: 32, rotation: 0, opacity: 1, locked: false, hidden: false },
      { id: 'burger-copy', type: 'text', text: 'BURGER NIGHT', x: 40, y: 260, width: 320, height: 60, rotation: 0, opacity: 1, locked: false, hidden: false, fontFamily: 'Arial', fontSize: 32 },
      { id: 'burger-hidden', type: 'text', text: 'Hidden note', x: 40, y: 330, width: 200, height: 30, rotation: 0, opacity: 1, locked: false, hidden: true },
    ],
    pages: [{ id: 'burger-page-two', name: 'Details', children: [{
      id: 'burger-details', type: 'text', text: 'Friday at 7', x: 50, y: 160, width: 300, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, fontFamily: 'Arial', fontSize: 28,
    }] }],
  }, {
    id: 'burger-wide', formatId: 'custom-wide', name: 'Burger Wide', width: 600, height: 400,
    background: '#fff3d6',
    children: [{ id: 'burger-wide-copy', type: 'text', text: 'BURGER NIGHT', x: 40, y: 160, width: 500, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, fontFamily: 'Arial', fontSize: 36 }],
  }],
};
const editAsVideoConvertedDoc = {
  version: 14,
  mode: 'video',
  outputs: [{
    id: 'burger-square', formatId: 'custom-square', name: 'Burger Square', width: 400, height: 400,
    fps: 30, durationMs: 4000, bg: { type: 'color', color: '#fff3d6' },
    markers: [{ id: 'scene-1', tMs: 0, name: 'Page 1' }, { id: 'scene-2', tMs: 2000, name: 'Details' }],
    tracks: [
      { id: 'burger-image-track', type: 'image', clips: [{ id: 'burger-photo-clip', originId: 'burger-photo', startMs: 0, endMs: 2000, src: PNG_DATA_URL, x: 70, y: 50, width: 260, height: 180 }] },
      { id: 'burger-raster-track', type: 'raster', clips: [{ id: 'burger-icon-clip', originId: 'burger-icon', startMs: 0, endMs: 2000, src: PNG_DATA_URL, fileId: 'internal-icon', x: 0, y: 0, width: 400, height: 400 }] },
      { id: 'burger-text-track', type: 'text', clips: [
        { id: 'burger-copy-clip', originId: 'burger-copy', startMs: 0, endMs: 2000, text: 'BURGER NIGHT', x: 40, y: 260, width: 320, height: 60, fontFamily: 'Arial', fontSize: 32 },
        { id: 'burger-details-clip', startMs: 2000, endMs: 4000, text: 'Friday at 7', x: 50, y: 160, width: 300, height: 60, fontFamily: 'Arial', fontSize: 28 },
      ] },
      { id: 'burger-hidden-track', type: 'text', hidden: true, clips: [{ id: 'burger-hidden-clip', originId: 'burger-hidden', startMs: 0, endMs: 2000, text: 'Hidden note', x: 40, y: 330, width: 200, height: 30 }] },
    ],
  }, {
    id: 'burger-wide', formatId: 'custom-wide', name: 'Burger Wide', width: 600, height: 400,
    fps: 30, durationMs: 2000, bg: { type: 'color', color: '#fff3d6' },
    markers: [{ id: 'wide-scene-1', tMs: 0, name: 'Page 1' }],
    tracks: [{ id: 'burger-wide-text-track', type: 'text', clips: [{ id: 'burger-wide-copy-clip', originId: 'burger-wide-copy', startMs: 0, endMs: 2000, text: 'BURGER NIGHT', x: 40, y: 160, width: 500, height: 60, fontFamily: 'Arial', fontSize: 36 }] }],
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
    videoDoc: null as any,
    videoName: 'Editing UX — Video',
    conversionCalls: [] as Array<{ pageDurationMs: number; idempotencyKey?: string }>,
    videoSaveDocs: [] as unknown[],
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
    if (method === 'POST' && pathname === `/media/designs/${DESIGN_ID}/convert-to-video`) {
      const body = request.postDataJSON() as { pageDurationMs: number };
      state.conversionCalls.push({
        pageDurationMs: body.pageDurationMs,
        idempotencyKey: request.headers()['x-idempotency-key'],
      });
      state.videoDoc = structuredClone(editAsVideoConvertedDoc);
      return json(route, {
        design: { id: VIDEO_DESIGN_ID, name: state.videoName, doc: state.videoDoc },
        summary: {
          outputs: [
            {
              outputId: 'burger-square', name: 'Burger Square', pageCount: 2,
              pageDurationMs: 2000, durationMs: 4000, hiddenLayerCount: 1,
              fallbacks: [{ outputId: 'burger-square', pageNumber: 0, sourceIds: ['burger-icon'], sourceTypes: ['icon'], reason: 'icon layers have no editable clip counterpart' }],
            },
            {
              outputId: 'burger-wide', name: 'Burger Wide', pageCount: 1,
              pageDurationMs: 2000, durationMs: 2000, hiddenLayerCount: 0, fallbacks: [],
            },
          ],
          totalPages: 3,
          totalFallbacks: 1,
        },
      }, 201);
    }
    if (method === 'GET' && pathname === `/media/designs/${VIDEO_DESIGN_ID}`) {
      return state.videoDoc
        ? json(route, { id: VIDEO_DESIGN_ID, name: state.videoName, doc: state.videoDoc })
        : json(route, { message: 'Video design not created' }, 404);
    }
    if (method === 'PUT' && pathname === `/media/designs/${VIDEO_DESIGN_ID}`) {
      const body = request.postDataJSON() as { doc?: any; name?: string };
      if (body.doc) {
        state.videoDoc = body.doc;
        state.videoSaveDocs.push(body.doc);
      }
      if (body.name) state.videoName = body.name;
      return json(route, { id: VIDEO_DESIGN_ID, name: state.videoName, doc: state.videoDoc });
    }
    if (method === 'GET' && pathname === `/media/designs/${VIDEO_DESIGN_ID}/versions`) {
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
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
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

test('Edit as Video preserves the source and opens a timed editable design through resize and reload', async ({ page }) => {
  const originalSource = structuredClone(editAsVideoSourceDoc);
  const state = await installMocks(page, editAsVideoSourceDoc);
  await openDesigner(page);

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Format ▶', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Edit as Video', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Page duration (seconds)' }).fill('2');
  await page.getByRole('button', { name: 'Create video design' }).click();

  await expect(page.getByText('Your video design is ready')).toBeVisible();
  await expect(page.getByText('3 scenes across 2 variants. The original static design remains separate.')).toBeVisible();
  await expect(page.getByText(/Scene 1: icon rasterized/)).toBeVisible();
  expect(state.conversionCalls).toEqual([{ pageDurationMs: 2000, idempotencyKey: expect.any(String) }]);
  expect(state.doc).toEqual(originalSource);
  expect(state.saveDocs).toHaveLength(0);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX — Video');
  await expect(page).toHaveURL(new RegExp(`designId=${VIDEO_DESIGN_ID}`));
  await expect(page.locator('.konva-stage').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add format', exact: true }).click();
  await page.getByRole('checkbox', { name: /Instagram Reel \(Video\)/ }).check();
  await page.getByRole('button', { name: 'Add 1 format', exact: true }).click();
  await expect.poll(() => state.videoSaveDocs.length).toBeGreaterThan(0);
  const savedVideo = state.videoSaveDocs.at(-1) as any;
  expect(savedVideo.outputs).toHaveLength(3);
  const resized = savedVideo.outputs[2];
  expect(resized.width).toBe(1080);
  expect(resized.height).toBe(1920);
  expect(resized.durationMs).toBe(4000);
  expect(resized.tracks.flatMap((track: any) => track.clips).map((clip: any) => [clip.startMs, clip.endMs])).toEqual([
    [0, 2000], [0, 2000], [0, 2000], [2000, 4000], [0, 2000],
  ]);

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX — Video', { timeout: 60_000 });
  await expect(page.locator('.konva-stage').first()).toBeVisible({ timeout: 60_000 });
  expect(state.videoDoc.outputs).toHaveLength(3);
  expect(state.doc).toEqual(originalSource);
  expect(state.saveDocs).toHaveLength(0);
});

test('shape insertion stays on an independent format through save, reload, and export', async ({ page }) => {
  const independentDoc = structuredClone(initialDoc) as any;
  Object.assign(independentDoc.outputs[0], {
    id: 'linked-output', formatId: 'custom', name: 'Linked', contentLinkGroup: 'browser-linked-group',
  });
  const independentOutput = structuredClone(independentDoc.outputs[0]);
  Object.assign(independentOutput, {
    id: 'independent-output', name: 'Independent', contentLinkGroup: 'browser-independent-group',
  });
  independentOutput.children = independentOutput.children.map((child: any) => {
    const { originId, ...independentChild } = child;
    void originId;
    return { ...independentChild, id: `independent-${child.id}` };
  });
  independentDoc.outputs.push(independentOutput);
  const state = await installMocks(page, independentDoc);
  const expectLocalShape = (doc: any) => {
    expect(doc.outputs[0].children.filter((child: any) => child.type === 'shape')).toHaveLength(0);
    expect(doc.outputs[1].children.filter((child: any) => child.type === 'shape')).toHaveLength(1);
    expect(doc.outputs[1].contentLinkGroup).toBe('browser-independent-group');
    expect(doc.outputs[0].contentLinkGroup).not.toBe(doc.outputs[1].contentLinkGroup);
  };
  await openDesigner(page);
  await page.getByRole('button', { name: /Independent/ }).click();

  const stage = page.locator('.konva-stage').first();
  // The canvas menu opens only on the bare stage: right of the 20px ruler,
  // left of the artboard.
  await stage.click({ button: 'right', position: { x: 60, y: 150 } });
  await page.getByRole('button', { name: 'Add Shape', exact: true }).click();
  const savesBeforeInsert = state.saveDocs.length;
  await page.keyboard.press('Control+s');
  await expect.poll(() => state.saveDocs.length).toBeGreaterThan(savesBeforeInsert);
  expectLocalShape(state.saveDocs.at(-1));

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX');
  await expect(page.locator('.konva-stage').first()).toBeVisible();
  await page.getByRole('button', { name: /Independent/ }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: /Next: Export \d+ files?/ }).click();
  await page.getByRole('button', { name: /^Export \d+ files?$/ }).click();
  await expect(page.getByRole('link', { name: /\.png$/ }).first()).toBeVisible();
  expect(state.renderDocs.length).toBeGreaterThan(0);
  const renderedShapes = (state.renderDocs as any[]).flatMap((doc) =>
    doc.outputs.map((out: any) => [
      out.id,
      out.children.filter((child: any) => child.type === 'shape').length,
    ])
  );
  expect(renderedShapes).toContainEqual(['independent-output', 1]);
  expect(renderedShapes).toContainEqual(['linked-output', 0]);
  expect(renderedShapes).not.toContainEqual(['linked-output', 1]);
  expect(renderedShapes).not.toContainEqual(['independent-output', 0]);
});

test('cross-format Paste centers a complete group at the pointer through reload and export', async ({ page }) => {
  const doc = {
    version: 13,
    mode: 'image',
    outputs: [{
      id: 'paste-source', formatId: 'custom', name: 'Paste Source', contentLinkGroup: 'paste-source-link',
      width: 800, height: 600, background: '#ffffff',
      children: [{
        id: 'paste-group', type: 'group', name: 'Promo group', groupId: 'paste-move-source',
        x: 0, y: 0, width: 0, height: 0, rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'paste-shape', originId: 'paste-shape-origin', parentId: 'paste-group', groupId: 'paste-move-source',
        type: 'shape', shape: 'rect', fill: '#eeeeff', x: 80, y: 100, width: 400, height: 220,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'paste-image', originId: 'paste-image-origin', parentId: 'paste-group', groupId: 'paste-move-source',
        type: 'image', src: PNG_DATA_URL, x: 120, y: 140, width: 160, height: 100,
        naturalWidth: 40, naturalHeight: 20, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        fitMode: 'contain', focalPoint: { x: 0.25, y: 0.75 }, rotation: 8,
        opacity: 1, locked: false, hidden: false,
      }, {
        id: 'paste-text', originId: 'paste-text-origin', parentId: 'paste-group', groupId: 'paste-move-source',
        type: 'text', text: 'Pointer pasted headline', fontSize: 48, x: 100, y: 350, width: 500, height: 70,
        richText: [{ text: 'Pointer pasted headline', fontWeight: 700, fontSize: 48 }],
        rotation: 12, opacity: 1, locked: false, hidden: false,
      }],
    }, {
      id: 'paste-target', formatId: 'custom', name: 'Paste Target', contentLinkGroup: 'paste-target-link',
      width: 400, height: 400, background: '#ffffff',
      children: [{
        id: 'target-sentinel', type: 'text', text: 'Target', fontSize: 16,
        x: 160, y: 190, width: 80, height: 20, rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }],
  };
  const state = await installMocks(page, doc);
  const persist = async () => {
    const before = state.saveDocs.length;
    await page.keyboard.press('Control+s');
    await expect.poll(() => state.saveDocs.length).toBeGreaterThan(before);
  };
  await openDesigner(page);
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  await page.locator('[data-element-id="paste-group"]').click();
  // Shortcuts are canvas-focus-scoped, so the keys go to the canvas itself.
  const canvasRegion = page.getByRole('application', { name: 'Design canvas' });
  await canvasRegion.press('Control+c');
  await page.getByRole('button', { name: /Paste Target/ }).click();

  // Keyboard paste retains its offset behavior and remains one atomic edit.
  await canvasRegion.press('Control+v');
  await persist();
  let savedTarget = (state.saveDocs.at(-1) as any).outputs[1];
  expect(savedTarget.children).toHaveLength(5);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await persist();
  expect((state.saveDocs.at(-1) as any).outputs[1].children).toHaveLength(1);

  const stage = page.locator('.konva-stage').first();
  // The canvas's own zoom buttons sit under the right-hand panel at this viewport.
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const fitZoom = Math.min(box.width / 400, box.height / 400) * 0.85;
  const outputX = (box.width - 400 * fitZoom) / 2;
  const outputY = (box.height - 400 * fitZoom) / 2;
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Zoom In/ }).click();
  const zoom = fitZoom * 1.2;
  // Pan by a known screen-space delta; Konva must still report document coordinates.
  await canvasRegion.focus();
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await stage.click({
    button: 'right',
    position: { x: outputX + 15 + 200 * zoom, y: outputY + 10 + 200 * zoom },
  });
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await persist();

  savedTarget = (state.saveDocs.at(-1) as any).outputs[1];
  expect(savedTarget.children).toHaveLength(5);
  const pasted = savedTarget.children.filter((child: any) => child.id !== 'target-sentinel');
  const pastedGroup = pasted.find((child: any) => child.type === 'group');
  const sourceIds = new Set((doc.outputs[0].children as any[]).map((child) => child.id));
  const sourceOrigins = new Set((doc.outputs[0].children as any[]).map((child) => child.originId));
  expect(pasted.map((child: any) => child.type)).toEqual(['group', 'shape', 'image', 'text']);
  for (const child of pasted) {
    expect(sourceIds.has(child.id)).toBe(false);
    expect(sourceOrigins.has(child.originId)).toBe(false);
    if (child.parentId) expect(child.parentId).toBe(pastedGroup.id);
  }
  expect(new Set(pasted.filter((child: any) => child.groupId).map((child: any) => child.groupId)).size).toBe(1);
  expect(pastedGroup.groupId).not.toBe('paste-move-source');
  const leaves = pasted.filter((child: any) => child.type !== 'group');
  const left = Math.min(...leaves.map((child: any) => child.x));
  const right = Math.max(...leaves.map((child: any) => child.x + child.width));
  const top = Math.min(...leaves.map((child: any) => child.y));
  const bottom = Math.max(...leaves.map((child: any) => child.y + child.height));
  expect((left + right) / 2).toBeCloseTo(200, 0);
  expect((top + bottom) / 2).toBeCloseTo(200, 0);
  expect(pasted.find((child: any) => child.type === 'image')).toMatchObject({
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    focalPoint: { x: 0.25, y: 0.75 }, rotation: 8,
  });
  expect(pasted.find((child: any) => child.type === 'text').fontSize).toBeLessThan(48);
  expect((state.saveDocs.at(-1) as any).outputs[0].children).toEqual(doc.outputs[0].children);

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await persist();
  expect((state.saveDocs.at(-1) as any).outputs[1].children).toHaveLength(1);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await persist();

  // The bare pasteboard opens the canvas menu. Its off-artboard point must clamp
  // the whole batch onto the target rather than using the keyboard fallback.
  // x=40 clears the 20 px vertical ruler, which sits over the stage's left edge.
  await stage.click({ button: 'right', position: { x: 40, y: 150 } });
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await persist();
  savedTarget = (state.saveDocs.at(-1) as any).outputs[1];
  expect(savedTarget.children).toHaveLength(9);
  const canvasLeaves = savedTarget.children.slice(5).filter((child: any) => child.type !== 'group');
  const canvasLeft = Math.min(...canvasLeaves.map((child: any) => child.x));
  const canvasRight = Math.max(...canvasLeaves.map((child: any) => child.x + child.width));
  const canvasTop = Math.min(...canvasLeaves.map((child: any) => child.y));
  const canvasBottom = Math.max(...canvasLeaves.map((child: any) => child.y + child.height));
  expect(canvasLeft).toBe(0);
  expect(canvasRight).toBeLessThanOrEqual(400);
  expect(canvasTop).toBeGreaterThanOrEqual(0);
  expect(canvasBottom).toBeLessThanOrEqual(400);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await persist();
  expect((state.saveDocs.at(-1) as any).outputs[1].children).toHaveLength(5);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await persist();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX');
  await page.getByRole('button', { name: /Paste Target/ }).click();
  expect((state.doc as any).outputs[1].children).toHaveLength(9);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: /Next: Export \d+ files?/ }).click();
  await page.getByRole('button', { name: /^Export \d+ files?$/ }).click();
  await expect(page.getByRole('link', { name: /\.png$/ }).first()).toBeVisible();
  const targetRender = (state.renderDocs as any[]).find((rendered) =>
    rendered.outputs.some((output: any) => output.id === 'paste-target')
  );
  const renderedTarget = targetRender.outputs.find((output: any) => output.id === 'paste-target');
  expect(renderedTarget.children.map((child: any) => child.type)).toEqual([
    'text', 'group', 'shape', 'image', 'text', 'group', 'shape', 'image', 'text',
  ]);
  expect(renderedTarget.children.filter((child: any) => child.text === 'Pointer pasted headline')).toHaveLength(2);
  // Export sends one single-output document per rendered file.
  const renderedSource = (state.renderDocs as any[])
    .map((rendered) => rendered.outputs.find((output: any) => output.id === 'paste-source'))
    .find(Boolean);
  expect(renderedSource.children).toEqual(doc.outputs[0].children);
});

test('grouped mixed media survives Undo, independent clone, reload, and export', async ({ page }) => {
  const doc = {
    version: 13,
    mode: 'image',
    outputs: [{
      id: 'first-output', formatId: 'custom', name: 'First', contentLinkGroup: 'first-link',
      width: 400, height: 400, background: '#ffffff',
      children: [{
        id: 'first-sentinel', originId: 'first-origin', type: 'text', text: 'First output sentinel',
        x: 20, y: 20, width: 200, height: 40, rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }, {
      id: 'source-output', formatId: 'custom', name: 'Source', contentLinkGroup: 'source-link',
      width: 400, height: 400, background: '#ffffff',
      children: [{
        id: 'mixed-background', originId: 'background-origin', type: 'shape', shape: 'rect', fill: '#eeeeff',
        x: 0, y: 0, width: 400, height: 400, rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'mixed-logo', originId: 'logo-origin', type: 'image', src: PNG_DATA_URL,
        x: 20, y: 30, width: 80, height: 40, naturalWidth: 40, naturalHeight: 20,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, fitMode: 'contain',
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'mixed-phone', originId: 'phone-origin', type: 'image', src: PNG_DATA_URL,
        x: 160, y: 80, width: 120, height: 220, naturalWidth: 100, naturalHeight: 200,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }, {
        id: 'mixed-copy', originId: 'copy-origin', type: 'text', text: 'Grouped mixed copy', fontSize: 28,
        x: 40, y: 330, width: 300, height: 50, rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
      pages: [{ id: 'source-page-two', name: 'Second slide', children: [{
        id: 'page-two-copy', originId: 'page-two-origin', type: 'text', text: 'Second slide copy',
        x: 30, y: 40, width: 240, height: 60, rotation: 0, opacity: 1, locked: false, hidden: false,
      }] }],
    }],
  };
  const state = await installMocks(page, doc);
  await openDesigner(page);
  const persist = async () => {
    const before = state.saveDocs.length;
    await page.keyboard.press('Control+s');
    await expect.poll(() => state.saveDocs.length).toBeGreaterThan(before);
  };
  const assertClone = (saved: any) => {
    expect(saved.outputs).toHaveLength(3);
    const source = saved.outputs[1];
    const cloned = saved.outputs[2];
    expect(cloned.contentLinkGroup).not.toBe(source.contentLinkGroup);
    expect(cloned.children.map((el: any) => el.type)).toEqual(source.children.map((el: any) => el.type));
    expect(cloned.pages).toHaveLength(source.pages.length);
    expect(JSON.stringify(cloned)).not.toContain('First output sentinel');
    for (const children of [cloned.children, ...cloned.pages.map((item: any) => item.children)]) {
      const ids = new Set(children.map((el: any) => el.id));
      for (const el of children) {
        expect(el.originId).toBeUndefined();
        if (el.parentId) expect(ids.has(el.parentId)).toBe(true);
      }
    }
    expect(cloned.children.find((el: any) => el.naturalWidth === 40)?.crop).toEqual({
      x: 0.1, y: 0.1, width: 0.8, height: 0.8,
    });
    return cloned;
  };

  await page.getByRole('button', { name: /Source/ }).click();
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
  const stage = page.locator('.konva-stage').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  const scale = Math.min(box.width / 400, box.height / 400) * 0.85;
  const outputX = (box.width - 400 * scale) / 2;
  const outputY = (box.height - 400 * scale) / 2;
  await page.mouse.move(box.x + outputX - 8, box.y + outputY + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + outputX + 300 * scale, box.y + outputY + 390 * scale, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press('Control+g');
  await persist();

  const grouped = (state.saveDocs.at(-1) as any).outputs[1];
  const group = grouped.children.find((el: any) => el.type === 'group');
  expect(group).toBeTruthy();
  expect(grouped.children.filter((el: any) => el.parentId === group.id)).toHaveLength(4);
  expect((state.saveDocs.at(-1) as any).outputs[0].children.some((el: any) => el.parentId)).toBe(false);
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'W', exact: true })).toHaveValue('400');
  await expect(page.getByRole('spinbutton', { name: 'H', exact: true })).toHaveValue('400');

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await persist();
  expect((state.saveDocs.at(-1) as any).outputs[1].children.some((el: any) => el.type === 'group')).toBe(false);
  expect((state.saveDocs.at(-1) as any).outputs[1].children).toHaveLength(4);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await persist();

  await page.getByRole('button', { name: 'Add format', exact: true }).click();
  await page.getByRole('radio', { name: 'Independent copies (carousel / pages)' }).check();
  await page.getByRole('checkbox', { name: /Instagram Story/ }).check();
  await page.getByRole('button', { name: 'Add 1 format', exact: true }).click();
  await persist();
  const cloned = assertClone(state.saveDocs.at(-1));
  await page.getByRole('tab', { name: 'Layers', exact: true }).click();
  for (const el of cloned.children) {
    await expect(page.locator(`[data-element-id="${el.id}"]`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Second slide', exact: true }).click();
  for (const el of cloned.pages[0].children) {
    await expect(page.locator(`[data-element-id="${el.id}"]`)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await persist();
  expect((state.saveDocs.at(-1) as any).outputs).toHaveLength(2);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await persist();
  assertClone(state.saveDocs.at(-1));

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX', { timeout: 60_000 });
  await page.getByRole('button', { name: /Instagram Story/ }).click();
  assertClone(state.doc);
  const rendersBeforeExport = state.renderDocs.length;
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Files' }).click();
  await page.getByRole('button', { name: 'Next: Choose Folder' }).click();
  await page.getByRole('button', { name: /Next: Export \d+ files?/ }).click();
  await page.getByRole('button', { name: /^Export \d+ files?$/ }).click();
  await expect(page.getByRole('link', { name: /\.png$/ }).first()).toBeVisible();
  expect(state.renderDocs.length).toBeGreaterThan(rendersBeforeExport);
  const exported = state.renderDocs
    .slice(rendersBeforeExport)
    .map((rendered: any) => rendered.outputs[0])
    .find((output: any) =>
      output.formatId === 'ig-story' && output.children.some((el: any) => el.type === 'group'));
  expect(exported).toBeTruthy();
  const exportedIds = new Set(exported.children.map((el: any) => el.id));
  expect(exported.children.filter((el: any) => el.parentId)).toHaveLength(4);
  for (const el of exported.children) {
    expect(el.originId).toBeUndefined();
    if (el.parentId) expect(exportedIds.has(el.parentId)).toBe(true);
  }
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

type SafeZoneSample = { x: number; y: number; expected: 'shaded' | 'clear' };

async function sampleSafeZonePixels(
  page: Page,
  width: number,
  height: number,
  samples: SafeZoneSample[]
) {
  const canvas = page.locator('.konva-stage').first().locator('canvas').first();
  return canvas.evaluate((element, args) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Safe-zone canvas has no 2d context');
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(bounds.width / args.width, bounds.height / args.height) * 0.85;
    const left = (bounds.width - args.width * scale) / 2;
    const top = (bounds.height - args.height * scale) / 2;
    const ratioX = canvas.width / bounds.width;
    const ratioY = canvas.height / bounds.height;

    return args.samples.map((sample) => {
      const x = Math.round((left + sample.x * scale) * ratioX);
      const y = Math.round((top + sample.y * scale) * ratioY);
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      const shaded = r >= 250 && g >= 220 && g <= 245 && b >= 220 && b <= 245 && g < r - 5;
      const clear = r >= 250 && g >= 250 && b >= 250;
      return shaded ? 'shaded' : clear ? 'clear' : `${r},${g},${b}`;
    });
  }, { width, height, samples });
}

test('safe zones scale to platform formats and keep the custom guide unshaded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const output = (id: string, formatId: string, name: string, width: number, height: number) => ({
    id, formatId, name, width, height, background: '#ffffff', children: [],
  });
  const outputs = [
    output('story', 'ig-story', 'Story enlarged', 2118, 3763),
    output('reel', 'ig-reel', 'Reel', 1080, 1920),
    output('tiktok', 'tiktok', 'TikTok', 1080, 1920),
    output('facebook-story', 'fb-story', 'Facebook Story', 1080, 1920),
    output('linkedin-banner', 'linkedin-banner', 'LinkedIn Banner', 1584, 396),
    output('youtube', 'yt-thumbnail', 'YouTube Thumbnail', 1280, 720),
  ];
  const state = await installMocks(page, { version: 13, mode: 'image', outputs });
  await openDesigner(page);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Safe Zones', exact: true }).click();

  const cases: { name: string; width: number; height: number; samples: SafeZoneSample[] }[] = [
    {
      name: 'Story enlarged', width: 2118, height: 3763,
      samples: [
        { x: 1059, y: 20, expected: 'shaded' },
        { x: 1059, y: 3700, expected: 'shaded' },
        { x: 1059, y: 1800, expected: 'clear' },
      ],
    },
    {
      name: 'Reel', width: 1080, height: 1920,
      samples: [
        { x: 1000, y: 1200, expected: 'shaded' },
        { x: 500, y: 1700, expected: 'shaded' },
        { x: 500, y: 1000, expected: 'clear' },
      ],
    },
    {
      name: 'TikTok', width: 1080, height: 1920,
      samples: [
        { x: 1000, y: 1200, expected: 'shaded' },
        { x: 500, y: 1700, expected: 'shaded' },
        { x: 500, y: 1000, expected: 'clear' },
      ],
    },
    {
      name: 'Facebook Story', width: 1080, height: 1920,
      samples: [
        { x: 1000, y: 50, expected: 'shaded' },
        { x: 900, y: 1850, expected: 'shaded' },
        { x: 500, y: 500, expected: 'clear' },
      ],
    },
    {
      name: 'LinkedIn Banner', width: 1584, height: 396,
      samples: [
        { x: 100, y: 350, expected: 'shaded' },
        { x: 700, y: 100, expected: 'clear' },
      ],
    },
    {
      name: 'YouTube Thumbnail', width: 1280, height: 720,
      samples: [
        { x: 1200, y: 710, expected: 'shaded' },
        { x: 500, y: 300, expected: 'clear' },
      ],
    },
  ];

  for (const item of cases) {
    await page.getByRole('button', { name: `${item.name} ${item.width}×${item.height}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
    await expect.poll(
      () => sampleSafeZonePixels(page, item.width, item.height, item.samples),
      { timeout: 15_000 }
    ).toEqual(item.samples.map((sample) => sample.expected));
  }

  state.doc = {
    version: 13,
    mode: 'image',
    outputs: [output('custom', 'custom', 'Custom', 400, 300)],
  };
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Editing UX');
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Safe Zones', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
  await expect.poll(() => sampleSafeZonePixels(page, 400, 300, [
    { x: 200, y: 150, expected: 'clear' },
  ])).toEqual(['clear']);
});


const contextMenuDoc = {
  version: 13,
  mode: 'image',
  outputs: [{
    id: 'context-menu-output',
    width: 400,
    height: 400,
    background: '#ffffff',
    children: [{
      id: 'shape-one', name: 'Shape one', type: 'shape', shape: 'rect', fill: '#ff0000',
      x: 40, y: 260, width: 120, height: 120,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    }, {
      id: 'shape-two', name: 'Shape two', type: 'shape', shape: 'rect', fill: '#00ff00',
      x: 260, y: 260, width: 120, height: 120,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    }],
  }],
};

async function fitContextMenuCanvas(page: Page) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: /Fit to Screen/ }).click();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function contextMenuCanvasPoint(page: Page, x: number, y: number) {
  const stage = await page.locator('.konva-stage').first().boundingBox();
  if (!stage) throw new Error('Canvas has no bounding box');
  const scale = Math.min(stage.width / 400, stage.height / 400) * 0.85;
  return {
    x: stage.x + (stage.width - 400 * scale) / 2 + x * scale,
    y: stage.y + (stage.height - 400 * scale) / 2 + y * scale,
  };
}

async function expectInsideContextMenuViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport is unavailable');
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return false;
    return box.x >= 7 && box.y >= 7 &&
      box.x + box.width <= viewport.width - 7 &&
      box.y + box.height <= viewport.height - 7;
  }).toBe(true);
}

test('context menus scroll to reachable element and canvas actions on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  const state = await installMocks(page, contextMenuDoc);
  await openDesigner(page);
  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await fitContextMenuCanvas(page);

  const point = await contextMenuCanvasPoint(page, 320, 320);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByTestId('designer-context-menu');
  await expect(menu).toBeVisible();
  await expectInsideContextMenuViewport(page, menu);
  const overflow = await menu.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);

  const cut = menu.getByRole('button', { name: 'Cut', exact: true });
  const apply = menu.getByRole('button', { name: 'Apply to All Formats', exact: true });
  await expect(cut).toBeFocused();
  await cut.press('Shift+Tab');
  await expect(apply).toBeFocused();
  await apply.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => state.doc.outputs[0].children
    .find((child: any) => child.id === 'shape-two')?.originId).toBe('relink-shape-two');
  expect(state.doc.outputs[0].children.find((child: any) => child.id === 'shape-one')?.originId)
    .toBeUndefined();

  const stage = page.locator('.konva-stage').first();
  await stage.click({ button: 'right', position: { x: 60, y: 150 } });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add Shape', exact: true }).click();
  await expect.poll(() => state.doc.outputs[0].children.length).toBe(3);
  expect(state.doc.outputs[0].children.filter((child: any) => child.type === 'shape')).toHaveLength(3);

  await stage.click({ button: 'right', position: { x: 60, y: 150 } });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await stage.click({ button: 'right', position: { x: 60, y: 150 } });
  await expect(menu).toBeVisible();
  await page.getByRole('textbox', { name: 'Design name' }).click();
  await expect(menu).toHaveCount(0);
});

test('Pathfinder flyout stays visible and keyboard accessible after a viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  const state = await installMocks(page, contextMenuDoc);
  await openDesigner(page);
  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await fitContextMenuCanvas(page);
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await page.getByRole('menuitem', { name: 'All Layers', exact: false }).click();

  const point = await contextMenuCanvasPoint(page, 320, 320);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByTestId('designer-context-menu');
  await expect(menu).toBeVisible();
  await expectInsideContextMenuViewport(page, menu);

  const pathfinder = menu.getByRole('button', { name: 'Pathfinder', exact: true });
  await menu.getByRole('button', { name: 'Cut', exact: true }).press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(pathfinder).toBeFocused();
  await expect(pathfinder).toHaveAttribute('aria-expanded', 'true');
  const flyout = page.getByTestId('designer-context-flyout');
  await expect(flyout).toBeVisible();
  await expectInsideContextMenuViewport(page, flyout);
  const triggerBox = await pathfinder.boundingBox();
  const flyoutBox = await flyout.boundingBox();
  if (!triggerBox || !flyoutBox) throw new Error('Pathfinder geometry is unavailable');
  expect(flyoutBox.x + flyoutBox.width).toBeLessThanOrEqual(triggerBox.x + 1);

  const unite = flyout.getByRole('menuitem', { name: 'Unite', exact: true });
  await pathfinder.press('ArrowRight');
  await expect(unite).toBeFocused();
  await unite.press('ArrowLeft');
  await expect(pathfinder).toBeFocused();
  await expect(flyout).toHaveCount(0);
  await pathfinder.press('ArrowRight');
  await expect(unite).toBeFocused();

  await page.setViewportSize({ width: 1050, height: 480 });
  await expectInsideContextMenuViewport(page, menu);
  await expectInsideContextMenuViewport(page, flyout);
  await unite.press('Enter');
  await expect(menu).toHaveCount(0);
  // The fixture's shapes are disjoint, and Unite keeps disjoint regions as
  // separate paths, so both shapes become paths.
  await expect.poll(() => state.doc.outputs[0].children.map((child: any) => child.type))
    .toEqual(['path', 'path']);
});

test('clip context menu duplicates the intended clip without changing another track', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  const state = await installMocks(page, initialVideoDoc);
  await openDesigner(page);
  await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse timeline', exact: true }).click();
  await fitContextMenuCanvas(page);

  const point = await contextMenuCanvasPoint(page, 120, 260);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByTestId('designer-context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Duplicate', exact: true }).click();

  await expect.poll(() => state.doc.outputs[0].tracks[1].clips.length).toBe(2);
  const source = state.doc.outputs[0].tracks[1].clips.find((clip: any) => clip.id === 'still-clip');
  const duplicate = state.doc.outputs[0].tracks[1].clips.find((clip: any) => clip.id !== 'still-clip');
  expect(source).toBeTruthy();
  expect(duplicate).toMatchObject({ startMs: 5000, endMs: 10000, src: PNG_DATA_URL });
  expect(duplicate.id).not.toBe(source.id);
  expect(state.doc.outputs[0].tracks[0].clips).toHaveLength(1);
  expect(state.doc.outputs[0].tracks[0].clips[0]).toMatchObject({ id: 'video-clip', src: '/video.mp4' });
});
