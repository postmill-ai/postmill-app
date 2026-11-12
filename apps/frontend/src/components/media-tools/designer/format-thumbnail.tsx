'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  pageBackground,
  pageChildren,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { videoOutputToPosterOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/video-poster';
import type {
  DesignerOutput,
  SymbolDefinition,
  VideoOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { renderOutputThumbnail } from './output-thumbnail';
import { DesignPreviewImage } from './panels/design-preview-image';

const thumbnailCache = new Map<string, string>();

export const FormatThumbnail = React.memo(function FormatThumbnail({
  output,
  symbols,
  pageNumber = 0,
  maxDim = 96,
  className = '',
}: {
  output: DesignerOutput | VideoOutput;
  symbols?: SymbolDefinition[];
  pageNumber?: number;
  maxDim?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const renderSeq = useRef(0);
  const [nearViewport, setNearViewport] = useState(false);
  const [thumbnail, setThumbnail] = useState<string>();
  const view = useMemo<DesignerOutput>(
    () =>
      'tracks' in output
        ? videoOutputToPosterOutput(output)
        : {
            ...output,
            bg: pageBackground(output, pageNumber),
            children: pageChildren(output, pageNumber),
            pages: undefined,
          },
    [output, pageNumber]
  );
  const cacheKey = useMemo(
    () => JSON.stringify({ view, symbols, maxDim }),
    [view, symbols, maxDim]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    if (thumbnailCache.has(cacheKey)) return;
    const seq = ++renderSeq.current;
    const timer = window.setTimeout(() => {
      void renderOutputThumbnail(view, symbols, maxDim)
        .then((dataUrl) => {
          if (!dataUrl || renderSeq.current !== seq) return;
          if (thumbnailCache.size >= 100) {
            const oldest = thumbnailCache.keys().next().value;
            if (oldest) thumbnailCache.delete(oldest);
          }
          thumbnailCache.set(cacheKey, dataUrl);
          setThumbnail(dataUrl);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      renderSeq.current += 1;
    };
  }, [cacheKey, maxDim, nearViewport, symbols, view]);

  return (
    <span
      ref={hostRef}
      className={`block shrink-0 overflow-hidden rounded-sm bg-white ${className}`}
      style={{ aspectRatio: `${output.width} / ${output.height}` }}
      aria-hidden="true"
    >
      <DesignPreviewImage
        src={thumbnailCache.get(cacheKey) ?? thumbnail}
        alt=""
        className="h-full w-full object-cover"
        fallback={<span className="block h-full w-full bg-studioBorder/20" />}
        draggable={false}
      />
    </span>
  );
});

export default FormatThumbnail;
