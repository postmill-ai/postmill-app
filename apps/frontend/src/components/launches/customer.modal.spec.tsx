import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (k: string, fallback?: string) => fallback || k,
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: vi.fn() }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('swr', () => ({ default: () => ({ data: [] }) }));

vi.mock('@postmill-ai/react/form/button', () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}));

// window.matchMedia shim lives in apps/frontend/vitest.setup.ts (Mantine's
// use-color-scheme media queries need it). jsdom also lacks ResizeObserver,
// which Mantine's ScrollArea (Autocomplete dropdown) subscribes to.
(globalThis as any).ResizeObserver =
  (globalThis as any).ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

import { CustomerModal } from './customer.modal';

describe('CustomerModal', () => {
  // Mantine throws "MantineProvider was not found in component tree" outside a
  // provider — the app tree has none, so the modal carries its own around the
  // Autocomplete. Real @mantine/core on purpose: mocking it hid the crash.
  it('renders the Mantine Autocomplete without a provider crash', () => {
    const view = render(
      <CustomerModal
        integration={{ id: 'i1' } as any}
        onClose={vi.fn()}
      />
    );
    expect(view.getByText('Select Customer')).toBeTruthy();
  });
});
