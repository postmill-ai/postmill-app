import { describe, it, expect } from 'vitest';
import {
  shouldRequestSuggestion,
  normalizeSuggestion,
  withJoiningSpace,
  SuggestContext,
  MIN_PREFIX_CHARS,
  MAX_SUGGESTION_CHARS,
} from './should-suggest';

const base = (): SuggestContext => ({
  enabled: true,
  aiActive: true,
  locked: false,
  isCreateSet: false,
  canEdit: true,
  isEditable: true,
  isFocused: true,
  selectionEmpty: true,
  caretAtEndOfBlock: true,
  textBefore: 'Our new summer drop lands Friday and it is good',
  composing: false,
  suppressed: false,
  requestCount: 0,
});

describe('shouldRequestSuggestion', () => {
  it('fires on a settled, focused, end-of-block caret', () => {
    expect(shouldRequestSuggestion(base())).toBe(true);
  });

  // Each of these costs a metered AI generation, so every gate gets a case.
  const blockers: [string, Partial<SuggestContext>][] = [
    ['the preference is off', { enabled: false }],
    ['the org has no AI provider', { aiActive: false }],
    ['the AI provider state is still loading', { aiActive: undefined }],
    ['the composer is locked', { locked: true }],
    ['a set is being created', { isCreateSet: true }],
    ['the channel is not unlocked for editing', { canEdit: false }],
    ['the editor is read-only', { isEditable: false }],
    ['the editor is not focused', { isFocused: true, selectionEmpty: true, isEditable: false }],
    ['there is a range selection', { selectionEmpty: false }],
    ['the caret is mid-block', { caretAtEndOfBlock: false }],
    ['an IME composition is open', { composing: true }],
    ['the user dismissed with Escape', { suppressed: true }],
    ['the per-mount cap is reached', { requestCount: 60 }],
  ];

  it.each(blockers)('does not fire when %s', (_label, patch) => {
    expect(shouldRequestSuggestion({ ...base(), ...patch })).toBe(false);
  });

  it('does not fire on a blur', () => {
    expect(shouldRequestSuggestion({ ...base(), isFocused: false })).toBe(false);
  });

  it('waits for enough text to have a voice to continue', () => {
    const short = 'a'.repeat(MIN_PREFIX_CHARS - 1);
    expect(shouldRequestSuggestion({ ...base(), textBefore: short })).toBe(false);
    expect(
      shouldRequestSuggestion({ ...base(), textBefore: 'a'.repeat(MIN_PREFIX_CHARS) })
    ).toBe(true);
  });

  it('fires on a short real opening, not just long drafts', () => {
    // Regression: the threshold was 24, so a normal mid-sentence pause like this
    // (15 chars) never fired a request at all and the feature looked dead.
    expect(shouldRequestSuggestion({ ...base(), textBefore: 'Dogs love going' })).toBe(
      true
    );
    // …but a single stray word still isn't worth a metered generation.
    expect(shouldRequestSuggestion({ ...base(), textBefore: 'Dogs' })).toBe(false);
  });

  it('ignores whitespace when measuring the draft', () => {
    expect(
      shouldRequestSuggestion({ ...base(), textBefore: `   ${'a'.repeat(5)}   ` })
    ).toBe(false);
  });

  it('yields to the mention popup mid-@', () => {
    expect(
      shouldRequestSuggestion({
        ...base(),
        textBefore: 'Our new summer drop lands Friday, cc @sol',
      })
    ).toBe(false);
    // A completed mention followed by a space is fine again.
    expect(
      shouldRequestSuggestion({
        ...base(),
        textBefore: 'Our new summer drop lands Friday, cc @solstice ',
      })
    ).toBe(true);
  });
});

describe('normalizeSuggestion', () => {
  const prefix = 'Our new summer drop lands Friday.';

  it('keeps only the first line', () => {
    expect(normalizeSuggestion('Grab yours early.\nAnd tell a friend.', prefix)).toBe(
      'Grab yours early.'
    );
  });

  it('strips wrapping quotes the model likes to add', () => {
    expect(normalizeSuggestion('"Grab yours early."', prefix)).toBe('Grab yours early.');
    expect(normalizeSuggestion('“Grab yours early.”', prefix)).toBe('Grab yours early.');
  });

  it('caps the length', () => {
    const long = 'x'.repeat(MAX_SUGGESTION_CHARS + 50);
    expect(normalizeSuggestion(long, prefix)).toHaveLength(MAX_SUGGESTION_CHARS);
  });

  it('drops a completion that restates the end of the draft', () => {
    // The common model failure: echo the tail of the prompt, then continue.
    expect(normalizeSuggestion('summer drop lands Friday. Grab yours.', prefix)).toBe('');
    expect(normalizeSuggestion('lands Friday. Grab yours.', prefix)).toBe('');
  });

  it('keeps a genuine continuation that happens to reuse a word', () => {
    expect(normalizeSuggestion('Friday is the day.', prefix)).toBe('Friday is the day.');
    expect(normalizeSuggestion('Grab yours early.', prefix)).toBe('Grab yours early.');
  });

  it('returns empty for empty or whitespace-only output', () => {
    expect(normalizeSuggestion('', prefix)).toBe('');
    expect(normalizeSuggestion('   \n  ', prefix)).toBe('');
    expect(normalizeSuggestion('""', prefix)).toBe('');
  });
});

describe('withJoiningSpace', () => {
  it('adds a space when the draft does not end in one', () => {
    expect(withJoiningSpace('Grab yours.', 'Lands Friday.')).toBe(' Grab yours.');
  });

  it('does not double up on an existing space', () => {
    expect(withJoiningSpace('Grab yours.', 'Lands Friday. ')).toBe('Grab yours.');
  });

  it('does not push punctuation away from the word it belongs to', () => {
    expect(withJoiningSpace(', and more', 'Lands Friday')).toBe(', and more');
  });

  it('passes an empty suggestion through', () => {
    expect(withJoiningSpace('', 'anything')).toBe('');
  });
});
