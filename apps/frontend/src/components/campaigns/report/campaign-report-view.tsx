'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { LineChart } from '@gitroom/frontend/components/analytics-v2/charts/line.chart';
import { BarChart } from '@gitroom/frontend/components/analytics-v2/charts/bar.chart';
import { metricLabelT } from '@gitroom/frontend/components/campaigns/metric-labels';
import { readableTextColor } from '@gitroom/frontend/components/shared/readable-text-color';

const stripHtml = (html?: string | null): string =>
  (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// A tagged-item icon that degrades to an initial-avatar when the image is
// missing OR fails to load (a stale/deleted media URL on this public report
// otherwise shows a broken-image icon to the client).
const ItemIcon: FC<{ icon?: string | null; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        onError={() => setFailed(true)}
        className="w-[24px] h-[24px] rounded-full object-cover"
      />
    );
  }
  return (
    <div className="w-[24px] h-[24px] rounded-full bg-newTableHeader flex items-center justify-center text-[11px] font-medium text-newTableText">
      {name.charAt(0).toUpperCase()}
    </div>
  );
};

interface ReportEngagement {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  clickTotal: number;
}

interface ReportPost {
  id: string;
  title?: string | null;
  content?: string | null;
  state: string;
  publishDate?: string | Date | null;
  lastViews?: number | null;
  lastLikes?: number | null;
  lastComments?: number | null;
  integration?: { name?: string; picture?: string; providerIdentifier?: string } | null;
}

interface ReportChannelStats {
  views: number;
  likes: number;
  comments: number;
  posts: number;
}

interface ReportItem {
  id: string;
  name: string;
  icon?: string;
  subtitle?: string;
  entityType: string;
}

interface ReportGoal {
  metric: string;
  target: number;
  current: number;
  pct: number;
}

interface ReportCampaign {
  id: string;
  name: string;
  color?: string | null;
  description?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
}

interface ReportAnalyticsSeriesPoint {
  date: string;
  value: number;
}
interface ReportAnalyticsChannel {
  name: string;
  kpis?: { metric: string; total: number }[];
}
interface ReportAnalytics {
  series?: Record<string, ReportAnalyticsSeriesPoint[]>;
  byChannel?: ReportAnalyticsChannel[];
  window?: { from: string; to: string };
}

interface CampaignReport {
  campaign: ReportCampaign;
  engagement: ReportEngagement;
  posts: ReportPost[];
  channelBreakdown: Record<string, ReportChannelStats>;
  itemInventory: Record<string, ReportItem[]>;
  goals: ReportGoal[];
  analytics?: ReportAnalytics;
}

const PRIMARY_METRIC_ORDER = ['views', 'impressions', 'video_views', 'likes', 'comments', 'clicks'];

const formatNumber = (value: number | null | undefined): string => {
  const n = typeof value === 'number' ? value : 0;
  return n.toLocaleString();
};

const formatDate = (value: string | Date | null | undefined, format: string): string => {
  if (!value) return '—';
  return dayjs(value).format(format);
};

const DownloadIcon: FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ShareIcon: FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const CopyIcon: FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CampaignReportView: FC<{ report: CampaignReport; publicMode?: boolean; token?: string }> = ({
  report,
  publicMode,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const campaign = report.campaign;
  const engagement = report.engagement;
  const color = campaign.color || '#2B5CD3';

  const sortedChannels = useMemo(() => {
    return Object.entries(report.channelBreakdown || {}).sort((a, b) => b[1].views - a[1].views);
  }, [report.channelBreakdown]);

  const sortedPosts = useMemo(() => {
    return [...(report.posts || [])].sort((a, b) => {
      const da = a.publishDate ? new Date(a.publishDate).getTime() : 0;
      const db = b.publishDate ? new Date(b.publishDate).getTime() : 0;
      return db - da;
    });
  }, [report.posts]);

  // Trend chart (3.4): rendered for both authed and public reports when the
  // pre-computed analytics block is present.
  const trend = useMemo(() => {
    const series = report.analytics?.series || {};
    const keys = Object.keys(series);
    if (!keys.length) return null;
    const pick =
      PRIMARY_METRIC_ORDER.find((m) => (series[m]?.length ?? 0) > 0) ||
      keys.find((k) => (series[k]?.length ?? 0) > 0);
    if (!pick) return null;
    return { metric: pick, series: series[pick] };
  }, [report.analytics]);

  const analyticsChannelBars = useMemo(() => {
    const byChannel = report.analytics?.byChannel || [];
    if (!byChannel.length) return { labels: [] as string[], values: [] as number[] };
    return {
      labels: byChannel.map((c) => c.name),
      values: byChannel.map((c) => c.kpis?.[0]?.total || 0),
    };
  }, [report.analytics]);

  const downloadBlob = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExporting(format);
      try {
        const res = await fetch(`/campaigns/${campaign.id}/report?format=${format}`);
        if (!res.ok) throw new Error(`Failed to download ${format.toUpperCase()}`);
        const blob = await res.blob();
        const ext = format === 'csv' ? 'csv' : 'pdf';
        const filename = `${campaign.name.replace(/\s+/g, '_')}-report.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.show(t('report_downloaded', 'Report downloaded'), 'success');
      } catch {
        toast.show(t('report_download_failed', 'Download failed'), 'warning');
      } finally {
        setExporting(null);
      }
    },
    [campaign.id, campaign.name, fetch, toast, t]
  );

  const createShare = useCallback(async () => {
    if (publicMode) return;
    setCreatingShare(true);
    try {
      const res = await fetch(`/campaigns/${campaign.id}/share`, { method: 'POST' });
      if (!res.ok) throw new Error(t('failed_to_create_share_link', 'Failed to create share link'));
      const data = await res.json();
      const token = data.shareToken || data.token || data.id;
      if (!token) throw new Error('No share token returned');
      const url = `${window.location.origin}/share/campaign/${token}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      toast.show(t('share_link_copied', 'Share link copied'), 'success');
    } catch {
      toast.show(t('share_link_failed', 'Could not create share link'), 'warning');
    } finally {
      setCreatingShare(false);
    }
  }, [campaign.id, fetch, publicMode, toast, t]);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.show(t('copied_to_clipboard', 'Copied to clipboard'), 'success');
      } catch {
        toast.show(t('copy_failed', 'Copy failed'), 'warning');
      }
    },
    [toast, t]
  );

  const kpiItems = useMemo(
    () => [
      { label: t('views', 'Views'), value: engagement.totalViews },
      { label: t('likes', 'Likes'), value: engagement.totalLikes },
      { label: t('replies', 'Replies'), value: engagement.totalComments },
      { label: t('clicks', 'Clicks'), value: engagement.clickTotal },
    ],
    [engagement, t]
  );

  return (
    <div className="campaign-report-wrapper flex flex-col gap-[24px] p-[24px] print:p-0 print:bg-white">
      <style>{`
        @media print {
          #left-menu,
          #support-discord,
          nav[aria-label="Primary"],
          .blurMe > div:first-child {
            display: none !important;
          }
          .blurMe {
            background: white !important;
          }
          .campaign-report-wrapper {
            padding: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        className="rounded-[12px] p-[24px] flex flex-col gap-[8px]"
        style={{ backgroundColor: color, color: readableTextColor(color) }}
      >
        <h1 className="text-[28px] font-[600]">{campaign.name}</h1>
        <p className="text-[14px] opacity-90">
          {t('campaign_report', 'Campaign Report')} &bull; {dayjs().format(t('campaign_report_header_date_format', 'MMM D, YYYY'))}
        </p>
        {campaign.description && <p className="text-[13px] opacity-90 max-w-[720px]">{campaign.description}</p>}
        {(campaign.startDate || campaign.endDate) && (
          <p className="text-[13px] opacity-90">
            {campaign.startDate ? formatDate(campaign.startDate, t('campaign_report_date_format', 'MMM D, YYYY')) : ''}
            {campaign.startDate && campaign.endDate ? ' — ' : ''}
            {campaign.endDate ? formatDate(campaign.endDate, t('campaign_report_date_format', 'MMM D, YYYY')) : ''}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[16px]">
        {kpiItems.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[6px]"
          >
            <div className="text-[24px] font-[700] text-textColor">{formatNumber(kpi.value)}</div>
            <div className="text-[12px] font-[500] text-newTableText uppercase tracking-wide">{kpi.label}</div>
          </div>
        ))}
      </div>

      {trend && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[16px]">
          <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
            <h2 className="text-[16px] font-[600] text-textColor">{t('performance', 'Performance')}</h2>
            <span className="text-[12px] text-newTableText">
              {t('post_metrics_trend', 'Post metrics')} · {metricLabelT(trend.metric, t)}
            </span>
          </div>
          <div className="w-full aspect-[16/9] sm:aspect-[21/9] max-h-[320px]">
            <LineChart series={trend.series} height={300} />
          </div>
          {analyticsChannelBars.labels.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-newTableText mb-[8px]">
                {t('by_channel', 'By Channel')}
              </div>
              <div className="w-full aspect-[4/3] max-h-[260px]">
                <BarChart labels={analyticsChannelBars.labels} values={analyticsChannelBars.values} height={250} />
              </div>
            </div>
          )}
        </div>
      )}

      {!publicMode && (
        <div className="no-print flex flex-wrap items-center gap-[12px]">
          <Button onClick={() => downloadBlob('csv')} loading={exporting === 'csv'}>
            <span className="flex items-center gap-[8px]">
              <DownloadIcon className="shrink-0" />
              {t('download_csv', 'Download CSV')}
            </span>
          </Button>
          <Button onClick={() => downloadBlob('pdf')} loading={exporting === 'pdf'}>
            <span className="flex items-center gap-[8px]">
              <DownloadIcon className="shrink-0" />
              {t('download_pdf', 'Download PDF')}
            </span>
          </Button>
          <Button secondary onClick={createShare} loading={creatingShare}>
            <span className="flex items-center gap-[8px]">
              <ShareIcon className="shrink-0" />
              {t('share_report', 'Share Report')}
            </span>
          </Button>
        </div>
      )}

      {shareUrl && (
        <div className="no-print bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[12px]">
          <div className="text-[13px] font-[500] text-textColor">{t('share_link', 'Share link')}</div>
          <div className="flex items-center gap-[8px]">
            <input
              readOnly
              value={shareUrl}
              className="flex-1 px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] text-textColor outline-none"
            />
            <Button secondary onClick={() => copyToClipboard(shareUrl)}>
              <span className="flex items-center gap-[8px]">
                <CopyIcon className="shrink-0" />
                {t('copy', 'Copy')}
              </span>
            </Button>
          </div>
        </div>
      )}

      {report.goals && report.goals.length > 0 && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[16px]">
          <h2 className="text-[16px] font-[600] text-textColor">{t('goals', 'Goals')}</h2>
          <div className="flex flex-col gap-[14px]">
            {report.goals.map((goal, idx) => (
              <div key={`${goal.metric}-${goal.target}-${idx}`} className="flex flex-col gap-[6px]">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-textColor capitalize">{metricLabelT(goal.metric, t)}</span>
                  <span className="text-newTableText">
                    {formatNumber(goal.current)} / {formatNumber(goal.target)} ({goal.pct}%)
                  </span>
                </div>
                <div className="h-[8px] bg-newBgColor border border-newTableBorder rounded-[4px] overflow-hidden">
                  <div
                    className="h-full rounded-[4px]"
                    style={{ width: `${Math.max(0, Math.min(100, goal.pct))}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[16px]">
        <h2 className="text-[16px] font-[600] text-textColor">{t('posts', 'Posts')}</h2>
        {sortedPosts.length === 0 ? (
          <p className="text-[13px] text-newTableText">{t('no_posts', 'No posts yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-newTableHeader">
                  <th className="text-left py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('title', 'Title')}</th>
                  <th className="text-left py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('channel', 'Channel')}</th>
                  <th className="text-left py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('state', 'State')}</th>
                  <th className="text-left py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('date', 'Date')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('views', 'Views')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('likes', 'Likes')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('replies', 'Replies')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map((post) => (
                  <tr key={post.id} className="border-b border-newTableBorder/60 last:border-b-0 hover:bg-boxHover transition-colors">
                    <td className="py-[12px] px-[16px] text-[13px] text-textColor">
                      {post.title || stripHtml(post.content).slice(0, 60) || t('untitled', 'Untitled')}
                    </td>
                    <td className="py-[12px] px-[16px] text-[13px] text-textColor">{post.integration?.name || '—'}</td>
                    <td className="py-[12px] px-[16px] text-[13px]">
                      <span className={clsx('px-[8px] py-[2px] rounded-full text-[11px] font-medium', statePillClass(post.state))}>
                        {t(`post_state_${post.state.toLowerCase()}`, post.state)}
                      </span>
                    </td>
                    <td className="py-[12px] px-[16px] text-[13px] text-newTableText">{formatDate(post.publishDate, t('campaign_report_date_format', 'MMM D, YYYY'))}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(post.lastViews)}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(post.lastLikes)}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(post.lastComments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[16px]">
        <h2 className="text-[16px] font-[600] text-textColor">{t('channel_breakdown', 'Channel Breakdown')}</h2>
        {sortedChannels.length === 0 ? (
          <p className="text-[13px] text-newTableText">{t('no_channel_data', 'No channel data.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-newTableHeader">
                  <th className="text-left py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('channel', 'Channel')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('posts', 'Posts')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('views', 'Views')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('likes', 'Likes')}</th>
                  <th className="text-right py-[12px] px-[16px] text-[12px] font-medium text-newTableText uppercase tracking-wide">{t('replies', 'Replies')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedChannels.map(([name, stats]) => (
                  <tr key={name} className="border-b border-newTableBorder/60 last:border-b-0 hover:bg-boxHover transition-colors">
                    <td className="py-[12px] px-[16px] text-[13px] text-textColor">{name}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(stats.posts)}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(stats.views)}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(stats.likes)}</td>
                    <td className="py-[12px] px-[16px] text-[13px] text-right tabular-nums text-textColor">{formatNumber(stats.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[16px]">
        <h2 className="text-[16px] font-[600] text-textColor">{t('tagged_items', 'Tagged Items')}</h2>
        {Object.keys(report.itemInventory || {}).length === 0 ? (
          <p className="text-[13px] text-newTableText">{t('no_tagged_items', 'No tagged items.')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
            {Object.entries(report.itemInventory || {}).map(([type, items]) => (
              <div key={type} className="bg-newBgColor border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[10px]">
                <h3 className="text-[13px] font-[600] text-textColor capitalize">{type}</h3>
                {items.length === 0 ? (
                  <p className="text-[12px] text-newTableText">{t('none', 'None')}</p>
                ) : (
                  <ul className="flex flex-col gap-[8px]">
                    {items.map((item) => (
                      <li key={item.id} className="flex items-center gap-[8px]">
                        <ItemIcon icon={item.icon} name={item.name} />
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13px] text-textColor truncate">{item.name}</span>
                          {item.subtitle && <span className="text-[11px] text-newTableText truncate">{item.subtitle}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function statePillClass(state: string): string {
  switch (state?.toUpperCase()) {
    case 'PUBLISHED':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'QUEUE':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    case 'DRAFT':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
    default:
      return 'bg-newTableText/10 text-newTableText';
  }
}
