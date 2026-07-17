'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import {
  DataTable,
  StatusPill,
  AvatarCell,
} from '@gitroom/frontend/components/ui/data-table';
import { PlatformAvatar } from '@gitroom/frontend/components/shared/platform-avatar';
import { KebabMenu, KebabMenuItem } from '@gitroom/frontend/components/ui/kebab-menu';
import { useCampaignDrafts } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { CloseModalButton } from '@gitroom/frontend/components/shared/close-modal-button';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';

const ListIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const GridIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

interface DraftPost {
  id: string;
  group?: string;
  content?: string;
  publishDate?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
  integration?: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture?: string | null;
  };
}

const stripHtml = (html?: string) => {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

export const PlanningWorkspace: FC<{ campaignId: string; onMutate: () => void }> = ({
  campaignId,
  onMutate,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const modals = useModals();
  const router = useRouter();
  const { data, error, mutate } = useCampaignDrafts(campaignId);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [promoting, setPromoting] = useState(false);
  const [blockedResults, setBlockedResults] = useState<
    Array<{ id: string; status: 'blocked' | 'not_found'; reason?: string }>
  >([]);

  // View mode: card is the default on mobile, list on desktop; a manual toggle overrides.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [viewOverride, setViewOverride] = useState<'list' | 'card' | null>(null);
  const view = viewOverride ?? (isMobile ? 'card' : 'list');

  const groups = useMemo(() => Object.entries(data || {}), [data]);
  const flatPosts = useMemo(
    () => groups.flatMap(([, posts]) => posts) as DraftPost[],
    [groups]
  );

  useEffect(() => {
    // Drop stale selections when drafts reload.
    setSelectedIds((prev) => prev.filter((id) => flatPosts.some((p) => p.id === id)));
  }, [flatPosts]);

  const handleApprove = useCallback(
    async (postId: string) => {
      const res = await fetch(`/campaigns/${campaignId}/drafts/${postId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        toast.show(t('approve_failed', 'Failed to approve draft'), 'warning');
        return;
      }
      toast.show(t('draft_approved', 'Draft approved'), 'success');
      mutate();
      onMutate();
    },
    [campaignId, fetch, mutate, onMutate, t, toast]
  );

  const handleReject = useCallback(
    async (postId: string) => {
      const res = await fetch(`/campaigns/${campaignId}/drafts/${postId}/reject`, {
        method: 'POST',
      });
      if (!res.ok) {
        toast.show(t('reject_failed', 'Failed to reject draft'), 'warning');
        return;
      }
      toast.show(t('draft_rejected', 'Draft rejected'), 'success');
      mutate();
      onMutate();
    },
    [campaignId, fetch, mutate, onMutate, t, toast]
  );

  const runPromote = useCallback(async (postIds: string[]) => {
    if (!postIds.length) return;
    setPromoting(true);
    const res = await fetch(`/campaigns/${campaignId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postIds }),
    });
    setPromoting(false);
    if (!res.ok) {
      toast.show(t('promote_failed', 'Failed to promote drafts'), 'warning');
      return;
    }
    const results = (await res.json()) as Array<{
      id: string;
      status: 'promoted' | 'blocked' | 'not_found';
      reason?: string;
    }>;
    const promoted = results.filter((r) => r.status === 'promoted');
    const blocked = results
      .filter((r) => r.status !== 'promoted')
      .map((r) => ({ id: r.id, status: r.status as 'blocked' | 'not_found', reason: r.reason }));

    if (promoted.length) {
      toast.show(
        t('promoted_n_drafts', 'Promoted {{count}} drafts', { count: promoted.length }),
        'success'
      );
    }
    setBlockedResults(blocked);
    setSelectedIds((prev) => prev.filter((id) => !postIds.includes(id)));
    mutate();
    onMutate();
  }, [campaignId, fetch, mutate, onMutate, t, toast]);

  const handlePromote = useCallback(() => runPromote(selectedIds), [runPromote, selectedIds]);

  const openNewDraft = useCallback(async () => {
    const listRes = await fetch('/integrations/list');
    if (!listRes.ok) {
      toast.show(t('failed_load_integrations', 'Failed to load channels'), 'warning');
      return;
    }
    const { integrations } = await listRes.json();
    if (!integrations?.length) {
      toast.show(t('no_integrations', 'No channels available'), 'warning');
      return;
    }

    useLaunchStore.getState().setCampaignId(campaignId);
    const dayjs = (await import('dayjs')).default;

    const close = () => {
      useLaunchStore.getState().setCampaignId(null);
      modals.closeAll();
    };
    modals.openModal({
      fullScreen: true,
      removeLayout: true,
      size: '100%',
      height: '100%',
      withCloseButton: false,
      children: (
        <div className="relative w-full h-full">
          <CloseModalButton onClick={close} />
          <Composer
            date={dayjs()}
            integrations={integrations}
            allIntegrations={integrations}
            mutate={() => {
              mutate();
              onMutate();
            }}
            reopenModal={() => {}}
            customClose={close}
            padding="p-0"
          />
        </div>
      ),
    });
  }, [campaignId, fetch, modals, mutate, onMutate, t, toast]);

  const blockedMessages = useMemo(() => {
    return blockedResults.map((r) => {
      const post = flatPosts.find((p) => p.id === r.id);
      const label = post ? stripHtml(post.content).slice(0, 40) || post.id : r.id;
      return {
        id: r.id,
        text:
          r.status === 'not_found'
            ? t('draft_not_found', '"{{label}}" was not found', { label })
            : t('draft_blocked', '"{{label}}" blocked: {{reason}}', {
                label,
                reason: r.reason || t('unknown_reason', 'Unknown reason'),
              }),
      };
    });
  }, [blockedResults, flatPosts, t]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // Bulk action shown when drafts are selected. Rendered inline in the header on
  // desktop and on its own row on mobile. (Open-in-composer is per-draft only —
  // it lives in each row/card's kebab, since it can't act on a multi-selection.)
  const renderSelectionActions = () => (
    <Button type="button" onClick={handlePromote} loading={promoting}>
      {t('promote_selected', 'Promote {{count}}', { count: selectedIds.length })}
    </Button>
  );

  const viewToggle = (visibility: string) => (
    <div
      className={clsx(
        'rounded-[8px] border border-newTableBorder overflow-hidden shrink-0',
        visibility
      )}
    >
      <button
        type="button"
        onClick={() => setViewOverride('list')}
        aria-label={t('list_view', 'List view')}
        aria-pressed={view === 'list'}
        className={clsx(
          'px-[10px] py-[8px] transition-colors',
          view === 'list' ? 'bg-btnPrimary text-white' : 'text-newTableText hover:text-textColor'
        )}
      >
        {ListIcon}
      </button>
      <button
        type="button"
        onClick={() => setViewOverride('card')}
        aria-label={t('card_view', 'Card view')}
        aria-pressed={view === 'card'}
        className={clsx(
          'px-[10px] py-[8px] transition-colors',
          view === 'card' ? 'bg-btnPrimary text-white' : 'text-newTableText hover:text-textColor'
        )}
      >
        {GridIcon}
      </button>
    </div>
  );

  // Shared between the table's approval column and the card view.
  const approvalPill = (post: DraftPost) => {
    const status = post.approvalStatus || 'pending';
    const map: Record<string, { color: 'amber' | 'green' | 'red'; label: string }> = {
      pending: { color: 'amber', label: t('pending', 'Pending') },
      approved: { color: 'green', label: t('approved', 'Approved') },
      rejected: { color: 'red', label: t('rejected', 'Rejected') },
    };
    const pill = map[status] || map.pending;
    return <StatusPill status={pill.color} label={pill.label} />;
  };

  // Per-draft actions as a kebab menu (shared by the table's actions column and
  // the card view). Items are included by approval state instead of disabled.
  const renderActions = (post: DraftPost) => {
    const status = post.approvalStatus || 'pending';
    const items: KebabMenuItem[] = [];
    if (post.group) {
      items.push({
        label: t('open_in_composer', 'Open in composer'),
        onClick: () => router.push(`/posts/post/${post.group}`),
      });
    }
    const approvalItems: KebabMenuItem[] = [];
    if (status !== 'approved') {
      approvalItems.push({ label: t('approve', 'Approve'), onClick: () => handleApprove(post.id) });
    }
    if (status !== 'rejected') {
      approvalItems.push({ label: t('reject', 'Reject'), onClick: () => handleReject(post.id), danger: true });
    }
    approvalItems.push({ label: t('promote', 'Promote'), onClick: () => runPromote([post.id]) });
    if (items.length && approvalItems.length) items.push({ divider: true });
    items.push(...approvalItems);
    if (!items.length) return null;
    return <KebabMenu ariaLabel={t('draft_actions', 'Draft actions')} items={items} />;
  };

  const renderCards = (posts: DraftPost[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-[12px]">
      {posts.map((post) => {
        const selected = selectedIds.includes(post.id);
        return (
          <div
            key={post.id}
            className={clsx(
              'p-[12px] border rounded-[10px] bg-newBgColorInner flex flex-col gap-[8px] transition-colors',
              selected ? 'border-btnPrimary' : 'border-newTableBorder'
            )}
          >
            <div className="flex items-center justify-between gap-[8px]">
              <label className="flex items-center gap-[8px] min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSelect(post.id)}
                  className="shrink-0 accent-btnPrimary w-[15px] h-[15px]"
                />
                {post.integration ? (
                  <>
                    <PlatformAvatar
                      picture={post.integration.picture || undefined}
                      identifier={post.integration.providerIdentifier}
                      size={22}
                    />
                    <span className="text-[13px] text-textColor truncate">
                      {post.integration.name}
                    </span>
                  </>
                ) : (
                  <span className="text-[13px] text-newTableText">—</span>
                )}
              </label>
              <div className="flex items-center gap-[4px] shrink-0">
                {approvalPill(post)}
                {renderActions(post)}
              </div>
            </div>
            <div className="text-[13px] text-textColor line-clamp-2 min-h-[36px]">
              {stripHtml(post.content) || t('no_content', 'no content')}
            </div>
            <div className="text-[12px] text-newTableText">
              {post.publishDate
                ? dayjs(post.publishDate).format(t('campaign_draft_date_format', 'MMM D, YYYY h:mm A'))
                : t('unscheduled', 'Unscheduled')}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTable = (group: string, posts: DraftPost[]) => {
    const groupIds = posts.map((p) => p.id);
    const handleGroupSelectionChange = (ids: string[]) => {
      setSelectedIds((prev) => [
        ...prev.filter((id) => !groupIds.includes(id)),
        ...ids,
      ]);
    };

    return (
      <DataTable<DraftPost>
        key={group}
        columns={[
          {
            key: 'content',
            header: t('content', 'Content'),
            render: (post) => (
              <span className="text-[13px] text-textColor line-clamp-2">
                {stripHtml(post.content) || t('no_content', 'no content')}
              </span>
            ),
          },
          {
            key: 'channel',
            header: t('channel', 'Channel'),
            render: (post) =>
              post.integration ? (
                <AvatarCell
                  src={post.integration.picture || `/icons/platforms/${post.integration.providerIdentifier}.png`}
                  name={post.integration.name}
                />
              ) : (
                '—'
              ),
          },
          {
            key: 'schedule',
            header: t('schedule', 'Schedule'),
            render: (post) =>
              post.publishDate ? (
                <span className="text-[13px] text-newTableText">
                  {dayjs(post.publishDate).format(t('campaign_draft_date_format', 'MMM D, YYYY h:mm A'))}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'approval',
            header: t('approval', 'Approval'),
            render: (post) => approvalPill(post),
          },
          {
            key: 'actions',
            header: '',
            width: '48px',
            render: (post) => renderActions(post),
          },
        ]}
        data={posts}
        keyExtractor={(post) => post.id}
        selectedIds={selectedIds}
        onSelectionChange={handleGroupSelectionChange}
        emptyState={{
          title: t('no_drafts_in_group', 'No drafts in {{group}}', { group }),
          action: (
            <Button type="button" onClick={openNewDraft}>
              {t('new_draft', 'New Draft')}
            </Button>
          ),
        }}
      />
    );
  };

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[16px]">
      <div className="flex items-center justify-between gap-[12px]">
        <h3 className="text-[16px] font-semibold text-textColor">
          {t('planning_workspace', 'Planning Workspace')}
        </h3>
        <div className="flex items-center gap-[8px]">
          {/* Desktop: selection actions inline. On mobile they move to their own
              row below (see the mobile bar), so they don't crowd the header. */}
          {selectedIds.length > 0 && (
            <div className="hidden lg:flex items-center gap-[8px]">
              {renderSelectionActions()}
            </div>
          )}
          <Button type="button" onClick={openNewDraft}>
            {t('new_draft', 'New Draft')}
          </Button>
          {groups.length > 0 && viewToggle('flex')}
        </div>
      </div>

      {/* Mobile: selection actions on their own row, kept together. */}
      {selectedIds.length > 0 && (
        <div className="flex lg:hidden items-center gap-[8px] flex-wrap">
          {renderSelectionActions()}
        </div>
      )}

      {blockedMessages.length > 0 && (
        <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 p-[12px] flex flex-col gap-[6px]">
          <span className="text-[13px] font-medium text-dangerText">
            {t('promote_blocked', 'Some drafts could not be promoted')}
          </span>
          <ul className="list-disc list-inside text-[12px] text-red-300">
            {blockedMessages.map((m) => (
              <li key={m.id}>{m.text}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="text-[13px] text-red-500">
          {t('drafts_load_error', 'Failed to load drafts')}
        </div>
      )}

      {!error && !data && (
        <div className="text-[13px] text-newTableText">
          {t('loading', 'Loading')}
        </div>
      )}

      {!error && data && groups.length === 0 && (
        <div className="flex flex-col items-center gap-[12px] py-[32px]">
          <p className="text-[13px] text-newTableText">
            {t('no_drafts', 'No drafts yet')}
          </p>
          <Button type="button" onClick={openNewDraft}>
            {t('new_draft', 'New Draft')}
          </Button>
        </div>
      )}

      {!error &&
        data &&
        groups.map(([group, posts]) => (
          <div key={group} className="flex flex-col gap-[8px]">
            {view === 'card'
              ? renderCards(posts as DraftPost[])
              : renderTable(group, posts as DraftPost[])}
          </div>
        ))}
    </div>
  );
};
