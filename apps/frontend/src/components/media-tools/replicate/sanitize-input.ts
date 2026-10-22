import type { InputSchema } from './field-classification';

function valueUnset(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function fileValueFilled(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  return !!obj.fileId || !!obj.url;
}

/**
 * Prepare the dynamic form's input for submission.
 *
 * - Drop empty-string/null/undefined values for OPTIONAL fields so an unset
 *   control is never sent. Providers treat a present-but-empty value as SET:
 *   kling-v2.1 i2v rejected `end_image: ''` with "end_image requires mode
 *   'pro'" even though the user never picked an end image. Required fields are
 *   kept — an empty required value is a validation error
 *   (`missingRequiredFields`), not something to hide by dropping the key.
 * - When `end_image` carries a real value and the schema declares a `mode`
 *   field, force `mode: 'pro'` — kling rejects an end image in any other mode,
 *   so submitting the user's (or the default) `std` is a guaranteed failure.
 */
export function sanitizeModelInput(
  input: Record<string, unknown>,
  schema: InputSchema | null | undefined
): Record<string, unknown> {
  const required = new Set(schema?.required || []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (valueUnset(value) && !required.has(key)) continue;
    out[key] = value;
  }

  const props = schema?.properties || {};
  const modeField = props['mode'];
  if (modeField && !valueUnset(out['end_image']) && fileValueFilled(out['end_image'])) {
    // Only force a value the field can actually take.
    const enumValues = Array.isArray(modeField.enum) ? modeField.enum : undefined;
    if (!enumValues || enumValues.includes('pro')) {
      out['mode'] = 'pro';
    }
  }
  return out;
}
