'use client';

import { FC } from 'react';
import { MetricDetailResponse } from '../utils';
import { AreaChart } from '../charts/area.chart';
import { CHART_PALETTE } from '../kit/palette';
import { Drawer } from '../kit/drawer';
import { ChannelAvatar } from '../kit/channel-avatar';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface MetricDetailPanelProps {
  data?: MetricDetailResponse;
  open: boolean;
  onClose: () => void;
}

export const MetricDetailPanel: FC<MetricDetailPanelProps> = ({ data, open, onClose }) => {
  const t = useT();
  if (!data) return null;

  const isPositive = data.percentageChange >= 0;

  const displayTotal = (() => {
    if (data.format === 'percent') return data.total.toFixed(1) + '%';
    if (data.format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(data.total);
    return new Intl.NumberFormat().format(Math.round(data.total));
  })();

  return (
    <Drawer open={open} onClose={onClose} ariaLabel={data.label}>
        <div className="sticky top-0 bg-newBgColorInner border-b border-newTableBorder px-[20px] py-[14px] flex items-center justify-between z-10">
          <div>
            <h3 className="text-[16px] font-semibold">{data.label}</h3>
            <p className="text-[12px] text-newTableText">{data.metric}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close', 'Close')}
            className="p-[6px] hover:bg-boxHover rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-[20px] space-y-[20px]">
          <div className="flex items-baseline gap-[12px]">
            <div className="text-[40px] font-semibold leading-tight tabular-nums">{displayTotal}</div>
            {data.percentageChange !== 0 && (
              <div className={`flex items-center gap-[4px] text-[14px] font-medium ${isPositive ? 'text-[var(--positive,#32d583)]' : 'text-[var(--negative,#f97066)]'}`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={isPositive ? '' : 'rotate-180'}>
                  <path d="M6 2.5L10 7.5H2L6 2.5Z" fill="currentColor" />
                </svg>
                <span className="tabular-nums">{Math.abs(data.percentageChange).toFixed(1)}{data.format === 'percent' ? 'pp' : '%'}</span>
              </div>
            )}
          </div>

          {data.series.length > 1 && (
            <div className="h-[200px]">
              <AreaChart data={data.series} color={CHART_PALETTE[0]} height={200} format={data.format === 'percent' ? 'percent' : 'number'} />
            </div>
          )}

          {data.byChannel.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">{t('by_channel', 'By Channel')}</h4>
              <div className="space-y-[6px]">
                {data.byChannel.map((ch) => (
                  <div key={ch.integrationId} className="flex items-center gap-[10px] px-[12px] py-[8px] bg-newTableHeader rounded-[8px]">
                    <ChannelAvatar src={ch.picture} name={ch.name} identifier={ch.identifier} size={24} className="rounded-[6px] object-cover" />
                    <span className="flex-1 text-[13px] truncate">{ch.name}</span>
                    <span className="text-[14px] font-semibold tabular-nums">
                      {new Intl.NumberFormat().format(Math.round(ch.value || 0))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.topPosts.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">{t('top_posts', 'Top Posts')}</h4>
              <div className="space-y-[6px]">
                {data.topPosts.slice(0, 5).map((post) => (
                  <div key={post.postId} className="px-[12px] py-[8px] bg-newTableHeader rounded-[8px]">
                    <div className="text-[13px] truncate">{post.content}</div>
                    <div className="text-[11px] text-newTableText mt-[4px]">
                      {post.integration.name} · {new Intl.NumberFormat().format(Math.round(post.metrics[data.metric] || 0))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.movers.up.length > 0 && data.movers.down.length > 0 && (
            <div className="grid grid-cols-2 gap-[12px]">
              <div>
                <h4 className="text-[13px] font-medium text-[var(--positive,#32d583)] mb-[6px]">{t('biggest_movers_up', 'Biggest Movers ↑')}</h4>
                {data.movers.up.slice(0, 3).map((m) => (
                  <div key={m.integrationId} className="text-[12px] py-[4px] flex justify-between">
                    <span className="truncate">{m.name}</span>
                    <span className="tabular-nums font-medium">+{m.change.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-[13px] font-medium text-[var(--negative,#f97066)] mb-[6px]">{t('biggest_movers_down', 'Biggest Movers ↓')}</h4>
                {data.movers.down.slice(0, 3).map((m) => (
                  <div key={m.integrationId} className="text-[12px] py-[4px] flex justify-between">
                    <span className="truncate">{m.name}</span>
                    <span className="tabular-nums font-medium">{m.change.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </Drawer>
  );
};
