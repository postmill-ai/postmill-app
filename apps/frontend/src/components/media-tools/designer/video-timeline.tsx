'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoClip, VideoTrack, VideoOutput, DesignerElement, ClipTransition } from './designer.store';
import { MAX_TRACKS } from './designer.store';
import { VideoPreviewEngine } from './video-preview';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useModals, usePromptModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { useMediaToolsStatus } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { VoiceoverDialog } from './voiceover-dialog';
import { VoiceoverRecordDialog } from './voiceover-record-dialog';
import { SegmentRegenerateDialog } from './segment-regenerate-dialog';
import {
  defaultSegmentWindow,
  findMiddleClipId,
  isWholeClipWindow,
  planSegmentSplits,
  segmentSourceTrim,
  type SegmentWindow,
} from './segment-regenerate';
import { Stepper } from './controls';
import { addMediaToTimeline, addVoiceoverToTimeline, probeAudioDuration, probeVideoMetadata, pollMediaJobArtifact, JOB_MAX_POLLS, JOB_POLL_INTERVAL_MS, type JobPollOutcome } from './add-media-to-timeline';
import { postTextToSpeech } from './text-to-speech';
import { readErrorMessage } from './read-error-message';
import { clipEdgeUpdate, planTrackDrop, resolveClipPlacement } from './clip-geometry';
import { isMarqueeClick, marqueeHitClips, normalizeMarquee, type MarqueeRect } from './timeline-marquee';
import { directFetchForAbsoluteUrls, type WaveformFetch } from './waveform-fetch';
import { KeyframeLane } from './keyframe-lane';
import { timelineBeats } from './beat-sync';
import { isArtifactPath } from '@postmill-ai/frontend/components/launches/ai.video';
import { FullscreenButton } from '@postmill-ai/frontend/components/media-tools/fullscreen-button';
import { MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { aspectBucketForDimensions } from '@postmill-ai/nestjs-libraries/media/slide/slide-aspect';
import { closestAspectRatio } from '@postmill-ai/frontend/components/media-tools/replicate/aspect-ratio';
import {
  sourceTimeForClipTime,
  splitSpeedCurveForClip,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import {
  GenerationProviderPicker,
  useGenerationProviderChoice,
} from '@postmill-ai/frontend/components/media-tools/designer/panels/generation-provider-picker';
import {
  CompactStudio,
  type CompactStudioResult,
} from '@postmill-ai/frontend/components/media-tools/studio-kit/compact-studio';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { genId } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import {
  captionClipDefaults,
  cuesToCaptionClips,
  mapTranscriptionToCaptionPhrases,
  parseSubtitles,
  serializeSrt,
  withCaptionClips,
  type TranscribedWord,
} from './captions';

interface VideoTimelineProps {
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  sendTimelineAwareness?: (playheadMs: number, selectedClipId: string | null) => void;
}

const TRACK_HEIGHT = 36;
const TRACK_GAP = 4;
const RULER_HEIGHT = 22;
const LABEL_WIDTH = 64;
const MS_PER_PIXEL_DEFAULT = 4;
const SNAP_THRESHOLD_MS = 80;
const TRANSITION_MIN_MS = 100;
const TRANSITION_MAX_MS = 2000;
const TRANSITION_DEFAULT_MS = 500;

const TRACK_COLORS: Record<VideoTrack['type'], string> = {
  video: '#4F46E5',
  image: '#059669',
  text: '#D97706',
  shape: '#2B5CD3',
  raster: '#9333EA',
  caption: '#22C55E',
  audio: '#DC2626',
  sticker: '#9333EA',
};

const formatTime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const millis = Math.floor((ms % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;
};

// Trim clamps need the SOURCE duration, which a clip does not store (the doc
// schema stays untouched) — probe it lazily per src, exactly as a media drop
// does, and cache it. Returns undefined until the probe lands; the end-edge
// clamp only applies once the duration is known.
// Bounded LRU (insertion order doubles as recency: hits re-insert, overflow
// evicts the oldest entry) — same discipline as the peaks and filmstrip caches
// below, so a long-lived session doesn't accumulate one entry per probed src.
const SOURCE_DURATION_CACHE_MAX = 50;
const sourceDurationCache = new Map<string, number>();
const sourceDurationInflight = new Set<string>();
const getSourceDurationMs = (
  src: string,
  kind: 'video' | 'audio'
): number | undefined => {
  const cached = sourceDurationCache.get(src);
  if (cached !== undefined) {
    sourceDurationCache.delete(src);
    sourceDurationCache.set(src, cached);
    return cached;
  }
  if (!sourceDurationInflight.has(src)) {
    sourceDurationInflight.add(src);
    const probe =
      kind === 'audio'
        ? probeAudioDuration(src)
        : probeVideoMetadata(src).then((r) => r.durationMs);
    probe.then((ms) => {
      sourceDurationCache.set(src, ms);
      if (sourceDurationCache.size > SOURCE_DURATION_CACHE_MAX) {
        const oldest = sourceDurationCache.keys().next().value;
        if (oldest !== undefined) sourceDurationCache.delete(oldest);
      }
      sourceDurationInflight.delete(src);
    });
  }
  return undefined;
};

const audioContextSingleton =
  typeof window !== 'undefined'
    ? new (window.AudioContext || (window as any).webkitAudioContext)()
    : null;

// Decode each audio source ONCE into a fixed high-resolution peak array, keyed by
// src only (never by bar count). Trimming/zooming changes bar count continuously,
// so keying by count re-fetched + re-`decodeAudioData`'d the whole file on almost
// every mousemove. Bars are resampled from the cached peaks in memory instead.
const HIRES_BUCKETS = 2048;
// One 2048-bucket array per audio src — bounded LRU so a long-lived tab
// doesn't accumulate one per source ever decoded. Insertion order doubles as
// recency: hits re-insert, overflow evicts the oldest entry.
const PEAKS_CACHE_MAX = 50;
const peaksCache = new Map<string, number[]>();
const peaksInflight = new Map<string, Promise<number[]>>();

async function getPeaks(src: string, fetchFn: WaveformFetch): Promise<number[]> {
  const cached = peaksCache.get(src);
  if (cached) {
    peaksCache.delete(src);
    peaksCache.set(src, cached);
    return cached;
  }
  const inflight = peaksInflight.get(src);
  if (inflight) return inflight;

  const p = (async () => {
    const peaks = new Array(HIRES_BUCKETS).fill(0.1);
    try {
      const res = await fetchFn(src);
      if (!res.ok) throw new Error('fetch failed');
      const arrayBuffer = await res.arrayBuffer();
      const ctx = audioContextSingleton;
      if (!ctx) throw new Error('no audio context');
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const channel = audioBuffer.getChannelData(0);
      const step = Math.max(1, Math.floor(channel.length / HIRES_BUCKETS));
      let max = 0;
      for (let i = 0; i < HIRES_BUCKETS; i++) {
        let peak = 0;
        const start = i * step;
        const end = Math.min(start + step, channel.length);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > peak) peak = v;
        }
        peaks[i] = peak;
        if (peak > max) max = peak;
      }
      if (max > 0) {
        for (let i = 0; i < HIRES_BUCKETS; i++) peaks[i] /= max;
      }
    } catch {
      peaks.fill(0.1);
    }
    peaksCache.set(src, peaks);
    if (peaksCache.size > PEAKS_CACHE_MAX) {
      const oldest = peaksCache.keys().next().value;
      if (oldest !== undefined) peaksCache.delete(oldest);
    }
    peaksInflight.delete(src);
    return peaks;
  })();

  peaksInflight.set(src, p);
  return p;
}

function resamplePeaks(peaks: number[], barCount: number): number[] {
  if (barCount <= 0) return [];
  const out = new Array(barCount).fill(0.1);
  const ratio = peaks.length / barCount;
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let peak = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > peak) peak = peaks[j];
    }
    out[i] = peak;
  }
  return out;
}

function useWaveform(
  src: string | undefined,
  barCount: number,
  fetchFn: WaveformFetch
): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!src) {
      return;
    }
    let cancelled = false;
    getPeaks(src, fetchFn).then((p) => {
      if (!cancelled) setPeaks(p);
    });
    return () => {
      cancelled = true;
    };
  }, [src, fetchFn]);
  // Resample the cached high-res peaks to the current bar count in memory — no
  // re-fetch, no re-decode. Guard against a missing src so stale peaks from a
  // previous clip are not rendered while the component is still mounted.
  return useMemo(() => (!src || !peaks ? null : resamplePeaks(peaks, barCount)), [src, peaks, barCount]);
}

const WaveformBars = React.memo(function WaveformBars({ src, width }: { src: string | undefined; width: number }) {
  const fetch = useFetch();
  const barCount = Math.max(6, Math.floor(width / 6));
  // Clip srcs are absolute URLs; useFetch would prefix the backend baseUrl onto
  // them (CSP-blocked, no waveform) — see waveform-fetch.ts.
  const waveformFetch = useMemo(() => directFetchForAbsoluteUrls(fetch), [fetch]);
  const bars = useWaveform(src, barCount, waveformFetch);
  if (!bars) {
    return (
      <>
        {Array.from({ length: barCount }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-white/70 rounded-xs"
            style={{ height: `${20 + ((i * 7) % 80)}%` }}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-white/70 rounded-xs"
          style={{ height: `${Math.max(4, h * 100)}%` }}
        />
      ))}
    </>
  );
});

// Filmstrip thumbnails for video clips — a horizontal strip of frames captured
// from a hidden <video>, cached per src OUTSIDE React (same discipline as the
// peaks cache above), so ClipRow's memoization never re-captures and a re-render
// only reads the finished dataURL. `null` is the failure sentinel (CORS-tainted
// or unloadable source): cached too, so a bad source is never retried per mount.
const FILMSTRIP_THUMBS = 6;
const FILMSTRIP_HEIGHT = 24;
const FILMSTRIP_CACHE_MAX = 50;
const filmstripCache = new Map<string, string | null>();
const filmstripInflight = new Map<string, Promise<string | null>>();

async function captureFilmstrip(src: string): Promise<string | null> {
  if (filmstripCache.has(src)) {
    const hit = filmstripCache.get(src)!;
    filmstripCache.delete(src);
    filmstripCache.set(src, hit);
    return hit;
  }
  const inflight = filmstripInflight.get(src);
  if (inflight) return inflight;

  const p = (async (): Promise<string | null> => {
    const video = document.createElement('video');
    try {
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('filmstrip: video load failed'));
        setTimeout(() => reject(new Error('filmstrip: load timeout')), 10000);
      });
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const aspect = vw > 0 && vh > 0 ? vw / vh : 16 / 9;
      const thumbW = Math.max(8, Math.round(FILMSTRIP_HEIGHT * aspect));
      const canvas = document.createElement('canvas');
      canvas.width = thumbW * FILMSTRIP_THUMBS;
      canvas.height = FILMSTRIP_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('filmstrip: no 2d context');
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      for (let i = 0; i < FILMSTRIP_THUMBS; i++) {
        const t = duration > 0 ? Math.max(0, Math.min(duration - 0.05, (duration * (i + 0.5)) / FILMSTRIP_THUMBS)) : 0;
        if (t > 0) {
          video.currentTime = t;
          await new Promise<void>((resolve) => {
            video.onseeked = () => resolve();
            setTimeout(resolve, 2000);
          });
        }
        // Cover-crop each frame into its cell (same rule as fitMode 'cover').
        const scale = Math.max(thumbW / Math.max(1, vw), FILMSTRIP_HEIGHT / Math.max(1, vh));
        const sw = thumbW / scale;
        const sh = FILMSTRIP_HEIGHT / scale;
        ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, i * thumbW, 0, thumbW, FILMSTRIP_HEIGHT);
      }
      // toDataURL throws on a CORS-tainted canvas — the catch below records
      // the failure sentinel and the clip keeps its flat color bar.
      const url = canvas.toDataURL('image/jpeg', 0.6);
      filmstripCache.set(src, url);
      if (filmstripCache.size > FILMSTRIP_CACHE_MAX) {
        const oldest = filmstripCache.keys().next().value;
        if (oldest !== undefined) filmstripCache.delete(oldest);
      }
      return url;
    } catch {
      filmstripCache.set(src, null);
      return null;
    } finally {
      video.removeAttribute('src');
      video.load();
      filmstripInflight.delete(src);
    }
  })();

  filmstripInflight.set(src, p);
  return p;
}

const ClipFilmstrip = React.memo(function ClipFilmstrip({ src }: { src: string | undefined }) {
  const [strip, setStrip] = useState<string | null>(() => (src ? filmstripCache.get(src) ?? null : null));
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    captureFilmstrip(src).then((url) => {
      if (!cancelled && url) setStrip(url);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!src || !strip) return null;
  return (
    <div
      className="absolute inset-0 rounded-[4px] opacity-70 pointer-events-none"
      style={{
        backgroundImage: `url(${strip})`,
        backgroundRepeat: 'repeat-x',
        backgroundSize: 'auto 100%',
      }}
    />
  );
});

/** The source file's basename, for the clip label — undefined for data: URLs. */
const clipFileName = (src?: string): string | undefined => {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return undefined;
  const tail = src.split('?')[0].split('/').pop() || '';
  if (!tail) return undefined;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
};

// The playhead ticks per rAF during playback/scrubbing. Its subscribers are
// confined to these small components (and the canvas's video overlay); the
// timeline itself reads the playhead imperatively so a 60fps tick never
// reconciles the whole track tree.

/** Toolbar timecode readout — repaints per playhead tick, by design. */
const PlayheadTimecode: FC<{ store: VideoTimelineProps['store'] }> = ({ store }) => {
  const playheadMs = store((s) => s.playheadMs);
  return (
    <span className="text-[12px] text-textColor font-mono min-w-[70px] tabular-nums">
      {formatTime(playheadMs)}
    </span>
  );
};

/** The red playhead line over the tracks — repaints per playhead tick. */
const PlayheadIndicator: FC<{ store: VideoTimelineProps['store']; pixelsPerMs: number }> = ({
  store,
  pixelsPerMs,
}) => {
  const playheadMs = store((s) => s.playheadMs);
  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none"
      style={{ left: LABEL_WIDTH + playheadMs * pixelsPerMs }}
    >
      <div className="w-0.5 h-full bg-red-500" />
      <div
        className="w-2.5 h-2.5 bg-red-500 rotate-45 -translate-x-1/2 -translate-y-1/2"
        style={{ marginTop: 0 }}
      />
    </div>
  );
};

interface ClipRowProps {
  trackId: string;
  trackType: VideoTrack['type'];
  clip: VideoClip;
  durationMs: number;
  pixelsPerMs: number;
  selected: boolean;
  primary: boolean;
  locked: boolean;
  translate: ReturnType<typeof useT>;
  dragMovedRef: { current: boolean };
  onSelectClip: (trackId: string, clipId: string) => void;
  onClipKeyDown: (e: React.KeyboardEvent, trackId: string, clip: VideoClip) => void;
  onSliderKeyUp: (e: React.KeyboardEvent) => void;
  onClipMouseDown: (
    e: React.MouseEvent,
    trackId: string,
    trackType: VideoTrack['type'],
    clip: VideoClip,
    edge: 'start' | 'end' | 'move'
  ) => void;
  onClipContextMenu: (e: React.MouseEvent, trackId: string, clipId: string) => void;
  onEdgeKeyDown: (
    e: React.KeyboardEvent,
    trackId: string,
    clip: VideoClip,
    edge: 'start' | 'end'
  ) => void;
}

const ClipRow = React.memo(function ClipRow({
  trackId,
  trackType,
  clip,
  durationMs,
  pixelsPerMs,
  selected,
  primary,
  locked,
  translate,
  dragMovedRef,
  onSelectClip,
  onClipKeyDown,
  onSliderKeyUp,
  onClipMouseDown,
  onClipContextMenu,
  onEdgeKeyDown,
}: ClipRowProps) {
  const left = clip.startMs * pixelsPerMs;
  const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
  const width = Math.max(4, (effectiveEnd - clip.startMs) * pixelsPerMs);
  // The source filename identifies the clip in a dense timeline; narrow clips
  // fall back to the emoji + duration label.
  const fileName = clipFileName(clip.src);
  const showFileName =
    !!fileName && width >= 96 &&
    (trackType === 'video' || trackType === 'image' || trackType === 'audio');

  return (
    <div
      role="slider"
      aria-label={translate('clip', 'Clip')}
      aria-orientation="horizontal"
      aria-valuenow={Math.round(clip.startMs)}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs - (clip.endMs - clip.startMs))}
      aria-valuetext={translate('clip_start_time', 'Start {{time}}', { time: formatTime(clip.startMs) })}
      tabIndex={0}
      className={`absolute top-1 rounded-[4px] group ${
        locked ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${
        // The primary (inspector target) keeps the white ring;
        // other selected clips get the accent ring.
        primary ? 'ring-2 ring-white/60 z-10' : selected ? 'ring-2 ring-designerAccent/80 z-10' : ''
      }`}
      style={{
        left,
        width,
        height: TRACK_HEIGHT - 8,
        backgroundColor: TRACK_COLORS[trackType],
        opacity: clip.opacity ?? 0.9,
      }}
      onClick={(e) => {
        e.stopPropagation();
        // The click that ends a real drag must not collapse the
        // multi-selection the drag just moved; shift was handled
        // at mousedown.
        if (dragMovedRef.current) {
          dragMovedRef.current = false;
          return;
        }
        if (e.shiftKey) return;
        onSelectClip(trackId, clip.id);
      }}
      onKeyDown={(e) => onClipKeyDown(e, trackId, clip)}
      onKeyUp={onSliderKeyUp}
      onMouseDown={(e) => onClipMouseDown(e, trackId, trackType, clip, 'move')}
      onContextMenu={(e) => onClipContextMenu(e, trackId, clip.id)}
    >
      {trackType === 'video' && <ClipFilmstrip src={clip.src} />}
      <div
        className="relative text-[9px] text-white/90 px-1.5 truncate leading-[28px] select-none"
        style={showFileName ? { textShadow: '0 1px 2px rgba(0,0,0,0.8)' } : undefined}
      >
        {showFileName ? (
          fileName
        ) : (
          <>
            {trackType === 'video' && '\uD83C\uDFAC'}
            {trackType === 'image' && '\uD83D\uDDBC'}
            {trackType === 'text' && (clip.text?.substring(0, 10) || translate('clip_label_text_fallback', 'T'))}
            {trackType === 'caption' && (clip.text?.substring(0, 10) || translate('clip_label_caption_fallback', 'CC'))}
            {trackType === 'audio' && '\uD83D\uDD0A'}
          </>
        )}
        {clip.speed !== undefined && clip.speed !== 1 && ` ${clip.speed}x`}
        {clip.reverse && ' \u21A9'}
        {clip.freezeAtMs && clip.freezeAtMs > 0 && ' \u2744'}
        {' '}
        {formatTime(effectiveEnd - clip.startMs)}
      </div>
      {trackType === 'audio' && (
        <div className="absolute inset-x-1 bottom-1 flex items-end gap-px h-3 opacity-60">
          <WaveformBars src={clip.src} width={width} />
        </div>
      )}
      {/* Freeze indicator */}
      {clip.freezeAtMs && clip.freezeAtMs > 0 && (
        <div
          className="absolute top-0 bottom-0 border-l-2 border-dashed border-white/40"
          style={{ left: (clip.endMs - clip.startMs) * pixelsPerMs }}
        />
      )}
      {/* Keyframe dots */}
      {clip.keyframes && clip.keyframes.length > 0 && (
        <div className="absolute bottom-0.5 left-0 right-0 flex gap-0.5 px-1 justify-center">
          {clip.keyframes.map((kf, ki) => (
            <div
              key={ki}
              className="w-1.5 h-1.5 rounded-full bg-white/60"
              style={{
                left: `${kf.tMs / (effectiveEnd - clip.startMs) * 100}%`,
              }}
              title={translate('kf_time', 'KF: {{time}}', { time: formatTime(kf.tMs) })}
            />
          ))}
        </div>
      )}
      {/* Drag edges */}
      <div
        role="slider"
        aria-label={translate('trim_clip_start', 'Trim clip start')}
        aria-orientation="horizontal"
        aria-valuenow={Math.round(clip.startMs)}
        aria-valuemin={0}
        aria-valuemax={Math.round(clip.endMs - 100)}
        aria-valuetext={formatTime(clip.startMs)}
        tabIndex={0}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-l-[4px]"
        onMouseDown={(e) => onClipMouseDown(e, trackId, trackType, clip, 'start')}
        onKeyDown={(e) => onEdgeKeyDown(e, trackId, clip, 'start')}
        onKeyUp={onSliderKeyUp}
      />
      <div
        role="slider"
        aria-label={translate('trim_clip_end', 'Trim clip end')}
        aria-orientation="horizontal"
        aria-valuenow={Math.round(clip.endMs)}
        aria-valuemin={Math.round(clip.startMs + 100)}
        aria-valuemax={Math.round(durationMs)}
        aria-valuetext={formatTime(clip.endMs)}
        tabIndex={0}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-r-[4px]"
        onMouseDown={(e) => onClipMouseDown(e, trackId, trackType, clip, 'end')}
        onKeyDown={(e) => onEdgeKeyDown(e, trackId, clip, 'end')}
        onKeyUp={onSliderKeyUp}
      />
    </div>
  );
});

interface TrackRowProps {
  track: VideoTrack;
  /** Disambiguated header label (custom name, or numbered among same-type tracks). */
  label: string;
  pairs: { from: VideoClip; to: VideoClip }[];
  durationMs: number;
  totalPixels: number;
  pixelsPerMs: number;
  dragOver: boolean;
  isSelected: (trackId: string, clipId: string) => boolean;
  isPrimary: (trackId: string, clipId: string) => boolean;
  transitionLabel: (type: string) => string;
  translate: ReturnType<typeof useT>;
  dragMovedRef: { current: boolean };
  onSelectClip: (trackId: string, clipId: string) => void;
  onClipKeyDown: (e: React.KeyboardEvent, trackId: string, clip: VideoClip) => void;
  onSliderKeyUp: (e: React.KeyboardEvent) => void;
  onClipMouseDown: ClipRowProps['onClipMouseDown'];
  onClipContextMenu: (e: React.MouseEvent, trackId: string, clipId: string) => void;
  onEdgeKeyDown: ClipRowProps['onEdgeKeyDown'];
  onToggleLock: (trackId: string) => void;
  onToggleHidden: (trackId: string) => void;
  setTrackSettings: React.Dispatch<
    React.SetStateAction<{ trackId: string; x: number; y: number } | null>
  >;
  setTransitionPopover: React.Dispatch<
    React.SetStateAction<{
      trackId: string;
      fromClipId: string;
      toClipId: string;
      x: number;
      y: number;
    } | null>
  >;
}

const TrackRow = React.memo(function TrackRow({
  track,
  label,
  pairs,
  durationMs,
  totalPixels,
  pixelsPerMs,
  dragOver,
  isSelected,
  isPrimary,
  transitionLabel,
  translate,
  dragMovedRef,
  onSelectClip,
  onClipKeyDown,
  onSliderKeyUp,
  onClipMouseDown,
  onClipContextMenu,
  onEdgeKeyDown,
  onToggleLock,
  onToggleHidden,
  setTrackSettings,
  setTransitionPopover,
}: TrackRowProps) {
  return (
    <div
      className={`flex items-stretch border-b border-studioBorder/20 transition-colors ${
        dragOver ? 'bg-designerAccent/10' : ''
      }`}
      style={{ height: TRACK_HEIGHT + TRACK_GAP }}
    >
      {/* Track label */}
      <div
        className="flex flex-col items-end justify-center px-2 text-[10px] font-medium uppercase tracking-wider shrink-0 border-r border-studioBorder/30 gap-0.5"
        style={{ width: LABEL_WIDTH }}
      >
        <span
          style={{ color: TRACK_COLORS[track.type] }}
          className={`truncate max-w-full ${track.name ? 'normal-case' : ''}`}
          title={label}
        >
          {label}
          {track.type === 'audio' && track.muted ? ' \uD83D\uDD07' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            className={`text-[9px] ${track.locked ? 'text-designerAccent' : 'text-textColor/40 hover:text-textColor'}`}
            title={track.locked ? translate('unlock_track', 'Unlock track') : translate('lock_track', 'Lock track')}
            aria-label={track.locked ? translate('unlock_track', 'Unlock track') : translate('lock_track', 'Lock track')}
            aria-pressed={!!track.locked}
            onClick={() => onToggleLock(track.id)}
          >
            {track.locked ? '🔒' : '🔓'}
          </button>
          <button
            className={`text-[9px] ${track.hidden ? 'text-designerAccent' : 'text-textColor/40 hover:text-textColor'}`}
            title={track.hidden ? translate('show_track', 'Show track') : translate('hide_track', 'Hide track')}
            aria-label={track.hidden ? translate('show_track', 'Show track') : translate('hide_track', 'Hide track')}
            aria-pressed={!!track.hidden}
            onClick={() => onToggleHidden(track.id)}
          >
            👁
          </button>
          <button
            className="text-[9px] text-textColor/40 hover:text-textColor"
            title={translate('track_settings', 'Track settings')}
            aria-label={translate('track_settings_for', 'Track settings: {{name}}', { name: label })}
            aria-haspopup="menu"
            onClick={(e) => {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              setTrackSettings({ trackId: track.id, x: rect.left + rect.width / 2, y: rect.top });
            }}
          >
            ⋮
          </button>
        </div>
      </div>

      {/* Track content area */}
      <div
        className={`relative flex-1 ${track.hidden ? 'opacity-40' : ''}`}
        style={{ width: totalPixels + 40 }}
      >
        {track.clips.map((clip) => (
          <ClipRow
            key={clip.id}
            trackId={track.id}
            trackType={track.type}
            clip={clip}
            durationMs={durationMs}
            pixelsPerMs={pixelsPerMs}
            selected={isSelected(track.id, clip.id)}
            primary={isPrimary(track.id, clip.id)}
            locked={!!track.locked}
            translate={translate}
            dragMovedRef={dragMovedRef}
            onSelectClip={onSelectClip}
            onClipKeyDown={onClipKeyDown}
            onSliderKeyUp={onSliderKeyUp}
            onClipMouseDown={onClipMouseDown}
            onClipContextMenu={onClipContextMenu}
            onEdgeKeyDown={onEdgeKeyDown}
          />
        ))}

        {/* Transition handles between adjacent clips */}
        {pairs.map(({ from, to }) => {
          const handleX = from.endMs * pixelsPerMs;
          const tType = from.transitionOut?.type || to.transitionIn?.type || 'cut';
          const isTransitioning = tType !== 'cut';
          return (
            <div
              key={`trans-${from.id}-${to.id}`}
              className="absolute top-1 z-20 group"
              style={{
                left: handleX - 4,
                height: TRACK_HEIGHT - 8,
              }}
            >
              <button
                type="button"
                className={`w-2 h-full flex items-center justify-center rounded-xs ${
                  isTransitioning ? 'bg-yellow-500/40 hover:bg-yellow-500/60' : 'bg-transparent hover:bg-white/10'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setTransitionPopover({
                    trackId: track.id,
                    fromClipId: from.id,
                    toClipId: to.id,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                title={translate('transition_hint', '{{label}} transition', { label: transitionLabel(tType) })}
                aria-label={translate('transition_hint', '{{label}} transition', { label: transitionLabel(tType) })}
              >
                {isTransitioning && (
                  <div className="w-1 h-3 rounded-full bg-yellow-400" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface AiVideoDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  selectedImageSrc?: string;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false, fileId?: string) => Promise<void>;
  // Current video output's canvas — seeds the studio schema's aspect_ratio
  // field (same canvas-derived seeding the slideshow dialog does).
  outputWidth?: number;
  outputHeight?: number;
}

export const AiVideoDialog: FC<AiVideoDialogProps> = ({ fetch, toaster, selectedImageSrc, onResult, outputWidth, outputHeight }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [useImage, setUseImage] = useState(false);
  const [loading, setLoading] = useState(false);
  // '' = org default provider (legacy path); an explicit provider embeds its
  // compact studio, which owns generation inside the modal.
  const [provider, setProvider] = useGenerationProviderChoice('video');
  const canvasAspect = useMemo(
    () => closestAspectRatio(outputWidth, outputHeight),
    [outputWidth, outputHeight]
  );

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toaster.show(t('please_enter_a_prompt', 'Please enter a prompt'), 'warning');
      return;
    }
    setLoading(true);
    modals.closeAll();
    try {
      const res = await fetch('/media/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          imageUrl: useImage ? selectedImageSrc : undefined,
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, t('video_generation_failed', 'Video generation failed')));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('video_generation_failed', 'Video generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, useImage, selectedImageSrc, onResult, toaster, modals, t]);

  const handleStudioGenerated = useCallback(
    async (result: CompactStudioResult) => {
      // Already-complete artifact — land it like a finished landOrPoll (the
      // artifactUrl takes the no-poll path there).
      modals.closeAll();
      await onResult('video', result.artifactUrl, result.fileId || undefined);
    },
    [modals, onResult]
  );

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_video_you_want_to_generate', 'Describe the video you want to generate...')}
        className="w-full bg-newBgColor border border-studioBorder rounded-sm p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-hidden min-h-[80px]"
      />
      <p className="text-[10px] text-textColor/50">
        {t(
          'designer_video_text_baked_hint',
          "Text rendered inside a generated video is baked into the video — it can't be edited as text afterwards."
        )}
      </p>
      <GenerationProviderPicker
        operation="video"
        dialogKey="video"
        value={provider}
        onChange={setProvider}
      />
      {provider ? (
        <CompactStudio
          provider={provider}
          operation="video"
          prompt={prompt}
          aspectRatio={canvasAspect}
          onGenerated={handleStudioGenerated}
        />
      ) : (
        <>
          {selectedImageSrc && (
            <label className="flex items-center gap-2 text-[11px] text-textColor cursor-pointer">
              <input
                type="checkbox"
                checked={useImage}
                onChange={(e) => setUseImage(e.target.checked)}
                className="accent-designerAccent w-3 h-3"
              />
              {t('use_selected_image', 'Use selected image')}
            </label>
          )}
          <button
            onClick={generate}
            disabled={loading || !prompt.trim()}
            className="px-3 py-1.5 rounded-sm text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
          </button>
        </>
      )}
    </div>
  );
};

interface MusicDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false, fileId?: string) => Promise<void>;
}

export const MusicDialog: FC<MusicDialogProps> = ({ fetch, toaster, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  // '' = org default provider (legacy path); an explicit provider embeds its
  // compact studio, which owns generation inside the modal.
  const [provider, setProvider] = useGenerationProviderChoice('audio');

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toaster.show(t('please_enter_a_prompt', 'Please enter a prompt'), 'warning');
      return;
    }
    setLoading(true);
    modals.closeAll();
    try {
      const res = await fetch('/media/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, t('music_generation_failed', 'Music generation failed')));
      const data = await res.json();
      await onResult('audio', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('music_generation_failed', 'Music generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, onResult, toaster, modals, t]);

  const handleStudioGenerated = useCallback(
    async (result: CompactStudioResult) => {
      // Already-complete artifact — land it like a finished landOrPoll (the
      // artifactUrl takes the no-poll path there).
      modals.closeAll();
      await onResult('audio', result.artifactUrl, result.fileId || undefined);
    },
    [modals, onResult]
  );

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_music_you_want_to_generate', 'Describe the music you want to generate...')}
        className="w-full bg-newBgColor border border-studioBorder rounded-sm p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-hidden min-h-[80px]"
      />
      <GenerationProviderPicker
        operation="audio"
        dialogKey="audio"
        value={provider}
        onChange={setProvider}
      />
      {provider ? (
        <CompactStudio
          provider={provider}
          operation="audio"
          prompt={prompt}
          onGenerated={handleStudioGenerated}
        />
      ) : (
        <button
          onClick={generate}
          disabled={loading || !prompt.trim()}
          className="px-3 py-1.5 rounded-sm text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
        </button>
      )}
    </div>
  );
};

interface AvatarDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  selectedImageSrc?: string;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false, fileId?: string) => Promise<void>;
}

export const AvatarDialog: FC<AvatarDialogProps> = ({ fetch, toaster, selectedImageSrc, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [script, setScript] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const portraitPicker = useMediaPicker({
    title: t('pick_portrait', 'Pick portrait'),
    kinds: ['image'],
    onSelect: (item) => setImageUrl(item.url),
  });
  const [loading, setLoading] = useState(false);
  // '' = org default avatar provider (legacy path); an explicit provider embeds
  // its compact avatar studio, which owns generation inside the modal.
  const [provider, setProvider] = useGenerationProviderChoice('avatar');

  const generate = useCallback(async () => {
    if (!script.trim()) {
      toaster.show(t('please_enter_a_script', 'Please enter a script'), 'warning');
      return;
    }
    setLoading(true);
    modals.closeAll();
    try {
      const res = await fetch('/media/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, imageUrl }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, t('avatar_generation_failed', 'Avatar generation failed')));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('avatar_generation_failed', 'Avatar generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, script, imageUrl, onResult, toaster, modals, t]);

  const handleStudioGenerated = useCallback(
    async (result: CompactStudioResult) => {
      // Already-complete artifact — land it like a finished landOrPoll (the
      // artifactUrl takes the no-poll path there).
      modals.closeAll();
      await onResult('video', result.artifactUrl, result.fileId || undefined);
    },
    [modals, onResult]
  );

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder={t('enter_the_script_for_the_avatar', 'Enter the script for the avatar...')}
        className="w-full bg-newBgColor border border-studioBorder rounded-sm p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-hidden min-h-[80px]"
      />
      <GenerationProviderPicker
        operation="avatar"
        dialogKey="avatar"
        value={provider}
        onChange={setProvider}
      />
      {provider ? (
        // Avatar studios are descriptor `video` tabs (script + portrait model);
        // the dialog's script textarea drives the studio's prompt field.
        <CompactStudio
          provider={provider}
          operation="video"
          prompt={script}
          onGenerated={handleStudioGenerated}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={portraitPicker.open}
              className="px-2 py-1 rounded-sm text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
            >
              {t('pick_portrait', 'Pick portrait')}
            </button>
            {selectedImageSrc && (
              <button
                onClick={() => setImageUrl(selectedImageSrc)}
                className="px-2 py-1 rounded-sm text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
              >
                {t('use_selected_image', 'Use selected image')}
              </button>
            )}
          </div>
          {imageUrl && (
            <div className="text-[10px] text-textColor/60 truncate">{t('portrait_name', 'Portrait: {{name}}', { name: imageUrl.split('/').pop() })}</div>
          )}
          <button
            onClick={generate}
            disabled={loading || !script.trim()}
            className="px-3 py-1.5 rounded-sm text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
          </button>
        </>
      )}
      {portraitPicker.element}
    </div>
  );
};

interface SlideshowDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false, fileId?: string) => Promise<void>;
  // Current video output's canvas — drives the generated frames' aspect and
  // the server-side per-slide normalization. Absent = legacy server behavior.
  outputWidth?: number;
  outputHeight?: number;
}

export const SlideshowDialog: FC<SlideshowDialogProps> = ({ fetch, toaster, onResult, outputWidth, outputHeight }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  // 'cover' default: filling the canvas (cropping overflow) is what social
  // outputs almost always want; 'contain' letterboxes on black.
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('cover');
  const imagesPicker = useMediaPicker({
    title: t('add_images', 'Add images'),
    kinds: ['image'],
    multiple: true,
    onConfirm: (items) => setImageUrls((prev) => [...prev, ...items.map((i) => i.url)]),
  });
  const [loading, setLoading] = useState(false);
  const hasCanvas = !!(outputWidth && outputHeight);

  const generate = useCallback(async () => {
    if (!prompt.trim() && imageUrls.length === 0) {
      toaster.show(t('please_enter_a_prompt', 'Please enter a prompt'), 'warning');
      return;
    }
    setLoading(true);
    modals.closeAll();
    try {
      const res = await fetch('/media/generate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          imageUrls: imageUrls.length ? imageUrls : undefined,
          fitMode,
          ...(hasCanvas
            ? {
                aspect: aspectBucketForDimensions(outputWidth!, outputHeight!),
                width: outputWidth,
                height: outputHeight,
              }
            : {}),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, t('slideshow_generation_failed', 'Slideshow generation failed')));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('slideshow_generation_failed', 'Slideshow generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, imageUrls, fitMode, hasCanvas, outputWidth, outputHeight, onResult, toaster, modals, t]);

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_slideshow', 'Describe the slideshow...')}
        className="w-full bg-newBgColor border border-studioBorder rounded-sm p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-hidden"
      />
      <button
        onClick={imagesPicker.open}
        className="px-2 py-1 rounded-sm text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30 self-start"
      >
        {t('add_images', 'Add images')}
      </button>
      {imageUrls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {imageUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-newBgColorInner border border-studioBorder text-[10px] text-textColor">
              <span className="truncate max-w-[120px]">{url.split('/').pop()}</span>
              <button
                onClick={() => setImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-textColor/60 hover:text-textColor"
                aria-label={t('remove_image', 'Remove image')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {hasCanvas && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-textColor/70">{t('image_fit', 'Image fit')}</span>
          <div className="flex gap-1">
            {(['cover', 'contain'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFitMode(mode)}
                className={`px-2 py-1 rounded-sm text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30 ${fitMode === mode ? 'bg-studioBorder/40' : ''}`}
              >
                {mode === 'cover'
                  ? t('fit_fill_crop', 'Fill (crop)')
                  : t('fit_letterbox', 'Fit (letterbox)')}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={generate}
        // Images alone are enough — the backend substitutes a default topic
        // when no prompt is given but reference images were supplied.
        disabled={loading || (!prompt.trim() && imageUrls.length === 0)}
        title={
          !prompt.trim() && imageUrls.length === 0
            ? t('slideshow_needs_prompt_or_images', 'Describe the slideshow or add images first')
            : undefined
        }
        className="px-3 py-1.5 rounded-sm text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
      </button>
      {imagesPicker.element}
    </div>
  );
};

const trackTypeKeys: Record<VideoTrack['type'], [string, string]> = {
  video: ['track_type_video', 'video'],
  image: ['file_type_image', 'image'],
  text: ['track_type_text', 'text'],
  shape: ['track_type_shape', 'shape'],
  raster: ['track_type_paint', 'paint'],
  caption: ['track_type_caption', 'caption'],
  audio: ['track_type_audio', 'audio'],
  sticker: ['track_type_sticker', 'sticker'],
};

const transitionKeys: Record<string, [string, string]> = {
  cut: ['transition_cut', 'Cut'],
  fade: ['transition_fade', 'Fade'],
  dissolve: ['transition_dissolve', 'Dissolve'],
  slide: ['transition_slide', 'Slide'],
  wipe: ['transition_wipe', 'Wipe'],
  zoom: ['transition_zoom', 'Zoom'],
  blur: ['transition_blur', 'Blur'],
};

const directionKeys: Record<'left' | 'right' | 'up' | 'down', [string, string]> = {
  left: ['direction_left', 'left'],
  right: ['direction_right', 'right'],
  up: ['direction_up', 'up'],
  down: ['direction_down', 'down'],
};

export const VideoTimeline: FC<VideoTimelineProps> = ({ store, sendTimelineAwareness }) => {
  // Named `translate` (not `t`) because this component uses `t` pervasively as the
  // conventional loop/find/reduce callback var for a VideoTrack throughout its body.
  const translate = useT();
  const trackTypeLabel = useCallback(
    (type: VideoTrack['type']) => translate(...trackTypeKeys[type]),
    [translate],
  );
  const transitionLabel = useCallback(
    (type: string) => (transitionKeys[type] ? translate(...transitionKeys[type]) : type),
    [translate],
  );
  const directionLabel = useCallback(
    (dir: 'left' | 'right' | 'up' | 'down') => translate(...directionKeys[dir]),
    [translate],
  );
  // Voiceover (TTS) and Captions (STT) hit media-provider endpoints — gate them on the
  // shared status so we don't offer a generation the org has no provider for (it would
  // 409). Optimistic while loading / fail-open on error.
  const { operationAvailable, toolAvailable, tool } = useMediaToolsStatus();
  const ttsAvailable = operationAvailable('tts');
  const sttAvailable = operationAvailable('stt');
  const textToVideoAvailable = toolAvailable('text-to-video');
  const imageToVideoAvailable = toolAvailable('image-to-video');
  const videoUpscaleAvailable = toolAvailable('video-upscale');
  const videoBackgroundAvailable = toolAvailable('video-background');
  const videoToVideoAvailable = toolAvailable('video-to-video');
  const textToMusicAvailable = toolAvailable('text-to-music');
  const videoAvatarAvailable = toolAvailable('video-avatar');
  const imageSlideAvailable = toolAvailable('image-slide');
  const doc = store((s) => s.doc);
  const currentOutput = store((s) => s.currentOutput);
  // No root playheadMs subscription: the preview engine ticks per rAF, and a
  // subscription here reconciled the whole timeline at 60fps. The playhead is
  // read imperatively (store.getState()) in handlers, and the small
  // PlayheadTimecode / PlayheadIndicator components subscribe for display.
  const selectedClip = store((s) => s.selectedClip);
  const selectedClips = store((s) => s.selectedClips);
  const selectedIds = store((s) => s.selectedIds);
  const hasKeyframeClipboard = store((s) => !!s.keyframeClipboard?.length);
  const timelineSnap = store((s) => s.timelineSnap);
  const timelineHeight = store((s) => s.timelineHeight);
  const setPlayhead = useCallback(
    (ms: number) => store.getState().setPlayhead(ms),
    [store],
  );
  const setSelectedClip = useCallback(
    (clip: { outputIndex: number; trackId: string; clipId: string } | null) =>
      store.getState().setSelectedClip(clip),
    [store],
  );

  const [zoomPxPerMs, setZoomPxPerMs] = useState(1 / MS_PER_PIXEL_DEFAULT);
  const [keyframeLaneOpen, setKeyframeLaneOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Mirror playback state into the store so sibling subtrees (the canvas
  // overlay's repaint loop) can gate per-frame work on it — the timeline owns
  // the play/pause state, and DesignerCanvas sits in a different subtree.
  useEffect(() => {
    store.getState().setIsPlaying(isPlaying);
  }, [isPlaying, store]);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [dragging, setDragging] = useState<{
    trackId: string;
    clipId: string;
    edge: 'start' | 'end' | 'move';
    startX: number;
    origStart: number;
    origEnd: number;
    /** The clip as it was at mousedown — trim deltas are computed against it. */
    origClip: VideoClip;
    trackType: VideoTrack['type'];
    sourceDurationMs?: number;
    /**
     * Multi-clip move: when the dragged clip is part of a multi-selection, the
     * mousedown snapshot of EVERY selected clip (origStart/origEnd + track).
     * Present only for 'move' drags with 2+ members. A member's `trackId` is
     * its ORIGINAL track (clips never change track mid-drag); a cross-track
     * drop applies the same vertical track delta to every member on mouseup.
     */
    group?: { trackId: string; clipId: string; origStart: number; origEnd: number }[];
  } | null>(null);
  // Set once a drag actually moved, so the click that follows mouseup does not
  // collapse a multi-selection the user just finished dragging.
  const dragMovedRef = useRef(false);
  // Rubber-band selection rect in scroll-content coordinates (null = inactive).
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const [transitionPopover, setTransitionPopover] = useState<{
    trackId: string;
    fromClipId: string;
    toClipId: string;
    x: number;
    y: number;
  } | null>(null);
  const [clipMenu, setClipMenu] = useState<{
    x: number;
    y: number;
    outputIndex: number;
    trackId: string;
    clipId: string;
  } | null>(null);
  const [clipTransformPrompt, setClipTransformPrompt] = useState('');
  const [clipTransformMode, setClipTransformMode] = useState<'upscale' | 'remove-bg' | 'video-to-video' | null>(null);
  const [trackSettings, setTrackSettings] = useState<{
    trackId: string;
    x: number;
    y: number;
  } | null>(null);
  const [addTrackMenu, setAddTrackMenu] = useState<{ x: number; y: number } | null>(null);
  const [captionsMenu, setCaptionsMenu] = useState<{ x: number; y: number } | null>(null);
  // Ruler right-click: add a marker at the clicked time, or rename/delete the
  // marker already within snap range of it.
  const [rulerMenu, setRulerMenu] = useState<{ x: number; y: number; ms: number; markerId: string | null } | null>(null);
  const captionFileRef = useRef<HTMLInputElement>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  // True while a dragged clip hovers the virtual row below the last track —
  // dropping there creates a new track of the clip's type and lands on it.
  const [dragOverNewTrack, setDragOverNewTrack] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<VideoPreviewEngine | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const promptModal = usePromptModal();

  const vo = doc.outputs[currentOutput] as VideoOutput | undefined;
  const isVideo = doc.mode === 'video' && !!vo;

  const pixelsPerMs = zoomPxPerMs;
  const totalPixels = isVideo ? vo.durationMs * pixelsPerMs : 0;

  const selectedImageSrc = useMemo(() => {
    const out = doc.outputs[currentOutput] as any;
    if (!out?.children) return undefined;
    const selected = (out.children as DesignerElement[]).filter(
      (el) => selectedIds.includes(el.id) && el.type === 'image' && el.src
    );
    if (selected.length === 1) return selected[0].src;
    return undefined;
  }, [doc.outputs, currentOutput, selectedIds]);

  const sortedTrackClips = useMemo(() => {
    if (!isVideo || !vo) return {};
    const map: Record<string, VideoClip[]> = {};
    for (const track of vo.tracks) {
      map[track.id] = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    }
    return map;
  }, [isVideo, vo]);

  const sortedAdjacentPairs = useMemo(() => {
    if (!isVideo || !vo) return {};
    const pairs: Record<string, { from: VideoClip; to: VideoClip }[]> = {};
    for (const track of vo.tracks) {
      const sorted = sortedTrackClips[track.id] || [];
      const trackPairs: { from: VideoClip; to: VideoClip }[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        trackPairs.push({ from: sorted[i], to: sorted[i + 1] });
      }
      pairs[track.id] = trackPairs;
    }
    return pairs;
  }, [isVideo, vo, sortedTrackClips]);

  // Header labels: a custom name always wins; duplicate-type tracks get a
  // running number ("Video 2", "Audio 2", …) so same-type rows stay
  // distinguishable once multi-track timelines are the norm.
  const trackLabels = useMemo(() => {
    const map: Record<string, string> = {};
    if (!isVideo || !vo) return map;
    const totals = new Map<VideoTrack['type'], number>();
    for (const t of vo.tracks) totals.set(t.type, (totals.get(t.type) ?? 0) + 1);
    const seen = new Map<VideoTrack['type'], number>();
    for (const t of vo.tracks) {
      if (t.name) {
        map[t.id] = t.name;
        continue;
      }
      seen.set(t.type, (seen.get(t.type) ?? 0) + 1);
      map[t.id] =
        (totals.get(t.type) ?? 0) > 1
          ? `${trackTypeLabel(t.type)} ${seen.get(t.type)}`
          : trackTypeLabel(t.type);
    }
    return map;
  }, [isVideo, vo, trackTypeLabel]);

  // Warm the source-duration cache so the first edge drag already clamps.
  useEffect(() => {
    if (!isVideo || !vo) return;
    for (const track of vo.tracks) {
      if (track.type !== 'video' && track.type !== 'audio') continue;
      for (const clip of track.clips) {
        if (clip.src) getSourceDurationMs(clip.src, track.type);
      }
    }
  }, [isVideo, vo]);

  const rulerMarks = useMemo(() => {
    if (!isVideo) return [];
    const marks: { ms: number; label: string; major: boolean }[] = [];
    const stepMs = pixelsPerMs > 0.5 ? 250 : pixelsPerMs > 0.2 ? 500 : 1000;
    for (let t = 0; t <= vo.durationMs; t += stepMs) {
      marks.push({
        ms: t,
        label: t % 1000 === 0 ? `${t / 1000}s` : t % 500 === 0 ? `.${t / 500 * 5}` : '',
        major: t % 1000 === 0,
      });
    }
    return marks;
  }, [isVideo, vo, pixelsPerMs]);

  // CapCut-style scroll follow: during playback the view only chases the
  // playhead once it LEAVES the visible window, and any user scroll detaches
  // the follow until the next seek or play. `programmaticScrollRef` tells the
  // scroll listener that the next scroll event came from us, not the user.
  const followPlaybackRef = useRef(true);
  const programmaticScrollRef = useRef(false);

  const setScrollLeft = useCallback((px: number) => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollLeft = Math.max(0, px);
  }, []);

  const scrollToPlayhead = useCallback(() => {
    if (!scrollRef.current) return;
    followPlaybackRef.current = true;
    const playheadPx = store.getState().playheadMs * pixelsPerMs - 200;
    setScrollLeft(playheadPx);
  }, [store, pixelsPerMs, setScrollLeft]);

  const handlePlayPause = useCallback(() => {
    if (!isVideo || !vo) return;
    if (isPlaying) {
      previewRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    if (!previewRef.current) {
      previewRef.current = new VideoPreviewEngine(store);
    }
    previewRef.current.play({
      loop: loopPlayback,
      onTick: (ms) => {
        setPlayhead(ms);
      },
      onEnd: () => {
        setIsPlaying(false);
      },
    });
    setIsPlaying(true);
    scrollToPlayhead();
  }, [isVideo, vo, isPlaying, loopPlayback, store, setPlayhead, scrollToPlayhead]);

  // Guards the long-running poll loops (landOrPoll / runClipTransform) so they
  // stop touching the store / firing toasts after the timeline unmounts.
  const mountedRef = useRef(true);

  // Applying a text-animation preset (clip inspector) asks for a one-shot
  // preview over the animation window: play from the playhead the inspector
  // just set to the clip start, then auto-pause. Without this the click looks
  // dead — every preset animates only the clip's first few hundred ms.
  const previewAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isVideo) return;
    const onPreview = (e: Event) => {
      if (!vo) return;
      if (previewAnimTimerRef.current) clearTimeout(previewAnimTimerRef.current);
      previewRef.current?.pause();
      if (!previewRef.current) {
        previewRef.current = new VideoPreviewEngine(store);
      }
      const durationMs =
        (e as CustomEvent<{ durationMs?: number }>).detail?.durationMs ?? 1500;
      previewRef.current.play({
        loop: false,
        onTick: (ms) => {
          setPlayhead(ms);
        },
        onEnd: () => {
          setIsPlaying(false);
        },
      });
      setIsPlaying(true);
      previewAnimTimerRef.current = setTimeout(() => {
        previewAnimTimerRef.current = null;
        previewRef.current?.pause();
        setIsPlaying(false);
      }, durationMs);
    };
    window.addEventListener('designer:preview-clip-animation', onPreview);
    return () => {
      window.removeEventListener('designer:preview-clip-animation', onPreview);
      if (previewAnimTimerRef.current) clearTimeout(previewAnimTimerRef.current);
    };
  }, [isVideo, vo, store, setPlayhead]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // destroy() (not just pause()) removes the hidden <video>/<audio> DOM nodes
      // and drops buffers — otherwise they leak for the whole SPA session.
      previewRef.current?.destroy();
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    scrollToPlayhead();
    let prev = store.getState().playheadMs;
    return store.subscribe((state) => {
      if (state.playheadMs === prev) return;
      prev = state.playheadMs;
      if (!followPlaybackRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const playheadPx = LABEL_WIDTH + state.playheadMs * pixelsPerMs;
      // Chase only when the playhead leaves the visible window (with a small
      // margin so it doesn't hug the edge); otherwise the user's scroll wins.
      const margin = 60;
      const viewStart = el.scrollLeft + LABEL_WIDTH;
      const viewEnd = el.scrollLeft + el.clientWidth;
      if (playheadPx < viewStart + margin || playheadPx > viewEnd - margin) {
        setScrollLeft(playheadPx - LABEL_WIDTH - 200);
      }
    });
  }, [isPlaying, scrollToPlayhead, store, pixelsPerMs, setScrollLeft]);

  // A scroll NOT caused by our own follow/anchor writes detaches the follow
  // for the rest of this playback run (seeking or pressing play re-arms it).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      if (isPlaying) followPlaybackRef.current = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // isVideo: the scroll container only exists once video mode renders, so
    // re-attach when it appears (the component stays mounted across modes).
  }, [isVideo, isPlaying]);

  // The ruler's aria value tracks the playhead imperatively — re-rendering
  // the ruler per tick would repaint every tick mark for an attribute change.
  useEffect(() => {
    return store.subscribe((state) => {
      const el = rulerRef.current;
      if (!el) return;
      el.setAttribute('aria-valuenow', String(Math.round(state.playheadMs)));
      el.setAttribute('aria-valuetext', formatTime(state.playheadMs));
    });
  }, [store]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
      let ms = Math.max(0, Math.min(vo?.durationMs ?? MAX_VIDEO_DURATION_MS, x / pixelsPerMs));
      // Scrubbing snaps to markers while timeline snapping is on (same
      // threshold a clip edge snaps with).
      const state = store.getState();
      if (state.timelineSnap) {
        const markers = (state.doc.outputs[currentOutput] as VideoOutput | undefined)?.markers || [];
        const threshold = SNAP_THRESHOLD_MS / pixelsPerMs;
        for (const m of markers) {
          if (Math.abs(m.tMs - ms) <= threshold) {
            ms = m.tMs;
            break;
          }
        }
      }
      // A deliberate seek re-arms the playback scroll follow.
      followPlaybackRef.current = true;
      setPlayhead(ms);
      if (previewRef.current) previewRef.current.seek(ms);
    },
    [pixelsPerMs, setPlayhead, vo?.durationMs, store, currentOutput],
  );

  // Ruler drag-scrub: mousedown seeks, mousemove-while-down keeps scrubbing
  // (rAF-throttled so a fast drag doesn't seek the media elements per pixel),
  // mouseup releases.
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRafRef = useRef<number | null>(null);
  const scrubLastXRef = useRef(0);

  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Focus the ruler (no preventDefault — that would suppress focus and
      // break the ruler's keyboard stepping) so arrows keep working mid-scrub.
      (e.currentTarget as HTMLElement).focus();
      seekFromClientX(e.clientX);
      scrubLastXRef.current = e.clientX;
      setScrubbing(true);
    },
    [seekFromClientX],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: MouseEvent) => {
      scrubLastXRef.current = e.clientX;
      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null;
        seekFromClientX(scrubLastXRef.current);
      });
    };
    const onUp = () => setScrubbing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // A lost mouseup (pointer leaves the window, OS steals the pointer, window
    // blurs mid-scrub) must also release the gesture, or the listeners leak
    // until the next scrub.
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      if (scrubRafRef.current !== null) cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    };
  }, [scrubbing, seekFromClientX]);

  const handleZoomIn = useCallback(() => {
    setZoomPxPerMs((z) => Math.min(z * 1.5, 4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomPxPerMs((z) => Math.max(z / 1.5, 0.01));
  }, []);

  // Zoom so the whole composition fits the visible track area.
  const handleZoomToFit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !vo) return;
    const available = el.clientWidth - LABEL_WIDTH - 40;
    setZoomPxPerMs(Math.max(0.01, Math.min(4, available / vo.durationMs)));
    setScrollLeft(0);
  }, [vo, setScrollLeft]);

  // Ctrl/Cmd+wheel zooms anchored at the cursor: the time under the pointer
  // stays put across the zoom (standard NLE behavior). Attached natively —
  // React's wheel listener is passive and could not preventDefault the scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const msAtCursor = Math.max(0, (e.clientX - rect.left + el.scrollLeft - LABEL_WIDTH) / pixelsPerMs);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.max(0.01, Math.min(4, pixelsPerMs * factor));
      if (next === pixelsPerMs) return;
      setZoomPxPerMs(next);
      // Re-anchor after the zoom re-render has applied the new content width.
      requestAnimationFrame(() => {
        setScrollLeft(LABEL_WIDTH + msAtCursor * next - (e.clientX - rect.left));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // isVideo: the scroll container only exists once video mode renders.
  }, [isVideo, pixelsPerMs, setScrollLeft]);

  const SLIDER_STEP_MS = 100;
  const SLIDER_BIG_STEP_MS = 1000;

  const handleRulerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(
          e.key
        )
      ) {
        return;
      }
      e.preventDefault();
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const max = vo?.durationMs ?? 0;
      const step = e.shiftKey ? SLIDER_BIG_STEP_MS : SLIDER_STEP_MS;
      let next = state.playheadMs;
      if (e.key === 'ArrowLeft') next -= step;
      else if (e.key === 'ArrowRight') next += step;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = max;
      else if (e.key === 'PageUp') next -= step * 5;
      else if (e.key === 'PageDown') next += step * 5;
      next = Math.max(0, Math.min(max, next));
      followPlaybackRef.current = true;
      setPlayhead(next);
      previewRef.current?.seek(next);
    },
    [currentOutput, setPlayhead, store]
  );

  const handleClipKeyDown = useCallback(
    (e: React.KeyboardEvent, trackId: string, clip: VideoClip) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSelectedClip({ outputIndex: currentOutput, trackId, clipId: clip.id });
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      // Keyboard moves are edits too — a locked track refuses them.
      if (vo?.tracks.find((t) => t.id === trackId)?.locked) return;
      const max = vo?.durationMs ?? 0;
      const step =
        (e.shiftKey ? SLIDER_BIG_STEP_MS : SLIDER_STEP_MS) *
        (e.key === 'ArrowLeft' ? -1 : 1);
      const duration = clip.endMs - clip.startMs;
      const nextStart = Math.max(
        0,
        Math.min(max - duration, clip.startMs + step)
      );
      state.updateClipSilent(currentOutput, trackId, clip.id, {
        startMs: Math.round(nextStart),
      });
    },
    [currentOutput, setSelectedClip, store]
  );

  const handleEdgeKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      trackId: string,
      clip: VideoClip,
      edge: 'start' | 'end'
    ) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      if (!vo) return;
      const track = vo.tracks.find((t) => t.id === trackId);
      // Keyboard trims are edits too — a locked track refuses them.
      if (track?.locked) return;
      const step =
        (e.shiftKey ? SLIDER_BIG_STEP_MS : SLIDER_STEP_MS) *
        (e.key === 'ArrowLeft' ? -1 : 1);
      // Same trim rules as an edge drag: the start edge cuts source (trimInMs
      // follows), the end edge cannot run past the probed source duration.
      const update = clipEdgeUpdate(
        clip,
        edge,
        (edge === 'start' ? clip.startMs : clip.endMs) + step,
        {
          sourceDurationMs:
            track && (track.type === 'video' || track.type === 'audio') && clip.src
              ? getSourceDurationMs(clip.src, track.type)
              : undefined,
          hasSourceWindow: track?.type === 'video' || track?.type === 'audio',
          maxEndMs: vo.durationMs,
        }
      );
      state.updateClipSilent(currentOutput, trackId, clip.id, {
        startMs: Math.round(update.startMs),
        endMs: Math.round(update.endMs),
        ...(update.trimInMs !== undefined ? { trimInMs: Math.round(update.trimInMs) } : {}),
      });
    },
    [currentOutput, store]
  );

  const handleSliderKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(
          e.key
        )
      ) {
        store.getState().pushHistory();
      }
    },
    [store]
  );

  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, trackId: string, trackType: VideoTrack['type'], clip: VideoClip, edge: 'start' | 'end' | 'move') => {
      e.stopPropagation();
      dragMovedRef.current = false;
      // Shift-click is pure selection: toggle membership and never start a
      // drag, or the toggle would immediately drag the clip it just selected.
      if (e.shiftKey && edge === 'move') {
        store.getState().toggleClipSelection(trackId, clip.id);
        return;
      }
      const inSelection = store
        .getState()
        .selectedClips.some((c) => c.trackId === trackId && c.clipId === clip.id);
      // Pressing an unselected clip collapses the selection to it (the drag
      // that follows is single-clip); pressing a selected clip keeps the group.
      if (!inSelection) {
        setSelectedClip({ outputIndex: currentOutput, trackId, clipId: clip.id });
      }
      // A locked track refuses drags/trims (selection still works, so the clip
      // stays inspectable); delete and split are refused in the store actions.
      const downState = store.getState();
      const downVo = downState.doc.outputs[currentOutput] as VideoOutput | undefined;
      if (downVo?.tracks.find((t) => t.id === trackId)?.locked) return;
      // Multi-clip move: snapshot every selected clip's geometry at mousedown
      // so mousemove can apply one dx to all of them (silent writes, one
      // history entry on mouseup — the same discipline as a single drag).
      let group: { trackId: string; clipId: string; origStart: number; origEnd: number }[] | undefined;
      if (edge === 'move' && inSelection) {
        const state = store.getState();
        const groupVo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
        const snapshot = state.selectedClips.flatMap((ref) => {
          const memberTrack = groupVo?.tracks.find((t) => t.id === ref.trackId);
          // Locked-track members stay put when the group moves.
          if (memberTrack?.locked) return [];
          const member = memberTrack?.clips.find((c) => c.id === ref.clipId);
          return member
            ? [{ trackId: ref.trackId, clipId: ref.clipId, origStart: member.startMs, origEnd: member.endMs }]
            : [];
        });
        if (snapshot.length > 1) group = snapshot;
      }
      setDragging({
        trackId,
        clipId: clip.id,
        edge,
        startX: e.clientX,
        origStart: clip.startMs,
        origEnd: clip.endMs,
        origClip: clip,
        trackType,
        sourceDurationMs:
          (trackType === 'video' || trackType === 'audio') && clip.src
            ? getSourceDurationMs(clip.src, trackType)
            : undefined,
        group,
      });
    },
    [currentOutput, setSelectedClip, store],
  );

  useEffect(() => {
    if (!dragging || !isVideo || !vo) return;

    const trackIndexAtY = (clientY: number): number => {
      if (!timelineRef.current) return -1;
      const rect = timelineRef.current.getBoundingClientRect();
      const tracksTop = rect.top + RULER_HEIGHT;
      const relY = clientY - tracksTop + (scrollRef.current?.scrollTop ?? 0);
      return Math.floor(relY / (TRACK_HEIGHT + TRACK_GAP));
    };
    const trackAtY = (clientY: number): VideoTrack | undefined => {
      const idx = trackIndexAtY(clientY);
      return idx >= 0 && idx < vo.tracks.length ? vo.tracks[idx] : undefined;
    };
    // Exactly one virtual row below the last track is the "drop here to create
    // a track" zone; further down is outside the affordance.
    const isNewTrackZone = (clientY: number): boolean =>
      vo.tracks.length < MAX_TRACKS && trackIndexAtY(clientY) === vo.tracks.length;

    // The drop's proposed members: mousedown geometry (orig*, for reverts)
    // plus the CURRENT dragged timing read off the live tracks.
    const dropMembers = (tracks: VideoTrack[]) => {
      const base = dragging.group ?? [
        {
          trackId: dragging.trackId,
          clipId: dragging.clipId,
          origStart: dragging.origStart,
          origEnd: dragging.origEnd,
        },
      ];
      return base.flatMap((m) => {
        const clip = tracks
          .find((t) => t.id === m.trackId)
          ?.clips.find((c) => c.id === m.clipId);
        return clip ? [{ ...m, startMs: clip.startMs, endMs: clip.endMs }] : [];
      });
    };

    const snapEdges = (value: number, excludeClipId: string): number => {
      // The snapping toggle (toolbar magnet) turns every snap target off at
      // once — drag, trim and scrub all read this one pref.
      if (!store.getState().timelineSnap) return value;
      const snapCandidates: number[] = [0, vo.durationMs];
      for (const t of vo.tracks) {
        for (const c of t.clips) {
          if (c.id === excludeClipId) continue;
          snapCandidates.push(c.startMs, c.endMs + (c.freezeAtMs || 0));
        }
      }
      // Beats join the clip edges as snap targets, so a cut lands on the music
      // rather than near it. Empty until an audio clip has been analysed.
      snapCandidates.push(...timelineBeats(vo.tracks));
      // Markers are snap targets too (CapCut parity).
      for (const m of vo.markers || []) snapCandidates.push(m.tMs);
      const threshold = SNAP_THRESHOLD_MS / pixelsPerMs;
      let best = value;
      let bestDelta = threshold;
      for (const target of snapCandidates) {
        const delta = Math.abs(target - value);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = target;
        }
      }
      return best;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const hovered = trackAtY(e.clientY);
      // Drop affordances (move drags only). A cross-track target highlights
      // when EVERY member of the (possibly grouped) drag can land one track-
      // delta over — planTrackDrop with allowOverlap is the structural check;
      // collision resolution itself happens at the drop. Below the last track
      // the virtual new-track row lights up instead (single clips only).
      const snapMs = SNAP_THRESHOLD_MS / pixelsPerMs;
      const dropPlan =
        dragging.edge === 'move' && hovered
          ? planTrackDrop(vo.tracks, dropMembers(vo.tracks), dragging.trackId, hovered.id, {
              snapThresholdMs: snapMs,
              maxEndMs: vo.durationMs,
              allowOverlap: true,
            })
          : null;
      setDragOverTrackId(dropPlan && hovered ? hovered.id : null);
      setDragOverNewTrack(
        dragging.edge === 'move' && !dragging.group && !hovered && isNewTrackZone(e.clientY)
      );

      // dx is measured from the gesture's mousedown and applied to the values
      // captured AT mousedown — folding it into the previously written value
      // compounded every mousemove into the next, and made the trim-in delta
      // uncomputable. Writes stay silent; mouseup pushes one history entry.
      const dx = (e.clientX - dragging.startX) / pixelsPerMs;
      if (Math.abs(e.clientX - dragging.startX) > 3) dragMovedRef.current = true;

      if (dragging.edge === 'move') {
        if (dragging.group) {
          // Group clamp: the whole selection moves by one shared dx, bounded so
          // the earliest clip cannot pass t=0 and the latest end cannot pass
          // the output duration (same bounds a single drag respects).
          const minStart = Math.min(...dragging.group.map((g) => g.origStart));
          const maxEnd = Math.max(...dragging.group.map((g) => g.origEnd));
          let groupDx = Math.max(-minStart, Math.min(vo.durationMs - maxEnd, dx));
          // Snap guides apply to the primary clip only, then re-clamp so a
          // snap cannot push another member out of bounds.
          const snappedStart = snapEdges(dragging.origStart + groupDx, dragging.clipId);
          groupDx = Math.max(-minStart, Math.min(vo.durationMs - maxEnd, snappedStart - dragging.origStart));
          for (const member of dragging.group) {
            store.getState().updateClipSilent(currentOutput, member.trackId, member.clipId, {
              startMs: Math.round(member.origStart + groupDx),
              endMs: Math.round(member.origEnd + groupDx),
            });
          }
          return;
        }
        const duration = dragging.origEnd - dragging.origStart;
        let nextStart = Math.max(0, Math.min(vo.durationMs - duration, dragging.origStart + dx));
        nextStart = snapEdges(nextStart, dragging.clipId);
        store.getState().updateClipSilent(currentOutput, dragging.trackId, dragging.clipId, {
          startMs: Math.round(nextStart),
          endMs: Math.round(nextStart + duration),
        });
        return;
      }

      const proposed =
        (dragging.edge === 'start' ? dragging.origStart : dragging.origEnd) + dx;
      const update = clipEdgeUpdate(dragging.origClip, dragging.edge, snapEdges(proposed, dragging.clipId), {
        sourceDurationMs: dragging.sourceDurationMs,
        hasSourceWindow: dragging.trackType === 'video' || dragging.trackType === 'audio',
        maxEndMs: vo.durationMs,
      });
      store.getState().updateClipSilent(currentOutput, dragging.trackId, dragging.clipId, {
        startMs: Math.round(update.startMs),
        endMs: Math.round(update.endMs),
        ...(update.trimInMs !== undefined ? { trimInMs: Math.round(update.trimInMs) } : {}),
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const hovered = trackAtY(e.clientY);
      const newTrackZone = dragging.edge === 'move' && !dragging.group && isNewTrackZone(e.clientY);
      const allowOverlap = e.altKey;
      const snapMs = SNAP_THRESHOLD_MS / pixelsPerMs;
      const state = store.getState();
      const liveVo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      setDragging(null);
      setDragOverTrackId(null);
      setDragOverNewTrack(false);
      if (!liveVo) return;

      if (dragging.edge === 'move') {
        const members = dropMembers(liveVo.tracks);
        const memberIds = new Set(members.map((m) => m.clipId));
        // Back the drag out to its mousedown geometry — used when the landing
        // has no room, so a refused drop never leaves the clip half-moved.
        const revert = () => {
          for (const m of members) {
            state.updateClipSilent(currentOutput, m.trackId, m.clipId, {
              startMs: m.origStart,
              endMs: m.origEnd,
            });
          }
          state.pushHistory();
          toaster.show(
            translate('no_room_on_track_clip_overlaps', 'No room on that track — clip overlaps'),
            'warning'
          );
        };

        // 1. Drop below the last track: create a track of the clip's type and
        //    land the clip on it — one history entry via moveClips.
        if (newTrackZone) {
          const moved = state.moveClips(
            currentOutput,
            members.map((m) => ({
              trackId: m.trackId,
              clipId: m.clipId,
              toTrackId: null,
              startMs: m.startMs,
              endMs: m.endMs,
            })),
            { newTrackType: dragging.trackType }
          );
          if (!moved) revert();
          return;
        }

        // 2. Cross-track drop (single or group): the vertical track delta
        //    applies to every member; placements are collision-resolved unless
        //    Alt asks for the overlap. No room → revert with an explanation.
        if (hovered) {
          const plan = planTrackDrop(liveVo.tracks, members, dragging.trackId, hovered.id, {
            snapThresholdMs: snapMs,
            maxEndMs: liveVo.durationMs,
            allowOverlap,
          });
          if (plan) {
            if (!state.moveClips(currentOutput, plan)) revert();
            return;
          }
          const structural = planTrackDrop(liveVo.tracks, members, dragging.trackId, hovered.id, {
            snapThresholdMs: snapMs,
            maxEndMs: liveVo.durationMs,
            allowOverlap: true,
          });
          if (structural && !allowOverlap) {
            revert();
            return;
          }
          // Not a legal cross-track target at all (same row, type mismatch,
          // locked) — fall through: the drag was horizontal-only.
        }

        // 3. Same-track move: resolve overlaps the horizontal drag introduced
        //    (members keep their mousedown overlap relative to each other).
        if (!allowOverlap && dragMovedRef.current) {
          const resolvedMoves: { trackId: string; clipId: string; startMs: number; endMs: number }[] = [];
          let failed = false;
          for (const m of members) {
            if (m.startMs === m.origStart && m.endMs === m.origEnd) continue;
            const obstacles = (liveVo.tracks.find((t) => t.id === m.trackId)?.clips ?? []).filter(
              (c) => !memberIds.has(c.id)
            );
            const resolved = resolveClipPlacement(
              obstacles,
              { startMs: m.startMs, endMs: m.endMs, clipId: m.clipId },
              snapMs,
              liveVo.durationMs
            );
            if (!resolved) {
              failed = true;
              break;
            }
            if (resolved.startMs !== m.startMs || resolved.endMs !== m.endMs) {
              resolvedMoves.push({ trackId: m.trackId, clipId: m.clipId, ...resolved });
            }
          }
          if (failed) {
            revert();
            return;
          }
          for (const r of resolvedMoves) {
            state.updateClipSilent(currentOutput, r.trackId, r.clipId, {
              startMs: r.startMs,
              endMs: r.endMs,
            });
          }
        }
      }
      state.pushHistory();
    };

    // A lost mouseup (pointer leaves the window, pointercancel, window blur
    // mid-drag) ends the gesture where it stands: the cross-track drop needs a
    // pointer position we no longer have, so it is skipped — but any geometry
    // already written still lands as one history entry.
    const handleCancel = () => {
      setDragging(null);
      setDragOverTrackId(null);
      setDragOverNewTrack(false);
      if (dragMovedRef.current) store.getState().pushHistory();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleCancel);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleCancel);
    };
  }, [dragging, isVideo, vo, pixelsPerMs, store, currentOutput, toaster, translate]);

  // Marquee (rubber-band) selection: mousedown on empty track area starts the
  // rect; clips/edges/ruler/buttons stopPropagation or are excluded by the
  // closest() guard, so this never fights a clip drag or a ruler scrub.
  const MARQUEE_GEOM = useMemo(
    () => ({ rulerHeight: RULER_HEIGHT, trackHeight: TRACK_HEIGHT, trackGap: TRACK_GAP, labelWidth: LABEL_WIDTH }),
    [],
  );

  // Attached natively on the scroll container: a JSX onMouseDown on the
  // static wrapper trips jsx-a11y/no-static-element-interactions, and the
  // marquee is a pointer gesture (keyboard selection is shift-click).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[role="slider"], button, input, textarea, a')) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      const y = e.clientY - rect.top + el.scrollTop;
      // The ruler row is drag-scrub territory — never a marquee origin.
      if (y < RULER_HEIGHT) return;
      marqueeAnchorRef.current = { x, y };
      setMarquee({ left: x, right: x, top: y, bottom: y });
    };
    el.addEventListener('mousedown', onMouseDown);
    return () => el.removeEventListener('mousedown', onMouseDown);
    // isVideo: the scroll container only exists once video mode renders, so
    // re-attach when it appears (the component stays mounted across modes).
  }, [isVideo]);

  // Keying on the boolean (not the rect) keeps the listeners stable while the
  // rect updates per mousemove.
  const marqueeActive = marquee !== null;

  useEffect(() => {
    if (!marqueeActive || !isVideo || !vo) return;
    const toContent = (e: MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop };
    };
    const onMove = (e: MouseEvent) => {
      const anchor = marqueeAnchorRef.current;
      const p = toContent(e);
      if (!anchor || !p) return;
      setMarquee(normalizeMarquee(anchor.x, anchor.y, p.x, p.y));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        marqueeAnchorRef.current = null;
        setMarquee(null);
      }
    };
    const onUp = (e: MouseEvent) => {
      const anchor = marqueeAnchorRef.current;
      const p = toContent(e);
      marqueeAnchorRef.current = null;
      setMarquee(null);
      if (!anchor || !p) return;
      const rect = normalizeMarquee(anchor.x, anchor.y, p.x, p.y);
      if (isMarqueeClick(rect)) {
        // A click on empty track area clears the selection (standard NLE).
        store.getState().setSelectedClips([]);
        return;
      }
      store.getState().setSelectedClips(marqueeHitClips(vo.tracks, rect, pixelsPerMs, MARQUEE_GEOM));
    };
    // A lost mouseup abandons the marquee without touching the selection —
    // there is no pointer position to finalize a rect from.
    const onCancel = () => {
      marqueeAnchorRef.current = null;
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
    };
  }, [marqueeActive, isVideo, vo, pixelsPerMs, store, MARQUEE_GEOM]);

  const handleFreezeFrame = useCallback(
    (trackId: string, clipId: string) => {
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      if (!vo) return;

      const track = vo.tracks.find((t) => t.id === trackId);
      const idx = track?.clips.findIndex((c) => c.id === clipId);
      if (idx == null || idx < 0 || !track) return;

      const original = track.clips[idx];
      const freezeDuration = 2000;
      const splitPoint = Math.max(original.startMs + 100, Math.min(original.endMs - 100, state.playheadMs));

      if (splitPoint <= original.startMs || splitPoint >= original.endMs) return;

      (globalThis as any)._clipCounter = ((globalThis as any)._clipCounter || 0) + 1;
      const ctr = (globalThis as any)._clipCounter;

      // Source time of the frame under the playhead — the frozen frame, and the
      // point the second half resumes from. For a ramped clip that is the
      // INTEGRATED mapping (the legacy sum only holds at constant speed), and
      // the two outer clips split the curve at the cut, re-based per side.
      const curveSplit = splitSpeedCurveForClip(original, splitPoint - original.startMs);
      const frozenSourceMs = curveSplit
        ? sourceTimeForClipTime(original, splitPoint - original.startMs)
        : (original.trimInMs ?? 0) + (splitPoint - original.startMs);

      const first: VideoClip = {
        ...original,
        id: `el-${Date.now()}-${ctr}`,
        endMs: splitPoint,
        ...(curveSplit
          ? { speedCurve: curveSplit.first.speedCurve, trimInMs: curveSplit.first.trimInMs }
          : {}),
      };
      const freeze: VideoClip = {
        id: `el-${Date.now()}-${ctr + 1}`,
        startMs: splitPoint,
        endMs: splitPoint + freezeDuration,
        src: original.src,
        fileId: original.fileId,
        x: original.x,
        y: original.y,
        width: original.width,
        height: original.height,
        rotation: original.rotation,
        opacity: original.opacity,
        naturalWidth: original.naturalWidth,
        naturalHeight: original.naturalHeight,
        speed: 0,
        // Hold the frame at the split point (a speed:0 clip resolves to this
        // constant source time), otherwise it shows the source's first frame.
        trimInMs: frozenSourceMs,
      };
      const second: VideoClip = {
        ...original,
        id: `el-${Date.now()}-${ctr + 2}`,
        startMs: splitPoint + freezeDuration,
        // Resume from the split point, not the source start (always offset, even
        // when the original had no trimIn). For a ramped clip the curve split
        // already carries the correct per-side trim-in (reversed clips keep the
        // original trim-in on the second half — the freeze holds the cut frame).
        ...(curveSplit
          ? { speedCurve: curveSplit.second.speedCurve, trimInMs: curveSplit.second.trimInMs }
          : { trimInMs: frozenSourceMs }),
      };

      const clips = [...track.clips];
      clips.splice(idx, 1, first, freeze, second);
      const updated: VideoOutput = {
        ...vo,
        tracks: vo.tracks.map((t) => (t.id === trackId ? { ...t, clips } : t)),
      };
      const outs = [...state.doc.outputs];
      outs[currentOutput] = updated;
      store.setState({ doc: { ...state.doc, outputs: outs }, isDirty: true });
      store.getState().pushHistory();
    },
    [store, currentOutput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isVideo || !vo) return;
      const editingText = !!(e.target as HTMLElement)?.matches?.('input,textarea');

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete acts on the WHOLE multi-selection (the primary clip when it
        // stands alone) as one history step; Shift = ripple: later clips on
        // the same tracks close the gaps.
        const state = store.getState();
        const refs = state.selectedClips.length
          ? state.selectedClips
          : selectedClip && selectedClip.outputIndex === currentOutput
          ? [{ trackId: selectedClip.trackId, clipId: selectedClip.clipId }]
          : [];
        if (refs.length) {
          if (e.shiftKey) {
            state.rippleDeleteClips(currentOutput, refs);
          } else {
            state.removeClips(currentOutput, refs);
          }
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'c' &&
        !editingText
      ) {
        const state = store.getState();
        if (state.selectedClips.length) {
          e.preventDefault();
          state.copySelectedClips();
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'v' &&
        !editingText
      ) {
        const state = store.getState();
        if (state.clipClipboard.length) {
          e.preventDefault();
          state.pasteClips(state.playheadMs);
        }
      } else if (
        (e.key === ',' || e.key === '.') &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !editingText
      ) {
        // Frame step: ,/. walk the playhead one frame back/forward (CapCut
        // muscle memory), bounded to the timeline.
        e.preventDefault();
        const frameMs = 1000 / (vo.fps || 30);
        const next = Math.max(
          0,
          Math.min(vo.durationMs, store.getState().playheadMs + (e.key === '.' ? frameMs : -frameMs))
        );
        setPlayhead(next);
        previewRef.current?.seek(next);
      } else if (
        e.key.toLowerCase() === 'm' &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !editingText
      ) {
        // M drops a marker at the playhead (CapCut muscle memory).
        e.preventDefault();
        store.getState().addMarker(currentOutput, store.getState().playheadMs);
      } else if (e.key === ' ' && !(e.target as HTMLElement)?.matches?.('input,textarea')) {
        e.preventDefault();
        handlePlayPause();
      } else if (
        e.key.toLowerCase() === 's' &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !(e.target as HTMLElement)?.matches?.('input,textarea') &&
        selectedClip && selectedClip.outputIndex === currentOutput
      ) {
        // Plain S splits; Ctrl/Cmd+S must fall through to the global Save handler
        // (the timeline is focusable, so overloading Ctrl+S silently split the
        // clip AND saved the mutated doc).
        e.preventDefault();
        store.getState().splitClip(currentOutput, selectedClip.trackId, selectedClip.clipId, store.getState().playheadMs);
      } else if (
        e.key.toLowerCase() === 'f' &&
        (e.ctrlKey || e.metaKey) &&
        selectedClip && selectedClip.outputIndex === currentOutput
      ) {
        // Freeze frame: Ctrl on Windows/Linux, ⌘ on macOS.
        e.preventDefault();
        handleFreezeFrame(selectedClip.trackId, selectedClip.clipId);
      }
    },
    [isVideo, vo, selectedClip, store, currentOutput, handlePlayPause, setPlayhead, handleFreezeFrame],
  );

  const selectedKeySet = useMemo(
    () => new Set(selectedClips.map((c) => `${c.trackId}:${c.clipId}`)),
    [selectedClips],
  );

  const isSelected = useCallback(
    (trackId: string, clipId: string) => selectedKeySet.has(`${trackId}:${clipId}`),
    [selectedKeySet],
  );

  const isPrimary = useCallback(
    (trackId: string, clipId: string) =>
      selectedClip?.outputIndex === currentOutput &&
      selectedClip?.trackId === trackId &&
      selectedClip?.clipId === clipId,
    [selectedClip, currentOutput],
  );

  // Timeline awareness rides a store subscription so the per-frame playhead
  // tick doesn't re-render the timeline to broadcast it.
  useEffect(() => {
    if (!sendTimelineAwareness) return;
    const clipIdOf = (s: { selectedClip: { outputIndex: number; clipId: string } | null; currentOutput: number }) =>
      s.selectedClip?.outputIndex === s.currentOutput ? s.selectedClip.clipId : null;
    sendTimelineAwareness(store.getState().playheadMs, clipIdOf(store.getState()));
    let prev = store.getState();
    return store.subscribe((state) => {
      const before = clipIdOf(prev);
      const after = clipIdOf(state);
      if (state.playheadMs === prev.playheadMs && before === after) {
        prev = state;
        return;
      }
      prev = state;
      sendTimelineAwareness(state.playheadMs, after);
    });
  }, [sendTimelineAwareness, store]);

  const handleSelectClip = useCallback(
    (trackId: string, clipId: string) => {
      setSelectedClip({ outputIndex: currentOutput, trackId, clipId });
    },
    [setSelectedClip, currentOutput],
  );

  const handleClipContextMenu = useCallback(
    (e: React.MouseEvent, trackId: string, clipId: string) => {
      e.preventDefault();
      e.stopPropagation();
      // Right-clicking a clip that is already in the multi-selection keeps the
      // group (so Copy/etc. apply to it); otherwise the selection collapses.
      const inSelection = store
        .getState()
        .selectedClips.some((c) => c.trackId === trackId && c.clipId === clipId);
      if (!inSelection) {
        setSelectedClip({ outputIndex: currentOutput, trackId, clipId });
      }
      setClipMenu({ x: e.clientX, y: e.clientY, outputIndex: currentOutput, trackId, clipId });
    },
    [currentOutput, setSelectedClip, store],
  );

  const handleSetTransition = useCallback(
    (trackId: string, fromClipId: string, toClipId: string, type: ClipTransition['type'], direction?: 'left' | 'right' | 'up' | 'down') => {
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const track = vo?.tracks.find((t) => t.id === trackId);
      // Switching type keeps a custom duration the user already dialled in;
      // only a fresh transition starts at the 500 ms default.
      const existing =
        track?.clips.find((c) => c.id === fromClipId)?.transitionOut?.durationMs ??
        track?.clips.find((c) => c.id === toClipId)?.transitionIn?.durationMs;
      const durationMs = type === 'cut' ? 0 : existing && existing > 0 ? existing : TRANSITION_DEFAULT_MS;
      state.updateClipSilent(currentOutput, trackId, fromClipId, {
        transitionOut: { type, durationMs, direction },
      });
      state.updateClipSilent(currentOutput, trackId, toClipId, {
        transitionIn: { type, durationMs, direction },
      });
      setTransitionPopover(null);
      store.getState().pushHistory();
    },
    [store, currentOutput],
  );

  const handleSetTransitionDuration = useCallback(
    (trackId: string, fromClipId: string, toClipId: string, durationMs: number) => {
      const state = store.getState();
      const clamped = Math.max(TRANSITION_MIN_MS, Math.min(TRANSITION_MAX_MS, Math.round(durationMs)));
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const track = vo?.tracks.find((t) => t.id === trackId);
      const from = track?.clips.find((c) => c.id === fromClipId);
      const to = track?.clips.find((c) => c.id === toClipId);
      if (from?.transitionOut) {
        state.updateClipSilent(currentOutput, trackId, fromClipId, {
          transitionOut: { ...from.transitionOut, durationMs: clamped },
        });
      }
      if (to?.transitionIn) {
        state.updateClipSilent(currentOutput, trackId, toClipId, {
          transitionIn: { ...to.transitionIn, durationMs: clamped },
        });
      }
      store.getState().pushHistory();
    },
    [store, currentOutput],
  );

  const handleRenameTrack = useCallback(
    async (trackId: string) => {
      setTrackSettings(null);
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const track = vo?.tracks.find((t) => t.id === trackId);
      if (!track) return;
      // promptModal resolves null on dismiss — that means "keep the old name",
      // while a submitted empty string clears back to the type label.
      const name = await promptModal.open({
        title: translate('rename_track', 'Rename track'),
        label: translate('track_name', 'Track name'),
        initialValue: track.name ?? '',
      });
      if (name === null) return;
      store.getState().renameTrack(currentOutput, trackId, name);
    },
    [store, currentOutput, promptModal, translate],
  );

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      setTrackSettings(null);
      const state = store.getState();
      if (state.selectedClip?.outputIndex === currentOutput && state.selectedClip?.trackId === trackId) {
        state.setSelectedClip(null);
      }
      store.getState().removeTrack(currentOutput, trackId);
    },
    [store, currentOutput],
  );

  const handleToggleTrackLock = useCallback(
    (trackId: string) => {
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const track = vo?.tracks.find((t) => t.id === trackId);
      if (!track) return;
      state.setTrackLocked(currentOutput, trackId, !track.locked);
    },
    [store, currentOutput],
  );

  const handleToggleTrackHidden = useCallback(
    (trackId: string) => {
      const state = store.getState();
      const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
      const track = vo?.tracks.find((t) => t.id === trackId);
      if (!track) return;
      state.setTrackHidden(currentOutput, trackId, !track.hidden);
    },
    [store, currentOutput],
  );

  // Ruler right-click: the marker within snap range of the click (if any) is
  // the menu's rename/delete target; otherwise the menu adds one there.
  const handleRulerContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
      const ms = Math.max(0, Math.min(vo?.durationMs ?? MAX_VIDEO_DURATION_MS, x / pixelsPerMs));
      const threshold = SNAP_THRESHOLD_MS / pixelsPerMs;
      const near = (vo?.markers || []).find((m) => Math.abs(m.tMs - ms) <= threshold);
      setRulerMenu({ x: e.clientX, y: e.clientY, ms: near ? near.tMs : Math.round(ms), markerId: near?.id ?? null });
    },
    [vo, pixelsPerMs],
  );

  const handleRulerMenuAddMarker = useCallback(() => {
    if (!rulerMenu) return;
    store.getState().addMarker(currentOutput, rulerMenu.ms);
    setRulerMenu(null);
  }, [rulerMenu, store, currentOutput]);

  const handleRulerMenuRenameMarker = useCallback(async () => {
    if (!rulerMenu?.markerId) return;
    const markerId = rulerMenu.markerId;
    const state = store.getState();
    const vo = state.doc.outputs[currentOutput] as VideoOutput | undefined;
    const marker = vo?.markers?.find((m) => m.id === markerId);
    setRulerMenu(null);
    if (!marker) return;
    const name = await promptModal.open({
      title: translate('rename_marker', 'Rename marker'),
      label: translate('marker_name', 'Marker name'),
      initialValue: marker.name ?? '',
    });
    if (name === null) return;
    store.getState().renameMarker(currentOutput, markerId, name);
  }, [rulerMenu, store, currentOutput, promptModal, translate]);

  const handleRulerMenuDeleteMarker = useCallback(() => {
    if (!rulerMenu?.markerId) return;
    store.getState().removeMarker(currentOutput, rulerMenu.markerId);
    setRulerMenu(null);
  }, [rulerMenu, store, currentOutput]);

  // Timeline height drag-splitter (the panel grows upward from the bottom).
  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = store.getState().timelineHeight;
      const onMove = (ev: MouseEvent) => {
        store.getState().setTimelineHeight(startHeight + (startY - ev.clientY));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // pointercancel / window blur are the lost-mouseup paths — without them
      // the resize listeners leaked until the next splitter drag.
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('blur', onUp);
    },
    [store],
  );

  const handleAddTrack = useCallback(
    (type: VideoTrack['type']) => {
      setAddTrackMenu(null);
      store.getState().addTrack(currentOutput, type);
    },
    [store, currentOutput],
  );

  const handleDuplicateClip = useCallback(() => {
    if (!clipMenu) return;
    const id = store.getState().duplicateClip(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId);
    if (!id) {
      toaster.show(translate('no_room_to_duplicate_clip', 'No room to duplicate — the timeline is at the 180 s limit'), 'warning');
    }
    setClipMenu(null);
  }, [clipMenu, store, toaster, translate]);

  const handleCopyClips = useCallback(() => {
    store.getState().copySelectedClips();
    setClipMenu(null);
  }, [store]);

  const handleCopyClipKeyframes = useCallback(() => {
    if (!clipMenu) return;
    store.getState().copyClipKeyframes(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId);
    setClipMenu(null);
  }, [clipMenu, store]);

  const handlePasteClipKeyframes = useCallback(() => {
    if (!clipMenu) return;
    // The paste targets the primary selection — make the menu's clip primary
    // first, so "Paste keyframes" on THIS clip lands on this clip even when it
    // was right-clicked inside a multi-selection.
    store.getState().setSelectedClip({ outputIndex: clipMenu.outputIndex, trackId: clipMenu.trackId, clipId: clipMenu.clipId });
    store.getState().pasteClipKeyframes();
    setClipMenu(null);
  }, [clipMenu, store]);

  const handleRippleDeleteClip = useCallback(() => {
    if (!clipMenu) return;
    store.getState().rippleDeleteClip(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId);
    setClipMenu(null);
  }, [clipMenu, store]);

  const handleDeleteClips = useCallback(() => {
    if (!clipMenu) return;
    const state = store.getState();
    // Mirror the Delete key: when the menu's clip is part of a multi-selection,
    // the whole selection goes as one history step.
    const inSelection = state.selectedClips.some(
      (c) => c.trackId === clipMenu.trackId && c.clipId === clipMenu.clipId
    );
    const refs =
      inSelection && state.selectedClips.length
        ? state.selectedClips
        : [{ trackId: clipMenu.trackId, clipId: clipMenu.clipId }];
    state.removeClips(clipMenu.outputIndex, refs);
    setClipMenu(null);
  }, [clipMenu, store]);

  const handleSplitClipAtPlayhead = useCallback(() => {
    if (!clipMenu) return;
    store.getState().splitClip(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId, store.getState().playheadMs);
    setClipMenu(null);
  }, [clipMenu, store]);

  const handleFreezeFrameClip = useCallback(() => {
    if (!clipMenu) return;
    handleFreezeFrame(clipMenu.trackId, clipMenu.clipId);
    setClipMenu(null);
  }, [clipMenu, handleFreezeFrame]);

  const generateVoiceover = useCallback(
    async (text: string, voiceId: string, instructions?: string, provider?: string) => {
      if (!vo) return;
      try {
        const res = await postTextToSpeech(fetch, { text, voiceId, instructions, provider });
        if (!res.ok) {
          toaster.show(
            await readErrorMessage(res, translate('voiceover_generation_failed', 'Voiceover generation failed')),
            'warning'
          );
          return;
        }
        const { id, path } = await res.json();
        // Landing (probe → audio track → clip at the playhead) is shared with
        // the mic-recording dialog — see addVoiceoverToTimeline. The script,
        // voice, tone instructions and provider pin ride on the clip so the
        // inspector can re-voice it in place with the same settings.
        const landed = await addVoiceoverToTimeline(store, {
          url: path,
          fileId: id,
          voiceover: {
            script: text,
            voice: voiceId,
            ...(instructions ? { instructions } : {}),
            ...(provider ? { provider } : {}),
          },
        });
        if (!mountedRef.current) return;
        if (!landed) {
          // Generation SUCCEEDED and the file is in Files — only the timeline
          // landing failed, so say that instead of "generation failed".
          toaster.show(
            translate(
              'voiceover_generated_but_no_room',
              'Voiceover generated, but there is no room on the timeline — the file is in your media library'
            ),
            'warning'
          );
          return;
        }
        if (landed === 'relocated') {
          toaster.show(
            translate(
              'voiceover_relocated_no_room_at_playhead',
              'No room at the playhead — the voiceover was placed where it fits'
            ),
            'success'
          );
          return;
        }
        toaster.show(translate('voiceover_added_to_timeline', 'Voiceover added to timeline'), 'success');
      } catch {
        toaster.show(translate('voiceover_generation_failed', 'Voiceover generation failed'), 'warning');
      }
    },
    [vo, store, fetch, toaster, translate]
  );

  // Mic recording → upload as a visible media-library File (same as TTS
  // output) → land via the shared helper. A failure RETHROWS (with the
  // server's real reason) instead of toast-and-return: the record dialog only
  // closes on success, so the recording survives for a retry — closing the
  // dialog would GC the MediaRecorder blob.
  const recordVoiceover = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!vo) return;
      const failure = translate('voiceover_generation_failed', 'Voiceover generation failed');
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', blob, `voiceover-${Date.now()}.${ext}`);
      const uploadRes = await fetch('/files/upload-simple', { method: 'POST', body: form });
      if (!uploadRes.ok) {
        throw new Error(await readErrorMessage(uploadRes, failure));
      }
      const uploaded = await uploadRes.json();
      const landed = await addVoiceoverToTimeline(store, {
        url: uploaded.path,
        fileId: uploaded.id,
      });
      if (!landed) {
        // The recording uploaded fine (it is in Files) — only the landing failed.
        throw new Error(
          translate(
            'voiceover_generated_but_no_room',
            'Voiceover generated, but there is no room on the timeline — the file is in your media library'
          )
        );
      }
      if (!mountedRef.current) return;
      if (landed === 'relocated') {
        toaster.show(
          translate(
            'voiceover_relocated_no_room_at_playhead',
            'No room at the playhead — the voiceover was placed where it fits'
          ),
          'success'
        );
        return;
      }
      toaster.show(translate('voiceover_added_to_timeline', 'Voiceover added to timeline'), 'success');
    },
    [vo, store, fetch, toaster, translate]
  );

  const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';

  const handleRecordVoiceover = useCallback(() => {
    if (!vo || !mediaRecorderSupported) return;
    modals.openModal({
      children: (
        <VoiceoverRecordDialog
          onClose={() => modals.closeAll()}
          onAdd={recordVoiceover}
        />
      ),
    });
  }, [vo, modals, recordVoiceover, mediaRecorderSupported]);

  const handleGenerateVoiceover = useCallback(() => {
    if (!vo) return;
    modals.openModal({
      children: (
        <VoiceoverDialog
          onClose={() => modals.closeAll()}
          onGenerate={generateVoiceover}
        />
      ),
    });
  }, [vo, modals, generateVoiceover]);

  // Write a batch of caption clips into the output's caption track (creating
  // it when absent) as ONE undo step — per-clip addClip would push a history
  // entry per phrase. Same direct-setState discipline as handleFreezeFrame.
  const commitCaptionClips = useCallback(
    (clips: VideoClip[]) => {
      const state = store.getState();
      const currentVo = state.doc.outputs[currentOutput] as VideoOutput;
      const updated = withCaptionClips(currentVo, clips, genId);
      const outs = [...state.doc.outputs];
      outs[currentOutput] = updated;
      store.setState({ doc: { ...state.doc, outputs: outs }, isDirty: true });
      store.getState().pushHistory();
    },
    [store, currentOutput],
  );

  const handleGenerateCaptions = useCallback(async () => {
    if (!vo) return;
    setCaptionsMenu(null);
    // Audio-bearing clips: every audio clip with a source, plus video clips
    // whose own audio is audible (an unset volume defaults to 1, matching the
    // preview engine). Freeze (speed:0) clips hold one frame — no advancing
    // audio to transcribe.
    const audioBearing = vo.tracks.flatMap((t) =>
      t.clips.filter(
        (c) =>
          !!c.src &&
          c.speed !== 0 &&
          (t.type === 'audio' || (t.type === 'video' && (c.volume ?? 1) > 0))
      )
    );
    if (audioBearing.length === 0) {
      toaster.show(translate('no_audio_clips_to_transcribe', 'No audio clips to transcribe'), 'warning');
      return;
    }
    // A selected audio-bearing clip narrows the batch to just that clip.
    const selected =
      selectedClip?.outputIndex === currentOutput
        ? audioBearing.find((c) => c.id === selectedClip.clipId)
        : undefined;
    const targets = selected ? [selected] : audioBearing;

    const captions: VideoClip[] = [];
    let failed = 0;
    let silent = 0;
    const defaults = captionClipDefaults(vo);
    for (const clip of targets) {
      // A clip that fails (or has no speech) is skipped — the batch continues.
      try {
        const res = await fetch('/media/speech-to-text-words', {
          method: 'POST',
          body: JSON.stringify({ audioUrl: clip.src }),
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        const { words } = (await res.json()) as { words?: TranscribedWord[] };
        if (!words?.length) {
          silent++;
          continue;
        }
        // Speech-to-text timings cover the FULL source; the mapping re-bases
        // them for the clip's trim-in and speed and offsets by its startMs.
        for (const phrase of mapTranscriptionToCaptionPhrases(words, clip, vo.durationMs)) {
          captions.push({
            id: genId(),
            startMs: phrase.startMs,
            endMs: phrase.endMs,
            text: phrase.text,
            words: phrase.words,
            ...defaults,
          } as VideoClip);
        }
      } catch {
        failed++;
      }
      if (!mountedRef.current) return;
    }

    if (!captions.length) {
      toaster.show(
        failed > 0
          ? translate('caption_generation_failed', 'Caption generation failed')
          : translate('no_speech_detected', 'No speech detected'),
        'warning'
      );
      return;
    }
    commitCaptionClips(captions);
    if (failed > 0 || silent > 0) {
      toaster.show(
        translate('some_clips_could_not_be_transcribed', 'Captions added — some clips could not be transcribed'),
        'warning'
      );
      return;
    }
    toaster.show(translate('captions_added_to_timeline', 'Captions added to timeline'), 'success');
  }, [vo, currentOutput, fetch, toaster, translate, selectedClip, commitCaptionClips]);

  const handleImportCaptions = useCallback(() => {
    setCaptionsMenu(null);
    captionFileRef.current?.click();
  }, []);

  const handleCaptionFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so re-picking the same file fires onChange again.
      e.target.value = '';
      if (!file || !vo) return;
      const cues = parseSubtitles(await file.text());
      if (!cues.length) {
        toaster.show(translate('no_captions_found_in_file', 'No captions found in that file'), 'warning');
        return;
      }
      const { clips, skipped } = cuesToCaptionClips(cues, vo, genId);
      if (!clips.length) {
        toaster.show(
          translate('cues_beyond_composition_end', 'All cues start past the end of the composition'),
          'warning'
        );
        return;
      }
      commitCaptionClips(clips);
      toaster.show(translate('captions_imported', 'Captions imported'), 'success');
      if (skipped > 0) {
        toaster.show(
          translate('some_cues_skipped_beyond_end', 'Some cues start past the end of the composition and were skipped'),
          'warning'
        );
      }
    },
    [vo, toaster, translate, commitCaptionClips],
  );

  const hasCaptionClips = useMemo(
    () => !!vo && vo.tracks.some((t) => t.type === 'caption' && t.clips.length > 0),
    [vo],
  );

  const handleExportCaptions = useCallback(() => {
    setCaptionsMenu(null);
    if (!vo) return;
    const clips = vo.tracks
      .filter((t) => t.type === 'caption')
      .flatMap((t) => t.clips);
    if (!clips.length) return;
    const blob = new Blob([serializeSrt(clips)], { type: 'text/srt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${store.getState().designName || 'captions'}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [vo, store]);

  const landOrPoll = useCallback(async (
    type: 'video' | 'audio',
    idOrUrl: string | false,
    fileId?: string
  ) => {
    // Generated clips are inserted at startMs 0 while the canvas previews the
    // playhead — after a land, seek to the clip and select it so the result is
    // visibly on the canvas instead of looking like nothing happened.
    const landAndReveal = async (url: string, landedFileId?: string) => {
      const landed = await addMediaToTimeline(store, { type, url, fileId: landedFileId });
      if (landed?.probeFailed) {
        toaster.show(
          translate('couldnt_read_video_metadata', "Couldn't read the video's metadata — placed with a default duration"),
          'warning'
        );
      }
      if (landed) {
        store.getState().setPlayhead(landed.startMs);
        store.getState().setSelectedClip({
          outputIndex: landed.outputIndex,
          trackId: landed.trackId,
          clipId: landed.clipId,
        });
      } else {
        // addClip rejected the insert — the asset itself is safe in Files (the
        // job lifecycle landed it there), so say where it went instead of
        // staying silent.
        toaster.show(
          translate('generated_clip_couldnt_be_placed', "The generated clip couldn't be placed on the timeline — find it in your media library."),
          'warning'
        );
      }
    };
    if (idOrUrl === false) {
      toaster.show(translate('generation_was_blocked_or_returned_empty', 'Generation was blocked or returned empty.'), 'warning');
      return;
    }
    if (isArtifactPath(idOrUrl)) {
      await landAndReveal(idOrUrl, fileId);
      return;
    }
    let outcome: JobPollOutcome;
    try {
      outcome = await pollMediaJobArtifact({
        jobId: idOrUrl,
        fetch,
        isMounted: () => mountedRef.current,
        messages: {
          checkFailed: translate('failed_to_check_job_status', 'Failed to check job status'),
          noArtifact: translate('job_completed_but_no_artifact', 'Job completed but no artifact'),
          generationFailed: translate('generation_failed', 'Generation failed'),
        },
      });
    } catch (e) {
      if (mountedRef.current) toaster.show((e as Error).message, 'warning');
      return;
    }
    if (outcome.kind === 'unmounted') return;
    if (outcome.kind === 'timeout') {
      if (mountedRef.current) toaster.show(translate('generation_timed_out', 'Generation timed out'), 'warning');
      return;
    }
    await landAndReveal(outcome.url, outcome.fileId ?? undefined);
  }, [fetch, store, toaster, translate]);

  const runClipTransform = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    clearMenu = true
  ) => {
    if (!clipMenu) return;
    const state = store.getState();
    const vo = state.doc.outputs[clipMenu.outputIndex] as VideoOutput;
    const track = vo.tracks.find((t) => t.id === clipMenu.trackId);
    const clip = track?.clips.find((c) => c.id === clipMenu.clipId);
    if (!clip?.src) {
      toaster.show(translate('clip_has_no_source', 'Selected clip has no source'), 'warning');
      return;
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(translate('transform_failed', 'Transform failed'));
      const { id } = await res.json();
      if (isArtifactPath(id)) {
        state.updateClipSilent(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId, {
          src: id,
          fileId: undefined,
        });
        state.pushHistory();
      } else {
        let polls = 0;
        while (polls < JOB_MAX_POLLS) {
          if (!mountedRef.current) return; // timeline unmounted — stop polling
          const jobRes = await fetch(`/media/jobs/${id}`);
          if (!jobRes.ok) throw new Error(translate('failed_to_check_transform_status', 'Failed to check transform status'));
          const job = await jobRes.json();
          if (job.status === 'completed') {
            if (!job.artifactUrl) throw new Error(translate('no_artifact', 'No artifact'));
            state.updateClipSilent(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId, {
              src: job.artifactUrl,
              fileId: undefined,
            });
            state.pushHistory();
            break;
          }
          if (job.status === 'failed') throw new Error(job.error || translate('transform_failed', 'Transform failed'));
          polls++;
          await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
        }
      }
    } catch (e) {
      if (mountedRef.current) toaster.show((e as Error).message || translate('transform_failed', 'Transform failed'), 'warning');
    } finally {
      if (clearMenu && mountedRef.current) setClipMenu(null);
    }
  }, [clipMenu, fetch, store, toaster, translate]);

  /**
   * Trim-aware AI regenerate: split the clip around the chosen window (each
   * split is its own undo step), POST the source-time bounds to
   * /media/video-segment-transform, then swap the middle segment's src to the
   * transformed artifact on completion (a second undo step). The middle clip's
   * endMs is reset to the probed result duration — when it differs from the
   * segment span, nothing ripple-shifts: later clips stay put, so a longer
   * result overlaps them and a shorter one leaves a gap (and the output
   * duration grows if the segment now runs past it).
   */
  const runSegmentTransform = useCallback(async (
    menu: { outputIndex: number; trackId: string; clipId: string },
    window: SegmentWindow,
    prompt: string
  ) => {
    const state = store.getState();
    const vo = state.doc.outputs[menu.outputIndex] as VideoOutput;
    const track = vo.tracks.find((t) => t.id === menu.trackId);
    const clip = track?.clips.find((c) => c.id === menu.clipId);
    if (!clip?.src) {
      toaster.show(translate('clip_has_no_source', 'Selected clip has no source'), 'warning');
      return;
    }
    const clipDurationMs = clip.endMs - clip.startMs;
    const wholeClip = isWholeClipWindow(window, clipDurationMs);
    const trim = segmentSourceTrim(clip, window);
    const plan = planSegmentSplits(clip, window);

    let targetClipId = menu.clipId;
    if (!wholeClip) {
      // Split at the start bound first: splitClip re-ids both halves, so the
      // end split must target the freshly-read right part.
      if (plan.startSplitMs !== null) {
        state.splitClip(menu.outputIndex, menu.trackId, menu.clipId, plan.startSplitMs);
      }
      if (plan.endSplitMs !== null) {
        const t1 = (store.getState().doc.outputs[menu.outputIndex] as VideoOutput).tracks
          .find((t) => t.id === menu.trackId);
        const right = plan.startSplitMs !== null
          ? t1?.clips.find((c) => c.startMs === plan.startSplitMs)
          : t1?.clips.find((c) => c.id === menu.clipId);
        if (right) {
          store.getState().splitClip(menu.outputIndex, menu.trackId, right.id, plan.endSplitMs);
        }
      }
      const t2 = (store.getState().doc.outputs[menu.outputIndex] as VideoOutput).tracks
        .find((t) => t.id === menu.trackId);
      const middleId = t2 ? findMiddleClipId(t2.clips, plan) : null;
      if (!middleId) {
        toaster.show(translate('segment_isolate_failed', 'Could not isolate the segment'), 'warning');
        return;
      }
      targetClipId = middleId;
    }

    const finish = async (artifactUrl: string) => {
      // Whole-clip window: identical to the existing whole-clip transform (src
      // swap only, timing untouched).
      if (wholeClip) {
        const cur = store.getState();
        cur.updateClipSilent(menu.outputIndex, menu.trackId, targetClipId, {
          src: artifactUrl,
          fileId: undefined,
        });
        cur.pushHistory();
        return;
      }
      // The transform output duration may differ slightly from the segment —
      // the clip is re-timed to the probed result (no ripple).
      const { durationMs } = await probeVideoMetadata(artifactUrl);
      const cur = store.getState();
      const curVo = cur.doc.outputs[menu.outputIndex] as VideoOutput;
      const middle = curVo.tracks
        .find((t) => t.id === menu.trackId)
        ?.clips.find((c) => c.id === targetClipId);
      if (!middle || !mountedRef.current) return;
      const endMs = middle.startMs + durationMs;
      if (endMs > curVo.durationMs) {
        cur.setVideoDuration(menu.outputIndex, endMs);
      }
      cur.updateClipSilent(menu.outputIndex, menu.trackId, targetClipId, {
        src: artifactUrl,
        fileId: undefined,
        trimInMs: 0,
        endMs,
      });
      cur.pushHistory();
    };

    try {
      const res = await fetch(
        wholeClip ? '/media/video-to-video' : '/media/video-segment-transform',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            wholeClip
              ? { videoUrl: clip.src, prompt }
              : { videoUrl: clip.src, prompt, trimStartMs: trim.trimStartMs, trimEndMs: trim.trimEndMs }
          ),
        }
      );
      if (!res.ok) throw new Error(translate('transform_failed', 'Transform failed'));
      const { id } = await res.json();
      if (isArtifactPath(id)) {
        await finish(id);
        return;
      }
      let polls = 0;
      while (polls < JOB_MAX_POLLS) {
        if (!mountedRef.current) return; // timeline unmounted — stop polling
        const jobRes = await fetch(`/media/jobs/${id}`);
        if (!jobRes.ok) throw new Error(translate('failed_to_check_transform_status', 'Failed to check transform status'));
        const job = await jobRes.json();
        if (job.status === 'completed') {
          if (!job.artifactUrl) throw new Error(translate('no_artifact', 'No artifact'));
          await finish(job.artifactUrl);
          break;
        }
        if (job.status === 'failed') throw new Error(job.error || translate('transform_failed', 'Transform failed'));
        polls++;
        await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
      }
    } catch (e) {
      if (mountedRef.current) toaster.show((e as Error).message || translate('transform_failed', 'Transform failed'), 'warning');
    }
  }, [store, fetch, toaster, translate]);

  const handleRegenerateSegment = useCallback(() => {
    if (!clipMenu) return;
    const state = store.getState();
    const vo = state.doc.outputs[clipMenu.outputIndex] as VideoOutput;
    const track = vo.tracks.find((t) => t.id === clipMenu.trackId);
    const clip = track?.clips.find((c) => c.id === clipMenu.clipId);
    if (!clip?.src) return;
    const menu = { outputIndex: clipMenu.outputIndex, trackId: clipMenu.trackId, clipId: clipMenu.clipId };
    const clipDurationMs = clip.endMs - clip.startMs;
    const playheadOffset = Math.max(0, Math.min(store.getState().playheadMs - clip.startMs, clipDurationMs));
    const def = defaultSegmentWindow(clipDurationMs, playheadOffset);
    setClipMenu(null);
    modals.openModal({
      title: translate('regenerate_segment_with_ai', 'Regenerate segment with AI'),
      children: (
        <SegmentRegenerateDialog
          clipDurationMs={clipDurationMs}
          defaultStartMs={def.startMs}
          defaultEndMs={def.endMs}
          onClose={() => modals.closeAll()}
          onConfirm={(window, prompt) => runSegmentTransform(menu, window, prompt)}
        />
      ),
    });
  }, [clipMenu, store, modals, translate, runSegmentTransform]);

  const handleGenerateVideo = useCallback(() => {
    modals.openModal({
      title: translate('ai_video_label', 'AI Video'),
      children: (
        <AiVideoDialog
          fetch={fetch}
          toaster={toaster}
          selectedImageSrc={selectedImageSrc}
          onResult={landOrPoll}
          outputWidth={vo?.width}
          outputHeight={vo?.height}
        />
      ),
    });
  }, [modals, fetch, toaster, selectedImageSrc, landOrPoll, translate, vo?.width, vo?.height]);

  const handleGenerateMusic = useCallback(() => {
    modals.openModal({
      title: translate('generate_music_modal', 'Generate Music'),
      children: (
        <MusicDialog
          fetch={fetch}
          toaster={toaster}
          onResult={landOrPoll}
        />
      ),
    });
  }, [modals, fetch, toaster, landOrPoll, translate]);

  const handleGenerateAvatar = useCallback(() => {
    modals.openModal({
      title: translate('generate_avatar_video_modal', 'Generate Avatar Video'),
      children: (
        <AvatarDialog
          fetch={fetch}
          toaster={toaster}
          selectedImageSrc={selectedImageSrc}
          onResult={landOrPoll}
        />
      ),
    });
  }, [modals, fetch, toaster, selectedImageSrc, landOrPoll, translate]);

  const handleGenerateSlideshow = useCallback(() => {
    modals.openModal({
      title: translate('generate_slideshow_modal', 'Generate Slideshow'),
      children: (
        <SlideshowDialog
          fetch={fetch}
          toaster={toaster}
          onResult={landOrPoll}
          outputWidth={vo?.width}
          outputHeight={vo?.height}
        />
      ),
    });
  }, [modals, fetch, toaster, landOrPoll, translate, vo?.width, vo?.height]);

  /**
   * Open a dialog the Tools menu asked for.
   *
   * The menu can't reach these handlers — they close over `landOrPoll`, which
   * lands a finished asset on a track — so it names what it wants on the store
   * and this clears the request once it has been served.
   */
  const generateRequest = store((s) => s.generateRequest);
  const openRequested = useRef<((kind: string) => void) | null>(null);
  // Writing the ref in an effect rather than during render is what
  // react-hooks/refs requires (same pattern as canvas.tsx's penDraftRef).
  useEffect(() => {
    openRequested.current = (kind: string) => {
      if (kind === 'video') handleGenerateVideo();
      else if (kind === 'music') handleGenerateMusic();
      else if (kind === 'voiceover') handleGenerateVoiceover();
      else if (kind === 'record-voiceover') handleRecordVoiceover();
    };
  }, [handleGenerateVideo, handleGenerateMusic, handleGenerateVoiceover, handleRecordVoiceover]);
  useEffect(() => {
    if (!generateRequest) return;
    openRequested.current?.(generateRequest);
    store.getState().requestGenerate(null);
  }, [generateRequest, store]);

  if (!isVideo || !vo) {
    return null;
  }

  return (
    <div
      ref={timelineRef}
      className="shrink-0 border-t border-studioBorder bg-newBgColorInner flex flex-col"
      role="toolbar"
      tabIndex={0}
      aria-label={translate('video_timeline', 'Video timeline')}
      onKeyDown={handleKeyDown}
    >
      {/* Height splitter — drag to resize the timeline panel (persisted). */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={translate('resize_timeline', 'Resize timeline')}
        className="h-1 shrink-0 cursor-row-resize bg-studioBorder/40 hover:bg-designerAccent/60"
        onMouseDown={handleSplitterMouseDown}
      />
      {/* Caption import picker — opened from the Captions menu. */}
      <input
        ref={captionFileRef}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleCaptionFilePicked}
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-studioBorder">
        <button
          onClick={handlePlayPause}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-textColor hover:bg-studioBorder/30 text-[13px]"
          title={isPlaying ? translate('pause', 'Pause') : translate('play', 'Play')}
          aria-label={isPlaying ? translate('pause', 'Pause') : translate('play', 'Play')}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => setLoopPlayback((v) => !v)}
          aria-pressed={loopPlayback}
          className={`w-7 h-7 flex items-center justify-center rounded-sm text-[13px] ${
            loopPlayback ? 'bg-designerAccent/20 text-textColor' : 'text-textColor/60 hover:text-textColor hover:bg-studioBorder/30'
          }`}
          title={translate('loop_playback', 'Loop playback')}
          aria-label={translate('loop_playback', 'Loop playback')}
        >
          🔁
        </button>
        <PlayheadTimecode store={store} />
        <span className="text-[11px] text-textColor/40">
          / {formatTime(vo.durationMs)}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => store.getState().setTimelineSnap(!timelineSnap)}
          aria-pressed={timelineSnap}
          className={`w-6 h-6 flex items-center justify-center rounded-sm text-[12px] ${
            timelineSnap ? 'bg-designerAccent/20 text-textColor' : 'text-textColor/60 hover:text-textColor hover:bg-studioBorder/30'
          }`}
          title={translate('toggle_snapping', 'Snapping')}
          aria-label={translate('toggle_snapping', 'Snapping')}
        >
          🧲
        </button>
        <button
          onClick={handleZoomToFit}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:text-textColor text-[12px]"
          title={translate('zoom_to_fit', 'Zoom to fit')}
          aria-label={translate('zoom_to_fit', 'Zoom to fit')}
        >
          ⛶
        </button>
        <FullscreenButton className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent shrink-0" />
        <button
          onClick={handleZoomOut}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:text-textColor text-[13px]"
          title={translate('zoom_out', 'Zoom out')}
          aria-label={translate('zoom_out', 'Zoom out')}
        >
          &#x2212;
        </button>
        <button
          onClick={handleZoomIn}
          className="w-6 h-6 flex items-center justify-center rounded-sm text-textColor/60 hover:text-textColor text-[13px]"
          title={translate('zoom_in', 'Zoom in')}
          aria-label={translate('zoom_in', 'Zoom in')}
        >
          +
        </button>
        {/* Keyframe lane under the tracks — one row per animated property of
            the selected clip. Editor-only view state, never persisted. */}
        <button
          onClick={() => setKeyframeLaneOpen((v) => !v)}
          aria-pressed={keyframeLaneOpen}
          className={`w-6 h-6 flex items-center justify-center rounded-sm text-[11px] ${
            keyframeLaneOpen
              ? 'bg-designerAccent/20 text-textColor'
              : 'text-textColor/60 hover:text-textColor hover:bg-studioBorder/30'
          }`}
          title={translate('toggle_keyframe_lane', 'Keyframe lane')}
          aria-label={translate('toggle_keyframe_lane', 'Keyframe lane')}
        >
          ◇
        </button>
        <button
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setAddTrackMenu({ x: rect.left + rect.width / 2, y: rect.bottom });
          }}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor"
          title={translate('add_track', 'Add track')}
          aria-haspopup="menu"
          aria-expanded={!!addTrackMenu}
        >
          {translate('plus_track', '+ Track')}
        </button>
        <button
          onClick={handleGenerateVoiceover}
          disabled={!ttsAvailable}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            ttsAvailable
              ? translate('generate_ai_voiceover', 'Generate AI voiceover')
              : translate('configure_a_text_to_speech_provider_in_settings_media', 'Configure a text-to-speech provider in Settings → Media')
          }
        >
          {translate('voiceover', 'Voiceover')}
        </button>
        {/* Mic recording is browser-capability-gated only — no provider needed,
            unlike the TTS button above. */}
        <button
          onClick={handleRecordVoiceover}
          disabled={!mediaRecorderSupported}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            mediaRecorderSupported
              ? translate('record_voiceover_title', 'Record a voiceover with your microphone')
              : translate('recording_not_supported', 'Recording is not supported in this browser')
          }
        >
          {translate('record_voiceover', '● Record')}
        </button>
        <button
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCaptionsMenu({ x: rect.left + rect.width / 2, y: rect.bottom });
          }}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor"
          title={translate('caption_options', 'Auto-generate, import or export captions')}
          aria-haspopup="menu"
          aria-expanded={!!captionsMenu}
        >
          {translate('captions', 'Captions')}
        </button>
        <button
          onClick={handleGenerateVideo}
          disabled={!textToVideoAvailable && !imageToVideoAvailable}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            textToVideoAvailable || imageToVideoAvailable
              ? translate('generate_ai_video_from_a_prompt_or_selected_image', 'Generate AI video from a prompt (or selected image)')
              : tool('text-to-video')?.reason ||
                tool('image-to-video')?.reason ||
                translate('configure_a_video_provider_in_settings_media', 'Configure a video provider in Settings → Media')
          }
        >
          {translate('ai_video_label', 'AI Video')}
        </button>
        <button
          onClick={handleGenerateMusic}
          disabled={!textToMusicAvailable}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            textToMusicAvailable
              ? translate('generate_ai_music', 'Generate AI music')
              : tool('text-to-music')?.reason ||
                translate('configure_a_music_provider_in_settings_media', 'Configure a music provider in Settings → Media')
          }
        >
          {translate('music', 'Music')}
        </button>
        <button
          onClick={handleGenerateAvatar}
          disabled={!videoAvatarAvailable}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            videoAvatarAvailable
              ? translate('generate_avatar_video_hint', 'Generate avatar video')
              : tool('video-avatar')?.reason ||
                translate('configure_an_avatar_provider_in_settings_media', 'Configure an avatar provider in Settings → Media')
          }
        >
          {translate('avatar', 'Avatar')}
        </button>
        <button
          onClick={handleGenerateSlideshow}
          disabled={!imageSlideAvailable}
          className="px-2 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            imageSlideAvailable
              ? translate('generate_slideshow_from_prompt_images', 'Generate slideshow from prompt + images')
              : tool('image-slide')?.reason ||
                translate('configure_a_slideshow_provider_in_settings_media', 'Configure a slideshow provider in Settings → Media')
          }
        >
          {translate('slideshow', 'Slideshow')}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ height: timelineHeight }}
      >
        <div style={{ position: 'relative', width: LABEL_WIDTH + totalPixels + 40, minWidth: '100%' }}>
          {/* Ruler */}
          <div
            ref={rulerRef}
            role="slider"
            aria-label={translate('seek_timeline', 'Seek timeline')}
            aria-orientation="horizontal"
            aria-valuenow={Math.round(store.getState().playheadMs)}
            aria-valuemin={0}
            aria-valuemax={Math.round(vo.durationMs)}
            aria-valuetext={formatTime(store.getState().playheadMs)}
            tabIndex={0}
            className="sticky top-0 z-10 bg-newBgColorInner border-b border-studioBorder/40 select-none"
            style={{ height: RULER_HEIGHT, marginLeft: LABEL_WIDTH }}
            onMouseDown={handleRulerMouseDown}
            onKeyDown={handleRulerKeyDown}
            onKeyUp={handleSliderKeyUp}
            onContextMenu={handleRulerContextMenu}
          >
            <div className="relative h-full pointer-events-none">
              {rulerMarks.map((m) => (
                <div
                  key={m.ms}
                  className="absolute top-0"
                  style={{ left: m.ms * pixelsPerMs }}
                >
                  <div className={`w-px ${m.major ? 'h-full bg-textColor/30' : 'h-3 bg-textColor/15'}`} />
                  {m.label && (
                    <div className="text-[9px] text-textColor/40 mt-0.5 -translate-x-1/2 select-none">
                      {m.label}
                    </div>
                  )}
                </div>
              ))}
              {/* Markers — document state, rendered as diamonds on the ruler. */}
              {(vo.markers || []).map((m) => (
                <div
                  key={m.id}
                  className="absolute top-0 h-full"
                  style={{ left: m.tMs * pixelsPerMs }}
                  title={m.name || formatTime(m.tMs)}
                >
                  <div className="w-2 h-2 rotate-45 bg-cyan-400 -translate-x-1/2 mt-0.5" />
                  {m.name && (
                    <div className="text-[8px] text-cyan-300 -translate-x-1/2 mt-0.5 whitespace-nowrap select-none">
                      {m.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tracks */}
          {vo.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              label={trackLabels[track.id] ?? trackTypeLabel(track.type)}
              pairs={sortedAdjacentPairs[track.id] || []}
              durationMs={vo.durationMs}
              totalPixels={totalPixels}
              pixelsPerMs={pixelsPerMs}
              dragOver={dragOverTrackId === track.id}
              isSelected={isSelected}
              isPrimary={isPrimary}
              transitionLabel={transitionLabel}
              translate={translate}
              dragMovedRef={dragMovedRef}
              onSelectClip={handleSelectClip}
              onClipKeyDown={handleClipKeyDown}
              onSliderKeyUp={handleSliderKeyUp}
              onClipMouseDown={handleClipMouseDown}
              onClipContextMenu={handleClipContextMenu}
              onEdgeKeyDown={handleEdgeKeyDown}
              onToggleLock={handleToggleTrackLock}
              onToggleHidden={handleToggleTrackHidden}
              setTrackSettings={setTrackSettings}
              setTransitionPopover={setTransitionPopover}
            />
          ))}

          {/* Virtual "new track" drop target — visible while a dragged clip
              hovers just below the last track row; the drop creates the track. */}
          {dragOverNewTrack && dragging && (
            <div
              className="flex items-stretch"
              style={{ height: TRACK_HEIGHT + TRACK_GAP }}
              aria-hidden={true}
            >
              <div
                className="flex items-center justify-end px-2 text-[10px] font-medium uppercase tracking-wider shrink-0 border-r border-studioBorder/30 text-designerAccent"
                style={{ width: LABEL_WIDTH }}
              >
                {translate('new_track_drop_indicator', '+ {{type}}', { type: trackTypeLabel(dragging.trackType) })}
              </div>
              <div
                className="relative flex-1 self-center rounded-xs border border-dashed border-designerAccent/60 bg-designerAccent/10"
                style={{ width: totalPixels + 40, height: TRACK_HEIGHT }}
              />
            </div>
          )}

          {/* Keyframe lane — inside the same scroll container and on the same
              pixelsPerMs as the tracks, so alignment needs no syncing. */}
          {keyframeLaneOpen && (
            <KeyframeLane
              store={store}
              pixelsPerMs={pixelsPerMs}
              labelWidth={LABEL_WIDTH}
              contentWidth={totalPixels + 40}
            />
          )}

          {/* Marquee selection rect (scroll-content coordinates) */}
          {marquee && (
            <div
              className="absolute z-30 pointer-events-none border border-designerAccent bg-designerAccent/15 rounded-xs"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top,
              }}
            />
          )}

          {/* Playhead */}
          <PlayheadIndicator store={store} pixelsPerMs={pixelsPerMs} />
        </div>
      </div>

      {/* Duration indicator */}
      <div className="flex items-center justify-end px-3 py-1 text-[10px] text-textColor/40">
        {translate('n_tracks_count', '{{count}} track', { count: vo.tracks.length })}{' \u00B7 '}
        {translate('n_clips_count', '{{count}} clip', {
          count: vo.tracks.reduce((sum, t) => sum + t.clips.length, 0),
        })}{' \u00B7 '}
        {formatTime(vo.durationMs)}
      </div>

      {/* Track settings popover */}
      {trackSettings && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setTrackSettings(null)}
          />
          <div
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[160px]"
            style={{
              left: trackSettings.x,
              top: (trackSettings.y ?? 0) + 8,
              transform: 'translateX(-50%)',
            }}
          >
            {(() => {
              const track = vo.tracks.find((t) => t.id === trackSettings.trackId);
              if (!track) return null;
              return (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-textColor/60 mb-1 truncate max-w-[180px]">
                    {trackLabels[track.id] ?? trackTypeLabel(track.type)}
                  </div>
                  {track.type === 'audio' && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-textColor/70">{translate('gain', 'Gain')}</span>
                        <span className="text-[10px] text-textColor/40">{Math.round((track.gain ?? 1) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={Math.round((track.gain ?? 1) * 100)}
                        onChange={(e) => store.getState().setTrackGain(currentOutput, track.id, Number(e.target.value) / 100, false)}
                        onPointerUp={() => store.getState().pushHistory()}
                        onKeyUp={() => store.getState().pushHistory()}
                        onBlur={() => store.getState().pushHistory()}
                        className="w-full accent-designerAccent"
                      />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!track.autoDuck}
                          onChange={(e) => store.getState().setTrackAutoDuck(currentOutput, track.id, e.target.checked)}
                          className="accent-designerAccent w-3 h-3"
                        />
                        <span className="text-[10px] text-textColor/70">{translate('auto_duck_under_voice', 'Auto-duck under voice')}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!track.muted}
                          onChange={(e) => store.getState().setTrackMuted(currentOutput, track.id, e.target.checked)}
                          className="accent-designerAccent w-3 h-3"
                        />
                        <span className="text-[10px] text-textColor/70">{translate('mute_track', 'Mute track')}</span>
                      </label>
                    </>
                  )}
                  <div className="pt-1.5 border-t border-studioBorder flex flex-col gap-0.5">
                    <button
                      onClick={() => void handleRenameTrack(track.id)}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('rename_track', 'Rename track')}
                    </button>
                    <button
                      onClick={() => handleDeleteTrack(track.id)}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-dangerText"
                    >
                      {translate('delete_track', 'Delete track')}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* + Track menu */}
      {addTrackMenu && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setAddTrackMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-1.5 shadow-xl min-w-[140px]"
            style={{
              left: addTrackMenu.x,
              top: addTrackMenu.y + 4,
              transform: 'translateX(-50%)',
            }}
          >
            {(['video', 'image', 'text', 'audio', 'caption', 'sticker'] as const).map((type) => (
              <button
                key={type}
                role="menuitem"
                onClick={() => handleAddTrack(type)}
                className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TRACK_COLORS[type] }} />
                {trackTypeLabel(type)}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Captions menu: auto-generate / import / export */}
      {captionsMenu && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setCaptionsMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-1.5 shadow-xl min-w-[190px]"
            style={{
              left: captionsMenu.x,
              top: captionsMenu.y + 4,
              transform: 'translateX(-50%)',
            }}
          >
            <button
              role="menuitem"
              onClick={handleGenerateCaptions}
              disabled={!sttAvailable}
              title={
                sttAvailable
                  ? translate('auto_generate_captions_from_audio', 'Auto-generate captions from audio')
                  : translate('configure_a_speech_to_text_provider_in_settings_media', 'Configure a speech-to-text provider (e.g. Deepgram) in Settings → Media')
              }
              className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('auto_generate_captions', 'Auto-generate')}
            </button>
            <button
              role="menuitem"
              onClick={handleImportCaptions}
              className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
            >
              {translate('import_captions', 'Import Captions…')}
            </button>
            <button
              role="menuitem"
              onClick={handleExportCaptions}
              disabled={!hasCaptionClips}
              title={translate('export_captions_srt_hint', 'Download the caption tracks as an .srt file')}
              className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translate('export_captions_srt', 'Export Captions (.srt)')}
            </button>
          </div>
        </>
      )}

      {/* Ruler marker menu: add / rename / delete */}
      {rulerMenu && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setRulerMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-1.5 shadow-xl min-w-[170px]"
            style={{
              left: rulerMenu.x,
              top: rulerMenu.y + 4,
              transform: 'translateX(-50%)',
            }}
          >
            <button
              role="menuitem"
              onClick={handleRulerMenuAddMarker}
              className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
            >
              {translate('add_marker_at_time', 'Add marker at {{time}}', { time: formatTime(rulerMenu.ms) })}
            </button>
            {rulerMenu.markerId && (
              <>
                <button
                  role="menuitem"
                  onClick={() => void handleRulerMenuRenameMarker()}
                  className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                >
                  {translate('rename_marker', 'Rename marker')}
                </button>
                <button
                  role="menuitem"
                  onClick={handleRulerMenuDeleteMarker}
                  className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-dangerText"
                >
                  {translate('delete_marker', 'Delete marker')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Transition popover */}
      {transitionPopover && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setTransitionPopover(null)}
          />
          <div
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[180px]"
            style={{
              left: transitionPopover.x,
              top: transitionPopover.y + 8,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="text-[11px] font-medium text-textColor/60 mb-1.5 px-1">{translate('transition', 'Transition')}</div>
            {(['cut', 'fade', 'dissolve', 'wipe', 'zoom', 'blur', 'slide'] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleSetTransition(transitionPopover.trackId, transitionPopover.fromClipId, transitionPopover.toClipId, type)}
                className={`w-full text-left px-2 py-1 rounded text-[12px] ${
                  transitionPopover.trackId ? 'hover:bg-studioBorder/30 text-textColor' : 'text-textColor'
                }`}
              >
                {transitionLabel(type)}
              </button>
            ))}
            {(() => {
              const track = vo.tracks.find((t) => t.id === transitionPopover.trackId);
              const from = track?.clips.find((c) => c.id === transitionPopover.fromClipId);
              const to = track?.clips.find((c) => c.id === transitionPopover.toClipId);
              const type = from?.transitionOut?.type || to?.transitionIn?.type || 'cut';
              if (type === 'cut') return null;
              const durationMs =
                from?.transitionOut?.durationMs ??
                to?.transitionIn?.durationMs ??
                TRANSITION_DEFAULT_MS;
              return (
                <div className="mt-1.5 pt-1.5 border-t border-studioBorder px-1">
                  <Stepper
                    label={translate('transition_duration_ms', 'Duration (ms)')}
                    min={TRANSITION_MIN_MS}
                    max={TRANSITION_MAX_MS}
                    step={100}
                    value={durationMs}
                    onChange={(n) =>
                      handleSetTransitionDuration(
                        transitionPopover.trackId,
                        transitionPopover.fromClipId,
                        transitionPopover.toClipId,
                        n,
                      )
                    }
                  />
                </div>
              );
            })()}
            {(() => {
              const track = vo.tracks.find((t) => t.id === transitionPopover.trackId);
              const from = track?.clips.find((c) => c.id === transitionPopover.fromClipId);
              const to = track?.clips.find((c) => c.id === transitionPopover.toClipId);
              const currentType = from?.transitionOut?.type || to?.transitionIn?.type || 'cut';
              // Direction only means something to the geometry transitions.
              if (currentType !== 'slide' && currentType !== 'wipe') return null;
              return (
                <div className="mt-1.5 pt-1.5 border-t border-studioBorder">
                  <div className="text-[10px] text-textColor/40 mb-1 px-1">{translate('transition_direction', 'Direction')}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {(['left', 'right', 'up', 'down'] as const).map((dir) => (
                      <button
                        key={dir}
                        onClick={() => handleSetTransition(transitionPopover.trackId, transitionPopover.fromClipId, transitionPopover.toClipId, currentType, dir)}
                        className="px-1.5 py-0.5 rounded-sm text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor hover:border-newTextColor/40 capitalize"
                      >
                        {directionLabel(dir)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* Clip context menu */}
      {clipMenu && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => {
              setClipMenu(null);
              setClipTransformMode(null);
            }}
          />
          <div
            className="fixed z-60 bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[160px]"
            style={{
              left: clipMenu.x,
              top: clipMenu.y + 8,
              transform: 'translateX(-50%)',
            }}
          >
            {(() => {
              const track = vo.tracks.find((t) => t.id === clipMenu.trackId);
              const clip = track?.clips.find((c) => c.id === clipMenu.clipId);
              const clipSrc = clip?.src;
              if (!clip) return null;
              if (clipSrc && clipTransformMode === 'upscale') {
                return (
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-textColor/60 mb-1 px-1">{translate('upscale_video', 'Upscale video')}</div>
                    <button
                      onClick={() => runClipTransform('/media/upscale-video', { videoUrl: clipSrc })}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('upscale_video', 'Upscale video')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              if (clipSrc && clipTransformMode === 'remove-bg') {
                return (
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-textColor/60 mb-1 px-1">{translate('remove_background', 'Remove background')}</div>
                    <button
                      onClick={() => runClipTransform('/media/remove-video-background', { videoUrl: clipSrc })}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('remove_background', 'Remove background')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              if (clipSrc && clipTransformMode === 'video-to-video') {
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-medium text-textColor/60 px-1">{translate('transform_with_prompt', 'Transform with prompt')}</div>
                    <input
                      type="text"
                      value={clipTransformPrompt}
                      onChange={(e) => setClipTransformPrompt(e.target.value)}
                      placeholder={translate('describe_the_transformation', 'Describe the transformation...')}
                      className="w-full bg-newBgColor border border-studioBorder rounded-sm px-2 py-1 text-[11px] text-textColor placeholder:text-textColor/40 outline-hidden"
                    />
                    <button
                      onClick={() => runClipTransform('/media/video-to-video', { videoUrl: clipSrc, prompt: clipTransformPrompt.trim() })}
                      disabled={!clipTransformPrompt.trim()}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {translate('transform', 'Transform')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              return (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleDuplicateClip}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                  >
                    {translate('duplicate_clip', 'Duplicate')}
                  </button>
                  <button
                    onClick={handleCopyClips}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                  >
                    {translate('copy_clips', 'Copy')}
                  </button>
                  <button
                    onClick={handleCopyClipKeyframes}
                    disabled={!clip.keyframes?.length}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {translate('copy_keyframes', 'Copy keyframes')}
                  </button>
                  <button
                    onClick={handlePasteClipKeyframes}
                    disabled={!hasKeyframeClipboard}
                    title={translate('paste_keyframes_hint', 'Merge the copied keyframes onto this clip')}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {translate('paste_keyframes', 'Paste keyframes')}
                  </button>
                  <button
                    onClick={handleSplitClipAtPlayhead}
                    title={translate('split_clip_hint', 'Split the clip at the playhead (S)')}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                  >
                    {translate('designer_video_split_clip', 'Split clip at playhead')}
                  </button>
                  <button
                    onClick={handleFreezeFrameClip}
                    title={translate('freeze_frame_hint', 'Hold the frame under the playhead (Ctrl+F)')}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                  >
                    {translate('designer_video_freeze_frame', 'Freeze frame at playhead')}
                  </button>
                  <button
                    onClick={handleDeleteClips}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-dangerText"
                  >
                    {translate('delete', 'Delete')}
                  </button>
                  <button
                    onClick={handleRippleDeleteClip}
                    title={translate('ripple_delete_hint', 'Delete and close the gap on this track (Shift+Delete)')}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-dangerText"
                  >
                    {translate('ripple_delete', 'Ripple delete')}
                  </button>
                  {clipSrc && (
                    <>
                      <div className="border-t border-studioBorder my-1" />
                      <button
                        onClick={() => setClipTransformMode('upscale')}
                        disabled={!videoUpscaleAvailable}
                        className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {translate('upscale', 'Upscale')}
                      </button>
                      <button
                        onClick={() => setClipTransformMode('remove-bg')}
                        disabled={!videoBackgroundAvailable}
                        className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {translate('remove_background', 'Remove background')}
                      </button>
                      <button
                        onClick={() => setClipTransformMode('video-to-video')}
                        disabled={!videoToVideoAvailable}
                        className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {translate('transform_with_prompt', 'Transform with prompt')}
                      </button>
                      {store.getState().playheadMs > clip.startMs && store.getState().playheadMs < clip.endMs && clip.speed !== 0 && (
                        <button
                          onClick={handleRegenerateSegment}
                          disabled={!videoToVideoAvailable}
                          title={translate('regenerate_segment_hint', 'Split at the bounds and transform only that segment')}
                          className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {translate('regenerate_segment_with_ai', 'Regenerate segment with AI…')}
                        </button>
                      )}
                    </>
                  )}
                  <div className="border-t border-studioBorder my-1" />
                  <button
                    onClick={() => setClipMenu(null)}
                    className="w-full text-left px-2 py-1 rounded-sm text-[12px] hover:bg-studioBorder/30 text-textColor"
                  >
                    {translate('cancel', 'Cancel')}
                  </button>
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
};

export default VideoTimeline;
