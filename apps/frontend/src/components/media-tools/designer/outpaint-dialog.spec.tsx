import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OutpaintDialog } from './outpaint-dialog';
import type { OutpaintCandidate } from './outpaint';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const candidate = (): OutpaintCandidate => ({
  kind: 'image',
  before: { id: 'image-1', type: 'image', src: '/before.png' } as any,
  outputIndex: 0,
  history: undefined,
  sourceUrl: '/before.png',
  assetUrl: '/expanded.png',
  sourceNatural: { width: 800, height: 450 },
  resultNatural: { width: 1600, height: 900 },
  mode: 'left',
});

describe('OutpaintDialog', () => {
  it('locks duplicate submissions, reviews the result, and applies once', async () => {
    let resolvePrepare!: (value: OutpaintCandidate) => void;
    const onPrepare = vi.fn(() => new Promise<OutpaintCandidate>((resolve) => {
      resolvePrepare = resolve;
    }));
    const onApply = vi.fn(async () => true);
    const onCancel = vi.fn();
    render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={onPrepare}
        onApply={onApply}
        onCancel={onCancel}
      />
    );

    const expand = screen.getByRole('button', { name: 'Expand' });
    fireEvent.click(expand);
    fireEvent.click(expand);
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(expand).toHaveProperty('disabled', true);

    resolvePrepare(candidate());
    expect(await screen.findByRole('img', { name: 'After' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply result' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps a preparation error visible without closing', async () => {
    const onPrepare = vi.fn(async () => {
      throw new Error('Provider unavailable');
    });
    render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={onPrepare}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Provider unavailable');
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveProperty('disabled', false);
  });
});
