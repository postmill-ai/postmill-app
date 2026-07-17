'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useSWR, { mutate as swrMutate } from 'swr';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useToaster } from '@gitroom/react/toaster/toaster';
import dayjs from 'dayjs';
import { CreateEditCampaignModal } from '@gitroom/frontend/components/campaigns/index/create-edit-campaign.modal';
import { CopyCampaignModal } from '@gitroom/frontend/components/campaigns/index/copy-campaign.modal';
import { CampaignCard } from '@gitroom/frontend/components/campaigns/index/campaign-card';
import {
  CampaignFilterBar,
  DEFAULT_CAMPAIGN_FILTERS,
  type CampaignFilters,
} from '@gitroom/frontend/components/campaigns/index/campaign-filter-bar';
import type { Campaign } from '@gitroom/frontend/components/campaigns/campaign-types';

const PAGE_SIZE = 25;

export const CampaignsPage: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const toast = useToaster();

  const [filters, setFilters] = useState<CampaignFilters>(DEFAULT_CAMPAIGN_FILTERS);
  const [page, setPage] = useState(0);

  const { data: campaigns, error, isLoading } = useSWR<Campaign[]>(
    '/campaigns',
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(t('failed_to_load_campaigns', 'Failed to load campaigns'));
      return r.json();
    },
  );

  // Full filtered + sorted result set (pagination is applied after).
  const results = useMemo(() => {
    if (!campaigns) return [];
    const { search, status, client, tags, sort } = filters;
    let list = campaigns.filter((c) => {
      if (status === 'active' && c.archived) return false;
      if (status === 'archived' && !c.archived) return false;
      if (client && c.client !== client) return false;
      if (tags.length && !tags.every((tag) => c.tags?.includes(tag))) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          c.name,
          c.description,
          c.client,
          c.project,
          ...(c.tags || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const posts = (c: Campaign) => c._count?.posts ?? 0;
    const created = (c: Campaign) => new Date(c.createdAt).getTime();
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'oldest': return created(a) - created(b);
        case 'name': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'posts': return posts(b) - posts(a);
        case 'posts_asc': return posts(a) - posts(b);
        default: return created(b) - created(a); // 'created' = newest
      }
    });
    return list;
  }, [campaigns, filters]);

  const filtered = useMemo(
    () => results.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [results, page]
  );

  const totalPages = Math.ceil(results.length / PAGE_SIZE);

  const openCreateModal = useCallback((campaign?: Campaign) => {
    modal.openModal({
      title: campaign ? t('edit_campaign', 'Edit Campaign') : t('new_campaign', 'New Campaign'),
      withCloseButton: true,
      children: (
        <CreateEditCampaignModal
          editing={campaign || null}
          onDone={() => {
            modal.closeAll();
            swrMutate('/campaigns');
          }}
        />
      ),
    });
  }, [modal, t]);

  const openCopyModal = useCallback((campaign: Campaign) => {
    modal.openModal({
      title: t('copy_campaign', 'Copy Campaign'),
      withCloseButton: true,
      children: (
        <CopyCampaignModal
          campaignId={campaign.id}
          name={campaign.name}
          onDone={() => {
            modal.closeAll();
            swrMutate('/campaigns');
          }}
        />
      ),
    });
  }, [modal, t]);

  const remove = useCallback(async (id: string) => {
    if (await deleteDialog(t('are_you_sure_delete_campaign', 'Are you sure you want to delete this campaign?'))) {
      await fetch(`/campaigns/${id}`, { method: 'DELETE' });
      toast.show(t('campaign_deleted', 'Campaign deleted'), 'success');
      swrMutate('/campaigns');
    }
  }, [fetch, toast, t]);

  const archiveCampaign = useCallback(async (campaign: Campaign) => {
    await fetch(`/campaigns/${campaign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !campaign.archived }),
    });
    toast.show(
      campaign.archived ? t('campaign_unarchived', 'Campaign unarchived') : t('campaign_archived', 'Campaign archived'),
      'success',
    );
    swrMutate('/campaigns');
  }, [fetch, toast, t]);

  return (
    <div className="flex-1 flex flex-col p-[24px] gap-[24px]">
      <div className="flex items-center justify-between gap-[16px]">
        <p className="text-[13px] text-newTableText max-w-[720px]">
          {t(
            'campaigns_subtitle',
            'A campaign keeps everything behind one marketing push in a single place — its posts, channels, files, brand assets, and planning notes. Plan it all together, track how it performs as a whole, hit your goals, and share a polished report with your team or clients.'
          )}
        </p>
        <div className="shrink-0">
          <Button onClick={() => openCreateModal()}>{t('new', 'New')}</Button>
        </div>
      </div>

      <CampaignFilterBar
        campaigns={campaigns || []}
        filters={filters}
        onChange={(next) => { setFilters(next); setPage(0); }}
      />

      {error && (
        <div className="text-red-500 text-[13px]">
          {t('campaigns_load_error', 'Failed to load campaigns')}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-[60px] text-newTableText">
          {t('loading', 'Loading')}
        </div>
      )}

      {!isLoading && campaigns && campaigns.length === 0 && (
        <div className="flex flex-col items-center justify-center py-[60px] gap-[16px]">
          <div className="text-[16px] text-newTableText">{t('campaigns_empty', 'No campaigns yet')}</div>
          <p className="text-[13px] text-newTableText/70 max-w-[400px] text-center">
            {t('campaigns_empty_hint', 'Campaigns let you group related posts together to track their collective performance and measure the impact of your marketing initiatives.')}
          </p>
          <Button onClick={() => openCreateModal()}>{t('create_first_campaign', 'Create your first campaign')}</Button>
        </div>
      )}

      {!isLoading && campaigns && campaigns.length > 0 && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-[48px] gap-[12px]">
          <div className="text-[15px] text-newTableText">
            {t('campaigns_no_matches', 'No campaigns match your filters')}
          </div>
          <button
            type="button"
            onClick={() => { setFilters(DEFAULT_CAMPAIGN_FILTERS); setPage(0); }}
            className="text-[13px] text-btnPrimaryAccent hover:underline"
          >
            {t('clear_filters', 'Clear filters')}
          </button>
        </div>
      )}

      {!isLoading && campaigns && results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[12px]">
          {filtered.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onEdit={() => openCreateModal(campaign)}
              onCopy={() => openCopyModal(campaign)}
              onArchive={() => archiveCampaign(campaign)}
              onDelete={() => remove(campaign.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-[16px]">
          <div className="text-[12px] text-newTableText">
            {t('page_of', 'Page {{page}} of {{total}}', { page: String(page + 1), total: String(totalPages) })}
          </div>
          <div className="flex gap-[8px]">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40"
            >
              {t('previous', 'Previous')}
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40"
            >
              {t('next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
