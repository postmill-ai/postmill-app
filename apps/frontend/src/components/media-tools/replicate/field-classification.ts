// Derives oc-platform's primary-vs-Advanced field split from the raw Replicate
// OpenAPI input schema. oc-faas hardcodes a `components` array per model tagging
// the primary fields by role (prompt / file / size / format); we reproduce those
// roles heuristically so we never have to hardcode 38 model schemas.

export interface SchemaField {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  'x-order'?: number;
  format?: string;
  items?: { type?: string; format?: string };
  anyOf?: Array<{ type?: string; format?: string }>;
}

export interface InputSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaField>;
}

export type FieldRole = 'prompt' | 'negative' | 'file' | 'duration';

// Fields hidden per model, on top of the caller's `excluded` set. video-01's
// `subject_reference` is not an i2v first-frame input: it silently switches
// generation to the upstream S2V-01 subject-to-video model, which failed
// every prod attempt with "Error 1000: unexpected error" (QA 2026-10-26 —
// an uploaded image landed here instead of `first_frame_image`). The studio's
// image-to-video contract is first-frame animation, so the form pins the
// single image upload to `first_frame_image` and never renders the trap.
export const MODEL_HIDDEN_FIELDS: Record<string, string[]> = {
  'minimax/video-01': ['subject_reference'],
};

export interface ClassifiedField {
  name: string;
  field: SchemaField;
  required: boolean;
  role: FieldRole | null; // null => Advanced
  acceptType: 'image' | 'video' | 'audio';
}

export interface ClassifiedSchema {
  primary: ClassifiedField[];
  advanced: ClassifiedField[];
}

const PRIMARY_ORDER: Record<FieldRole, number> = {
  prompt: 1,
  negative: 1,
  file: 2,
  duration: 3,
};

const FILE_NAME_HINTS = [
  'image',
  'images',
  'video',
  'audio',
  'mask',
  'source',
  'init_image',
  'input_image',
  'first_frame_image',
  'subject',
  'reference',
];

function isUriField(name: string, field: SchemaField): boolean {
  if (field.format === 'uri') return true;
  if (field.anyOf?.some((a) => a.format === 'uri')) return true;
  if (field.type === 'array' && field.items?.format === 'uri') return true;
  // Some schemas omit format but the name clearly denotes a media input.
  const lname = name.toLowerCase();
  return FILE_NAME_HINTS.some((h) => lname === h || lname.endsWith(`_${h}`));
}

export function inferAcceptType(name: string, title?: string): 'image' | 'video' | 'audio' {
  const haystack = `${name} ${title || ''}`.toLowerCase();
  if (haystack.includes('video')) return 'video';
  if (haystack.includes('audio') || haystack.includes('sound') || haystack.includes('voice'))
    return 'audio';
  return 'image';
}

function roleFor(name: string, field: SchemaField): FieldRole | null {
  const lname = name.toLowerCase();

  if (lname === 'negative_prompt') return 'negative';
  // Letter-suffixed variants count too: riffusion-style schemas split the
  // prompt across `prompt_a` / `prompt_b` — classifying only `*_prompt` misses
  // them (the compact embed then had no prompt field to drive from the dialog).
  if (/(^|_)prompt(_[a-z])?$/.test(lname) || lname === 'text') return 'prompt';

  if (lname === 'duration') return 'duration';
  if (isUriField(name, field)) return 'file';

  // Everything else (including enum fields like aspect_ratio / output_format)
  // stays in Advanced and renders by its type — enums become selects there.
  return null;
}

export function classifySchema(
  schema: InputSchema | null | undefined,
  excluded: Set<string>
): ClassifiedSchema {
  const props = schema?.properties;
  if (!props) return { primary: [], advanced: [] };

  const required = new Set(schema?.required || []);
  const primary: ClassifiedField[] = [];
  const advanced: ClassifiedField[] = [];

  for (const [name, field] of Object.entries(props)) {
    if (excluded.has(name)) continue;
    const role = roleFor(name, field);
    const entry: ClassifiedField = {
      name,
      field,
      required: required.has(name),
      role,
      acceptType: inferAcceptType(name, field.title),
    };
    if (role) primary.push(entry);
    else advanced.push(entry);
  }

  // Primary order: prompts -> files -> duration, ties broken by x-order.
  primary.sort((a, b) => {
    const oa = PRIMARY_ORDER[a.role as FieldRole];
    const ob = PRIMARY_ORDER[b.role as FieldRole];
    if (oa !== ob) return oa - ob;
    return (a.field['x-order'] ?? 99) - (b.field['x-order'] ?? 99);
  });

  // Advanced ordered purely by x-order (Replicate's intended order).
  advanced.sort((a, b) => (a.field['x-order'] ?? 99) - (b.field['x-order'] ?? 99));

  return { primary, advanced };
}
