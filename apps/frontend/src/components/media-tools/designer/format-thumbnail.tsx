'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  pageBackground,
  pageChildren,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { videoOutputToPosterOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/video-poster';
import { structurallyEqual } from '@postmill-ai/nestjs-libraries/media/designer-doc/output-freeze';
import type {
  DesignerOutput,
  SymbolDefinition,
  VideoOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { renderOutputThumbnail } from './output-thumbnail';
import { DesignPreviewImage } from './panels/design-preview-image';

interface ThumbnailCacheEntry {
  output: DesignerOutput;
  pageNumber: number;
  symbols?: SymbolDefinition[];
  maxDim: number;
  dataUrl: string;
}

const thumbnailCache: ThumbnailCacheEntry[] = [];
const matchesCacheEntry = (
  entry: ThumbnailCacheEntry,
  output: DesignerOutput,
  symbols: SymbolDefinition[] | undefined,
  pageNumber: number,
  maxDim: number,
  structural: boolean
) => {
  if (entry.pageNumber !== pageNumber || entry.maxDim !== maxDim) return false;
  if (!structural) return entry.output === output && entry.symbols === symbols;
  return (entry.output === output || structurallyEqual(entry.output, output)) &&
    (entry.symbols === symbols || structurallyEqual(entry.symbols, symbols));
};

const readThumbnailCache = (
  output: DesignerOutput,
  symbols: SymbolDefinition[] | undefined,
  pageNumber: number,
  maxDim: number,
  structural = false
) => {
  const index = thumbnailCache.findIndex((entry) =>
    matchesCacheEntry(entry, output, symbols, pageNumber, maxDim, structural)
  );
  if (index < 0) return undefined;
  const [entry] = thumbnailCache.splice(index, 1);
  thumbnailCache.push(entry);
  return entry.dataUrl;
};

const writeThumbnailCache = (entry: ThumbnailCacheEntry) => {
  const index = thumbnailCache.findIndex((candidate) =>
    matchesCacheEntry(candidate, entry.output, entry.symbols, entry.pageNumber, entry.maxDim, true)
  );
  if (index >= 0) thumbnailCache.splice(index, 1);
  thumbnailCache.push(entry);
  if (thumbnailCache.length > 100) thumbnailCache.shift();
};

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
  const cacheHit = readThumbnailCache(view, symbols, pageNumber, maxDim);

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
    if (!nearViewport || cacheHit) return;
    const seq = ++renderSeq.current;
    const timer = window.setTimeout(() => {
      const structuralHit = readThumbnailCache(view, symbols, pageNumber, maxDim, true);
      if (structuralHit) {
        setThumbnail(structuralHit);
        return;
      }
      void renderOutputThumbnail(view, symbols, maxDim)
        .then((dataUrl) => {
          if (!dataUrl || renderSeq.current !== seq) return;
          writeThumbnailCache({ output: view, symbols, pageNumber, maxDim, dataUrl });
          setThumbnail(dataUrl);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      renderSeq.current += 1;
    };
  }, [cacheHit, maxDim, nearViewport, output, pageNumber, symbols, view]);

  return (
    <span
      ref={hostRef}
      className={`block shrink-0 overflow-hidden rounded-sm bg-white ${className}`}
      style={{ aspectRatio: `${output.width} / ${output.height}` }}
      aria-hidden="true"
    >
      <DesignPreviewImage
        src={cacheHit ?? thumbnail}
        alt=""
        className="h-full w-full object-cover"
        fallback={<span className="block h-full w-full bg-studioBorder/20" />}
        draggable={false}
      />
    </span>
  );
});

export default FormatThumbnail;
