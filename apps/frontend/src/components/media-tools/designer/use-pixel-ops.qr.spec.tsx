import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';
import { usePixelOps } from './use-pixel-ops';

const rebakeMock = vi.hoisted(() => vi.fn(async () => ({ src: '/baked.png', fileId: 'baked-file' })));

vi.mock('./smart-filters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./smart-filters')>();
  return { ...actual, rebakeSmartFilters: rebakeMock };
});

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: vi.fn() }),
  useModals: () => ({ openModal: vi.fn() }),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const qr = {
  value: 'https://postmill.ai/qa',
  foreground: '#000000',
  background: '#FFFFFF',
  errorCorrection: 'M' as const,
  margin: 4,
};

describe('QR settings through smart-filter rebakes', () => {
  beforeEach(() => rebakeMock.mockClear());

  it('preserves editable settings on a static QR layer', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: '', type: 'image', x: 0, y: 0, width: 256, height: 256,
      rotation: 0, opacity: 1, locked: false, hidden: false,
      src: '/qr.png', qr,
    });
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().setSelectedIds([id]);
    const { result } = renderHook(() => usePixelOps({ store, fetchFn: vi.fn() }));

    await act(async () => result.current.onFilter('blur'));
    await waitFor(() => expect(store.getState().doc.outputs[0].children[0].src).toBe('/baked.png'));

    expect(rebakeMock).toHaveBeenCalled();
    expect(store.getState().doc.outputs[0].children[0].qr).toEqual(qr);
    expect(store.getState().doc.outputs[0].children[0].smartFilters).toEqual([
      { id: 'blur', params: {} },
    ]);
  });

  it('preserves editable settings on a still-image video clip', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'image');
    const track = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((item) => item.type === 'image')!;
    store.getState().addClip(0, track.id, {
      id: 'qr-clip', startMs: 0, endMs: 4000,
      x: 0, y: 0, width: 256, height: 256,
      src: '/qr.png', qr,
    });
    store.getState().setSelectedClip({ outputIndex: 0, trackId: track.id, clipId: 'qr-clip' });
    const { result } = renderHook(() => usePixelOps({ store, fetchFn: vi.fn() }));

    await act(async () => result.current.onFilter('blur'));
    const clip = () => (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((item) => item.id === track.id)!.clips[0];
    await waitFor(() => expect(clip().src).toBe('/baked.png'));

    expect(rebakeMock).toHaveBeenCalled();
    expect(clip().qr).toEqual(qr);
    expect(clip().smartFilters).toEqual([{ id: 'blur', params: {} }]);
  });
});
