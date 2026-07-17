'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CommentCard, InboxComment } from './comment.card';
import { PageHeader } from '@gitroom/frontend/components/ui/page-header';
import { RepliesFilterBar } from './filters/replies.filter.bar';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  useTeamMembers,
  TeamMemberItem,
} from '@gitroom/frontend/components/settings/roles/hooks/use-roles';

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
}

export const CommentInbox: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const [filters, setFilters] = useState<ReplyFilters>({
    integrationIds: [],
    campaignIds: [],
    unreadOnly: false,
  });
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
    />
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

      {comments.length === 0 && (
        <div className="flex items-center justify-center h-[200px] text-newTableText">
          {t('comment_inbox.no_comments', 'No replies found matching your filters')}
        </div>
      )}

      <div className="flex flex-col gap-[8px]">
        {comments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            onChanged={mutate}
            enableReply
            enableLike
            enableStatusCycle
            teamMembers={teamMembers}
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
