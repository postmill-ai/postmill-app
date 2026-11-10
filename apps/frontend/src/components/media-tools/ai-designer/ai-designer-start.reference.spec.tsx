import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AiDesignerStart } from './ai-designer-start';

const onStart = vi.fn();
const reference = {
  source: 'file',
  fileId: 'logo-1',
  url: '/uploads/org/logo.png',
  thumbnail: '/uploads/org/logo.png',
  name: 'Company logo',
  type: 'image',
};

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));
vi.mock('@postmill-ai/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => ({ data: [] }),
}));
vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: ({ onConfirm }: { onConfirm: (items: unknown[]) => void }) => ({
    open: () => onConfirm([reference]),
    close: vi.fn(),
    element: null,
  }),
}));

describe('AI Designer reference roles', () => {
  beforeEach(() => onStart.mockReset());

  it('marks a reference as an original logo in the start payload', async () => {
    render(<AiDesignerStart onStart={onStart} isConnected />);

    fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
    const toggle = await screen.findByRole('button', { name: 'Use reference as logo' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByText('Instagram Post'));
    fireEvent.click(screen.getByText('Start designing'));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].config).toMatchObject({
      logoFileId: 'logo-1',
      referenceFileIds: ['logo-1'],
    });
  });
});
