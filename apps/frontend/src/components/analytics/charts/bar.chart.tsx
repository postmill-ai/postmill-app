'use client';

import { FC, useEffect, useRef } from 'react';
import DrawChart from 'chart.js/auto';
import { hexToRgba, resolveCSSVar, useCSSToken } from '../kit/chart-theme';

interface BarChartProps {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  format?: 'number' | 'percent';
  horizontal?: boolean;
  onBarClick?: (index: number) => void;
}

export const BarChart: FC<BarChartProps> = ({
  labels,
  values,
  color = 'var(--chart-1, #2b5cd3)',
  height = 250,
  format = 'number',
  horizontal = false,
  onBarClick,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<DrawChart | null>(null);
  const resolvedColor = useCSSToken(color, resolveCSSVar(color));
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
  const onBarClickRef = useRef(onBarClick);
  useEffect(() => {
    onBarClickRef.current = onBarClick;
  }, [onBarClick]);

  useEffect(() => {
    if (!ref.current) return;

    chartRef.current = new DrawChart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: resolvedColor,
            borderColor: resolvedColor,
            borderWidth: 0,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutQuart' },
        layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
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
              maxRotation: 0,
            },
          },
        },
        onClick: (_event: unknown, elements: { index: number }[]) => {
          if (elements.length > 0 && onBarClickRef.current) {
            onBarClickRef.current(elements[0].index);
          }
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
            displayColors: false,
            titleFont: { size: 12, weight: 'normal' },
            bodyFont: { size: 12, weight: 'bold' },
            callbacks: {
              label(context) {
                const value = context.parsed[horizontal ? 'x' : 'y'];
                if (format === 'percent') return value.toFixed(1) + '%';
                return new Intl.NumberFormat().format(Math.round(value));
              },
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [labels, values, color, height, format, horizontal, bgColor, textColor, tableText, gridColor, borderColor, resolvedColor, gridDottedColor]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
};
