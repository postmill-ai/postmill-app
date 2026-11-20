import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { BrandTemplates, BrandTemplatePage, BrandTemplate, reconcileTemplatePages } from './brand-templates';

const mockFetch = vi.fn();
const mockToasterShow = vi.fn();
const mockT = (_key: string, fallback: string, params?: Record<string, any>) =>
  Object.entries(params || {}).filter(([key]) => key !== 'interpolation').reduce(
    (text, [key, value]) => {
      const raw = String(value);
      const escaped = params?.interpolation?.escapeValue === false
        ? raw
        : raw.replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('/', '&#x2F;');
      return text.replaceAll(`{{${key}}}`, escaped);
    },
    fallback,
  );

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));
vi.mock('use-debounce', () => ({
  useDebounce: (value: string) => [value, {}],
}));

const template = (id: string, name: string, brandProfileId: string | null = null, extra: Partial<BrandTemplate> = {}): BrandTemplate => ({
  id,
  name,
  brandProfileId,
  category: 'Social',
  isSystem: false,
  thumbnail: `/uploads/${id}.png`,
  doc: { mode: 'image' },
  ...extra,
});

const page = (templates: ReturnType<typeof template>[], total = templates.length, pageNumber = 1): BrandTemplatePage => ({
  templates,
  total,
  page: pageNumber,
  limit: 24,
});

const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

const renderBrowser = (canEdit = true) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <BrandTemplates brandId="brand-a" canEdit={canEdit} />
  </SWRConfig>,
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileTemplatePages', () => {
  it('deduplicates only by id and lets the later page replace stale assignment state', () => {
    const sharedName = 'Same display name';
    const result = reconcileTemplatePages([
      page([
        template('one', sharedName, 'brand-a'),
        template('two', sharedName),
        template('system', 'System', null, { isSystem: true }),
      ]),
      page([template('one', sharedName, null)], 4, 2),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(['one', 'two']);
    expect(result.find((entry) => entry.id === 'one')?.brandProfileId).toBeNull();
    expect(result).toHaveLength(2);
  });
});

describe('BrandTemplates', () => {
  it('renders visual cards, video and missing-preview fallbacks, and full accessible long names', async () => {
    const longName = 'An exceptionally long campaign template name that must remain fully accessible';
    mockFetch.mockResolvedValue(response(page([
      template('assigned', longName, 'brand-a'),
      template('video', 'Video template', null, { doc: { mode: 'video' } }),
      template('missing', 'Missing preview', null, { thumbnail: null }),
    ])));

    renderBrowser();

    const assignedList = await screen.findByRole('list', { name: 'Assigned to this brand' });
    const assignedCard = within(assignedList).getByRole('listitem');
    expect(within(assignedCard).getByRole('img', { name: `${longName} preview` })).toBeTruthy();
    expect(within(assignedCard).getByText(longName).getAttribute('data-tooltip-content')).toBe(longName);
    expect(within(assignedCard).getByRole('button', { name: `Unassign ${longName}` })).toBeTruthy();
    expect(screen.getByText('VIDEO')).toBeTruthy();
    expect(screen.getByText('No preview available')).toBeTruthy();
  });

  it('keeps template names and search queries literal instead of rendering HTML entities', async () => {
    const name = "Q&A Summer '26 1/2";
    mockFetch.mockImplementation(async (url: string) => {
      const query = new URL(url, 'https://app.postmill.ai').searchParams.get('query');
      return response(query ? page([]) : page([
        template('assigned-special', name, 'brand-a'),
        template('available-special', name),
      ]));
    });

    renderBrowser();
    expect((await screen.findAllByRole('img', { name: `${name} preview` })).length).toBe(2);
    expect(screen.getByRole('button', { name: `Assign ${name}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Unassign ${name}` })).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), { target: { value: 'R&D' } });
    expect(await screen.findByText('No templates match “R&D”.')).toBeTruthy();
    expect(screen.queryByText(/&amp;|&#39;|&#x2F;/)).toBeNull();
  });

  it('uses bounded pages, loads more, and never renders duplicate template ids', async () => {
    const firstPage = Array.from({ length: 24 }, (_, index) => template(`template-${index + 1}`, `Template ${index + 1}`));
    mockFetch.mockImplementation(async (url: string) => {
      const request = new URL(url, 'https://app.postmill.ai');
      if (request.searchParams.get('page') === '2') {
        return response(page([
          template('template-24', 'Template 24 refreshed', 'brand-a'),
          template('template-25', 'Template 24 refreshed'),
        ], 25, 2));
      }
      return response(page(firstPage, 25));
    });

    renderBrowser();
    expect((await screen.findAllByRole('listitem')).length).toBe(24);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(document.querySelectorAll('[data-template-id="template-24"]')).toHaveLength(1);
    expect(screen.getAllByText('Template 24 refreshed')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    const urls = mockFetch.mock.calls.map(([url]) => new URL(url, 'https://app.postmill.ai'));
    expect(urls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(urls.every((url) => url.searchParams.get('limit') === '24' && url.searchParams.get('scope') === 'org')).toBe(true);
  });

  it('searches the org library with a fresh bounded first page', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const request = new URL(url, 'https://app.postmill.ai');
      const query = request.searchParams.get('query');
      return response(query === 'launch'
        ? page([template('unloaded-match', 'Launch announcement')])
        : page([template('initial', 'Initial template')], 26));
    });

    renderBrowser();
    await screen.findByText('Initial template');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), { target: { value: ' launch ' } });

    await screen.findByText('Launch announcement');
    expect(screen.queryByText('Initial template')).toBeNull();
    const searchUrl = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
    expect(searchUrl.searchParams.get('query')).toBe('launch');
    expect(searchUrl.searchParams.get('page')).toBe('1');
    expect(searchUrl.searchParams.get('limit')).toBe('24');
    expect(searchUrl.searchParams.get('scope')).toBe('org');
  });

  it('assigns and unassigns without stale sections and revalidates every loaded page', async () => {
    const records = [
      ...Array.from({ length: 24 }, (_, index) => template(`template-${index + 1}`, `Template ${index + 1}`)),
      template('shared', 'Shared template'),
    ];
    let assigned = false;
    const getPage = (url: string) => {
      const request = new URL(url, 'https://app.postmill.ai');
      const pageNumber = Number(request.searchParams.get('page'));
      const ordered = [...records].sort((a, b) => {
        const aAssigned = a.id === 'shared' && assigned;
        const bAssigned = b.id === 'shared' && assigned;
        return Number(bAssigned) - Number(aAssigned);
      }).map((entry) => entry.id === 'shared' ? { ...entry, brandProfileId: assigned ? 'brand-a' : null } : entry);
      const start = (pageNumber - 1) * 24;
      return response(page(ordered.slice(start, start + 24), records.length, pageNumber));
    };
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') {
        assigned = JSON.parse(String(options.body)).brandProfileId === 'brand-a';
        return response({});
      }
      return getPage(url);
    });

    renderBrowser();
    await screen.findByText('Template 1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Assign Shared template' });
    mockFetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Assign Shared template' }));
    await screen.findByRole('button', { name: 'Unassign Shared template' });
    await waitFor(() => expect(mockFetch.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
    expect(document.querySelectorAll('[data-template-id="shared"]')).toHaveLength(1);
    expect(JSON.parse(String(mockFetch.mock.calls[0][1].body))).toEqual({ brandProfileId: 'brand-a' });
    expect(mockFetch.mock.calls.filter(([, options]) => !options?.method).map(([url]) => new URL(url, 'https://app.postmill.ai').searchParams.get('page')).sort()).toEqual(['1', '2']);

    fireEvent.click(screen.getByRole('button', { name: 'Unassign Shared template' }));
    await screen.findByRole('button', { name: 'Assign Shared template' });
    expect(document.querySelectorAll('[data-template-id="shared"]')).toHaveLength(1);
  });

  it('keeps cards unchanged on assignment failure and hides all actions for read-only roles', async () => {
    mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? response({}, false)
      : response(page([template('shared', 'Shared template')])));

    const { unmount } = renderBrowser();
    const assign = await screen.findByRole('button', { name: 'Assign Shared template' });
    fireEvent.click(assign);
    await waitFor(() => expect(mockToasterShow).toHaveBeenCalledWith('Failed to update brand template', 'warning'));
    expect(screen.getByRole('button', { name: 'Assign Shared template' })).toBeTruthy();
    unmount();

    renderBrowser(false);
    await screen.findByText('Shared template');
    expect(screen.queryByRole('button', { name: 'Assign Shared template' })).toBeNull();
  });

  it('offers retry after load failures and replaces broken thumbnails with a fallback', async () => {
    mockFetch.mockResolvedValueOnce(response({}, false));
    renderBrowser();
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to load brand templates.');
    mockFetch.mockResolvedValueOnce(response(page([template('broken', 'Broken preview')])));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const image = await screen.findByRole('img', { name: 'Broken preview preview' });
    fireEvent.error(image);
    expect(screen.getByText('No preview available')).toBeTruthy();
  });
});
