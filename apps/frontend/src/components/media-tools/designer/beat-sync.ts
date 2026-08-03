'use client';

import {
  detectBeats,
  estimateBpm,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/beat-detect';

/**
 * Analysing an audio clip in the browser, so its beats can be snapped to.
 *
 * Detection itself is shared and pure; what lives here is the Web Audio part —
 * fetching, decoding and downmixing — which needs a browser and is not worth
 * pretending is testable in jsdom.
 */

/** Decoding at a low rate: onsets survive it, and it is far quicker. */
const ANALYSIS_SAMPLE_RATE = 8000;

export interface BeatAnalysis {
  beats: number[];
  bpm: number | null;
}

/**
 * Detect the beats of an audio file.
 *
 * Returns an empty analysis rather than throwing when the file cannot be
 * fetched or decoded — a failed analysis should leave the timeline exactly as
 * it was, not interrupt an edit.
 */
export const analyseBeats = async (
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<BeatAnalysis> => {
  const Ctx =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return { beats: [], bpm: null };

  let ctx: AudioContext | null = null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return { beats: [], bpm: null };
    const buffer = await res.arrayBuffer();

    ctx = new Ctx({ sampleRate: ANALYSIS_SAMPLE_RATE } as never);
    const audio = await ctx.decodeAudioData(buffer);

    // Downmix: a beat is in both channels, and summing them makes it louder
    // rather than risking a channel where the kick is quiet.
    const length = audio.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += data[i];
    }
    if (audio.numberOfChannels > 1) {
      for (let i = 0; i < length; i++) mono[i] /= audio.numberOfChannels;
    }

    const beats = detectBeats(mono, audio.sampleRate);
    return { beats, bpm: estimateBpm(beats) };
  } catch {
    return { beats: [], bpm: null };
  } finally {
    await ctx?.close().catch(() => undefined);
  }
};

/**
 * Every beat on the timeline, in absolute ms, gathered from the audio clips
 * that have been analysed.
 *
 * Beats are stored relative to their own clip, so a clip dragged along the
 * timeline carries its grid with it.
 */
export const timelineBeats = (
  tracks: { type: string; clips: { startMs: number; beats?: number[] }[] }[]
): number[] => {
  const out: number[] = [];
  for (const track of tracks) {
    if (track.type !== 'audio') continue;
    for (const clip of track.clips) {
      for (const beat of clip.beats || []) out.push(clip.startMs + beat);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
};
