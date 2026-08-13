import { repair } from '@reaatech/structured-repair-core';
import type { z } from 'zod';

/** Strip a leading ```json / trailing ``` fence, same shape as the
 *  conversationalist's own fence strip. */
const stripCodeFences = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
};

/**
 * Try a plain parse BEFORE handing the reply to `repair()`.
 *
 * `@reaatech/structured-repair-core`'s `repair()` strips `//…` comments
 * string-unaware before it ever attempts a parse, so a perfectly valid reply
 * carrying an `https://` URL gets mangled — and worse, the mangled input can
 * still "repair" into a partial object that shadows the intact original. Every
 * call site here handles LLM JSON that may legitimately contain URLs.
 *
 * Fences → `JSON.parse` → `schema.safeParse`; on any failure fall through to
 * `repair(schema, raw)` with the ORIGINAL raw, preserving its behaviour and its
 * throw semantics (`UnrepairableError`) exactly as the callers already expect.
 */
export async function parseOrRepair<T extends z.ZodType>(
  schema: T,
  raw: string
): Promise<z.infer<T>> {
  try {
    const result = schema.safeParse(JSON.parse(stripCodeFences(raw)));
    if (result.success) return result.data;
  } catch {
    // Not plain JSON — repair is the whole point of this helper.
  }
  return repair(schema, raw);
}
