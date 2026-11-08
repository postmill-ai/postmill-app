'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DesignPreviewImage } from './design-preview-image';

export interface DesignVersionMeta {
  id: string;
  name?: string | null;
  auto: boolean;
  width: number;
  height: number;
  previewDataUrl?: string | null;
  createdAt: string;
}

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('preview read failed'));
  reader.readAsDataURL(blob);
});

const responseDataUrl = async (response: Response) => {
  if (!response.ok) throw new Error('preview failed');
  return blobToDataUrl(await response.blob());
};

export const VersionCompareDialog: FC<{
  designId: string;
  version: DesignVersionMeta;
  currentDoc: DesignerDoc;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  onRestore: () => Promise<boolean>;
  onClose: () => void;
}> = ({ designId, version, currentDoc, fetch, onRestore, onClose }) => {
  const t = useT();
  const [currentSrc, setCurrentSrc] = useState<string | undefined>();
  const [savedSrc, setSavedSrc] = useState(version.previewDataUrl || undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const requestRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const current = responseDataUrl(await fetch('/media/designs/preview', {
        method: 'POST',
        body: JSON.stringify({ doc: currentDoc }),
      }));
      const saved = version.previewDataUrl
        ? Promise.resolve(version.previewDataUrl)
        : responseDataUrl(await fetch(`/media/designs/${designId}/versions/${version.id}/preview`));
      const [currentResult, savedResult] = await Promise.all([current, saved]);
      if (request !== requestRef.current) return;
      setCurrentSrc(currentResult);
      setSavedSrc(savedResult);
      setLoading(false);
    } catch {
      if (request !== requestRef.current) return;
      setError(tRef.current('designer_version_preview_failed', 'Could not render this version preview.'));
      setLoading(false);
    }
  }, [currentDoc, designId, fetch, version.id, version.previewDataUrl]);

  useEffect(() => {
    const requests = requestRef;
    void load();
    return () => {
      requests.current++;
    };
  }, [load]);

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      if (await onRestore()) onClose();
    } catch {
      // The parent reports restore failures; keep this dialog open for retry.
    } finally {
      setRestoring(false);
    }
  };

  const fallback = (label: string) => (
    <div className="text-[12px] text-newTextColor/60 text-center px-3">{label}</div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-textColor">{t('designer_compare_current', 'Current')}</div>
          <div className="h-[280px] rounded-md border border-studioBorder bg-designerCanvas flex items-center justify-center overflow-hidden">
            <DesignPreviewImage
              src={currentSrc}
              alt={t('designer_compare_current', 'Current')}
              className="max-w-full max-h-full object-contain"
              fallback={fallback(t('designer_current_preview_unavailable', 'The current preview is unavailable.'))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-textColor">
            {t('designer_compare_saved', 'Saved version')}
          </div>
          <div className="h-[280px] rounded-md border border-studioBorder bg-designerCanvas flex items-center justify-center overflow-hidden">
            {loading ? (
              <div role="status" className="text-[12px] text-newTextColor/60">{t('designer_rendering_preview', 'Rendering preview…')}</div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 px-3">
                <div role="alert" className="text-[12px] text-dangerText text-center">{error}</div>
                <button type="button" onClick={() => void load()} className="px-2 py-1 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
                  {t('try_again', 'Try again')}
                </button>
              </div>
            ) : (
              <DesignPreviewImage
                src={savedSrc}
                alt={version.name || t('designer_compare_saved', 'Saved version')}
                className="max-w-full max-h-full object-contain"
                fallback={fallback(t('designer_version_preview_unavailable', 'The saved preview is unavailable.'))}
              />
            )}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-newTextColor/60">
        {version.name || t('designer_version_untitled_short', 'Untitled version')} · {new Date(version.createdAt).toLocaleString()} · {version.width}×{version.height}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover">
          {t('close', 'Close')}
        </button>
        <button
          type="button"
          disabled={restoring || loading || !!error}
          onClick={() => void restore()}
          className="px-3 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50"
        >
          {restoring ? t('designer_restoring_version', 'Restoring…') : t('designer_restore_version', 'Restore')}
        </button>
      </div>
    </div>
  );
};
