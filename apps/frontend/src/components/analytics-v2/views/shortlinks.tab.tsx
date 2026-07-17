'use client';

import React, { useMemo } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useShortLinks, useShortLinksTimeseries } from '../hooks/useShortLinks';
import { StatTile } from '../kit/stat-tile';
import { TabSkeleton, ErrorState } from '../kit/states';
import { useShortlinksConfig } from '@gitroom/frontend/components/settings/shortlinks/hooks/useShortlinksConfig';
import { DataTable } from '@gitroom/frontend/components/ui/data-table';
import type { Column } from '@gitroom/frontend/components/ui/data-table';

interface ShortlinksTabProps {
  from: string;
  to: string;
}

export const ShortlinksTab = ({ from, to }: ShortlinksTabProps) => {
  const t = useT();
  const { data: links, isLoading, error } = useShortLinks(from, to);
  const { data: timeseries } = useShortLinksTimeseries(from, to);

  const { data: shortlinksConfig } = useShortlinksConfig();
  const activeProviderHasStats = shortlinksConfig?.active?.capabilities?.statistics ?? true;

  const totalClicks = timeseries?.reduce((sum, p) => sum + p.clicks, 0) || 0;
  const totalLinks = links?.length || 0;

  const columns = useMemo<Column<any>[]>(
    () => [
      {
        key: 'shortUrl',
        header: t('short_url', 'Short URL'),
        render: (link: any) => (
          <a href={link.shortUrl} target="_blank" rel="noopener noreferrer" className="text-btnPrimaryAccent hover:underline">
            {link.shortUrl}
          </a>
        ),
      },
      {
        key: 'originalUrl',
        header: t('original_url', 'Original URL'),
        render: (link: any) => (
          <span className="max-w-[300px] truncate block text-newTableText" title={link.originalUrl}>
            {link.originalUrl}
          </span>
        ),
      },
      {
        key: 'clicks',
        header: t('clicks', 'Clicks'),
        align: 'right',
        render: (link: any) => <span className="font-medium">{link.clicks}</span>,
      },
    ],
    [t]
  );

  const topLinks = useMemo(
    () => (links ? [...links].sort((a, b) => b.clicks - a.clicks).slice(0, 50) : []),
    [links]
  );

  if (error) {
    return <ErrorState title={t('failed_to_load_short_links', 'Failed to load short links')} />;
  }

  if (isLoading) {
    return <TabSkeleton variant="list" />;
  }

  if (!links || links.length === 0) {
    return (
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] text-center">
        <div className="text-[14px] text-newTableText">
          {activeProviderHasStats
            ? t('no_links_yet', 'No short links have been created yet.')
            : t('no_stats_for_provider', 'Your active short-link provider doesn\'t expose click analytics.')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex gap-[16px]">
        <StatTile label={t('total_clicks', 'Total Clicks')} value={String(totalClicks)} />
        <StatTile label={t('total_links', 'Total Links')} value={String(totalLinks)} />
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px] font-semibold">{t('top_links', 'Top Links')}</div>
        {totalLinks > 50 && (
          <div className="text-[12px] text-newTableText">
            {t('top_n_of_m', 'Top 50 of {{count}}', { count: totalLinks })}
          </div>
        )}
        <DataTable
          columns={columns}
          data={topLinks}
          keyExtractor={(link: any) => link.id}
        />
      </div>
    </div>
  );
};
