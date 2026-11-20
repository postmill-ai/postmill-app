import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { BrandAssets } from './brand-assets';
import type { Brand } from './use-brands';

const fetchMock = vi.fn();
const toasterShow = vi.fn();
const scrollIntoView = vi.fn();
let logoPickerOnSelect: ((item: { fileId: string }) => void) | undefined;

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: toasterShow }) }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, any>) => {
    const escapeValue = params?.interpolation?.escapeValue !== false;
    return Object.entries(params || {})
      .filter(([key]) => key !== 'interpolation')
      .reduce((text, [key, value]) => text.replaceAll(
        `{{${key}}}`,
        escapeValue ? String(value).replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('/', '&#x2F;') : String(value),
      ), fallback);
  },
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, hasPermission: () => true }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: (options: { importName?: string; onSelect: (item: { fileId: string }) => void }) => {
    if (options.importName === 'brand-logo') logoPickerOnSelect = options.onSelect;
    return { open: vi.fn(), element: null };
  },
}));
vi.mock('@postmill-ai/react/form/slider', () => ({
  Slider: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock('@postmill-ai/frontend/components/ui/overflow-tabs', () => ({
  OverflowTabs: ({ items }: { items: Array<{ key: string; label: ReactNode }> }) => (
    <nav>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => {
            window.history.replaceState(null, '', `#${item.key}`);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  ),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/designer/panels/font-catalog-picker', () => ({
  FontCatalogPicker: ({ onPick }: { onPick: (family: string) => void }) => (
    <button onClick={() => onPick('Inter')}>Pick Inter</button>
  ),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/designer/panels/use-brand-fonts', () => ({
  fontServerRenderable: () => true,
  useCustomFonts: () => ({
    fonts: [{ fileId: 'custom-font', family: 'Uploaded Sans', path: '/font.ttf', weights: [400] }],
    mutate: vi.fn(),
  }),
  useUploadCustomFont: () => ({ uploadMany: vi.fn(), uploading: false }),
}));

const initial: Brand = {
  id: 'brand-1',
  name: 'Brand',
  enabled: true,
  isDefault: true,
  createdAt: '2026-01-01',
  palette: ['#111111', '#222222', '#222222'],
  colorRoles: [{ index: 1, hex: '#222222', role: 'accent' }],
  logoFileIds: ['legacy-logo', 'main-logo'],
  logoRoles: [{ fileId: 'main-logo', role: 'main' }],
  fontFamilies: ['Legacy Sans'],
  customFonts: [],
  preferredFormats: [],
  assets: [],
  enforcement: {},
};

const response = (body: unknown) => ({ ok: true, json: vi.fn().mockResolvedValue(body) });

const renderAssets = (brand: Brand = initial) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <BrandAssets brandId="brand-1" initial={brand} />
  </SWRConfig>
);

describe('BrandAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logoPickerOnSelect = undefined;
    window.history.replaceState(null, '', '/brands/brand-1/kit');
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    fetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PUT') return Promise.resolve(response({}));
      if (url.startsWith('/files/by-ids')) return Promise.resolve(response({ results: [] }));
      if (url.startsWith('/media/design-templates')) return Promise.resolve(response({ templates: [], total: 0 }));
      return Promise.resolve(response({}));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps every section mounted and retains unsaved roles across deep-link navigation', async () => {
    renderAssets();
    expect(screen.getByText('Brand fonts')).toBeTruthy();
    expect(screen.getByText('Preferred formats')).toBeTruthy();
    expect(screen.getByText('Legacy Sans')).toBeTruthy();
    expect(screen.getByText('Uploaded Sans')).toBeTruthy();
    for (const section of ['colors', 'fonts', 'logos', 'images', 'formats', 'templates']) {
      expect(document.getElementById(section)).not.toBeNull();
    }

    const colorRole = screen.getByRole('combobox', { name: 'Colour role for #111111' });
    fireEvent.change(colorRole, { target: { value: 'primary' } });
    expect(screen.getByRole('status', { name: 'Brand Kit save status' }).textContent).toBe('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Fonts' }));

    expect((colorRole as HTMLSelectElement).value).toBe('primary');
    expect(screen.getByRole('status', { name: 'Brand Kit save status' }).textContent).toBe('Unsaved changes');
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/brands/brand-1', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(fetchMock.mock.calls.find(([url, options]) => url === '/brands/brand-1' && options?.method === 'PUT')![1].body);
    expect(body.palette).toEqual([
      { hex: '#111111', role: 'primary' },
      { hex: '#222222', role: 'accent' },
      '#222222',
    ]);
    expect(body.logoFileIds).toEqual(['legacy-logo', { fileId: 'main-logo', role: 'main' }]);
    expect(body.fontFamilies).toEqual(['Legacy Sans']);
    expect(screen.getByRole('status', { name: 'Brand Kit save status' }).textContent).toBe('All changes saved');
  });

  it('opens the initial hash and adds each catalog family only once', () => {
    window.history.replaceState(null, '', '/brands/brand-1/kit#fonts');
    renderAssets();
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Pick Inter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Inter' }));
    expect(screen.getAllByText('Inter')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Inter' })).toBeTruthy();
  });

  it('assigns an unassigned legacy logo without changing logo order', async () => {
    renderAssets();
    fireEvent.change(screen.getByRole('combobox', { name: 'Logo role for legacy-logo' }), { target: { value: 'icon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/brands/brand-1', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(fetchMock.mock.calls.find(([url, options]) => url === '/brands/brand-1' && options?.method === 'PUT')![1].body);
    expect(body.logoFileIds).toEqual([
      { fileId: 'legacy-logo', role: 'icon' },
      { fileId: 'main-logo', role: 'main' },
    ]);
  });

  it('renders literal special characters in logo-role accessible names', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(response(
      url.startsWith('/files/by-ids')
        ? { results: [{ id: 'legacy-logo', path: '/logo.png', name: 'Logo & icon.png' }] }
        : { templates: [], total: 0 },
    )));
    renderAssets({ ...initial, logoFileIds: ['legacy-logo'], logoRoles: [] });

    expect(await screen.findByRole('combobox', { name: 'Logo role for Logo & icon.png', exact: true })).toBeTruthy();
  });

  it('replaces a first Main logo at the same index without changing the remaining order', async () => {
    renderAssets({
      ...initial,
      logoFileIds: ['main-logo', 'legacy-logo'],
      logoRoles: [{ fileId: 'main-logo', role: 'main' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace', exact: true }));
    expect(logoPickerOnSelect).toBeDefined();
    act(() => logoPickerOnSelect!({ fileId: 'replacement-logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/brands/brand-1', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(fetchMock.mock.calls.find(([url, options]) => url === '/brands/brand-1' && options?.method === 'PUT')![1].body);
    expect(body.logoFileIds).toEqual([
      { fileId: 'replacement-logo', role: 'main' },
      'legacy-logo',
    ]);
  });
});
