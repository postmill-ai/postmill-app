import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: true, mutate: vi.fn() }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''))
        : fallback,
}));

let mockMediaJobs: any = { data: undefined, isLoading: true, error: undefined, mutate: vi.fn() };
vi.mock('../hooks/useMediaJobs', () => ({
  useMediaJobs: () => mockMediaJobs,
}));

import { MediaQueueWidget } from './media.queue';

const makeJobs = (overrides: Partial<any>[] = []) => ({
  jobs: [
    {
      id: 'job-1',
      provider: 'heygen',
      operation: 'video',
      status: 'completed',
      artifactUrl: 'https://example.com/result.png',
      error: null,
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      ...overrides[0],
    },
    {
      id: 'job-2',
      provider: 'runway',
      operation: 'text-to-video',
      status: 'processing',
      artifactUrl: null,
      error: null,
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      ...overrides[1],
    },
    {
      id: 'job-3',
      provider: 'sora',
      operation: 'video',
      status: 'failed',
      artifactUrl: null,
      error: 'Generation failed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      ...overrides[2],
    },
  ],
  counts: { pending: 1, processing: 2, failed7d: 3 },
});

describe('MediaQueueWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaJobs = { data: undefined, isLoading: true, error: undefined, mutate: vi.fn() };
  });

  it('renders a list skeleton while loading', () => {
    render(<MediaQueueWidget />);

    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the empty state when there are no jobs', () => {
    mockMediaJobs = {
      data: { jobs: [], counts: { pending: 0, processing: 0, failed7d: 0 } },
      isLoading: false,
    };
    render(<MediaQueueWidget />);

    expect(screen.getByText('No media jobs')).toBeTruthy();
    expect(screen.getByText('Render jobs from media studios will show here.')).toBeTruthy();
  });

  it('renders counts and job rows when data is available', () => {
    mockMediaJobs = { data: makeJobs(), isLoading: false };
    render(<MediaQueueWidget />);

    expect(screen.getByText((_, el) => el?.textContent === '1 pending')).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === '2 processing')).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === '3 failed')).toBeTruthy();

    expect(screen.getByRole('img', { name: 'heygen icon' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'runway icon' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'sora icon' })).toBeTruthy();

    expect(screen.getAllByText('video').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('text-to-video')).toBeTruthy();

    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getAllByText('processing').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('failed').length).toBeGreaterThanOrEqual(2);

    expect(screen.getByText('Generation failed')).toBeTruthy();
  });

  it('navigates to the provider studio when a job row is clicked', () => {
    mockMediaJobs = { data: makeJobs(), isLoading: false };
    render(<MediaQueueWidget />);

    fireEvent.click(screen.getByRole('img', { name: 'heygen icon' }).closest('button')!);
    expect(mockPush).toHaveBeenCalledWith('/media/heygen');
  });

  it('does not show the failed count pill when failed7d is zero', () => {
    mockMediaJobs = {
      data: {
        jobs: [
          {
            id: 'job-1',
            provider: 'luma',
            operation: 'image',
            status: 'completed',
            artifactUrl: null,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
        counts: { pending: 0, processing: 0, failed7d: 0 },
      },
      isLoading: false,
    };
    render(<MediaQueueWidget />);

    expect(screen.queryByText('0 failed')).toBeNull();
  });

  it('renders an artifact thumbnail when the URL is an image or video', () => {
    mockMediaJobs = {
      data: {
        jobs: [
          {
            id: 'job-1',
            provider: 'd-id',
            operation: 'video',
            status: 'completed',
            artifactUrl: 'data:video/mp4;base64,AAAA',
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
        counts: { pending: 0, processing: 0, failed7d: 0 },
      },
      isLoading: false,
    };
    const { container } = render(<MediaQueueWidget />);

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('data:video/mp4;base64,AAAA');
  });
});
