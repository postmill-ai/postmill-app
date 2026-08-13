import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
const mockToasterShow = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('@postmill-ai/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => ({ data: [] }),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/media-selector-modal', () => ({
  MediaSelectorModal: () => <div data-testid="media-selector-mock" />,
}));

import { AiDesignerStart } from './ai-designer-start';

// Round 7 C5: the backend addresses an output by `custom-${width}x${height}`,
// so two identical custom sizes collapsed to ONE output — the second entry was
// silently unreachable for per-format critiques and revise targeting.
describe('AI Designer custom sizes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The panel is collapsed until the "Custom sizes" card opens it — that card
  // replaced the old `custom` preset, which pretended to be a 1080×1080 size.
  const openCustomSizes = () => {
    const toggle = screen.getByRole('button', { name: /Custom sizes/i });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  };

  const addSize = (width: string, height: string) => {
    openCustomSizes();
    fireEvent.change(screen.getByLabelText('Custom width'), {
      target: { value: width },
    });
    fireEvent.change(screen.getByLabelText('Custom height'), {
      target: { value: height },
    });
    fireEvent.click(screen.getByText('Add'));
  };

  it('refuses to add the same custom size twice and says why', async () => {
    const onStart = vi.fn();
    render(<AiDesignerStart onStart={onStart} isConnected />);

    addSize('1080', '1080');
    addSize('1080', '1080');

    expect(screen.getAllByLabelText('Remove custom size')).toHaveLength(1);
    expect(mockToasterShow).toHaveBeenCalledWith(
      'That custom size is already added',
      'warning'
    );

    fireEvent.click(screen.getByText('Start designing'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].config.customSizes).toEqual([
      { width: 1080, height: 1080, name: '1080×1080' },
    ]);
  });

  it('still adds genuinely different sizes', async () => {
    const onStart = vi.fn();
    render(<AiDesignerStart onStart={onStart} isConnected />);

    addSize('1080', '1080');
    addSize('1080', '1350');

    expect(screen.getAllByLabelText('Remove custom size')).toHaveLength(2);

    fireEvent.click(screen.getByText('Start designing'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].config.customSizes).toEqual([
      { width: 1080, height: 1080, name: '1080×1080' },
      { width: 1080, height: 1350, name: '1080×1350' },
    ]);
  });

  it('tells the user references only guide the brief', () => {
    render(<AiDesignerStart onStart={vi.fn()} isConnected />);

    expect(
      screen.getByText(/References guide the brief/i)
    ).toBeTruthy();
  });
});
