'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DESIGNER_FONTS, ensureFontLoaded } from '../fonts';
import { GOOGLE_FONTS } from '@postmill-ai/nestjs-libraries/media/designer-doc/font-catalog';
import { useBrandFonts, useCustomFonts, useUploadCustomFont, fontServerRenderable } from './use-brand-fonts';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/** Catalog matches shown per search. Enough to choose from, short enough to scan. */
const MAX_FONT_RESULTS = 60;

const CATEGORY_LABELS: Record<string, string> = {
  'sans-serif': 'Sans Serif',
  'serif': 'Serif',
  'display': 'Display',
  'monospace': 'Monospace',
};

export interface FontFamilyPickerProps {
  /** Currently selected family name. */
  value: string;
  /** Fired with the picked family (already ensured loaded by the picker). */
  onPick: (family: string) => void;
  id?: string;
  /**
   * Restrict the list to the org's brand fonts (the store's brandEnforcement
   * toggle) — same rule the image-mode text panel applies.
   */
  brandEnforcement?: boolean;
}

/**
 * The grouped, searchable font-family picker — shared by the image-mode Text
 * Format panel and the video clip inspector (text + caption clips). Org custom
 * fonts are prepended to the recommended shortlist and the upload affordance
 * rides at the bottom of the dropdown.
 */
export const FontFamilyPicker: FC<FontFamilyPickerProps> = ({ value, onPick, id, brandEnforcement = false }) => {
  const t = useT();
  const brandFonts = useBrandFonts();
  const { fonts: customFonts } = useCustomFonts();
  // Same upload round trip as the Brand panel, surfaced here so adding a font
  // doesn't mean leaving the picker for another panel.
  const { uploadMany: uploadCustomFonts, uploading: fontUploading } = useUploadCustomFont();
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  const hasNonServerFont = useMemo(
    () => customFonts.some((f) => !fontServerRenderable(f)),
    [customFonts]
  );

  const handleFontFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      // The picker stays open: the uploaded families land via one final refresh.
      await uploadCustomFonts(files);
      if (fontFileInputRef.current) fontFileInputRef.current.value = '';
    },
    [uploadCustomFonts]
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
    const recommended = [...customEntries, ...DESIGNER_FONTS];
    const q = fontSearch.trim().toLowerCase();

    // Unsearched, the picker shows the recommended shortlist — 1,900 rows is
    // not a menu. Typing searches the whole catalog.
    if (!q) return recommended;

    const seen = new Set(recommended.map((f) => f.family));
    const hits = recommended.filter(
      (f) => f.family.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)
    );

    for (const font of GOOGLE_FONTS) {
      if (hits.length >= MAX_FONT_RESULTS) break;
      if (seen.has(font.family)) continue;
      if (!font.family.toLowerCase().includes(q)) continue;
      hits.push({
        family: font.family,
        label: font.family,
        weights: font.weights,
        // The catalog has a handwriting class the picker's groups do not;
        // it belongs with the other decorative faces.
        category: font.category === 'handwriting' ? 'display' : font.category,
      });
    }
    return hits;
  }, [fontSearch, customFonts]);

  // Preview rows render in their own face, so the stylesheet has to exist
  // before they paint — for the catalog results that is the first time the
  // browser has heard of the family.
  useEffect(() => {
    if (!fontPickerOpen) return;
    for (const font of filteredFonts) {
      void ensureFontLoaded(font.family, [font.weights[0] ?? 400]);
    }
  }, [fontPickerOpen, filteredFonts]);

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

  return (
    <div className="relative" ref={fontWrapRef}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={fontPickerOpen}
        onClick={() => {
          setFontPickerOpen((o) => !o);
          setFontSearch('');
        }}
        className="flex items-center justify-between gap-[8px] w-full h-[34px] px-[10px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-textColor text-[14px] hover:border-designerAccent focus:border-designerAccent transition-colors"
      >
        <span className="truncate" style={{ fontFamily: `"${value}"` }}>
          {value}
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
                  const active = font.family === value;
                  return (
                    <button
                      key={font.family}
                      type="button"
                      onClick={() => {
                        void ensureFontLoaded(font.family);
                        onPick(font.family);
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
          <div className="border-t border-studioBorder p-[4px]">
            <input
              ref={fontFileInputRef}
              type="file"
              multiple
              accept=".ttf,.otf,.woff2"
              onChange={handleFontFileChange}
              className="hidden"
              aria-label={t('designer_upload_font_input', 'Upload font file')}
            />
            <button
              type="button"
              disabled={fontUploading}
              onClick={() => fontFileInputRef.current?.click()}
              className="w-full text-left px-[10px] py-[8px] rounded-[6px] text-[12px] text-textColor/70 hover:bg-newBgColor hover:text-textColor transition-colors disabled:opacity-50"
            >
              {fontUploading
                ? t('designer_uploading_ellipsis', 'Uploading...')
                : t('designer_upload_font_cta_short', '+ Upload font (.ttf, .otf, .woff2)')}
            </button>
            {hasNonServerFont && (
              <div className="px-[10px] pb-[6px] text-[10px] text-amber-400/80">
                {t('designer_woff2_server_render_note', 'WOFF2 fonts are not used in server-rendered exports')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
