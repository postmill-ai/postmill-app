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
  id: 'h1',
  operation: 'video',
  status: 'completed',
  artifactUrl: '/uploads/avatar.mp4',
  fileId: 'f1',
  error: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
}) as any;

afterEach(cleanup);

describe('HeyGen RenderQueue', () => {
  it('copies the public artifact URL from a completed job', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RenderQueue jobs={[job()]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith('/uploads/avatar.mp4');
    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith('URL copied to clipboard', 'success')
    );
  });

  it('offers no link copy while rendering or without an artifact', () => {
    render(
      <RenderQueue
        jobs={[job({ id: 'h2', status: 'processing' }), job({ id: 'h3', artifactUrl: null })]}
        isLoading={false}
      />
    );
    expect(screen.queryByRole('button', { name: 'Copy Link' })).toBeNull();
  });
});
