'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { AudioPlayer } from '@postmill-ai/frontend/components/media-tools/audio-player';
import type { FileItem } from './file-manager';
import { getDesignLabel, getFilePresentation } from './file-presentation';

const DocumentFallback: FC<{ file: FileItem; compact?: boolean }> = ({ file, compact }) => {
  const t = useT();
  const presentation = getFilePresentation(file);
  const designLabel = getDesignLabel(file);
  return (
    <div
      data-testid="file-preview-fallback"
      className="flex h-full min-h-[inherit] w-full flex-col items-center justify-center gap-[10px] bg-newBgColorInner p-[16px] text-center text-newTextColor/60"
    >
      <svg width={compact ? 24 : 42} height={compact ? 24 : 42} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </svg>
      <div className={clsx('text-textColor', compact ? 'text-[10px]' : 'text-[14px] font-[500]')}>
        {presentation.isDesign
          ? t(designLabel.key, designLabel.fallback)
          : t('document_preview_unavailable', 'No preview available')}
      </div>
    </div>
  );
};

const ThumbnailImage = React.forwardRef<HTMLImageElement, {
  src: string;
  alt: string;
  className?: string;
}>(({ src, alt, className }, ref) => {
  if (src.startsWith('/') && !src.startsWith('//')) {
    return (
      <Image
        ref={ref}
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
        className={clsx('object-cover', className)}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    // Remote storage URLs need a configured loader; keep the original path there.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={clsx('h-full w-full object-cover', className)}
      loading="lazy"
      decoding="async"
    />
  );
});
ThumbnailImage.displayName = 'ThumbnailImage';

const LazyVideoThumbnail: FC<{
  src: string;
  className?: string;
  captionsLabel: string;
}> = ({ src, className, captionsLabel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timeout = setTimeout(() => setNearViewport(true), 0);
      return () => clearTimeout(timeout);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: '200px' });
    observer.observe(container);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {!nearViewport ? (
        <div className="flex h-full w-full items-center justify-center bg-newBgColorInner text-newTextColor/60" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      ) : (
        <video
          src={src}
          className={clsx('h-full w-full object-cover', className)}
          muted
          preload="metadata"
        >
          <track kind="captions" label={captionsLabel} default />
        </video>
      )}
    </div>
  );
};

export const FileThumbnail: FC<{ file: FileItem; className?: string }> = ({ file, className }) => {
  const mediaDirectory = useMediaDirectory();
  const t = useT();
  const presentation = getFilePresentation(file);
  const thumbnail = presentation.preview.thumbnail;
  const sourceKey = `${file.id}:${thumbnail || (presentation.mediaKind === 'image' ? file.path : '')}`;
  const [brokenSource, setBrokenSource] = useState<string | null>(null);
  const broken = brokenSource === sourceKey;
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const onError = () => setBrokenSource(sourceKey);
    image.addEventListener('error', onError);
    return () => image.removeEventListener('error', onError);
  }, [sourceKey]);

  if (presentation.mediaKind === 'audio') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-newBgColorInner text-newTextColor/60">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    );
  }

  if (thumbnail && !broken) {
    return (
      <ThumbnailImage
        ref={imageRef}
        src={mediaDirectory.set(thumbnail)}
        alt={file.alt || file.originalName || file.name}
        className={className}
      />
    );
  }

  if (presentation.mediaKind === 'image' && !broken) {
    return (
      <ThumbnailImage
        ref={imageRef}
        src={mediaDirectory.set(file.path)}
        alt={file.alt || file.originalName || file.name}
        className={className}
      />
    );
  }

  if (presentation.mediaKind === 'video') {
    return (
      <LazyVideoThumbnail
        src={mediaDirectory.set(file.path)}
        className={className}
        captionsLabel={t('no_captions', 'No captions')}
      />
    );
  }

  return <DocumentFallback file={file} compact />;
};

export const FilePreview: FC<{ file: FileItem; drawer?: boolean }> = ({ file, drawer }) => {
  const mediaDirectory = useMediaDirectory();
  const t = useT();
  const presentation = getFilePresentation(file);
  const preview = presentation.preview;
  const sourceKey = `${file.id}:${preview.src || ''}`;
  const [brokenSource, setBrokenSource] = useState<string | null>(null);
  const broken = brokenSource === sourceKey;
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const onError = () => setBrokenSource(sourceKey);
    image.addEventListener('error', onError);
    return () => image.removeEventListener('error', onError);
  }, [sourceKey]);

  if (preview.kind === 'audio' && preview.src) {
    return (
      <div className="rounded-[8px] border border-newColColor bg-newBgColorInner p-[16px]">
        <AudioPlayer src={mediaDirectory.set(preview.src)} height={drawer ? undefined : 56} />
      </div>
    );
  }

  return (
    <div className={clsx(
      'flex items-center justify-center overflow-hidden rounded-[8px] bg-black/20',
      drawer ? 'aspect-square' : 'max-h-[60vh] min-h-[180px]'
    )}>
      {preview.kind === 'video' && preview.src ? (
        <video
          controls
          src={mediaDirectory.set(preview.src)}
          poster={preview.thumbnail ? mediaDirectory.set(preview.thumbnail) : undefined}
          className={clsx('w-full object-contain', drawer ? 'aspect-video' : 'max-h-[60vh]')}
        >
          <track kind="captions" label={t('no_captions', 'No captions')} default />
        </video>
      ) : preview.kind === 'image' && preview.src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={mediaDirectory.set(preview.src)}
          alt={file.alt || file.originalName || file.name}
          className={clsx('w-full object-contain', drawer ? 'aspect-square' : 'max-h-[60vh]')}
        />
      ) : (
        <DocumentFallback file={file} />
      )}
    </div>
  );
};
