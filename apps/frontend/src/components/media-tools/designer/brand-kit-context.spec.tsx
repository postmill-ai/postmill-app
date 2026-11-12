import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BrandKitProvider, useBrandKit } from './brand-kit-context';

const mocks = vi.hoisted(() => ({
  brands: {
    data: [
      { id: 'brand-a', name: 'A', enabled: true, isDefault: true, palette: ['#aaaaaa'], fontFamilies: ['A Font'], enforcement: { enabled: true } },
      { id: 'brand-b', name: 'B', enabled: true, isDefault: false, palette: ['#bbbbbb'], fontFamilies: ['B Font'], enforcement: { enabled: false } },
    ],
    mutate: vi.fn(),
  },
  customFonts: { fonts: [], mutate: vi.fn() },
  fontScopes: [] as unknown[],
  setBrandEnforcement: vi.fn(),
  setBrandProfileId: vi.fn(),
}));

vi.mock('@postmill-ai/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => mocks.brands,
}));
vi.mock('./panels/use-brand-fonts', () => ({
  useCustomFonts: (scope: unknown) => {
    mocks.fontScopes.push(scope);
    return mocks.customFonts;
  },
}));

const makeStore = (brandProfileId?: string | null) => {
  const state = { doc: { brandProfileId } };
  const store = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => ({
        setBrandEnforcement: mocks.setBrandEnforcement,
        setBrandProfileId: mocks.setBrandProfileId,
      }),
    },
  );
  return store;
};

describe('BrandKitProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fontScopes = [];
  });

  it('uses the explicitly selected brand instead of the default', () => {
    const { result } = renderHook(() => useBrandKit(), {
      wrapper: ({ children }) => <BrandKitProvider store={makeStore('brand-b')}>{children}</BrandKitProvider>,
    });
    expect(result.current.activeBrand?.id).toBe('brand-b');
    expect(result.current.activeBrand?.palette).toEqual(['#bbbbbb']);
    expect(mocks.setBrandEnforcement).toHaveBeenLastCalledWith(false);
    expect(mocks.fontScopes).toEqual(['brand-b']);
  });

  it('distinguishes General Mode from legacy default resolution', () => {
    const { result } = renderHook(() => useBrandKit(), {
      wrapper: ({ children }) => <BrandKitProvider store={makeStore(null)}>{children}</BrandKitProvider>,
    });
    expect(result.current.isGeneralMode).toBe(true);
    expect(result.current.activeBrand).toBeNull();
    expect(mocks.setBrandEnforcement).toHaveBeenLastCalledWith(false);
    expect(mocks.fontScopes).toEqual([null]);
  });

  it('uses the default only for legacy documents and never hides an unavailable explicit selection', () => {
    const legacy = renderHook(() => useBrandKit(), {
      wrapper: ({ children }) => <BrandKitProvider store={makeStore()}>{children}</BrandKitProvider>,
    });
    expect(legacy.result.current.activeBrand?.id).toBe('brand-a');
    expect(mocks.fontScopes).toEqual(['brand-a']);

    const missing = renderHook(() => useBrandKit(), {
      wrapper: ({ children }) => <BrandKitProvider store={makeStore('deleted-brand')}>{children}</BrandKitProvider>,
    });
    expect(missing.result.current.activeBrand).toBeNull();
    expect(missing.result.current.brandUnavailable).toBe(true);
    expect(mocks.fontScopes).toEqual(['brand-a', false]);
  });
});
