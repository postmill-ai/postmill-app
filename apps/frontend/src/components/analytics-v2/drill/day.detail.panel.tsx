'use client';

import { FC } from 'react';
import { DayDetailResponse } from '../utils';
import { Drawer } from '../kit/drawer';
import { ChannelAvatar } from '../kit/channel-avatar';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface DayDetailPanelProps {
  data?: DayDetailResponse;
  open: boolean;
  onClose: () => void;
}

export const DayDetailPanel: FC<DayDetailPanelProps> = ({ data, open, onClose }) => {
  const t = useT();
  if (!data) return null;

  return (
    <Drawer open={open} onClose={onClose} ariaLabel={data.metric}>
        <div className="sticky top-0 bg-newBgColorInner border-b border-newTableBorder px-[20px] py-[14px] flex items-center justify-between z-10">
          <div>
            <h3 className="text-[16px] font-semibold">{data.metric}</h3>
            <p className="text-[12px] text-newTableText">{data.date}</p>
          </div>
          <button onClick={onClose} className="p-[6px] hover:bg-boxHover rounded-[6px] transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-[20px] space-y-[20px]">
          <div className="text-[40px] font-semibold leading-tight tabular-nums">
            {new Intl.NumberFormat().format(Math.round(data.value))}
          </div>

          {data.byChannel.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">{t('by_channel', 'By Channel')}</h4>
              <div className="space-y-[6px]">
                {data.byChannel.map((ch) => (
                  <div key={ch.integrationId} className="flex items-center gap-[10px] px-[12px] py-[8px] bg-newTableHeader rounded-[8px]">
                    <ChannelAvatar src={ch.picture} name={ch.name} identifier={ch.identifier} size={24} className="rounded-[6px] object-cover" />
                    <span className="flex-1 text-[13px] truncate">{ch.name}</span>
                    <span className="text-[14px] font-semibold tabular-nums">
                      {new Intl.NumberFormat().format(Math.round(ch.value))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.posts.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">{t('posts_on_this_day', 'Posts on this day')}</h4>
              <div className="space-y-[6px]">
                {data.posts.map((post) => (
                  <div key={post.postId} className="px-[12px] py-[8px] bg-newTableHeader rounded-[8px]">
                    <div className="text-[13px] truncate">{post.content}</div>
                    <div className="flex items-center gap-[8px] mt-[4px]">
                      <ChannelAvatar src={post.integration.picture} name={post.integration.name} identifier={post.integration.identifier} size={14} className="rounded-[3px] object-cover" />
                      <span className="text-[11px] text-newTableText">{post.integration.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </Drawer>
  );
};
