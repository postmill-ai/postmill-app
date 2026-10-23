'use client';

import React from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface VideoPlayerProps {
  src: string;
}

export function VideoPlayer({ src }: VideoPlayerProps) {
  const t = useT();
  return (
    <div className="w-full rounded-xl overflow-hidden bg-black">
      <video controls playsInline className="w-full max-h-[480px]" aria-label={t('video_preview', 'Video preview')}>
        {/* No hardcoded source type — artifacts aren't always mp4 (webm/mov),
            and a wrong declared type makes the browser refuse to play them. */}
        <source src={src} />
        <track kind="captions" srcLang="en" label={t('caption_language_english', 'English')} />
      </video>
    </div>
  );
}
