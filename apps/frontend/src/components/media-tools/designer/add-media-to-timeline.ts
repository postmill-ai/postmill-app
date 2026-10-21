import type { createDesignerStore, VideoClip, VideoOutput, VideoTrack } from './designer.store';
import { fitWithin } from './panels/fit-within';
import { probeImageNaturalSize } from './elements';
import { DEFAULT_CLIP_MS } from './add-text';
import { buildShapeClip } from './tool-draw';
import { resolveClipPlacement } from './clip-geometry';

type StoreApi = ReturnType<typeof createDesignerStore>;

export const JOB_POLL_INTERVAL_MS = 3000;
// 400×3s = 20 min — matches the compact studio's guard (compact-replicate.tsx):
// seedance/veo can legitimately take 10-15 min, and on timeout the job may
// still finish server-side (it lands in Files when it does).
export const JOB_MAX_POLLS = 400;
// One transient status-check failure (network blip, 429, 5xx) must not abort a
// paid, still-running generation — tolerate a few in a row before giving up.
export const JOB_MAX_TRANSIENT_FAILURES = 3;

export type JobPollOutcome =
  | { kind: 'completed'; url: string; fileId: string | null }
  | { kind: 'timeout' }
  | { kind: 'unmounted' };

interface PollMediaJobOptions {
  jobId: string;
  fetch: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
  isMounted: () => boolean;
  messages: {
    checkFailed: string;
    noArtifact: string;
    generationFailed: string;
  };
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll GET /media/jobs/:id until the job completes. Terminal failures (job
 * failed, non-transient HTTP error, completed-without-artifact) throw — the
 * caller toasts `error.message`. Transient failures (network throw, 429, 5xx)
 * are retried up to JOB_MAX_TRANSIENT_FAILURES in a row, then thrown: a single
 * blip must not abort a paid, still-running generation.
 */
export async function pollMediaJobArtifact(options: PollMediaJobOptions): Promise<JobPollOutcome> {
  const { jobId, fetch, isMounted, messages } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let transientFailures = 0;
  const check = async (): Promise<{ url: string; fileId: string | null } | null> => {
    let res: Pick<Response, 'ok' | 'status' | 'json'>;
    try {
      res = await fetch(`/media/jobs/${jobId}`);
    } catch {
      // Network-level failure (offline, socket reset) — transient by nature.
      const err = new Error(messages.checkFailed) as Error & { transient?: boolean };
      err.transient = true;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(messages.checkFailed) as Error & { transient?: boolean };
      // 429/5xx is transient (the job may still be fine); other non-OK stays terminal.
      if (res.status === 429 || res.status >= 500) err.transient = true;
      throw err;
    }
    const job = (await res.json()) as {
      status?: string;
      artifactUrl?: string | null;
      fileId?: string | null;
      error?: string | null;
    };
    if (job.status === 'completed') {
      if (!job.artifactUrl) throw new Error(messages.noArtifact);
      return { url: job.artifactUrl, fileId: job.fileId ?? null };
    }
    if (job.status === 'failed') throw new Error(job.error || messages.generationFailed);
    return null;
  };

  let polls = 0;
  while (polls < JOB_MAX_POLLS) {
    if (!isMounted()) return { kind: 'unmounted' }; // timeline unmounted — stop polling
    try {
      const result = await check();
      transientFailures = 0;
      if (!isMounted()) return { kind: 'unmounted' };
      if (result) return { kind: 'completed', url: result.url, fileId: result.fileId };
    } catch (e) {
      const err = e as Error & { transient?: boolean };
      if (err.transient && transientFailures + 1 < JOB_MAX_TRANSIENT_FAILURES) {
        transientFailures++;
      } else {
        throw err;
      }
    }
    polls++;
    await sleep(JOB_POLL_INTERVAL_MS);
  }
  return { kind: 'timeout' };
}

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

// Generated music stops dead at the last sample — a hard cut that plays back
// as a click/crackle. Land audio clips with a short baked-in-feel fade so the
// default timeline experience doesn't crackle; the user can still zero them.
export const AUDIO_CLIP_FADE_IN_MS = 100;
export const AUDIO_CLIP_FADE_OUT_MS = 500;

/**
 * Pick the track an inserted clip lands on.
 *
 * With a `window` (the clip's intended [startMs, endMs]), the first same-type
 * track whose window is FREE wins — reusing the first track unconditionally
 * piled every insert onto one row, stacking clips on top of each other. Only
 * when every same-type track is occupied at the insertion point is a new
 * track created (addTrack's MAX_TRACKS cap can refuse, yielding undefined).
 * `resolveClipPlacement` with a 0 snap threshold doubles as the free-window
 * test: any overlap there can only resolve by moving the clip, which an
 * insert at the playhead must not do.
 */
function findOrCreateTrack(
  store: StoreApi,
  outputIndex: number,
  type: VideoTrack['type'],
  window?: { startMs: number; endMs: number }
): VideoTrack | undefined {
  const state = store.getState();
  const vo = state.doc.outputs[outputIndex] as VideoOutput;
  if (state.doc.mode !== 'video') return undefined;

  const sameType = vo.tracks.filter((t) => t.type === type);
  let track = window
    ? sameType.find(
        (t) => resolveClipPlacement(t.clips, window, 0, vo.durationMs) !== null
      )
    : sameType[0];
  if (!track) {
    const beforeIds = new Set(sameType.map((t) => t.id));
    state.addTrack(outputIndex, type);
    // The newly appended track is the one whose id did not exist before —
    // re-finding by type alone could hand back an occupied track.
    track = (store.getState().doc.outputs[outputIndex] as VideoOutput).tracks.find(
      (t) => t.type === type && !beforeIds.has(t.id)
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

  const track = findOrCreateTrack(store, out, 'image', { startMs, endMs });
  if (!track) return null;

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

/**
 * Insert ▸ Shapes in a video document: drop a shape clip at the playhead on a
 * `shape` track (created on demand) — the dual-mode twin of the image-mode
 * `addElement(buildShapeElement(...))` path, mirroring how `addText` lands a
 * text clip. Geometry/defaults come from the same `buildShapeClip` the
 * drag-to-draw tools use, so a menu-inserted star matches a drawn one, and the
 * canvas overlay already renders every field it carries.
 *
 * Returns the new clip's id, or null when the document can't take one.
 */
export function addShapeClipToTimeline(
  store: StoreApi,
  toolId: string,
  size: { width: number; height: number }
): string | null {
  const state = store.getState();
  if (state.doc.mode !== 'video') return null;

  const out = state.currentOutput;
  const vo = store.getState().doc.outputs[out] as VideoOutput;
  const clip = buildShapeClip(
    toolId,
    {
      x: Math.round(vo.width / 2 - size.width / 2),
      y: Math.round(vo.height / 2 - size.height / 2),
      width: size.width,
      height: size.height,
    },
    state.playheadMs,
    vo.durationMs
  );
  const track = findOrCreateTrack(store, out, 'shape', {
    startMs: clip.startMs,
    endMs: clip.endMs,
  });
  if (!track) return null;
  store.getState().addClip(out, track.id, clip);

  // addClip assigns the id; read it back off the track it landed on (same
  // pattern as addText). addTrack/addClip already pushed history.
  const landed = (store.getState().doc.outputs[out] as VideoOutput).tracks
    .find((t) => t.id === track.id)
    ?.clips.at(-1);
  if (!landed) return null;
  store.getState().setSelectedClip({ outputIndex: out, trackId: track.id, clipId: landed.id });
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
 * Where the clip landed — callers toast differently when the playhead had no
 * room and the clip was placed elsewhere (the user is watching the playhead).
 */
export type VoiceoverLanding = 'playhead' | 'relocated' | false;

/**
 * Land a voiceover artifact (TTS output or a mic recording) on the timeline:
 * probe the real duration (with the probe's own fallback), find-or-create the
 * audio track, and clip it in at the playhead at full volume — identical for
 * the TTS dialog and the record dialog.
 *
 * The asset is already generated/uploaded by the time this runs, so it must
 * NEVER be silently dropped: when there is no room at the playhead (playhead
 * at/past the end, or under addClip's 100ms minimum from it), the clip is
 * relocated — after the last audio clip when it fits there whole, otherwise
 * at 0 (a clip longer than the output is clamped to the output length). The
 * landing track is the first audio track whose window is free at the chosen
 * point, created on demand when all of them are occupied (clips never stack
 * on top of each other). Returns 'playhead'/'relocated' so the caller can say
 * where it went; false only for a truly impossible doc (not video mode, no
 * track, or a sub-100ms output). addTrack/addClip push their own history.
 */
export async function addVoiceoverToTimeline(
  store: StoreApi,
  options: AddVoiceoverOptions
): Promise<VoiceoverLanding> {
  const state = store.getState();
  if (state.doc.mode !== 'video') return false;

  const out = state.currentOutput;
  const probedMs =
    options.durationMs ?? (await probeAudioDuration(options.url));

  const current = store.getState();
  const vo = current.doc.outputs[out] as VideoOutput;
  // addClip enforces a 100ms minimum clip length, so an output shorter than
  // that is the only truly unplaceable state.
  if (vo.durationMs < 100) return false;
  // A clip longer than the whole output is clamped to the output, not dropped.
  const clipLen = Math.min(probedMs, vo.durationMs);

  let startMs = Math.max(0, Math.min(current.playheadMs, vo.durationMs));
  let landing: Exclude<VoiceoverLanding, false> = 'playhead';
  if (vo.durationMs - startMs < 100) {
    // No room at the playhead. Prefer just after the last audio clip when the
    // full clip fits there; otherwise land at 0.
    const lastEnd = Math.max(
      0,
      ...vo.tracks.filter((t) => t.type === 'audio').flatMap((t) => t.clips).map((c) => c.endMs)
    );
    startMs = lastEnd + clipLen <= vo.durationMs ? lastEnd : 0;
    landing = 'relocated';
  }
  const endMs = Math.min(startMs + clipLen, vo.durationMs);

  const track = findOrCreateTrack(store, out, 'audio', { startMs, endMs });
  if (!track) return false;

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
  return landing;
}

/**
 * Swap a voiceover clip's audio in place after a re-render (new voice / new
 * script): same clip id, same track, same timeline start — only `src`/`fileId`
 * and the end (re-probed like the original landing, clamped to the output
 * duration) change. A clip left out of bounds by a duration shrink (startMs at
 * or past the output end) is pulled back inside instead of failing the swap.
 * Returns false when the clip is gone or the swap was rejected by the store's
 * timing rules.
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
  if (vo.durationMs <= 0) return false;

  const probedMs = options.durationMs ?? (await probeAudioDuration(options.url));
  // Keep the clip's own start, but heal one a duration shrink left dangling at
  // or past the output end (min(start + probed, duration) would invert there).
  const startMs = Math.min(clip.startMs, vo.durationMs - 1);
  const endMs = Math.min(startMs + probedMs, vo.durationMs);
  const landed = store.getState().updateClipSilent(ref.outputIndex, ref.trackId, ref.clipId, {
    src: options.url,
    fileId: options.fileId,
    startMs,
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

      // Land on the first same-type track free at [0, endMs] — a fresh drop
      // must not stack on top of a clip already sitting at the timeline start.
      const track = findOrCreateTrack(store, out, type, { startMs: 0, endMs });
      if (!track) {
        reject(new Error(`Could not create ${type} track`));
        return;
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
              // Cap the fades at half the clip so a very short drop keeps
              // audible body instead of being all ramp.
              fadeInMs: Math.min(AUDIO_CLIP_FADE_IN_MS, Math.floor(endMs / 2)),
              fadeOutMs: Math.min(AUDIO_CLIP_FADE_OUT_MS, Math.floor(endMs / 2)),
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
