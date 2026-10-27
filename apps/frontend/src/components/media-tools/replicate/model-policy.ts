import type { InputSchema, SchemaField } from './field-classification';

const DURATION_POLICIES: Record<string, { choices: number[]; default: number }> = {
  'google/veo-3.1': { choices: [4, 6, 8], default: 8 },
  'bytedance/seedance-1-pro': { choices: [5, 10], default: 5 },
  'kwaivgi/kling-v2.5-turbo-pro': { choices: [5, 10], default: 5 },
};

const FIELD_PRESENTATION: Record<string, Record<string, Pick<SchemaField, 'title' | 'description'>>> = {
  'google/veo-3.1': {
    image: {
      title: 'First frame',
      description: 'Starting image for the generated video.',
    },
    last_frame: {
      title: 'Last frame (transition)',
      description: 'End frame for a transition. Do not combine with subject/style references.',
    },
    reference_images: {
      title: 'Subject/style references (1–3)',
      description: 'One to three subject or style images. Requires 16:9 and 8 seconds.',
    },
  },
  'bytedance/seedance-1-pro': {
    image: {
      title: 'First frame',
      description: 'Starting image for the generated video.',
    },
    last_frame_image: {
      title: 'Last frame (transition)',
      description: 'End frame for a transition; a first frame is also required.',
    },
  },
  'kwaivgi/kling-v2.5-turbo-pro': {
    start_image: {
      title: 'First frame',
      description: 'Starting image for the generated video.',
    },
    end_image: {
      title: 'Last frame (transition)',
      description: 'End frame for a transition from the first frame.',
    },
  },
  'minimax/video-01': {
    first_frame_image: {
      title: 'First frame',
      description: 'Starting image to animate.',
    },
  },
};

export function schemaWithModelPolicy(
  modelId: string,
  schema: InputSchema | null | undefined
): InputSchema | null | undefined {
  if (!schema) return schema;
  const properties = { ...(schema.properties ?? {}) };
  const duration = DURATION_POLICIES[modelId];
  if (duration) {
    const existing = properties.duration ?? {};
    properties.duration = {
      ...existing,
      type: 'integer',
      title: existing.title || 'Duration',
      description: existing.description || 'Video duration in seconds',
      enum: duration.choices,
      default: duration.default,
      minimum: undefined,
      maximum: undefined,
    };
  } else if (modelId === 'minimax/video-01') {
    properties.duration = {
      title: 'Duration',
      description: 'Video-01 generates approximately 6 seconds; duration cannot be changed.',
      'x-order': properties.duration?.['x-order'],
    };
  }
  for (const [name, presentation] of Object.entries(FIELD_PRESENTATION[modelId] ?? {})) {
    if (properties[name]) properties[name] = { ...properties[name], ...presentation };
  }
  return { ...schema, properties };
}

export function hasVeoReferenceImages(input: Record<string, unknown>): boolean {
  const references = input.reference_images;
  return Array.isArray(references) && references.length > 0;
}

function valuePresent(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const file = value as Record<string, unknown>;
    return Boolean(file.fileId || file.url);
  }
  return true;
}

export function validateModelInput(
  modelId: string,
  input: Record<string, unknown>
): string | null {
  const duration = input.duration;
  const durationProvided = duration !== undefined && duration !== null && duration !== '';
  if (modelId === 'minimax/video-01' && durationProvided) {
    return 'Video-01 has a fixed duration of approximately 6 seconds; remove the duration input.';
  }

  const policy = DURATION_POLICIES[modelId];
  if (policy && durationProvided) {
    const seconds = Number(duration);
    if (!Number.isInteger(seconds) || !policy.choices.includes(seconds)) {
      return `${modelId} duration must be ${policy.choices.join(' or ')} seconds.`;
    }
  }

  if (modelId !== 'google/veo-3.1') return null;
  const references = input.reference_images;
  if (references === undefined || references === null) return null;
  if (!Array.isArray(references)) {
    return 'Veo reference_images must be an array of 1–3 images.';
  }
  if (references.length === 0) return null;
  if (references.length > 3) {
    return 'Veo accepts between 1 and 3 subject/style reference images.';
  }
  if (
    references.some(
      (item) =>
        typeof item !== 'string' &&
        (!item || typeof item !== 'object' || !valuePresent(item))
    )
  ) {
    return 'Each Veo reference image must be a selected file or URL.';
  }
  if (input.aspect_ratio !== '16:9') {
    return 'Veo subject/style references require a 16:9 aspect ratio.';
  }
  if (Number(input.duration) !== 8) {
    return 'Veo subject/style references require an 8-second duration.';
  }
  if (valuePresent(input.last_frame)) {
    return 'Veo last-frame transitions cannot be combined with subject/style references.';
  }
  return null;
}
