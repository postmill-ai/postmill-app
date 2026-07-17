'use client';

import { FC, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import { useDashboardCampaigns, CampaignSummary } from '../hooks/useDashboardCampaigns';
import { Button } from '@gitroom/react/form/button';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const BAR_COLORS: Record<string, string> = {
  queue: 'bg-[var(--chart-5,#ffac30)]',
  published: 'bg-[var(--chart-2,#32d583)]',
  draft: 'bg-[var(--chart-3,#1d9bf0)]',
  error: 'bg-[var(--negative,#f97066)]',
};

const PostStateBar: FC<{ counts: CampaignSummary['postCounts'] }> = ({ counts }) => {
  const total = counts.queue + counts.published + counts.draft + counts.error;
  if (total === 0) return null;
  return (
    <div className="h-[6px] w-full rounded-full bg-newTableBorder overflow-hidden flex">
      {(['published', 'queue', 'draft', 'error'] as const).map((key) => {
        const value = counts[key];
        if (!value) return null;
        return (
          <div
            key={key}
            className={`h-full ${BAR_COLORS[key]}`}
            style={{ width: `${(value / total) * 100}%` }}
          />
        );
      })}
    </div>
  );
};

const GoalBar: FC<{ target: number; current: number; metric: string }> = ({
  target,
  current,
  metric,
}) => {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const color = pct >= 100 ? 'bg-[var(--positive,#32d583)]' : 'bg-btnPrimary';
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex justify-between text-[11px] text-newTableText">
        <span className="capitalize">{metric}</span>
        <span>
          {current.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div className="h-[4px] w-full rounded-full bg-newTableBorder overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const CampaignsWidget: FC = () => {
  const router = useRouter();
  const t = useT();
  const { data: campaigns, isLoading } = useDashboardCampaigns(4);

  if (isLoading) return <TabSkeleton variant="list" />;
  if (!campaigns?.length) {
    return (
      <EmptyState
        title={t('no_active_campaigns_title', 'No active campaigns')}
        description={t(
          'no_active_campaigns_description',
          'Create a campaign to group posts, channels, and goals.'
        )}
        action={
          <Button onClick={() => router.push('/campaigns?new=1')}>
            {t('create_campaign', 'Create campaign')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {campaigns.map((campaign) => {
        const daysLeft = campaign.endDate
          ? Math.max(0, dayjs(campaign.endDate).diff(dayjs(), 'day'))
          : null;
        return (
          <button
            key={campaign.id}
            type="button"
            onClick={() => router.push(`/campaigns/${campaign.id}`)}
            className="text-start p-[12px] rounded-[10px] bg-newTableHeader border border-newTableBorder hover:border-newTableText transition-colors"
          >
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[13px] font-medium text-textColor truncate">
                {campaign.name}
              </span>
              {daysLeft !== null && (
                <span className="text-[11px] text-newTableText shrink-0">
                  {daysLeft === 0
                    ? t('ends_today', 'Ends today')
                    : t('days_left_short', '{{days}}d left', { days: daysLeft })}
                </span>
              )}
            </div>
            <PostStateBar counts={campaign.postCounts} />
            {campaign.goals.length > 0 && (
              <div className="mt-[10px] flex flex-col gap-[8px]">
                {campaign.goals.slice(0, 2).map((goal) => (
                  <GoalBar key={goal.metric} {...goal} />
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};
