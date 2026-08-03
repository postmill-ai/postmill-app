import { describe, it, expect } from 'vitest';
import {
  activeWordIndex,
  captionPreset,
  captionStylesSource,
  captionWordStates,
  CAPTION_PRESETS,
  WORD_POP_SCALE,
  type CaptionWord,
} from './caption-styles';

const words: CaptionWord[] = [
  { word: 'one', startMs: 0, endMs: 300 },
  { word: 'two', startMs: 300, endMs: 600 },
  { word: 'three', startMs: 600, endMs: 900 },
];

describe('activeWordIndex', () => {
  it('finds the word being spoken', () => {
    expect(activeWordIndex(words, 0)).toBe(0);
    expect(activeWordIndex(words, 450)).toBe(1);
  });

  it('treats a word’s end as belonging to the NEXT word', () => {
    // Otherwise two words highlight on the boundary frame.
    expect(activeWordIndex(words, 300)).toBe(1);
  });

  it('has no answer before the first word or after the last', () => {
    expect(activeWordIndex(words, -100)).toBe(-1);
    expect(activeWordIndex(words, 5000)).toBe(-1);
  });

  it('does not assume the list is sorted', () => {
    const shuffled = [words[2], words[0], words[1]];
    expect(shuffled[activeWordIndex(shuffled, 450)].word).toBe('two');
  });
});

describe('captionPreset', () => {
  it('falls back to plain for an unknown or missing preset', () => {
    expect(captionPreset(undefined).id).toBe('plain');
    expect(captionPreset('nonsense' as never).id).toBe('plain');
  });

  it('has a label for every preset', () => {
    for (const p of CAPTION_PRESETS) expect(p.label.length).toBeGreaterThan(0);
  });
});

describe('captionWordStates', () => {
  it('marks each word spoken, active or upcoming', () => {
    const states = captionWordStates(words, 450, { preset: 'karaoke' });
    expect(states.map((s) => s.phase)).toEqual(['spoken', 'active', 'upcoming']);
  });

  it('leaves every word the same in the plain preset', () => {
    const states = captionWordStates(words, 450, { preset: 'plain' }, '#abcdef');
    expect(new Set(states.map((s) => s.color)).size).toBe(1);
    expect(states.every((s) => s.scale === 1 && s.weight === 0)).toBe(true);
  });

  it('keeps spoken words lit in karaoke', () => {
    const states = captionWordStates(words, 450, { preset: 'karaoke' });
    expect(states[0].color).toBe(states[1].color);
    expect(states[2].color).not.toBe(states[1].color);
  });

  it('scales only the active word in word-pop', () => {
    const states = captionWordStates(words, 450, { preset: 'word-pop' });
    expect(states[1].scale).toBe(WORD_POP_SCALE);
    expect(states[0].scale).toBe(1);
  });

  it('does not scale in any other preset — resizing every word reads as jitter', () => {
    for (const preset of ['karaoke', 'bold-highlight', 'box-highlight'] as const) {
      expect(captionWordStates(words, 450, { preset }).every((s) => s.scale === 1)).toBe(true);
    }
  });

  it('weights the active word in bold-highlight', () => {
    const states = captionWordStates(words, 450, { preset: 'bold-highlight' });
    expect(states[1].weight).toBe(900);
    expect(states[0].weight).toBe(0);
  });

  it('boxes only the active word in box-highlight', () => {
    const states = captionWordStates(words, 450, { preset: 'box-highlight' });
    expect(states[1].background).toBeTruthy();
    expect(states[0].background).toBeUndefined();
  });

  it('lets explicit colours beat the preset’s defaults', () => {
    const states = captionWordStates(words, 450, {
      preset: 'karaoke',
      activeColor: '#ff0000',
    });
    expect(states[1].color).toBe('#ff0000');
  });

  it('falls back to the clip’s own colour when nothing is set', () => {
    const states = captionWordStates(words, 450, undefined, '#123456');
    expect(states[0].color).toBe('#123456');
  });

  it('styles nothing as active outside the clip’s words', () => {
    const states = captionWordStates(words, 5000, { preset: 'word-pop' });
    expect(states.every((s) => s.phase !== 'active')).toBe(true);
  });

  it('returns one state per word, in order', () => {
    const states = captionWordStates(words, 100, { preset: 'karaoke' });
    expect(states.map((s) => s.word)).toEqual(['one', 'two', 'three']);
  });
});

describe('captionStylesSource', () => {
  it('runs, and agrees with the imported function', () => {
    const fn = new Function(
      `${captionStylesSource()}
      return captionWordStates;`
    ) as () => typeof captionWordStates;
    expect(fn()(words, 450, { preset: 'word-pop' })).toEqual(
      captionWordStates(words, 450, { preset: 'word-pop' })
    );
  });
});
