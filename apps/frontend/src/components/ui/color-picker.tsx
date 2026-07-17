'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// The default heading colour (primary blue). A null value means "default".
export const DEFAULT_POST_COLOR = '#2b5cd3';

const PRESET_COLORS = [
  '#e5484d', // red
  '#f76b15', // orange
  '#f5a623', // amber
  '#30a46c', // green
  '#12a594', // teal
  '#0091ff', // sky
  '#8e4ec6', // purple
  '#e93d82', // pink
  '#7c7f86', // gray
  '#111827', // near-black
];

const Swatch: FC<{
  color: string;
  selected: boolean;
  onClick: () => void;
  label: string;
}> = ({ color, selected, onClick, label }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    style={{ backgroundColor: color }}
    className={clsx(
      'w-[28px] h-[28px] rounded-full flex items-center justify-center transition-transform hover:scale-110 outline-none',
      selected && 'ring-2 ring-offset-2 ring-offset-newBgColorInner ring-[#2B5CD3]'
    )}
  >
    {selected && (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    )}
  </button>
);

// Shared colour picker — a palette of preset swatches (with a "Default" = primary
// blue) plus a custom colour input. `onChange(null)` selects the default.
export const ColorPicker: FC<{
  value?: string | null;
  onChange: (color: string | null) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const normalized = value ? value.toLowerCase() : null;
  const isPreset =
    !!normalized && PRESET_COLORS.map((c) => c.toLowerCase()).includes(normalized);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[8px]">
        <div className="text-[12px] font-[600] uppercase tracking-wide text-newTableText">
          {t('color', 'Color')}
        </div>
        <div className="flex flex-wrap gap-[10px]">
          <Swatch
            color={DEFAULT_POST_COLOR}
            selected={!normalized}
            onClick={() => onChange(null)}
            label={t('default', 'Default')}
          />
          {PRESET_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              selected={normalized === c.toLowerCase()}
              onClick={() => onChange(c)}
              label={c}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-[10px] text-[13px] text-textColor cursor-pointer">
        <span
          className={clsx(
            'w-[28px] h-[28px] rounded-full border border-newTableBorder overflow-hidden flex items-center justify-center',
            normalized && !isPreset && 'ring-2 ring-offset-2 ring-offset-newBgColorInner ring-[#2B5CD3]'
          )}
          style={{ backgroundColor: normalized && !isPreset ? normalized : 'transparent' }}
        >
          <input
            type="color"
            value={normalized || DEFAULT_POST_COLOR}
            onChange={(e) => onChange(e.target.value)}
            className="w-[40px] h-[40px] cursor-pointer opacity-0"
          />
        </span>
        {t('custom_color', 'Custom color')}
      </label>
    </div>
  );
};
