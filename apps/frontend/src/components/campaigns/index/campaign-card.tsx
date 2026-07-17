'use client';

import { FC } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useSWR from 'swr';
import dayjs from 'dayjs';
import Link from 'next/link';
import { KebabMenu } from '@gitroom/frontend/components/ui/kebab-menu';
import type { Campaign } from '@gitroom/frontend/components/campaigns/campaign-types';

interface CampaignEngagement {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  topPost: {
    id: string;
    title: string;
    lastViews: number | null;
    lastLikes: number | null;
    lastComments: number | null;
    integration: string;
  } | null;
}

interface CampaignCardProps {
  campaign: Campaign;
  onEdit: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export const CampaignCard: FC<CampaignCardProps> = ({
  campaign,
  onEdit,
  onCopy,
  onArchive,
  onDelete,
}) => {
  const t = useT();
  const fetch = useFetch();

  const { data: engagement } = useSWR<CampaignEngagement>(
    `campaign-engagement-${campaign.id}`,
    async () => {
      const r = await fetch(`/campaigns/${campaign.id}/engagement`);
      if (!r.ok) throw new Error(t('failed_to_load_campaign_engagement', 'Failed to load campaign engagement'));
      return r.json();
    },
    { revalidateOnFocus: false },
  );

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="flex items-stretch justify-between p-[16px] bg-newBgColor border border-newTableBorder rounded-[8px] gap-[16px] hover:bg-newBgColor/80 transition-colors"
      style={campaign.color ? { borderLeftColor: campaign.color, borderLeftWidth: 4 } : undefined}
    >
      <div className="flex-1 flex flex-col gap-[8px] min-w-0">
        <div className="flex items-center justify-between gap-[8px]">
          <div className="flex items-center gap-[8px] min-w-0">
            <span className="text-[15px] font-medium truncate">{campaign.name}</span>
            {campaign.archived && (
              <span className="shrink-0 text-[11px] bg-newTableText/20 text-newTableText px-[6px] py-[1px] rounded-full">
                {t('archived', 'Archived')}
              </span>
            )}
          </div>
          <KebabMenu
            ariaLabel={t('campaign_actions', 'Campaign actions')}
            insideLink
            items={[
              { label: t('edit', 'Edit'), onClick: onEdit },
              { label: t('copy', 'Copy'), onClick: onCopy },
              {
                label: campaign.archived
                  ? t('unarchive', 'Unarchive')
                  : t('archive', 'Archive'),
                onClick: onArchive,
              },
              { divider: true },
              { label: t('delete', 'Delete'), onClick: onDelete, danger: true },
            ]}
          />
        </div>
        {campaign.description && (
          <p className="text-[12px] text-newTableText">{campaign.description}</p>
        )}
        <div className="flex gap-[16px] text-[12px] text-newTableText flex-wrap">
          <span>{campaign._count.posts} {t('posts', 'Posts')}</span>
          {campaign.startDate && (
            <span>{dayjs(campaign.startDate).format(t('campaign_card_start_date_format', 'MMM D'))} - {campaign.endDate ? dayjs(campaign.endDate).format(t('campaign_date_format', 'MMM D, YYYY')) : t('ongoing', 'Ongoing')}</span>
          )}
          {campaign.client && (
            <span>{t('client', 'Client')}: {campaign.client}</span>
          )}
          {campaign.project && (
            <span>{t('project', 'Project')}: {campaign.project}</span>
          )}
        </div>
        {!!campaign.tags?.length && (
          <div className="flex flex-wrap items-center gap-[6px]">
            {campaign.tags.map((tag) => (
              <span
                key={tag}
                className="px-[8px] py-[2px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[11px]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {engagement && (
          <div className="flex gap-[16px] text-[12px] flex-wrap">
            {engagement.totalViews > 0 && (
              <span className="text-newTableText">
                {t('views', 'Views')}: {Math.round(engagement.totalViews).toLocaleString()}
              </span>
            )}
            {engagement.totalLikes > 0 && (
              <span className="text-newTableText">
                {t('likes', 'Likes')}: {Math.round(engagement.totalLikes).toLocaleString()}
              </span>
            )}
            {engagement.totalComments > 0 && (
              <span className="text-newTableText">
                {t('replies', 'Replies')}: {Math.round(engagement.totalComments).toLocaleString()}
              </span>
            )}
          </div>
        )}
        {engagement?.topPost && (
          <div className="text-[11px] text-newTableText/70">
            {t('top_post', 'Top Post')}: {engagement.topPost.title} ({engagement.topPost.integration})
            {engagement.topPost.lastLikes ? ` — ${Math.round(engagement.topPost.lastLikes)} likes` : ''}
          </div>
        )}
      </div>
    </Link>
  );
};
