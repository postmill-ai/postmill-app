/**
 * Caption styling — the karaoke/word-pop looks that social video runs on.
 *
 * A caption clip already carries per-word timings; what was missing was any way
 * to say how the active word should look. This resolves a preset plus a
 * playhead into per-word draw state, so the canvas preview and the frame
 * renderer style words identically instead of each inventing a highlight.
 */

export type CaptionPreset =
  | 'plain'
  | 'karaoke'
  | 'word-pop'
  | 'bold-highlight'
  | 'box-highlight';

export interface CaptionWord {
  word: string;
  /** Milliseconds relative to the clip's own start. */
  startMs: number;
  endMs: number;
}

export interface CaptionStyle {
  preset?: CaptionPreset;
  /** Colour of the word being spoken. */
  activeColor?: string;
  /** Colour of words not yet spoken. Defaults to the clip's own fill. */
  inactiveColor?: string;
  /** Colour of words already spoken; defaults to `inactiveColor`. */
  spokenColor?: string;
  /** Background behind the active word, for the box presets. */
  highlightColor?: string;
}

export interface CaptionWordState {
  word: string;
  /** Before, during or after this word's own window. */
  phase: 'spoken' | 'active' | 'upcoming';
  color: string;
  /** 1 = the clip's own font size. Word-pop scales the active word up. */
  scale: number;
  /** Extra weight on the active word, or 0 for none. */
  weight: number;
  /** A filled box behind the word, or undefined. */
  background?: string;
}

export const CAPTION_PRESETS: {
  id: CaptionPreset;
  label: string;
  defaults: CaptionStyle;
}[] = [
  { id: 'plain', label: 'Plain', defaults: {} },
  {
    id: 'karaoke',
    label: 'Karaoke',
    // Spoken words stay lit; the rest wait in a dimmed colour.
    defaults: { activeColor: '#facc15', spokenColor: '#facc15', inactiveColor: '#94a3b8' },
  },
  {
    id: 'word-pop',
    label: 'Word Pop',
    defaults: { activeColor: '#ffffff', inactiveColor: '#ffffff' },
  },
  {
    id: 'bold-highlight',
    label: 'Bold Highlight',
    defaults: { activeColor: '#facc15', inactiveColor: '#ffffff' },
  },
  {
    id: 'box-highlight',
    label: 'Box Highlight',
    defaults: {
      activeColor: '#111827',
      inactiveColor: '#ffffff',
      highlightColor: '#facc15',
    },
  },
];

export const captionPreset = (id: CaptionPreset | undefined) =>
  CAPTION_PRESETS.find((p) => p.id === (id || 'plain')) || CAPTION_PRESETS[0];

/** How far the active word is scaled up by Word Pop, at its peak. */
export const WORD_POP_SCALE = 1.18;

/**
 * The index of the word being spoken at `relativeMs`, or -1.
 *
 * Words are searched rather than assumed sorted, because a transcript edit can
 * reorder them and an out-of-order list would silently highlight nothing.
 */
export const activeWordIndex = (words: CaptionWord[], relativeMs: number): number => {
  for (let i = 0; i < words.length; i++) {
    if (relativeMs >= words[i].startMs && relativeMs < words[i].endMs) return i;
  }
  return -1;
};

/**
 * Per-word draw state for one caption clip at one playhead.
 *
 * The single place a preset turns into colours and sizes — both renderers call
 * this rather than each deciding what "karaoke" looks like.
 */
export const captionWordStates = (
  words: CaptionWord[],
  relativeMs: number,
  style: CaptionStyle | undefined,
  fallbackColor = '#ffffff'
): CaptionWordState[] => {
  const preset = captionPreset(style?.preset);
  const merged: CaptionStyle = { ...preset.defaults, ...(style || {}) };
  const inactive = merged.inactiveColor || fallbackColor;
  const spoken = merged.spokenColor || inactive;
  const active = merged.activeColor || fallbackColor;
  const id = preset.id;
  const activeIndex = activeWordIndex(words, relativeMs);

  return words.map((w, i) => {
    const phase: CaptionWordState['phase'] =
      i === activeIndex ? 'active' : relativeMs >= w.endMs ? 'spoken' : 'upcoming';

    if (id === 'plain') {
      return { word: w.word, phase, color: inactive, scale: 1, weight: 0 };
    }

    const isActive = phase === 'active';
    return {
      word: w.word,
      phase,
      color: isActive ? active : phase === 'spoken' ? spoken : inactive,
      // Only Word Pop changes size; scaling every preset would reflow the line
      // on each word, which reads as jitter rather than emphasis.
      scale: isActive && id === 'word-pop' ? WORD_POP_SCALE : 1,
      weight: isActive && id === 'bold-highlight' ? 900 : 0,
      background: isActive && id === 'box-highlight' ? merged.highlightColor : undefined,
    };
  });
};

/** These same functions as JavaScript source, for the injected frame renderer. */
export const captionStylesSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const CAPTION_PRESETS = ${JSON.stringify(CAPTION_PRESETS)};`,
    `const WORD_POP_SCALE = ${WORD_POP_SCALE};`,
    decl('captionPreset', captionPreset),
    decl('activeWordIndex', activeWordIndex),
    decl('captionWordStates', captionWordStates),
  ].join('\n');
};
