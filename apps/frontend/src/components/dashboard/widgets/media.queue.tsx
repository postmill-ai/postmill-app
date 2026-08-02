'use client';

import { FC } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useRouter } from 'next/navigation';
import { useMediaJobs, MediaJob } from '../hooks/useMediaJobs';
import { MEDIA_QUEUE_HREF } from '../destinations';
import ProviderIcon from '@postmill-ai/frontend/components/shared/provider-icon';
import { EmptyState, TabSkeleton } from '@postmill-ai/frontend/components/analytics-v2/kit/states';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

dayjs.extend(relativeTime);

const statusPill = (status: string) => {
  const base = 'text-[10px] font-semibold px-[6px] py-[2px] rounded-full uppercase';
  switch (status) {
    case 'completed':
      return `${base} bg-[var(--positive,#32d583)]/10 text-[var(--positive,#32d583)]`;
    case 'failed':
      return `${base} bg-[var(--negative,#f97066)]/10 text-[var(--negative,#f97066)]`;
    case 'processing':
      return `${base} bg-[var(--chart-5,#ffac30)]/10 text-[var(--chart-5,#ffac30)]`;
    default:
      return `${base} bg-newTableBorder text-newTableText`;
  }
};

type TranslateFn = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

const statusLabel = (t: TranslateFn, status: string) => {
  switch (status) {
    case 'completed':
      return t('completed_label', 'completed');
    case 'failed':
      return t('failed_label', 'failed');
    case 'processing':
      return t('processing_label', 'processing');
    case 'pending':
      return t('pending_label', 'pending');
    default:
      return status;
  }
};

const isImageOrVideo = (url: string | null) => {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.mp4') || lower.startsWith('data:video') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp') || lower.startsWith('data:image');
};

const MediaJobRow: FC<{ job: MediaJob }> = ({ job }) => {
  const router = useRouter();
  const t = useT();
  // The job itself is the destination, not the studio that produced it: the
  // queue is where you can retry it, preview it or post it.
  return (
    <button
      type="button"
      onClick={() => router.push(`${MEDIA_QUEUE_HREF}?job=${job.id}`)}
      className="flex items-center gap-[10px] p-[10px] rounded-[10px] bg-newTableHeader border border-newTableBorder hover:border-newTableText transition-colors text-start w-full"
    >
      <ProviderIcon identifier={job.provider} name={job.provider} size={28} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-[8px]">
          <span className="text-[12px] font-medium text-textColor capitalize">
            {job.operation}
          </span>
          <span className={statusPill(job.status)}>{statusLabel(t, job.status)}</span>
        </div>
        <p className="text-[11px] text-newTableText">
          {dayjs(job.createdAt).fromNow()}
        </p>
        {job.error && (
          <p className="text-[11px] text-[var(--negative,#f97066)] truncate">
            {job.error}
          </p>
        )}
      </div>
      {job.artifactUrl && isImageOrVideo(job.artifactUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={job.artifactUrl}
          alt=""
          className="w-[40px] h-[40px] rounded-[6px] object-cover shrink-0"
        />
      )}
    </button>
  );
};

export const MediaQueueWidget: FC = () => {
  const t = useT();
  const { data, isLoading } = useMediaJobs();

  if (isLoading) return <TabSkeleton variant="list" />;
  if (!data?.jobs.length) {
    return (
      <EmptyState
        title={t('no_media_jobs_title', 'No media jobs')}
        description={t(
          'no_media_jobs_description',
          'Render jobs from media studios will show here.'
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[12px] mb-[4px]">
        <div className="text-[12px] text-newTableText">
          <span className="font-medium text-textColor">{data.counts.pending}</span>{' '}
          {t('pending_label', 'pending')}
        </div>
        <div className="text-[12px] text-newTableText">
          <span className="font-medium text-textColor">{data.counts.processing}</span>{' '}
          {t('processing_label', 'processing')}
        </div>
        {data.counts.failed7d > 0 && (
          <div className="text-[12px] text-[var(--negative,#f97066)]">
            <span className="font-medium">{data.counts.failed7d}</span>{' '}
            {t('failed_label', 'failed')}
          </div>
        )}
      </div>
      {data.jobs.slice(0, 6).map((job) => (
        <MediaJobRow key={job.id} job={job} />
      ))}
    </div>
  );
};
