import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { VersionsPanel } from './versions-panel';
import { createDesignerStore } from '../designer.store';

const fetchMock = vi.hoisted(() => vi.fn());
const openModal = vi.hoisted(() => vi.fn());
const decisionOpen = vi.hoisted(() => vi.fn());
const toasterShow = vi.hoisted(() => vi.fn());

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({ useFetch: () => fetchMock }));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal, closeAll: vi.fn() }),
  useDecisionModal: () => ({ open: decisionOpen }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({ useToaster: () => ({ show: toasterShow }) }));

const version = {
  id: 'v1',
  name: 'Launch candidate',
  auto: false,
  width: 1080,
  height: 1080,
  previewDataUrl: 'data:image/jpeg;base64,saved',
  createdAt: '2026-11-08T12:00:00.000Z',
};

const setup = () => {
  const store = createDesignerStore();
  store.setState({ designId: 'design-1' });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <VersionsPanel store={store} />
    </SWRConfig>
  );
  return store;
};

describe('VersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [version] });
    decisionOpen.mockResolvedValue(true);
  });

  it('opens comparison without loading the saved document into the store', async () => {
    const store = setup();
    const before = store.getState().doc;

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    expect(openModal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Compare version',
      size: 960,
    }));
    const modal = openModal.mock.calls[0][0];
    const dialog = modal.children(vi.fn());
    expect(dialog.props.currentDoc).toBe(before);
    expect(store.getState().doc).toBe(before);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/media/designs/design-1/versions');
  });

  it('keeps restore on the confirmation and single-history-entry path', async () => {
    const store = setup();
    await screen.findByRole('button', { name: 'Preview' });
    const nextDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((output, index) =>
        index === 0 ? { ...output, name: 'Restored output' } : output),
    };
    fetchMock.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.endsWith('/restore') ? { doc: nextDoc } : [version],
    }));
    const before = store.getState().historyIndex;

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(store.getState().doc.outputs[0].name).toBe('Restored output'));
    expect(decisionOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restore this version?' }));
    expect(store.getState().historyIndex).toBe(before + 1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/versions/v1/restore'))).toBe(true);
  });

  it('restores a differing document over a frozen output with one history entry', async () => {
    const store = setup();
    store.getState().setOutputFrozen(0, true);
    await screen.findByRole('button', { name: 'Preview' });
    const nextDoc = {
      ...store.getState().doc,
      outputs: store.getState().doc.outputs.map((output, index) =>
        index === 0 ? { ...output, name: 'Server restored output', frozen: true } : output),
    };
    fetchMock.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.endsWith('/restore') ? { doc: nextDoc } : [version],
    }));
    const before = store.getState().historyIndex;

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(store.getState().doc.outputs[0].name).toBe('Server restored output'));
    expect(store.getState().historyIndex).toBe(before + 1);
    expect(store.getState().historyLabels.at(-1)).toBe('Restore version');
    expect(toasterShow).toHaveBeenCalledWith('Version restored', 'success');
  });

  it.each([
    { outcome: 'cancelled', approved: false },
    { outcome: 'failed', approved: true },
  ])('keeps comparison open through the real wrapper when restore is $outcome', async ({ approved }) => {
    setup();
    fetchMock.mockImplementation((url: string) => Promise.resolve({
      ok: approved ? !String(url).endsWith('/restore') : true,
      json: async () => [version],
      blob: async () => new Blob(['png']),
    }));
    decisionOpen.mockResolvedValue(approved);

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    const close = vi.fn();
    const modal = openModal.mock.calls[0][0];
    const dialog = render(modal.children(close));
    await waitFor(() => expect((dialog.getAllByRole('button', { name: 'Restore' }).at(-1)! as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(dialog.getAllByRole('button', { name: 'Restore' }).at(-1)!);

    await waitFor(() => expect(decisionOpen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((dialog.getAllByRole('button', { name: 'Restore' }).at(-1)! as HTMLButtonElement).disabled).toBe(false));
    expect(close).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/versions/v1/restore'))).toBe(approved);
  });
});
