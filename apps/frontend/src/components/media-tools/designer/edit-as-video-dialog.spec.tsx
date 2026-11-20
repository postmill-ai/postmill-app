import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditAsVideoDialog } from './edit-as-video-dialog';
import { createDesignerStore } from './designer.store';
import type { DesignAutosave } from './designer-autosave';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    ),
}));

const response = (body: unknown, ok = true) => ({ ok, json: vi.fn(async () => body) });
const videoDoc = {
  version: 14,
  mode: 'video' as const,
  outputs: [{
    id: 'output-1', formatId: 'custom', name: 'Square', width: 400, height: 400,
    fps: 30, durationMs: 2000, tracks: [],
  }],
};
const conversionResult = {
  design: { id: 'video-1', name: 'Burger — Video', doc: videoDoc },
  summary: {
    outputs: [{
      outputId: 'output-1', name: 'Square', pageCount: 1, pageDurationMs: 2000,
      durationMs: 2000, hiddenLayerCount: 1,
      fallbacks: [{
        outputId: 'output-1', pageNumber: 0, sourceIds: ['icon-1'],
        sourceTypes: ['icon'], reason: 'icon layers have no editable clip counterpart',
      }],
    }],
    totalPages: 1,
    totalFallbacks: 1,
  },
};

const makeStore = () => {
  const store = createDesignerStore(400, 400);
  store.getState().loadDesign({
    version: 14,
    mode: 'image',
    outputs: [{
      id: 'output-1', formatId: 'custom', name: 'Square', width: 400, height: 400,
      background: '#ffffff',
      children: [{
        id: 'title', type: 'text', text: 'Burger', x: 0, y: 0, width: 200, height: 50,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }],
  }, 'source-1', 'Burger');
  return store;
};

const makeAutosave = () => ({
  save: vi.fn(),
  saveNow: vi.fn(async () => 'persisted' as const),
  ensureCreated: vi.fn(async () => 'source-1'),
  createInFlight: vi.fn(() => null),
});

describe('EditAsVideoDialog', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('cancel performs no save or conversion request', () => {
    const store = makeStore();
    const autosave = makeAutosave();
    const fetchFn = vi.fn();
    const onClose = vi.fn();
    render(<EditAsVideoDialog
      store={store} designAutosave={autosave} fetchFn={fetchFn}
      onConverted={vi.fn()} onClose={onClose}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(autosave.saveNow).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('saves, converts at the selected duration, loads the result and shows its summary', async () => {
    const store = makeStore();
    const autosave = makeAutosave();
    const fetchFn = vi.fn(async () => response(conversionResult));
    const onConverted = vi.fn();
    const onClose = vi.fn();
    render(<EditAsVideoDialog
      store={store} designAutosave={autosave as DesignAutosave} fetchFn={fetchFn as any}
      onConverted={onConverted} onClose={onClose}
    />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Page duration (seconds)' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create video design' }));

    await waitFor(() => expect(onConverted).toHaveBeenCalledWith(conversionResult.design));
    expect(fetchFn).toHaveBeenCalledWith('/media/designs/source-1/convert-to-video', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pageDurationMs: 2000 }),
      headers: { 'X-Idempotency-Key': expect.any(String) },
    }));
    expect(await screen.findByText('Your video design is ready')).toBeTruthy();
    expect(screen.getByText(/Scene 1: icon rasterized/)).toBeTruthy();
    expect(screen.getByText('1 hidden layers retained on hidden tracks.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reuses the same idempotency key after a failed request', async () => {
    const store = makeStore();
    const autosave = makeAutosave();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({ message: 'Temporary failure' }, false))
      .mockResolvedValueOnce(response(conversionResult));
    render(<EditAsVideoDialog
      store={store} designAutosave={autosave as DesignAutosave} fetchFn={fetchFn as any}
      onConverted={vi.fn()} onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Create video design' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Temporary failure');
    fireEvent.click(screen.getByRole('button', { name: 'Create video design' }));
    await screen.findByText('Your video design is ready');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][1].headers['X-Idempotency-Key']).toBe(
      fetchFn.mock.calls[1][1].headers['X-Idempotency-Key'],
    );
  });

  it('does not call the conversion endpoint when the source save fails', async () => {
    const store = makeStore();
    store.getState().setDesignName('Unsaved name');
    const autosave = makeAutosave();
    autosave.saveNow.mockResolvedValue('failed');
    const fetchFn = vi.fn();
    render(<EditAsVideoDialog
      store={store} designAutosave={autosave as DesignAutosave} fetchFn={fetchFn}
      onConverted={vi.fn()} onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Create video design' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Save the current design/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('ignores duplicate clicks while conversion is pending', async () => {
    const store = makeStore();
    const autosave = makeAutosave();
    let resolveRequest: ((value: unknown) => void) | undefined;
    const fetchFn = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<EditAsVideoDialog
      store={store} designAutosave={autosave as DesignAutosave} fetchFn={fetchFn as any}
      onConverted={vi.fn()} onClose={vi.fn()}
    />);
    const button = screen.getByRole('button', { name: 'Create video design' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    resolveRequest!(response(conversionResult));
    await screen.findByText('Your video design is ready');
  });
});
