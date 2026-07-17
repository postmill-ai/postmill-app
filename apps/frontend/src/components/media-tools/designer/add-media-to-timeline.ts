import type { createDesignerStore, VideoClip, VideoOutput, VideoTrack } from './designer.store';

type StoreApi = ReturnType<typeof createDesignerStore>;

interface AddMediaToTimelineOptions {
  type: 'video' | 'audio';
  url: string;
  fileId?: string;
  width?: number;
  height?: number;
}

const MAX_TIMELINE_DURATION_MS = 60000;

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

function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ms: number) => {
      if (settled) return;
      settled = true;
      resolve(ms);
    };

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () =>
      finish(Math.max(1000, Math.round((probe.duration || 10) * 1000)));
    probe.onerror = () => finish(10000);
    probe.src = url;
    window.setTimeout(() => finish(10000), 5000);
  });
}

function probeAudioDuration(url: string): Promise<number> {
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
 * Land a video or audio artifact onto the current video timeline.
 *
 * - Switches to video mode if necessary.
 * - Finds or creates the correct track (`video` or `audio`).
 * - Probes the source duration (with a 5 s error/timeout fallback).
 * - Extends the output duration before adding the clip so long clips are not
 *   silently dropped.
 * - Caps clip end and duration at the store's 60 s ceiling.
 */
export function addMediaToTimeline(
  store: StoreApi,
  options: AddMediaToTimelineOptions
): Promise<void> {
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

    const probe = type === 'audio' ? probeAudioDuration(url) : probeVideoDuration(url);

    probe.then((durationMs) => {
      const endMs = Math.min(durationMs, MAX_TIMELINE_DURATION_MS);

      // Extend the output duration BEFORE adding the clip; addClip silently
      // drops clips whose endMs exceeds the current duration.
      store.getState().setVideoDuration(out, endMs);

      const clipBase: Omit<VideoClip, 'startMs' | 'endMs' | 'id'> = {
        src: url,
        fileId,
      };

      if (type === 'audio') {
        const clip: VideoClip = {
          ...clipBase,
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startMs: 0,
          endMs,
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
        };
        store.getState().addClip(out, track.id, clip);
      } else {
        const clip: VideoClip = {
          ...clipBase,
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startMs: 0,
          endMs,
        };
        store.getState().addClip(out, track.id, clip);
      }

      // Note: setVideoDuration and addClip each push a history entry internally,
      // so no explicit pushHistory() is needed here (it would create a redundant
      // undo step for a single logical drop).
      resolve();
    });
  });
}
