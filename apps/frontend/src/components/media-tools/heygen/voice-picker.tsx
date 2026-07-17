'use client';

import React, { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AudioPlayer } from '@gitroom/frontend/components/media-tools/audio-player';
import { HeyGenVoice } from './use-heygen';

interface VoicePickerProps {
  voices: HeyGenVoice[];
  selectedId?: string;
  onSelect: (voice: HeyGenVoice) => void;
}

export const VoicePicker: FC<VoicePickerProps> = ({ voices, selectedId, onSelect }) => {
  const t = useT();
  const modal = useModals();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.language || '').toLowerCase().includes(q)
    );
  }, [voices, query]);

  return (
    <div className="flex flex-col gap-[14px] w-[560px] max-w-full">
      <div className="text-[16px] font-[600] text-textColor">{t('heygen_choose_a_voice', 'Choose a voice')}</div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('heygen_search_by_name_or_language', 'Search by name or language...')}
        className="w-full h-[40px] px-[12px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
      />
      {filtered.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-[13px] text-newTextColor/65">
          {voices.length === 0
            ? t('heygen_no_voices_available', 'No voices available on this account')
            : t('heygen_no_voices_match_query', 'No voices match "{{query}}"', { query })}
        </div>
      ) : (
        <div className="flex flex-col gap-[8px] max-h-[440px] overflow-y-auto pr-[4px]">
          {filtered.map((v) => (
            <div
              key={v.voiceId}
              className={`flex items-center gap-[12px] p-[10px] rounded-[8px] border transition-all ${
                selectedId === v.voiceId ? 'border-[#2B5CD3] bg-[#2B5CD3]/10' : 'border-studioBorder bg-newBgColorInner'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-textColor truncate">{v.name}</div>
                <div className="text-[11px] text-newTextColor/65 truncate">
                  {[v.language, v.gender].filter(Boolean).join(' · ')}
                  {v.emotionSupport ? t('heygen_emotions_suffix', ' · emotions') : ''}
                </div>
                {v.previewAudio && (
                  <div className="mt-[6px]">
                    <AudioPlayer src={v.previewAudio} lazy height={32} />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelect(v);
                  modal.closeAll();
                }}
                className="shrink-0 px-[14px] py-[8px] rounded-[8px] bg-[#2B5CD3] text-white text-[12px] font-[500] hover:bg-[#2B5CD3]/80 transition-all"
              >
                {selectedId === v.voiceId ? t('heygen_selected', 'Selected') : t('heygen_use', 'Use')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
