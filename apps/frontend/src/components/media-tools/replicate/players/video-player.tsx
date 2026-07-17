'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface VideoPlayerProps {
  src: string;
}

export function VideoPlayer({ src }: VideoPlayerProps) {
  const t = useT();
  return (
    <div className="w-full rounded-xl overflow-hidden bg-black">
      <video controls playsInline className="w-full max-h-[480px]" aria-label={t('video_preview', 'Video preview')}>
        <source src={src} type="video/mp4" />
        <track kind="captions" srcLang="en" label={t('caption_language_english', 'English')} />
      </video>
    </div>
  );
}
