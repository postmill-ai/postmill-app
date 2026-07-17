'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import useSWR, { mutate } from 'swr';
import { TabSkeleton, ErrorState, EmptyState } from '../kit/states';
import { LineChart } from '../charts/line.chart';
import { useWatchlistSeries } from '../hooks/useWatchlistSeries';
import { CHART_PALETTE } from '../kit/palette';

interface WatchedAccount {
  id: string;
  provider: string;
  handle: string;
  displayName: string | null;
  enabled: boolean;
  lastError: string | null;
  createdAt: string;
  metrics: { id: string; metric: string; value: number; capturedAt: string }[];
}

// One hook per resource (repo SWR convention) — the org's watched accounts.
const useWatchlist = () => {
  const fetch = useFetch();
  return useSWR<WatchedAccount[]>('/analytics/v2/watchlist', (url: string) =>
    fetch(url).then((r: Response) => r.json()),
  );
};

// 6.3 — competitor overlay: your channels' metric vs a watched account's, own
// solid + watched dashed (kit palette). Empty series → EmptyState.
const WatchlistGrowthChart: FC<{ id: string; name: string }> = ({ id, name }) => {
  const t = useT();
  const { data, isLoading } = useWatchlistSeries(id, 'followers');

  const own = useMemo(() => data?.own || [], [data]);
  const watched = useMemo(() => data?.watched || [], [data]);

  if (isLoading) return <TabSkeleton variant="chart" />;

  if (!own.length && !watched.length) {
    return (
      <EmptyState
        title={t('watchlist_series_empty_title', 'No growth data yet')}
        description={t(
          'watchlist_series_empty_desc',
          'Follower snapshots for this account will appear after the next collection.'
        )}
      />
    );
  }

  return (
    <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px]">
      <div className="flex items-center justify-between mb-[8px]">
        <h4 className="text-[13px] font-medium text-newTableText">
          {t('watchlist_followers_vs', 'Followers — you vs {{name}}', { name })}
        </h4>
        <div className="flex items-center gap-[12px] text-[11px] text-newTableText">
          <span className="flex items-center gap-[4px]">
            <span className="inline-block w-[12px] h-0 border-t-2" style={{ borderColor: CHART_PALETTE[0] }} />
            {t('watchlist_you', 'You')}
          </span>
          <span className="flex items-center gap-[4px]">
            <span className="inline-block w-[12px] h-0 border-t-2 border-dashed" style={{ borderColor: CHART_PALETTE[3] }} />
            {name}
          </span>
        </div>
      </div>
      <div className="w-full aspect-[16/9] max-h-[320px]">
        <LineChart
          series={own}
          comparisonSeries={watched}
          color={CHART_PALETTE[0]}
          comparisonColor={CHART_PALETTE[3]}
          height={280}
        />
      </div>
    </div>
  );
};

export const WatchlistTab: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [provider, setProvider] = useState('x');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [growthAccount, setGrowthAccount] = useState<{ id: string; name: string } | null>(null);

  const { data: accounts, error } = useWatchlist();

  const addAccount = useCallback(async () => {
    if (!handle.trim()) return;
    const res = await fetch('/analytics/v2/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        handle: handle.trim(),
        displayName: displayName.trim() || undefined,
      }),
    });
    if (!res.ok) {
      // Keep the form state so the user can retry.
      toaster.show(t('watchlist_add_failed', 'Failed to add account'), 'warning');
      return;
    }
    setHandle('');
    setDisplayName('');
    mutate('/analytics/v2/watchlist');
  }, [provider, handle, displayName, fetch, toaster, t]);

  const toggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const res = await fetch(`/analytics/v2/watchlist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) {
        toaster.show(t('watchlist_update_failed', 'Failed to update account'), 'warning');
        return;
      }
      mutate('/analytics/v2/watchlist');
    },
    [fetch, toaster, t],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      const res = await fetch(`/analytics/v2/watchlist/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toaster.show(t('watchlist_remove_failed', 'Failed to remove account'), 'warning');
        return;
      }
      mutate('/analytics/v2/watchlist');
    },
    [fetch, toaster, t],
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <h3 className="text-[16px] font-semibold">
        {t('watchlist', 'Watchlist')}
      </h3>
      <p className="text-[13px] text-newTableText">
        {t(
          'watchlist_desc',
          'Track public accounts and pages from supported platforms.',
        )}
      </p>

      <div className="flex gap-[8px] items-end mobile:flex-col mobile:items-stretch">
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] text-newTableText">
            {t('provider', 'Provider')}
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          >
            <option value="x">X/Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] text-newTableText">
            {t('handle', 'Handle / Username')}
          </label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@username"
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          />
        </div>
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] text-newTableText">
            {t('display_name', 'Display Name (optional)')}
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          />
        </div>
        <button
          onClick={addAccount}
          disabled={!handle.trim()}
          className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] font-medium disabled:opacity-50"
        >
          {t('add', 'Add')}
        </button>
      </div>

      {error && (
        <ErrorState title={t('watchlist_error', 'Failed to load watchlist')} />
      )}

      {!accounts && !error && <TabSkeleton variant="list" />}

      {accounts && accounts.length === 0 && (
        <div className="text-[13px] text-newTableText">
          {t('watchlist_empty', 'No watched accounts yet. Add one above.')}
        </div>
      )}

      {accounts && accounts.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-[8px] flex-wrap p-[12px] bg-newBgColor border border-newTableBorder rounded-[8px]"
            >
              <div className="flex items-center gap-[12px] flex-wrap">
                <div>
                  <span className="text-[14px] font-medium">
                    {account.displayName || account.handle}
                  </span>
                  <span className="text-[12px] text-newTableText ml-[8px]">
                    {account.provider}
                  </span>
                </div>
                {account.lastError && (
                  <span className="text-[11px] text-amber-600" title={account.lastError}>
                    {t('error', 'Error')}
                  </span>
                )}
                {account.metrics?.[0] && (
                  <span className="text-[12px] text-newTableText">
                    {account.metrics[0].metric}: {account.metrics[0].value}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-[8px]">
                <button
                  type="button"
                  onClick={() =>
                    setGrowthAccount((cur) =>
                      cur?.id === account.id
                        ? null
                        : { id: account.id, name: account.displayName || account.handle }
                    )
                  }
                  aria-pressed={growthAccount?.id === account.id}
                  className={`px-[8px] py-[4px] text-[12px] rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60 ${
                    growthAccount?.id === account.id
                      ? 'bg-btnPrimary text-white'
                      : 'bg-newTableHeader text-newTableText'
                  }`}
                >
                  {t('watchlist_growth', 'Growth')}
                </button>
                <button
                  type="button"
                  onClick={() => toggleEnabled(account.id, account.enabled)}
                  className={`px-[8px] py-[4px] text-[12px] rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60 ${
                    account.enabled
                      ? 'bg-[var(--positive,#32d583)] text-white'
                      : 'bg-newTableHeader text-newTableText'
                  }`}
                >
                  {account.enabled
                    ? t('enabled', 'Enabled')
                    : t('disabled', 'Disabled')}
                </button>
                <button
                  type="button"
                  onClick={() => removeAccount(account.id)}
                  className="px-[8px] py-[4px] text-[12px] bg-[var(--negative,#f97066)] text-white rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
                >
                  {t('remove', 'Remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {growthAccount && (
        <WatchlistGrowthChart id={growthAccount.id} name={growthAccount.name} />
      )}
    </div>
  );
};
