'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { CloseModalButton } from '@gitroom/frontend/components/shared/close-modal-button';
import {
  CampaignEntitySlug,
  ResolvedCampaignItem,
} from '@gitroom/frontend/components/campaigns/campaign-types';
import {
  PanelItem,
  AddItemsModal,
} from '@gitroom/frontend/components/campaigns/dashboard/tagged-items-panels';

// Dedicated Post Templates section — the campaign's tagged Sets ("Post Templates"),
// each openable in the composer as a fresh, campaign-scoped draft. Owns its own
// Add flow (reusing the generalized AddItemsModal restricted to sets), mirroring
// the dedicated Channels/Files sections that were pulled out of Tagged Items.
export const CampaignTemplatesSection: FC<{
  campaignId: string;
  templates: ResolvedCampaignItem[];
  onMutate: () => void;
}> = ({ campaignId, templates, onMutate }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const setLaunchCampaignId = useLaunchStore((state) => state.setCampaignId);

  const { data: integrations } = useSWR<Integrations[]>(
    '/integrations/list',
    async () => {
      const r = await fetch('/integrations/list');
      if (!r.ok) throw new Error(t('failed_to_load_channels', 'Failed to load channels'));
      return (await r.json()).integrations;
    },
    { revalidateOnFocus: false }
  );

  const remove = useCallback(
    async (_entityType: CampaignEntitySlug, entityId: string) => {
      if (removingId) return;
      setRemovingId(entityId);
      try {
        const r = await fetch(`/campaigns/${campaignId}/items/set/${entityId}`, {
          method: 'DELETE',
        });
        if (!r.ok) throw new Error();
        toaster.show(t('item_untagged', 'Item removed'), 'success');
        onMutate();
      } catch {
        toaster.show(t('failed_to_untag_item', 'Failed to remove item'), 'warning');
      } finally {
        setRemovingId(null);
      }
    },
    [campaignId, fetch, onMutate, removingId, t, toaster]
  );

  // Open a tagged Post Template (Set) in the planner, pre-applied as a new post.
  const openTemplate = useCallback(
    async (setId: string) => {
      let parsed: any = null;
      try {
        const r = await fetch('/sets');
        if (!r.ok) throw new Error();
        const data = await r.json();
        const list = Array.isArray(data) ? data : data.sets || [];
        const found = list.find((s: any) => s.id === setId);
        if (found) parsed = JSON.parse(found.content);
      } catch {
        /* fall through to an empty template */
      }
      setLaunchCampaignId(campaignId);
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
              set={parsed || undefined}
              integrations={integrations || []}
              allIntegrations={integrations || []}
              reopenModal={() => undefined}
              mutate={onMutate}
              customClose={close}
              padding="p-0"
            />
          </div>
        ),
      });
    },
    [campaignId, fetch, integrations, modal, onMutate, setLaunchCampaignId]
  );

  const openAddModal = useCallback(() => {
    modal.openModal({
      title: t('add_post_templates', 'Add post templates'),
      withCloseButton: true,
      children: (
        <AddItemsModal
          campaignId={campaignId}
          existingItems={{ set: templates }}
          types={['set']}
          defaultType="set"
          onDone={() => {
            modal.closeAll();
            onMutate();
          }}
        />
      ),
    });
  }, [campaignId, modal, onMutate, t, templates]);

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <div className="flex items-center justify-between mb-[12px]">
        <div className="flex items-center gap-[8px]">
          <h3 className="text-[16px] font-semibold text-textColor">
            {t('post_templates', 'Post Templates')}
          </h3>
          {templates.length > 0 && (
            <span className="text-[12px] text-newTableText">({templates.length})</span>
          )}
        </div>
        <Button onClick={openAddModal} className="!h-[32px] !px-[12px] text-[13px]">
          {t('add', 'Add')}
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t(
            'no_tagged_templates',
            'No post templates yet. Click Add to tag a saved template to this campaign.'
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-[8px]">
          {templates.map((item) => (
            <PanelItem
              key={item.id}
              t={t}
              item={item}
              onRemove={remove}
              busy={removingId === item.id}
              onOpen={() => openTemplate(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CampaignTemplatesSection;
