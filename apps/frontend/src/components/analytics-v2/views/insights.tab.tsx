'use client';

import { FC, useEffect } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BestTimeTab } from './best-time.tab';
import { RecommendationsTab } from './recommendations.tab';
import { AlertsSection } from './alerts.section';
import { ContentInsightsSection } from './content-insights.section';
import { HealthSection } from './health.section';

interface InsightsTabProps {
  integrations?: string[];
  /** Optional in-page section to scroll to on mount (legacy ?tab=best-time|recommendations). */
  section?: string;
}

// Insights hub (D4 / 2.10): composes the former Best time + Recommendations
// tabs as in-page sections with anchor pills, eliminating the kebab overflow.
// The Alerts section is a marked mount point — the anomaly Alerts surface lands
// in step 4.8 (do NOT invent an alerts API here).
export const InsightsTab: FC<InsightsTabProps> = ({ integrations, section }) => {
  const t = useT();

  const pills = [
    { id: 'best-time', label: t('analytics_tab_best_time', 'Best time') },
    { id: 'recommendations', label: t('analytics_tab_recommendations', 'Recommendations') },
    { id: 'content', label: t('analytics_insights_content', 'What works') },
    { id: 'alerts', label: t('analytics_insights_alerts', 'Alerts') },
    { id: 'health', label: t('analytics_insights_health', 'Channel health') },
  ];

  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`insights-${section}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [section]);

  return (
    <div className="space-y-[24px]">
      <div className="flex flex-wrap gap-[8px]">
        {pills.map((p) => (
          <a
            key={p.id}
            href={`#insights-${p.id}`}
            className="px-[12px] py-[6px] text-[13px] font-medium rounded-full border border-newTableBorder text-newTableText hover:text-textColor hover:border-designerAccent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            {p.label}
          </a>
        ))}
      </div>

      <section id="insights-best-time" className="scroll-mt-[80px]">
        <BestTimeTab integrations={integrations} />
      </section>

      <section id="insights-recommendations" className="scroll-mt-[80px]">
        <h2 className="text-[18px] font-semibold mb-[16px]">
          {t('analytics_tab_recommendations', 'Recommendations')}
        </h2>
        <RecommendationsTab />
      </section>

      {/* Content-attribute intelligence ("what works", 7.4). */}
      <section id="insights-content" className="scroll-mt-[80px]">
        <h2 className="text-[18px] font-semibold mb-[16px]">
          {t('analytics_insights_content', 'What works')}
        </h2>
        <ContentInsightsSection />
      </section>

      {/* Alerts section — the anomaly Alerts surface (step 4.8). */}
      <section id="insights-alerts" className="scroll-mt-[80px]">
        <h2 className="text-[18px] font-semibold mb-[16px]">
          {t('analytics_insights_alerts', 'Alerts')}
        </h2>
        <AlertsSection />
      </section>

      {/* Data-health / trust surface (6.6). */}
      <section id="insights-health" className="scroll-mt-[80px]">
        <h2 className="text-[18px] font-semibold mb-[16px]">
          {t('analytics_insights_health', 'Channel health')}
        </h2>
        <HealthSection />
      </section>
    </div>
  );
};
