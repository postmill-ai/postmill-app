'use client';

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import DrawChart from 'chart.js/auto';
import { resolveCSSVar, useCSSToken } from '../kit/chart-theme';

function resolveChartColors(): string[] {
  return [
    resolveCSSVar('var(--chart-1, #2b5cd3)'),
    resolveCSSVar('var(--chart-2, #32d583)'),
    resolveCSSVar('var(--chart-3, #1d9bf0)'),
    resolveCSSVar('var(--chart-4, #f97066)'),
    resolveCSSVar('var(--chart-5, #ffac30)'),
    resolveCSSVar('var(--chart-6, #8b90ff)'),
    resolveCSSVar('var(--chart-7, #8b90ff)'),
    resolveCSSVar('var(--chart-8, #e4b895)'),
  ];
}

interface PieChartProps {
  data: { label: string; value: number }[];
  height?: number;
  maxSlices?: number;
  centerLabel?: string;
  onSliceClick?: (label: string) => void;
}

export const PieChart: FC<PieChartProps> = ({
  data,
  height = 250,
  maxSlices = 8,
  centerLabel,
  onSliceClick,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<DrawChart | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const bgColor = useCSSToken('var(--new-bgColorInner)', '#1a1919');
  const textColor = useCSSToken('var(--new-btn-text)', '#ffffff');
  const tableText = useCSSToken('var(--new-table-text)', '#9c9c9c');
  const borderColor = useCSSToken('var(--new-table-border)', '#2b2b2b');
  const [chartColors, setChartColors] = useState(resolveChartColors);

  // Keep the latest click handler in a ref — with `processed` memoized the
  // chart effect no longer re-runs every render, so reading the handler at
  // event time keeps it fresh (same pattern as bar.chart).
  const onSliceClickRef = useRef(onSliceClick);
  useEffect(() => {
    onSliceClickRef.current = onSliceClick;
  }, [onSliceClick]);

  useEffect(() => {
    const target = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      setChartColors(resolveChartColors());
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Memoized on the actual data — `processed` is an effect dep, so a fresh
  // array each render would tear down + re-animate the doughnut on every
  // parent render.
  const processed = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    if (sorted.length <= maxSlices) return sorted;
    const top = sorted.slice(0, maxSlices - 1);
    const other = sorted.slice(maxSlices - 1);
    const otherSum = other.reduce((s, i) => s + i.value, 0);
    return [...top, { label: 'Other', value: otherSum }];
  }, [data, maxSlices]);

  useEffect(() => {
    if (!ref.current || !processed.length) return;

    chartRef.current = new DrawChart(ref.current, {
      type: 'doughnut',
      data: {
        labels: processed.map((p) => p.label),
        datasets: [
          {
            data: processed.map((p) => p.value),
            backgroundColor: processed.map(
              (_, i) => chartColors[i % chartColors.length]
            ),
            borderColor: bgColor,
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        animation: { duration: 500, easing: 'easeOutQuart' },
        layout: { padding: 8 },
        onClick: (_event: unknown, elements: { index: number }[]) => {
          if (elements.length > 0 && onSliceClickRef.current) {
            const index = elements[0].index;
            onSliceClickRef.current(processed[index]?.label || '');
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: tableText,
              font: { size: 11 },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: bgColor,
            titleColor: textColor,
            bodyColor: tableText,
            borderColor,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            titleFont: { size: 12, weight: 'normal' },
            bodyFont: { size: 12, weight: 'bold' },
            callbacks: {
              label(context) {
                const total = (context.dataset.data as number[]).reduce(
                  (a, b) => a + b,
                  0
                );
                const value = context.parsed;
                const pct =
                  total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                return `${context.label}: ${new Intl.NumberFormat().format(
                  Math.round(value)
                )} (${pct}%)`;
              },
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [processed, height, bgColor, textColor, tableText, borderColor, chartColors]);

  const total = processed.reduce((s, i) => s + i.value, 0);

  return (
    <div className="relative" style={{ height }}>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} />
      {centerLabel !== undefined && (
        <div
          ref={centerRef}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="text-center">
            <div className="text-[24px] font-semibold leading-tight tabular-nums">
              {new Intl.NumberFormat().format(Math.round(total))}
            </div>
            {centerLabel && (
              <div className="text-[11px] text-newTableText mt-[2px]">
                {centerLabel}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
