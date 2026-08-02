'use client';

import React, { useCallback, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { RenderQueue } from '@postmill-ai/frontend/components/media-tools/studio-kit/render-queue';
import type { StudioJob } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';
import {
  useMediaJobs,
  useMediaJobsQueue,
  type MediaJob,
} from '@postmill-ai/frontend/components/dashboard/hooks/useMediaJobs';
import { MEDIA_QUEUE_HREF } from '@postmill-ai/frontend/components/dashboard/destinations';

/** Chips mirror AIMediaJob.status; `null` is "everything". */
const STATUS_FILTERS: { value: string | null; labelKey: string; label: string }[] = [
  { value: null, labelKey: 'media_queue_filter_all', label: 'All' },
  { value: 'pending', labelKey: 'render_status_queued', label: 'Queued' },
  { value: 'processing', labelKey: 'render_status_rendering', label: 'Rendering' },
  { value: 'completed', labelKey: 'render_status_ready', label: 'Ready' },
  { value: 'failed', labelKey: 'render_status_failed', label: 'Failed' },
];

const VALID_STATUSES = new Set(['pending', 'processing', 'completed', 'failed']);

// The queue speaks in the same vocabulary as the studio rail: a job is queued,
// rendering, ready or failed. `RenderQueue` owns the row; this page owns the
// counts, the filter and paging.
const toStudioJobs = (jobs: MediaJob[]): StudioJob[] =>
  jobs.map((job) => ({
    id: job.id,
    operation: job.operation,
    status: job.status as StudioJob['status'],
    artifactUrl: job.artifactUrl,
    fileId: job.fileId,
    error: job.error,
    createdAt: job.createdAt,
  }));

const CountPill: React.FC<{ label: string; value: number; tone: 'active' | 'failed' | 'muted' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="flex items-baseline gap-[8px] rounded-[10px] border border-newTableBorder bg-newBgColorInner px-[14px] py-[10px]">
    <span
      className={clsx(
        'text-[20px] font-[700] tabular-nums leading-none',
        tone === 'failed' && 'text-red-600 dark:text-red-400',
        tone === 'active' && 'text-[#2B5CD3]',
        tone === 'muted' && 'text-textColor'
      )}
    >
      {value}
    </span>
    <span className="text-[12px] text-newTableText">{label}</span>
  </div>
);

/**
 * `/media/queue` — every render this org has asked for, in one place.
 *
 * Deliberately not in `MEDIA_TABS`: it is a status surface, not a tool. It is
 * pinned separately in the media rail so the studio counts stay true.
 */
export const MediaQueue: React.FC = () => {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const statusParam = searchParams.get('status');
  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : null;
  const highlightJobId = searchParams.get('job');

  const { jobs, counts, error, isLoading, hasMore, isLoadingMore, loadMore } =
    useMediaJobsQueue(status ?? undefined);

  const setStatus = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set('status', next);
      else params.delete('status');
      // A highlight belongs to one job, not to a filtered list.
      params.delete('job');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const studioJobs = useMemo(() => toStudioJobs(jobs), [jobs]);
  const isEmpty = !isLoading && studioJobs.length === 0;
  // A failed *next* page must not wipe the pages already on screen — show the
  // error block only when there is nothing else to show.
  const showError = !!error && studioJobs.length === 0;

  return (
    <div className="p-[20px] mobile:p-[16px] flex flex-col gap-[20px] max-w-[1180px]">
      <div className="flex flex-col gap-[6px]">
        <h1 className="text-[26px] mobile:text-[22px] font-[700] tracking-[-0.02em] text-textColor">
          {t('media_queue_title', 'Render queue')}
        </h1>
        <p className="text-[13px] text-newTableText">
          {t(
            'media_queue_description',
            'Every image, video and audio render, from any studio. Finished renders are saved to your File Library.'
          )}
        </p>
      </div>

      {counts && (
        <div className="flex flex-wrap gap-[10px]">
          <CountPill
            label={t('render_status_queued', 'Queued')}
            value={counts.pending}
            tone={counts.pending > 0 ? 'active' : 'muted'}
          />
          <CountPill
            label={t('render_status_rendering', 'Rendering')}
            value={counts.processing}
            tone={counts.processing > 0 ? 'active' : 'muted'}
          />
          <CountPill
            label={t('media_queue_failed_7d', 'Failed (7 days)')}
            value={counts.failed7d}
            tone={counts.failed7d > 0 ? 'failed' : 'muted'}
          />
        </div>
      )}

      <div
        className="flex flex-wrap gap-[6px]"
        role="group"
        aria-label={t('media_queue_filter_aria', 'Filter renders by status')}
      >
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value ?? 'all'}
            type="button"
            aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}
            className={clsx(
              'px-[11px] py-[5px] rounded-full text-[12px] font-[500] border transition-colors',
              status === filter.value
                ? 'bg-[#2B5CD3] border-[#2B5CD3] text-white'
                : 'bg-newBgColorInner border-newTableBorder text-newTableText hover:text-textColor'
            )}
          >
            {t(filter.labelKey, filter.label)}
          </button>
        ))}
      </div>

      {showError ? (
        <EmptyState
          title={t('media_queue_error_title', 'Could not load the queue')}
          description={t(
            'media_queue_error_description',
            'Refresh the page to try again.'
          )}
        />
      ) : isEmpty ? (
        <EmptyState
          title={
            status
              ? t('media_queue_empty_filtered_title', 'Nothing with that status')
              : t('media_queue_empty_title', 'No renders yet')
          }
          description={
            status
              ? t(
                  'media_queue_empty_filtered_description',
                  'Clear the filter to see the rest of the queue.'
                )
              : t(
                  'media_queue_empty_description',
                  'Generate an image, video or audio clip in any studio and it shows up here.'
                )
          }
          action={
            status ? undefined : (
              <Link
                href="/media"
                className="inline-flex items-center px-[16px] py-[9px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[600] hover:bg-[#2B5CD3]/85 transition-colors"
              >
                {t('media_queue_empty_cta', 'Open a studio')}
              </Link>
            )
          }
        />
      ) : (
        <>
          <RenderQueue
            jobs={studioJobs}
            isLoading={isLoading}
            variant="grid"
            highlightJobId={highlightJobId}
          />
          {error && (
            <p className="self-center text-[12px] text-red-600 dark:text-red-400">
              {t('media_queue_error_title', 'Could not load the queue')}
            </p>
          )}
          {(hasMore || error) && (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className="self-center px-[18px] py-[9px] rounded-[8px] border border-newTableBorder bg-newBgColorInner text-[13px] text-textColor hover:bg-boxHover transition-colors disabled:opacity-60"
            >
              {isLoadingMore
                ? t('loading', 'Loading...')
                : error
                  ? t('retry', 'Retry')
                  : t('media_queue_load_more', 'Load more')}
            </button>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Compact queue panel for the /media index. Shares the dashboard widget's SWR
 * key, so when both are warm it costs no extra request.
 */
export const MediaQueuePanel: React.FC = () => {
  const t = useT();
  const { data, isLoading } = useMediaJobs();

  const recent = useMemo(() => (data?.jobs ?? []).slice(0, 3), [data]);
  const counts = data?.counts;
  const active = (counts?.pending ?? 0) + (counts?.processing ?? 0);

  // Nothing has ever been rendered — don't spend index space on an empty panel.
  if (!isLoading && recent.length === 0) return null;

  return (
    <section className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <h2 className="text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText">
          {t('media_queue_title', 'Render queue')}
          {active > 0 && (
            <span className="ms-[8px] inline-flex items-center gap-[5px] rounded-full bg-amber-500/10 px-[8px] py-[2px] text-[10px] font-[600] normal-case tracking-normal text-amber-600">
              <span className="inline-block w-[6px] h-[6px] rounded-full bg-current animate-pulse" />
              {t('media_queue_active_count', '{{count}} running', { count: active })}
            </span>
          )}
        </h2>
        <Link
          href={MEDIA_QUEUE_HREF}
          className="text-[12px] text-[#2B5CD3] hover:underline"
        >
          {t('view_all', 'View all')}
        </Link>
      </div>
      <RenderQueue jobs={toStudioJobs(recent)} isLoading={isLoading} variant="grid" />
    </section>
  );
};
