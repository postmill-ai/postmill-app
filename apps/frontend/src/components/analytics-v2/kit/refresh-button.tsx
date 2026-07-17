'use client';

import { FC, useState } from 'react';
import { mutate } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useChannelRefresh, ChannelRefreshError } from '../hooks/useChannelRefresh';

// On-demand channel refresh button (6.7). Shared by the channels tab rows and
// the channel drill panel. On success it revalidates every /analytics/v2 SWR
// key so the overview/channel data reflects the fresh snapshots; on error
// (429 throttle / 502 provider failure) it toasts and never crashes.
interface RefreshButtonProps {
  integrationId: string;
  size?: number;
  className?: string;
}

export const RefreshButton: FC<RefreshButtonProps> = ({
  integrationId,
  size = 16,
  className,
}) => {
  const t = useT();
  const toaster = useToaster();
  const refresh = useChannelRefresh();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refresh(integrationId);
      // Revalidate all analytics reads so the fresh data lands everywhere.
      await mutate(
        (key) => typeof key === 'string' && key.startsWith('/analytics/v2/')
      );
      toaster.show(t('analytics_refreshed', 'Channel refreshed'), 'success');
    } catch (e) {
      const status = e instanceof ChannelRefreshError ? e.status : 0;
      const message =
        status === 429
          ? t('analytics_refresh_throttled', 'Too many refreshes — try again later.')
          : t('analytics_refresh_failed', 'Could not refresh this channel right now.');
      toaster.show(message, 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={t('analytics_refresh', 'Refresh analytics')}
      className={`shrink-0 p-[6px] rounded-[6px] text-newTableText hover:text-textColor hover:bg-newTableHeader transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60 ${
        className ?? ''
      }`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={busy ? 'animate-spin' : ''}
      >
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  );
};
