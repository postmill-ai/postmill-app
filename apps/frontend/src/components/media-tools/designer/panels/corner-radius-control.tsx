'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { cornerRadii } from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';
import { Stepper } from '../controls';

type Radius = number | [number, number, number, number] | undefined;

const CORNERS = [
  { key: 'tl', labelKey: 'designer_corner_top_left', label: 'Top left' },
  { key: 'tr', labelKey: 'designer_corner_top_right', label: 'Top right' },
  { key: 'br', labelKey: 'designer_corner_bottom_right', label: 'Bottom right' },
  { key: 'bl', labelKey: 'designer_corner_bottom_left', label: 'Bottom left' },
] as const;

export const CornerRadiusControl: FC<{
  value: Radius;
  width: number;
  height: number;
  onChange: (value: number | [number, number, number, number]) => void;
}> = ({ value, width, height, onChange }) => {
  const t = useT();
  const perCorner = Array.isArray(value);
  const corners = cornerRadii(value, width, height);
  const maxRadius = Math.floor(Math.min(width, height) / 2);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textColor/50">
          {t('designer_label_corner_radius', 'Corner radius')}
        </span>
        <button
          type="button"
          aria-pressed={perCorner}
          onClick={() => onChange(perCorner ? corners[0] : [corners[0], corners[0], corners[0], corners[0]])}
          className={`text-[11px] px-2 h-[22px] rounded-md border ${
            perCorner
              ? 'border-designerAccent text-designerAccent'
              : 'border-studioBorder text-textColor/60'
          }`}
        >
          {t('designer_per_corner', 'Per corner')}
        </button>
      </div>
      {perCorner ? (
        <div className="grid grid-cols-2 gap-2">
          {CORNERS.map((corner, index) => (
            <Stepper
              key={corner.key}
              label={t(corner.labelKey, corner.label)}
              min={0}
              max={maxRadius}
              value={corners[index]}
              onChange={(next) => onChange(corners.map((current, i) => i === index ? next : current) as [number, number, number, number])}
            />
          ))}
        </div>
      ) : (
        <Stepper
          label={t('designer_label_corner_radius', 'Corner radius')}
          min={0}
          max={maxRadius}
          value={corners[0]}
          onChange={onChange}
        />
      )}
    </div>
  );
};
