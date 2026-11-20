'use client';

import React, { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { DESIGNER_FONTS, ensureFontLoaded } from '../fonts';
import { GOOGLE_FONTS } from '@postmill-ai/nestjs-libraries/media/designer-doc/font-catalog';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { CustomFontEntry } from './use-brand-fonts';

const MAX_FONT_RESULTS = 60;

const CATEGORY_LABELS: Record<string, string> = {
  'sans-serif': 'Sans Serif',
  'serif': 'Serif',
  'display': 'Display',
  'monospace': 'Monospace',
};

export interface FontCatalogPickerProps {
  value: string;
  onPick: (family: string) => void;
  id?: string;
  customFonts?: CustomFontEntry[];
  filterFamilies?: string[];
  selectedFamilies?: string[];
  placeholder?: string;
  footer?: ReactNode;
}

export const FontCatalogPicker: FC<FontCatalogPickerProps> = ({
  value,
  onPick,
  id,
  customFonts = [],
  filterFamilies,
  selectedFamilies = [],
  placeholder,
  footer,
}) => {
  const t = useT();
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState('');
  const fontWrapRef = useRef<HTMLDivElement>(null);
  const fontSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fontPickerOpen) fontSearchInputRef.current?.focus();
  }, [fontPickerOpen]);

  const filteredFonts = useMemo(() => {
    const customEntries = customFonts.map(
      (font): typeof DESIGNER_FONTS[number] => ({
        family: font.family,
        label: font.family,
        weights: font.weights,
        category: 'display' as const,
      })
    );
    const recommended = [...customEntries, ...DESIGNER_FONTS];
    const query = fontSearch.trim().toLowerCase();
    if (!query) return recommended;

    const seen = new Set(recommended.map((font) => font.family));
    const hits = recommended.filter(
      (font) => font.family.toLowerCase().includes(query) || font.category.toLowerCase().includes(query)
    );
    for (const font of GOOGLE_FONTS) {
      if (hits.length >= MAX_FONT_RESULTS) break;
      if (seen.has(font.family)) continue;
      if (!font.family.toLowerCase().includes(query)) continue;
      hits.push({
        family: font.family,
        label: font.family,
        weights: font.weights,
        category: font.category === 'handwriting' ? 'display' : font.category,
      });
    }
    return hits;
  }, [fontSearch, customFonts]);

  useEffect(() => {
    if (!fontPickerOpen) return;
    for (const font of filteredFonts) {
      void ensureFontLoaded(font.family, [font.weights[0] ?? 400]);
    }
  }, [fontPickerOpen, filteredFonts]);

  const grouped = useMemo(() => {
    const order = ['sans-serif', 'serif', 'display', 'monospace'];
    if (filterFamilies?.length) {
      const allowed = new Set(filterFamilies);
      const matches = filteredFonts.filter((font) => allowed.has(font.family));
      if (matches.length) return [{ category: 'sans-serif', fonts: matches }];
    }
    return order
      .map((category) => ({
        category,
        fonts: filteredFonts.filter((font) => font.category === category),
      }))
      .filter((group) => group.fonts.length > 0);
  }, [filteredFonts, filterFamilies]);

  useEffect(() => {
    if (!fontPickerOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (fontWrapRef.current && !fontWrapRef.current.contains(event.target as Node)) {
        setFontPickerOpen(false);
        setFontSearch('');
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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

  const selected = new Set([value, ...selectedFamilies]);

  return (
    <div className="relative" ref={fontWrapRef}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={fontPickerOpen}
        aria-label={value || placeholder}
        onClick={() => {
          setFontPickerOpen((open) => !open);
          setFontSearch('');
        }}
        className="flex items-center justify-between gap-[8px] w-full h-[34px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-textColor text-[14px] hover:border-designerAccent focus:border-designerAccent transition-colors"
      >
        <span className="truncate" style={{ fontFamily: value ? `"${value}"` : undefined }}>
          {value || placeholder}
        </span>
        <span aria-hidden="true" className={`text-[10px] text-textColor/60 transition-transform ${fontPickerOpen ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {fontPickerOpen && (
        <div className="absolute z-50 mt-[6px] start-0 w-[280px] rounded-[10px] bg-newBgColorInner border border-studioBorder shadow-menu overflow-hidden">
          <div className="px-[8px] pt-[6px] pb-[2px]">
            <input
              ref={fontSearchInputRef}
              type="text"
              placeholder={t('designer_placeholder_search_fonts', 'Search fonts...')}
              value={fontSearch}
              onChange={(event) => setFontSearch(event.target.value)}
              className="w-full h-[30px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden focus:border-designerAccent placeholder:text-textColor/30"
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
                  const active = selected.has(font.family);
                  return (
                    <button
                      key={font.family}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        void ensureFontLoaded(font.family);
                        onPick(font.family);
                        setFontPickerOpen(false);
                        setFontSearch('');
                      }}
                      className={`w-full text-start px-[10px] py-[8px] rounded-[6px] text-[15px] transition-colors ${
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
          {footer && <div className="border-t border-studioBorder p-[4px]">{footer}</div>}
        </div>
      )}
    </div>
  );
};
