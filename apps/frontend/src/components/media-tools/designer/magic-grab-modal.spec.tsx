import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { openMagicGrabReview } from './magic-grab-modal';
import { cleanupMagicGrabCandidate } from './magic-grab';

vi.mock('./magic-grab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./magic-grab')>();
  return { ...actual, cleanupMagicGrabCandidate: vi.fn(async () => undefined) };
});

const candidate = {
  source: { url: '/original.png' },
  asset: { url: '/cutout.png' },
  background: { url: '/background.png', fileId: 'background-file' },
} as any;
const makeModals = () => {
  const openModal = vi.fn();
  return { openModal, modals: { openModal } as any };
};

describe('openMagicGrabReview', () => {
  it('cleans the background on an unapplied close but retains it after Apply', async () => {
    const first = makeModals();
    openMagicGrabReview({
      modals: first.modals,
      title: 'Magic Grab',
      fetch: vi.fn(),
      candidate,
      onApply: vi.fn(),
    });
    const config = first.openModal.mock.calls[0][0];
    render(config.children(vi.fn()));
    config.onClose();
    expect(cleanupMagicGrabCandidate).toHaveBeenCalledWith(expect.any(Function), candidate);

    vi.mocked(cleanupMagicGrabCandidate).mockClear();
    const second = makeModals();
    openMagicGrabReview({
      modals: second.modals,
      title: 'Magic Grab',
      fetch: vi.fn(),
      candidate,
      onApply: vi.fn().mockResolvedValue(true),
    });
    const appliedConfig = second.openModal.mock.calls[0][0];
    render(appliedConfig.children(vi.fn()));
    const dialogProps = appliedConfig.children(vi.fn()).props;
    await dialogProps.onApply();
    appliedConfig.onClose();
    expect(cleanupMagicGrabCandidate).not.toHaveBeenCalled();
  });
});
