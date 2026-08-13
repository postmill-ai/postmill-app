/**
 * Word-boundary signal matching for skill routing.
 *
 * Every skill's `match()` used `String.includes` over the brief text, so a
 * one- or two-letter signal matched INSIDE unrelated words. The
 * advertisement skill's `'ad'` matched "he**ad**line", "re**ad**y",
 * "m**ad**e", "gr**ad**ient", "lo**ad**" — i.e. very nearly every brief —
 * and scored it 0.9, which is why six consecutive live runs all routed to
 * `advertisement` and four of the five skills had never executed in
 * production.
 *
 * A signal now has to appear as a WHOLE word (case-insensitive), with a
 * simple plural tolerance (`s`/`es`) so "ads", "sales", "memes", "items"
 * still match without re-opening the substring hole. Multi-word signals
 * ("thank you", "now open", "new arrival") match across any run of
 * whitespace. Inflections that are not plurals (announcing, advertising,
 * discounted) are spelled out in the skills' own signal lists — explicit
 * beats a clever suffix regex that would let "ad" match "add" again.
 */

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regexes are pure functions of the signal string and every skill re-matches
// them on each route call, so build each one once.
const cache = new Map<string, RegExp>();

const signalRegExp = (signal: string): RegExp => {
  const cached = cache.get(signal);
  if (cached) return cached;
  const words = signal.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  // `\b` on both ends, plus an optional plural suffix inside the boundary.
  const regex = new RegExp(`\\b${words}(?:es|s)?\\b`, 'i');
  cache.set(signal, regex);
  return regex;
};

/** True when `text` contains `signal` as a whole word (plural tolerated). */
export const matchesSignal = (text: string, signal: string): boolean =>
  signalRegExp(signal).test(text);

/** True when `text` contains ANY of `signals` as a whole word. */
export const matchesAnySignal = (text: string, signals: string[]): boolean =>
  signals.some((signal) => matchesSignal(text, signal));
