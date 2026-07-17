'use client';

import React, { FC, useMemo, useRef, useState } from 'react';

// Searchable combobox of "<provider>: <region>" options for the channel VPN
// row. Native — no UI library (channels palette: newTableBorder / newBgColorInner).
// Mirrors the studio-kit ModelSelect interaction model.
interface Option {
  value: string;
  label: string;
}

export const ChannelVpnRegionSelect: FC<{
  value?: string;
  options: Option[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}> = ({ value, options, disabled, placeholder, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selectedLabel = options.find((o) => o.value === value)?.label || '';

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmed) return options;
    return options.filter((o) => o.label.toLowerCase().includes(trimmed));
  }, [options, trimmed]);

  const pick = (v: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        disabled={disabled}
        value={open ? query : selectedLabel}
        placeholder={placeholder || 'Search provider: region…'}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-[42px] px-[16px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor placeholder-textColor outline-none disabled:opacity-50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-[20] mt-[4px] w-full max-h-[220px] overflow-y-auto rounded-[8px] border border-newTableBorder bg-newBgColorInner shadow-lg">
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              className={`block w-full text-left px-[16px] py-[8px] text-[14px] hover:bg-boxHover transition-colors ${
                o.value === value ? 'text-textColor bg-boxHover' : 'text-textColor/80'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
