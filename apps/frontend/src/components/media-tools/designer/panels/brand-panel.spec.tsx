import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrandPanel } from './brand-panel';
import { createDesignerStore } from '../designer.store';
import type { Brand } from '@postmill-ai/frontend/components/settings/brand/use-brands';

const fetchMock = vi.fn();
const activeBrand = vi.hoisted(() => ({
  id: 'brand-1',
  name: 'Acme',
  enabled: true,
  isDefault: true,
  createdAt: '2026-01-01',
  palette: ['#000000', '#112233', '#ffffff'],
  colorRoles: [
    { index: 1, hex: '#112233', role: 'primary' },
    { index: 2, hex: '#ffffff', role: 'background' },
  ],
  logoFileIds: ['f1', 'f2'],
  logoRoles: [{ fileId: 'f1', role: 'main' }],
  fontFamilies: ['Legacy Sans'],
  customFonts: [],
  preferredFormats: [],
  assets: [],
  enforcement: { enabled: false },
})) as Brand;
const brandKit = vi.hoisted(() => ({
  brands: [
    activeBrand,
    { id: 'other', name: 'Campaign', enabled: true, isDefault: false },
  ],
  activeBrand,
  customFonts: [],
  brandUnavailable: false,
  selectBrand: vi.fn(),
  refreshBrands: vi.fn(),
  refreshFonts: vi.fn(),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1', role: 'owner' }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: vi.fn() }) }));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key])) : fallback,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, hasPermission: () => true }),
}));
vi.mock('@postmill-ai/frontend/components/shared/provider-icon', () => ({ default: () => null }));
vi.mock('swr', () => ({ default: () => ({ data: { pages: 1, results: [] }, mutate: vi.fn() }) }));
vi.mock('../brand-kit-context', () => ({ useBrandKit: () => brandKit }));
vi.mock('./use-brand-fonts', () => ({
  useUploadCustomFont: () => ({ uploadMany: vi.fn(), uploading: false }),
  fontServerRenderable: () => true,
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));
vi.mock('./brand-actions', () => ({
  addBrandLogo: vi.fn(),
  applyBrandColor: vi.fn(),
  applyBrandFont: vi.fn(),
}));

describe('BrandPanel mode descriptions', () => {
  it('explains General Mode and the default brand without changing selection', () => {
    const store = createDesignerStore();
    render(<BrandPanel store={store} />);

    expect(screen.getByRole('option', { name: 'General Mode — No brand rules' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Acme — Default' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Campaign' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Brand / General Mode' }), {
      target: { value: '' },
    });
    expect(brandKit.selectBrand).toHaveBeenCalledWith(null);
  });
});

describe('BrandPanel visual role persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });
  });

  it('keeps every color and logo role when saving Brand Enforcement', async () => {
    render(<BrandPanel store={createDesignerStore()} />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/brands/brand-1', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.palette).toEqual([
      '#000000',
      { hex: '#112233', role: 'primary' },
      { hex: '#ffffff', role: 'background' },
    ]);
    expect(body.logoFileIds).toEqual([{ fileId: 'f1', role: 'main' }, 'f2']);
    expect(body.fontFamilies).toEqual(['Legacy Sans']);
    expect(body.enforcement).toEqual({ enabled: true });
  });
});
