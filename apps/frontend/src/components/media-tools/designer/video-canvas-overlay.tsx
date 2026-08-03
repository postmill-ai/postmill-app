'use client';

import React, { FC, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Group,
  Image as KonvaImage,
  Text as KonvaText,
  Rect as KonvaRect,
  Ellipse as KonvaEllipse,
  Line as KonvaLine,
} from 'react-konva';
import type Konva from 'konva';
import type { VideoClip, VideoOutput } from './designer.store';
import { composeClipsAtPlayhead, sourceTimeForPlayhead } from './video-preview';
import { clipGeometryUpdate, type ClipBox } from './clip-geometry';
import { getBuffer } from './raster-layers';
import {
  pointsForShape,
  flattenPoints,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';

interface VideoCanvasOverlayProps {
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  width: number;
  height: number;
  /**
   * Clips only take pointer events under the Move tool. Every other tool needs
   * the press for itself — the same rule `CanvasElements` follows for elements.
   */
  interactive?: boolean;
  /** Double-click on a text clip asks the host to open the inline editor. */
  onEditText?: (clipId: string) => void;
}

const videoElements = new Map<string, HTMLVideoElement>();
const imageElements = new Map<string, HTMLImageElement>();
const filterCanvasCache = new Map<string, HTMLCanvasElement>();
const captionCanvasCache = new Map<string, HTMLCanvasElement>();
let canvasIdCounter = 0;
const getNextCanvasId = () => String(++canvasIdCounter);

// Minimal external store used to notify React after an imperative canvas has
// been drawn into. Using useSyncExternalStore avoids calling setState directly
// inside an effect, which the React Compiler rules disallow.
type CanvasStore = {
  subscribe: (cb: () => void) => () => void;
  emit: () => void;
  getVersion: () => number;
};
const canvasStores = new Map<string, CanvasStore>();
const getCanvasStore = (canvasId: string): CanvasStore => {
  let store = canvasStores.get(canvasId);
  if (!store) {
    const listeners = new Set<() => void>();
    let version = 0;
    store = {
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      emit: () => {
        version += 1;
        listeners.forEach((cb) => cb());
      },
      getVersion: () => version,
    };
    canvasStores.set(canvasId, store);
  }
  return store;
};
const deleteCanvasStore = (canvasId: string) => canvasStores.delete(canvasId);

const getOrCreateVideo = (clip: VideoClip): HTMLVideoElement | null => {
  if (!clip.src) return null;
  if (videoElements.has(clip.id)) {
    return videoElements.get(clip.id)!;
  }
  const el = document.createElement('video');
  el.src = clip.src;
  el.crossOrigin = 'anonymous';
  el.muted = true;
  el.playsInline = true;
  el.style.position = 'fixed';
  el.style.left = '-10000px';
  el.style.top = '0';
  document.body.appendChild(el);
  videoElements.set(clip.id, el);
  return el;
};

const getOrCreateImage = (src?: string): HTMLImageElement | null => {
  if (!src) return null;
  const cached = imageElements.get(src);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  imageElements.set(src, img);
  return img;
};

// Drop the hidden <video> DOM nodes for clips no longer present (evict on clip
// removal), so the module map doesn't append to document.body forever.
const evictOverlayVideos = (liveClipIds: Set<string>) => {
  videoElements.forEach((el, id) => {
    if (!liveClipIds.has(id)) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      videoElements.delete(id);
    }
  });
};

// Full teardown on overlay unmount (mode switch / designer close).
const clearOverlayMedia = () => {
  videoElements.forEach((el) => {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.remove();
  });
  videoElements.clear();
  imageElements.clear();
};

const seekVideo = (clip: VideoClip, playheadMs: number) => {
  const el = getOrCreateVideo(clip);
  if (!el) return;
  const sourceTime = sourceTimeForPlayhead(clip, playheadMs);
  if (sourceTime === null) return;
  const t = sourceTime / 1000;
  if (Number.isFinite(t) && Math.abs(el.currentTime - t) > 0.05) {
    el.currentTime = t;
  }
};

function mapFiltersToCss(filters?: string[]): string | undefined {
  if (!filters?.length) return undefined;
  const parts: string[] = [];
  for (const f of filters) {
    if (f === 'grayscale') parts.push('grayscale(100%)');
    else if (f === 'sepia') parts.push('sepia(100%)');
    else if (f.startsWith('blur:')) parts.push(`blur(${f.slice(5)}px)`);
    else if (f.startsWith('brightness:')) parts.push(`brightness(${f.slice(11)})`);
    else if (f.startsWith('contrast:')) parts.push(`contrast(${f.slice(9)})`);
    else if (f.startsWith('saturate:')) parts.push(`saturate(${f.slice(9)})`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

function getStickerFrameUrl(clip: VideoClip, relativeMs: number): string | undefined {
  const frames = clip.frames;
  if (!frames?.length) return clip.src;
  let loopMs = 0;
  for (const f of frames) loopMs += f.durationMs;
  if (loopMs <= 0) return frames[0].url;
  const t = relativeMs % loopMs;
  let acc = 0;
  for (const f of frames) {
    acc += f.durationMs;
    if (t < acc) return f.url;
  }
  return frames[frames.length - 1].url;
}

interface FilteredClipImageProps {
  clip: VideoClip;
  width: number;
  height: number;
  tick: number;
  playheadMs: number;
}

const FilteredClipImage: FC<FilteredClipImageProps> = ({ clip, width, height, tick, playheadMs }) => {
  const [canvasId] = useState(() => getNextCanvasId());
  const canvas = filterCanvasCache.get(canvasId) ?? null;
  const store = useMemo(() => getCanvasStore(canvasId), [canvasId]);
  const imageVersion = useSyncExternalStore(
    store.subscribe,
    store.getVersion
  );

  // A painted clip draws from its live paint buffer while the stroke is in
  // progress: `src` only catches up on commit, so drawing from it would lag a
  // whole stroke behind the cursor (same rule as raster ELEMENTS).
  const liveBuffer = getBuffer(clip.id);
  const isVideoClip = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(clip.src || '') && !clip.frames;
  const isSticker = !!clip.frames;
  const relativeMs = Math.max(0, playheadMs - clip.startMs);
  const stickerFrameUrl = isSticker ? getStickerFrameUrl(clip, relativeMs) : undefined;
  const source = liveBuffer
    ? (liveBuffer as unknown as HTMLImageElement)
    : isVideoClip
      ? getOrCreateVideo(clip)
      : getOrCreateImage(stickerFrameUrl ?? clip.src);
  const filterString = useMemo(() => mapFiltersToCss(clip.filters), [clip.filters]);

  useEffect(() => {
    if (!source || !filterString) return;
    let c = filterCanvasCache.get(canvasId);
    if (!c) {
      c = document.createElement('canvas');
      filterCanvasCache.set(canvasId, c);
    }
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));

    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, c.width, c.height);
    ctx.filter = filterString;
    const cr = clip.crop;
    if (cr) {
      ctx.drawImage(
        source,
        Math.max(0, cr.x),
        Math.max(0, cr.y),
        Math.max(1, cr.width),
        Math.max(1, cr.height),
        0,
        0,
        c.width,
        c.height
      );
    } else {
      ctx.drawImage(source, 0, 0, c.width, c.height);
    }
    ctx.filter = 'none';
    store.emit();
  }, [source, filterString, width, height, tick, canvasId, store, clip.crop]);

  useEffect(() => {
    return () => {
      filterCanvasCache.delete(canvasId);
      deleteCanvasStore(canvasId);
    };
  }, [canvasId]);

  if (!source) return null;
  if (!filterString) {
    return (
      <KonvaImage
        image={source}
        width={width}
        height={height}
        // Konva's crop is in source pixels, the same space the schema and the
        // frame renderer use — so the Crop tool's numbers mean one thing.
        crop={
          clip.crop
            ? {
                x: Math.max(0, clip.crop.x),
                y: Math.max(0, clip.crop.y),
                width: Math.max(1, clip.crop.width),
                height: Math.max(1, clip.crop.height),
              }
            : undefined
        }
        listening={false}
      />
    );
  }

  return (
    <KonvaImage
      image={canvas || undefined}
      width={width}
      height={height}
      listening={false}
      key={imageVersion}
    />
  );
};

// Module-scoped so it is a stable component type — declaring it inside the parent
// created a brand-new type every render, remounting it and re-rasterizing the
// caption text on every tick.
const CaptionClip: FC<{ clip: VideoClip; width: number; height: number; playheadMs: number }> = ({
  clip,
  width,
  height,
  playheadMs,
}) => {
  // Canvas is held in a module-level cache because Konva reads it imperatively
  // and the 2D context is mutated during rendering; keeping it out of hook state
  // avoids React Compiler immutability-rule violations.
  const [canvasId] = useState(() => getNextCanvasId());
  const canvas = captionCanvasCache.get(canvasId) ?? null;
  const store = useMemo(() => getCanvasStore(canvasId), [canvasId]);
  const imageVersion = useSyncExternalStore(
    store.subscribe,
    store.getVersion
  );
  const relativeMs = Math.max(0, playheadMs - clip.startMs);
  const words = useMemo(() => clip.words || [], [clip.words]);
  const activeIndex = words.findIndex((w) => relativeMs >= w.startMs && relativeMs <= w.endMs);

  // A stable key drives re-renders when the caption content changes; imageVersion
  // additionally re-renders Konva after the canvas has been drawn into.
  const renderKey = useMemo(
    () => `${clip.id}-${width}-${height}-${activeIndex}-${imageVersion}`,
    [clip.id, width, height, activeIndex, imageVersion]
  );

  useEffect(() => {
    let c = captionCanvasCache.get(canvasId);
    if (!c) {
      c = document.createElement('canvas');
      captionCanvasCache.set(canvasId, c);
    }
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));

    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    const fontSize = clip.fontSize || 28;
    const fontWeight = clip.fontWeight || 700;
    const fontFamily = clip.fontFamily || 'Arial';
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    const lineHeight = fontSize * 1.35;
    const spaceWidth = ctx.measureText(' ').width;
    let x = 0;
    let y = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wordWidth = ctx.measureText(w.word).width;
      if (x + wordWidth > width && x > 0) {
        x = 0;
        y += lineHeight;
      }
      ctx.fillStyle = i === activeIndex ? '#facc15' : (clip.fill || '#ffffff');
      ctx.fillText(w.word, x, y);
      x += wordWidth + spaceWidth;
    }
    store.emit();
  }, [clip, words, width, height, activeIndex, canvasId, store]);

  useEffect(() => {
    return () => {
      captionCanvasCache.delete(canvasId);
      deleteCanvasStore(canvasId);
    };
  }, [canvasId]);

  return (
    <KonvaImage
      image={canvas || undefined}
      width={width}
      height={height}
      listening={false}
      key={renderKey}
    />
  );
};

export const VideoCanvasOverlay: FC<VideoCanvasOverlayProps> = ({
  store,
  width,
  height,
  interactive = false,
  onEditText,
}) => {
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  const playheadMs = store((s) => s.playheadMs);
  const [tick, setTick] = useState(0);

  const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
  const isVideo = doc.mode === 'video' && !!vo;

  const clipsAtPlayhead = useMemo(() => {
    if (!isVideo || !vo) return [];
    return composeClipsAtPlayhead(vo, playheadMs);
  }, [isVideo, vo, playheadMs]);

  // Preload image sources for image clips.
  useEffect(() => {
    for (const { clip, trackType } of clipsAtPlayhead) {
      if ((trackType === 'image' || trackType === 'sticker') && clip.src) {
        getOrCreateImage(clip.src);
      }
    }
  }, [clipsAtPlayhead]);

  // A continuous redraw is only needed when dynamic content (a video/sticker or a
  // CSS-filtered clip) sits under the playhead; text/image/caption/empty regions
  // repaint from the playheadMs subscription, so the 60fps loop stays off then.
  const needsRaf = useMemo(
    () =>
      isVideo &&
      clipsAtPlayhead.some(
        ({ clip, trackType }) =>
          trackType === 'video' ||
          trackType === 'sticker' ||
          (clip.filters?.length ?? 0) > 0
      ),
    [isVideo, clipsAtPlayhead]
  );

  // Keep redrawing so the video frame updates while playing.
  useEffect(() => {
    if (!needsRaf) return;
    let raf: number;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [needsRaf, playheadMs]);

  // Seek/pause video elements so the held frame is rendered when paused.
  useEffect(() => {
    if (!isVideo) return;
    for (const { clip, trackType } of clipsAtPlayhead) {
      // Include speed:0 (freeze) clips: sourceTimeForPlayhead resolves them to a
      // constant frame, so seeking shows the held frame instead of frame 0.
      if ((trackType === 'video' || trackType === 'sticker') && clip.src) {
        seekVideo(clip, playheadMs);
      }
    }
  }, [isVideo, clipsAtPlayhead, playheadMs]);

  // Evict hidden <video> nodes for clips that no longer exist in the output.
  useEffect(() => {
    if (!vo) return;
    const liveIds = new Set<string>();
    for (const track of vo.tracks) {
      for (const clip of track.clips) liveIds.add(clip.id);
    }
    evictOverlayVideos(liveIds);
  }, [vo]);

  // Full teardown of the module-level media maps on unmount.
  useEffect(() => {
    return () => clearOverlayMedia();
  }, []);

  const selectClip = (trackId: string, clipId: string) => {
    store.getState().setSelectedClip({ outputIndex: currentOutput, trackId, clipId });
  };

  /**
   * Fold a finished drag/transform back into the clip.
   *
   * Konva reports a resize as a SCALE, so it is baked into width/height here and
   * the node's scale reset — exactly what `bakeTransform` does for elements, and
   * for the same reason: a persisted scale would compound on the next gesture.
   */
  const commitGeometry = (
    trackId: string,
    clip: VideoClip,
    before: ClipBox,
    node: Konva.Node
  ) => {
    const after: ClipBox = {
      x: node.x(),
      y: node.y(),
      width: Math.max(1, before.width * node.scaleX()),
      height: Math.max(1, before.height * node.scaleY()),
      rotation: node.rotation(),
    };
    node.scaleX(1);
    node.scaleY(1);

    const update = clipGeometryUpdate(clip, before, after, playheadMs);
    if (!update) return;
    store.getState().updateClip(currentOutput, trackId, clip.id, update);
  };

  if (!isVideo) return null;

  return (
    <>
      {clipsAtPlayhead.map(({ clip, trackId, trackType, props }) => {
        // Selection/drag wiring, identical for every clip type.
        const box: ClipBox = {
          x: props.x,
          y: props.y,
          width: props.width,
          height: props.height,
          rotation: props.rotation,
        };
        const nodeProps = {
          id: clip.id,
          name: 'video-clip',
          listening: interactive,
          draggable: interactive,
          onClick: () => selectClip(trackId, clip.id),
          onTap: () => selectClip(trackId, clip.id),
          onDragStart: () => selectClip(trackId, clip.id),
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
            commitGeometry(trackId, clip, box, e.target),
          onTransformEnd: (e: Konva.KonvaEventObject<Event>) =>
            commitGeometry(trackId, clip, box, e.target),
          ...(trackType === 'text' && onEditText
            ? {
                onDblClick: () => onEditText(clip.id),
                onDblTap: () => onEditText(clip.id),
              }
            : {}),
        };

        if (trackType === 'caption') {
          return (
            <Group
              key={clip.id}
              {...nodeProps}
              x={props.x}
              y={props.y}
              width={props.width}
              height={props.height}
              rotation={props.rotation}
              opacity={props.opacity}
            >
              <CaptionClip
                clip={clip}
                width={props.width}
                height={props.height}
                playheadMs={playheadMs}
              />
            </Group>
          );
        }

        if (trackType === 'shape') {
          const common = {
            fill: clip.fill || '#2B5CD3',
            stroke: clip.stroke,
            strokeWidth: clip.strokeWidth || (clip.stroke ? 1 : 0),
          };
          const points = pointsForShape(
            clip.shape,
            props.width,
            props.height,
            clip.sides,
            clip.innerRatio
          );
          return (
            <Group
              key={clip.id}
              {...nodeProps}
              x={props.x}
              y={props.y}
              width={props.width}
              height={props.height}
              rotation={props.rotation}
              opacity={props.opacity}
            >
              {points ? (
                <KonvaLine points={flattenPoints(points)} closed {...common} />
              ) : clip.shape === 'ellipse' ? (
                <KonvaEllipse
                  x={props.width / 2}
                  y={props.height / 2}
                  radiusX={props.width / 2}
                  radiusY={props.height / 2}
                  {...common}
                />
              ) : clip.shape === 'line' ? (
                <KonvaLine
                  points={[0, props.height / 2, props.width, props.height / 2]}
                  stroke={clip.stroke || clip.fill || '#2B5CD3'}
                  strokeWidth={clip.strokeWidth || 2}
                />
              ) : (
                <KonvaRect
                  width={props.width}
                  height={props.height}
                  cornerRadius={clip.borderRadius || 0}
                  {...common}
                />
              )}
            </Group>
          );
        }

        if (trackType === 'text') {
          return (
            <KonvaText
              key={clip.id}
              {...nodeProps}
              x={props.x}
              y={props.y}
              width={props.width}
              height={props.height}
              text={clip.text || ''}
              fontFamily={clip.fontFamily || 'Arial'}
              fontSize={clip.fontSize || 16}
              fontStyle={`${clip.fontWeight && clip.fontWeight >= 600 ? 'bold' : 'normal'}`}
              fill={clip.fill || '#000000'}
              rotation={props.rotation}
              opacity={props.opacity}
            />
          );
        }

        return (
          <Group
            key={clip.id}
            {...nodeProps}
            x={props.x}
            y={props.y}
            width={props.width}
            height={props.height}
            rotation={props.rotation}
            opacity={props.opacity}
          >
            <FilteredClipImage
              clip={clip}
              width={props.width}
              height={props.height}
              tick={tick}
              playheadMs={playheadMs}
            />
          </Group>
        );
      })}
    </>
  );
};

export default VideoCanvasOverlay;
