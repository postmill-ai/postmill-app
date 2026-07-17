'use client';

import React, { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { HeyGenAvatar } from './use-heygen';

interface AvatarPickerProps {
  avatars: HeyGenAvatar[];
  selectedId?: string;
  onSelect: (avatar: HeyGenAvatar) => void;
}

export const AvatarPicker: FC<AvatarPickerProps> = ({ avatars, selectedId, onSelect }) => {
  const t = useT();
  const modal = useModals();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return avatars;
    return avatars.filter((a) => a.name.toLowerCase().includes(q));
  }, [avatars, query]);

  return (
    <div className="flex flex-col gap-[14px] w-[640px] max-w-full">
      <div className="text-[16px] font-[600] text-textColor">{t('heygen_choose_an_avatar', 'Choose an avatar')}</div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('heygen_search_avatars', 'Search avatars...')}
        className="w-full h-[40px] px-[12px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
      />
      {filtered.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-[13px] text-newTextColor/65">
          {avatars.length === 0
            ? t('heygen_no_avatars_available', 'No avatars available on this account')
            : t('heygen_no_avatars_match_query', 'No avatars match "{{query}}"', { query })}
        </div>
      ) : (
        <div className="grid grid-cols-4 mobile:grid-cols-2 gap-[10px] max-h-[420px] overflow-y-auto pr-[4px]">
          {filtered.map((a) => (
            <button
              key={a.avatarId}
              type="button"
              onClick={() => {
                onSelect(a);
                modal.closeAll();
              }}
              className={`group flex flex-col rounded-[10px] overflow-hidden border-[2px] transition-all text-left ${
                selectedId === a.avatarId ? 'border-[#2B5CD3]' : 'border-transparent hover:border-[#2B5CD3]/40'
              }`}
            >
              <div className="aspect-[3/4] bg-newBgColorInner overflow-hidden">
                {a.previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external provider asset
                  <img src={a.previewImageUrl} alt={a.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-newTextColor/30 text-[24px]">
                    {a.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="px-[8px] py-[6px] bg-newBgColorInner">
                <div className="text-[12px] text-textColor truncate" title={a.name}>{a.name}</div>
                {a.gender && <div className="text-[10px] text-newTextColor/65 capitalize">{a.gender}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
