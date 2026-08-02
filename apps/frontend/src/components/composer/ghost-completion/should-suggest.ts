/**
 * The decision half of inline ghost-text completion, kept free of TipTap and
 * React so it can be exercised as a plain table of cases.
 *
 * Every gate here exists to stop a request that would either be wrong or
 * wasteful — each one costs a metered `utility`-scope generation against the
 * org's AI budget, and the composer fires on a typing pause.
 */

/**
 * Shortest draft worth completing. Deliberately low: "Dogs love going" is 15
 * characters and is exactly the moment a completion helps most. This only needs
 * to stop a single stray word ("Dogs") from becoming a request — the real spend
 * controls are the debounce, the prefix cache and the per-mount cap.
 *
 * Must stay in step with `AI_SUGGEST_MIN_PREFIX` in `ai-user.controller.ts`, or
 * the client fires requests the server refuses.
 */
export const MIN_PREFIX_CHARS = 10;

/**
 * How long typing must be still before a request goes out.
 *
 * This is added to the model round-trip, so it dominates how responsive the
 * feature feels: at 1200ms a ~800ms completion took ~2s to appear. 500ms is
 * still comfortably longer than the gap between keystrokes in normal typing, so
 * it does not fire mid-word, and an in-flight request is aborted the moment
 * typing resumes.
 */
export const SUGGEST_DEBOUNCE_MS = 500;

/** Per-mount ceiling, so a long editing session can't run away. */
export const MAX_REQUESTS_PER_MOUNT = 60;

export interface SuggestContext {
  /** The user's "Suggest while I type" preference. */
  enabled: boolean;
  /** The org has an active AI provider. `undefined` while still loading. */
  aiActive: boolean | undefined;
  /** Composer-level locks: publishing in flight, or a set being created. */
  locked: boolean;
  isCreateSet: boolean;
  /** False when the channel is showing the "edit content" blur overlay. */
  canEdit: boolean;
  isEditable: boolean;
  isFocused: boolean;
  /** A range selection means the user is about to replace, not continue. */
  selectionEmpty: boolean;
  /** The caret sits at the end of its text block. */
  caretAtEndOfBlock: boolean;
  /** Plain-text content before the caret. */
  textBefore: string;
  /** IME composition in progress. */
  composing: boolean;
  /** The user pressed Escape on the last suggestion. */
  suppressed: boolean;
  /** Requests already made since this editor mounted. */
  requestCount: number;
}

export const shouldRequestSuggestion = (ctx: SuggestContext): boolean => {
  if (!ctx.enabled) return false;
  if (ctx.aiActive !== true) return false;
  if (ctx.suppressed) return false;
  if (ctx.locked || ctx.isCreateSet || !ctx.canEdit) return false;
  if (!ctx.isEditable || !ctx.isFocused) return false;
  if (!ctx.selectionEmpty) return false;
  if (!ctx.caretAtEndOfBlock) return false;
  if (ctx.composing) return false;
  if (ctx.requestCount >= MAX_REQUESTS_PER_MOUNT) return false;
  if (ctx.textBefore.trim().length < MIN_PREFIX_CHARS) return false;
  // Mid-mention: TipTap's own suggestion popup owns the keyboard here, and a
  // completion would fight it.
  if (/@\S*$/.test(ctx.textBefore)) return false;
  return true;
};

/**
 * Reduce a model response to something safe to splice in after the caret:
 * one line, no wrapping quotes, bounded length, and never a restatement of what
 * the user already wrote.
 */
export const MAX_SUGGESTION_CHARS = 160;

/** Bounds on the opening phrase compared against the draft's tail. */
const ECHO_MAX_WORDS = 8;
const ECHO_MIN_WORDS = 2;
const ECHO_MIN_CHARS = 8;

export const normalizeSuggestion = (raw: string, prefix: string): string => {
  const firstLine = (raw || '').split('\n')[0].trim();
  const unquoted = firstLine
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
  if (!unquoted) return '';

  const clipped = unquoted.slice(0, MAX_SUGGESTION_CHARS).trim();
  if (!clipped) return '';

  // Models like to restate the end of the prompt before continuing ("…lands
  // Friday. Grab yours."). The overlap has no fixed length, so try the longest
  // opening phrase first and work down. Two words is the floor, and the phrase
  // must be substantial enough that ordinary repetition ("is the") can't trip
  // it — otherwise a legitimate continuation gets thrown away.
  const draftTail = prefix.trim().toLowerCase().replace(/\s+/g, ' ');
  const openingWords = clipped.toLowerCase().split(/\s+/).filter(Boolean);
  for (
    let n = Math.min(ECHO_MAX_WORDS, openingWords.length);
    n >= ECHO_MIN_WORDS;
    n--
  ) {
    const opening = openingWords.slice(0, n).join(' ');
    if (opening.length < ECHO_MIN_CHARS) continue;
    if (draftTail.endsWith(opening)) return '';
  }

  return clipped;
};

/**
 * Ghost text is spliced in verbatim, so it must carry its own leading space
 * when the draft doesn't already end in whitespace.
 */
export const withJoiningSpace = (suggestion: string, prefix: string): string => {
  if (!suggestion) return '';
  if (!prefix) return suggestion;
  if (/\s$/.test(prefix)) return suggestion;
  if (/^[\s.,!?;:)\]}]/.test(suggestion)) return suggestion;
  return ` ${suggestion}`;
};
