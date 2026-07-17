'use client';

/**
 * Reusable, native, Tailwind-3-styled control primitives for the Designer.
 *
 * Each is a small CONTROLLED component (value + onChange). They are leaf
 * utilities — no data fetching, no global state. Styling targets a dark editor
 * surface using the project tokens (newBgColorInner, studioBorder, textColor) with
 * the accent `#2B5CD3`.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const ACCENT = '#2B5CD3';

const MAX_RECENTS = 12;

const recentsKey = (orgId?: string | null) =>
  `designer-recent-colors${orgId ? `-${orgId}` : ''}`;

const getRecents = (orgId?: string | null): string[] => {
  try {
    return JSON.parse(localStorage.getItem(recentsKey(orgId)) || '[]');
  } catch {
    return [];
  }
};

const addRecent = (color: string, orgId?: string | null) => {
  const normalized = normalizeHex(color);
  if (!normalized) return;
  const recents = [
    normalized,
    ...getRecents(orgId).filter((c) => c !== normalized),
  ].slice(0, MAX_RECENTS);
  localStorage.setItem(recentsKey(orgId), JSON.stringify(recents));
};

/** Default preset swatches offered in the ColorSwatch popover. */
const PRESET_COLORS: string[] = [
  '#FFFFFF',
  '#000000',
  '#2B5CD3',
  '#1D9BF0',
  '#22C55E',
  '#EAB308',
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#A855F7',
  '#64748B',
  '#0E0E0E',
];

function normalizeHex(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    return v.toUpperCase();
  }
  return null;
}

/** Close a floating element when the user clicks outside it or presses Escape. */
function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ref: React.RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onDismiss, ref]);
}

/* ------------------------------------------------------------------ */
/* ColorSwatch                                                         */
/* ------------------------------------------------------------------ */

export interface ColorSwatchProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  brandColors?: string[];
  brandEnforcement?: boolean;
}

export const ColorSwatch: React.FC<ColorSwatchProps> = ({
  value,
  onChange,
  label,
  brandColors,
  brandEnforcement,
}) => {
  const t = useT();
  const user = useUser();
  const orgId = user?.orgId;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showEyedropper, setShowEyedropper] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false), wrapRef);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    setShowEyedropper('EyeDropper' in window);
  }, []);

  useEffect(() => {
    if (open) setRecents(getRecents(orgId));
  }, [open, orgId]);

  const commitColor = useCallback(
    (hex: string) => {
      const normalized = normalizeHex(hex);
      if (!normalized) return;
      onChange(normalized);
      addRecent(normalized, orgId);
      setRecents(getRecents(orgId));
    },
    [onChange, orgId],
  );

  const commitDraft = useCallback(
    (raw: string) => {
      const hex = normalizeHex(raw);
      if (hex) commitColor(hex);
    },
    [commitColor],
  );

  const handleEyedropper = async () => {
    try {
      // @ts-expect-error - EyeDropper API
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      commitColor(result.sRGBHex);
      setDraft(result.sRGBHex);
    } catch {
      // user cancelled
    }
  };

  const brandHexes = (brandColors || []).filter(
    (c) => normalizeHex(c) !== null,
  );
  const enforce = !!(brandEnforcement && brandHexes.length > 0);

  return (
    <div className="flex flex-col gap-[6px]" ref={wrapRef}>
      {label && (
        <span className="text-[12px] text-textColor/70">{label}</span>
      )}
      <div className="relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-[8px] h-[34px] px-[8px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-textColor text-[13px] hover:border-designerAccent focus:border-designerAccent transition-colors"
        >
          <span
            className="w-[18px] h-[18px] rounded-[4px] border border-studioBorder shrink-0"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono uppercase">{value}</span>
          {enforce && (
            <span className="text-[10px] text-purple-400 ml-1" title={t('brand_colors_enforced', 'Brand colors enforced')}>🔒</span>
          )}
        </button>

        {open && (
          <div
            role="dialog"
            className="absolute z-50 mt-[6px] left-0 w-[208px] p-[10px] rounded-[10px] bg-newBgColorInner border border-studioBorder shadow-menu flex flex-col gap-[10px]"
          >
            {!enforce && (
              <div className="flex items-center gap-[8px]">
                <span
                  className="w-[24px] h-[24px] rounded-[6px] border border-studioBorder shrink-0"
                  style={{ backgroundColor: normalizeHex(draft) ?? value }}
                />
                <input
                  type="text"
                  value={draft}
                  aria-label={t('hex_color', 'Hex color')}
                  spellCheck={false}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitDraft(draft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitDraft(draft);
                      setOpen(false);
                    }
                  }}
                  className="flex-1 min-w-0 h-[30px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-textColor text-[13px] font-mono uppercase focus:border-designerAccent"
                />
                {showEyedropper && (
                  <button
                    type="button"
                    aria-label={t('pick_color_from_screen', 'Pick color from screen')}
                    title={t('pick_color_from_screen', 'Pick color from screen')}
                    onClick={handleEyedropper}
                    className="w-[30px] h-[30px] rounded-[6px] border border-studioBorder bg-newBgColor hover:border-designerAccent flex items-center justify-center shrink-0 transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 10a8 8 0 0 1 12-6.93L20 9l-3.5 3.5L21 17l-1.5 1.5-4-4L12 18l-8-8Z" />
                      <path d="M7 7 2 22" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {enforce && brandHexes.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-purple-400 uppercase tracking-wider">{t('brand_locked', 'Brand (locked)')}</span>
                  <span className="text-[10px]" title={t('brand_colors_enforced', 'Brand colors enforced')}>🔒</span>
                </div>
                <div className="grid grid-cols-6 gap-[6px]">
                  {brandHexes.map((c) => {
                    const active = normalizeHex(value) === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        title={c}
                        onClick={() => {
                          commitColor(c);
                          setDraft(c);
                        }}
                        className="w-[24px] h-[24px] rounded-[6px] border transition-transform hover:scale-110 focus:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: active ? ACCENT : 'var(--studio-border)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {!enforce && brandHexes.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                <span className="text-[10px] text-textColor/40 uppercase tracking-wider">{t('brand_label', 'Brand')}</span>
                <div className="grid grid-cols-6 gap-[6px]">
                  {brandHexes.map((c) => {
                    const active = normalizeHex(value) === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        title={c}
                        onClick={() => {
                          commitColor(c);
                          setDraft(c);
                        }}
                        className="w-[24px] h-[24px] rounded-[6px] border transition-transform hover:scale-110 focus:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: active ? ACCENT : 'var(--studio-border)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {!enforce && recents.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                <span className="text-[10px] text-textColor/40 uppercase tracking-wider">{t('recent', 'Recent')}</span>
                <div className="grid grid-cols-6 gap-[6px]">
                  {recents.map((c) => {
                    const active = normalizeHex(value) === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        title={c}
                        onClick={() => {
                          commitColor(c);
                          setDraft(c);
                        }}
                        className="w-[24px] h-[24px] rounded-[6px] border transition-transform hover:scale-110 focus:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: active ? ACCENT : 'var(--studio-border)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {!enforce && (
              <div className="grid grid-cols-6 gap-[6px]">
                {PRESET_COLORS.map((c) => {
                  const active = normalizeHex(value) === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      title={c}
                      onClick={() => {
                        commitColor(c);
                        setDraft(c);
                      }}
                      className="w-[24px] h-[24px] rounded-[6px] border transition-transform hover:scale-110 focus:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: active ? ACCENT : 'var(--studio-border)',
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Slider                                                              */
/* ------------------------------------------------------------------ */

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  // Fired once when the drag/keyboard interaction ends — used to commit a single
  // history entry for a continuous control instead of one per tick.
  onCommit?: () => void;
  label?: string;
  suffix?: string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  label,
  suffix,
}) => {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="flex flex-col gap-[6px]">
      {(label || suffix !== undefined) && (
        <div className="flex items-center justify-between text-[12px] text-textColor/70">
          {label && <label htmlFor={id}>{label}</label>}
          <span className="font-mono text-textColor">
            {value}
            {suffix ?? ''}
          </span>
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="designer-slider w-full h-[4px] appearance-none rounded-full cursor-pointer focus:outline-none"
        style={{
          background: `linear-gradient(90deg, ${ACCENT} 0%, ${ACCENT} ${pct}%, var(--studio-border) ${pct}%, var(--studio-border) 100%)`,
        }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* SegmentedControl                                                    */
/* ------------------------------------------------------------------ */

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
}

export interface SegmentedControlProps {
  value: string;
  options: SegmentedOption[];
  onChange: (v: string) => void;
  id?: string;
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  value,
  options,
  onChange,
  id,
}) => {
  const move = (dir: 1 | -1) => {
    const idx = options.findIndex((o) => o.value === value);
    const next = (idx + dir + options.length) % options.length;
    onChange(options[next].value);
  };

  return (
    <div
      id={id}
      role="radiogroup"
      className="inline-flex p-[3px] rounded-[8px] bg-newBgColor border border-studioBorder gap-[3px]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              }
            }}
            className={`min-w-[34px] px-[10px] h-[28px] rounded-[6px] text-[13px] flex items-center justify-center transition-colors ${
              active
                ? 'bg-designerAccent text-white'
                : 'text-textColor/70 hover:text-textColor hover:bg-newBgColorInner'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

export interface StepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export const Stepper: React.FC<StepperProps> = ({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  label,
}) => {
  const t = useT();
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const bump = (dir: 1 | -1) => onChange(clamp(value + dir * step));

  return (
    <div className="flex flex-col gap-[6px]">
      {label && (
        <label htmlFor={id} className="text-[12px] text-textColor/70">
          {label}
        </label>
      )}
      <div className="inline-flex items-center h-[34px] rounded-[8px] bg-newBgColorInner border border-studioBorder overflow-hidden">
        <button
          type="button"
          aria-label={t('decrease', 'Decrease')}
          disabled={value <= min}
          onClick={() => bump(-1)}
          className="w-[32px] h-full flex items-center justify-center text-textColor text-[16px] hover:bg-newBgColor disabled:opacity-40 disabled:cursor-not-allowed"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          value={value}
          min={min === -Infinity ? undefined : min}
          max={max === Infinity ? undefined : max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          className="w-[56px] h-full text-center bg-transparent text-textColor text-[13px] font-mono border-x border-studioBorder focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={t('increase', 'Increase')}
          disabled={value >= max}
          onClick={() => bump(1)}
          className="w-[32px] h-full flex items-center justify-center text-textColor text-[16px] hover:bg-newBgColor disabled:opacity-40 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* FontPicker                                                          */
/* ------------------------------------------------------------------ */

export interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
  fonts: string[];
}

export const FontPicker: React.FC<FontPickerProps> = ({
  value,
  onChange,
  fonts,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false), wrapRef);

  const select = (family: string) => {
    onChange(family);
    setOpen(false);
  };

  const move = (dir: 1 | -1) => {
    const idx = fonts.indexOf(value);
    const next = (idx + dir + fonts.length) % fonts.length;
    onChange(fonts[next]);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            move(e.key === 'ArrowDown' ? 1 : -1);
          }
        }}
        className="flex items-center justify-between gap-[8px] w-full h-[34px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-textColor text-[14px] hover:border-designerAccent focus:border-designerAccent transition-colors"
      >
        <span className="truncate" style={{ fontFamily: `"${value}"` }}>
          {value}
        </span>
        <span
          className={`text-[10px] text-textColor/60 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('font_family', 'Font family')}
          className="absolute z-50 mt-[6px] left-0 w-full max-h-[260px] overflow-y-auto p-[4px] rounded-[10px] bg-newBgColorInner border border-studioBorder shadow-menu"
        >
          {fonts.map((family) => {
            const active = family === value;
            return (
              <li key={family} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => select(family)}
                  className={`w-full text-left px-[10px] py-[8px] rounded-[6px] text-[15px] transition-colors ${
                    active
                      ? 'bg-designerAccent text-white'
                      : 'text-textColor hover:bg-newBgColor'
                  }`}
                  style={{ fontFamily: `"${family}"` }}
                >
                  {family}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
