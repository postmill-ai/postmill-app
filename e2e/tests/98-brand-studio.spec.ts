import { test, expect, type Page, type Route } from '@playwright/test';

const DESIGN_ID = 'brand-studio-e2e-design';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const brands = [
  {
    id: 'brand-a', name: 'Brand A', enabled: true, isDefault: true,
    palette: ['#111111'], fontFamilies: ['A Sans'], customFonts: [],
    preferredFormats: ['ig-post'], logoFileIds: ['logo-a'], assets: [],
    enforcement: { enabled: true },
  },
  {
    id: 'brand-b', name: 'Brand B', enabled: true, isDefault: false,
    palette: ['#222222'], fontFamilies: ['B Sans'], customFonts: [],
    preferredFormats: ['ig-story'], logoFileIds: ['logo-b'], assets: [],
    enforcement: { enabled: false },
  },
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function installMocks(page: Page, role: 'editor' | 'member' = 'editor') {
  const state = {
    brands: structuredClone(brands),
    ragEnabled: false,
    ragGlobalEnabled: true,
    platformSettingsRequests: 0,
    fontRequests: [] as (string | null)[],
    knowledge: [] as { sourceId: string; sourceType: string; content: string; brandId?: string }[],
    doc: {
      version: 13,
      mode: 'image',
      brandProfileId: 'brand-b',
      outputs: [{
        id: 'output', width: 400, height: 400, background: '#ffffff',
        children: [{ id: 'text', type: 'text', text: 'Hello', x: 40, y: 40, width: 200, height: 60, fontFamily: 'B Sans', fontSize: 32, fill: '#222222' }],
      }],
    },
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
    const brandId = url.searchParams.get('brandId');

    if (url.hostname.endsWith('.ingest.us.sentry.io')) return json(route, {});
    if (url.hostname === 'www.gravatar.com') return route.fulfill({ status: 204 });
    if (method === 'GET' && pathname === '/user/self') {
      return json(route, {
        id: role, email: `${role}@example.test`, orgId: 'e2e-org', role,
        isSuperAdmin: false, activated: true, setupCompleted: true, profile: {},
        tier: 'TEAM',
      });
    }
    if (method === 'GET' && pathname === '/settings/roles/me') {
      return json(route, {
        role, isSuperAdmin: false,
        permissions: [
          'brands:read', 'media:read', 'media:create', 'media:update', 'media:delete',
          'settings:read', 'ai-config:read',
          ...(role === 'editor'
            ? ['brands:create', 'brands:update', 'brands:delete', 'ai-config:update']
            : []),
        ],
      });
    }
    if (method === 'GET' && pathname === '/user/organizations') {
      return json(route, [{ id: 'e2e-org', name: 'E2E Org', users: [{ disabled: false }] }]);
    }
    if (method === 'GET' && pathname === '/campaigns') return json(route, []);
    if (method === 'GET' && pathname.startsWith('/campaigns/for/')) return json(route, []);
    if (method === 'GET' && pathname === '/channels/config') return json(route, []);
    if (method === 'GET' && pathname === '/channels/config/providers') return json(route, []);
    if (method === 'GET' && pathname === '/brands' && (url.origin === 'https://api.postmill.ai' || url.pathname.startsWith('/api/'))) {
      return json(route, state.brands);
    }
    if (method === 'PUT' && pathname.startsWith('/brands/')) {
      const id = pathname.split('/')[2];
      const patch = request.postDataJSON() as Record<string, unknown>;
      const index = state.brands.findIndex((brand) => brand.id === id);
      if (index < 0) return json(route, { message: 'Brand not found' }, 404);
      state.brands[index] = { ...state.brands[index], ...patch };
      return json(route, state.brands[index]);
    }
    if (method === 'POST' && pathname === '/brands') {
      const body = request.postDataJSON() as { name: string };
      const created = {
        id: `brand-${state.brands.length + 1}`, name: body.name, enabled: true,
        isDefault: false, palette: [], fontFamilies: [], customFonts: [],
        preferredFormats: [], logoFileIds: [], assets: [], enforcement: {},
      };
      state.brands.push(created);
      return json(route, created, 201);
    }
    if (method === 'GET' && pathname === '/rag/status') {
      const legacy = url.searchParams.get('scope') === 'unassigned';
      return json(route, {
        enabled: state.ragGlobalEnabled && state.ragEnabled,
        globalEnabled: state.ragGlobalEnabled,
        organizationEnabled: state.ragEnabled,
        indexedItems: state.knowledge.filter((item) => legacy ? !item.brandId : item.brandId === brandId).length,
        lastIndexed: null, embeddingModel: 'test/embedding', vectorStore: 'pgvector',
      });
    }
    if (method === 'PUT' && pathname === '/rag/enabled') {
      state.ragEnabled = true;
      return json(route, { ragEnabled: true });
    }
    if (method === 'GET' && pathname === '/rag/items') {
      const legacy = url.searchParams.get('scope') === 'unassigned';
      const items = state.knowledge.filter((item) => legacy ? !item.brandId : item.brandId === brandId);
      return json(route, {
        items: items.map((item) => ({
          sourceId: item.sourceId, sourceType: item.sourceType,
          indexedDate: '2026-01-01T00:00:00.000Z', chunkCount: 1, charCount: item.content.length,
        })),
        total: items.length, offset: 0, limit: 20,
      });
    }
    if (method === 'DELETE' && pathname.startsWith('/rag/items/')) {
      const sourceId = decodeURIComponent(pathname.split('/').pop() || '');
      const legacy = url.searchParams.get('scope') === 'unassigned';
      state.knowledge = state.knowledge.filter((item) => !(
        item.sourceId === sourceId && (legacy ? !item.brandId : item.brandId === brandId)
      ));
      return json(route, { success: true });
    }
    if (method === 'POST' && pathname === '/rag/index') {
      const body = request.postDataJSON() as { sourceType: string; content: string; brandId: string; sourceId?: string };
      const sourceId = body.sourceId || `text_${state.knowledge.length + 1}`;
      state.knowledge.push({ sourceId, sourceType: body.sourceType, content: body.content, brandId: body.brandId });
      return json(route, { success: true, sourceId, sourceType: body.sourceType });
    }
    if (method === 'POST' && pathname === '/rag/backfill') {
      const body = request.postDataJSON() as { brandId: string };
      state.knowledge.push({ sourceId: 'post-1', sourceType: 'post', content: 'Backfilled brand post', brandId: body.brandId });
      return json(route, { status: 'completed', indexed: 1 });
    }
    if (method === 'POST' && pathname === '/rag/search') {
      const body = request.postDataJSON() as { query: string; brandId: string };
      return json(route, {
        results: state.knowledge.filter((item) => item.brandId === body.brandId && item.content.includes(body.query))
          .map((item) => ({ text: item.content, sourceType: item.sourceType, sourceId: item.sourceId, score: 1 })),
      });
    }
    if (method === 'GET' && pathname === '/media/fonts') {
      state.fontRequests.push(brandId === 'null' ? null : brandId);
      return json(route, [{ fileId: 'font-b', family: 'B Custom', path: '/font-b.ttf', weights: [400], serverRender: true }]);
    }
    if (method === 'GET' && pathname === '/rag/settings') {
      state.platformSettingsRequests += 1;
      return json(route, { message: 'Super admin access required' }, 403);
    }
    if (method === 'GET' && pathname === '/files') {
      return json(route, {
        pages: 1,
        results: [
          { id: 'logo-a', path: PIXEL, name: 'logo-a.png' },
          { id: 'logo-b', path: PIXEL, name: 'logo-b.png' },
          { id: 'ref-a', path: PIXEL, name: 'ref-a.png' },
        ],
      });
    }
    if (method === 'GET' && pathname === '/media/design-templates') {
      const templates = [
        { id: 'template-shared', name: 'Shared template', isSystem: false, brandProfileId: null, doc: { mode: 'image' } },
        { id: 'template-b', name: 'B template', isSystem: false, brandProfileId: 'brand-b', doc: { mode: 'image' } },
      ].sort((a, b) => Number(b.brandProfileId === brandId) - Number(a.brandProfileId === brandId));
      return json(route, { templates, total: 2, page: 1, limit: 100 });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}`) {
      return json(route, { id: DESIGN_ID, name: 'Brand workflow', doc: state.doc });
    }
    if (method === 'PUT' && pathname === `/media/designs/${DESIGN_ID}`) {
      const body = request.postDataJSON() as { doc?: typeof state.doc };
      if (body.doc) state.doc = body.doc;
      return json(route, { id: DESIGN_ID, name: 'Brand workflow', doc: state.doc });
    }
    if (method === 'GET' && pathname === `/media/designs/${DESIGN_ID}/versions`) return json(route, []);
    if (method === 'GET' && ['/announcements', '/notifications', '/integrations/list'].includes(pathname)) return json(route, []);
    if (method === 'GET' && ['/settings/media/config', '/settings/ai/config', '/settings/storage', '/files/limits'].includes(pathname)) return json(route, {});
    if (method === 'GET' && pathname === '/media/tools/status') return json(route, { operations: {}, tools: {} });

    const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN;
    if (frontendOrigin && url.origin === 'https://app.postmill.ai' && !pathname.startsWith('/api/')) {
      const headers = { ...request.headers() };
      delete headers.host;
      delete headers['content-length'];
      const response = await fetch(`${frontendOrigin}${pathname}${url.search}`, {
        method, headers, body: request.postDataBuffer() ?? undefined,
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) responseHeaders[key] = value;
      });
      return route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
    }

    if (url.origin === 'https://api.postmill.ai') {
      return method === 'GET' ? json(route, {}) : json(route, { message: 'Unexpected API mutation blocked' }, 503);
    }
    return route.continue();
  });
  return state;
}

test('editor uses two Brand Kits, Knowledge, and persistent Designer modes', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('pageerror', (error) => console.log('BRAND_STUDIO_PAGE_ERROR', error.stack));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('BRAND_STUDIO_CONSOLE_ERROR', message.text());
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('/user/self')) {
      void response.json().then((body) => console.log('BRAND_STUDIO_USER', JSON.stringify(body))).catch(() => {});
    }
    if (path.endsWith('/brands')) {
      console.log('BRAND_STUDIO_BRANDS_STATUS', response.status());
      void response.json().then((body) => console.log('BRAND_STUDIO_BRANDS_BODY', JSON.stringify(body))).catch(() => {});
    }
  });
  const state = await installMocks(page);
  page.on('framenavigated', (frame) => console.log('BRAND_STUDIO_NAVIGATE', frame.url()));

  await page.goto('/brands/brand-b/kit');
  console.log('BRAND_STUDIO_CURRENT_URL', page.url());
  await expect(page.getByText('Brand Kit', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove B Sans', exact: true })).toBeVisible();
  await expect(page.getByText('B template', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign Shared template', exact: true })).toBeVisible();

  await page.goto('/brands/brand-b/knowledge');
  await page.getByRole('button', { name: 'Enable Knowledge', exact: true }).click();
  await expect(page.getByText('Knowledge enabled for this organization')).toBeVisible();
  await page.getByRole('button', { name: '+ Add Content', exact: true }).click();
  await page.getByPlaceholder('Paste or type content to index...').fill('Brand B launch fact');
  await page.getByRole('button', { name: 'Index', exact: true }).click();
  await expect(page.getByText('text_1', { exact: true })).toBeVisible();
  expect(state.knowledge.every((item) => item.brandId === 'brand-b')).toBe(true);

  await page.getByPlaceholder('Search what the AI knows…').fill('Brand B launch');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Brand B launch fact', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: 'Learn from my posts', exact: true }).click();
  await expect(page.getByText('post-1', { exact: true })).toBeVisible();
  expect(state.knowledge.every((item) => item.brandId === 'brand-b')).toBe(true);

  await page.goto(`/media/designer?designId=${DESIGN_ID}`);
  await expect(page.getByRole('textbox', { name: 'Design name' })).toHaveValue('Brand workflow');
  await page.getByRole('button', { name: 'Brand', exact: true }).first().click();
  const picker = page.getByLabel('Brand Profile', { exact: true });
  await expect(picker).toHaveValue('brand-b');

  await picker.selectOption('brand-a');
  await expect(picker).toHaveValue('brand-a');
  await expect(page.getByText('Off-brand elements detected', { exact: true })).toBeVisible();
  await picker.selectOption('brand-b');
  await expect(picker).toHaveValue('brand-b');
  await expect(page.getByText('Off-brand elements detected', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove logo', exact: true }).click();
  expect(state.brands.find((brand) => brand.id === 'brand-b')?.logoFileIds).toEqual([]);
  expect(state.doc.outputs[0].children).toHaveLength(1);

  await picker.selectOption('');
  await expect(picker).toHaveValue('');
  await expect.poll(() => state.doc.brandProfileId).toBeNull();
  await expect.poll(() => state.fontRequests.at(-1)).toBeNull();
  expect(state.platformSettingsRequests).toBe(0);
});

test('member can read Brand Kits and Knowledge but cannot mutate them', async ({ page }) => {
  const state = await installMocks(page, 'member');

  await page.goto('/brands');
  await expect(page.getByRole('heading', { name: 'Brand Studio', exact: true, level: 3 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Brand', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View', exact: true }).first().click();

  await page.goto('/brands/brand-a/kit');
  await expect(page.getByText('Brand Kit', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add logo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Upload font (.ttf, .otf, .woff2)', exact: true })).toHaveCount(0);

  await page.goto('/brands/brand-a/knowledge');
  await expect(page.getByRole('button', { name: 'Enable Knowledge', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '+ Add Content', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Learn from my posts', exact: true })).toBeDisabled();

  await page.goto(`/media/designer?designId=${DESIGN_ID}`);
  await page.getByRole('button', { name: 'Brand', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Remove logo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose intro video…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove B Custom', exact: true })).toHaveCount(0);
  expect(state.platformSettingsRequests).toBe(0);
});

test('legacy Knowledge remains visible and deletable without exposing brand content', async ({ page }) => {
  const state = await installMocks(page);
  state.knowledge.push(
    { sourceId: 'legacy-note', sourceType: 'text', content: 'Pre-upgrade fact' },
    { sourceId: 'brand-note', sourceType: 'text', content: 'Brand-only fact', brandId: 'brand-a' },
  );

  await page.goto('/brands/knowledge');
  await expect(page.getByText('Unassigned Knowledge', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('legacy-note', { exact: true })).toBeVisible();
  await expect(page.getByText('brand-note', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('legacy-note', { exact: true })).toHaveCount(0);
  expect(state.knowledge).toEqual([
    { sourceId: 'brand-note', sourceType: 'text', content: 'Brand-only fact', brandId: 'brand-a' },
  ]);
});

test('an org cannot enable Knowledge while the operator switch is off', async ({ page }) => {
  const state = await installMocks(page);
  state.ragGlobalEnabled = false;

  await page.goto('/brands/brand-a/knowledge');
  await expect(page.getByText('Knowledge is disabled by the platform operator.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable Knowledge', exact: true })).toBeDisabled();
  expect(state.ragEnabled).toBe(false);
  expect(state.platformSettingsRequests).toBe(0);
});
