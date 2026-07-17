'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { pushAgentUiContext } from '@gitroom/frontend/components/agent/agent-context-bridge';
import Link from 'next/link';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCampaignDashboard } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { DashboardHeader } from '@gitroom/frontend/components/campaigns/dashboard/dashboard-header';
import { DashboardKpis } from '@gitroom/frontend/components/campaigns/dashboard/dashboard-kpis';
import { CampaignAnalyticsSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-analytics-section';
import { TaggedItemsPanels } from '@gitroom/frontend/components/campaigns/dashboard/tagged-items-panels';
import { CampaignChannelsSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-channels-section';
import { CampaignFilesSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-files-section';
import { CampaignTemplatesSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-templates-section';
import { CampaignDraftsSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-drafts-section';
import { CampaignPostsSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-posts-section';
import { PlanningWorkspace } from '@gitroom/frontend/components/campaigns/dashboard/planning-workspace';
import { ChangelogPanel } from '@gitroom/frontend/components/campaigns/dashboard/changelog-panel';
import { CampaignCommentsSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-comments-section';
import { CampaignDiscussionSection } from '@gitroom/frontend/components/campaigns/dashboard/campaign-discussion-section';
import { ChannelOption } from '@gitroom/frontend/components/comments/comment.inbox.filters';
import { KebabMenu } from '@gitroom/frontend/components/ui/kebab-menu';

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
  // On mobile only the first three are shown inline; the rest fold into a menu.
  const primaryTabs = tabs.slice(0, 3);
  const overflowTabs = tabs.slice(3);
  const overflowActive = overflowTabs.some((o) => o.key === tab);

  const renderTab = (item: { key: TabKey; label: string }, extra = '') => (
    <button
      key={item.key}
      type="button"
      onClick={() => setTab(item.key)}
      aria-current={tab === item.key ? 'page' : undefined}
      className={clsx(
        'px-[16px] py-[10px] text-[14px] font-[500] whitespace-nowrap border-b-2 -mb-[1px] transition-colors',
        extra,
        tab === item.key
          ? 'border-btnPrimary text-textColor'
          : 'border-transparent text-newTableText hover:text-textColor'
      )}
    >
      {item.label}
    </button>
  );

  return (
    <div className="w-full flex flex-col gap-[24px] p-[24px]">
      <DashboardHeader campaign={data.campaign} onMutate={mutate} />
      <DashboardKpis dashboard={data} />
      <CampaignAnalyticsSection
        campaignId={id}
        startDate={data.campaign?.startDate}
        endDate={data.campaign?.endDate}
      />

      {/* Section tabs — first 3 inline; the rest fold into a kebab on mobile, inline on desktop.
          The kebab lives OUTSIDE the horizontally-scrolling track so its menu isn't clipped. */}
      <div className="flex items-stretch border-b border-newTableBorder">
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex items-center gap-[2px] min-w-max">
            {primaryTabs.map((item) => renderTab(item))}
            {overflowTabs.map((item) => renderTab(item, 'hidden lg:block'))}
          </div>
        </div>
        <div className="lg:hidden flex items-center shrink-0 ps-[8px]">
          <KebabMenu
            ariaLabel={t('more_sections', 'More sections')}
            active={overflowActive}
            align="right"
            items={overflowTabs.map((item) => ({
              label:
                tab === item.key ? (
                  <span className="text-btnPrimary">{item.label}</span>
                ) : (
                  item.label
                ),
              onClick: () => setTab(item.key),
            }))}
          />
        </div>
      </div>

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
