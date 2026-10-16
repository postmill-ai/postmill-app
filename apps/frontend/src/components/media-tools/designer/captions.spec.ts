import { describe, it, expect } from 'vitest';
import {
  cuesToCaptionClips,
  formatSrtTimestamp,
  mapTranscriptionToCaptionPhrases,
  parseSubtitles,
  parseSubtitleTimestamp,
  reconcileCaptionWords,
  serializeSrt,
  timelineMsForSourceMs,
  withCaptionClips,
} from './captions';
import type { VideoClip, VideoOutput } from './designer.store';
import type { CaptionWord } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

const voWith = (tracks: VideoOutput['tracks'], durationMs = 10000): VideoOutput =>
  ({
    id: 'o1',
    formatId: 'square',
    name: 'Out',
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs,
    tracks,
  }) as VideoOutput;

describe('reconcileCaptionWords', () => {
  const clip = {
    startMs: 1000,
    endMs: 4000,
    words: [
      { word: 'hello', startMs: 0, endMs: 900 },
      { word: 'there', startMs: 900, endMs: 2100 },
      { word: 'world', startMs: 2100, endMs: 3000 },
    ] as CaptionWord[],
  };

  it('keeps the existing per-word timings when the word count is unchanged', () => {
    const words = reconcileCaptionWords('hi there folks', clip);
    expect(words).toEqual([
      { word: 'hi', startMs: 0, endMs: 900 },
      { word: 'there', startMs: 900, endMs: 2100 },
      { word: 'folks', startMs: 2100, endMs: 3000 },
    ]);
  });

  it('re-splits evenly across the clip duration when the word count changes', () => {
    const words = reconcileCaptionWords('one two', clip)!;
    expect(words.map((w) => w.word)).toEqual(['one', 'two']);
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 1500 });
    expect(words[1]).toMatchObject({ startMs: 1500, endMs: 3000 });
  });

  it('treats newlines and repeated whitespace as word separators', () => {
    const words = reconcileCaptionWords('one  two\nthree', clip)!;
    expect(words.map((w) => w.word)).toEqual(['one', 'two', 'three']);
    // Same count as before → original timings kept.
    expect(words[2]).toMatchObject({ startMs: 2100, endMs: 3000 });
  });

  it('drops the words when the text is emptied', () => {
    expect(reconcileCaptionWords('', clip)).toBeUndefined();
    expect(reconcileCaptionWords('   ', clip)).toBeUndefined();
  });

  it('synthesizes timings when the clip had none', () => {
    const words = reconcileCaptionWords('a b c', { startMs: 500, endMs: 2000 })!;
    expect(words[0]).toMatchObject({ word: 'a', startMs: 0, endMs: 500 });
    expect(words[2]).toMatchObject({ word: 'c', startMs: 1000, endMs: 1500 });
  });
});

describe('timelineMsForSourceMs', () => {
  it('offsets by startMs and re-bases for trimInMs', () => {
    expect(timelineMsForSourceMs({ startMs: 2000, trimInMs: 1500 }, 2500)).toBe(3000);
  });

  it('divides by speed, mirroring sourceTimeForPlayhead', () => {
    // 2× speed: 1 s of source plays in 500 ms of timeline.
    expect(timelineMsForSourceMs({ startMs: 1000, trimInMs: 0, speed: 2 }, 1000)).toBe(1500);
    // 0.5× speed: 1 s of source plays in 2 s of timeline.
    expect(timelineMsForSourceMs({ startMs: 1000, trimInMs: 0, speed: 0.5 }, 1000)).toBe(3000);
  });

  it('treats an unset speed as 1', () => {
    expect(timelineMsForSourceMs({ startMs: 500 }, 700)).toBe(1200);
  });
});

describe('mapTranscriptionToCaptionPhrases', () => {
  const word = (w: string, start: number, end: number) => ({ word: w, start, end });

  it('offsets phrases by the clip startMs and keeps words relative to the phrase start', () => {
    const phrases = mapTranscriptionToCaptionPhrases(
      [word('hello', 0, 0.5), word('world.', 0.5, 1)],
      { startMs: 3000, endMs: 20000 },
      60000
    );
    expect(phrases).toHaveLength(1);
    expect(phrases[0].startMs).toBe(3000);
    expect(phrases[0].endMs).toBe(4000);
    expect(phrases[0].text).toBe('hello world.');
    expect(phrases[0].words).toEqual([
      { word: 'hello', startMs: 0, endMs: 500 },
      { word: 'world.', startMs: 500, endMs: 1000 },
    ]);
  });

  it('excludes words before the trimmed head and re-bases the straddling word', () => {
    const phrases = mapTranscriptionToCaptionPhrases(
      [
        word('gone', 0, 0.8), // fully before trimIn — excluded
        word('straddle', 0.8, 1.2), // crosses the trim-in — starts at the trim
        word('kept', 1.2, 2),
      ],
      { startMs: 5000, endMs: 20000, trimInMs: 1000 },
      60000
    );
    const all = phrases.flatMap((p) => p.words.map((w) => w.word));
    expect(all).toEqual(['straddle', 'kept']);
    expect(phrases[0].startMs).toBe(5000); // straddle re-based: 5000 + (1000-1000)
    expect(phrases[0].endMs).toBe(6000); // kept ends at 5000 + (2000-1000)
  });

  it('rebases timings for a sped-up clip', () => {
    const phrases = mapTranscriptionToCaptionPhrases(
      [word('fast', 2, 3)],
      { startMs: 1000, endMs: 20000, trimInMs: 1000, speed: 2 },
      60000
    );
    // source 2s→3s at 2× with a 1s trim → timeline 1500→2000
    expect(phrases[0].startMs).toBe(1500);
    expect(phrases[0].endMs).toBe(2000);
  });

  it('drops words past the clip end (the trimmed tail)', () => {
    const phrases = mapTranscriptionToCaptionPhrases(
      [word('in', 0, 1), word('out', 5, 6)],
      { startMs: 0, endMs: 2000 },
      60000
    );
    expect(phrases.flatMap((p) => p.words.map((w) => w.word))).toEqual(['in']);
  });

  it('groups at most six words per phrase and splits on sentence punctuation', () => {
    const words = Array.from({ length: 8 }, (_, i) => word(`w${i + 1}`, i, i + 0.5));
    const phrases = mapTranscriptionToCaptionPhrases(words, { startMs: 0, endMs: 30000 }, 60000);
    expect(phrases.map((p) => p.words.length)).toEqual([6, 2]);

    const sentences = mapTranscriptionToCaptionPhrases(
      [word('hi.', 0, 0.5), word('there', 0.5, 1)],
      { startMs: 0, endMs: 30000 },
      60000
    );
    expect(sentences).toHaveLength(2);
  });

  it('skips phrases starting past the composition duration and clamps to it', () => {
    const phrases = mapTranscriptionToCaptionPhrases(
      [word('late', 20, 21), word('edge', 9.5, 12)],
      { startMs: 0, endMs: 30000 },
      10000
    );
    expect(phrases).toHaveLength(1);
    expect(phrases[0].text).toBe('edge');
    expect(phrases[0].endMs).toBe(10000);
  });
});

describe('withCaptionClips', () => {
  it('creates a caption track when none exists', () => {
    const vo = voWith([{ id: 'v1', type: 'video', clips: [] } as VideoOutput['tracks'][number]]);
    const clip = { id: 'c1', startMs: 0, endMs: 1000 } as VideoClip;
    const updated = withCaptionClips(vo, [clip], () => 'track-new');
    expect(updated.tracks).toHaveLength(2);
    expect(updated.tracks[1]).toMatchObject({ id: 'track-new', type: 'caption' });
    expect(updated.tracks[1].clips).toEqual([clip]);
  });

  it('appends to the existing caption track without touching other tracks', () => {
    const vo = voWith([
      { id: 'cap', type: 'caption', clips: [{ id: 'old' } as VideoClip] },
      { id: 'v1', type: 'video', clips: [{ id: 'keep' } as VideoClip] },
    ]);
    const updated = withCaptionClips(vo, [{ id: 'new' } as VideoClip], () => 'unused');
    expect(updated.tracks[0].clips.map((c) => c.id)).toEqual(['old', 'new']);
    expect(updated.tracks[1].clips.map((c) => c.id)).toEqual(['keep']);
  });
});

describe('parseSubtitleTimestamp', () => {
  it('parses SRT comma timestamps', () => {
    expect(parseSubtitleTimestamp('01:02:03,456')).toBe(3723456);
  });

  it('parses VTT dot timestamps, including the short MM:SS form', () => {
    expect(parseSubtitleTimestamp('01:02:03.456')).toBe(3723456);
    expect(parseSubtitleTimestamp('02:03.500')).toBe(123500);
  });

  it('rejects garbage', () => {
    expect(parseSubtitleTimestamp('not a time')).toBeNull();
    expect(parseSubtitleTimestamp('01:99:00,000')).toBeNull();
  });
});

describe('parseSubtitles', () => {
  it('parses SRT blocks with numeric indices and multi-line cues', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,500',
      'Hello there',
      'second line',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'Again',
      '',
    ].join('\n');
    expect(parseSubtitles(srt)).toEqual([
      { startMs: 1000, endMs: 2500, text: 'Hello there\nsecond line' },
      { startMs: 3000, endMs: 4000, text: 'Again' },
    ]);
  });

  it('parses VTT with header, NOTE block, cue identifiers, settings and tags', () => {
    const vtt = [
      'WEBVTT - imported file',
      '',
      'NOTE this is a comment',
      'spanning two lines',
      '',
      'cue-1',
      '00:00:01.000 --> 00:00:02.000 align:center line:90%',
      '<b>Hello</b> <i>world</i>',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'Next cue',
      '',
    ].join('\n');
    expect(parseSubtitles(vtt)).toEqual([
      { startMs: 1000, endMs: 2000, text: 'Hello world' },
      { startMs: 3000, endMs: 4000, text: 'Next cue' },
    ]);
  });

  it('tolerates CRLF, a BOM and skips cues with inverted or missing timings', () => {
    const srt = '\uFEFF1\r\n00:00:02,000 --> 00:00:01,000\r\nInverted\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nGood\r\n';
    expect(parseSubtitles(srt)).toEqual([{ startMs: 2000, endMs: 3000, text: 'Good' }]);
  });
});

describe('cuesToCaptionClips', () => {
  const vo = voWith([], 5000);
  let n = 0;
  const makeId = () => `clip-${++n}`;

  it('maps cues to caption clips at absolute times with evenly-split word timings', () => {
    const { clips, skipped } = cuesToCaptionClips(
      [{ startMs: 1000, endMs: 3000, text: 'two words' }],
      vo,
      makeId
    );
    expect(skipped).toBe(0);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: 'two words' });
    expect(clips[0].words).toEqual([
      { word: 'two', startMs: 0, endMs: 1000 },
      { word: 'words', startMs: 1000, endMs: 2000 },
    ]);
  });

  it('clamps a cue straddling the composition end and counts cues fully past it as skipped', () => {
    const { clips, skipped } = cuesToCaptionClips(
      [
        { startMs: 4000, endMs: 8000, text: 'straddle' },
        { startMs: 6000, endMs: 7000, text: 'past' },
      ],
      vo,
      makeId
    );
    expect(skipped).toBe(1);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ startMs: 4000, endMs: 5000 });
  });
});

describe('serializeSrt', () => {
  it('formats timestamps as HH:MM:SS,mmm', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(3723456)).toBe('01:02:03,456');
    expect(formatSrtTimestamp(999)).toBe('00:00:00,999');
  });

  it('emits numbered blocks ordered by startMs with multi-line text preserved', () => {
    const srt = serializeSrt([
      { startMs: 3000, endMs: 4000, text: 'second' },
      { startMs: 0, endMs: 1500, text: 'first\ntwo lines' },
    ]);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nfirst\ntwo lines\n\n2\n00:00:03,000 --> 00:00:04,000\nsecond\n'
    );
  });
});
