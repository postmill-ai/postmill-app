import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { DesignTemplate, TemplatesPanel } from './templates-panel';

const mockFetch = vi.fn();
const mockOpenModal = vi.fn();
const mockDecisionOpen = vi.fn();
const mockToasterShow = vi.fn();
const mockT = (_key: string, fallback: string, params?: Record<string, any>) =>
  Object.entries(params || {}).filter(([key]) => key !== 'interpolation').reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    fallback,
  );

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => mockFetch }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockOpenModal }),
  useDecisionModal: () => ({ open: mockDecisionOpen }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({ useT: () => mockT }));
vi.mock('@postmill-ai/frontend/components/media-tools/designer/brand-kit-context', () => ({
  useBrandKit: () => ({ activeBrand: { id: 'brand-a' } }),
}));
vi.mock('../brand-kit-context', () => ({ useBrandKit: () => ({ activeBrand: { id: 'brand-a' } }) }));
vi.mock('use-debounce', () => ({ useDebounce: (value: string) => [value, {}] }));
vi.mock('../stage-thumbnail', () => ({ captureStageThumbnail: vi.fn() }));

const template = (id: string, name = id, extra: Partial<DesignTemplate> = {}): DesignTemplate => ({
  id,
  name,
  doc: { mode: 'image' },
  isSystem: false,
  category: 'Social',
  thumbnail: `/uploads/${id}.png`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

const makeStore = () => {
  const state = {
    designName: 'Current',
    templateId: null,
    doc: { mode: 'image', outputs: [{ id: 'out', formatId: 'ig-post', width: 1080, height: 1080, children: [] }] },
    loadDesign: vi.fn(),
    setTemplateId: vi.fn(),
  };
  return { getState: () => state } as any;
};

const renderPanel = (store = makeStore(), onClose = vi.fn(), guard = vi.fn().mockResolvedValue(true)) => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TemplatesPanel store={store} onClose={onClose} guard={guard} showSaveCurrent={false} />
    </SWRConfig>,
  );
  return { store, onClose, guard };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockDecisionOpen.mockResolvedValue(true);
});

describe('TemplatesPanel', () => {
  it('uses full-library query/sort/folder parameters and deduplicates loaded pages', async () => {
    const records = Array.from({ length: 25 }, (_, index) => template(`t-${index + 1}`, `Template ${index + 1}`));
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/media/design-templates/folders') return response([]);
      const request = new URL(url, 'https://app.postmill.ai');
      const query = request.searchParams.get('query');
      const filtered = query ? [template('unloaded', 'Launch template', { category: 'custom', thumbnail: undefined })] : records;
      const page = Number(request.searchParams.get('page'));
      const start = (page - 1) * 24;
      return response({
        templates: filtered.slice(start, start + 24), total: filtered.length, page, limit: 24,
        categories: [{ key: 'ig-post', label: 'IG Post' }, { key: 'custom', label: 'Custom' }], unfiledCount: 2,
      });
    });
    renderPanel();

    expect((await screen.findAllByRole('listitem')).length).toBe(24);
    const initial = new URL(mockFetch.mock.calls.find(([url]) => String(url).startsWith('/media/design-templates?'))![0], 'https://app.postmill.ai');
    expect(initial.searchParams.get('brandId')).toBe('brand-a');
    expect(initial.searchParams.get('sort')).toBe('newest');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
    expect(new Set(screen.getAllByRole('listitem').map((card) => card.getAttribute('data-template-id'))).size).toBe(25);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), { target: { value: ' launch ' } });
    expect(await screen.findByText('Launch template')).toBeTruthy();
    expect(screen.getByText('No preview available')).toBeTruthy();
    expect(screen.getAllByText('Custom').length).toBeGreaterThan(0);
    let last = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
    expect(last.searchParams.get('query')).toBe('launch');
    expect(last.searchParams.get('page')).toBe('1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'recent' } });
    await waitFor(() => {
      last = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
      expect(last.searchParams.get('sort')).toBe('recent');
    });
    fireEvent.click(screen.getByRole('button', { name: 'No folder' }));
    await waitFor(() => {
      last = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
      expect(last.searchParams.get('folderId')).toBe('none');
    });
  });

  it('sends the server category filter from the canonical category tabs', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/media/design-templates/folders') return response([]);
      return response({
        templates: [template('t1', 'Hero', { category: 'instagram-post' })], total: 1, page: 1, limit: 24,
        categories: [{ key: 'ig-post', label: 'IG Post' }], unfiledCount: 0,
      });
    });
    renderPanel();
    expect((await screen.findAllByText('IG Post')).length).toBeGreaterThan(0);
    const tab = [...document.querySelectorAll<HTMLButtonElement>('button[data-overflow-slot="inline"]')]
      .find((button) => button.textContent === 'IG Post');
    expect(tab).toBeDefined();
    fireEvent.click(tab!);
    await waitFor(() => {
      const last = new URL(mockFetch.mock.calls.at(-1)![0], 'https://app.postmill.ai');
      expect(last.searchParams.get('category')).toBe('ig-post');
    });
  });

  it('previews and applies through accessible overlay actions, recording the source template', async () => {
    const full = template('t1', 'Q&A 1/2');
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/media/design-templates/folders') return response([]);
      if (url === '/media/design-templates/t1') return response(full);
      if (url === '/media/designs' && options?.method === 'POST') return response({ id: 'new-design' });
      return response({ templates: [full], total: 1, page: 1, limit: 24, categories: [], unfiledCount: 0 });
    });
    const { store, onClose, guard } = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Preview Q&A 1/2' }));
    expect(mockOpenModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Q&A 1/2', size: 900 }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply template Q&A 1/2' }));

    await waitFor(() => expect(store.getState().loadDesign).toHaveBeenCalled());
    const post = mockFetch.mock.calls.find(([url, options]) => url === '/media/designs' && (options as RequestInit)?.method === 'POST');
    expect(JSON.parse(String(post![1].body))).toMatchObject({ name: 'Q&A 1/2', sourceTemplateId: 't1' });
    expect(guard).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
