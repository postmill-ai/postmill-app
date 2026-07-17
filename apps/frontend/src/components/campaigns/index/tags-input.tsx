'use client';

import { FC, KeyboardEvent, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Small bespoke tag input: type comma-separated text (`tag1, tag2`) and each
// completed token becomes a removable chip. Used by the campaign create/edit
// modal — matches the modal's plain-input styling, no extra npm dependency.
export const TagsInput: FC<{
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
  const t = useT();
  const [draft, setDraft] = useState('');

  const commit = useCallback(
    (raw: string) => {
      const next = [...value];
      for (const part of raw.split(',')) {
        const tag = part.trim();
        if (tag && !next.includes(tag)) next.push(tag);
      }
      onChange(next);
    },
    [value, onChange]
  );

  const onInputChange = useCallback(
    (raw: string) => {
      if (raw.includes(',')) {
        const lastComma = raw.lastIndexOf(',');
        commit(raw.slice(0, lastComma));
        setDraft(raw.slice(lastComma + 1));
      } else {
        setDraft(raw);
      }
    },
    [commit]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (draft.trim()) {
          commit(draft);
          setDraft('');
        }
      } else if (e.key === 'Backspace' && !draft && value.length) {
        onChange(value.slice(0, -1));
      }
    },
    [draft, value, commit, onChange]
  );

  const removeTag = useCallback(
    (idx: number) => onChange(value.filter((_, i) => i !== idx)),
    [value, onChange]
  );

  return (
    <div className="flex flex-wrap items-center gap-[6px] px-[8px] py-[6px] bg-newBgColor border border-newTableBorder rounded-[8px] min-h-[40px]">
      {value.map((tag, idx) => (
        <span
          key={tag}
          className="flex items-center gap-[4px] px-[8px] py-[2px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[12px]"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(idx)}
            className="text-btnPrimary/70 hover:text-btnPrimary"
            aria-label={t('remove_tag_name', 'Remove {{tag}}', { tag })}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            commit(draft);
            setDraft('');
          }
        }}
        className="flex-1 min-w-[80px] bg-transparent text-[14px] outline-none"
        placeholder={value.length ? '' : placeholder}
      />
    </div>
  );
};
