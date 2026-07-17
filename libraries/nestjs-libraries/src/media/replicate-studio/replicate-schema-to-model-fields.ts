/**
 * Convert a Replicate model's OpenAPI `Input` schema into the shared `ModelField[]`
 * shape used by provider metadata. This is a pure, React-free function so the
 * snapshot script and unit tests can run without the UI bundle.
 */

export interface ReplicateSchemaField {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  format?: string;
  anyOf?: Array<{ type?: string; format?: string; $ref?: string }>;
  allOf?: Array<{ $ref?: string }>;
  oneOf?: Array<{ $ref?: string }>;
  '$ref'?: string;
  'x-order'?: number;
}

export interface ReplicateInputSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, ReplicateSchemaField>;
}

export interface ModelField {
  type: 'select' | 'number' | 'toggle' | 'text';
  name: string;
  label?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  help?: string;
}

const ALWAYS_SKIP = new Set([
  'prompt',
  'mask',
  // Replicate-specific media references are resolved at generation time.
  'image',
  'images',
  'video',
  'audio',
  'init_image',
  'input_image',
  'first_frame_image',
  'subject',
  'reference',
  'source',
]);

function isUriField(name: string, field: ReplicateSchemaField): boolean {
  if (field.format === 'uri') return true;
  if (field.anyOf?.some((a) => a.format === 'uri')) return true;
  const lname = name.toLowerCase();
  return ['image', 'images', 'video', 'audio', 'mask', 'source', 'init_image']
    .some((h) => lname === h || lname.endsWith(`_${h}`));
}

function isFlatScalar(field: ReplicateSchemaField): boolean {
  if (field.enum) return true;
  const t = field.type;
  if (t === 'boolean' || t === 'integer' || t === 'number' || t === 'string') return true;
  return false;
}

function optionLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value);
}

function resolveRef(
  field: ReplicateSchemaField,
  schemas: Record<string, ReplicateSchemaField> | undefined,
): ReplicateSchemaField | undefined {
  if (!schemas) return undefined;
  const resolve = (ref: string): ReplicateSchemaField | undefined => {
    const m = /#\/components\/schemas\/(.+)$/.exec(ref);
    return m ? schemas[m[1]] : undefined;
  };
  if (field.$ref) return resolve(field.$ref);
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const arr = field[key] as Array<{ $ref?: string }> | undefined;
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry?.$ref) {
          const r = resolve(entry.$ref);
          if (r) return r;
        }
      }
    }
  }
  return undefined;
}

function inlineRefs(
  input: ReplicateInputSchema | null | undefined,
  schemas: Record<string, ReplicateSchemaField> | undefined,
): ReplicateInputSchema | null {
  if (!input?.properties || !schemas) return input || null;
  const properties: Record<string, ReplicateSchemaField> = {};
  for (const [key, raw] of Object.entries(input.properties)) {
    const prop = { ...raw };
    const ref = resolveRef(prop, schemas);
    if (ref) {
      for (const f of ['enum', 'type', 'minimum', 'maximum', 'title', 'default', 'description'] as const) {
        if (prop[f] == null && ref[f] != null) prop[f] = ref[f];
      }
      delete (prop as any).allOf;
      delete (prop as any).$ref;
      if (prop.enum != null) {
        delete (prop as any).anyOf;
        delete (prop as any).oneOf;
      }
    }
    properties[key] = prop;
  }
  return { ...input, properties };
}

export function convertReplicateInputSchema(
  rawInput: ReplicateInputSchema | null | undefined,
  schemas?: Record<string, ReplicateSchemaField>,
): ModelField[] {
  const input = inlineRefs(rawInput, schemas);
  if (!input?.properties) return [];

  const required = new Set(input.required || []);
  const fields: ModelField[] = [];

  for (const [name, rawField] of Object.entries(input.properties)) {
    if (ALWAYS_SKIP.has(name)) continue;
    const field = { ...rawField };
    if (isUriField(name, field)) continue;
    if (!isFlatScalar(field)) continue;

    const out: ModelField = { name };
    if (field.title) out.label = field.title;
    if (required.has(name)) out.required = true;
    if (field.description) out.help = field.description;

    if (field.enum && field.enum.length > 0) {
      out.type = 'select';
      out.options = field.enum.map((v) => ({ value: String(v), label: optionLabel(v) }));
      if (field.default !== undefined) out.default = String(field.default);
    } else if (field.type === 'boolean') {
      out.type = 'toggle';
      if (field.default !== undefined) out.default = Boolean(field.default);
    } else if (field.type === 'integer' || field.type === 'number') {
      out.type = 'number';
      if (field.minimum !== undefined) out.min = field.minimum;
      if (field.maximum !== undefined) out.max = field.maximum;
      out.step = field.type === 'integer' ? 1 : 0.1;
      if (field.default !== undefined && typeof field.default === 'number') {
        out.default = field.default;
      }
    } else {
      out.type = 'text';
      if (field.default !== undefined) out.default = String(field.default);
    }

    fields.push(out);
  }

  fields.sort((a, b) => {
    const ao = (input.properties?.[a.name] as any)?.['x-order'] ?? 99;
    const bo = (input.properties?.[b.name] as any)?.['x-order'] ?? 99;
    return ao - bo;
  });

  return fields;
}
