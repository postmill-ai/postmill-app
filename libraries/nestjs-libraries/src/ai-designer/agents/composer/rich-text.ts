import type { TextRun } from '../../../media/designer-doc/designer-doc.schema';

/**
 * Emphasis inside a headline.
 *
 * One word set heavier or in the accent colour is the most basic typographic
 * move there is, and the composer could not make it: every text element was a
 * single flat string in one weight and one fill. A headline reading
 * "Half price this week" gave equal weight to "Half price" and to "this week",
 * so the offer — the only part anyone needs to read — carried no more emphasis
 * than the filler around it.
 *
 * What to emphasise is not a guess. The art director already extracts the
 * brief's offer tokens (discounts, prices, codes, dates) to check that plans
 * carry them; those same tokens are exactly what a designer would set apart.
 */

export interface EmphasisStyle {
  /** Weight for the emphasised runs. Falls back to the element's own. */
  fontWeight?: number;
  /** Fill for the emphasised runs — usually the palette accent. */
  fill?: string;
}

/** Longest first, so "30% off" wins over "30%" when both are present. */
const byLengthDesc = (a: string, b: string) => b.length - a.length;

const escapeForRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split `text` into runs, emphasising every occurrence of `tokens`.
 *
 * Returns `null` when nothing matched, so the caller keeps its plain string
 * rather than storing a single-run `richText` that means the same thing —
 * `_clampTextToFit` skips any element carrying `richText`, so a pointless one
 * would silently opt the headline out of overflow correction.
 */
export const emphasise = (
  text: string,
  tokens: string[],
  style: EmphasisStyle
): TextRun[] | null => {
  const clean = (tokens || [])
    .map((t) => (t || '').trim())
    .filter((t) => t.length >= 2)
    .sort(byLengthDesc);
  if (!text?.trim() || !clean.length) return null;
  if (!style.fontWeight && !style.fill) return null;

  const pattern = new RegExp(`(${clean.map(escapeForRegex).join('|')})`, 'gi');
  const runs: TextRun[] = [];
  let cursor = 0;
  let matched = false;

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) runs.push({ text: text.slice(cursor, at) });
    runs.push({
      // The ORIGINAL casing from the headline, never the token's. A preset with
      // `headlineTransform: 'uppercase'` has already decided the case, and
      // substituting the token would undo it mid-line.
      text: text.slice(at, at + match[0].length),
      ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
      ...(style.fill ? { fill: style.fill } : {}),
    });
    cursor = at + match[0].length;
    matched = true;
  }

  if (!matched) return null;
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });

  // Every run emphasised is the same as none: the contrast is what carries the
  // meaning, and a headline entirely in the accent has no emphasis at all.
  if (runs.every((r) => r.fontWeight || r.fill)) return null;

  return runs;
};

/**
 * The tokens worth emphasising in a headline.
 *
 * Deliberately narrow. Percentages, currency amounts and standalone numerals
 * are what a promotional headline is for; emphasising an ordinary word would
 * just be arbitrary decoration, and emphasising several is emphasising none.
 */
export const emphasisTokens = (text: string): string[] => {
  const found = new Set<string>();
  const patterns = [
    /\d+\s?%(?:\s?off)?/gi, // 40%, 40% off
    /[£$€]\s?\d[\d,.]*/g, // £20, $19.99
    /\b\d+\s?(?:for|x)\s?\d+\b/gi, // 2 for 1, 3x2
    /\bfree\b/gi,
    /\bhalf\s+price\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim();
      if (value.length >= 2) found.add(value);
    }
  }
  // One emphasis per headline. Two competing emphases read as a ransom note,
  // and the longest match is the most specific ("40% off" over "40%").
  return [...found].sort(byLengthDesc).slice(0, 1);
};
