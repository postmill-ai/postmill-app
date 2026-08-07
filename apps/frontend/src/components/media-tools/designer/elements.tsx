'use client';

import React, {
  FC,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Image as KonvaImage, Rect, Ellipse, Line, Star, Text as KonvaText, TextPath, Group, Shape } from 'react-konva';
import Konva from 'konva';
import { isNativeBlend } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';
import type { DesignerElement, DesignerGradient, TextRun } from './designer.store';
import { computeCoverCrop } from './reflow';
import { fittedFontSize, fitDesignerText } from './measure-text';
import { measureLineWidth, applyTextTransform } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import {
  pointsForShape,
  flattenPoints,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';
import { tracePathNodes } from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';
import { warpedOutline } from '@postmill-ai/nestjs-libraries/media/designer-doc/warp';
import { arcPathData } from '@postmill-ai/nestjs-libraries/media/designer-doc/curved-text';
import {
  arrowHeadPoints,
  strokeEndpoints,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/stroke-style';
import { getBuffer } from './raster-layers';
import { buildLayerTree, type LayerNode } from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';
import {
  expandSymbols,
  type SymbolDefinition,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import {
  LayerGroup,
  AdjustmentScope,
  MaskedLayer,
  StyledLayer,
  BackdropFilterShape,
  CustomBlendLayer,
  blendPropFor,
  hasLayerStyles,
} from './layer-render';
import { patternFillProps } from './patterns';
import {
  applyFilterTokens,
  blurFilterRadius,
  hasFilterEffect,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-pixels';

type SelectHandler = (id: string, evt?: Konva.KonvaEventObject<any>) => void;

interface ElementsProps {
  elements: DesignerElement[];
  /** Symbol definitions from the document, for expanding instances. */
  symbols?: SymbolDefinition[];
  onSelect: SelectHandler;
  onContextMenu?: (elementId: string, clientX: number, clientY: number) => void;
  /**
   * Elements are only draggable under the Move tool. Every other tool needs the
   * pointer for its own interaction, so leaving nodes draggable would steal the
   * press before the tool's handler ever saw it.
   */
  interactive?: boolean;
  /**
   * The artboard background, folded in as the bottom-most layer.
   *
   * An UNCLIPPED adjustment layer transforms everything below it, and in this
   * document model the canvas background IS below everything — so it has to sit
   * inside the fold or the canvas stops matching the server export, which reads
   * the background back with the rest of the page.
   */
  backdrop?: ReactNode;
  /**
   * Bumped when asynchronously-loaded backdrop content (the bg image) becomes
   * ready. An AdjustmentScope CACHES its children; without this the cache is
   * captured before the image arrives and the canvas stays blank forever —
   * the "black canvas on a freshly loaded doc" bug.
   */
  backdropKey?: string | number;
}

const imageCache = new Map<string, HTMLImageElement>();
const cacheListeners = new Set<() => void>();

// The Designer injects its authenticated fetch so the image loader can fall
// back to the same-origin proxy for cross-origin hosts that don't send CORS
// headers (otherwise `crossOrigin="anonymous"` fails and the canvas is blank).
type ImageFetch = (url: string, options?: RequestInit) => Promise<Response>;
let injectedFetch: ImageFetch | null = null;
export const setImageFetch = (fn: ImageFetch | null) => {
  injectedFetch = fn;
};

const isCrossOrigin = (src: string): boolean => {
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    return new URL(src).origin !== window.location.origin;
  } catch {
    return false;
  }
};

// Pull a cross-origin image through the authenticated designer proxy and return
// a same-origin object URL (untainted — usable for both display and export).
const loadViaProxy = async (src: string): Promise<string | null> => {
  if (!injectedFetch) return null;
  try {
    const res = await injectedFetch(
      `/media/designer/proxy?url=${encodeURIComponent(src)}`
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

const notifyCacheListeners = () => {
  cacheListeners.forEach((listener) => listener());
};

// Bound the module-level cache and revoke any blob: object URLs (from the proxy
// fallback) on eviction so a long SPA session doesn't leak decoded bitmaps or
// object URLs. Insertion order = eviction order (oldest first).
const MAX_IMAGE_CACHE = 240;
const evictImageCache = () => {
  while (imageCache.size > MAX_IMAGE_CACHE) {
    const oldestKey = imageCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const img = imageCache.get(oldestKey);
    imageCache.delete(oldestKey);
    if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  }
};

// Full teardown — call on Designer unmount to release every cached bitmap /
// object URL.
export const clearImageCache = () => {
  imageCache.forEach((img) => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });
  imageCache.clear();
  notifyCacheListeners();
};

const loadImage = (src: string): Promise<HTMLImageElement> => {
  const cached = imageCache.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finish = (loaded: HTMLImageElement) => {
      imageCache.set(src, loaded);
      evictImageCache();
      notifyCacheListeners();
      resolve(loaded);
    };

    img.onload = () => finish(img);

    img.onerror = () => {
      // A cross-origin host without CORS headers blocks the anonymous load.
      // Retry once through the same-origin authenticated proxy.
      if (isCrossOrigin(src)) {
        loadViaProxy(src).then((objectUrl) => {
          if (!objectUrl) {
            notifyCacheListeners();
            reject(new Error('Failed to load image'));
            return;
          }
          const proxied = new Image();
          proxied.onload = () => finish(proxied);
          proxied.onerror = () => {
            notifyCacheListeners();
            reject(new Error('Failed to load image'));
          };
          proxied.src = objectUrl; // same-origin blob — no crossOrigin / no taint
        });
        return;
      }
      notifyCacheListeners();
      reject(new Error('Failed to load image'));
    };

    img.src = src;
  });
};

const subscribeToCache = (listener: () => void) => {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
};

const getCachedImage = (src: string | undefined) => {
  return src ? imageCache.get(src) || null : null;
};

// Natural pixel size of a loaded image (for crop math). Null if not yet cached.
export const getImageNaturalSize = (src?: string): { width: number; height: number } | null => {
  const img = src ? imageCache.get(src) : null;
  return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
};

export const useLoadedImage = (src: string | undefined) => {
  const image = useSyncExternalStore(
    subscribeToCache,
    () => getCachedImage(src),
    () => getCachedImage(src)
  );

  useEffect(() => {
    if (!src) return;
    if (imageCache.has(src)) return;
    let cancelled = false;
    loadImage(src).catch(() => {
      if (!cancelled) notifyCacheListeners();
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return image;
};

// Convert a DesignerGradient into Konva gradient props for a w×h box.
export const gradientFillProps = (
  g: DesignerGradient | undefined,
  width: number,
  height: number,
  /**
   * Where the node's local origin sits relative to the box's top-left. Zero for
   * every shape whose origin IS the top-left; the ellipse draws from its centre,
   * so its ramp has to be built there or it lands half a box away.
   */
  origin: { x: number; y: number } = { x: 0, y: 0 }
): Record<string, unknown> => {
  if (!g || !g.stops?.length) return {};
  const colorStops = g.stops.flatMap((s) => [s.offset, s.color]);
  const cx = origin.x + width / 2;
  const cy = origin.y + height / 2;
  if (g.type === 'radial') {
    // Matches `buildStyleGradient`: the inner circle may sit off centre.
    const fx = origin.x + (g.focalX ?? 0.5) * width;
    const fy = origin.y + (g.focalY ?? 0.5) * height;
    return {
      fillRadialGradientStartPoint: { x: fx, y: fy },
      fillRadialGradientEndPoint: { x: cx, y: cy },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.max(width, height) / 2,
      fillRadialGradientColorStops: colorStops,
    };
  }
  const angle = ((g.angle ?? 0) * Math.PI) / 180;
  const dx = (Math.cos(angle) * width) / 2;
  const dy = (Math.sin(angle) * height) / 2;
  return {
    fillLinearGradientStartPoint: { x: cx - dx, y: cy - dy },
    fillLinearGradientEndPoint: { x: cx + dx, y: cy + dy },
    fillLinearGradientColorStops: colorStops,
  };
};

// ---- Rich text measurement -------------------------------------------------
let _measureCanvas: HTMLCanvasElement | null = null;
let _measureCtx: CanvasRenderingContext2D | null = null;

const getMeasureCtx = (): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null;
  if (!_measureCtx) {
    _measureCanvas = document.createElement('canvas');
    _measureCtx = _measureCanvas.getContext('2d');
  }
  return _measureCtx;
};

/**
 * Konva has no numeric weight of its own — it pastes `fontStyle` straight into
 * the canvas font shorthand, so a NUMBER belongs there. Collapsing to
 * bold/normal threw away every weight between: a 200 hairline painted at 400 on
 * the canvas while the server exported it at 200.
 */
const konvaWeight = (weight: number | undefined, italic: boolean): string =>
  `${italic ? 'italic ' : ''}${weight ?? 400}`;

const buildRunFont = (run: TextRun, el: DesignerElement): string => {
  const style = (run.fontStyle ?? el.fontStyle) === 'italic' ? 'italic ' : '';
  const weight = run.fontWeight ?? el.fontWeight ?? 400;
  const size = run.fontSize ?? el.fontSize ?? 16;
  const family = run.fontFamily ?? el.fontFamily ?? 'Arial';
  return `${style}${weight} ${size}px ${family}`.trim();
};

/**
 * Rich runs are measured with the element's tracking, the way the server does
 * it. Without this the canvas wrapped a tracked paragraph at different words
 * than the export, and `letterSpacing` silently applied to flat text only.
 */
const measureRunWidth = (text: string, run: TextRun, el: DesignerElement): number => {
  const ctx = getMeasureCtx();
  const spacing = el.letterSpacing || 0;
  if (!ctx) return text.length * ((run.fontSize ?? el.fontSize ?? 16) * 0.6 + spacing);
  ctx.font = buildRunFont(run, el);
  return measureLineWidth(text, 0, spacing, (t) => ctx.measureText(t).width);
};

interface RichSegment {
  text: string;
  x: number;
  y: number;
  run: TextRun;
  element: DesignerElement;
}

const layoutRichRuns = (runs: TextRun[], el: DesignerElement): RichSegment[] => {
  const maxWidth = el.width;
  const baseSize = runs[0]?.fontSize ?? el.fontSize ?? 16;
  const baseLineHeight = (el.lineHeight ?? 1.2) * baseSize;
  const segments: RichSegment[] = [];

  let x = 0;
  let y = 0;
  let lineMaxHeight = baseLineHeight;

  const advanceLine = () => {
    x = 0;
    y += lineMaxHeight;
    lineMaxHeight = baseLineHeight;
  };

  for (const run of runs) {
    if (!run.text) continue;
    const runLineHeight = (el.lineHeight ?? 1.2) * (run.fontSize ?? el.fontSize ?? 16);
    lineMaxHeight = Math.max(lineMaxHeight, runLineHeight);

    const paragraphs = run.text.split('\n');

    for (let pi = 0; pi < paragraphs.length; pi++) {
      const words = paragraphs[pi].split(' ');

      for (let wi = 0; wi < words.length; wi++) {
        const raw = words[wi];
        if (raw === '') {
          const spw = measureRunWidth(' ', run, el);
          if (x + spw > maxWidth && x > 0) advanceLine();
          x += spw;
          continue;
        }
        const displayWord = wi < words.length - 1 ? raw + ' ' : raw;
        const wordWidth = measureRunWidth(displayWord, run, el);

        if (x > 0 && x + wordWidth > maxWidth) advanceLine();

        segments.push({
          text: displayWord,
          x,
          y,
          run: { ...run },
          element: el,
        });
        x += wordWidth;
      }

      if (pi < paragraphs.length - 1) advanceLine();
    }
  }

  return segments;
};

// Apply alignment offset to laid-out segments
const applyAlignment = (segments: RichSegment[], el: DesignerElement): RichSegment[] => {
  const align = el.align || 'left';
  if (align === 'left') return segments;

  // Group segments by line (y-position) and compute per-line offset
  const lineMap = new Map<number, { segments: RichSegment[]; totalWidth: number }>();
  for (const seg of segments) {
    let entry = lineMap.get(seg.y);
    if (!entry) {
      entry = { segments: [], totalWidth: 0 };
      lineMap.set(seg.y, entry);
    }
    entry.segments.push(seg);
  }

  const result: RichSegment[] = [];
  for (const [, entry] of lineMap) {
    const lastSeg = entry.segments[entry.segments.length - 1];
    const lineEnd = lastSeg.x + measureRunWidth(lastSeg.text, lastSeg.run, el);
    const offset = align === 'center' ? (el.width - lineEnd) / 2 : el.width - lineEnd;

    for (const seg of entry.segments) {
      result.push({ ...seg, x: seg.x + offset });
    }
  }
  return result;
};

interface ImageNodeProps {
  element: DesignerElement;
  onSelect: SelectHandler;
  onContextMenu?: (elementId: string, clientX: number, clientY: number) => void;
  interactive: boolean;
}

const ImageNode: FC<ImageNodeProps> = ({ element, onSelect, onContextMenu, interactive }) => {
  const loaded = useLoadedImage(element.src);
  // A raster layer draws from its live paint buffer while it is being edited —
  // the uploaded `src` only catches up when the stroke commits, so rendering
  // from `src` alone would lag a whole stroke behind the cursor.
  const liveBuffer = element.type === 'raster' ? getBuffer(element.id) : undefined;
  const image = (liveBuffer as unknown as HTMLImageElement | undefined) || loaded;
  const imageRef = useRef<Konva.Image>(null);
  const flipX = element.flipX ? -1 : 1;
  const flipY = element.flipY ? -1 : 1;
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [filterKey, setFilterKey] = useState(0);
  const [isTransforming, setIsTransforming] = useState(false);

  // `contain` letterboxes inside the box; every other mode fills it. The canvas
  // used to handle only `cover`, so picking "Fit" changed nothing here while it
  // letterboxed in the export.
  let drawBox = { x: 0, y: 0, width: element.width, height: element.height };
  if (element.fitMode === 'contain' && image && !element.crop) {
    const natW = image.naturalWidth || element.width;
    const natH = image.naturalHeight || element.height;
    const scale = Math.min(element.width / natW, element.height / natH);
    const w = natW * scale;
    const h = natH * scale;
    drawBox = { x: (element.width - w) / 2, y: (element.height - h) / 2, width: w, height: h };
  }

  let crop: { x: number; y: number; width: number; height: number } | undefined;
  if (element.crop) {
    crop = { x: element.crop.x, y: element.crop.y, width: element.crop.width, height: element.crop.height };
  } else if (element.fitMode === 'cover' && image) {
    const c = computeCoverCrop(
      image.naturalWidth,
      image.naturalHeight,
      element.width,
      element.height,
      element.focalPoint,
    );
    crop = { x: c.x, y: c.y, width: c.width, height: c.height };
  }

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;

    if (hasFilterEffect(element.filters)) {
      // The SAME pixel code the server runs, as a Konva filter — the trick
      // `AdjustmentScope` already uses. Konva's own filters were the wrong
      // units: `Brighten` is neutral at 0 where CSS `brightness` is neutral at
      // 1, so a 0.5 darken brightened the image and 1.5 blew it to white.
      const tokens = element.filters as string[];
      const radius = blurFilterRadius(tokens);
      const filters: Array<(imageData: ImageData) => void> = [];
      if (radius > 0) {
        filters.push(Konva.Filters.Blur);
        node.blurRadius(radius);
      }
      filters.push((imageData: ImageData) => applyFilterTokens(imageData.data, tokens));
      node.filters(filters as never);
    } else {
      node.filters([]);
      node.clearCache();
    }

    if (isTransforming) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilterKey((k) => k + 1);
    }, 150);
    // `image` is a dep so a bitmap that loads AFTER the debounce (proxy / cold
    // cache) re-triggers the cache pass — otherwise the node was cached empty and
    // stays permanently blank.
  }, [element.filters, element.width, element.height, isTransforming, image]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;

    if (element.filters?.length) {
      node.cache();
      node.getLayer()?.batchDraw();
    }
  }, [filterKey, image]);

  const textMask = element.mask?.type === 'text' ? element.mask : undefined;
  const shapeMask = element.mask?.type === 'shape' ? element.mask : undefined;

  const textMaskCanvas = React.useMemo(() => {
    if (!textMask?.text) return null;
    const canvas = document.createElement('canvas');
    canvas.width = element.width;
    canvas.height = element.height;
    const mctx = canvas.getContext('2d');
    if (!mctx) return null;
    const fontFamily = textMask.fontFamily || 'sans-serif';
    const fontWeight = textMask.fontWeight ?? 700;
    const fontSize = Math.max(8, Math.round(element.height * 0.85));
    mctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = '#ffffff';
    mctx.fillText(textMask.text, element.width / 2, element.height / 2);
    return canvas;
  }, [textMask, element.width, element.height]);

  const clipFunc = shapeMask
    ? (ctx: any) => {
        const w = element.width;
        const h = element.height;
        const shape = shapeMask.shape || 'ellipse';
        if (shape === 'ellipse') {
          ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else if (shape === 'rounded-rect') {
          const r = shapeMask.cornerRadius || 8;
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.arcTo(w, 0, w, h, r);
          ctx.arcTo(w, h, 0, h, r);
          ctx.arcTo(0, h, 0, 0, r);
          ctx.arcTo(0, 0, w, 0, r);
          ctx.closePath();
        } else if (shape === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
        } else if (shape === 'star') {
          const cx = w / 2;
          const cy = h / 2;
          const outerR = Math.min(w, h) / 2;
          const innerR = outerR * 0.5;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const angle = (Math.PI / 5) * i - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else if (shape === 'hexagon') {
          const cx = w / 2;
          const cy = h / 2;
          const r = Math.min(w, h) / 2;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else if (shape === 'heart') {
          const cw = w;
          const ch = h;
          ctx.beginPath();
          ctx.moveTo(cw / 2, ch * 0.75);
          ctx.bezierCurveTo(cw * 0.1, ch * 0.4, cw * 0.1, ch * 0.05, cw / 2, ch * 0.25);
          ctx.bezierCurveTo(cw * 0.9, ch * 0.05, cw * 0.9, ch * 0.4, cw / 2, ch * 0.75);
          ctx.closePath();
        }
      }
    : undefined;

  return (
    <Group
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      draggable={!element.locked && interactive}
      clipFunc={clipFunc}
      onClick={(e) => onSelect(element.id, e)}
      onTap={(e) => onSelect(element.id, e)}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.evt.stopPropagation();
        onContextMenu?.(element.id, e.evt.clientX, e.evt.clientY);
      }}
      onTransformStart={() => setIsTransforming(true)}
      onTransformEnd={() => {
        setIsTransforming(false);
        // Re-cache filters immediately after a transform finishes.
        setFilterKey((k) => k + 1);
      }}
    >
      <KonvaImage
        ref={imageRef}
        image={image || undefined}
        x={(element.flipX ? element.width : 0) + (element.flipX ? -drawBox.x : drawBox.x)}
        y={(element.flipY ? element.height : 0) + (element.flipY ? -drawBox.y : drawBox.y)}
        scaleX={flipX}
        scaleY={flipY}
        width={drawBox.width}
        height={drawBox.height}
        crop={crop}
        cornerRadius={element.mask ? 0 : (element.borderRadius || 0)}
      />
      {textMaskCanvas && (
        <Shape
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          listening={false}
          sceneFunc={(ctx) => {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(textMaskCanvas, 0, 0);
            ctx.restore();
          }}
        />
      )}
      {!element.mask && element.stroke && (
        <Rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth || 1}
          cornerRadius={element.borderRadius || 0}
          listening={false}
        />
      )}
    </Group>
  );
};

interface IconNodeProps {
  element: DesignerElement;
  onSelect: SelectHandler;
  onContextMenu?: (elementId: string, clientX: number, clientY: number) => void;
  interactive: boolean;
}

const IconNode: FC<IconNodeProps> = ({ element, onSelect, onContextMenu, interactive }) => {
  const imageRef = useRef<Konva.Image>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!element.src) return;
    // Not every collection draws on Iconify's 24 grid; an icon carries its own
    // viewBox when it differs, or it renders cropped inside its box.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${element.viewBox || '0 0 24 24'}" width="${element.width}" height="${element.height}" fill="${element.fill || '#000000'}">${element.src}</svg>`;
    // URL-encode rather than btoa: btoa throws on non-Latin-1 characters (e.g. an
    // SVG carrying a non-ASCII title/glyph).
    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const img = new Image();
    img.onload = () => setImageObj(img);
    img.src = dataUrl;
  }, [element.src, element.viewBox, element.fill, element.width, element.height]);

  return (
    <Group
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      draggable={!element.locked && interactive}
      onClick={(e) => onSelect(element.id, e)}
      onTap={(e) => onSelect(element.id, e)}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.evt.stopPropagation();
        onContextMenu?.(element.id, e.evt.clientX, e.evt.clientY);
      }}
    >
      <KonvaImage
        ref={imageRef}
        image={imageObj || undefined}
        width={element.width}
        height={element.height}
        cornerRadius={element.borderRadius || 0}
      />
      {element.stroke && (
        <Rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth || 1}
          cornerRadius={element.borderRadius || 0}
          listening={false}
        />
      )}
    </Group>
  );
};

/**
 * The stroke options Konva expresses natively. Anything absent stays absent
 * rather than being defaulted, so a layer without stroke options renders
 * exactly as it did before they existed.
 */
export const konvaStrokeProps = (
  style: DesignerElement['strokeStyle']
): Record<string, unknown> => {
  if (!style) return {};
  const props: Record<string, unknown> = {};
  if (style.dash?.length) props.dash = style.dash;
  if (style.dashOffset) props.dashOffset = style.dashOffset;
  if (style.lineCap) props.lineCap = style.lineCap;
  if (style.lineJoin) props.lineJoin = style.lineJoin;
  if (style.miterLimit) props.miterLimit = style.miterLimit;
  return props;
};

/**
 * Arrowheads, which neither Konva nor canvas has. Traced from the shared
 * geometry so the head is the same shape here, in the PDF and in a rendered
 * frame.
 */
const ArrowHeads: FC<{ element: DesignerElement; points: { x: number; y: number }[] }> = ({
  element,
  points,
}) => {
  const style = element.strokeStyle;
  if (!style?.arrowStart && !style?.arrowEnd) return null;
  const ends = strokeEndpoints(points);
  if (!ends) return null;
  const width = element.strokeWidth || 1;
  const heads = [
    arrowHeadPoints(style.arrowStart || 'none', ends.start, ends.startAngle, width),
    arrowHeadPoints(style.arrowEnd || 'none', ends.end, ends.endAngle, width),
  ].filter((p) => p.length);
  if (!heads.length) return null;

  return (
    <>
      {heads.map((pts, i) => (
        <Line
          key={i}
          x={element.x}
          y={element.y}
          rotation={element.rotation}
          points={pts.flatMap((p) => [p.x, p.y])}
          closed
          fill={element.stroke || element.fill || '#000000'}
          listening={false}
        />
      ))}
    </>
  );
};

/**
 * Wraps a leaf in its painted layer mask, if it has one.
 *
 * A component rather than a branch inside `renderLeaf` because loading the mask
 * bitmap needs a hook, and `renderLeaf` is a plain function called in a loop.
 */
const MaskedLeaf: FC<{ element: DesignerElement; children: ReactNode }> = ({
  element,
  children,
}) => {
  const mask = useLoadedImage(
    element.maskEnabled === false ? undefined : element.maskSrc
  );
  const live = getBuffer(`${element.id}:mask`);
  const stencil = (live as HTMLCanvasElement | undefined) || mask;
  if (!stencil || element.maskEnabled === false) return <>{children}</>;
  return (
    <MaskedLayer element={element} mask={stencil} cacheKey={element.maskSrc}>
      {children}
    </MaskedLayer>
  );
};

/**
 * Wraps a leaf in its layer effects, if it has any.
 *
 * Unstyled layers go through untouched, so the common case pays nothing for
 * this and renders byte-for-byte as it did before effects existed.
 */
const StyledLeaf: FC<{ element: DesignerElement; children: ReactNode }> = ({
  element,
  children,
}) => {
  // Frosted glass draws BEFORE the layer, from the pixels already beneath it.
  const backdrop = element.backdropFilter ? (
    <BackdropFilterShape key={`${element.id}-backdrop`} element={element} />
  ) : null;
  const styled = hasLayerStyles(element) ? (
    <StyledLayer element={element} cacheKey={element.id}>
      {children}
    </StyledLayer>
  ) : (
    children
  );

  // The eleven non-native blend modes need the backdrop, which only the
  // capture/blend sandwich can give them — see `CustomBlendLayer`.
  const composited = isNativeBlend(element.blendMode) ? (
    styled
  ) : (
    <CustomBlendLayer element={element}>{styled}</CustomBlendLayer>
  );

  return (
    <>
      {backdrop}
      {composited}
    </>
  );
};

export const CanvasElements: FC<ElementsProps> = ({
  elements,
  symbols,
  onSelect,
  onContextMenu,
  interactive = true,
  backdrop,
  backdropKey,
}) => {
  // Symbol instances expand to ordinary elements before the tree is built, so
  // nothing below here needs to know symbols exist — the same contract the
  // server renderer follows.
  const expanded = useMemo(() => expandSymbols(elements, symbols), [elements, symbols]);
  const tree = useMemo(() => buildLayerTree(expanded), [expanded]);

  const renderLeaf = (el: DesignerElement): ReactNode => {
        // A styled layer draws inside StyledLayer, which owns the blend and the
        // opacity so they apply to the finished stack rather than to the bare
        // layer — the server's `ignoreBlend`, for the same reason.
        const styled = hasLayerStyles(el);
        const commonProps = {
          id: el.id,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          rotation: el.rotation,
          // Flip mirrors about the element's centre, for EVERY layer type. The
          // Flip control is offered for any selection but was only ever honoured
          // inside ImageNode, so flipping text or a shape did nothing on the
          // canvas and mirrored it in the export. Konva applies scale after the
          // rotation, about the node origin, so the offset re-centres it.
          scaleX: el.flipX ? -1 : 1,
          scaleY: el.flipY ? -1 : 1,
          offsetX: el.flipX ? el.width : 0,
          offsetY: el.flipY ? el.height : 0,
          opacity: styled ? 1 : el.opacity,
          // Native blends composite for free. The other eleven resolve to
          // undefined here and are composited by `CustomBlendLayer`, which
          // wraps this leaf and blends it against the captured backdrop.
          globalCompositeOperation: (styled
            ? undefined
            : blendPropFor(el.blendMode)) as never,
          // Dash, cap and join map straight onto Konva; arrowheads do not, and
          // are drawn as their own Shape below.
          ...konvaStrokeProps(el.strokeStyle),
          draggable: !el.locked && interactive,
          onClick: (e: Konva.KonvaEventObject<MouseEvent>) => onSelect(el.id, e),
          onTap: (e: Konva.KonvaEventObject<TouchEvent>) => onSelect(el.id, e),
          onContextMenu: (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            onContextMenu?.(el.id, e.evt.clientX, e.evt.clientY);
          },
        };

        switch (el.type) {
          case 'text': {
            const shadow = el.textShadow;
            const outline = el.textStroke;
            const fontStyle = konvaWeight(el.fontWeight, el.fontStyle === 'italic');
            const curve = el.curve ?? 0;
            // Shared with the server, which walks the same arc a glyph at a
            // time. Deriving it here independently is how a positive Arc Angle
            // ended up putting the baseline a full radius below the element.
            const textPathData = el.textPath
              ? el.textPath
              : arcPathData(el.width, curve, el.height, el.verticalAlign);

            // Rich text: flatten runs into one string for curved text,
            // or render each run segment individually for straight text.
            if (el.richText?.length) {
              if (textPathData) {
                const flatText = el.richText.map((r) => r.text).join('');
                return (
                  <TextPath
                    key={el.id}
                    {...commonProps}
                    data={textPathData}
                    text={flatText}
                    // The server offsets the run along the path for centre/right;
                    // without this the canvas always started at the path origin.
                    align={el.align || 'left'}
                    fontFamily={el.fontFamily || 'Arial'}
                    fontSize={el.fontSize || 16}
                    fontStyle={fontStyle}
                    fill={el.fill || '#000000'}
                    shadowColor={shadow?.color}
                    shadowBlur={shadow?.blur}
                    shadowOffsetX={shadow?.offsetX}
                    shadowOffsetY={shadow?.offsetY}
                    shadowEnabled={!!shadow}
                    stroke={outline?.color}
                    strokeWidth={outline?.width}
                    fillAfterStrokeEnabled={!!outline}
                  />
                );
              }

              const runFontStyle = (run: TextRun) =>
                konvaWeight(
                  run.fontWeight ?? el.fontWeight,
                  (run.fontStyle ?? el.fontStyle) === 'italic'
                );

              const segments = applyAlignment(layoutRichRuns(el.richText, el), el);

              return (
                <Group key={el.id} {...commonProps}>
                  {segments.map((seg, i) => (
                    <KonvaText
                      key={`${seg.x}-${seg.y}-${seg.text}-${seg.run.fontFamily}-${seg.run.fontSize}-${seg.run.fontStyle}-${seg.run.fontWeight}-${seg.run.fill}-${seg.run.underline ? 'u' : 'n'}`}
                      x={seg.x}
                      y={seg.y}
                      text={seg.text}
                      fontFamily={seg.run.fontFamily || el.fontFamily || 'Arial'}
                      fontSize={seg.run.fontSize || el.fontSize || 16}
                      fontStyle={runFontStyle(seg.run)}
                      letterSpacing={el.letterSpacing || 0}
                      {...(seg.run.fill
                        ? {}
                        : gradientFillProps(el.fillGradient, el.width, el.height))}
                      fill={seg.run.fill || el.fill || '#000000'}
                      textDecoration={seg.run.underline ? 'underline' : undefined}
                      shadowColor={shadow?.color}
                      shadowBlur={shadow?.blur}
                      shadowOffsetX={shadow?.offsetX}
                      shadowOffsetY={shadow?.offsetY}
                      shadowEnabled={!!shadow}
                      stroke={outline?.color}
                      strokeWidth={outline?.width}
                      fillAfterStrokeEnabled={!!outline}
                    />
                  ))}
                </Group>
              );
            }

            if (textPathData) {
              return (
                <TextPath
                  key={el.id}
                  {...commonProps}
                  data={textPathData}
                  {...gradientFillProps(el.fillGradient, el.width, el.height)}
                  text={el.text || ''}
                  align={el.align || 'left'}
                  fontFamily={el.fontFamily || 'Arial'}
                  fontSize={el.fontSize || 16}
                  fontStyle={fontStyle}
                  fill={el.fill || '#000000'}
                  shadowColor={shadow?.color}
                  shadowBlur={shadow?.blur}
                  shadowOffsetX={shadow?.offsetX}
                  shadowOffsetY={shadow?.offsetY}
                  shadowEnabled={!!shadow}
                  stroke={outline?.color}
                  strokeWidth={outline?.width}
                  fillAfterStrokeEnabled={!!outline}
                />
              );
            }

            // Horizontal scale: Konva scales the node, and `width` is in the
            // node's own coordinates, so the wrap box has to be divided back
            // out or condensed text would also re-wrap at a narrower measure.
            const scaleX = el.textScaleX || 1;

            // Paragraph spacing and a first-line indent have no Konva `Text`
            // equivalent, so those two lay the block out line by line from the
            // SHARED fitter — the same lines, gaps and indents the server
            // paints. Everything else keeps the single wrapping node.
            const fitted = fitDesignerText(el);
            const staggered =
              fitted &&
              (fitted.lineGaps.some((g) => g > 0) || fitted.lineIndents.some((i) => i > 0));
            if (staggered && fitted) {
              const boxWidth = el.width / scaleX;
              const contentHeight =
                fitted.lines.length * fitted.lineHeight +
                fitted.lineGaps.reduce((sum, gap) => sum + gap, 0);
              const top =
                el.verticalAlign === 'middle'
                  ? Math.max(0, (el.height - contentHeight) / 2)
                  : el.verticalAlign === 'bottom'
                  ? Math.max(0, el.height - contentHeight)
                  : 0;
              let cursor = top;
              const rows = fitted.lines.map((line, i) => {
                cursor += fitted.lineGaps[i] || 0;
                const row = { line, y: cursor, indent: fitted.lineIndents[i] || 0 };
                cursor += fitted.lineHeight;
                return row;
              });
              return (
                <Group key={el.id} {...commonProps} scaleX={scaleX}>
                  {rows.map((row, i) => (
                    <KonvaText
                      key={`${i}-${row.line}`}
                      x={row.indent}
                      y={row.y}
                      width={boxWidth - row.indent}
                      text={row.line}
                      fontFamily={el.fontFamily || 'Arial'}
                      fontSize={fitted.fontSize}
                      fontStyle={fontStyle}
                      fill={el.fill || '#000000'}
                      {...gradientFillProps(el.fillGradient, boxWidth, el.height)}
                      align={el.align || 'left'}
                      letterSpacing={el.letterSpacing || 0}
                      shadowColor={shadow?.color}
                      shadowBlur={shadow?.blur}
                      shadowOffsetX={shadow?.offsetX}
                      shadowOffsetY={shadow?.offsetY}
                      shadowEnabled={!!shadow}
                      stroke={outline?.color}
                      strokeWidth={outline?.width}
                      strokeScaleEnabled={false}
                      fillAfterStrokeEnabled={!!outline}
                    />
                  ))}
                </Group>
              );
            }

            return (
              <KonvaText
                key={el.id}
                {...commonProps}
                scaleX={scaleX}
                width={el.width / scaleX}
                // Text was the only type that ignored `fillGradient`, though
                // shape and path have honoured it all along. Built in the
                // node's own (unscaled) space, so the ramp condenses with the
                // glyphs — the same rule the server's squeeze buffer follows.
                {...gradientFillProps(el.fillGradient, el.width / scaleX, el.height)}
                // Transformed before the node sees it, because case changes the
                // width of every word and Konva wraps on what it is given.
                text={applyTextTransform(el.text || '', el.textTransform)}
                fontFamily={el.fontFamily || 'Arial'}
                // Shrink-to-fit through the same helper the exporter uses, so
                // the glyphs stay inside el.width × el.height — which is the
                // box the Transformer draws. Without this the text overflows
                // its own selection box and the canvas disagrees with the PNG.
                fontSize={fittedFontSize(el)}
                fontStyle={fontStyle}
                fill={el.fill || '#000000'}
                align={el.align || 'left'}
                verticalAlign={el.verticalAlign || 'top'}
                wrap="word"
                lineHeight={el.lineHeight || 1.2}
                letterSpacing={el.letterSpacing || 0}
                shadowColor={shadow?.color}
                shadowBlur={shadow?.blur}
                shadowOffsetX={shadow?.offsetX}
                shadowOffsetY={shadow?.offsetY}
                shadowEnabled={!!shadow}
                stroke={outline?.color}
                strokeWidth={outline?.width}
                // A scaled node scales its stroke too; the server's outline is
                // in page units, so pin it or the two disagree.
                strokeScaleEnabled={false}
                fillAfterStrokeEnabled={!!outline}
              />
            );
          }

          case 'image':
            return <ImageNode key={el.id} element={el} onSelect={onSelect} onContextMenu={onContextMenu} interactive={interactive} />;

          case 'shape': {
            const grad = gradientFillProps(el.fillGradient, el.width, el.height);
            const hasGrad = !!el.fillGradient;

            // A warped shape has no primitive left to draw — every shape kind
            // resamples to one polyline. The unwarped path below is untouched,
            // so nothing that isn't warped moves a pixel.
            const warped = warpedOutline(el);
            if (warped) {
              return (
                <Line
                  key={el.id}
                  {...commonProps}
                  points={flattenPoints(warped)}
                  closed={el.shape !== 'line'}
                  fill={hasGrad ? undefined : el.fill || '#2B5CD3'}
                  {...grad}
                  stroke={el.stroke}
                  strokeWidth={el.strokeWidth}
                />
              );
            }

            switch (el.shape) {
              case 'ellipse':
                return (
                  <Ellipse
                    key={el.id}
                    {...commonProps}
                    // Konva's Ellipse is centre-origin, but every OTHER element
                    // rotates about its top-left — so the pivot stays at el.x/y
                    // and a negative offset pushes the ellipse into its box.
                    // Positioning it at the centre instead made it the one shape
                    // that rotated differently from the rest, and put its
                    // gradient half a box out of place.
                    offsetX={-el.width / 2}
                    offsetY={-el.height / 2}
                    radiusX={el.width / 2}
                    radiusY={el.height / 2}
                    fill={hasGrad ? undefined : el.fill || '#2B5CD3'}
                    {...gradientFillProps(
                      el.fillGradient,
                      el.width,
                      el.height,
                      // Node-local coordinates run from the ellipse's centre.
                      { x: -el.width / 2, y: -el.height / 2 }
                    )}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                  />
                );
              case 'line':
                return (
                  <React.Fragment key={el.id}>
                    <Line
                      {...commonProps}
                      x={el.x}
                      y={el.y}
                      points={[0, 0, el.width, el.height]}
                      stroke={el.stroke || '#000000'}
                      strokeWidth={el.strokeWidth || 2}
                      fill={el.fill}
                    />
                    <ArrowHeads
                      element={el}
                      points={[
                        { x: 0, y: 0 },
                        { x: el.width, y: el.height },
                      ]}
                    />
                  </React.Fragment>
                );
              case 'star':
              case 'triangle':
              case 'polygon': {
                // Drawn as an explicit point list rather than Konva's Star /
                // RegularPolygon, which take a single scalar radius and would
                // ignore el.height — a star in a wide box has to stretch with
                // it. The generator is shared with the server renderer.
                const pts = pointsForShape(
                  el.shape,
                  el.width,
                  el.height,
                  el.sides,
                  el.innerRatio
                );
                return (
                  <Line
                    key={el.id}
                    {...commonProps}
                    points={flattenPoints(pts || [])}
                    closed={true}
                    fill={hasGrad ? undefined : el.fill || '#2B5CD3'}
                    {...grad}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                  />
                );
              }
              default:
                return (
                  <Rect
                    key={el.id}
                    {...commonProps}
                    fill={hasGrad ? undefined : el.fill || '#2B5CD3'}
                    {...grad}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                    cornerRadius={el.borderRadius || 0}
                  />
                );
            }
          }

          case 'path': {
            const grad = gradientFillProps(el.fillGradient, el.width, el.height);
            const hasGrad = !!el.fillGradient;
            // Warping flattens the beziers to the polyline the deformation was
            // evaluated on; an unwarped path still traces its real curve.
            const warpedPath = warpedOutline(el);
            return (
              <React.Fragment key={el.id}>
                <Shape
                  {...commonProps}
                  // Traced through the shared helper the server uses, so the
                  // exported curve matches the one on screen.
                  sceneFunc={(ctx, shape) => {
                    if (warpedPath) {
                      ctx.beginPath();
                      warpedPath.forEach((p, i) =>
                        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
                      );
                      if (el.closed) ctx.closePath();
                    } else {
                      tracePathNodes(ctx as never, el.nodes || [], !!el.closed);
                    }
                    // Only a closed path is fillable; filling an open one would
                    // paint its implicit closing chord.
                    if (el.closed) ctx.fillStrokeShape(shape);
                    else ctx.strokeShape(shape);
                  }}
                  fill={hasGrad ? undefined : el.fill}
                  {...grad}
                  // No fallback colour: the server draws nothing when `stroke`
                  // is unset, so inventing black here would make the canvas
                  // disagree with the export. Creation always sets one.
                  stroke={el.stroke}
                  strokeWidth={el.strokeWidth ?? 2}
                  hitStrokeWidth={Math.max(12, (el.strokeWidth ?? 2) + 8)}
                />
                {/* The server draws arrowheads on paths too — without this the
                    editor and the export disagree. */}
                <ArrowHeads element={el} points={el.nodes || []} />
              </React.Fragment>
            );
          }

          case 'fill': {
            const style = el.fillStyle;
            if (!style) return null;
            const grad =
              style.type === 'gradient' && style.gradient
                ? gradientFillProps(style.gradient, el.width, el.height)
                : {};
            return (
              <Rect
                key={el.id}
                {...commonProps}
                fill={
                  style.type === 'solid'
                    ? style.color || '#000000'
                    : style.type === 'pattern'
                      ? undefined
                      : undefined
                }
                {...grad}
                {...(style.type === 'pattern' && style.pattern
                  ? patternFillProps(style.pattern)
                  : {})}
              />
            );
          }

          // A raster layer is just a bitmap; it renders through the image node
          // so crop/filters/opacity all keep working on painted content.
          case 'raster':
          case 'icon':
            return el.type === 'raster' ? (
              <ImageNode key={el.id} element={el} onSelect={onSelect} onContextMenu={onContextMenu} interactive={interactive} />
            ) : (
              <IconNode key={el.id} element={el} onSelect={onSelect} onContextMenu={onContextMenu} interactive={interactive} />
            );

          default:
            return null;
        }
  };

  /**
   * Render one scope of the layer tree.
   *
   * An adjustment layer transforms everything ALREADY accumulated in its scope,
   * so the accumulated nodes get folded into an `AdjustmentScope` when one is
   * reached — matching Photoshop, and matching what the server does by reading
   * back the canvas at the same point. A clipped adjustment folds in only the
   * single layer directly beneath it.
   */
  const renderNodes = (nodes: LayerNode[], seed: ReactNode[] = []): ReactNode[] =>
    nodes.reduce<ReactNode[]>((acc, node) => {
      const el = node.element;
      if (el.hidden) return acc;

      if (el.type === 'group') {
        return [
          ...acc,
          <LayerGroup key={el.id} element={el} cacheKey={node.children.length}>
            {renderNodes(node.children)}
          </LayerGroup>,
        ];
      }

      if (el.type === 'adjustment') {
        if (!el.adjustment || !acc.length) return acc;
        // Clipped: only the layer directly beneath. Otherwise: everything
        // accumulated in this scope so far.
        const scoped = el.clipped ? acc.slice(-1) : acc;
        const kept = el.clipped ? acc.slice(0, -1) : [];
        return [
          ...kept,
          <AdjustmentScope key={`adj-${el.id}`} adjustment={el.adjustment} cacheKey={backdropKey}>
            {scoped}
          </AdjustmentScope>,
        ];
      }

      return [
        ...acc,
        <MaskedLeaf key={el.id} element={el}>
          <StyledLeaf element={el}>{renderLeaf(el)}</StyledLeaf>
        </MaskedLeaf>,
      ];
    }, seed);

  return <>{renderNodes(tree, backdrop ? [backdrop] : [])}</>;
};
