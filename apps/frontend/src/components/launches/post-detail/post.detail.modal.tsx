'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import clsx from 'clsx';
import Link from 'next/link';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import SafeImage from '@postmill-ai/react/helpers/safe.image';
import { pushAgentUiContext } from '@postmill-ai/frontend/components/agent/agent-context-bridge';
import { readableTextColor } from '@postmill-ai/frontend/components/shared/readable-text-color';
import { newDayjs } from '@postmill-ai/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@postmill-ai/frontend/components/launches/helpers/isuscitizen.utils';
import {
  KebabMenu,
  KebabMenuItem,
} from '@postmill-ai/frontend/components/ui/kebab-menu';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { IntegrationContext } from '@postmill-ai/frontend/components/launches/helpers/use.integration';
import { GeneralPreviewComponent } from '@postmill-ai/frontend/components/launches/general.preview.component';
import { Providers } from '@postmill-ai/frontend/components/composer/providers/show.all.providers';
import { getProviderSettingsMeta } from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { useLaunchStore } from '@postmill-ai/frontend/components/composer/store';
import { CommentThread } from './comment.thread';

interface PostDetailModalProps {
  postId: string;
  // Calendar card actions, wired through openPostDetail. All optional so the
  // modal also renders standalone (tests, future call sites).
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onChangeColor?: () => void;
}

const usePostDetail = (postId: string) => {
  const fetch = useFetch();
  const loadPost = useCallback(async () => {
    const res = await fetch(`/posts/${postId}`);
    if (!res.ok) {
      throw new Error('failed_to_load_post');
    }
    return res.json();
  }, [postId, fetch]);
  return useSWR(`/posts/${postId}`, loadPost);
};

const usePostStatistics = (postId: string) => {
  const fetch = useFetch();
  const loadStats = useCallback(async () => {
    const res = await fetch(`/posts/${postId}/statistics`);
    if (!res.ok) {
      return null;
    }
    return res.json();
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
    const res = await fetch(`/analytics/v2/post/${postId}?date=${date}`);
    if (!res.ok) {
      return null;
    }
    return res.json();
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

// All per-channel posts of the group (multi-channel tabs). Optional — the
// modal falls back to the single-channel payload of /posts/:id.
const usePostGroup = (group?: string) => {
  const fetch = useFetch();
  const loadGroup = useCallback(async () => {
    const res = await fetch(`/posts/group/${group}`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  }, [group, fetch]);
  return useSWR(group ? `/posts/group/${group}` : null, loadGroup);
};

// Campaign name for the details section — only fires when the post belongs to
// a campaign.
const useCampaign = (campaignId?: string | null) => {
  const fetch = useFetch();
  const loadCampaign = useCallback(async () => {
    const res = await fetch(`/campaigns/${campaignId}`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  }, [campaignId, fetch]);
  return useSWR(campaignId ? `/campaigns/${campaignId}` : null, loadCampaign, {
    revalidateOnFocus: false,
  });
};

// Org team, fetched only when an approver id needs resolving to a name.
const useTeam = (approvedById?: string | null) => {
  const fetch = useFetch();
  const loadTeam = useCallback(async () => {
    const res = await fetch(`/settings/team`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  }, [fetch]);
  return useSWR(approvedById ? `/settings/team` : null, loadTeam, {
    revalidateOnFocus: false,
  });
};

const formatDateTime = (value?: string | Date | null) =>
  value
    ? newDayjs(value)
        .local()
        .format(isUSCitizen() ? 'MMM D, YYYY hh:mm A' : 'MMM D, YYYY HH:mm')
    : null;

const StatePill: FC<{ state: string; error?: string | null }> = ({
  state,
  error,
}) => {
  const t = useT();

  const config: Record<string, { bg: string; label: string; pulse?: boolean }> =
    {
      PUBLISHED: { bg: 'bg-green-500', label: t('published', 'Published') },
      QUEUE: { bg: 'bg-blue-500', label: t('scheduled', 'Scheduled') },
      DRAFT: { bg: 'bg-amber-500', label: t('draft', 'Draft') },
      // 0.7: transient claim state while the publish worker is posting.
      PUBLISHING: {
        bg: 'bg-blue-500',
        label: t('publishing', 'Publishing'),
        pulse: true,
      },
      ERROR: { bg: 'bg-red-500', label: t('failed', 'Failed') },
    };

  const pill = config[state] || config.QUEUE;
  return (
    <div
      className={`inline-flex items-center gap-[4px] ${pill.bg} text-white text-xs px-[6px] py-[2px] rounded-full shrink-0`}
      {...(state === 'ERROR'
        ? {
            'data-tooltip-id': 'tooltip',
            'data-tooltip-content':
              error ||
              t(
                'post_error_occurred',
                'An error occurred while publishing this post'
              ),
          }
        : {})}
    >
      <div
        className={clsx(
          'w-[6px] h-[6px] rounded-full bg-white',
          pill.pulse && 'animate-pulse'
        )}
      />
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
  const arrow = isPositive ? '↑' : '↓';

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

// One label/value pair in the details grid.
const DetailRow: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-col gap-[2px] min-w-0">
    <div className="text-[11px] text-newTableText">{label}</div>
    <div className="text-[13px] min-w-0 break-words">{children}</div>
  </div>
);

// A mono id that copies itself on click (post id, group id).
const CopyableId: FC<{ value: string }> = ({ value }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable (permissions) — the id is still selectable
        }
      }}
      className="font-mono text-[12px] text-left truncate max-w-full hover:text-btnPrimary transition-colors"
      data-tooltip-id="tooltip"
      data-tooltip-content={
        copied ? t('copied', 'Copied!') : t('click_to_copy', 'Click to copy')
      }
      aria-label={t('copy_id', 'Copy {{value}}', { value })}
    >
      {copied ? '✓ ' : ''}
      {value}
    </button>
  );
};

// Map the API's integration projection onto the composer's Integrations shape
// (`identifier` / `display`) that previews expect from IntegrationContext.
const toContextIntegration = (integration: any) =>
  integration
    ? {
        ...integration,
        identifier:
          integration.identifier || integration.providerIdentifier || '',
        display: integration.display || integration.profile || '',
      }
    : undefined;

// Static lookup of each provider's CustomPreviewComponent, built once at module
// scope (the underlying components are static — a per-render memo would re-run
// the react-hooks/static-components rule).
const CUSTOM_PREVIEW_BY_IDENTIFIER: Record<
  string,
  FC<{ maximumCharacters?: number }> | undefined
> = {};
for (const entry of Providers) {
  CUSTOM_PREVIEW_BY_IDENTIFIER[entry.identifier] = getProviderSettingsMeta(
    entry.component
  )?.CustomPreviewComponent;
}

// The composer's own preview for one channel: IntegrationContext feeds the
// post's content + media, the provider's CustomPreviewComponent (when any)
// renders the channel chrome, GeneralPreviewComponent is the fallback.
const ChannelPreview: FC<{
  integration: any;
  thread: any[];
  allIntegrations: any[];
  publishDate?: string;
}> = ({ integration, thread, allIntegrations, publishDate }) => {
  // The previews read `current` from the launch store to decide global vs.
  // channel chrome — pin it to this channel while the preview is mounted.
  useEffect(() => {
    const previous = useLaunchStore.getState().current;
    useLaunchStore.getState().setCurrent(integration?.id || 'global');
    return () => {
      useLaunchStore.getState().setCurrent(previous);
    };
  }, [integration?.id]);

  const contextValue = useMemo(
    () =>
      ({
        date: publishDate ? newDayjs(publishDate) : newDayjs(),
        integration: toContextIntegration(integration),
        allIntegrations: allIntegrations.map(toContextIntegration),
        value: thread.map((p: any) => ({
          id: p.id,
          content: p.content || '',
          image: Array.isArray(p.image) ? p.image : tryParseJSON(p.image, []),
        })),
      } as any),
    [integration, allIntegrations, thread, publishDate]
  );

  const CustomPreviewComponent =
    CUSTOM_PREVIEW_BY_IDENTIFIER[integration?.providerIdentifier || ''];

  return (
    <IntegrationContext.Provider value={contextValue}>
      {/* Custom previews (e.g. YouTube) are absolutely positioned to fill their
          composer pane — contain them in a bounded relative box, or they cover
          the whole modal. The general preview flows naturally. */}
      <div
        className={clsx(
          'border border-borderPreview rounded-[12px] shadow-previewShadow overflow-hidden',
          CustomPreviewComponent && 'relative h-[420px] overflow-y-auto'
        )}
      >
        {CustomPreviewComponent ? (
          <CustomPreviewComponent maximumCharacters={100000000} />
        ) : (
          <GeneralPreviewComponent maximumCharacters={100000000} />
        )}
      </div>
    </IntegrationContext.Provider>
  );
};

// Loading placeholder mirroring the modal's real layout — header band,
// preview + analytics grid, details box, replies box.
const PostDetailSkeleton: FC = () => (
  <div
    className="flex flex-col text-textColor animate-pulse"
    data-testid="post-detail-skeleton"
  >
    {/* header band */}
    <div className="rounded-tl-[11px] rounded-tr-[11px] flex items-center gap-[10px] ps-[12px] pe-[6px] py-[8px] bg-newTableHeader">
      <div className="w-[36px] h-[36px] min-w-[36px] rounded-[8px] bg-newTableBorder" />
      <div className="flex-1 flex flex-col gap-[6px]">
        <div className="h-[14px] w-[140px] rounded-[4px] bg-newTableBorder" />
        <div className="h-[11px] w-[100px] rounded-[4px] bg-newTableBorder" />
      </div>
      <div className="h-[20px] w-[80px] rounded-full bg-newTableBorder" />
      <div className="w-[24px] h-[24px] rounded-[6px] bg-newTableBorder" />
      <div className="w-[24px] h-[24px] rounded-[6px] bg-newTableBorder" />
    </div>
    {/* body */}
    <div className="flex flex-col gap-[16px] p-[16px] md:p-[24px]">
      {/* channel tabs */}
      <div className="flex items-center gap-[6px]">
        <div className="h-[26px] w-[130px] rounded-full bg-newTableBorder" />
        <div className="h-[26px] w-[150px] rounded-full bg-newTableBorder" />
      </div>
      {/* preview + analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-[16px] items-start">
        <div className="flex flex-col gap-[8px] min-w-0">
          <div className="h-[14px] w-[60px] rounded-[4px] bg-newTableBorder" />
          <div className="border border-newTableBorder rounded-[12px] p-[15px] flex flex-col gap-[10px]">
            <div className="flex items-center gap-[8px]">
              <div className="w-[40px] h-[40px] min-w-[40px] rounded-full bg-newTableBorder" />
              <div className="flex flex-col gap-[6px]">
                <div className="h-[14px] w-[120px] rounded-[4px] bg-newTableBorder" />
                <div className="h-[11px] w-[90px] rounded-[4px] bg-newTableBorder" />
              </div>
            </div>
            <div className="h-[12px] w-full rounded-[4px] bg-newTableBorder" />
            <div className="h-[12px] w-[70%] rounded-[4px] bg-newTableBorder" />
            <div className="h-[180px] w-full rounded-[16px] bg-newTableBorder" />
          </div>
        </div>
        <div className="flex flex-col gap-[10px] min-w-0">
          <div className="flex items-center justify-between gap-[8px]">
            <div className="h-[14px] w-[80px] rounded-[4px] bg-newTableBorder" />
            <div className="h-[24px] w-[170px] rounded-full bg-newTableBorder" />
          </div>
          <div className="grid grid-cols-2 gap-[12px]">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[14px] flex flex-col gap-[8px]"
              >
                <div className="h-[13px] w-[60px] bg-newTableBorder rounded-[4px]" />
                <div className="h-[28px] w-[80px] bg-newTableBorder rounded-[4px]" />
                <div className="h-[12px] w-[40px] bg-newTableBorder rounded-[4px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* details */}
      <div className="flex flex-col gap-[8px]">
        <div className="h-[16px] w-[70px] rounded-[4px] bg-newTableBorder" />
        <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[14px] grid grid-cols-2 md:grid-cols-3 gap-x-[16px] gap-y-[12px]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col gap-[4px]">
              <div className="h-[11px] w-[50px] rounded-[4px] bg-newTableBorder" />
              <div className="h-[13px] w-[110px] rounded-[4px] bg-newTableBorder" />
            </div>
          ))}
        </div>
      </div>
      {/* replies */}
      <div className="flex flex-col gap-[8px]">
        <div className="h-[16px] w-[80px] rounded-[4px] bg-newTableBorder" />
        <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] h-[80px]" />
      </div>
    </div>
  </div>
);

export const PostDetailModal: FC<PostDetailModalProps> = ({
  postId,
  onEdit,
  onDuplicate,
  onDelete,
  onChangeColor,
}) => {
  const t = useT();
  const { mutate } = useSWRConfig();
  const modal = useModals();

  const fetch = useFetch();
  const hasMarkedRef = useRef(false);
  const [dateRange, setDateRange] = useState(30);
  const [channelIndex, setChannelIndex] = useState(0);

  const {
    data: postData,
    error: postError,
    isLoading: postLoading,
  } = usePostDetail(postId);
  const { data: groupData } = usePostGroup(postData?.group);

  // One channel per thread root. Falls back to the single-channel /posts/:id
  // payload while the group fetch is in flight (or when it fails).
  const channels = useMemo(() => {
    const source: any[] = groupData?.posts?.length
      ? groupData.posts
      : postData?.posts || [];
    if (!source.length) {
      return [] as { root: any; integration: any; thread: any[] }[];
    }
    const byId = new Map<string, any>(source.map((p: any) => [p.id, p]));
    const rootOf = (p: any): any => {
      let current = p;
      const seen = new Set<string>();
      while (
        current?.parentPostId &&
        byId.has(current.parentPostId) &&
        !seen.has(current.id)
      ) {
        seen.add(current.id);
        current = byId.get(current.parentPostId);
      }
      return current;
    };
    const grouped = new Map<string, { root: any; integration: any; thread: any[] }>();
    for (const post of source) {
      const root = rootOf(post);
      if (!root) {
        continue;
      }
      if (!grouped.has(root.id)) {
        grouped.set(root.id, { root, integration: root.integration, thread: [] });
      }
      grouped.get(root.id)!.thread.push(post);
    }
    const list = [...grouped.values()];
    // The channel of the post that was clicked comes first.
    const ownsPost = (channel: { thread: any[] }) =>
      channel.thread.some((p: any) => p.id === postId) ? 1 : 0;
    list.sort((a, b) => ownsPost(b) - ownsPost(a));
    return list;
  }, [groupData, postData, postId]);

  // The selected channel tab drives the header, actions, analytics and replies
  // below. Single-channel posts stay on the post that was clicked.
  const activeChannel =
    channels[Math.min(channelIndex, Math.max(channels.length - 1, 0))] || null;
  const activePostId =
    channels.length > 1 ? activeChannel?.root?.id || postId : postId;

  const { data: analyticsData, isLoading: analyticsLoading } = usePostAnalytics(
    activePostId,
    dateRange
  );
  const { data: statsData } = usePostStatistics(activePostId);

  // Details-section lookups — campaign name and approver name resolve over SWR;
  // both keys stay null until the post payload lands, so nothing fires early.
  const detailsPost =
    (channels.length > 1 ? activeChannel?.root : null) || postData?.posts?.[0];
  const { data: campaignData } = useCampaign(detailsPost?.campaignId);
  const { data: teamData } = useTeam(
    detailsPost?.approvedById || detailsPost?.createdById
  );

  const approverName = useMemo(() => {
    if (!detailsPost?.approvedById || !teamData?.users) {
      return null;
    }
    const hit = teamData.users.find(
      (u: any) => u?.user?.id === detailsPost.approvedById
    );
    return hit?.user?.profile?.name || hit?.user?.email || null;
  }, [detailsPost, teamData]);

  // Who created the post (composer/campaign paths). Null for system/agent/API
  // creations — the created row then shows only the date + creationMethod.
  const creator = useMemo(() => {
    if (!detailsPost?.createdById || !teamData?.users) {
      return null;
    }
    const hit = teamData.users.find(
      (u: any) => u?.user?.id === detailsPost.createdById
    );
    if (!hit?.user) {
      return null;
    }
    return {
      name: hit.user.profile?.name || hit.user.email,
      email: hit.user.email as string,
    };
  }, [detailsPost, teamData]);

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
    return <PostDetailSkeleton />;
  }

  if (postError || !postData) {
    return (
      <div className="text-center py-[60px] text-newTableText">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }

  const { posts = [], integrationPicture } = postData || {};

  const mainPost = posts?.[0];
  // In a multi-channel group the active tab's root post drives the header,
  // actions, analytics and replies; otherwise it's the clicked post.
  const activePost =
    (channels.length > 1 ? activeChannel?.root : null) || mainPost;
  const state = activePost?.state || 'QUEUE';
  const integration = activePost?.integration || mainPost?.integration;

  // The calendar card, expanded: same heading colour cascade (per-post colour,
  // then first tag colour, then the default primary blue).
  const headerColor =
    postData?.settings?.color || mainPost?.tags?.[0]?.tag?.color || undefined;
  const headerTextColor = headerColor
    ? readableTextColor(headerColor)
    : '#ffffff';

  const previewThread = activeChannel?.thread?.length
    ? activeChannel.thread
    : posts;

  const hasValidReleaseUrl =
    activePost?.releaseURL &&
    activePost.releaseURL !== 'missing' &&
    /^https?:\/\//i.test(activePost.releaseURL);

  // Details-section derivations (rows below render only when data exists).
  const createdAtFormatted = formatDateTime(activePost?.createdAt);
  const updatedAtFormatted = formatDateTime(activePost?.updatedAt);
  const showUpdated =
    !!updatedAtFormatted &&
    !!activePost?.createdAt &&
    new Date(activePost.updatedAt).getTime() -
      new Date(activePost.createdAt).getTime() >
      60_000;
  const creationMethodLabels: Record<string, string> = {
    WEB: t('creation_method_web', 'composer (web)'),
    MCP: t('creation_method_mcp', 'agent (MCP)'),
    API: t('creation_method_api', 'API'),
    AUTOPOST: t('creation_method_autopost', 'auto-post'),
    CLI: t('creation_method_cli', 'CLI'),
  };
  const creationMethodLabel =
    creationMethodLabels[activePost?.creationMethod || ''] || null;
  const approvalStyles: Record<string, { cls: string; label: string }> = {
    approved: { cls: 'text-green-500', label: t('approved', 'Approved') },
    pending: {
      cls: 'text-amber-500',
      label: t('pending_approval', 'Pending approval'),
    },
    rejected: { cls: 'text-red-500', label: t('rejected', 'Rejected') },
  };
  const approval = approvalStyles[activePost?.approvalStatus || ''] || null;

  const runAndClose = (fn?: () => void) => () => {
    modal.closeAll();
    fn?.();
  };

  const actionItems: KebabMenuItem[] = [
    ...(onEdit
      ? [{ label: t('edit_post', 'Edit Post'), onClick: runAndClose(onEdit) }]
      : []),
    ...(onDuplicate
      ? [
          {
            label: t('duplicate_post', 'Duplicate Post'),
            onClick: runAndClose(onDuplicate),
          },
        ]
      : []),
    ...(hasValidReleaseUrl
      ? [
          {
            label: t('open_on_platform', 'Open on platform'),
            onClick: () =>
              window.open(activePost.releaseURL, '_blank', 'noopener,noreferrer'),
          },
        ]
      : []),
    // Opens its own stacked modal (its Apply closes all) — do not close first.
    ...(onChangeColor
      ? [{ label: t('change_color', 'Change color'), onClick: onChangeColor }]
      : []),
    ...(onDelete ? [{ divider: true as const }] : []),
    ...(onDelete
      ? [
          {
            label: t('delete_post', 'Delete Post'),
            onClick: runAndClose(onDelete),
            danger: true,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col text-textColor">
      {/* Modal header — the calendar card, expanded. Flush edge-to-edge:
          openPostDetail opens the modal with `flush: true` (and
          `withCloseButton: false`), which strips the chrome's container
          padding, so this band IS the modal header, with the close button
          inside it right of the post menu. */}
      <div
        className="rounded-tl-[11px] rounded-tr-[11px] flex items-center gap-[10px] ps-[12px] pe-[6px] py-[8px] bg-btnPrimary"
        style={{
          backgroundColor: headerColor,
          color: headerTextColor,
        }}
      >
        <div className="relative min-w-[36px]">
          <SafeImage
            src={integration?.picture || integrationPicture || '/no-picture.jpg'}
            className="w-[36px] h-[36px] rounded-[8px]"
            alt={integration?.name || ''}
            width={36}
            height={36}
          />
          {integration?.providerIdentifier && (
            <SafeImage
              src={`/icons/platforms/${integration.providerIdentifier}.png`}
              className="w-[14px] h-[14px] rounded-[4px] absolute -bottom-[4px] -end-[4px] border border-newTableBorder"
              alt={integration.providerIdentifier}
              width={14}
              height={14}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-[500] leading-[20px] truncate">
            {integration?.name || t('post', 'Post')}
          </div>
          {activePost?.publishDate && (
            <div className="text-[12px] opacity-80 leading-[16px]">
              {newDayjs(activePost.publishDate)
                .local()
                .format(
                  isUSCitizen() ? 'MMM D, YYYY hh:mm A' : 'MMM D, YYYY HH:mm'
                )}
            </div>
          )}
        </div>
        <StatePill state={state} error={activePost?.error} />
        {actionItems.length > 0 && (
          <KebabMenu
            ariaLabel={t('post_actions', 'Post actions')}
            align="right"
            size={24}
            width={188}
            items={actionItems}
            triggerClassName={clsx(
              '!text-inherit',
              headerTextColor === '#000000'
                ? 'hover:!bg-black/10'
                : 'hover:!bg-white/25'
            )}
          />
        )}
        {/* The band IS the modal header — the close button lives here, right of
            the post menu (the chrome's own close is hidden by openPostDetail). */}
        <button
          type="button"
          onClick={() => modal.closeCurrent()}
          aria-label={t('close', 'Close')}
          className={clsx(
            'shrink-0 w-[24px] h-[24px] rounded-[6px] flex items-center justify-center transition-colors',
            headerTextColor === '#000000'
              ? 'hover:!bg-black/10'
              : 'hover:!bg-white/25'
          )}
        >
          <svg
            viewBox="0 0 15 15"
            fill="none"
            width="13"
            height="13"
            aria-hidden="true"
          >
            <path
              d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Modal body — padded; everything below the header band. */}
      <div className="flex flex-col gap-[16px] p-[16px] md:p-[24px]">
      {/* Error banner */}
      {state === 'ERROR' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-[8px] p-[10px]">
          <div className="text-[12px] text-red-500 font-[500] mb-[2px]">
            {t('error_details', 'Error details')}
          </div>
          <div className="text-[12px] text-dangerText break-words">
            {activePost?.error ||
              (activePost?.errors || [])
                .map((e: any) => e.message || e.error)
                .filter(Boolean)
                .join('; ') ||
              t(
                'post_error_occurred',
                'An error occurred while publishing this post'
              )}
          </div>
        </div>
      )}

      {/* Channel tabs (multi-channel groups only) */}
      {channels.length > 1 && (
        <div
          className="flex items-center gap-[6px] flex-wrap"
          role="tablist"
          aria-label={t('channels', 'Channels')}
        >
          {channels.map((channel, index) => (
            <button
              key={channel.root.id}
              type="button"
              role="tab"
              aria-selected={index === channelIndex}
              onClick={() => setChannelIndex(index)}
              className={clsx(
                'flex items-center gap-[6px] ps-[4px] pe-[10px] py-[3px] rounded-full border text-[12px] transition-colors',
                index === channelIndex
                  ? 'border-btnPrimary bg-btnPrimary/10 text-textColor'
                  : 'border-newTableBorder text-newTableText hover:text-textColor'
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external channel avatar */}
              <img
                src={channel.integration?.picture || '/no-picture.jpg'}
                alt=""
                className="w-[20px] h-[20px] rounded-full"
              />
              {channel.integration?.name}
            </button>
          ))}
        </div>
      )}

      {/* Preview + analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-[16px] items-start">
        <div className="flex flex-col gap-[8px] min-w-0">
          <div className="text-[14px] font-[500] text-newTableText">
            {t('preview', 'Preview')}
          </div>
          <ChannelPreview
            key={activeChannel?.root?.id || 'single'}
            integration={integration}
            thread={previewThread}
            allIntegrations={channels
              .map((c) => c.integration)
              .filter(Boolean)}
            publishDate={activePost?.publishDate}
          />
        </div>
        <div className="flex flex-col gap-[10px] min-w-0">
          <div className="flex items-center justify-between gap-[8px] flex-wrap">
            <div className="text-[14px] font-[500] text-newTableText">
              {t('analytics', 'Analytics')}
            </div>
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
          </div>
          {analyticsLoading ? (
            <div data-testid="kpi-skeleton" className="grid grid-cols-2 gap-[12px]">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[14px] flex flex-col gap-[8px] animate-pulse"
                >
                  <div className="h-[13px] w-[60px] bg-newTableBorder rounded-[4px]" />
                  <div className="h-[28px] w-[80px] bg-newTableBorder rounded-[4px]" />
                  <div className="h-[12px] w-[40px] bg-newTableBorder rounded-[4px]" />
                </div>
              ))}
            </div>
          ) : kpiCards.length > 0 ? (
            <div className="grid grid-cols-2 gap-[12px]">
              {kpiCards.map((kpi) => (
                <KpiCard
                  key={kpi.metric}
                  label={kpi.label}
                  total={kpi.total}
                  percentageChange={kpi.percentageChange ?? null}
                  sparklineData={kpi.sparklineData}
                />
              ))}
            </div>
          ) : (
            <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[16px] text-center">
              <div className="text-newTableText text-[13px]">
                {t('no_analytics_yet', 'No analytics yet')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details — everything known about the post; each row renders only when
          its data exists (the command-center readout for the post). */}
      <div className="flex flex-col gap-[8px]">
        <div className="text-[16px] font-[500]">{t('details', 'Details')}</div>
        <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[14px] grid grid-cols-2 md:grid-cols-3 gap-x-[16px] gap-y-[12px]">
          <DetailRow label={t('post_id', 'Post ID')}>
            <CopyableId value={activePost?.id || postId} />
          </DetailRow>
          {createdAtFormatted && (
            <DetailRow label={t('created', 'Created')}>
              <span className="flex items-center gap-[6px] min-w-0 flex-wrap">
                {creator && (
                  <Link
                    href="/settings"
                    className="flex items-center gap-[5px] min-w-0 text-btnPrimary hover:underline"
                  >
                    <span className="w-[18px] h-[18px] rounded-full bg-btnPrimary text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                      {creator.name
                        .split(/\s+/)
                        .map((w: string) => w[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </span>
                    <span className="truncate">{creator.name}</span>
                  </Link>
                )}
                <span className="text-newTableText">
                  {creator ? '· ' : ''}
                  {createdAtFormatted}
                  {creationMethodLabel
                    ? ` · ${t('via', 'via')} ${creationMethodLabel}`
                    : ''}
                </span>
              </span>
            </DetailRow>
          )}
          {showUpdated && (
            <DetailRow label={t('last_updated', 'Last updated')}>
              {updatedAtFormatted}
            </DetailRow>
          )}
          {activePost?.group && (
            <DetailRow label={t('group', 'Group')}>
              <span className="flex items-center gap-[8px] min-w-0 flex-wrap">
                <CopyableId value={activePost.group} />
                {channels.length > 1 && (
                  <span className="flex items-center gap-[4px]">
                    {/* Channel avatars double as tab switchers — same behaviour
                        as the channel tabs above the preview. */}
                    {channels.map((channel, index) => (
                      <button
                        key={channel.root.id}
                        type="button"
                        onClick={() => setChannelIndex(index)}
                        aria-label={t('switch_to_channel', 'Switch to {{name}}', {
                          name: channel.integration?.name || '',
                        })}
                        data-tooltip-id="tooltip"
                        data-tooltip-content={channel.integration?.name}
                        className={clsx(
                          'rounded-full transition-all',
                          index === channelIndex
                            ? 'ring-2 ring-btnPrimary'
                            : 'opacity-70 hover:opacity-100'
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- external channel avatar */}
                        <img
                          src={channel.integration?.picture || '/no-picture.jpg'}
                          alt=""
                          className="w-[18px] h-[18px] rounded-full"
                        />
                      </button>
                    ))}
                    <span className="text-newTableText text-[12px] ms-[2px]">
                      {t('n_channels', '{{count}} channels', {
                        count: channels.length,
                      })}
                    </span>
                  </span>
                )}
              </span>
            </DetailRow>
          )}
          {previewThread.length > 1 && (
            <DetailRow label={t('thread', 'Thread')}>
              {t('n_posts_in_thread', '{{count}} posts in this thread', {
                count: previewThread.length,
              })}
            </DetailRow>
          )}
          {activePost?.campaignId && (
            <DetailRow label={t('campaign', 'Campaign')}>
              <Link
                href={`/campaigns/${activePost.campaignId}`}
                className="text-btnPrimary hover:underline break-all"
              >
                {campaignData?.name || activePost.campaignId}
              </Link>
            </DetailRow>
          )}
          {approval && (
            <DetailRow label={t('approval', 'Approval')}>
              <span className={approval.cls}>{approval.label}</span>
              {!!activePost?.approvedAt && (
                <span className="text-newTableText">
                  {' '}
                  · {formatDateTime(activePost.approvedAt)}
                </span>
              )}
              {approverName && (
                <span className="text-newTableText">
                  {' '}
                  · {t('by', 'by')} {approverName}
                </span>
              )}
            </DetailRow>
          )}
          {!!activePost?.intervalInDays && (
            <DetailRow label={t('recurring', 'Recurring')}>
              {t('repeats_every_n_days', 'Repeats every {{count}} days', {
                count: activePost.intervalInDays,
              })}
            </DetailRow>
          )}
          {hasValidReleaseUrl && (
            <DetailRow label={t('release', 'Release')}>
              <a
                href={activePost.releaseURL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-[4px] text-btnPrimary hover:underline break-all"
              >
                {activePost.releaseId || t('open_on_platform', 'Open on platform')}
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <path d="M15 3h6v6" />
                  <path d="M10 14L21 3" />
                </svg>
              </a>
            </DetailRow>
          )}
          {!!activePost?.tags?.length && (
            <DetailRow label={t('tags', 'Tags')}>
              <span className="flex flex-wrap gap-x-[10px] gap-y-[4px]">
                {activePost.tags.map((tw: any) => (
                  <span
                    key={tw.tag?.id || tw.tag?.name}
                    className="inline-flex items-center gap-[4px]"
                  >
                    <span
                      className="w-[8px] h-[8px] rounded-full shrink-0"
                      style={{ backgroundColor: tw.tag?.color || '#2b5cd3' }}
                    />
                    {tw.tag?.name}
                  </span>
                ))}
              </span>
            </DetailRow>
          )}
        </div>
      </div>

      {/* Replies (synced social comments) */}
      <div className="flex flex-col gap-[8px]">
        <div className="text-[16px] font-[500]">
          {t('replies', 'Replies')}
        </div>
        {state !== 'PUBLISHED' ? (
          <div className="bg-newTableHeader border border-newTableBorder rounded-[8px] p-[20px] text-center">
            <div className="text-newTableText text-[14px]">
              {t(
                'scheduled_not_published_yet',
                'Scheduled / not yet published — no engagement yet'
              )}
            </div>
          </div>
        ) : (
          <CommentThread
            postId={activePost?.id || postId}
            integrationId={activePost?.integration?.id || ''}
            releaseId={activePost?.releaseId || ''}
            integrationName={activePost?.integration?.name || ''}
          />
        )}
      </div>
      </div>
    </div>
  );
};
