'use client';

import { FC, KeyboardEvent } from 'react';
import { KPI } from '../utils';
import { useCountUp } from '../hooks/useCountUp';
import { AreaChart } from '../charts/area.chart';
import { ACCENT } from './palette';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// One KPI tile, merging the former `KPICard` (rich: animated value + trend +
// sparkline) and `KpiCard` (plain label/value) into a single component (F4).
//
// - Rich variant: pass `kpi`. Renders the animated total, % change, and a
//   sparkline coloured by `accent`.
// - Plain variant: pass `label` + `value` (+ optional `accent` bar).

interface StatTileProps {
  /** Rich variant — drives the animated value, trend, and sparkline. */
  kpi?: KPI;
  /** Plain-variant label (rich variant reads `kpi.label`). */
  label?: string;
  /** Plain-variant pre-formatted value. */
  value?: string;
  /** Accent colour (a chart-palette token). */
  accent?: string;
  onClick?: () => void;
}

export const StatTile: FC<StatTileProps> = ({ kpi, label, value, accent, onClick }) => {
  if (kpi) {
    return <RichTile kpi={kpi} color={accent ?? `var(--chart-1, ${ACCENT})`} onClick={onClick} />;
  }
  return (
    <div
      className="group relative flex-1 overflow-hidden bg-newBgColorInner border border-newTableBorder rounded-[12px] px-[16px] py-[14px] flex flex-col gap-[6px] transition-all duration-200 hover:border-newTableText"
    >
      {accent && (
        <>
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
            style={{ background: accent }}
          />
          <span
            className="pointer-events-none absolute inset-0 opacity-[0.07] transition-opacity duration-200 group-hover:opacity-[0.12]"
            style={{ background: accent }}
          />
        </>
      )}
      <span className="relative text-[13px] font-medium text-newTableText uppercase tracking-wide">
        {label}
      </span>
      <span className="relative text-[32px] mobile:text-[24px] xs:text-[20px] leading-[40px] mobile:leading-[32px] xs:leading-[28px] font-semibold tracking-tight tabular-nums">
        {value}
      </span>
    </div>
  );
};

const RichTile: FC<{ kpi: KPI; color: string; onClick?: () => void }> = ({
  kpi,
  color,
  onClick,
}) => {
  const t = useT();
  const animatedTotal = useCountUp(kpi.total, 800, true);
  const isPositive = kpi.percentageChange >= 0;

  const displayValue = (() => {
    if (kpi.format === 'percent') return animatedTotal.toFixed(1) + '%';
    if (kpi.format === 'currency')
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
      }).format(Math.round(animatedTotal));
    return new Intl.NumberFormat().format(Math.round(animatedTotal));
  })();

  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': t('view_metric_details', 'View {{label}} details', {
          label: kpi.label,
        }),
        onClick,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  return (
    <div
      {...interactiveProps}
      className={`group bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-hidden transition-all duration-200 hover:border-newTableText flex flex-col ${
        onClick
          ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60'
          : ''
      }`}
    >
      <div className="px-[16px] pt-[14px] pb-[8px] mobile:px-[12px] mobile:pt-[10px] mobile:pb-[4px] flex items-center justify-between gap-[6px]">
        <span className="text-[13px] mobile:text-[11px] font-medium text-newTableText uppercase tracking-wide truncate">
          {kpi.label}
        </span>
        {kpi.percentageChange !== 0 && (
          <div
            className={`flex items-center gap-[4px] text-[13px] mobile:text-[11px] font-medium shrink-0 ${
              isPositive
                ? 'text-[var(--positive,#32d583)]'
                : 'text-[var(--negative,#f97066)]'
            }`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              className={isPositive ? '' : 'rotate-180'}
            >
              <path d="M6 2.5L10 7.5H2L6 2.5Z" fill="currentColor" />
            </svg>
            <span className="tabular-nums">
              {Math.abs(kpi.percentageChange).toFixed(1)}
              {kpi.format === 'percent' ? 'pp' : '%'}
            </span>
          </div>
        )}
      </div>
      <div className="px-[16px] mobile:px-[12px]">
        <div className="text-[32px] leading-[40px] mobile:text-[22px] mobile:leading-[28px] font-semibold tracking-tight tabular-nums truncate">
          {displayValue}
        </div>
      </div>
      {kpi.sparkline.length > 1 && (
        <div className="mt-[8px] mobile:mt-[4px] px-[4px]">
          <div className="h-[48px] mobile:h-[30px]">
            <AreaChart
              data={kpi.sparkline}
              color={color}
              height={48}
              format={kpi.format === 'percent' ? 'percent' : 'number'}
            />
          </div>
        </div>
      )}
      <div className="px-[16px] pb-[14px] mobile:pb-[10px]" />
    </div>
  );
};
