/**
 * Whole-message accept phrases, shared by the conductor's delivered/revising
 * classifier bypass and the conversationalist's intake confirmation. Matching
 * is case/punctuation-tolerant and the message must be ONLY the phrase,
 * optionally followed by the template opt-out clause — anything carrying an
 * instruction ("looks good but make it darker") falls through to the
 * classifier.
 */
export const DELIVERED_ACCEPT_PHRASES = [
  'looks good',
  'perfect',
  'great',
  'love it',
  'lgtm',
  'done',
  'yes',
  'yep',
  'save it',
  'accept',
  'finish',
];

export const DELIVERED_ACCEPT_OPT_OUTS = [
  'no template',
  "don't save it",
  "don't save",
  'dont save it',
  'dont save',
];

/**
 * Deterministic accept match: the normalized message is exactly an accept
 * phrase, or an accept phrase plus the opt-out clause ("looks good, no
 * template"). Returns true without any LLM call.
 */
export const isDeliveredAccept = (text: string): boolean => {
  if (typeof text !== 'string') return false;
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:\s]+$/, '');
  if (!normalized) return false;
  const candidates = [normalized];
  for (const optOut of DELIVERED_ACCEPT_OPT_OUTS) {
    if (normalized.endsWith(optOut)) {
      candidates.push(
        normalized.slice(0, -optOut.length).replace(/[\s,;.!—–-]+$/, '')
      );
    }
  }
  return candidates.some((candidate) =>
    DELIVERED_ACCEPT_PHRASES.includes(candidate)
  );
};
