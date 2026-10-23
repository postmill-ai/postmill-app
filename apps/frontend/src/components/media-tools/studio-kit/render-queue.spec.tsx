import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));

const mockShow = vi.fn();
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/open-in-designer', () => ({
  openInDesigner: vi.fn(),
}));

import { RenderQueue } from './render-queue';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  operation: 'image',
  status: 'completed',
  artifactUrl: '/uploads/a.png',
  fileId: 'f1',
  error: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
}) as any;

afterEach(cleanup);

const mockClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
};

describe('RenderQueue', () => {
  it('renders a known status with its label', () => {
    render(<RenderQueue jobs={[job()]} isLoading={false} />);
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('survives a status it has never heard of', () => {
    // A synchronous job used to arrive as 'done' and crash the whole studio on
    // `STATUS_META[status].className`. Unknown statuses now degrade to a chip.
    expect(() =>
      render(<RenderQueue jobs={[job({ status: 'archived' })]} isLoading={false} />)
    ).not.toThrow();
    expect(screen.getByText('archived')).toBeTruthy();
  });

  it('lays out as a grid when asked', () => {
    const { container } = render(
      <RenderQueue jobs={[job()]} isLoading={false} variant="grid" />
    );
    expect(container.firstChild).toHaveProperty('className');
    expect((container.firstChild as HTMLElement).className).toContain('grid');
  });

  it('rings only the highlighted job', () => {
    render(
      <RenderQueue
        jobs={[job(), job({ id: 'j2' })]}
        isLoading={false}
        highlightJobId="j2"
      />
    );
    expect(document.getElementById('media-job-j2')!.className).toContain('ring-2');
    expect(document.getElementById('media-job-j1')!.className).not.toContain('ring-2');
  });

  it('copies the public artifact URL from a completed job', async () => {
    const writeText = mockClipboard();
    render(<RenderQueue jobs={[job({ operation: 'video', artifactUrl: '/uploads/v.mp4' })]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith('/uploads/v.mp4');
    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith('URL copied to clipboard', 'success')
    );
  });

  it('warns instead of toasting success when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RenderQueue jobs={[job()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith('Copy failed', 'warning'));
  });

  it('offers no link copy on transcripts or artifact-less jobs', () => {
    render(
      <RenderQueue
        jobs={[job({ id: 's1', operation: 'stt' }), job({ id: 's2', artifactUrl: null })]}
        isLoading={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Copy Link' })).toBeNull();
  });
});
