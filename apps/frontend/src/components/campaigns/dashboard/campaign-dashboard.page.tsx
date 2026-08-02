'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { pushAgentUiContext } from '@postmill-ai/frontend/components/agent/agent-context-bridge';
import Link from 'next/link';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { useCampaignDashboard } from '@postmill-ai/frontend/components/campaigns/hooks/campaign.hooks';
import { DashboardHeader } from '@postmill-ai/frontend/components/campaigns/dashboard/dashboard-header';
import { DashboardKpis } from '@postmill-ai/frontend/components/campaigns/dashboard/dashboard-kpis';
import { CampaignAnalyticsSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-analytics-section';
import { TaggedItemsPanels } from '@postmill-ai/frontend/components/campaigns/dashboard/tagged-items-panels';
import { CampaignChannelsSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-channels-section';
import { CampaignFilesSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-files-section';
import { CampaignTemplatesSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-templates-section';
import { CampaignDraftsSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-drafts-section';
import { CampaignPostsSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-posts-section';
import { PlanningWorkspace } from '@postmill-ai/frontend/components/campaigns/dashboard/planning-workspace';
import { ChangelogPanel } from '@postmill-ai/frontend/components/campaigns/dashboard/changelog-panel';
import { CampaignCommentsSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-comments-section';
import { CampaignDiscussionSection } from '@postmill-ai/frontend/components/campaigns/dashboard/campaign-discussion-section';
import { ChannelOption } from '@postmill-ai/frontend/components/comments/comment.inbox.filters';

type TabKey =
  | 'posts'
  | 'channels'
  | 'files'
  | 'templates'
  | 'drafts'
  | 'items'
  | 'planning'
  | 'comments'
  | 'activity';

export const CampaignDashboardPage: FC = () => {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, mutate } = useCampaignDashboard(id);
  const [tab, setTab] = useState<TabKey>('posts');

  // Unique channels across the campaign's posts power the comments channel filter.
  const channels = useMemo<ChannelOption[]>(() => {
    const map = new Map<string, ChannelOption>();
    for (const p of data?.posts || []) {
      const integ = p.integration;
      if (integ?.id && !map.has(integ.id)) {
        map.set(integ.id, {
          id: integ.id,
          name: integ.name,
          providerIdentifier: integ.providerIdentifier,
        });
      }
    }
    return [...map.values()];
  }, [data]);

  // Producer for the `/agents` view context (2.3): expose the open campaign so
  // the agent can scope actions to it. On unmount the snapshot is KEPT and
  // flagged stale (`leftViewAt`) as the user's last-viewed context, not deleted.
  useEffect(() => {
    return pushAgentUiContext({ view: 'campaigns', selectedCampaignId: id });
  }, [id]);

  if (error) {
    const notFound = (error as { status?: number })?.status === 404;
    return (
      <div className="w-full flex flex-col items-center justify-center gap-[14px] py-[80px] px-[24px] text-center">
        <div className="w-[56px] h-[56px] rounded-full bg-newBgColorInner border border-newTableBorder flex items-center justify-center text-newTableText">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
            {notFound ? (
              <path d="m9.5 11.5 5 5m0-5-5 5" />
            ) : (
              <path d="M12 10v4m0 3h.01" />
            )}
          </svg>
        </div>
        <div className="flex flex-col gap-[4px]">
          <h2 className="text-[18px] font-semibold text-textColor">
            {notFound
              ? t('campaign_not_found', 'Campaign not found')
              : t('campaign_load_failed_title', "We couldn't load this campaign")}
          </h2>
          <p className="text-[13px] text-newTableText max-w-[380px]">
            {notFound
              ? t(
                  'campaign_not_found_hint',
                  'This campaign may have been deleted or moved. Head back to pick another one.'
                )
              : t(
                  'campaign_load_failed_hint',
                  'Something went wrong loading this campaign. Try again, or head back to your campaigns.'
                )}
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          {!notFound && (
            <Button secondary onClick={() => mutate()}>
              {t('retry', 'Retry')}
            </Button>
          )}
          <Link href="/campaigns">
            <Button>{t('back_to_campaigns', 'Back to campaigns')}</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (isLoading || !data) {
    return <div className="p-[24px] text-center text-newTableText">{t('loading', 'Loading')}</div>;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'posts', label: t('posts', 'Posts') },
    { key: 'channels', label: t('channels', 'Channels') },
    { key: 'files', label: t('files', 'Files') },
    { key: 'templates', label: t('post_templates', 'Post Templates') },
    { key: 'drafts', label: t('post_drafts', 'Post Drafts') },
    { key: 'items', label: t('tagged_items', 'Tagged Items') },
    { key: 'planning', label: t('planning', 'Planning') },
    { key: 'comments', label: t('replies', 'Replies') },
    { key: 'activity', label: t('activity', 'Activity') },
  ];
  return (
    <div className="w-full flex flex-col gap-[24px] p-[24px]">
      <DashboardHeader campaign={data.campaign} onMutate={mutate} />
      <DashboardKpis dashboard={data} />
      <CampaignAnalyticsSection
        campaignId={id}
        startDate={data.campaign?.startDate}
        endDate={data.campaign?.endDate}
      />

      <OverflowTabs
        items={tabs.map((item) => ({ key: item.key, label: item.label }))}
        activeKey={tab}
        onSelect={(key) => setTab(key as TabKey)}
        ariaLabel={t('more_sections', 'More sections')}
        listAriaLabel={t('campaign_sections', 'Campaign sections')}
      />

      {tab === 'posts' && (
        <CampaignPostsSection campaignId={id} posts={data.posts} />
      )}
      {tab === 'channels' && (
        <CampaignChannelsSection
          campaignId={id}
          channels={data.channels || []}
          onMutate={mutate}
        />
      )}
      {tab === 'files' && (
        <CampaignFilesSection campaignId={id} onMutate={mutate} />
      )}
      {tab === 'templates' && (
        <CampaignTemplatesSection
          campaignId={id}
          templates={data.itemPanels?.set || []}
          onMutate={mutate}
        />
      )}
      {tab === 'drafts' && (
        <CampaignDraftsSection campaignId={id} onMutate={mutate} />
      )}
      {tab === 'items' && (
        <TaggedItemsPanels
          campaignId={id}
          items={data.itemPanels}
          onMutate={mutate}
        />
      )}
      {tab === 'planning' && <PlanningWorkspace campaignId={id} onMutate={mutate} />}
      {tab === 'comments' && (
        <CampaignCommentsSection campaignId={id} channels={channels} onMutate={mutate} />
      )}
      {tab === 'activity' && <ChangelogPanel logs={data.recentChangelog} />}

      {/* Always-visible collaborative Discussion thread, below the tabbed content. */}
      <CampaignDiscussionSection campaignId={id} />
    </div>
  );
};
