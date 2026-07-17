'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DesignerElement,
  DesignerTextShadow,
  TextRun,
} from '../designer.store';
import {
  ColorSwatch,
  Slider,
  SegmentedControl,
  Stepper,
} from '../controls';
import { DESIGNER_FONTS, ensureFontLoaded } from '../fonts';
import { useBrandColors } from './use-brand-colors';
import { useBrandFonts, useCustomFonts } from './use-brand-fonts';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const RUN_STYLE_KEYS = new Set(['fill', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle']);

const runStylesEqual = (a: Partial<TextRun>, b: Partial<TextRun>): boolean => {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.fill === b.fill &&
    a.underline === b.underline
  );
};

const mergeRuns = (runs: TextRun[]): TextRun[] => {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && runStylesEqual(last, run)) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
};

const applyStyleToRuns = (
  runs: TextRun[],
  start: number,
  end: number,
  style: Partial<TextRun>,
): TextRun[] => {
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(
    runs.reduce((sum, r) => sum + r.text.length, 0),
    end
  );
  if (clampedStart >= clampedEnd) return runs;

  let pos = 0;
  const out: TextRun[] = [];
  for (const run of runs) {
    const len = run.text.length;
    const rStart = pos;
    const rEnd = pos + len;
    if (rEnd <= clampedStart || rStart >= clampedEnd) {
      out.push(run);
    } else {
      const s = Math.max(clampedStart, rStart);
      const e = Math.min(clampedEnd, rEnd);
      if (s > rStart) {
        out.push({ ...run, text: run.text.slice(0, s - rStart) });
      }
      out.push({ ...run, text: run.text.slice(s - rStart, e - rStart), ...style });
      if (e < rEnd) {
        out.push({ ...run, text: run.text.slice(e - rStart) });
      }
    }
    pos += len;
  }
  return mergeRuns(out);
};

type PathMode = 'arc' | 'wave' | 'circle' | 'custom';

const WAVE_PATH_RE =
  /^M 0,\d+(\.\d+)? Q \d+(\.\d+)?,\d+(\.\d+)? \d+(\.\d+)?,\d+(\.\d+)? Q \d+(\.\d+)?,\d+(\.\d+)? \d+(\.\d+)?,\d+(\.\d+)?$/;
const CIRCLE_PATH_RE =
  /^M \d+(\.\d+)?,\d+(\.\d+)? A \d+(\.\d+)?,\d+(\.\d+)? 0 1,1 \d+(\.\d+)?,\d+(\.\d+)?$/;

const detectPathMode = (el: DesignerElement | null): PathMode => {
  if (el?.textPath === undefined) return 'arc';
  if (el.textPath === '') return 'custom';
  if (WAVE_PATH_RE.test(el.textPath)) return 'wave';
  if (CIRCLE_PATH_RE.test(el.textPath)) return 'circle';
  return 'custom';
};

const getSelectionOffsets = (elementId: string): { start: number; end: number } | null => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const editor = document.querySelector(`[data-text-editor-id="${elementId}"]`);
  if (!editor || !editor.contains(range.commonAncestorContainer)) return null;

  const pre = document.createRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  if (start === end) return null;
  return { start, end };
};

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

const CATEGORY_LABELS: Record<string, string> = {
  'sans-serif': 'Sans Serif',
  'serif': 'Serif',
  'display': 'Display',
  'monospace': 'Monospace',
};

interface TextFormatPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
}

const isValidHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

const DEFAULT_SHADOW: DesignerTextShadow = {
  color: '#000000',
  blur: 4,
  offsetX: 2,
  offsetY: 2,
};

export const TextFormatPanel: FC<TextFormatPanelProps> = ({ store }) => {
  const t = useT();
  const selectedIds = store((s) => s.selectedIds);
  const out = store(
    (s) =>
      s.doc.outputs[s.currentOutput] as import('../designer.store').DesignerOutput
  );

  const textElements = useMemo<DesignerElement[]>(() => {
    const children = out?.children ?? [];
    return children.filter(
      (c) => selectedIds.includes(c.id) && c.type === 'text'
    );
  }, [selectedIds, out]);

  const element = textElements[0] ?? null;
  const pathMode = useMemo(() => detectPathMode(element), [element]);

  const brandColors = useBrandColors();
  const brandEnforcement = store((s) => s.brandEnforcement);
  const brandFonts = useBrandFonts();
  const { fonts: customFonts } = useCustomFonts();

  const update = useCallback(
    (updates: Partial<DesignerElement>, commit = true) => {
      if (!textElements.length) return;

      const runUpdate: Partial<TextRun> = {};
      const elUpdate: Partial<DesignerElement> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (RUN_STYLE_KEYS.has(k)) (runUpdate as any)[k] = v;
        else (elUpdate as any)[k] = v;
      }

      const hasRunUpdate = Object.keys(runUpdate).length > 0;
      const selection =
        textElements.length === 1 && element
          ? getSelectionOffsets(element.id)
          : null;

      for (const el of textElements) {
        let merged: Partial<DesignerElement> = { ...elUpdate };
        if (hasRunUpdate) {
          if (el.richText?.length) {
            const offsets =
              selection && textElements.length === 1 ? selection : null;
            const styledRuns = applyStyleToRuns(
              el.richText,
              offsets?.start ?? 0,
              offsets?.end ?? Infinity,
              runUpdate
            );
            merged = { ...merged, richText: styledRuns };
          } else {
            Object.assign(merged, runUpdate);
          }
        }
        store.getState().updateElement(el.id, merged);
      }
      // Continuous controls (sliders) pass commit=false during the drag and push a
      // single history entry on release.
      if (commit) store.getState().pushHistory();
    },
    [store, textElements, element]
  );

  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState('');
  const fontWrapRef = useRef<HTMLDivElement>(null);
  const fontSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fontPickerOpen) {
      fontSearchInputRef.current?.focus();
    }
  }, [fontPickerOpen]);

  const filteredFonts = useMemo(() => {
    const customEntries = customFonts.map(
      (f): typeof DESIGNER_FONTS[number] => ({
        family: f.family,
        label: f.family,
        weights: f.weights,
        category: 'display' as const,
      })
    );
    const all = [...customEntries, ...DESIGNER_FONTS];
    if (!fontSearch.trim()) return all;
    const q = fontSearch.toLowerCase();
    return all.filter(
      (f) =>
        f.family.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [fontSearch, customFonts]);

  const grouped = useMemo(() => {
    const enforceBrand = brandEnforcement && brandFonts.length > 0;
    const order = ['sans-serif', 'serif', 'display', 'monospace'];
    if (enforceBrand) {
      const brandSet = new Set(brandFonts);
      const brandFiltered = filteredFonts.filter((f) => brandSet.has(f.family));
      if (brandFiltered.length === 0) {
        return order
          .map((cat) => ({
            category: cat,
            fonts: filteredFonts.filter((f) => f.category === cat),
          }))
          .filter((g) => g.fonts.length > 0);
      }
      return [{ category: 'sans-serif', fonts: brandFiltered }];
    }
    return order
      .map((cat) => ({
        category: cat,
        fonts: filteredFonts.filter((f) => f.category === cat),
      }))
      .filter((g) => g.fonts.length > 0);
  }, [filteredFonts, brandEnforcement, brandFonts]);

  const currentFont = element?.fontFamily || 'Arial';

  useEffect(() => {
    if (!fontPickerOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (fontWrapRef.current && !fontWrapRef.current.contains(e.target as Node)) {
        setFontPickerOpen(false);
        setFontSearch('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFontPickerOpen(false);
        setFontSearch('');
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [fontPickerOpen]);

  if (!element) {
    return null;
  }

  const fill = element.fill || '#000000';
  const safeColor = isValidHex(fill) ? fill : '#000000';

  const isBold = (element.fontWeight ?? 400) >= 600;
  const isItalic = element.fontStyle === 'italic';
  const styleValue = `${isBold ? 'b' : ''}${isItalic ? 'i' : ''}` || 'n';

  const shadow = element.textShadow;
  const outline = element.textStroke;

  return (
    <div
      className="flex flex-col gap-4"
      role="region"
      aria-label={t('designer_text_formatting', 'Text formatting')}
    >
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_text_format', 'Text Format')}
      </div>

      {/* Font family (C2) — grouped with search */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="text-font-family" className="text-[11px] text-newTextColor/60">{t('designer_label_font_family', 'Font family')}</label>
        <div className="relative" ref={fontWrapRef}>
          <button
            id="text-font-family"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={fontPickerOpen}
            onClick={() => {
              setFontPickerOpen((o) => !o);
              setFontSearch('');
            }}
            className="flex items-center justify-between gap-[8px] w-full h-[34px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-textColor text-[14px] hover:border-designerAccent focus:border-designerAccent transition-colors"
          >
            <span className="truncate" style={{ fontFamily: `"${currentFont}"` }}>
              {currentFont}
            </span>
            <span
              className={`text-[10px] text-textColor/60 transition-transform ${
                fontPickerOpen ? 'rotate-180' : ''
              }`}
            >
              ▾
            </span>
          </button>

          {fontPickerOpen && (
            <div className="absolute z-50 mt-[6px] left-0 w-[280px] rounded-[10px] bg-newBgColorInner border border-studioBorder shadow-menu overflow-hidden">
              <div className="px-[8px] pt-[6px] pb-[2px]">
                <input
                  ref={fontSearchInputRef}
                  type="text"
                  placeholder={t('designer_placeholder_search_fonts', 'Search fonts...')}
                  value={fontSearch}
                  onChange={(e) => setFontSearch(e.target.value)}
                  className="w-full h-[30px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none focus:border-designerAccent placeholder:text-textColor/30"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto p-[4px]">
                {grouped.length === 0 && (
                  <div className="px-[10px] py-[16px] text-[12px] text-textColor/40 text-center">
                    {t('designer_no_fonts_found', 'No fonts found')}
                  </div>
                )}
                {grouped.map((group) => (
                  <div key={group.category} className="mb-[2px]">
                    <div className="px-[10px] py-[4px] text-[10px] font-semibold text-textColor/40 uppercase tracking-wider">
                      {t(`designer_font_category_${group.category.replace(/-/g, '_')}`, CATEGORY_LABELS[group.category] || group.category)}
                    </div>
                    {group.fonts.map((font) => {
                      const active = font.family === currentFont;
                      return (
                        <button
                          key={font.family}
                          type="button"
                          onClick={() => {
                            void ensureFontLoaded(font.family);
                            update({ fontFamily: font.family });
                            setFontPickerOpen(false);
                            setFontSearch('');
                          }}
                          className={`w-full text-left px-[10px] py-[8px] rounded-[6px] text-[15px] transition-colors ${
                            active
                              ? 'bg-designerAccent text-white'
                              : 'text-textColor hover:bg-newBgColor'
                          }`}
                          style={{ fontFamily: `"${font.family}"` }}
                        >
                          {font.family}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bold / Italic (C2) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="text-style" className="text-[11px] text-newTextColor/60">{t('designer_label_style', 'Style')}</label>
        <SegmentedControl
          id="text-style"
          value={styleValue}
          options={[
            { value: 'n', label: t('designer_style_normal', 'Normal') },
            { value: 'b', label: <span className="font-bold">B</span> },
            { value: 'i', label: <span className="italic">I</span> },
            { value: 'bi', label: <span className="font-bold italic">BI</span> },
          ]}
          onChange={(v) => {
            const bold = v.includes('b');
            const italic = v.includes('i');
            update({
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? 'italic' : 'normal',
            });
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="text-font-size" className="text-[11px] text-newTextColor/60">{t('size', 'Size')}</label>
          <input
            id="text-font-size"
            type="number"
            min={1}
            max={999}
            value={element.fontSize || 16}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              if (!Number.isNaN(value) && value > 0) {
                update({ fontSize: value });
              }
            }}
            className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="text-font-weight" className="text-[11px] text-newTextColor/60">{t('designer_label_weight', 'Weight')}</label>
          <select
            id="text-font-weight"
            value={element.fontWeight || 400}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              update({ fontWeight: value });
            }}
            className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
          >
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ColorSwatch
          label={t('color', 'Color')}
          value={safeColor}
          onChange={(hex) => update({ fill: hex })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="text-align" className="text-[11px] text-newTextColor/60">{t('designer_label_align', 'Align')}</label>
        <SegmentedControl
          id="text-align"
          value={element.align || 'left'}
          options={[
            { value: 'left', label: '⇤' },
            { value: 'center', label: '⇔' },
            { value: 'right', label: '⇥' },
          ]}
          onChange={(align) => update({ align: align as 'left' | 'center' | 'right' })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="text-line-height" className="text-[11px] text-newTextColor/60">{t('designer_label_line_height', 'Line height')}</label>
          <input
            id="text-line-height"
            type="number"
            step={0.1}
            min={0.1}
            max={5}
            value={element.lineHeight ?? 1.2}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              if (!Number.isNaN(value) && value > 0) {
                update({ lineHeight: value });
              }
            }}
            className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="text-letter-spacing" className="text-[11px] text-newTextColor/60">
            {t('designer_label_letter_spacing', 'Letter spacing')}
          </label>
          <input
            id="text-letter-spacing"
            type="number"
            step={0.5}
            value={element.letterSpacing ?? 0}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              if (!Number.isNaN(value)) {
                update({ letterSpacing: value });
              }
            }}
            className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
          />
        </div>
      </div>

      {/* Text path (C2) — Arc slider, Wave, Circle presets + custom SVG path */}
      <div className="flex flex-col gap-2">
        <label htmlFor="text-path" className="text-[11px] text-newTextColor/60">{t('designer_label_text_path', 'Text Path')}</label>
        <SegmentedControl
          id="text-path"
          value={pathMode}
          options={[
            { value: 'arc', label: t('designer_path_arc', 'Arc') },
            { value: 'wave', label: t('designer_path_wave', 'Wave') },
            { value: 'circle', label: t('designer_mask_circle', 'Circle') },
            { value: 'custom', label: t('designer_path_custom', 'Custom') },
          ]}
          onChange={(v) => {
            const w = element.width;
            const h = element.height;
            if (v === 'arc') {
              update({ textPath: undefined, curve: element.curve ?? 0 });
            } else if (v === 'wave') {
              const cy = h / 2;
              const amp = Math.max(10, h * 0.15);
              const wavePath = `M 0,${cy} Q ${w / 4},${cy - amp} ${w / 2},${cy} Q ${(w * 3) / 4},${cy + amp} ${w},${cy}`;
              update({ textPath: wavePath, curve: 0 });
            } else if (v === 'circle') {
              const r = Math.min(w, h) * 0.4;
              const top = h * 0.1;
              const circlePath = `M ${w / 2},${top} A ${r},${r} 0 1,1 ${w / 2 - 0.01},${top}`;
              update({ textPath: circlePath, curve: 0 });
            } else {
              update({ textPath: '', curve: 0 });
            }
          }}
        />
        {pathMode === 'custom' && (
          <textarea
            value={element.textPath ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              update({ textPath: value || undefined, curve: 0 });
            }}
            placeholder={t('designer_placeholder_custom_path', 'M 0,50 Q 50,0 100,50 ...')}
            className="w-full h-[80px] px-[8px] py-[6px] rounded-[6px] bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none focus:border-designerAccent resize-none font-mono"
          />
        )}
        {pathMode === 'arc' && (
          <Slider
            label={t('designer_label_arc_angle', 'Arc Angle')}
            min={-90}
            max={90}
            value={element.curve ?? 0}
            onChange={(n) => update({ curve: n }, false)}
            onCommit={() => store.getState().pushHistory()}
          />
        )}
      </div>

      {/* Text effects: drop shadow (C2) */}
      <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_label_drop_shadow', 'Drop shadow')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!shadow}
            onClick={() =>
              update({ textShadow: shadow ? undefined : { ...DEFAULT_SHADOW } })
            }
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              shadow ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                shadow ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>
        {shadow && (
          <div className="flex flex-col gap-3">
            <ColorSwatch
              label={t('designer_label_shadow_color', 'Shadow color')}
              value={isValidHex(shadow.color) ? shadow.color : '#000000'}
              onChange={(hex) =>
                update({ textShadow: { ...shadow, color: hex } })
              }
              brandColors={brandColors}
              brandEnforcement={brandEnforcement}
            />
            <Slider
              label={t('designer_label_blur', 'Blur')}
              min={0}
              max={40}
              value={shadow.blur}
              onChange={(n) => update({ textShadow: { ...shadow, blur: n } }, false)}
              onCommit={() => store.getState().pushHistory()}
            />
            <Slider
              label={t('designer_label_offset_x', 'Offset X')}
              min={-40}
              max={40}
              value={shadow.offsetX}
              onChange={(n) => update({ textShadow: { ...shadow, offsetX: n } }, false)}
              onCommit={() => store.getState().pushHistory()}
            />
            <Slider
              label={t('designer_label_offset_y', 'Offset Y')}
              min={-40}
              max={40}
              value={shadow.offsetY}
              onChange={(n) => update({ textShadow: { ...shadow, offsetY: n } }, false)}
              onCommit={() => store.getState().pushHistory()}
            />
          </div>
        )}
      </div>

      {/* Text effects: outline (C2) */}
      <div className="flex flex-col gap-2 pt-1 border-t border-studioBorder">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_label_outline', 'Outline')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!outline}
            onClick={() =>
              update({
                textStroke: outline ? undefined : { color: '#000000', width: 2 },
              })
            }
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              outline ? 'bg-designerAccent' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                outline ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>
        {outline && (
          <div className="flex flex-col gap-3">
            <ColorSwatch
              label={t('designer_label_outline_color', 'Outline color')}
              value={isValidHex(outline.color) ? outline.color : '#000000'}
              onChange={(hex) =>
                update({ textStroke: { ...outline, color: hex } })
              }
              brandColors={brandColors}
              brandEnforcement={brandEnforcement}
            />
            <Stepper
              label={t('designer_label_width', 'Width')}
              min={0}
              max={20}
              step={1}
              value={outline.width}
              onChange={(n) => update({ textStroke: { ...outline, width: n } })}
            />
          </div>
        )}
      </div>
    </div>
  );
};
