'use client';

import React, { FC } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export const GalleryPreviewFallback: FC<{ className?: string }> = ({ className = '' }) => {
  const t = useT();
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-[6px] bg-studioBorder/10 text-[11px] text-newTableText ${className}`}>
      <span aria-hidden="true" className="text-[22px] text-newTextColor/35">▣</span>
      <span>{t('gallery_no_preview', 'No preview available')}</span>
    </div>
  );
};

export const GalleryCardActions: FC<{
  primaryLabel: string;
  primaryAriaLabel: string;
  onPrimary: () => void;
  onPreview?: () => void;
  previewAriaLabel?: string;
}> = ({ primaryLabel, primaryAriaLabel, onPrimary, onPreview, previewAriaLabel }) => {
  const t = useT();
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-[6px] bg-black/35 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <Button
        aria-label={primaryAriaLabel}
        onClick={onPrimary}
        className="h-[30px] px-[12px] text-[11px]"
      >
        {primaryLabel}
      </Button>
      {onPreview && (
        <Button
          secondary
          aria-label={previewAriaLabel}
          onClick={onPreview}
          className="h-[30px] px-[12px] text-[11px]"
        >
          {t('preview', 'Preview')}
        </Button>
      )}
    </div>
  );
};
