'use client';

import React, { FC, useMemo, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { MediaVoice } from './use-media-voices';

const PAGE_SIZE = 50;

interface MediaVoiceSelectProps {
  voices: MediaVoice[];
  value: string;
  onChange: (voiceId: string) => void;
  className: string;
  id?: string;
  ariaLabel?: string;
}

export const MediaVoiceSelect: FC<MediaVoiceSelectProps> = ({
  voices,
  value,
  onChange,
  className,
  id,
  ariaLabel,
}) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const visibleVoices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? voices.filter((voice) => voice.label.toLocaleLowerCase().includes(normalized))
      : voices;
    const page = filtered.slice(0, PAGE_SIZE);
    const selected = voices.find((voice) => voice.id === value);
    return selected && !page.some((voice) => voice.id === selected.id)
      ? [selected, ...page]
      : page;
  }, [query, voices, value]);

  return (
    <div className="flex flex-col gap-2">
      {voices.length > PAGE_SIZE && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('designer_search_voices', 'Search voices…')}
          aria-label={t('designer_search_voices_label', 'Search voices')}
          className={className}
        />
      )}
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      >
        <option value="" disabled>
          {t('designer_choose_a_voice_option', 'Choose a voice…')}
        </option>
        {visibleVoices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.label}
          </option>
        ))}
      </select>
      {voices.length > PAGE_SIZE && (
        <span className="text-[11px] text-newTextColor/50">
          {t('designer_voice_filter_hint', 'Showing {{shown}} of {{total}} voices — type to filter', {
            shown: visibleVoices.length,
            total: voices.length,
          })}
        </span>
      )}
    </div>
  );
};
