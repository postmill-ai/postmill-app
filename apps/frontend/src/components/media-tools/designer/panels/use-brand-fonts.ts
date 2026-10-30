'use client';

import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useCallback, useEffect, useState } from 'react';

export interface CustomFontEntry {
  family: string;
  fileId: string;
  path: string;
  weights: number[];
  italic?: boolean;
  /**
   * False for WOFF2 uploads: the browser renders them, but node-canvas and the
   * outline parser do not, so server-rendered exports fall back to another
   * face. Absent on entries stored before the flag existed — those fall back
   * to a path-extension check in `fontServerRenderable`.
   */
  serverRender?: boolean;
}

/** Whether a custom font can be used by server-side renderers (TTF/OTF only). */
export const fontServerRenderable = (font: CustomFontEntry): boolean =>
  font.serverRender ?? !/\.woff2(\?|#|$)/i.test(font.path || '');

export const useBrandFonts = () => {
  const user = useUser();
  const fetch = useFetch();
  const { data } = useSWR(
    user?.orgId ? `brands-list-${user.orgId}-fonts` : null,
    async () => {
      const res = await fetch('/brands');
      if (!res.ok) return [];
      const brands = await res.json();
      const fonts: string[] = [];
      brands.forEach((b: any) => {
        if (Array.isArray(b.fontFamilies)) {
          b.fontFamilies.forEach((f: string) => fonts.push(f));
        }
        if (b.fontFamily) fonts.push(b.fontFamily);
        if (b.headingFont) fonts.push(b.headingFont);
      });
      return [...new Set(fonts)];
    }
  );
  return data || [];
};

export const useCustomFonts = (): {
  fonts: CustomFontEntry[];
  mutate: () => void;
} => {
  const user = useUser();
  const fetch = useFetch();
  const { data, mutate } = useSWR<CustomFontEntry[]>(
    user?.orgId ? `custom-fonts-${user.orgId}` : null,
    async () => {
      const res = await fetch('/media/fonts');
      if (!res.ok) return [];
      return res.json();
    }
  );

  const fonts = data || [];

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    for (const f of fonts) {
      const style = f.italic ? 'italic' : 'normal';
      // One FontFace per weight — a joined list ('400, 700') is not a valid
      // weight descriptor, so the face never loaded and the family-keyed
      // dedupe could never match it.
      for (const w of f.weights.length ? f.weights : [400]) {
        const weight = String(w);
        try {
          // A face is identified by family + weight + style: keyed by family
          // ALONE, the second weight of a family was skipped — upload Inter
          // Regular then Inter Bold and Bold never loaded.
          const existing = Array.from((document.fonts as any).values()).find(
            (ff: any) => ff.family === f.family && ff.weight === weight && ff.style === style
          );
          if (existing) continue;
          const fontFace = new FontFace(f.family, `url(${f.path})`, {
            weight,
            style,
          });
          fontFace.load().then((loaded) => {
            (document.fonts as any).add(loaded);
          }).catch((err) => {
            console.warn(`[designer] Failed to load font ${f.family} ${weight} ${style}`, err);
          });
        } catch (err) {
          console.warn(`[designer] Failed to register font ${f.family} ${weight} ${style}`, err);
        }
      }
    }
  }, [fonts]);

  return { fonts, mutate: () => mutate() };
};

export interface CustomFontUploadResult {
  file: File;
  success: boolean;
  error?: string;
  serverRender?: boolean;
}

/**
 * Sequential uploads avoid concurrent read/modify/write updates to the brand's
 * customFonts JSON. A batch has one pending state and one final cache refresh.
 */
export const useUploadCustomFont = (): {
  upload: (file: File) => Promise<boolean>;
  uploadMany: (files: File[]) => Promise<CustomFontUploadResult[]>;
  uploading: boolean;
} => {
  const user = useUser();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { mutate } = useSWRConfig();
  const [uploading, setUploading] = useState(false);

  const uploadMany = useCallback(
    async (files: File[]): Promise<CustomFontUploadResult[]> => {
      if (!files.length) return [];
      setUploading(true);
      const results: CustomFontUploadResult[] = [];
      try {
        for (const file of files) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (!ext || !['ttf', 'otf', 'woff2'].includes(ext)) {
            results.push({
              file,
              success: false,
              error: t('designer_invalid_font_file_type', 'Invalid file type. Accepted: .ttf, .otf, .woff2'),
            });
            continue;
          }
          if (file.size > 5 * 1024 * 1024) {
            results.push({
              file,
              success: false,
              error: t('designer_font_file_too_large', 'Font file must be under 5MB'),
            });
            continue;
          }

          try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/media/fonts/upload', {
              method: 'POST',
              body: form,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              results.push({
                file,
                success: false,
                error: err.message || t('designer_upload_failed', 'Upload failed'),
              });
              continue;
            }
            const body = await res.json().catch(() => null);
            results.push({
              file,
              success: true,
              serverRender: body?.uploaded?.serverRender,
            });
          } catch (err) {
            results.push({
              file,
              success: false,
              error: (err as Error)?.message || t('designer_upload_failed', 'Upload failed'),
            });
          }
        }

        const succeeded = results.filter((result) => result.success);
        const failed = results.length - succeeded.length;
        const woff2Count = succeeded.filter((result) => result.serverRender === false).length;
        if (succeeded.length && user?.orgId) {
          try {
            await mutate(`custom-fonts-${user.orgId}`);
          } catch {
            toaster.show(
              t('designer_fonts_refresh_failed', 'Fonts uploaded, but the font list could not be refreshed.'),
              'warning'
            );
          }
        }

        if (failed > 0) {
          if (results.length === 1) {
            toaster.show(results[0].error || t('designer_upload_failed', 'Upload failed'), 'warning');
          } else {
            toaster.show(
              `${t('designer_fonts_upload_partial', '{{succeeded}} of {{total}} fonts uploaded; {{failed}} failed.', {
                succeeded: succeeded.length,
                total: results.length,
                failed,
              })}${woff2Count ? ` ${t('designer_fonts_woff2_batch_note', 'WOFF2 fonts are not used in server-rendered exports.')}` : ''}`,
              'warning'
            );
          }
        } else if (woff2Count > 0) {
          toaster.show(
            results.length === 1
              ? t('designer_font_uploaded_woff2_note', 'Font uploaded. WOFF2 fonts are not used in server-rendered exports.')
              : t('designer_fonts_uploaded_woff2_note', '{{count}} fonts uploaded. WOFF2 fonts are not used in server-rendered exports.', { count: succeeded.length }),
            'warning'
          );
        } else {
          toaster.show(
            results.length === 1
              ? t('designer_font_uploaded', 'Font uploaded')
              : t('designer_fonts_uploaded', '{{count}} fonts uploaded', { count: succeeded.length }),
            'success'
          );
        }
        return results;
      } finally {
        setUploading(false);
      }
    },
    [fetch, toaster, t, mutate, user?.orgId]
  );

  const upload = useCallback(
    async (file: File): Promise<boolean> => {
      const [result] = await uploadMany([file]);
      return result?.success === true;
    },
    [uploadMany]
  );

  return { upload, uploadMany, uploading };
};
