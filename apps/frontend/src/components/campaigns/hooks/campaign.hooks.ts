'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Campaign, CampaignEntitySlug, CampaignRef } from '@gitroom/frontend/components/campaigns/campaign-types';

export interface OrgEntityOption {
  id: string;
  name: string;
  icon?: string;
  subtitle?: string;
}

// One hook per resource (rules-of-hooks). Loaders throw on !res.ok (repo convention).

export const useCampaigns = () => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch('/campaigns');
    if (!r.ok) throw new Error(t('failed_to_load_campaigns', 'Failed to load campaigns'));
    return r.json();
  }, [fetch, t]);
  return useSWR<Campaign[]>('/campaigns', loader, { revalidateOnFocus: false });
};

export const useCampaign = (id: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}`);
    if (!r.ok) throw new Error(t('failed_to_load_campaign', 'Failed to load campaign'));
    return r.json();
  }, [fetch, id, t]);
  return useSWR<Campaign>(id ? `campaign-${id}` : null, loader, { revalidateOnFocus: false });
};

// Reverse lookup: which campaigns is this entity tagged on (for the selector).
export const useCampaignsForEntity = (entityType: string, entityId?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/for/${entityType}/${entityId}`);
    if (!r.ok) throw new Error(t('failed_to_load_campaign_tags', 'Failed to load campaign tags'));
    return r.json();
  }, [fetch, entityType, entityId, t]);
  return useSWR<CampaignRef[]>(
    entityId ? `campaigns-for-${entityType}-${entityId}` : null,
    loader,
    { revalidateOnFocus: false }
  );
};

// ── Campaign analytics (Phase 3.1) ──
// Post-snapshot analytics for a campaign, from GET /campaigns/:id/analytics.
// Shape mirrors AnalyticsService.getOverview + a `window` field.
export interface CampaignAnalyticsSeriesPoint {
  date: string;
  value: number;
  previousValue?: number;
  // 6.1 — points within the post-snapshot retention window are 'daily';
  // older points come from weekly rollup rows. Lets the chart/label render
  // the daily/weekly seam honestly.
  granularity?: 'daily' | 'weekly';
}
export interface CampaignAnalyticsKpi {
  metric: string;
  label: string;
  format: 'number' | 'percent' | 'currency' | 'time';
  total: number;
  previousTotal: number;
  percentageChange: number;
  sparkline: { date: string; value: number }[];
}
export interface CampaignAnalyticsChannel {
  integrationId: string;
  name: string;
  identifier: string;
  picture: string;
  kpis: { metric: string; label: string; format: string; total: number }[];
}
export interface CampaignAnalytics {
  range: { from: string; to: string };
  kpis: CampaignAnalyticsKpi[];
  series: Record<string, CampaignAnalyticsSeriesPoint[]>;
  byChannel: CampaignAnalyticsChannel[];
  breakdown?: { byPlatform: { identifier: string; value: number }[] };
  scope?: string;
  window?: { from: string; to: string };
}

// Default lookback (in days) when a campaign has no start date. Post rows now
// survive past 90 days at weekly granularity (R1.7 rollup), so this is a default
// window, not a hard floor clamp.
export const CAMPAIGN_SNAPSHOT_WINDOW_DAYS = 90;

// Default analytics range for a campaign:
//   to   = min(endDate ?? today, today)   — never in the future
//   from = startDate ?? to − 90d
//   from = min(from, to)                  — never an inverted (empty) range,
//          even for a campaign that ended more than 90 days ago.
export const resolveCampaignAnalyticsRange = (
  startDate?: string | null,
  endDate?: string | null
): { from: string; to: string } => {
  const today = dayjs();
  const end = endDate ? dayjs(endDate) : today;
  const to = end.isAfter(today) ? today : end;
  let from = startDate
    ? dayjs(startDate)
    : to.subtract(CAMPAIGN_SNAPSHOT_WINDOW_DAYS, 'day');
  if (from.isAfter(to)) from = to;
  return {
    from: from.format('YYYY-MM-DD'),
    to: to.format('YYYY-MM-DD'),
  };
};

export const useCampaignAnalytics = (
  campaignId?: string,
  from?: string,
  to?: string
) => {
  const fetch = useFetch();
  const t = useT();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${campaignId}/analytics${suffix}`);
    if (!r.ok) throw new Error(t('failed_to_load_campaign_analytics', 'Failed to load campaign analytics'));
    return r.json();
  }, [fetch, campaignId, suffix, t]);
  return useSWR<CampaignAnalytics>(
    campaignId ? `campaign-analytics-${campaignId}${suffix}` : null,
    loader,
    { revalidateOnFocus: false }
  );
};

export const useCampaignDashboard = (id?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}/dashboard`);
    if (!r.ok) {
      const err = new Error(t('failed_to_load_dashboard', 'Failed to load dashboard')) as Error & { status?: number };
      err.status = r.status;
      throw err;
    }
    return r.json();
  }, [fetch, id, t]);
  return useSWR<any>(id ? `campaign-dashboard-${id}` : null, loader, { revalidateOnFocus: false });
};

// Full file records for a campaign's tagged files (newest-tagged first) — feeds
// the /files-style Files tab (thumbnails + preview). Own hook, own key.
export const useCampaignFiles = (id?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}/files`);
    if (!r.ok) throw new Error(t('failed_to_load_campaign_files', 'Failed to load campaign files'));
    return r.json();
  }, [fetch, id, t]);
  return useSWR<any[]>(id ? `campaign-files-${id}` : null, loader, {
    revalidateOnFocus: false,
  });
};

// ── Campaign Discussion (internal Jira-style note thread) ──
export interface DiscussionReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}
export interface DiscussionNote {
  id: string;
  content: string;
  createdById: string;
  parentId: string | null;
  pinned: boolean;
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  isOwn: boolean;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  reactions: DiscussionReaction[];
  replies: DiscussionNote[];
}

export const useCampaignNotes = (campaignId?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${campaignId}/notes`);
    if (!r.ok) throw new Error(t('failed_to_load_discussion', 'Failed to load discussion'));
    return r.json();
  }, [fetch, campaignId, t]);
  return useSWR<DiscussionNote[]>(
    campaignId ? `campaign-notes-${campaignId}` : null,
    loader,
    { revalidateOnFocus: false }
  );
};

export interface TeamMemberRow {
  user: {
    id: string;
    email: string;
    profile?: { name?: string | null; pictureId?: string | null } | null;
  };
}
export const useTeamMembers = () => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch('/settings/team');
    if (!r.ok) throw new Error(t('failed_to_load_team', 'Failed to load team'));
    const json = await r.json();
    return (json?.users ?? []) as TeamMemberRow[];
  }, [fetch, t]);
  return useSWR<TeamMemberRow[]>('settings-team-members', loader, {
    revalidateOnFocus: false,
  });
};

// Campaign-scoped comment inbox. Reuses the /posts/inbox endpoint with a campaignId
// (and optional channel/status/assignee) filter — one hook per resource (rules-of-hooks).
export interface CampaignCommentFilters {
  status?: string;
  assigneeId?: string;
  integrationId?: string;
  unreadOnly?: boolean;
}

export const useCampaignComments = (
  campaignId?: string,
  filters: CampaignCommentFilters = {},
  cursor?: string
) => {
  const fetch = useFetch();
  const t = useT();
  const params = new URLSearchParams();
  if (campaignId) params.set('campaignId', campaignId);
  if (filters.status) params.set('status', filters.status);
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
  if (filters.integrationId) params.set('integrationId', filters.integrationId);
  if (filters.unreadOnly) params.set('unreadOnly', 'true');
  if (cursor) params.set('cursor', cursor);
  const url = `/posts/inbox?${params.toString()}`;

  const loader = useCallback(async () => {
    const r = await fetch(url);
    // 'UPGRADE_REQUIRED' is a sentinel checked by callers, not displayed — do not translate.
    if (!r.ok) throw new Error(r.status === 402 ? 'UPGRADE_REQUIRED' : t('failed_to_load_comments', 'Failed to load comments'));
    return r.json();
  }, [fetch, url, t]);

  return useSWR<{ comments: any[]; nextCursor?: string }>(
    campaignId ? url : null,
    loader,
    { revalidateOnFocus: false }
  );
};

export const useCampaignDrafts = (id?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}/drafts`);
    if (!r.ok) throw new Error(t('failed_to_load_drafts', 'Failed to load drafts'));
    return r.json();
  }, [fetch, id, t]);
  return useSWR<Record<string, any[]>>(id ? `campaign-drafts-${id}` : null, loader, {
    revalidateOnFocus: false,
  });
};

export const useCampaignReport = (id?: string, format: 'json' | 'csv' | 'pdf' = 'json') => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}/report?format=${format}`);
    if (!r.ok) throw new Error(t('failed_to_load_report', 'Failed to load report'));
    if (format === 'json') return r.json();
    return r.blob();
  }, [fetch, id, format, t]);
  return useSWR<any>(id && format === 'json' ? `campaign-report-${id}` : null, loader, {
    revalidateOnFocus: false,
  });
};

export const useCampaignChangelog = (id?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/campaigns/${id}/dashboard`);
    if (!r.ok) throw new Error(t('failed_to_load_changelog', 'Failed to load changelog'));
    const data = await r.json();
    return data.recentChangelog || [];
  }, [fetch, id, t]);
  return useSWR<any[]>(id ? `campaign-dashboard-${id}` : null, loader, {
    revalidateOnFocus: false,
  });
};

export const usePublicCampaignReport = (token?: string) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    const r = await fetch(`/public/campaign-report/${token}`);
    if (!r.ok) throw new Error(t('failed_to_load_shared_report', 'Failed to load shared report'));
    return r.json();
  }, [fetch, token, t]);
  return useSWR<any>(token ? `public-campaign-report-${token}` : null, loader, {
    revalidateOnFocus: false,
  });
};

// Load a searchable list of org entities for the campaign universal item picker.
// Each entity type is normalized to { id, name, icon?, subtitle? }.
export const useOrgEntities = (type?: CampaignEntitySlug) => {
  const fetch = useFetch();
  const t = useT();
  const loader = useCallback(async () => {
    if (!type) return [];

    const normalize = (raw: any[]): OrgEntityOption[] => {
      return raw.map((item) => ({
        id: item.id,
        name: item.name || item.originalName || item.displayName || t('untitled', 'Untitled'),
        icon: item.picture || item.path || item.icon || item.identifier || undefined,
        subtitle: item.type || item.identifier || item.provider || item.subtitle || undefined,
      }));
    };

    if (type === 'post') {
      const r = await fetch('/posts/list?state=all&limit=1000');
      if (!r.ok) throw new Error(t('failed_to_load_posts', 'Failed to load posts'));
      const data = expandPostsList(await r.json());
      return (data.posts || []).map((post: any) => ({
        id: post.id,
        name:
          post.title ||
          post.content?.replace(/<[^>]+>/g, ' ').trim().slice(0, 60) ||
          t('untitled_post', 'Untitled post'),
        icon: post.integration?.picture,
        subtitle: post.publishDate
          ? dayjs(post.publishDate).format(t('campaign_post_date_format', 'MMM D, YYYY HH:mm'))
          : post.state,
      }));
    }

    if (type === 'channel') {
      const r = await fetch('/integrations/list');
      if (!r.ok) throw new Error(t('failed_to_load_channels', 'Failed to load channels'));
      const data = await r.json();
      return normalize(data.integrations || []);
    }

    if (type === 'brand') {
      const r = await fetch('/brands');
      if (!r.ok) throw new Error(t('failed_to_load_brands', 'Failed to load brands'));
      const data = await r.json();
      return normalize(Array.isArray(data) ? data : data.brands || []);
    }

    if (type === 'file') {
      const r = await fetch('/files?page=0&limit=1000');
      if (!r.ok) throw new Error(t('failed_to_load_files', 'Failed to load files'));
      const data = await r.json();
      return normalize(data.results || []);
    }

    if (type === 'signature') {
      const r = await fetch('/signatures');
      if (!r.ok) throw new Error(t('failed_to_load_signatures', 'Failed to load signatures'));
      const data = await r.json();
      return normalize(Array.isArray(data) ? data : data.signatures || []);
    }

    if (type === 'set') {
      const r = await fetch('/sets');
      if (!r.ok) throw new Error(t('failed_to_load_sets', 'Failed to load sets'));
      const data = await r.json();
      return normalize(Array.isArray(data) ? data : data.sets || []);
    }

    if (type === 'vpn') {
      const r = await fetch('/settings/vpn/config');
      if (!r.ok) throw new Error(t('failed_to_load_vpn_configs', 'Failed to load VPN configs'));
      const data = await r.json();
      return normalize(data.providers || []);
    }

    if (type === 'llm') {
      const r = await fetch('/settings/ai/config');
      if (!r.ok) throw new Error(t('failed_to_load_ai_configs', 'Failed to load AI configs'));
      const data = await r.json();
      return normalize(data.providers || []);
    }

    if (type === 'storage') {
      const r = await fetch('/settings/storage');
      if (!r.ok) throw new Error(t('failed_to_load_storage_configs', 'Failed to load storage configs'));
      const data = await r.json();
      return normalize(Array.isArray(data) ? data : data.providers || []);
    }

    return [];
  }, [fetch, type, t]);
  return useSWR<OrgEntityOption[]>(type ? `org-entities-${type}` : null, loader, {
    revalidateOnFocus: false,
  });
};
