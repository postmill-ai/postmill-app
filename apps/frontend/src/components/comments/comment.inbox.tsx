'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { CommentCard, InboxComment } from './comment.card';
import { PageHeader } from '@postmill-ai/frontend/components/ui/page-header';
import { RepliesFilterBar } from './filters/replies.filter.bar';
import { useIntegrationList } from '@postmill-ai/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@postmill-ai/frontend/components/launches/calendar.context';
import {
  useTeamMembers,
  TeamMemberItem,
} from '@postmill-ai/frontend/components/settings/roles/hooks/use-roles';

interface InboxResponse {
  comments: InboxComment[];
  nextCursor?: string;
}

// Inbox-local filter shape. Channels/campaigns are multi-select (arrays) — sent to the
// server as comma-joined `integrationId` / `campaignId` (see buildParams). Distinct from the
// campaign section's shared `InboxFilters` (single integrationId), which is left untouched.
interface ReplyFilters {
  status?: string;
  assigneeId?: string;
  integrationIds: string[];
  campaignIds: string[];
  unreadOnly: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
  priority?: 'high' | 'medium' | 'low';
  sortBy?: 'priority';
}

/**
 * Seed the filters from the URL so a link can land on a filtered inbox — and so
 * a filtered inbox can be linked to at all. `/replies?comment=<id>` (from the
 * dashboard inbox card) rides along: the comment is highlighted below.
 */
const filtersFromParams = (params: URLSearchParams): ReplyFilters => {
  const list = (key: string) =>
    (params.get(key) || '').split(',').map((v) => v.trim()).filter(Boolean);
  return {
    status: params.get('status') || undefined,
    assigneeId: params.get('assigneeId') || undefined,
    integrationIds: list('integrationId'),
    campaignIds: list('campaignId'),
    unreadOnly: params.get('unreadOnly') === 'true',
    sentiment: (params.get('sentiment') as ReplyFilters['sentiment']) || undefined,
    priority: (params.get('priority') as ReplyFilters['priority']) || undefined,
  };
};

export const CommentInbox: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const searchParams = useSearchParams();
  const highlightCommentId = searchParams.get('comment');
  // Initial state only — after mount the filter bar owns the filters, so
  // changing them doesn't fight the URL.
  const [filters, setFilters] = useState<ReplyFilters>(() =>
    filtersFromParams(new URLSearchParams(searchParams.toString()))
  );
  const [prioritySort, setPrioritySort] = useState(false);
  const [search, setSearch] = useState('');
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  // Page 1 comes from SWR; "Load more" appends further cursor pages here so the list
  // accumulates instead of swapping (the cursor never enters the SWR key).
  const [extraPages, setExtraPages] = useState<InboxResponse[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const updateFilters = useCallback((patch: Partial<ReplyFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Query string for the current filters, plus an optional pagination cursor.
  const buildParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.unreadOnly) params.set('unreadOnly', 'true');
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters.integrationIds.length) params.set('integrationId', filters.integrationIds.join(','));
      if (filters.campaignIds.length) params.set('campaignId', filters.campaignIds.join(','));
      if (filters.sentiment) params.set('sentiment', filters.sentiment);
      if (filters.priority) params.set('priority', filters.priority);
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [filters]
  );

  const { data, isLoading, error, mutate } = useSWR<InboxResponse>(
    `/posts/inbox?${buildParams()}`,
    async (key: string) => {
      const res = await fetch(key);
      setStatusCode(res.status);
      if (!res.ok) throw new Error(res.status === 402 ? 'UPGRADE_REQUIRED' : 'Failed to fetch inbox');
      return res.json();
    },
    { revalidateOnFocus: false }
  );

  // A fresh page-1 payload (filters changed / revalidation) resets accumulated pages.
  useEffect(() => {
    setExtraPages([]);
  }, [data]);

  // Keep the sortBy filter in sync with the priority-sort toggle.
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      sortBy: prioritySort ? 'priority' : undefined,
    }));
  }, [prioritySort]);

  // --- Filter option sources -------------------------------------------------
  const { data: integrationsData } = useIntegrationList();
  const integrations = useMemo(
    () => (integrationsData || []) as Integrations[],
    [integrationsData]
  );
  const { data: campaignData } = useSWR('/campaigns', (url: string) =>
    fetch(url).then((r) => r.json())
  );
  const campaigns = useMemo(
    () =>
      ((campaignData as Array<{ id: string; name: string }>) || []).map((c) => ({
        id: c.id,
        name: c.name,
      })),
    [campaignData]
  );
  const { data: teamData } = useTeamMembers();
  const teamMembers = useMemo(() => (teamData || []) as TeamMemberItem[], [teamData]);

  // --- Pagination ------------------------------------------------------------
  const comments = useMemo(
    () => [...(data?.comments || []), ...extraPages.flatMap((p) => p.comments)],
    [data, extraPages]
  );

  // Quick search — client-side .filter() over the loaded replies (content +
  // author), same pattern as the /posts header search. Server pagination is
  // unaffected; the filter narrows what's been loaded.
  const visibleComments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        (c.content || '').toLowerCase().includes(q) ||
        (c.authorName || '').toLowerCase().includes(q) ||
        (c.authorUsername || '').toLowerCase().includes(q)
    );
  }, [comments, search]);
  const moreCursor = extraPages.length
    ? extraPages[extraPages.length - 1].nextCursor
    : data?.nextCursor;

  const loadMore = useCallback(async () => {
    if (!moreCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/posts/inbox?${buildParams(moreCursor)}`);
      if (res.ok) {
        const page: InboxResponse = await res.json();
        setExtraPages((prev) => [...prev, { comments: page.comments || [], nextCursor: page.nextCursor }]);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [moreCursor, loadingMore, buildParams, fetch]);

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/posts/inbox/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLastSynced(data.timestamp);
        mutate();
      }
    } catch {
      // sync failure is non-fatal
    } finally {
      setSyncing(false);
    }
  }, [fetch, mutate]);

  const syncAction = (
    <div className="flex items-center gap-[8px] shrink-0">
      {lastSynced && (
        <span className="text-[11px] text-newTableText">
          {t('comment_inbox.last_synced', 'Last synced')}: {dayjs(lastSynced).format('HH:mm')}
        </span>
      )}
      <button
        onClick={handleSyncNow}
        disabled={syncing}
        className="px-[12px] py-[6px] bg-btnPrimary text-white text-[12px] font-medium rounded-[6px] transition-colors hover:bg-btnPrimary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {syncing
          ? t('comment_inbox.syncing', 'Syncing...')
          : t('comment_inbox.sync_now', 'Sync now')}
      </button>
    </div>
  );

  const filterBar = (
    <div className="flex items-center gap-[10px]">
      {/* Quick search — client-side .filter() over the loaded replies (same
          pattern as the /posts header search). Hidden on small screens. */}
      <div className="relative hidden sm:block shrink-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="absolute start-[10px] top-1/2 -translate-y-1/2 pointer-events-none text-newTableText"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('comment_inbox.search', 'Search replies...')}
          aria-label={t('comment_inbox.search', 'Search replies')}
          className="w-[190px] h-[42px] ps-[32px] pe-[26px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor outline-none focus:border-btnPrimary placeholder:text-newTableText"
        />
        {!!search && (
          <button
            type="button"
            aria-label={t('clear_search', 'Clear search')}
            onClick={() => setSearch('')}
            className="absolute end-[7px] top-1/2 -translate-y-1/2 w-[18px] h-[18px] flex items-center justify-center rounded-full text-newTableText hover:bg-boxFocused hover:text-textColor transition-all"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="9"
              height="9"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1L13 13M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <RepliesFilterBar
          status={filters.status}
          onStatusChange={(status) => updateFilters({ status })}
          integrations={integrations}
          selectedChannels={filters.integrationIds}
          onChannelsChange={(ids) => updateFilters({ integrationIds: ids })}
          campaigns={campaigns}
          selectedCampaigns={filters.campaignIds}
          onCampaignsChange={(ids) => updateFilters({ campaignIds: ids })}
          teamMembers={teamMembers}
          assigneeId={filters.assigneeId}
          onAssigneeChange={(assigneeId) => updateFilters({ assigneeId })}
          unreadOnly={filters.unreadOnly}
          onUnreadChange={(unreadOnly) => updateFilters({ unreadOnly })}
          sentiment={filters.sentiment}
          onSentimentChange={(sentiment) =>
            updateFilters({ sentiment: sentiment as ReplyFilters['sentiment'] })
          }
          priority={filters.priority}
          onPriorityChange={(priority) =>
            updateFilters({ priority: priority as ReplyFilters['priority'] })
          }
          actions={
            <label className="flex items-center gap-[8px] text-[13px] text-newTableText cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={prioritySort}
                onChange={(e) => setPrioritySort(e.target.checked)}
              />
              <div className="relative w-[36px] h-[20px] shrink-0 bg-newTableBorder rounded-full peer-checked:bg-btnPrimary after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-[16px] after:w-[16px] after:transition-all peer-checked:after:translate-x-full" />
              {t('comment_inbox.sort_priority_first', 'High priority first')}
            </label>
          }
        />
      </div>
    </div>
  );

  if (error && statusCode === 402) {
    return (
      <div className="flex flex-col items-center justify-center py-[48px] text-center">
        <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-[var(--negative,#f97066)]/10 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--negative,#f97066)]">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <p className="text-textColor text-[14px] font-medium mb-[8px]">
          {t('comment_inbox.upgrade_required', 'The reply inbox is a Pro, Team, and Agency feature')}
        </p>
        <p className="text-newTableText text-[12px] mb-[16px] max-w-[360px]">
          {t('comment_inbox.upgrade_description', 'Upgrade your plan to manage and reply to comments across all your social channels in one place.')}
        </p>
        <a
          href="/billing"
          className="px-[20px] py-[8px] bg-btnPrimary text-white text-[13px] font-medium rounded-[8px] transition-colors hover:opacity-80"
        >
          {t('comment_inbox.upgrade_cta', 'Upgrade Plan')}
        </a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-[48px] text-center">
        <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-[var(--negative,#f97066)]/10 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--negative,#f97066)]">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
        </div>
        <p className="text-newTableText text-[14px] mb-[12px]">
          {t('comment_inbox.failed_to_load', 'Failed to load inbox')}
        </p>
        <p className="text-[12px] text-newTableText/60">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-[16px] min-w-0">
        {filterBar}
        <div className="space-y-[8px] animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-newBgColorInner rounded-[8px] border border-newTableBorder p-[16px] flex items-start gap-[12px]">
              <div className="w-[36px] h-[36px] rounded-full bg-newTableHeader flex-shrink-0" />
              <div className="flex-1 space-y-[8px]">
                <div className="h-[14px] w-[180px] bg-newTableHeader rounded-[4px]" />
                <div className="h-[12px] w-full bg-newTableHeader rounded-[4px]" />
                <div className="h-[12px] w-3/4 bg-newTableHeader rounded-[4px]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] min-w-0">
      <PageHeader
        title={t('inbox', 'Inbox')}
        description={t('inbox_description', 'Manage and respond to replies across channels')}
        action={syncAction}
      />

      {filterBar}

      {visibleComments.length === 0 && (
        <div className="flex items-center justify-center h-[200px] text-newTableText">
          {t('comment_inbox.no_comments', 'No replies found matching your filters')}
        </div>
      )}

      <div className="flex flex-col gap-[8px]">
        {visibleComments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            onChanged={mutate}
            enableReply
            enableLike
            enableStatusCycle
            teamMembers={teamMembers}
            highlighted={comment.id === highlightCommentId}
          />
        ))}
      </div>

      {moreCursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center px-[20px] py-[8px] bg-btnPrimary text-white text-[13px] font-medium rounded-[8px] transition-colors hover:bg-btnPrimary/90 disabled:opacity-50"
        >
          {loadingMore ? t('loading', 'Loading') : t('comment_inbox.load_more', 'Load more')}
        </button>
      )}
    </div>
  );
};
