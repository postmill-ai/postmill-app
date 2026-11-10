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
  it('locks duplicate submissions, applies once, and retains the referenced result', async () => {
    let resolvePrepare!: (value: OutpaintCandidate) => void;
    const onPrepare = vi.fn(() => new Promise<OutpaintCandidate>((resolve) => {
      resolvePrepare = resolve;
    }));
    const onApply = vi.fn(async () => true);
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={onPrepare}
        onApply={onApply}
        onDiscard={onDiscard}
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
    view.unmount();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('discards a reviewed result when changing settings without repeating cleanup on unmount', async () => {
    const onDiscard = vi.fn();
    const view = render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={vi.fn(async () => candidate())}
        onApply={vi.fn()}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByRole('img', { name: 'After' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change settings' }));
    expect(onDiscard).toHaveBeenCalledOnce();
    view.unmount();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('discards a stale result and returns to settings when Apply fails', async () => {
    const onDiscard = vi.fn();
    render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={vi.fn(async () => candidate())}
        onApply={vi.fn(async () => false)}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply result' }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('design changed');
  });

  it('discards a result that arrives after the dialog is closed during preparation', async () => {
    let resolvePrepare!: (value: OutpaintCandidate) => void;
    const onDiscard = vi.fn();
    const view = render(
      <OutpaintDialog
        pageWidth={1000}
        pageHeight={500}
        onPrepare={vi.fn(() => new Promise<OutpaintCandidate>((resolve) => {
          resolvePrepare = resolve;
        }))}
        onApply={vi.fn()}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    view.unmount();
    resolvePrepare(candidate());
    await waitFor(() => expect(onDiscard).toHaveBeenCalledOnce());
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
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Provider unavailable');
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveProperty('disabled', false);
  });
});
