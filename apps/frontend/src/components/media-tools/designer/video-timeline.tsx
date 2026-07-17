'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoClip, VideoTrack, VideoOutput, DesignerElement } from './designer.store';
import { VideoPreviewEngine } from './video-preview';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useMediaToolsStatus } from '@gitroom/frontend/components/layout/use-media-tools-status';
import { VoiceoverDialog } from './voiceover-dialog';
import { addMediaToTimeline } from './add-media-to-timeline';
import { isArtifactPath } from '@gitroom/frontend/components/launches/ai.video';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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

const TRACK_COLORS: Record<VideoTrack['type'], string> = {
  video: '#4F46E5',
  image: '#059669',
  text: '#D97706',
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

const audioContextSingleton =
  typeof window !== 'undefined'
    ? new (window.AudioContext || (window as any).webkitAudioContext)()
    : null;

type WaveformFetch = (url: string, init?: RequestInit) => Promise<Response>;

// Decode each audio source ONCE into a fixed high-resolution peak array, keyed by
// src only (never by bar count). Trimming/zooming changes bar count continuously,
// so keying by count re-fetched + re-`decodeAudioData`'d the whole file on almost
// every mousemove. Bars are resampled from the cached peaks in memory instead.
const HIRES_BUCKETS = 2048;
const peaksCache = new Map<string, number[]>();
const peaksInflight = new Map<string, Promise<number[]>>();

async function getPeaks(src: string, fetchFn: WaveformFetch): Promise<number[]> {
  const cached = peaksCache.get(src);
  if (cached) return cached;
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

const WaveformBars: FC<{ src: string | undefined; width: number }> = ({ src, width }) => {
  const fetch = useFetch();
  const barCount = Math.max(6, Math.floor(width / 6));
  const bars = useWaveform(src, barCount, fetch);
  if (!bars) {
    return (
      <>
        {Array.from({ length: barCount }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-white/70 rounded-sm"
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
          className="flex-1 bg-white/70 rounded-sm"
          style={{ height: `${Math.max(4, h * 100)}%` }}
        />
      ))}
    </>
  );
};

interface AiVideoDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  selectedImageSrc?: string;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false) => Promise<void>;
}

const AiVideoDialog: FC<AiVideoDialogProps> = ({ fetch, toaster, selectedImageSrc, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [useImage, setUseImage] = useState(false);
  const [loading, setLoading] = useState(false);

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
      if (!res.ok) throw new Error(t('video_generation_failed', 'Video generation failed'));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('video_generation_failed', 'Video generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, useImage, selectedImageSrc, onResult, toaster, modals, t]);

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_video_you_want_to_generate', 'Describe the video you want to generate...')}
        className="w-full bg-newBgColor border border-studioBorder rounded p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-none min-h-[80px]"
      />
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
        className="px-3 py-1.5 rounded text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
      </button>
    </div>
  );
};

interface MusicDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false) => Promise<void>;
}

const MusicDialog: FC<MusicDialogProps> = ({ fetch, toaster, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

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
      if (!res.ok) throw new Error(t('music_generation_failed', 'Music generation failed'));
      const data = await res.json();
      await onResult('audio', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('music_generation_failed', 'Music generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, onResult, toaster, modals, t]);

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_music_you_want_to_generate', 'Describe the music you want to generate...')}
        className="w-full bg-newBgColor border border-studioBorder rounded p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-none min-h-[80px]"
      />
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="px-3 py-1.5 rounded text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
      </button>
    </div>
  );
};

interface AvatarDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  selectedImageSrc?: string;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false) => Promise<void>;
}

const AvatarDialog: FC<AvatarDialogProps> = ({ fetch, toaster, selectedImageSrc, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [script, setScript] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
      if (!res.ok) throw new Error(t('avatar_generation_failed', 'Avatar generation failed'));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('avatar_generation_failed', 'Avatar generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, script, imageUrl, onResult, toaster, modals, t]);

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder={t('enter_the_script_for_the_avatar', 'Enter the script for the avatar...')}
        className="w-full bg-newBgColor border border-studioBorder rounded p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-none min-h-[80px]"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setPickerOpen(true)}
          className="px-2 py-1 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
        >
          {t('pick_portrait', 'Pick portrait')}
        </button>
        {selectedImageSrc && (
          <button
            onClick={() => setImageUrl(selectedImageSrc)}
            className="px-2 py-1 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
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
        className="px-3 py-1.5 rounded text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
      </button>
      <MediaSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        kinds={['image']}
        onSelect={(item) => setImageUrl(item.url)}
      />
    </div>
  );
};

interface SlideshowDialogProps {
  fetch: ReturnType<typeof useFetch>;
  toaster: ReturnType<typeof useToaster>;
  onResult: (type: 'video' | 'audio', idOrUrl: string | false) => Promise<void>;
}

const SlideshowDialog: FC<SlideshowDialogProps> = ({ fetch, toaster, onResult }) => {
  const t = useT();
  const modals = useModals();
  const [prompt, setPrompt] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toaster.show(t('please_enter_a_prompt', 'Please enter a prompt'), 'warning');
      return;
    }
    setLoading(true);
    modals.closeAll();
    try {
      const res = await fetch('/media/generate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageUrls: imageUrls.length ? imageUrls : undefined }),
      });
      if (!res.ok) throw new Error(t('slideshow_generation_failed', 'Slideshow generation failed'));
      const data = await res.json();
      await onResult('video', data === false ? false : data.id);
    } catch (e) {
      toaster.show((e as Error).message || t('slideshow_generation_failed', 'Slideshow generation failed'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, prompt, imageUrls, onResult, toaster, modals, t]);

  return (
    <div className="flex flex-col gap-3 min-w-[280px]">
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('describe_the_slideshow', 'Describe the slideshow...')}
        className="w-full bg-newBgColor border border-studioBorder rounded p-2 text-[12px] text-textColor placeholder:text-textColor/40 outline-none"
      />
      <button
        onClick={() => setPickerOpen(true)}
        className="px-2 py-1 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30 self-start"
      >
        {t('add_images', 'Add images')}
      </button>
      {imageUrls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {imageUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-newBgColorInner border border-studioBorder text-[10px] text-textColor">
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
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="px-3 py-1.5 rounded text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? t('generating', 'Generating...') : t('generate', 'Generate')}
      </button>
      <MediaSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        kinds={['image']}
        multiple
        onConfirm={(items) => setImageUrls((prev) => [...prev, ...items.map((i) => i.url)])}
      />
    </div>
  );
};

const trackTypeKeys: Record<VideoTrack['type'], [string, string]> = {
  video: ['track_type_video', 'video'],
  image: ['file_type_image', 'image'],
  text: ['track_type_text', 'text'],
  caption: ['track_type_caption', 'caption'],
  audio: ['track_type_audio', 'audio'],
  sticker: ['track_type_sticker', 'sticker'],
};

const transitionKeys: Record<string, [string, string]> = {
  cut: ['transition_cut', 'Cut'],
  fade: ['transition_fade', 'Fade'],
  dissolve: ['transition_dissolve', 'Dissolve'],
  slide: ['transition_slide', 'Slide'],
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
  const playheadMs = store((s) => s.playheadMs);
  const selectedClip = store((s) => s.selectedClip);
  const selectedIds = store((s) => s.selectedIds);
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragging, setDragging] = useState<{
    trackId: string;
    clipId: string;
    edge: 'start' | 'end' | 'move';
    startX: number;
    origStart: number;
    origEnd: number;
  } | null>(null);
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
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<VideoPreviewEngine | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();

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

  const scrollToPlayhead = useCallback(() => {
    if (!scrollRef.current) return;
    const playheadPx = playheadMs * pixelsPerMs - 200;
    scrollRef.current.scrollLeft = Math.max(0, playheadPx);
  }, [playheadMs, pixelsPerMs]);

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
      onTick: (ms) => {
        setPlayhead(ms);
      },
      onEnd: () => {
        setIsPlaying(false);
      },
    });
    setIsPlaying(true);
    scrollToPlayhead();
  }, [isVideo, vo, isPlaying, store, setPlayhead, scrollToPlayhead]);

  // Guards the long-running poll loops (landOrPoll / runClipTransform) so they
  // stop touching the store / firing toasts after the timeline unmounts.
  const mountedRef = useRef(true);

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
    if (isPlaying) scrollToPlayhead();
  }, [playheadMs, isPlaying, scrollToPlayhead]);

  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
      const ms = Math.max(0, Math.min(vo?.durationMs ?? 60000, x / pixelsPerMs));
      setPlayhead(ms);
      if (previewRef.current) previewRef.current.seek(ms);
    },
    [pixelsPerMs, setPlayhead, vo?.durationMs],
  );

  const handleZoomIn = useCallback(() => {
    setZoomPxPerMs((z) => Math.min(z * 1.5, 4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomPxPerMs((z) => Math.max(z / 1.5, 0.01));
  }, []);

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
      let next = playheadMs;
      if (e.key === 'ArrowLeft') next -= step;
      else if (e.key === 'ArrowRight') next += step;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = max;
      else if (e.key === 'PageUp') next -= step * 5;
      else if (e.key === 'PageDown') next += step * 5;
      next = Math.max(0, Math.min(max, next));
      setPlayhead(next);
      previewRef.current?.seek(next);
    },
    [currentOutput, playheadMs, setPlayhead, store]
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
      const max = vo?.durationMs ?? 0;
      const step =
        (e.shiftKey ? SLIDER_BIG_STEP_MS : SLIDER_STEP_MS) *
        (e.key === 'ArrowLeft' ? -1 : 1);
      const duration = clip.endMs - clip.startMs;
      const nextStart = Math.max(
        0,
        Math.min(max - duration, clip.startMs + step)
      );
      state.updateClip(currentOutput, trackId, clip.id, {
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
      const max = vo?.durationMs ?? 0;
      const step =
        (e.shiftKey ? SLIDER_BIG_STEP_MS : SLIDER_STEP_MS) *
        (e.key === 'ArrowLeft' ? -1 : 1);
      if (edge === 'start') {
        const nextStart = Math.max(
          0,
          Math.min(clip.endMs - 100, clip.startMs + step)
        );
        state.updateClip(currentOutput, trackId, clip.id, {
          startMs: Math.round(nextStart),
        });
      } else {
        const nextEnd = Math.max(
          clip.startMs + 100,
          Math.min(max, clip.endMs + step)
        );
        state.updateClip(currentOutput, trackId, clip.id, {
          endMs: Math.round(nextEnd),
        });
      }
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
    (e: React.MouseEvent, trackId: string, clip: VideoClip, edge: 'start' | 'end' | 'move') => {
      e.stopPropagation();
      setDragging({
        trackId,
        clipId: clip.id,
        edge,
        startX: e.clientX,
        origStart: clip.startMs,
        origEnd: clip.endMs,
      });
      setSelectedClip({ outputIndex: currentOutput, trackId, clipId: clip.id });
    },
    [currentOutput, setSelectedClip],
  );

  useEffect(() => {
    if (!dragging || !isVideo || !vo) return;

    const trackAtY = (clientY: number): VideoTrack | undefined => {
      if (!timelineRef.current) return undefined;
      const rect = timelineRef.current.getBoundingClientRect();
      const tracksTop = rect.top + RULER_HEIGHT;
      const relY = clientY - tracksTop + (scrollRef.current?.scrollTop ?? 0);
      const idx = Math.floor(relY / (TRACK_HEIGHT + TRACK_GAP));
      if (idx < 0 || idx >= vo.tracks.length) return undefined;
      return vo.tracks[idx];
    };

    const snapEdges = (value: number, excludeClipId: string): number => {
      const snapCandidates: number[] = [0, vo.durationMs];
      for (const t of vo.tracks) {
        for (const c of t.clips) {
          if (c.id === excludeClipId) continue;
          snapCandidates.push(c.startMs, c.endMs + (c.freezeAtMs || 0));
        }
      }
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
      setDragOverTrackId(hovered?.id ?? null);

      const dx = (e.clientX - dragging.startX) / pixelsPerMs;
      setDragging((prev) => {
        if (!prev) return null;
        let { origStart, origEnd } = prev;
        const duration = origEnd - origStart;

        if (prev.edge === 'move') {
          origStart = Math.max(0, Math.min(vo.durationMs - duration, origStart + dx));
          origEnd = origStart + duration;
        } else if (prev.edge === 'start') {
          origStart = Math.max(0, Math.min(origEnd - 100, origStart + dx));
        } else {
          origEnd = Math.max(origStart + 100, Math.min(vo.durationMs, origEnd + dx));
        }

        origStart = snapEdges(origStart, prev.clipId);
        if (prev.edge !== 'start') {
          origEnd = snapEdges(origEnd, prev.clipId);
        }

        store.getState().updateClip(currentOutput, prev.trackId, prev.clipId, {
          startMs: Math.round(origStart),
          endMs: Math.round(origEnd),
        });

        return { ...prev, origStart, origEnd };
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      const hovered = trackAtY(e.clientY);
      setDragging(null);
      setDragOverTrackId(null);
      if (hovered && hovered.id !== dragging.trackId) {
        const clip = vo.tracks
          .find((t) => t.id === dragging.trackId)
          ?.clips.find((c) => c.id === dragging.clipId);
        if (clip) {
          store.getState().removeClip(currentOutput, dragging.trackId, dragging.clipId);
          store.getState().addClip(currentOutput, hovered.id, clip);
        }
      }
      store.getState().pushHistory();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, isVideo, vo, pixelsPerMs, store, currentOutput]);

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
      const splitPoint = Math.max(original.startMs + 100, Math.min(original.endMs - 100, playheadMs));

      if (splitPoint <= original.startMs || splitPoint >= original.endMs) return;

      (globalThis as any)._clipCounter = ((globalThis as any)._clipCounter || 0) + 1;
      const ctr = (globalThis as any)._clipCounter;

      // Source time of the frame under the playhead — the frozen frame, and the
      // point the second half resumes from.
      const frozenSourceMs = (original.trimInMs ?? 0) + (splitPoint - original.startMs);

      const first: VideoClip = {
        ...original,
        id: `el-${Date.now()}-${ctr}`,
        endMs: splitPoint,
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
        // when the original had no trimIn).
        trimInMs: frozenSourceMs,
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
    [store, currentOutput, playheadMs],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isVideo || !vo) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClip && selectedClip.outputIndex === currentOutput) {
          store.getState().removeClip(currentOutput, selectedClip.trackId, selectedClip.clipId);
          setSelectedClip(null);
        }
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
        store.getState().splitClip(currentOutput, selectedClip.trackId, selectedClip.clipId, playheadMs);
      } else if (e.key === 'f' && e.ctrlKey && selectedClip && selectedClip.outputIndex === currentOutput) {
        e.preventDefault();
        handleFreezeFrame(selectedClip.trackId, selectedClip.clipId);
      }
    },
    [isVideo, vo, selectedClip, store, currentOutput, playheadMs, handlePlayPause, setSelectedClip, handleFreezeFrame],
  );

  const isSelected = useCallback(
    (trackId: string, clipId: string) =>
      selectedClip?.outputIndex === currentOutput &&
      selectedClip?.trackId === trackId &&
      selectedClip?.clipId === clipId,
    [selectedClip, currentOutput],
  );

  const activeSelected = selectedClip?.outputIndex === currentOutput ? selectedClip : null;

  useEffect(() => {
    if (sendTimelineAwareness) {
      sendTimelineAwareness(playheadMs, activeSelected?.clipId ?? null);
    }
  }, [playheadMs, activeSelected?.clipId, sendTimelineAwareness]);

  const handleClipContextMenu = useCallback(
    (e: React.MouseEvent, trackId: string, clipId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedClip({ outputIndex: currentOutput, trackId, clipId });
      setClipMenu({ x: e.clientX, y: e.clientY, outputIndex: currentOutput, trackId, clipId });
    },
    [currentOutput, setSelectedClip],
  );

  const handleSetTransition = useCallback(
    (trackId: string, fromClipId: string, toClipId: string, type: 'cut' | 'fade' | 'dissolve' | 'slide', direction?: 'left' | 'right' | 'up' | 'down') => {
      const state = store.getState();
      const durationMs = type === 'cut' ? 0 : 500;
      state.updateClip(currentOutput, trackId, fromClipId, {
        transitionOut: { type, durationMs, direction },
      });
      state.updateClip(currentOutput, trackId, toClipId, {
        transitionIn: { type, durationMs, direction },
      });
      setTransitionPopover(null);
      store.getState().pushHistory();
    },
    [store, currentOutput],
  );

  const generateVoiceover = useCallback(
    async (text: string, voiceId: string) => {
      if (!vo) return;
      try {
        const res = await fetch('/media/text-to-speech', {
          method: 'POST',
          body: JSON.stringify({ text, voice: voiceId }),
        });
        if (!res.ok) {
          toaster.show(translate('voiceover_generation_failed', 'Voiceover generation failed'), 'warning');
          return;
        }
        const { id, path } = await res.json();
        const state = store.getState();
        const currentVo = state.doc.outputs[currentOutput] as VideoOutput;
        let audioTrack = currentVo.tracks.find((t) => t.type === 'audio');
        if (!audioTrack) {
          state.addTrack(currentOutput, 'audio');
          audioTrack = (store.getState().doc.outputs[currentOutput] as VideoOutput).tracks.find((t) => t.type === 'audio');
        }
        if (!audioTrack) return;
        const durationMs = 5000;
        const clip: VideoClip = {
          id: `clip-${Date.now()}`,
          startMs: playheadMs,
          endMs: Math.min(playheadMs + durationMs, vo.durationMs),
          src: path,
          fileId: id,
          volume: 1,
        } as VideoClip;
        store.getState().addClip(currentOutput, audioTrack.id, clip);
        store.getState().pushHistory();
        toaster.show(translate('voiceover_added_to_timeline', 'Voiceover added to timeline'), 'success');
      } catch {
        toaster.show(translate('voiceover_generation_failed', 'Voiceover generation failed'), 'warning');
      }
    },
    [vo, playheadMs, currentOutput, store, fetch, toaster, translate]
  );

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

  const handleGenerateCaptions = useCallback(async () => {
    if (!vo) return;
    const audioClips = vo.tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)
      .filter((c) => c.src);
    if (audioClips.length === 0) {
      toaster.show(translate('no_audio_clips_to_transcribe', 'No audio clips to transcribe'), 'warning');
      return;
    }
    const src = audioClips[0].src;
    try {
      const res = await fetch('/media/speech-to-text-words', {
        method: 'POST',
        body: JSON.stringify({ audioUrl: src }),
      });
      if (!res.ok) {
        toaster.show(translate('caption_generation_failed', 'Caption generation failed'), 'warning');
        return;
      }
      const { words } = await res.json() as { words?: { word: string; start: number; end: number }[] };
      if (!words?.length) {
        toaster.show(translate('no_speech_detected', 'No speech detected'), 'warning');
        return;
      }
      const state = store.getState();
      const currentVo = state.doc.outputs[currentOutput] as VideoOutput;
      let captionTrack = currentVo.tracks.find((t) => t.type === 'caption');
      if (!captionTrack) {
        state.addTrack(currentOutput, 'caption');
        captionTrack = (store.getState().doc.outputs[currentOutput] as VideoOutput).tracks.find((t) => t.type === 'caption');
      }
      if (!captionTrack) return;
      const audioStart = audioClips[0].startMs;

      // Group words into sentence/phrase chunks so each caption clip carries
      // per-word timing instead of flattening to separate text clips.
      const phrases: { word: string; start: number; end: number }[][] = [];
      let current: { word: string; start: number; end: number }[] = [];
      const maxWordsPerCaption = 6;
      for (const w of words) {
        current.push(w);
        const endsPhrase = /[.!?]$/.test(w.word) || current.length >= maxWordsPerCaption;
        if (endsPhrase) {
          phrases.push(current);
          current = [];
        }
      }
      if (current.length) phrases.push(current);

      for (const phrase of phrases) {
        const phraseStartRel = Math.round(phrase[0].start * 1000);
        const phraseEndRel = Math.round(phrase[phrase.length - 1].end * 1000);
        const startMs = audioStart + phraseStartRel;
        const endMs = audioStart + phraseEndRel;
        if (endMs > vo.durationMs) break;
        const text = phrase.map((w) => w.word).join(' ');
        const wordsTiming = phrase.map((w) => ({
          word: w.word,
          startMs: Math.round(w.start * 1000) - phraseStartRel,
          endMs: Math.round(w.end * 1000) - phraseStartRel,
        }));
        const clip: VideoClip = {
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startMs,
          endMs,
          text,
          words: wordsTiming,
          fontFamily: 'Arial',
          fontSize: 28,
          fontWeight: 700,
          fill: '#ffffff',
          x: (vo.width - 300) / 2,
          y: vo.height - 120,
          width: 300,
          height: 70,
        };
        store.getState().addClip(currentOutput, captionTrack.id, clip);
      }
      store.getState().pushHistory();
      toaster.show(translate('captions_added_to_timeline', 'Captions added to timeline'), 'success');
    } catch {
      toaster.show(translate('caption_generation_failed', 'Caption generation failed'), 'warning');
    }
  }, [vo, currentOutput, store, fetch, toaster, translate]);

  const POLL_INTERVAL_MS = 3000;
  const MAX_POLLS = 200;

  const landOrPoll = useCallback(async (
    type: 'video' | 'audio',
    idOrUrl: string | false
  ) => {
    if (idOrUrl === false) {
      toaster.show(translate('generation_was_blocked_or_returned_empty', 'Generation was blocked or returned empty.'), 'warning');
      return;
    }
    if (isArtifactPath(idOrUrl)) {
      await addMediaToTimeline(store, { type, url: idOrUrl });
      return;
    }
    let polls = 0;
    const check = async (): Promise<string | null> => {
      const res = await fetch(`/media/jobs/${idOrUrl}`);
      if (!res.ok) throw new Error(translate('failed_to_check_job_status', 'Failed to check job status'));
      const job = await res.json();
      if (job.status === 'completed') {
        if (!job.artifactUrl) throw new Error(translate('job_completed_but_no_artifact', 'Job completed but no artifact'));
        return job.artifactUrl;
      }
      if (job.status === 'failed') throw new Error(job.error || translate('generation_failed', 'Generation failed'));
      return null;
    };
    while (polls < MAX_POLLS) {
      if (!mountedRef.current) return; // timeline unmounted — stop polling
      const artifactUrl = await check().catch((e) => {
        if (mountedRef.current) toaster.show(e.message, 'warning');
        return '__error__';
      });
      if (artifactUrl === '__error__') return;
      if (!mountedRef.current) return;
      if (artifactUrl) {
        await addMediaToTimeline(store, { type, url: artifactUrl });
        return;
      }
      polls++;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (mountedRef.current) toaster.show(translate('generation_timed_out', 'Generation timed out'), 'warning');
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
        state.updateClip(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId, {
          src: id,
          fileId: undefined,
        });
        state.pushHistory();
      } else {
        let polls = 0;
        while (polls < MAX_POLLS) {
          if (!mountedRef.current) return; // timeline unmounted — stop polling
          const jobRes = await fetch(`/media/jobs/${id}`);
          if (!jobRes.ok) throw new Error(translate('failed_to_check_transform_status', 'Failed to check transform status'));
          const job = await jobRes.json();
          if (job.status === 'completed') {
            if (!job.artifactUrl) throw new Error(translate('no_artifact', 'No artifact'));
            state.updateClip(clipMenu.outputIndex, clipMenu.trackId, clipMenu.clipId, {
              src: job.artifactUrl,
              fileId: undefined,
            });
            state.pushHistory();
            break;
          }
          if (job.status === 'failed') throw new Error(job.error || translate('transform_failed', 'Transform failed'));
          polls++;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      }
    } catch (e) {
      if (mountedRef.current) toaster.show((e as Error).message || translate('transform_failed', 'Transform failed'), 'warning');
    } finally {
      if (clearMenu && mountedRef.current) setClipMenu(null);
    }
  }, [clipMenu, fetch, store, toaster, translate]);

  const handleGenerateVideo = useCallback(() => {
    modals.openModal({
      title: translate('ai_video_label', 'AI Video'),
      children: (
        <AiVideoDialog
          fetch={fetch}
          toaster={toaster}
          selectedImageSrc={selectedImageSrc}
          onResult={landOrPoll}
        />
      ),
    });
  }, [modals, fetch, toaster, selectedImageSrc, landOrPoll, translate]);

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
        />
      ),
    });
  }, [modals, fetch, toaster, landOrPoll, translate]);

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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-studioBorder">
        <button
          onClick={handlePlayPause}
          className="w-7 h-7 flex items-center justify-center rounded text-textColor hover:bg-studioBorder/30 text-[13px]"
          title={isPlaying ? translate('pause', 'Pause') : translate('play', 'Play')}
          aria-label={isPlaying ? translate('pause', 'Pause') : translate('play', 'Play')}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="text-[12px] text-textColor font-mono min-w-[70px] tabular-nums">
          {formatTime(playheadMs)}
        </span>
        <span className="text-[11px] text-textColor/40">
          / {formatTime(vo.durationMs)}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleZoomOut}
          className="w-6 h-6 flex items-center justify-center rounded text-textColor/60 hover:text-textColor text-[13px]"
          title={translate('zoom_out', 'Zoom out')}
          aria-label={translate('zoom_out', 'Zoom out')}
        >
          &#x2212;
        </button>
        <button
          onClick={handleZoomIn}
          className="w-6 h-6 flex items-center justify-center rounded text-textColor/60 hover:text-textColor text-[13px]"
          title={translate('zoom_in', 'Zoom in')}
          aria-label={translate('zoom_in', 'Zoom in')}
        >
          +
        </button>
        <button
          onClick={() => store.getState().addTrack(currentOutput, 'video')}
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor"
          title={translate('add_video_track', 'Add video track')}
        >
          {translate('plus_track', '+ Track')}
        </button>
        <button
          onClick={handleGenerateVoiceover}
          disabled={!ttsAvailable}
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            ttsAvailable
              ? translate('generate_ai_voiceover', 'Generate AI voiceover')
              : translate('configure_a_text_to_speech_provider_in_settings_media', 'Configure a text-to-speech provider in Settings → Media')
          }
        >
          {translate('voiceover', 'Voiceover')}
        </button>
        <button
          onClick={handleGenerateCaptions}
          disabled={!sttAvailable}
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
          title={
            sttAvailable
              ? translate('auto_generate_captions_from_audio', 'Auto-generate captions from audio')
              : translate('configure_a_speech_to_text_provider_in_settings_media', 'Configure a speech-to-text provider (e.g. Deepgram) in Settings → Media')
          }
        >
          {translate('captions', 'Captions')}
        </button>
        <button
          onClick={handleGenerateVideo}
          disabled={!textToVideoAvailable && !imageToVideoAvailable}
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
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
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
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
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
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
          className="px-2 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-textColor/60"
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
        style={{ maxHeight: 240 }}
      >
        <div style={{ position: 'relative', width: LABEL_WIDTH + totalPixels + 40, minWidth: '100%' }}>
          {/* Ruler */}
          <div
            role="slider"
            aria-label={translate('seek_timeline', 'Seek timeline')}
            aria-orientation="horizontal"
            aria-valuenow={Math.round(playheadMs)}
            aria-valuemin={0}
            aria-valuemax={Math.round(vo.durationMs)}
            aria-valuetext={formatTime(playheadMs)}
            tabIndex={0}
            className="sticky top-0 z-10 bg-newBgColorInner border-b border-studioBorder/40"
            style={{ height: RULER_HEIGHT, marginLeft: LABEL_WIDTH }}
            onMouseDown={handleRulerClick}
            onKeyDown={handleRulerKeyDown}
            onKeyUp={handleSliderKeyUp}
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
            </div>
          </div>

          {/* Tracks */}
          {vo.tracks.map((track, ti) => {
            const trackPairs = sortedAdjacentPairs[track.id] || [];
            return (
            <div
              key={track.id}
              className={`flex items-stretch border-b border-studioBorder/20 transition-colors ${
                dragOverTrackId === track.id ? 'bg-designerAccent/10' : ''
              }`}
              style={{ height: TRACK_HEIGHT + TRACK_GAP }}
            >
              {/* Track label */}
              <div
                className="flex flex-col items-end justify-center px-2 text-[10px] font-medium uppercase tracking-wider shrink-0 border-r border-studioBorder/30 gap-0.5"
                style={{ width: LABEL_WIDTH }}
              >
                <span style={{ color: TRACK_COLORS[track.type] }}>
                  {trackTypeLabel(track.type)}
                </span>
                {track.type === 'audio' && (
                  <button
                    className="text-[9px] text-textColor/40 hover:text-textColor"
                    title={translate('track_audio_settings', 'Track audio settings')}
                    onClick={(e) => {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setTrackSettings({ trackId: track.id, x: rect.left + rect.width / 2, y: rect.top });
                    }}
                  >
                    ⋮
                  </button>
                )}
              </div>

              {/* Track content area */}
              <div
                className="relative flex-1"
                style={{ width: totalPixels + 40 }}
              >
                {track.clips.map((clip) => {
                  const left = clip.startMs * pixelsPerMs;
                  const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
                  const width = Math.max(4, (effectiveEnd - clip.startMs) * pixelsPerMs);
                  const sel = isSelected(track.id, clip.id);

                  return (
                    <div
                      role="slider"
                      aria-label={translate('clip', 'Clip')}
                      aria-orientation="horizontal"
                      aria-valuenow={Math.round(clip.startMs)}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(vo.durationMs - (clip.endMs - clip.startMs))}
                      aria-valuetext={translate('clip_start_time', 'Start {{time}}', { time: formatTime(clip.startMs) })}
                      tabIndex={0}
                      key={clip.id}
                      className={`absolute top-1 rounded-[4px] cursor-pointer group ${
                        sel ? 'ring-2 ring-white/60 z-10' : ''
                      }`}
                      style={{
                        left,
                        width,
                        height: TRACK_HEIGHT - 8,
                        backgroundColor: TRACK_COLORS[track.type],
                        opacity: clip.opacity ?? 0.9,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClip({ outputIndex: currentOutput, trackId: track.id, clipId: clip.id });
                      }}
                      onKeyDown={(e) => handleClipKeyDown(e, track.id, clip)}
                      onKeyUp={handleSliderKeyUp}
                      onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, 'move')}
                      onContextMenu={(e) => handleClipContextMenu(e, track.id, clip.id)}
                    >
                      <div className="text-[9px] text-white/90 px-1.5 truncate leading-[28px] select-none">
                        {track.type === 'video' && '\uD83C\uDFAC'}
                        {track.type === 'image' && '\uD83D\uDDBC'}
                        {track.type === 'text' && (clip.text?.substring(0, 10) || translate('clip_label_text_fallback', 'T'))}
                        {track.type === 'caption' && (clip.text?.substring(0, 10) || translate('clip_label_caption_fallback', 'CC'))}
                        {track.type === 'audio' && '\uD83D\uDD0A'}
                        {clip.speed !== undefined && clip.speed !== 1 && ` ${clip.speed}x`}
                        {clip.reverse && ' \u21A9'}
                        {clip.freezeAtMs && clip.freezeAtMs > 0 && ' \u2744'}
                        {' '}
                        {formatTime(effectiveEnd - clip.startMs)}
                      </div>
                      {track.type === 'audio' && (
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
                        onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, 'start')}
                        onKeyDown={(e) => handleEdgeKeyDown(e, track.id, clip, 'start')}
                        onKeyUp={handleSliderKeyUp}
                      />
                      <div
                        role="slider"
                        aria-label={translate('trim_clip_end', 'Trim clip end')}
                        aria-orientation="horizontal"
                        aria-valuenow={Math.round(clip.endMs)}
                        aria-valuemin={Math.round(clip.startMs + 100)}
                        aria-valuemax={Math.round(vo.durationMs)}
                        aria-valuetext={formatTime(clip.endMs)}
                        tabIndex={0}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-r-[4px]"
                        onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, 'end')}
                        onKeyDown={(e) => handleEdgeKeyDown(e, track.id, clip, 'end')}
                        onKeyUp={handleSliderKeyUp}
                      />
                    </div>
                  );
                })}

                {/* Transition handles between adjacent clips */}
                {trackPairs.map(({ from, to }) => {
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
                        className={`w-2 h-full flex items-center justify-center rounded-sm ${
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
          )})}

          {/* Playhead */}
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

      {/* Track audio settings popover */}
      {trackSettings && (
        <>
          <button
            type="button"
            aria-label={translate('close', 'Close')}
            className="fixed inset-0 z-50"
            onClick={() => setTrackSettings(null)}
          />
          <div
            className="fixed z-[60] bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[160px]"
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
                  <div className="text-[11px] font-medium text-textColor/60 mb-1">{translate('track_audio', 'Track Audio')}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-textColor/70">{translate('gain', 'Gain')}</span>
                    <span className="text-[10px] text-textColor/40">{Math.round((track.gain ?? 1) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={Math.round((track.gain ?? 1) * 100)}
                    onChange={(e) => store.getState().setTrackGain(currentOutput, track.id, Number(e.target.value) / 100)}
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
                </div>
              );
            })()}
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
            className="fixed z-[60] bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[140px]"
            style={{
              left: transitionPopover.x,
              top: transitionPopover.y + 8,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="text-[11px] font-medium text-textColor/60 mb-1.5 px-1">{translate('transition', 'Transition')}</div>
            {(['cut', 'fade', 'dissolve', 'slide'] as const).map((type) => (
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
            {transitionPopover.trackId && (
              <div className="mt-1.5 pt-1.5 border-t border-studioBorder">
                <div className="text-[10px] text-textColor/40 mb-1 px-1">{translate('slide_direction', 'Slide direction')}</div>
                <div className="grid grid-cols-2 gap-1">
                  {(['left', 'right', 'up', 'down'] as const).map((dir) => (
                    <button
                      key={dir}
                      onClick={() => handleSetTransition(transitionPopover.trackId, transitionPopover.fromClipId, transitionPopover.toClipId, 'slide', dir)}
                      className="px-1.5 py-0.5 rounded text-[10px] border border-studioBorder text-textColor/60 hover:text-textColor hover:border-newTextColor/40 capitalize"
                    >
                      {directionLabel(dir)}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            className="fixed z-[60] bg-newBgColor border border-studioBorder rounded-lg p-2 shadow-xl min-w-[160px]"
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
              if (!clipSrc) {
                return (
                  <div className="text-[11px] text-textColor/60 px-1">
                    {translate('clip_has_no_source', 'Selected clip has no source')}
                  </div>
                );
              }
              if (clipTransformMode === 'upscale') {
                return (
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-textColor/60 mb-1 px-1">{translate('upscale_video', 'Upscale video')}</div>
                    <button
                      onClick={() => runClipTransform('/media/upscale-video', { videoUrl: clipSrc })}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('upscale_video', 'Upscale video')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              if (clipTransformMode === 'remove-bg') {
                return (
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-textColor/60 mb-1 px-1">{translate('remove_background', 'Remove background')}</div>
                    <button
                      onClick={() => runClipTransform('/media/remove-video-background', { videoUrl: clipSrc })}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('remove_background', 'Remove background')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              if (clipTransformMode === 'video-to-video') {
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-medium text-textColor/60 px-1">{translate('transform_with_prompt', 'Transform with prompt')}</div>
                    <input
                      type="text"
                      value={clipTransformPrompt}
                      onChange={(e) => setClipTransformPrompt(e.target.value)}
                      placeholder={translate('describe_the_transformation', 'Describe the transformation...')}
                      className="w-full bg-newBgColor border border-studioBorder rounded px-2 py-1 text-[11px] text-textColor placeholder:text-textColor/40 outline-none"
                    />
                    <button
                      onClick={() => runClipTransform('/media/video-to-video', { videoUrl: clipSrc, prompt: clipTransformPrompt.trim() })}
                      disabled={!clipTransformPrompt.trim()}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {translate('transform', 'Transform')}
                    </button>
                    <button
                      onClick={() => setClipTransformMode(null)}
                      className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
                    >
                      {translate('back', 'Back')}
                    </button>
                  </div>
                );
              }
              return (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setClipTransformMode('upscale')}
                    disabled={!videoUpscaleAvailable}
                    className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {translate('upscale', 'Upscale')}
                  </button>
                  <button
                    onClick={() => setClipTransformMode('remove-bg')}
                    disabled={!videoBackgroundAvailable}
                    className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {translate('remove_background', 'Remove background')}
                  </button>
                  <button
                    onClick={() => setClipTransformMode('video-to-video')}
                    disabled={!videoToVideoAvailable}
                    className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {translate('transform_with_prompt', 'Transform with prompt')}
                  </button>
                  <div className="border-t border-studioBorder my-1" />
                  <button
                    onClick={() => setClipMenu(null)}
                    className="w-full text-left px-2 py-1 rounded text-[12px] hover:bg-studioBorder/30 text-textColor"
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
