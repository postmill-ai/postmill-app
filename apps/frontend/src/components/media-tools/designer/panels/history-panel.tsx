'use client';

import React, { FC, useEffect, useRef } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * Photoshop's History panel.
 *
 * The store already kept every snapshot for undo/redo; this makes them
 * clickable. Entries after the current one stay visible and greyed, because
 * that is the difference between a history panel and an undo button — you can
 * see what you are about to lose by editing from here.
 */

interface HistoryPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
}

export const HistoryPanel: FC<HistoryPanelProps> = ({ store }) => {
  const t = useT();
  const labels = store((s) => s.historyLabels);
  const index = store((s) => s.historyIndex);
  const savedIndex = store((s) => s.savedHistoryIndex);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = listRef.current?.querySelector('[aria-current="true"]');
    // Guarded: not every environment implements scrollIntoView, and failing to
    // scroll is not worth throwing inside an effect over.
    current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  return (
    <div
      ref={listRef}
      className="flex flex-col max-h-[320px] overflow-y-auto"
      role="listbox"
      aria-label={t('designer_history', 'History')}
    >
      {labels.map((label, i) => (
        <button
          key={`${i}-${label}`}
          type="button"
          role="option"
          aria-selected={i === index}
          aria-current={i === index}
          onClick={() => store.getState().jumpToHistory(i)}
          className={`flex items-center gap-2 px-2 py-1 text-[12px] text-start rounded-md ${
            i === index
              ? 'bg-designerAccent/25 text-textColor'
              : i > index
                ? 'text-textColor/35 hover:bg-studioBorder/20'
                : 'text-textColor/80 hover:bg-studioBorder/25'
          }`}
        >
          <span className="w-4 shrink-0 text-[10px] text-textColor/35">{i + 1}</span>
          <span className="flex-1 truncate">{t(`designer_history_${label}`, label)}</span>
          {i === savedIndex && (
            <span
              className="shrink-0 text-[9px] text-green-500"
              title={t('saved_status', 'Saved')}
            >
              ●
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
