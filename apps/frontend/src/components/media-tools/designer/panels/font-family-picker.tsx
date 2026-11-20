'use client';

import React, { FC, useCallback, useMemo, useRef } from 'react';
import { useBrandFonts, useCustomFonts, useUploadCustomFont, fontServerRenderable } from './use-brand-fonts';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { FontCatalogPicker } from './font-catalog-picker';

export interface FontFamilyPickerProps {
  /** Currently selected family name. */
  value: string;
  /** Fired with the picked family (already ensured loaded by the picker). */
  onPick: (family: string) => void;
  id?: string;
  /** Restrict the list to the active brand fonts when enforcement is enabled. */
  brandEnforcement?: boolean;
}

export const FontFamilyPicker: FC<FontFamilyPickerProps> = ({ value, onPick, id, brandEnforcement = false }) => {
  const t = useT();
  const brandFonts = useBrandFonts();
  const { fonts: customFonts } = useCustomFonts();
  const { uploadMany: uploadCustomFonts, uploading: fontUploading } = useUploadCustomFont();
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  const hasNonServerFont = useMemo(
    () => customFonts.some((font) => !fontServerRenderable(font)),
    [customFonts]
  );

  const handleFontFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      await uploadCustomFonts(files);
      if (fontFileInputRef.current) fontFileInputRef.current.value = '';
    },
    [uploadCustomFonts]
  );

  return (
    <FontCatalogPicker
      id={id}
      value={value}
      onPick={onPick}
      customFonts={customFonts}
      filterFamilies={brandEnforcement && brandFonts.length ? brandFonts : undefined}
      footer={(
        <>
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
            className="w-full text-start px-[10px] py-[8px] rounded-[6px] text-[12px] text-textColor/70 hover:bg-newBgColor hover:text-textColor transition-colors disabled:opacity-50"
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
        </>
      )}
    />
  );
};
