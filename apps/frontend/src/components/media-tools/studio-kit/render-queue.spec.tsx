import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
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
});
