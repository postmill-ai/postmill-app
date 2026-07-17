'use client';

import { FC, useEffect, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import { SeriesPoint } from '../utils';
import { hexToRgba, resolveCSSVar, useCSSToken } from '../kit/chart-theme';

/** A campaign shaded band drawn over the overview chart (6.5). */
export interface CampaignBand {
  name: string;
  /** Inclusive YYYY-MM-DD start (clamp to first visible label if earlier). */
  from: string;
  /** Inclusive YYYY-MM-DD end (clamp to last visible label if later). */
  to: string;
  /** Optional hex accent (campaign colour); defaults to the brand accent. */
  color?: string;
}

interface LineChartProps {
  series: SeriesPoint[];
  comparisonSeries?: SeriesPoint[];
  color?: string;
  comparisonColor?: string;
  height?: number;
  format?: 'number' | 'percent' | 'currency' | 'time';
  onPointClick?: (date: string) => void;
  /**
   * Campaign annotations (6.5). Only bands intersecting the visible date range
   * are drawn; passing an empty/undefined array (the toggle-off state) draws
   * none. The tooltip/data are unaffected — this is a pure background layer.
   */
  campaignBands?: CampaignBand[];
}

export const LineChart: FC<LineChartProps> = ({
  series,
  comparisonSeries,
  color = 'var(--chart-1, #2b5cd3)',
  comparisonColor = 'var(--chart-muted, #71767b)',
  height = 300,
  format = 'number',
  onPointClick,
  campaignBands,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<DrawChart | null>(null);
  const resolvedColor = useCSSToken(color, '#2b5cd3');
  const resolvedComparisonColor = useCSSToken(comparisonColor, '#71767b');
  const bgColor = useCSSToken('var(--new-bgColorInner)', '#1a1919');
  const textColor = useCSSToken('var(--new-btn-text)', '#ffffff');
  const tableText = useCSSToken('var(--new-table-text)', '#9c9c9c');
  const borderColor = useCSSToken('var(--new-table-border)', '#2b2b2b');
  const gridColor = useCSSToken('var(--new-bgLineColor)', '#212121');
  const gridDottedColor = (() => {
    const c = resolveCSSVar('var(--new-table-border)', '#2b2b2b');
    return hexToRgba(c, 0.4);
  })();

  // Keep the latest click handler in a ref so the chart doesn't have to be
  // destroyed/recreated whenever the parent passes a new inline callback.
  const onPointClickRef = useRef(onPointClick);
  useEffect(() => {
    onPointClickRef.current = onPointClick;
  }, [onPointClick]);

  useEffect(() => {
    if (!ref.current) return;

    const ctx = ref.current.getContext('2d');
    if (!ctx) return;

    // With a comparison series the chart labels are the sorted union of both
    // series' dates and each series is mapped over that union (null where a
    // date is missing) — index-pairing the raw arrays misaligns whenever the
    // date sets differ (e.g. watchlist own-vs-watched). Chart.js's default
    // `spanGaps: false` breaks the line at nulls instead of bridging them.
    const mainLabels = series.map(p => p.date);
    const labels =
      comparisonSeries && comparisonSeries.length
        ? Array.from(
            new Set([...mainLabels, ...comparisonSeries.map(p => p.date)])
          ).sort()
        : mainLabels;

    const datasets: Record<string, unknown>[] = [];

    if (comparisonSeries && comparisonSeries.length) {
      datasets.push({
        label: 'Previous period',
          data: labels.map(d => comparisonSeries.find(p => p.date === d)?.value ?? null),
          borderColor: resolvedComparisonColor,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: false,
        });
      }

      datasets.push({
        label: 'Current period',
        data:
          comparisonSeries && comparisonSeries.length
            ? labels.map(d => series.find(p => p.date === d)?.value ?? null)
            : series.map(p => p.value),
          borderColor: resolvedColor,
          backgroundColor: (() => {
            if (!ctx) return 'transparent';
            const g = ctx.createLinearGradient(0, 0, 0, height);
            g.addColorStop(0, hexToRgba(resolvedColor, 0.15));
            g.addColorStop(1, hexToRgba(resolvedColor, 0.01));
            return g;
          })(),
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: resolvedColor,
          pointHoverBorderColor: bgColor,
          pointHoverBorderWidth: 2,
          tension: 0.3,
          fill: true,
      });

      // 6.5 — inline plugin drawing shaded x-ranges for campaigns intersecting
      // the visible range. No new npm dep; behind the overview toggle (empty
      // `campaignBands` = off). Labels are YYYY-MM-DD, so lexical compare works.
      const campaignBandPlugin = {
        id: 'campaignBands',
        beforeDatasetsDraw(chart: DrawChart) {
          const bands = campaignBands;
          if (!bands?.length || !labels.length) return;
          const xScale = (chart.scales as any).x;
          const area = chart.chartArea;
          if (!xScale || !area) return;
          const ctx2 = chart.ctx;
          bands.forEach((band) => {
            const startIdx = labels.findIndex((l) => l >= band.from);
            if (startIdx === -1) return; // starts after the visible range
            let endIdx = -1;
            for (let j = labels.length - 1; j >= 0; j--) {
              if (labels[j] <= band.to) {
                endIdx = j;
                break;
              }
            }
            if (endIdx === -1 || startIdx > endIdx) return; // no intersection
            const left = xScale.getPixelForValue(startIdx);
            const right = xScale.getPixelForValue(endIdx);
            const bandColor = band.color || '#2b5cd3';
            ctx2.save();
            ctx2.fillStyle = hexToRgba(bandColor, 0.1);
            ctx2.fillRect(left, area.top, Math.max(right - left, 2), area.bottom - area.top);
            ctx2.fillStyle = hexToRgba(bandColor, 0.9);
            ctx2.font = '10px sans-serif';
            ctx2.textBaseline = 'top';
            ctx2.fillText(band.name, left + 4, area.top + 2);
            ctx2.restore();
          });
        },
      };

      chartRef.current = new DrawChart(ref.current, {
        type: 'line',
        plugins: [campaignBandPlugin],
        data: {
          labels,
          datasets: datasets as any[],
        },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event: unknown, elements: { index: number }[]) => {
          if (elements.length > 0 && onPointClickRef.current) {
            onPointClickRef.current(labels[elements[0].index]);
          }
        },
        animation: { duration: 600, easing: 'easeOutQuart' },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        layout: {
          padding: { top: 8, right: 16, bottom: 4, left: 4 },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: gridDottedColor,
            },
            border: { display: false },
            ticks: {
              color: tableText,
              font: { size: 12 },
              maxTicksLimit: 6,
              callback(value) {
                const v = Number(value);
                if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
                if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
                return v.toLocaleString();
              },
            },
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: tableText,
              font: { size: 12 },
              maxTicksLimit: labels.length > 120 ? 12 : 8,
              maxRotation: 0,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: bgColor,
            titleColor: textColor,
            bodyColor: tableText,
            borderColor,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            boxPadding: 4,
            titleFont: { size: 12, weight: 'normal' },
            bodyFont: { size: 12, weight: 'bold' },
            callbacks: {
              label(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                let formatted: string;
                if (format === 'percent') {
                  formatted = value.toFixed(1) + '%';
                } else if (format === 'currency') {
                  formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);
                } else {
                  formatted = new Intl.NumberFormat().format(Math.round(value));
                }
                return label ? `${label}: ${formatted}` : formatted;
              },
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [series, comparisonSeries, color, comparisonColor, height, format, campaignBands, resolvedColor, resolvedComparisonColor, bgColor, textColor, tableText, gridColor, borderColor, gridDottedColor]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
};
