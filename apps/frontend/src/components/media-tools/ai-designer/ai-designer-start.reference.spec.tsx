import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('./ai-designer-attachments', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ai-designer-attachments')>(),
  uploadAiDesignerAttachments: vi.fn(async () => ({
    references: [],
    documents: [{ fileId: 'doc-1', name: 'brief.pdf' }],
  })),
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

  it('passes directly attached document IDs in the start payload', async () => {
    render(<AiDesignerStart onStart={onStart} isConnected />);

    fireEvent.click(screen.getByRole('button', { name: 'Prompt', exact: true }));
    fireEvent.change(screen.getByLabelText('Attach files'), {
      target: { files: [new File(['brief'], 'brief.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('brief.pdf')).toBeTruthy();
    fireEvent.click(screen.getByText('Instagram Post'));
    fireEvent.change(screen.getByLabelText('Prompt', { exact: true }), {
      target: { value: 'Make a laptop mockup' },
    });
    fireEvent.click(screen.getByText('Start designing'));

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onStart.mock.calls[0][0].config.attachmentFileIds).toEqual(['doc-1']);
  });
});
