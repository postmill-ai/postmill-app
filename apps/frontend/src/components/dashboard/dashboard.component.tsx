'use client';

import React, { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useOverview } from '@gitroom/frontend/components/analytics-v2/hooks/useOverview';
import { useDashboardSummary } from './hooks/useDashboardSummary';
import { LineChart } from '@gitroom/frontend/components/analytics-v2/charts/line.chart';
import { EmptyState } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { DashboardSetup } from './dashboard.setup';
import { SectionCard } from './kit/section-card';
import { DashboardHeader } from './dashboard.header';
import { DashboardSectionMeta } from './customize.popover';
import { greetingForUser } from './dashboard.utils';
import { KpiStrip } from './widgets/kpi.strip';
import { ScheduleTimeline } from './widgets/schedule.timeline';
import { CampaignsWidget } from './widgets/campaigns.widget';
import { InboxWidget } from './widgets/inbox.widget';
import { MediaQueueWidget } from './widgets/media.queue';
import { UsageWidget } from './widgets/usage.widget';
import { RecommendationsStrip } from './widgets/recommendations.strip';
import { AttentionFeed } from './widgets/attention.feed';
import { useAiActive } from '@gitroom/frontend/components/layout/use-ai-active';
import { DailyBrief } from './widgets/daily.brief';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export { greetingForUser };

export const DashboardComponent = () => {
  const [briefOpen, setBriefOpen] = useState(false);
  const aiActive = useAiActive();
  const t = useT();
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: integrations } = useIntegrationList();

  const DASHBOARD_SECTIONS: DashboardSectionMeta[] = useMemo(
    () => [
      { id: 'setup', label: t('setup_checklist_label', 'Setup checklist') },
      { id: 'attention', label: t('needs_attention', 'Needs attention') },
      {
        id: 'kpi',
        label: t('kpi_at_a_glance', 'At a glance'),
        permission: ['analytics', 'read'],
      },
      {
        id: 'trend',
        label: t('trend_label', 'Engagement trend'),
        permission: ['analytics', 'read'],
      },
      {
        id: 'schedule',
        label: t('next_7_days', 'Next 7 days'),
        permission: ['posts', 'read'],
      },
      {
        id: 'campaigns',
        label: t('active_campaigns', 'Active campaigns'),
        permission: ['posts', 'read'],
      },
      { id: 'inbox', label: t('inbox', 'Inbox'), permission: ['comments', 'read'] },
      {
        id: 'media',
        label: t('media_queue', 'Media queue'),
        permission: ['media', 'read'],
      },
      {
        id: 'usage',
        label: t('usage_budget', 'Usage & budget'),
        permission: ['billing', 'read'],
      },
      {
        id: 'recommendations',
        label: t('recommendations_label', 'Recommendations'),
        permission: ['posts', 'read'],
      },
      {
        id: 'brief',
        label: t('daily_brief_section_label', 'Daily brief'),
        permission: ['analytics', 'read'],
      },
    ],
    [t]
  );

  const activeIntegrationIds = useMemo(
    () => (integrations ?? []).map((i: { id: string }) => i.id),
    [integrations]
  );

  const from = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
  const to = dayjs().format('YYYY-MM-DD');

  const { data: overviewData, isLoading: overviewLoading } = useOverview({
    from,
    to,
    integrations: activeIntegrationIds,
    compare: false,
  });

  const mainKPI = overviewData?.kpis?.[0];
  const series = useMemo(() => {
    if (!overviewData?.series || !mainKPI) return [];
    const points = overviewData.series[mainKPI.metric] || [];
    return points.map((p) => ({ ...p, date: dayjs(p.date).format(t('chart_date_format', 'M/DD')) }));
  }, [overviewData, mainKPI, t]);

  const hasOverview = !!overviewData && series.length > 0;

  return (
    <div className="p-[16px] mobile:p-[24px] overflow-x-hidden">
      <DashboardHeader
        sections={DASHBOARD_SECTIONS}
        showBriefButton={aiActive === true}
        onBriefClick={() => setBriefOpen((o) => !o)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[12px]">
        <div className="lg:col-span-12 order-first lg:order-1">
          <DailyBrief open={briefOpen} />
        </div>

        <div className="lg:col-span-12 order-first lg:order-1">
          <DashboardSetup />
        </div>

        <div className="lg:col-span-12 order-1 lg:order-2">
          <SectionCard id="attention" title={t('needs_attention', 'Needs attention')}>
            <AttentionFeed />
          </SectionCard>
        </div>

        <div className="lg:col-span-12 order-2 lg:order-5">
          <SectionCard
            id="schedule"
            title={t('next_7_days', 'Next 7 days')}
            viewAllHref="/posts"
            permission={['posts', 'read']}
          >
            {summaryLoading ? (
              <div className="animate-pulse h-[40px] bg-newTableHeader rounded-[4px]" />
            ) : (
              <ScheduleTimeline upcomingPosts={summary?.upcomingPosts ?? []} />
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-4 order-3 lg:order-3">
          <SectionCard
            id="kpi"
            title={t('kpi_at_a_glance', 'At a glance')}
            viewAllHref="/analytics"
            permission={['analytics', 'read']}
          >
            <KpiStrip
              from={from}
              to={to}
              integrationIds={activeIntegrationIds}
            />
          </SectionCard>
        </div>

        <div className="lg:col-span-8 order-4 lg:order-4">
          <SectionCard
            id="trend"
            title={t('trend_title', '7-day engagement')}
            viewAllHref="/analytics"
            permission={['analytics', 'read']}
          >
            {overviewLoading ? (
              <div className="h-[240px] bg-newTableHeader rounded-[12px] animate-pulse" />
            ) : hasOverview ? (
              <div className="h-[240px] relative w-full min-w-0">
                <LineChart series={series} height={240} format={mainKPI?.format} />
              </div>
            ) : (
              <EmptyState
                title={t('no_trend_data_title', 'No trend data yet')}
                description={t(
                  'no_trend_data_description',
                  'Publish posts and connect channels to see engagement over time.'
                )}
              />
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-6 order-6 lg:order-6">
          <SectionCard
            id="campaigns"
            title={t('active_campaigns', 'Active campaigns')}
            viewAllHref="/campaigns"
            permission={['posts', 'read']}
          >
            <CampaignsWidget />
          </SectionCard>
        </div>

        <div className="lg:col-span-6 order-5 lg:order-6">
          <SectionCard
            id="inbox"
            title={t('inbox', 'Inbox')}
            viewAllHref="/replies"
            permission={['comments', 'read']}
          >
            <InboxWidget />
          </SectionCard>
        </div>

        <div className="lg:col-span-6 order-7 lg:order-7">
          <SectionCard
            id="media"
            title={t('media_queue', 'Media queue')}
            viewAllHref="/media"
            permission={['media', 'read']}
          >
            <MediaQueueWidget />
          </SectionCard>
        </div>

        <div className="lg:col-span-6 order-8 lg:order-7">
          <SectionCard
            id="usage"
            title={t('usage_budget', 'Usage & budget')}
            viewAllHref="/billing"
            permission={['billing', 'read']}
          >
            <UsageWidget />
          </SectionCard>
        </div>

        <div className="lg:col-span-12 order-9 lg:order-8">
          <SectionCard
            id="recommendations"
            title={t('recommendations_label', 'Recommendations')}
            viewAllHref="/analytics?tab=insights"
            permission={['posts', 'read']}
          >
            <RecommendationsStrip />
          </SectionCard>
        </div>
      </div>
    </div>
  );
};
