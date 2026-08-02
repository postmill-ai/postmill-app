import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), fallback)
      : fallback,
}));

const mockReplace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/media/queue',
  useSearchParams: () => searchParams,
}));

// Captures the status the page asks the hook for, so the URL → request wiring
// is asserted rather than assumed.
let requestedStatus: string | undefined;
let queueState: any;
let widgetState: any;
vi.mock('@postmill-ai/frontend/components/dashboard/hooks/useMediaJobs', () => ({
  useMediaJobsQueue: (status?: string) => {
    requestedStatus = status;
    return queueState;
  },
  useMediaJobs: () => widgetState,
}));

// RenderQueue pulls in the composer, modals and toaster; the queue page's job is
// the counts, the filter and paging, so stand it in.
vi.mock('@postmill-ai/frontend/components/media-tools/studio-kit/render-queue', () => ({
  RenderQueue: ({ jobs, variant, highlightJobId }: any) => (
    <div data-testid="render-queue" data-variant={variant} data-highlight={highlightJobId ?? ''}>
      {(jobs ?? []).map((j: any) => (
        <div key={j.id} data-testid="queue-job">
          {j.id}
        </div>
      ))}
    </div>
  ),
}));

import { MediaQueue, MediaQueuePanel } from './media-queue';

const job = (id: string, status = 'completed') => ({
  id,
  provider: 'heygen',
  operation: 'video',
  status,
  artifactUrl: '/uploads/a.mp4',
  fileId: 'file-1',
  error: null,
  createdAt: '2026-07-01T00:00:00.000Z',
});

const counts = { pending: 2, processing: 1, failed7d: 3 };

beforeEach(() => {
  mockReplace.mockClear();
  searchParams = new URLSearchParams();
  requestedStatus = undefined;
  queueState = {
    jobs: [job('job-1'), job('job-2')],
    counts,
    error: undefined,
    isLoading: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  };
  widgetState = { data: { jobs: [job('job-1')], counts }, isLoading: false };
});
afterEach(cleanup);

describe('MediaQueue', () => {
  it('shows the unfiltered counts and the jobs', () => {
    render(<MediaQueue />);

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByTestId('queue-job').length).toBe(2);
  });

  it('requests the status from the URL, not from local state', () => {
    searchParams = new URLSearchParams('status=failed');
    render(<MediaQueue />);

    expect(requestedStatus).toBe('failed');
    expect(screen.getByRole('button', { name: 'Failed' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('ignores a status the backend would reject', () => {
    searchParams = new URLSearchParams('status=bogus');
    render(<MediaQueue />);

    expect(requestedStatus).toBeUndefined();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('puts the chosen filter in the URL and drops a stale job highlight', () => {
    searchParams = new URLSearchParams('job=job-9');
    render(<MediaQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    expect(mockReplace).toHaveBeenCalledWith('/media/queue?status=failed', { scroll: false });
  });

  it('clearing the filter leaves no query string behind', () => {
    searchParams = new URLSearchParams('status=failed');
    render(<MediaQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(mockReplace).toHaveBeenCalledWith('/media/queue', { scroll: false });
  });

  it('passes ?job= through so that row is highlighted', () => {
    searchParams = new URLSearchParams('job=job-2');
    render(<MediaQueue />);

    expect(screen.getByTestId('render-queue').getAttribute('data-highlight')).toBe('job-2');
  });

  it('offers a studio when nothing has ever rendered, but not when a filter is empty', () => {
    queueState = { ...queueState, jobs: [] };
    const { unmount } = render(<MediaQueue />);
    expect(screen.getByText('No renders yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open a studio' })).toBeTruthy();
    unmount();

    searchParams = new URLSearchParams('status=failed');
    render(<MediaQueue />);
    expect(screen.getByText('Nothing with that status')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open a studio' })).toBeNull();
  });

  it('keeps the loaded pages when the next one fails', () => {
    // SWR-infinite sets `error` for the whole list; blanking the screen because
    // page 2 failed loses page 1 for no reason.
    queueState = { ...queueState, error: new Error('500') };
    render(<MediaQueue />);

    expect(screen.getAllByTestId('queue-job').length).toBe(2);
    expect(screen.queryByText('Could not load the queue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows the error block only when there is nothing on screen', () => {
    queueState = { ...queueState, jobs: [], error: new Error('500') };
    render(<MediaQueue />);

    expect(screen.getByText('Could not load the queue')).toBeTruthy();
    expect(screen.queryByTestId('queue-job')).toBeNull();
  });

  it('pages only while there is more to load', () => {
    render(<MediaQueue />);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    cleanup();

    queueState = { ...queueState, hasMore: true };
    render(<MediaQueue />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(queueState.loadMore).toHaveBeenCalled();
  });
});

describe('MediaQueuePanel', () => {
  it('links to the full queue and counts what is running', () => {
    render(<MediaQueuePanel />);

    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe(
      '/media/queue'
    );
    expect(screen.getByText('3 running')).toBeTruthy();
  });

  it('renders nothing on an org that has never generated anything', () => {
    widgetState = { data: { jobs: [], counts: { pending: 0, processing: 0, failed7d: 0 } }, isLoading: false };
    const { container } = render(<MediaQueuePanel />);

    expect(container.firstChild).toBeNull();
  });
});
