/**
 * Caption clip helpers — text-edit reconciliation, speech-to-text word
 * mapping, and SRT/VTT import/export.
 *
 * Everything here is pure (no store, no fetch, no DOM) so the timing maths
 * that the timeline handlers wire up is unit-testable. A caption clip renders
 * from its `words` array in BOTH the Konva overlay and the server frame
 * renderer, so every text-affecting path (inline edit, import) must keep
 * `words` in step with `text` — that is what reconcileCaptionWords is for.
 */

import type { VideoClip, VideoOutput, VideoTrack } from './designer.store';
import type { CaptionWord } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

/** One word from /media/speech-to-text-words — timings in SECONDS, full source. */
export interface TranscribedWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export const MAX_WORDS_PER_CAPTION = 6;

export const splitCaptionText = (text: string): string[] =>
  text.split(/\s+/).filter(Boolean);

/**
 * A1 — re-derive a caption clip's per-word timings after an inline text edit.
 *
 * Same word count: the words were reworded, not re-timed — keep every
 * existing start/end so the karaoke highlight does not shift. Different
 * count: the old timings are meaningless, so each word gets an equal slice of
 * the clip's duration (timings stay relative to the clip start, per the
 * CaptionWord contract). Emptied text drops the words entirely — both
 * renderers tolerate a missing `words` (they draw nothing).
 */
export const reconcileCaptionWords = (
  newText: string,
  clip: { startMs: number; endMs: number; words?: CaptionWord[] }
): CaptionWord[] | undefined => {
  const tokens = splitCaptionText(newText);
  if (!tokens.length) return undefined;
  const existing = clip.words || [];
  if (existing.length === tokens.length) {
    return existing.map((w, i) => ({ ...w, word: tokens[i] }));
  }
  const durationMs = Math.max(1, clip.endMs - clip.startMs);
  const slice = durationMs / tokens.length;
  return tokens.map((word, i) => ({
    word,
    startMs: Math.round(i * slice),
    endMs: Math.round((i + 1) * slice),
  }));
};

/**
 * Timeline position (ms) of a source-file position for one clip — the inverse
 * of `sourceTimeForPlayhead` in video-preview.ts for a forward-playing clip
 * (sourceMs = trimIn + (playheadMs - startMs) * speed). A speed:0 freeze clip
 * has no advancing audio and is filtered out by the caller.
 */
export const timelineMsForSourceMs = (
  clip: { startMs: number; trimInMs?: number; speed?: number },
  sourceMs: number
): number => {
  const speed = clip.speed !== undefined && clip.speed > 0 ? clip.speed : 1;
  return clip.startMs + (sourceMs - (clip.trimInMs || 0)) / speed;
};

/**
 * A2 — map one clip's transcription (full-source seconds) into phrase caption
 * clips on the timeline.
 *
 * Words before the trimmed head (source end <= trimInMs) are excluded; a word
 * straddling the trim-in is re-based to start at the trim point. Words past
 * the clip's own end are trimmed content too and dropped. Phrases are groups
 * of at most MAX_WORDS_PER_CAPTION words (splitting on sentence punctuation),
 * offset by the clip's startMs and rebased for speed, then clipped to the
 * composition duration.
 */
export const mapTranscriptionToCaptionPhrases = (
  words: TranscribedWord[],
  clip: { startMs: number; endMs: number; trimInMs?: number; speed?: number },
  durationMs: number,
  maxWordsPerCaption = MAX_WORDS_PER_CAPTION
): { startMs: number; endMs: number; text: string; words: CaptionWord[] }[] => {
  const trimInMs = clip.trimInMs || 0;
  const clipEndMs = Math.min(clip.endMs, durationMs);

  const rebased: { word: string; startMs: number; endMs: number }[] = [];
  for (const w of words) {
    const srcStartMs = w.start * 1000;
    const srcEndMs = w.end * 1000;
    if (srcEndMs <= trimInMs) continue;
    const startMs = timelineMsForSourceMs(clip, Math.max(srcStartMs, trimInMs));
    const endMs = timelineMsForSourceMs(clip, srcEndMs);
    if (startMs >= clipEndMs) continue;
    rebased.push({ word: w.word, startMs, endMs: Math.min(endMs, clipEndMs) });
  }

  const phrases: { word: string; startMs: number; endMs: number }[][] = [];
  let current: { word: string; startMs: number; endMs: number }[] = [];
  for (const w of rebased) {
    current.push(w);
    if (/[.!?]$/.test(w.word) || current.length >= maxWordsPerCaption) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length) phrases.push(current);

  const out: { startMs: number; endMs: number; text: string; words: CaptionWord[] }[] = [];
  for (const phrase of phrases) {
    const startMs = Math.round(phrase[0].startMs);
    const endMs = Math.round(phrase[phrase.length - 1].endMs);
    if (startMs >= durationMs || endMs <= startMs) continue;
    out.push({
      startMs,
      endMs,
      text: phrase.map((w) => w.word).join(' '),
      words: phrase.map((w) => ({
        word: w.word,
        startMs: Math.round(w.startMs) - startMs,
        endMs: Math.round(w.endMs) - startMs,
      })),
    });
  }
  return out;
};

/** Visual defaults shared by auto-generated and imported caption clips. */
export const captionClipDefaults = (vo: { width: number; height: number }) => ({
  fontFamily: 'Arial',
  fontSize: 28,
  fontWeight: 700,
  fill: '#ffffff',
  x: (vo.width - 300) / 2,
  y: vo.height - 120,
  width: 300,
  height: 70,
});

/**
 * Append clips to the output's caption track, creating the track when absent.
 * Pure — the caller writes the returned output into the store and pushes ONE
 * history entry for the whole batch.
 */
export const withCaptionClips = (
  vo: VideoOutput,
  clips: VideoClip[],
  makeTrackId: () => string
): VideoOutput => {
  const existing = vo.tracks.find((t) => t.type === 'caption');
  if (!existing) {
    const track: VideoTrack = { id: makeTrackId(), type: 'caption', clips };
    return { ...vo, tracks: [...vo.tracks, track] };
  }
  return {
    ...vo,
    tracks: vo.tracks.map((t) =>
      t.id === existing.id ? { ...t, clips: [...t.clips, ...clips] } : t
    ),
  };
};

// ---------------------------------------------------------------------------
// A3 — SRT/VTT parsing (client-side; the repo's `subtitle` package is
// declared for the server bundle only, so this stays dependency-free).
// ---------------------------------------------------------------------------

/** `HH:MM:SS,mmm` (SRT), `HH:MM:SS.mmm` or `MM:SS.mmm` (VTT) → ms. */
export const parseSubtitleTimestamp = (raw: string): number | null => {
  const m = raw
    .trim()
    .match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2], 10);
  const seconds = parseInt(m[3], 10);
  const millis = parseInt(m[4].padEnd(3, '0'), 10);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
};

const stripCueTags = (text: string): string =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/**
 * Parse SRT or VTT content into cues. Handles the WEBVTT header, NOTE
 * comment blocks, cue identifiers (SRT's numeric index, VTT's free-form id),
 * both timestamp separators, multi-line cue text and inline <tags>. Cues with
 * no usable timing line or an empty/inverted range are skipped.
 */
export const parseSubtitles = (input: string): SubtitleCue[] => {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  // Drop the WEBVTT header and any NOTE ... (blank line) comment blocks.
  const body: string[] = [];
  const firstCueLine = lines[0]?.startsWith('WEBVTT') ? 1 : 0;
  for (let i = firstCueLine; i < lines.length; i++) {
    const line = lines[i];
    if (/^NOTE([ \t]|$)/.test(line)) {
      while (i < lines.length && lines[i].trim() !== '') i++;
      continue;
    }
    body.push(line);
  }

  const cues: SubtitleCue[] = [];
  const blocks = body.join('\n').split(/\n{2,}/);
  for (const block of blocks) {
    const blockLines = block.split('\n').filter((l) => l.trim() !== '');
    const timingIdx = blockLines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [rawStart, rawEnd] = blockLines[timingIdx].split('-->');
    const startMs = parseSubtitleTimestamp(rawStart || '');
    // A VTT timing line may carry cue settings after the end timestamp.
    const endMs = parseSubtitleTimestamp((rawEnd || '').trim().split(/[ \t]/)[0] || '');
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const cueText = stripCueTags(blockLines.slice(timingIdx + 1).join('\n'));
    if (!cueText) continue;
    cues.push({ startMs, endMs, text: cueText });
  }
  return cues;
};

/**
 * Map parsed cues to caption clips at their absolute timeline positions.
 * Per-word timings are synthesized by splitting the cue duration evenly
 * across the words. Cues starting past the composition end are skipped (the
 * count is returned for the toast); a cue straddling it is clamped.
 */
export const cuesToCaptionClips = (
  cues: SubtitleCue[],
  vo: VideoOutput,
  makeClipId: () => string
): { clips: VideoClip[]; skipped: number } => {
  const clips: VideoClip[] = [];
  let skipped = 0;
  const defaults = captionClipDefaults(vo);
  for (const cue of cues) {
    const startMs = Math.max(0, Math.round(cue.startMs));
    const endMs = Math.min(Math.round(cue.endMs), vo.durationMs);
    if (startMs >= vo.durationMs || endMs <= startMs) {
      skipped++;
      continue;
    }
    const words = reconcileCaptionWords(cue.text, { startMs, endMs });
    clips.push({
      id: makeClipId(),
      startMs,
      endMs,
      text: cue.text,
      words,
      ...defaults,
    } as VideoClip);
  }
  return { clips, skipped };
};

// ---------------------------------------------------------------------------
// A4 — SRT export.
// ---------------------------------------------------------------------------

export const formatSrtTimestamp = (ms: number): string => {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const minutes = Math.floor((clamped % 3600000) / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
};

/**
 * Caption-track clips → numbered SRT blocks, ordered by startMs. Multi-line
 * clip text is kept as-is — SRT cues are themselves multi-line.
 */
export const serializeSrt = (
  clips: { startMs: number; endMs: number; text?: string }[]
): string =>
  [...clips]
    .sort((a, b) => a.startMs - b.startMs)
    .map(
      (c, i) =>
        `${i + 1}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}\n${c.text || ''}`
    )
    .join('\n\n') + '\n';
