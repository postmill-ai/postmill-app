import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

/** One addressable output of a doc, as far as alias resolution is concerned. */
export interface FormatCandidate {
  formatId: string;
  /** The output's own display name, when the doc carries one. */
  name?: string;
}

/**
 * Words that carry no format identity. "the story" and "story" must resolve to
 * the same output, and "the Facebook version" must not fail on "version".
 */
const ALIAS_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'this',
  'that',
  'these',
  'those',
  'one',
  'version',
  'format',
  'size',
  'variant',
  'design',
  'image',
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !ALIAS_STOPWORDS.has(token));

const fold = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Display names/providers a format id answers to (preset first, doc second). */
const aliasesFor = (candidate: FormatCandidate): {
  names: string[];
  providers: string[];
} => {
  const preset = CHANNEL_PRESETS.find((p) => p.id === candidate.formatId);
  const names = [preset?.name, candidate.name].filter(
    (n): n is string => typeof n === 'string' && !!n.trim()
  );
  const providers = [preset?.provider].filter(
    (p): p is string => typeof p === 'string' && !!p.trim()
  );
  return { names, providers };
};

/**
 * Map whatever the user (or the classifier relaying them) called a format onto
 * a formatId that the doc ACTUALLY has.
 *
 * Both format-scope resolvers used strict `formatId` equality, so "Facebook",
 * "the story" or "Instagram Post" pinned nothing and every format-scoped
 * revision quietly degraded to shared — the user's "only on the Facebook one"
 * was applied to all three sizes. `CHANNEL_PRESETS` already carries the id,
 * the display name and the provider, so the mapping is a lookup, not a guess.
 *
 * Deliberately restricted to `formats` (the doc's own outputs): a name that
 * matches a preset the doc does not carry resolves to nothing, exactly as
 * before. Matching runs tier by tier — id, then full display name, then
 * provider, then a token subset — so a precise id can never lose to a fuzzy
 * name. Within a tier the doc's own order wins (the primary output first),
 * which is the same tie-break `_resolveTargetOutputIndexes` already applies.
 */
export const resolveFormatAlias = (
  candidate: string,
  formats: FormatCandidate[]
): string | undefined => {
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;

  // Tier 1 — the id itself (case-folded; the common, exact case).
  const foldedCandidate = fold(candidate);
  const byId = formats.find((f) => fold(f.formatId) === foldedCandidate);
  if (byId) return byId.formatId;

  const enriched = formats.map((format) => ({
    format,
    ...aliasesFor(format),
  }));

  // Tier 2 — a full display name ("Facebook Post", "Instagram Story").
  const byName = enriched.find((entry) =>
    entry.names.some((name) => fold(name) === foldedCandidate)
  );
  if (byName) return byName.format.formatId;

  // Tier 3 — the channel provider ("facebook", "instagram").
  const byProvider = enriched.find((entry) =>
    entry.providers.some((provider) => fold(provider) === foldedCandidate)
  );
  if (byProvider) return byProvider.format.formatId;

  // Tier 4 — every meaningful word of the candidate appears in the format's
  // name or provider ("facebook" ⊂ "Facebook Post", "the story" ⊂ "Instagram
  // Story"). An empty token set (the candidate was all stopwords) matches
  // nothing rather than everything.
  const tokens = tokenize(candidate);
  if (tokens.length === 0) return undefined;
  const bySubset = enriched.find((entry) => {
    const haystack = new Set([
      ...entry.names.flatMap(tokenize),
      ...entry.providers.flatMap(tokenize),
      ...tokenize(entry.format.formatId),
    ]);
    return tokens.every((token) => haystack.has(token));
  });
  return bySubset?.format.formatId;
};
