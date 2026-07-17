'use client';

import { FC, useMemo, useState } from 'react';
import { useBestTime, BestTimeEntry } from '../hooks/useBestTime';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { heatmapColor } from '../kit/palette';
import { TabSkeleton, EmptyState } from '../kit/states';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

interface BestTimeTabProps {
  integrations?: string[];
}

// A cell is low-confidence when the backend says so, or (fallback) when its
// sample is thin — such cells render muted so they don't imply false precision.
function isLowConfidence(entry: BestTimeEntry): boolean {
  if (entry.confidence) return entry.confidence === 'low' || entry.confidence === 'none';
  return entry.postCount < 3;
}

export const BestTimeTab: FC<BestTimeTabProps> = ({ integrations }) => {
  const t = useT();
  const [channel, setChannel] = useState('');
  const { data, isLoading, DAY_LABELS, HOUR_LABELS } = useBestTime(
    integrations,
    channel || undefined
  );

  const { data: integrationsData } = useIntegrationList();
  const channelOptions = useMemo(() => {
    const all = (integrationsData || []) as Integrations[];
    // Restrict the select to the currently active dashboard filter, if any.
    if (integrations?.length) {
      return all.filter((i) => integrations.includes(i.id));
    }
    return all;
  }, [integrationsData, integrations]);

  const totalPosts = useMemo(
    () => (data?.heatmap || []).reduce((sum, e) => sum + (e.postCount || 0), 0),
    [data]
  );

  if (isLoading) {
    return <TabSkeleton variant="chart" />;
  }

  if (!data?.heatmap?.length) {
    return (
      <EmptyState
        title={t('best_time_empty_title', 'No data available yet')}
        description={t(
          'best_time_empty_desc',
          'Publish posts to see best time insights.'
        )}
      />
    );
  }

  const maxAvg = Math.max(...data.heatmap.map((e) => e.avgEngagement), 1);

  return (
    <div className="p-[24px] mobile:p-[16px]">
      <div className="flex items-center justify-between gap-[12px] flex-wrap mb-[8px]">
        <h2 className="text-[18px] font-semibold">
          {t('best_time_to_post', 'Best Time to Post')}
        </h2>
        {channelOptions.length > 1 && (
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-label={t('best_time_channel', 'Channel')}
            className="px-[10px] py-[7px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            <option value="">{t('best_time_all_channels', 'All channels')}</option>
            {channelOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="text-[12px] text-newTableText mb-[16px]">
        {t('best_time_sample', 'Based on {{count}} posts', { count: totalPosts })}
      </p>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-[40px_repeat(24,1fr)] md:grid-cols-[60px_repeat(24,1fr)] gap-[2px] min-w-[560px] md:min-w-[800px]">
          <div className="text-[11px] text-newTableText font-medium" />
          {HOUR_LABELS.map((label) => (
            <div
              key={label.key}
              className="text-[9px] md:text-[10px] text-newTableText text-center font-medium"
            >
              {t(label.key, label.fallback)}
            </div>
          ))}

          {data.heatmap.map((entry) => {
            if (entry.hour === 0) {
              const dayEntries = data.heatmap.filter((e) => e.day === entry.day);
              return (
                <div key={`row-${entry.day}`} className="contents">
                  <div className="text-[10px] md:text-[11px] text-newTableText font-medium flex items-center">
                    {t(
                      DAY_LABELS[entry.day].key,
                      DAY_LABELS[entry.day].fallback,
                    )}
                  </div>
                  {dayEntries.map((de) => {
                    const ratio = maxAvg === 0 ? 0 : de.avgEngagement / maxAvg;
                    const lowConfidence = isLowConfidence(de);
                    return (
                      <div
                        key={`${de.day}-${de.hour}`}
                        className={`h-[20px] md:h-[28px] rounded-[2px] bg-newTableHeader ${
                          lowConfidence ? 'opacity-40' : ''
                        }`}
                        style={ratio > 0 ? { backgroundColor: heatmapColor(ratio) } : undefined}
                        title={t(
                          'heatmap_cell_tooltip',
                          '{{day}} {{hour}}: {{avg}} avg engagement ({{count}} posts)',
                          {
                            day: t(
                              DAY_LABELS[de.day].key,
                              DAY_LABELS[de.day].fallback,
                            ),
                            hour: t(
                              HOUR_LABELS[de.hour].key,
                              HOUR_LABELS[de.hour].fallback,
                            ),
                            avg: de.avgEngagement,
                            count: de.postCount,
                          }
                        )}
                      />
                    );
                  })}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>

      {data.bestSlots?.length > 0 && (
        <div className="mt-[24px]">
          <h3 className="text-[14px] font-medium mb-[8px]">
            {t('top_slots', 'Top Posting Slots')}
          </h3>
          <div className="flex flex-wrap gap-[8px]">
            {data.bestSlots.map((slot) => {
              const low = slot.confidence
                ? slot.confidence === 'low' || slot.confidence === 'none'
                : (slot.postCount ?? 0) < 3;
              return (
                <div
                  key={`${slot.day}-${slot.hour}`}
                  className={`bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[13px] ${
                    low ? 'opacity-60' : ''
                  }`}
                >
                  <span className="font-medium">
                    {t(DAY_LABELS[slot.day].key, DAY_LABELS[slot.day].fallback)}
                  </span>{' '}
                  <span>
                    {t(
                      HOUR_LABELS[slot.hour].key,
                      HOUR_LABELS[slot.hour].fallback,
                    )}
                  </span>
                  <span className="text-newTableText ml-[4px]">
                    {t('slot_avg_engagement', '({{avg}} avg)', {
                      avg: slot.avgEngagement,
                    })}
                  </span>
                  {slot.postCount != null && (
                    <span className="text-newTableText ml-[4px]">
                      {t('best_time_slot_sample', '· {{count}} posts', {
                        count: slot.postCount,
                      })}
                    </span>
                  )}
                  {low && (
                    <span className="text-amber-600 ml-[4px]">
                      {t('best_time_low_confidence', '· low confidence')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
