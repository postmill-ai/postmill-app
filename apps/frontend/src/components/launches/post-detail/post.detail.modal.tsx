'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { pushAgentUiContext } from '@gitroom/frontend/components/agent/agent-context-bridge';
import { CommentThread } from './comment.thread';

interface PostDetailModalProps {
  postId: string;
}

const usePostDetail = (postId: string) => {
  const fetch = useFetch();
  const loadPost = useCallback(async () => {
    return (await fetch(`/posts/${postId}`)).json();
  }, [postId, fetch]);
  return useSWR(`/posts/${postId}`, loadPost);
};

const usePostStatistics = (postId: string) => {
  const fetch = useFetch();
  const loadStats = useCallback(async () => {
    return (await fetch(`/posts/${postId}/statistics`)).json();
  }, [postId, fetch]);
  return useSWR(`/posts/${postId}/statistics`, loadStats, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

const DATE_RANGES = [7, 30, 90];

const usePostAnalytics = (postId: string, date: number) => {
  const fetch = useFetch();
  const loadAnalytics = useCallback(async () => {
    return (await fetch(`/analytics/v2/post/${postId}?date=${date}`)).json();
  }, [postId, date, fetch]);
  return useSWR(`/analytics/v2/post/${postId}?date=${date}`, loadAnalytics, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const StatePill: FC<{ state: string }> = ({ state }) => {
  const t = useT();
  if (state === 'ERROR') return null;

  const config: Record<string, { bg: string; label: string }> = {
    PUBLISHED: { bg: 'bg-green-500', label: t('published', 'Published') },
    QUEUE: { bg: 'bg-blue-500', label: t('scheduled', 'Scheduled') },
    DRAFT: { bg: 'bg-amber-500', label: t('draft', 'Draft') },
    // 0.7: transient claim state while the publish worker is posting.
    PUBLISHING: { bg: 'bg-blue-500', label: t('publishing', 'Publishing') },
  };

  const pill = config[state] || config.QUEUE;
  return (
    <div className={`inline-flex items-center gap-[4px] ${pill.bg} text-white text-xs px-[6px] py-[2px] rounded-full`}>
      <div className="w-[6px] h-[6px] rounded-full bg-white" />
      {pill.label}
    </div>
  );
};

const KpiCard: FC<{ label: string; total: number | string; percentageChange?: number | null; sparklineData?: number[] }> = ({
  label,
  total,
  percentageChange,
  sparklineData,
}) => {
  const isPositive = percentageChange !== null && percentageChange !== undefined && percentageChange >= 0;
  const changeColor = isPositive ? 'text-[#22c55e]' : 'text-[#f97066]';
  const arrow = isPositive ? '\u2191' : '\u2193';

  return (
    <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[14px] flex flex-col gap-[4px]">
      <div className="text-newTableText text-[13px]">{label}</div>
      <div className="text-[28px] font-semibold leading-[32px]">{total}</div>
      {percentageChange !== null && percentageChange !== undefined && (
        <div className={`${changeColor} text-[12px] flex items-center gap-[2px]`}>
          {arrow} {Math.abs(percentageChange).toFixed(1)}%
        </div>
      )}
      {sparklineData && sparklineData.length > 1 && (
        <svg width="100%" height="24" className="mt-[4px]" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={sparklineData.map((v, i, arr) =>
              `${(i / Math.max(arr.length - 1, 1)) * 100},${24 - (v / Math.max(...arr, 1)) * 20}`
            ).join(' ')}
          />
        </svg>
      )}
    </div>
  );
};

const tryParseJSON = (str: string | null | undefined, fallback: any) => {
  try { return JSON.parse(str || '[]'); } catch { return fallback; }
};

export const PostDetailModal: FC<PostDetailModalProps> = ({ postId }) => {
  const t = useT();
  const { mutate } = useSWRConfig();

  const fetch = useFetch();
  const hasMarkedRef = useRef(false);
  const [dateRange, setDateRange] = useState(30);

  const { data: postData, isLoading: postLoading } = usePostDetail(postId);
  const { data: analyticsData, isLoading: analyticsLoading } = usePostAnalytics(postId, dateRange);
  const { data: statsData } = usePostStatistics(postId);

  useEffect(() => {
    if (hasMarkedRef.current) {
      return;
    }
    // Only PUBLISHED posts with a real release id can have synced social
    // comments to mark read — firing the POST + global calendar mutate on every
    // modal open (drafts/queued included) was wasteful and needlessly churned
    // the calendar SWR cache.
    const main = postData?.posts?.[0];
    if (
      !main ||
      main.state !== 'PUBLISHED' ||
      !main.releaseId ||
      main.releaseId === 'missing'
    ) {
      return;
    }
    hasMarkedRef.current = true;
    // The mark-read POST always upserts a read timestamp regardless of whether
    // anything was actually unread (its response carries no unread signal), and
    // postData has no unread count — so probe the unread count first and only
    // revalidate every cached calendar window when marking read actually cleared
    // an unread badge. Nothing unread ⇒ the calendar view is unchanged.
    (async () => {
      let hadUnread = true;
      try {
        const countRes = await fetch(
          `/posts/${postId}/social-comments/unread-count`
        );
        if (countRes.ok) {
          const { unreadCount } = await countRes.json();
          hadUnread = (unreadCount ?? 0) > 0;
        }
      } catch {
        // fall through — treat as possibly-unread so we don't drop a real update
      }

      const res = await fetch(`/posts/${postId}/social-comments/read`, {
        method: 'POST',
      });
      if (!res.ok || !hadUnread) {
        return;
      }
      mutate((key: any) => typeof key === 'string' && key.startsWith('/posts-'));
    })().catch(() => {});
  }, [postId, postData, mutate, fetch]);

  // Producer for the `/agents` view context (2.3): while this post's detail is
  // open, expose its id (merged on top of the launches keys) so the agent
  // ("move this post to Monday") can resolve it. On unmount the snapshot is KEPT
  // and flagged stale (`leftViewAt`) as the user's last-viewed context; a fresh
  // producer mount clears the stale marker so a newer view wins.
  useEffect(() => {
    return pushAgentUiContext({ currentPostId: postId });
  }, [postId]);

  // NOTE: this memo must stay above the early returns below — calling a hook
  // conditionally (after a loading/empty return) breaks the rules of hooks.
  const kpiCards = useMemo(() => {
    const metrics = analyticsData?.metrics;
    const metricEntries = metrics ? Object.entries(metrics) : [];

    const knownLabels: Record<string, string> = {
      views: t('views', 'Views'),
      likes: t('likes', 'Likes'),
      comments: t('comments', 'Comments'),
      comments_metric: t('comments', 'Comments'),
      impressions: t('impressions', 'Impressions'),
    };

    const cards = metricEntries.slice(0, 8).map(([key, series]: [string, any]) => {
      const sorted = Array.isArray(series)
        ? [...series].sort(
            (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          )
        : [];
      const total = sorted.length
        ? sorted.reduce((acc: number, s: any) => acc + (Number(s.value) || 0), 0)
        : 0;
      const sparklineData = sorted.map((s: any) => Number(s.value) || 0);

      let percentageChange: number | null = null;
      if (sorted.length > 1) {
        const mid = Math.floor(sorted.length / 2);
        const firstHalf = sorted.slice(0, mid).reduce((acc: number, s: any) => acc + (Number(s.value) || 0), 0);
        const secondHalf = sorted.slice(mid).reduce((acc: number, s: any) => acc + (Number(s.value) || 0), 0);
        if (firstHalf > 0) {
          percentageChange = ((secondHalf - firstHalf) / firstHalf) * 100;
        }
      }

      const label = knownLabels[key] || key.replace(/_/g, ' ');
      return {
        label,
        total: Math.round(total).toLocaleString(),
        metric: key,
        percentageChange,
        sparklineData,
      };
    });

    // Clicks from short-link statistics
    const totalClicks = (statsData as any)?.clicks?.reduce(
      (sum: number, item: any) => sum + (Number(item.clicks) || 0),
      0,
    ) || 0;

    if (totalClicks > 0) {
      cards.push({
        label: t('clicks', 'Clicks'),
        total: totalClicks.toLocaleString(),
        metric: 'clicks',
        percentageChange: null,
        sparklineData: [],
      });
    }

    // Engagement rate from analytics metrics
    const sumMetric = (key: string) => {
      const series = metrics?.[key];
      if (!Array.isArray(series)) return 0;
      return series.reduce((acc: number, s: any) => acc + (Number(s.value) || 0), 0);
    };
    const impressions = sumMetric('impressions');
    if (impressions > 0) {
      const likes = sumMetric('likes');
      const comments = sumMetric('comments') || sumMetric('comments_metric');
      const engagementRate = ((likes + comments) / impressions) * 100;
      cards.push({
        label: t('engagement_rate', 'Engagement Rate'),
        total: engagementRate.toFixed(1) + '%',
        metric: 'engagement_rate',
        percentageChange: null,
        sparklineData: [],
      });
    }

    return cards;
  }, [analyticsData, statsData, t]);

  // Only the post itself gates the whole modal; analytics + comments each have
  // their own per-section loading so the header/thread show immediately.
  if (postLoading) {
    return (
      <div className="flex items-center justify-center py-[60px]">
        <LoadingComponent />
      </div>
    );
  }

  if (!postData) {
    return (
      <div className="text-center py-[60px] text-newTableText">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }

  const { posts = [], integration, integrationPicture } = postData || {};

  const mainPost = posts?.[0];
  const state = mainPost?.state || 'QUEUE';

  return (
    <div className="flex flex-col gap-[20px] text-textColor">
      {/* Header */}
      <div className="flex items-start gap-[12px] flex-wrap">
        <div className="relative min-w-[36px]">
          <SafeImage
            src={integrationPicture || '/no-picture.jpg'}
            className="w-[36px] h-[36px] rounded-[8px]"
            alt={integration?.name || mainPost?.integration?.name || ''}
            width={36}
            height={36}
          />
          {mainPost?.integration?.providerIdentifier && (
            <SafeImage
              src={`/icons/platforms/${mainPost.integration.providerIdentifier}.png`}
              className="w-[14px] h-[14px] rounded-[4px] absolute -bottom-[4px] -end-[4px] border border-newTableBorder"
              alt={mainPost.integration.providerIdentifier}
              width={14}
              height={14}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-[500] leading-[20px] break-words line-clamp-2">
            {stripHtmlValidation('none', mainPost?.content, false, true, false) ||
              t('no_content', 'no content')}
          </div>
        </div>
        <div className="flex items-center gap-[8px] shrink-0">
          <StatePill state={state} />
          {state === 'ERROR' && mainPost?.errors?.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-[8px] p-[10px] mt-[8px] w-full">
              <div className="text-[12px] text-red-500 font-[500] mb-[4px]">
                {t('error_details', 'Error details')}
              </div>
              <div className="text-[12px] text-dangerText break-words">
                {mainPost.errors.map((e: any) => e.message || e.error).join('; ')}
              </div>
            </div>
          )}
          {mainPost?.releaseURL &&
            mainPost.releaseURL !== 'missing' &&
            /^https?:\/\//i.test(mainPost.releaseURL) && (
            <a
              href={mainPost.releaseURL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-btnPrimaryAccent underline whitespace-nowrap"
            >
              {t('open_on_platform', 'Open on platform')}
            </a>
          )}
        </div>
      </div>

      {/* Date range selector */}
      <div
        className="flex items-center gap-[6px]"
        role="group"
        aria-label={t('analytics_date_range', 'Analytics date range')}
      >
        {DATE_RANGES.map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={dateRange === days}
            onClick={() => setDateRange(days)}
            className={`text-[12px] px-[10px] py-[4px] rounded-full border ${
              dateRange === days
                ? 'bg-btnPrimary text-white border-btnPrimary'
                : 'border-newTableBorder text-newTableText hover:text-textColor'
            }`}
          >
            {t('last_n_days', 'Last {{count}} days', { count: days })}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      {analyticsLoading ? (
        <div data-testid="kpi-skeleton" className="grid grid-cols-2 sm:grid-cols-4 gap-[12px]">
          {[1,2,3,4].map((i) => (
            <div key={i} className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[14px] flex flex-col gap-[8px] animate-pulse">
              <div className="h-[13px] w-[60px] bg-newTableBorder rounded-[4px]" />
              <div className="h-[28px] w-[80px] bg-newTableBorder rounded-[4px]" />
              <div className="h-[12px] w-[40px] bg-newTableBorder rounded-[4px]" />
            </div>
          ))}
        </div>
      ) : kpiCards.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px]">
          {kpiCards.map((kpi) => (
            <KpiCard key={kpi.metric} label={kpi.label} total={kpi.total} percentageChange={kpi.percentageChange ?? null} sparklineData={kpi.sparklineData} />
          ))}
        </div>
      ) : null}

      {/* Thread Loading Skeleton */}
      {!postLoading && !posts?.length && (
        <div className="flex flex-col gap-[6px] animate-pulse">
          <div className="h-[16px] w-[60px] bg-newTableBorder rounded-[4px]" />
          <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[10px]">
            <div className="h-[13px] w-[100px] bg-newTableBorder rounded-[4px] mb-[4px]" />
            <div className="h-[14px] w-full bg-newTableBorder rounded-[4px]" />
          </div>
        </div>
      )}

      {/* Thread Section */}
      {posts?.length > 1 && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[16px] font-[500]">
            {t('thread', 'Thread')}
          </div>
          <div className="flex flex-col gap-[6px]">
            {posts.map((post: any, index: number) => (
              <div
                key={post.id}
                className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[10px]"
              >
                <div className="text-[13px] text-newTableText mb-[4px]">
                  {index === 0
                    ? t('original_post', 'Original post')
                    : t('reply_index', 'Reply {{index}}', { index })}
                </div>
                <div className="text-[14px] break-words">
                  {stripHtmlValidation('none', post.content, false, true, false) ||
                    t('no_content', 'no content')}
                </div>
                {post.image && tryParseJSON(post.image, []).length > 0 && (
                  <div className="flex gap-[6px] mt-[8px] flex-wrap">
                    {tryParseJSON(post.image, []).map((img: any) => (
                      <SafeImage
                        key={img.path || img}
                        src={img.path || img}
                        className="w-[80px] h-[80px] rounded-[6px] object-cover"
                        alt=""
                        width={80}
                        height={80}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Replies (synced social comments) Section */}
      <div className="flex flex-col gap-[8px]">
        <div className="text-[16px] font-[500]">
          {t('replies', 'Replies')}
        </div>
        {state !== 'PUBLISHED' || !mainPost?.releaseId || mainPost.releaseId === 'missing' ? (
          <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[20px] text-center">
            <div className="text-newTableText text-[14px]">
              {t('scheduled_not_published_yet', 'Scheduled / not yet published — no engagement yet')}
            </div>
          </div>
        ) : (
          <CommentThread
            postId={postId}
            integrationId={mainPost?.integration?.id || ''}
            releaseId={mainPost?.releaseId || ''}
            integrationName={mainPost?.integration?.name || ''}
          />
        )}
      </div>
    </div>
  );
};
