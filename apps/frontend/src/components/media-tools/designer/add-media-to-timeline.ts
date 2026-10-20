import type { createDesignerStore, VideoClip, VideoOutput, VideoTrack } from './designer.store';
import { fitWithin } from './panels/fit-within';
import { probeImageNaturalSize } from './elements';
import { DEFAULT_CLIP_MS } from './add-text';

type StoreApi = ReturnType<typeof createDesignerStore>;

interface AddMediaToTimelineOptions {
  type: 'video' | 'audio';
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
}

export interface AddImageClipOptions {
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
  /**
   * Icon picks carry no meaningful intrinsic size (a 24×24 SVG would land
   * tiny — `fitWithin` never upscales), so they skip the aspect probe and take
   * a square box at a fifth of the canvas instead.
   */
  square?: boolean;
}

import { MAX_VIDEO_DURATION_MS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';

// The timeline ceiling is the shared DesignerDoc video cap (lockstep with the
// server render cap — see designer-doc.limits.ts).
const MAX_TIMELINE_DURATION_MS = MAX_VIDEO_DURATION_MS;

function findOrCreateTrack(
  store: StoreApi,
  outputIndex: number,
  type: VideoTrack['type']
): VideoTrack | undefined {
  const state = store.getState();
  const vo = state.doc.outputs[outputIndex] as VideoOutput;
  if (state.doc.mode !== 'video') return undefined;

  let track = vo.tracks.find((t) => t.type === type);
  if (!track) {
    state.addTrack(outputIndex, type);
    track = (store.getState().doc.outputs[outputIndex] as VideoOutput).tracks.find(
      (t) => t.type === type
    );
  }
  return track;
}

export function probeVideoMetadata(
  url: string
): Promise<{ durationMs: number; width?: number; height?: number; probeFailed?: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ms: number, width?: number, height?: number, probeFailed = false) => {
      if (settled) return;
      settled = true;
      resolve({ durationMs: ms, width, height, probeFailed });
    };

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () =>
      finish(
        Math.max(1000, Math.round((probe.duration || 10) * 1000)),
        probe.videoWidth || undefined,
        probe.videoHeight || undefined
      );
    // Error/timeout land the clip with a 10s fallback — flag it so the caller
    // can tell the user the duration is a guess instead of failing silently.
    probe.onerror = () => finish(10000, undefined, undefined, true);
    probe.src = url;
    window.setTimeout(() => finish(10000, undefined, undefined, true), 5000);
  });
}

export function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ms: number) => {
      if (settled) return;
      settled = true;
      resolve(ms);
    };

    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () =>
      finish(Math.max(1000, Math.round((probe.duration || 10) * 1000)));
    probe.onerror = () => finish(10000);
    probe.src = url;
    window.setTimeout(() => finish(10000), 5000);
  });
}

/**
 * Insert ▸ Image/Sticker/Icon in a video document: land the pick as an `image`
 * clip at the playhead on an image track (created on demand).
 *
 * Placement mirrors `addImageElementFromMedia` (insert-image.ts): aspect-
 * preserving fit within 80% of the canvas, centered, with the natural size
 * probed asynchronously when the picker doesn't know it — the probe shares the
 * image cache, so the Konva loader doesn't fetch twice. Duration defaults to
 * DEFAULT_CLIP_MS (same as a text clip), extending the output the way a media
 * drop does rather than silently truncating at the current end.
 *
 * Returns the new clip's id, or null when the document can't take one.
 */
export function addImageClipToTimeline(
  store: StoreApi,
  options: AddImageClipOptions
): string | null {
  const state = store.getState();
  if (state.doc.mode !== 'video') return null;

  const out = state.currentOutput;
  const track = findOrCreateTrack(store, out, 'image');
  if (!track) return null;

  const vo = store.getState().doc.outputs[out] as VideoOutput;
  const startMs = Math.max(0, Math.min(state.playheadMs, vo.durationMs - 100));
  const wantedEnd = startMs + DEFAULT_CLIP_MS;
  if (wantedEnd > vo.durationMs) {
    // Extend BEFORE addClip: addClip rejects clips past the output duration.
    // setVideoDuration clamps to the MAX_VIDEO_DURATION_MS ceiling, so the clip
    // end is re-read from the (possibly still shorter) output afterwards.
    store.getState().setVideoDuration(out, wantedEnd);
  }
  const durationMs = (store.getState().doc.outputs[out] as VideoOutput).durationMs;
  const endMs = Math.min(wantedEnd, durationMs);
  if (endMs <= startMs) return null;

  const fitBox = { maxW: vo.width * 0.8, maxH: vo.height * 0.8 };
  const geometryFor = (natW?: number, natH?: number) => {
    if (options.square) {
      const side = Math.round(Math.min(vo.width, vo.height) * 0.2);
      return { width: side, height: side };
    }
    return fitWithin(natW || vo.width, natH || vo.height, fitBox.maxW, fitBox.maxH);
  };

  const known = options.width && options.height;
  const geo = geometryFor(known ? options.width : undefined, known ? options.height : undefined);
  const clip: VideoClip = {
    id: '',
    startMs,
    endMs,
    src: options.url,
    fileId: options.fileId,
    x: Math.round((vo.width - geo.width) / 2),
    y: Math.round((vo.height - geo.height) / 2),
    width: Math.round(geo.width),
    height: Math.round(geo.height),
    opacity: 1,
    naturalWidth: known ? options.width : undefined,
    naturalHeight: known ? options.height : undefined,
  };
  store.getState().addClip(out, track.id, clip);

  // addClip assigns the id; read it back off the track it landed on (same
  // pattern as addText). addTrack/addClip already pushed history.
  const after = store.getState().doc.outputs[out] as VideoOutput;
  const landed = after.tracks.find((t) => t.id === track.id)?.clips.at(-1);
  if (!landed) return null;
  store.getState().setSelectedClip({ outputIndex: out, trackId: track.id, clipId: landed.id });

  if (!known && !options.square) {
    // Aspect-correct the box once the probe resolves, but only while the clip
    // is untouched since placement — a user resize wins (same rule as
    // insert-image.ts, and silent so it isn't a separate undo step).
    const placed = { w: clip.width!, h: clip.height! };
    void probeImageNaturalSize(options.url).then((dims) => {
      if (!dims) return;
      const cur = store.getState();
      const curVo = cur.doc.outputs[out] as VideoOutput | undefined;
      const curClip = curVo?.tracks
        .find((t) => t.id === track.id)
        ?.clips.find((c) => c.id === landed.id);
      if (!curClip || curClip.src !== options.url) return;
      if (curClip.width === placed.w && curClip.height === placed.h) {
        const fitted = fitWithin(dims.width, dims.height, fitBox.maxW, fitBox.maxH);
        cur.updateClipSilent(out, track.id, landed.id, {
          x: Math.round((curClip.x ?? 0) + (placed.w - fitted.width) / 2),
          y: Math.round((curClip.y ?? 0) + (placed.h - fitted.height) / 2),
          width: Math.round(fitted.width),
          height: Math.round(fitted.height),
          naturalWidth: dims.width,
          naturalHeight: dims.height,
        });
      } else {
        cur.updateClipSilent(out, track.id, landed.id, {
          naturalWidth: dims.width,
          naturalHeight: dims.height,
        });
      }
    });
  }

  return landed.id;
}

export interface AddVoiceoverOptions {
  url: string;
  /** Media-library File id — keeps the doc-file-refs reference so library
   *  purge scans never reap a clip's audio out from under a saved design. */
  fileId?: string;
  /** Known duration (skips the metadata probe). */
  durationMs?: number;
  /**
   * TTS provenance — persisted on the clip so the inspector can re-voice or
   * re-script it in place later (with the same tone instructions and provider
   * pin the original generation used). Absent for mic recordings.
   */
  voiceover?: { script: string; voice: string; instructions?: string; provider?: string };
}

/**
 * Land a voiceover artifact (TTS output or a mic recording) on the timeline:
 * probe the real duration (with the probe's own fallback), find-or-create the
 * audio track, and clip it in at the playhead at full volume — identical for
 * the TTS dialog and the record dialog.
 *
 * Returns false when the document has no room (playhead at/past the end) or
 * the track could not be created. addTrack/addClip push their own history.
 */
export async function addVoiceoverToTimeline(
  store: StoreApi,
  options: AddVoiceoverOptions
): Promise<boolean> {
  const state = store.getState();
  if (state.doc.mode !== 'video') return false;

  const out = state.currentOutput;
  const track = findOrCreateTrack(store, out, 'audio');
  if (!track) return false;

  const probedMs =
    options.durationMs ?? (await probeAudioDuration(options.url));

  const current = store.getState();
  const vo = current.doc.outputs[out] as VideoOutput;
  const startMs = current.playheadMs;
  const endMs = Math.min(startMs + probedMs, vo.durationMs);
  if (endMs <= startMs) return false;

  const clip: VideoClip = {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    startMs,
    endMs,
    src: options.url,
    fileId: options.fileId,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    voiceover: options.voiceover,
  };
  current.addClip(out, track.id, clip);
  return true;
}

/**
 * Swap a voiceover clip's audio in place after a re-render (new voice / new
 * script): same clip id, same track, same timeline start — only `src`/`fileId`
 * and the end (re-probed like the original landing, clamped to the output
 * duration) change. Returns false when the clip is gone or the swap was
 * rejected by the store's timing rules.
 */
export async function regenerateVoiceoverClip(
  store: StoreApi,
  ref: { outputIndex: number; trackId: string; clipId: string },
  options: { url: string; fileId?: string; durationMs?: number; voiceover?: { script: string; voice: string; instructions?: string; provider?: string } }
): Promise<boolean> {
  const state = store.getState();
  if (state.doc.mode !== 'video') return false;
  const vo = state.doc.outputs[ref.outputIndex] as VideoOutput | undefined;
  const clip = vo?.tracks
    .find((t) => t.id === ref.trackId)
    ?.clips.find((c) => c.id === ref.clipId);
  if (!vo || !clip) return false;

  const probedMs = options.durationMs ?? (await probeAudioDuration(options.url));
  const endMs = Math.min(clip.startMs + probedMs, vo.durationMs);
  const landed = store.getState().updateClipSilent(ref.outputIndex, ref.trackId, ref.clipId, {
    src: options.url,
    fileId: options.fileId,
    endMs,
    ...(options.voiceover ? { voiceover: options.voiceover } : {}),
  });
  if (landed) store.getState().pushHistory();
  return landed;
}

export interface LandedClipRef {
  outputIndex: number;
  trackId: string;
  clipId: string;
  startMs: number;
  /**
   * The metadata probe failed or timed out and the clip landed with the 10s
   * fallback duration — the caller should surface this (the probe itself is
   * silent by design, so the drop never blocks on a dead URL).
   */
  probeFailed?: boolean;
}

/**
 * Land a video or audio artifact onto the current video timeline.
 *
 * - Switches to video mode if necessary.
 * - Finds or creates the correct track (`video` or `audio`).
 * - Probes the source duration (with a 5 s error/timeout fallback).
 * - Extends the output duration before adding the clip so long clips are not
 *   silently dropped.
 * - Caps clip end and duration at the store's MAX_VIDEO_DURATION_MS ceiling.
 *
 * Resolves with the landed clip's identity (the clip is inserted at
 * `startMs: 0`, so callers that want the result visible must seek/select it),
 * or null when addClip rejected the insert.
 */
export function addMediaToTimeline(
  store: StoreApi,
  options: AddMediaToTimelineOptions
): Promise<LandedClipRef | null> {
  const { type, url, fileId } = options;

  return new Promise((resolve, reject) => {
    const state = store.getState();
    if (state.doc.mode !== 'video') {
      state.setMode('video');
    }

    const out = store.getState().currentOutput;
    const track = findOrCreateTrack(store, out, type);
    if (!track) {
      reject(new Error(`Could not create ${type} track`));
      return;
    }

    const probe: Promise<{ durationMs: number; width?: number; height?: number; probeFailed?: boolean }> =
      type === 'audio'
        ? probeAudioDuration(url).then((durationMs) => ({ durationMs }))
        : probeVideoMetadata(url);

    probe.then(({ durationMs, width: natW, height: natH, probeFailed }) => {
      const endMs = Math.min(durationMs, MAX_TIMELINE_DURATION_MS);

      // Extend — never shrink — the output duration BEFORE adding the clip;
      // addClip silently drops clips whose endMs exceeds the current duration.
      // A short drop onto a longer timeline must leave the existing duration
      // (and every clip already on it) alone.
      const before = (store.getState().doc.outputs[out] as VideoOutput).durationMs;
      if (endMs > before) {
        store.getState().setVideoDuration(out, endMs);
      }

      const clipBase: Omit<VideoClip, 'startMs' | 'endMs' | 'id'> = {
        src: url,
        fileId,
      };
      const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const clip: VideoClip =
        type === 'audio'
          ? {
              ...clipBase,
              id,
              startMs: 0,
              endMs,
              volume: 1,
              fadeInMs: 0,
              fadeOutMs: 0,
            }
          : (() => {
              // A clip with no geometry renders at the 1×1 fallback — a blank
              // artboard. Fit the probed pixels to the canvas, centered,
              // preserving aspect (same rule as image inserts).
              const vo = store.getState().doc.outputs[out] as VideoOutput;
              const fit =
                natW && natH
                  ? fitWithin(natW, natH, vo.width, vo.height)
                  : { width: vo.width, height: vo.height };
              return {
                ...clipBase,
                id,
                startMs: 0,
                endMs,
                x: Math.round((vo.width - fit.width) / 2),
                y: Math.round((vo.height - fit.height) / 2),
                width: fit.width,
                height: fit.height,
                naturalWidth: natW,
                naturalHeight: natH,
              };
            })();
      store.getState().addClip(out, track.id, clip);

      // addClip silently rejects clips past the output duration — confirm the
      // landing before reporting success.
      const landed = (store.getState().doc.outputs[out] as VideoOutput).tracks
        .find((t) => t.id === track.id)
        ?.clips.find((c) => c.id === id);

      // Note: setVideoDuration and addClip each push a history entry internally,
      // so no explicit pushHistory() is needed here (it would create a redundant
      // undo step for a single logical drop).
      resolve(landed ? { outputIndex: out, trackId: track.id, clipId: id, startMs: landed.startMs, probeFailed } : null);
    });
  });
}
