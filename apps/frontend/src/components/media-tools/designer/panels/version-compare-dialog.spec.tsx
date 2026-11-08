import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VersionCompareDialog, type DesignVersionMeta } from './version-compare-dialog';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const version: DesignVersionMeta = {
  id: 'v1',
  name: 'Launch candidate',
  auto: false,
  width: 1080,
  height: 1080,
  previewDataUrl: 'data:image/jpeg;base64,saved',
  createdAt: '2026-11-08T12:00:00.000Z',
};

const setup = (overrides: Partial<React.ComponentProps<typeof VersionCompareDialog>> = {}) => {
  const props = {
    designId: 'design-1',
    version,
    currentDoc: { mode: 'image' as const, outputs: [] },
    fetch: vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) }),
    onRestore: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<VersionCompareDialog {...props} />);
  return props;
};

describe('VersionCompareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the stored version thumbnail and renders only the current document', async () => {
    const props = setup();

    expect(await screen.findByAltText('Current')).toBeTruthy();
    expect(screen.getByAltText('Launch candidate')).toHaveProperty('src', 'data:image/jpeg;base64,saved');
    expect(props.fetch).toHaveBeenCalledTimes(1);
    expect(props.fetch).toHaveBeenCalledWith('/media/designs/preview', {
      method: 'POST',
      body: JSON.stringify({ doc: props.currentDoc }),
    });
  });

  it('falls back to the preview endpoint and restores through the supplied action', async () => {
    const props = setup({
      version: { ...version, previewDataUrl: null },
      fetch: vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) }),
    });

    expect(await screen.findByAltText('Launch candidate')).toBeTruthy();
    expect(props.fetch).toHaveBeenCalledWith('/media/designs/design-1/versions/v1/preview');

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(props.onRestore).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open and re-enables restore after a cancelled or failed restore', async () => {
    const props = setup({ onRestore: vi.fn().mockResolvedValue(false) });
    await screen.findByAltText('Current');

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(props.onRestore).toHaveBeenCalledTimes(1));
    expect(props.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a retry after a preview failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) });
    setup({ version: { ...version, previewDataUrl: null }, fetch: fetchMock });

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not render this version preview.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByAltText('Launch candidate')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
