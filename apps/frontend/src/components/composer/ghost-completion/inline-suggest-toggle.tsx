'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { CheckmarkIcon } from '@postmill-ai/frontend/components/ui/icons';
import { useInlineSuggestPref } from './use-inline-suggest-pref';

/**
 * The "Suggest while I type" switch in the composer's AI toolbar menu.
 *
 * Shaped like the other AI menu entries — a single button wrapped in a
 * `relative` div — because `MenuItem`'s `.tb-menu-item` rule stretches that
 * button's clickable box across the whole row.
 */
export const InlineSuggestToggle: FC = () => {
  const t = useT();
  const { enabled, toggle } = useInlineSuggestPref();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        aria-label={t('suggest_while_typing', 'Suggest while I type')}
        className={clsx(
          'cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex px-[8px]',
          enabled ? 'text-btnPrimaryAccent' : 'text-textColor'
        )}
      >
        {enabled ? (
          <CheckmarkIcon />
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
          </svg>
        )}
      </button>
    </div>
  );
};
