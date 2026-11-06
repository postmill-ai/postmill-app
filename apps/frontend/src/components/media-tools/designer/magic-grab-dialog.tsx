'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export const MagicGrabDialog: FC<{
  originalUrl: string;
  subjectUrl: string;
  backgroundUrl: string;
  onApply: () => Promise<boolean>;
  onCancel: () => void;
}> = ({ originalUrl, subjectUrl, backgroundUrl, onApply, onCancel }) => {
  const t = useT();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await onApply();
      if (!applied) {
        setError(t('designer_magic_grab_outdated', 'The design changed before this result could be applied. Please try again.'));
      }
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_magic_grab_failed', 'Magic Grab failed'));
    } finally {
      setApplying(false);
    }
  };
  const previews = [
    { key: 'original', label: t('designer_magic_grab_original', 'Original'), src: originalUrl },
    { key: 'subject', label: t('designer_magic_grab_subject', 'Movable subject'), src: subjectUrl },
    { key: 'background', label: t('designer_magic_grab_background', 'Reconstructed background'), src: backgroundUrl },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-newTextColor/65">
        {t('designer_magic_grab_hint', 'Magic Grab uses background removal and generative inpainting. Apply to move the subject independently from the reconstructed background.')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {previews.map((preview) => (
          <div key={preview.key} className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-textColor/70">{preview.label}</div>
            <div className="h-[190px] rounded-md border border-studioBorder bg-designerCanvas flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated media preview */}
              <img src={preview.src} alt={preview.label} className="max-w-full max-h-full object-contain" />
            </div>
          </div>
        ))}
      </div>
      {error && <div role="alert" className="text-[12px] text-dangerText">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={applying} className="px-3 py-1.5 rounded-md border border-studioBorder text-[12px] text-textColor hover:bg-boxHover disabled:opacity-50">
          {t('cancel', 'Cancel')}
        </button>
        <button type="button" onClick={apply} disabled={applying} className="px-3 py-1.5 rounded-md bg-designerAccent text-[12px] text-white hover:bg-designerAccent/80 disabled:opacity-50">
          {applying ? t('designer_processing_ellipsis', 'Processing...') : t('designer_magic_grab_apply', 'Apply Magic Grab')}
        </button>
      </div>
    </div>
  );
};
