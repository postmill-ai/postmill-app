'use client';

import { FC } from 'react';
import { SeriesPoint } from './utils';
import { LineChart } from './charts/line.chart';
import { CHART_PALETTE } from './kit/palette';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PostDetailChartProps {
  series: Record<string, SeriesPoint[]>;
}

export const PostDetailChart: FC<PostDetailChartProps> = ({ series }) => {
  const t = useT();
  const entries = Object.entries(series).filter(
    ([, points]) => points.length > 0
  );

  if (entries.length === 0) return null;

  return (
    <div>
      <h4 className="text-[13px] font-medium text-newTableText mb-[12px]">
        {t('metric_trends', 'Metric Trends')}
      </h4>
      <div className="space-y-[16px]">
        {entries.map(([metric, points], i) => (
          <div
            key={metric}
            className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[12px]"
          >
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] font-medium text-newTableText capitalize">
                {metric.replace(/_/g, ' ')}
              </span>
              <span className="text-[14px] font-semibold tabular-nums">
                {new Intl.NumberFormat().format(
                  Math.round(points[points.length - 1]?.value || 0)
                )}
              </span>
            </div>
            <div className="h-[120px]">
              <LineChart
                series={points}
                color={CHART_PALETTE[i % CHART_PALETTE.length]}
                height={120}
                format="number"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
