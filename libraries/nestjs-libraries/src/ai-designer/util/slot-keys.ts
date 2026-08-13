/**
 * Align a text record's keys to slot ids. Models (and stored plan cards)
 * routinely key copy by the slot's ROLE (e.g. "primaryHeadline") or a case
 * variant instead of its exact id ("headline") — an exact-only lookup then
 * silently misses and downstream agents rewrite copy that was already
 * approved. Precedence per slot: exact id → normalized id → role match.
 */
/**
 * Replace the machine fixed-copy separator (" | ", `FIXED_COPY_SEPARATOR`)
 * with the render-safe " • " bullet. Pipe-joined compounds leak into single
 * slot texts when a plan copies a fixedCopy compound verbatim — and once a
 * pipe is in a LOCKED text, every render ships the literal "|" glyph (the
 * copy-lock reverts any render-side cleanup). Idempotent; pipe-free strings
 * pass through unchanged.
 */
export const normalizeSlotText = (text: string): string =>
  text.replace(/\s*\|\s*/g, ' • ').trim();

export const matchSlotTexts = (
  record: Record<string, unknown>,
  slots: { id: string; role?: string }[]
): Record<string, string> => {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: Record<string, string> = {};
  const entries = Object.entries(record).filter(
    ([, v]) => typeof v === 'string' && (v as string).trim().length > 0
  ) as [string, string][];
  for (const slot of slots) {
    const exact = entries.find(([k]) => k === slot.id);
    if (exact) {
      out[slot.id] = exact[1];
      continue;
    }
    const wantId = norm(slot.id);
    const wantRole = norm(slot.role || '');
    const fuzzy = entries.find(([k]) => {
      const nk = norm(k);
      return (
        nk === wantId ||
        (wantRole && (nk === wantRole || nk.includes(wantRole) || wantRole.includes(nk)))
      );
    });
    if (fuzzy) out[slot.id] = fuzzy[1];
  }
  return out;
};
