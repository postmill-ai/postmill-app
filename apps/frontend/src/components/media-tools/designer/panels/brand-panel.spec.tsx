import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrandPanel } from './brand-panel';
import { createDesignerStore } from '../designer.store';

const brandKit = vi.hoisted(() => ({
  brands: [
    { id: 'default', name: 'Acme', enabled: true, isDefault: true },
    { id: 'other', name: 'Campaign', enabled: true, isDefault: false },
  ],
  activeBrand: { id: 'default', name: 'Acme', enabled: true, isDefault: true },
  customFonts: [],
  brandUnavailable: false,
  selectBrand: vi.fn(),
  refreshBrands: vi.fn(),
  refreshFonts: vi.fn(),
}));

vi.mock('../brand-kit-context', () => ({ useBrandKit: () => brandKit }));
vi.mock('swr', () => ({
  default: () => ({ data: { results: [] }, error: undefined, mutate: vi.fn() }),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => vi.fn() }));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org', role: 'owner' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, hasPermission: () => true }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key])) : fallback,
}));
vi.mock('./use-brand-fonts', () => ({
  useUploadCustomFont: () => ({ uploadMany: vi.fn(), uploading: false }),
  fontServerRenderable: () => true,
}));
vi.mock('../../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
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
