'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { SegmentedControl } from '../controls';

export const TextStyleControl: FC<{
  id?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  onChange: (style: { fontWeight: number; fontStyle: 'normal' | 'italic' }) => void;
}> = ({ id, fontWeight, fontStyle, onChange }) => {
  const t = useT();
  const bold = (fontWeight ?? 400) >= 600;
  const italic = fontStyle === 'italic';
  const value = `${bold ? 'b' : ''}${italic ? 'i' : ''}` || 'n';
  const boldLabel = t('bold', 'Bold');
  const italicLabel = t('italic', 'Italic');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] text-newTextColor/60">
        {t('designer_label_style', 'Style')}
      </label>
      <SegmentedControl
        id={id}
        value={value}
        options={[
          { value: 'n', label: t('designer_style_normal', 'Normal') },
          {
            value: 'b',
            label: <span className="font-bold" aria-label={boldLabel} title={boldLabel}>B</span>,
          },
          {
            value: 'i',
            label: <span className="italic" aria-label={italicLabel} title={italicLabel}>I</span>,
          },
          {
            value: 'bi',
            label: (
              <span className="font-bold italic" aria-label={`${boldLabel} ${italicLabel}`} title={`${boldLabel} ${italicLabel}`}>
                BI
              </span>
            ),
          },
        ]}
        onChange={(next) => onChange({
          fontWeight: next.includes('b') ? 700 : 400,
          fontStyle: next.includes('i') ? 'italic' : 'normal',
        })}
      />
    </div>
  );
};
