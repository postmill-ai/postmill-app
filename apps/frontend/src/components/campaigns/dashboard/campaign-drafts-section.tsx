'use client';

import { FC, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { StatusPill } from '@gitroom/frontend/components/ui/data-table';
import { PlatformAvatar } from '@gitroom/frontend/components/shared/platform-avatar';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { CloseModalButton } from '@gitroom/frontend/components/shared/close-modal-button';
import { useCampaignDrafts } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';

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

const stripHtml = (html?: string) =>
  (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const APPROVAL_PILL: Record<string, { status: 'amber' | 'green' | 'red'; labelKey: string; label: string }> = {
  pending: { status: 'amber', labelKey: 'approval_pending', label: 'Pending' },
  approved: { status: 'green', labelKey: 'approval_approved', label: 'Approved' },
  rejected: { status: 'red', labelKey: 'approval_rejected', label: 'Rejected' },
};

// Dedicated Drafts section — the campaign's saved (DRAFT-state) posts, grouped by
// their post group (one card per multi-channel draft), each openable in the planner
// for editing. Mirrors the Files/Templates dedicated sections.
export const CampaignDraftsSection: FC<{
  campaignId: string;
  onMutate: () => void;
}> = ({ campaignId, onMutate }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const router = useRouter();
  const { data, isLoading, mutate: mutateDrafts } = useCampaignDrafts(campaignId);

  const { data: integrations } = useSWR<Integrations[]>(
    '/integrations/list',
    async () => {
      const r = await fetch('/integrations/list');
      if (!r.ok) throw new Error(t('failed_to_load_channels', 'Failed to load channels'));
      return (await r.json()).integrations;
    },
    { revalidateOnFocus: false }
  );

  // One entry per draft group; each holds its channel-variant posts.
  const groups = useMemo(
    () => Object.entries(data || {}) as [string, DraftPost[]][],
    [data]
  );
  const count = useMemo(
    () => groups.reduce((sum, [, posts]) => sum + posts.length, 0),
    [groups]
  );

  // Load an existing draft group in the planner (the canonical edit path).
  const openInPlanner = useCallback(
    (groupId: string) => {
      router.push(`/posts/post/${groupId}`);
    },
    [router]
  );

  const openNewDraft = useCallback(() => {
    useLaunchStore.getState().setCampaignId(campaignId);
    const close = () => {
      useLaunchStore.getState().setCampaignId(null);
      modal.closeAll();
    };
    modal.openModal({
      withCloseButton: false,
      fullScreen: true,
      removeLayout: true,
      size: '100%',
      height: '100%',
      children: (
        <div className="relative w-full h-full">
          <CloseModalButton onClick={close} />
          <Composer
            date={newDayjs()}
            integrations={integrations || []}
            allIntegrations={integrations || []}
            reopenModal={() => undefined}
            mutate={() => {
              mutateDrafts();
              onMutate();
            }}
            customClose={close}
            padding="p-0"
          />
        </div>
      ),
    });
  }, [campaignId, integrations, modal, mutateDrafts, onMutate]);

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <div className="flex items-center justify-between mb-[12px]">
        <div className="flex items-center gap-[8px]">
          <h3 className="text-[16px] font-semibold text-textColor">{t('post_drafts', 'Post Drafts')}</h3>
          {count > 0 && <span className="text-[12px] text-newTableText">({count})</span>}
        </div>
        <Button onClick={openNewDraft} className="!h-[32px] !px-[12px] text-[13px]">
          {t('new_draft', 'New Draft')}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t('loading', 'Loading')}
        </div>
      ) : count === 0 ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t('no_campaign_drafts', 'No drafts yet. Click New Draft to start one for this campaign.')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-[8px]">
          {groups.map(([groupId, posts]) => {
            const first = posts[0];
            const content = stripHtml(first?.content);
            const status = first?.approvalStatus || 'pending';
            const pill = APPROVAL_PILL[status] || APPROVAL_PILL.pending;
            // Dedupe the channels this draft group publishes to.
            const channelMap = new Map<string, DraftPost['integration']>();
            for (const p of posts) {
              if (p.integration?.id) channelMap.set(p.integration.id, p.integration);
            }
            const channels = [...channelMap.values()];
            return (
              <button
                key={groupId}
                type="button"
                onClick={() => openInPlanner(groupId)}
                className="text-left flex flex-col gap-[8px] p-[12px] rounded-[10px] bg-newBgColorInner border border-newTableBorder hover:border-btnPrimary/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-[8px]">
                  <div className="flex items-center">
                    {channels.slice(0, 4).map((c) => (
                      <div key={c!.id} className="-ms-[6px] first:ms-0">
                        <PlatformAvatar
                          picture={c!.picture || undefined}
                          identifier={c!.providerIdentifier}
                          size={24}
                        />
                      </div>
                    ))}
                    {channels.length > 4 && (
                      <span className="ms-[6px] text-[11px] text-newTableText">
                        +{channels.length - 4}
                      </span>
                    )}
                  </div>
                  <StatusPill status={pill.status} label={t(pill.labelKey, pill.label)} />
                </div>
                <div className="text-[13px] text-textColor line-clamp-2 min-h-[36px]">
                  {content || t('no_content', 'no content')}
                </div>
                <div className="text-[12px] text-newTableText">
                  {first?.publishDate
                    ? dayjs(first.publishDate).format(t('campaign_draft_date_format', 'MMM D, YYYY h:mm A'))
                    : t('unscheduled', 'Unscheduled')}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CampaignDraftsSection;
