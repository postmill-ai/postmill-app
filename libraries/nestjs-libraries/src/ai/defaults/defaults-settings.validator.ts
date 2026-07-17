import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { MEDIA_CATEGORY_OPERATION } from './default-categories';
import {
  STUDIO_DESCRIPTOR_REGISTRY,
  StudioDescriptorSchema,
  StudioTabSchema,
} from './studio-descriptor-fields.generated';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel } from '@gitroom/provider-kernel';

// ─────────────────────────────────────────────────────────────────────────────
// P7.3 — per-provider+operation settings validation
//
// Media default `settings` are validated against the resolved provider's studio
// descriptor field schema. Keys that are not declared fields for that provider and
// operation are rejected with 400. `prompt` is a runtime input and is always
// stripped; media-input fields are never stored as defaults.
//
// If a provider has no studio descriptor (bespoke studios such as HeyGen/Replicate,
// or STT custom panels such as Deepgram), we fall back to the coarse modality
// bucket used before P7.3. AI model categories have no descriptor and keep their
// small generic allowlist.
// ─────────────────────────────────────────────────────────────────────────────

// Coarse modality bucket each media operation validates against when no descriptor
// match exists.
type MediaBucket = 'image' | 'video' | 'audio' | 'caption';

// Keys common to every media operation.
const MEDIA_COMMON_KEYS = ['seed', 'model_id'];

// Operation-scoped media settings keys, derived from the studio-kit descriptor
// fields across image/video/audio/caption providers.
const MEDIA_BUCKET_KEYS: Record<MediaBucket, Set<string>> = {
  image: new Set([
    ...MEDIA_COMMON_KEYS,
    'resolution',
    'size',
    'aspect_ratio',
    'aspectRatio',
    'width',
    'height',
    'ratio',
    'width_and_height',
    'n',
    'num_images',
    'sampleCount',
    'batch_size',
    'quality',
    'style',
    'steps',
    'cfg_scale',
    'sampler',
    'strength',
    // image source references (resolved at generation time)
    'image_reference',
    'input_images',
    'input_image',
    'promptImage',
    'img_url',
    'image_url',
  ]),
  video: new Set([
    ...MEDIA_COMMON_KEYS,
    'resolution',
    'aspect_ratio',
    'aspectRatio',
    'width',
    'height',
    'ratio',
    'width_and_height',
    'duration',
    'fps',
    'quality',
    'style',
    'generate_audio',
    'camera_motion',
    // video source references (resolved at generation time)
    'image_reference',
    'input_images',
    'input_image',
    'input_audio',
    'input_video',
    'promptImage',
    'img_url',
    'image_url',
    'video_url',
    'audio_url',
    'last_frame_uri',
    'image_uri',
    'audio_uri',
  ]),
  audio: new Set([
    ...MEDIA_COMMON_KEYS,
    'voice',
    'response_format',
    'format',
    'speed',
    'customMode',
    'title',
    'text',
    'style',
    'duration',
  ]),
  caption: new Set([
    ...MEDIA_COMMON_KEYS,
    'language',
    'smart_format',
    'punctuate',
    'diarize',
    'paragraphs',
    'utterances',
    'max_line_count',
    'max_line_width',
    'profanity_filter',
    'detect_language',
    'filler_words',
    'multichannel',
    'numerals',
    'redact',
    'search',
    'replace',
    'substitutions',
  ]),
};

// AI model categories have no per-category settings UI, so only standard inference
// tunables are accepted.
const AI_SETTINGS_KEYS = new Set([
  'temperature',
  'maxTokens',
  'topP',
  'presencePenalty',
  'frequencyPenalty',
  'reasoning',
]);

// Field names that are media inputs and must never be persisted as defaults.
const MEDIA_INPUT_FIELD_NAMES = new Set([
  'image',
  'video',
  'audio',
  'media',
  'sourceUrl',
  'source_url',
  'start_image_url',
  'end_image_url',
  'input_image',
  'input_images',
  'image_url',
  'img_url',
  'promptImage',
  'input_audio',
  'input_video',
  'video_url',
  'audio_url',
  'image_reference',
  'first_frame_image',
  'subject_image',
  'input_reference',
  'last_frame_uri',
  'image_uri',
  'audio_uri',
]);

// Map a media category → its modality bucket via the shared category→operation table.
function mediaBucketForCategory(category: string): MediaBucket {
  const operation = MEDIA_CATEGORY_OPERATION[category as keyof typeof MEDIA_CATEGORY_OPERATION];
  switch (operation) {
    case 'tts':
    case 'audio':
      return 'audio';
    case 'caption':
      return 'caption';
    case 'video':
    case 'avatar':
    case 'video-bg':
    case 'video-upscale':
      return 'video';
    default:
      // image, upscale, bg-remove, inpaint, focal-point, slide → image bucket.
      return 'image';
  }
}

function isMediaInputField(field: { name: string; type: string }): boolean {
  if (field.type === 'media') return true;
  if (field.name === 'prompt') return true;
  if (MEDIA_INPUT_FIELD_NAMES.has(field.name)) return true;
  return false;
}

function descriptorAllowedKeys(
  descriptor: StudioDescriptorSchema,
  category: string,
  model?: string,
): Set<string> | undefined {
  const operation = MEDIA_CATEGORY_OPERATION[category as keyof typeof MEDIA_CATEGORY_OPERATION];

  // Prefer an exact match: fixed-model tab by model id, then tab key by category.
  let tab: StudioTabSchema | undefined = model
    ? descriptor.tabs.find((t) => t.model === model)
    : undefined;

  if (!tab) {
    tab = descriptor.tabs.find((t) => t.key === category);
  }

  // Fall back to the first tab whose operation matches. If several tabs share the
  // same operation (e.g. OpenAI has two image tabs), union their field names so an
  // unknown key is still rejected while all valid keys are accepted.
  if (!tab) {
    const matchingTabs = descriptor.tabs.filter((t) => t.operation === operation);
    if (matchingTabs.length === 0) return undefined;

    const keys = new Set<string>();
    for (const t of matchingTabs) {
      for (const field of t.fields) {
        if (isMediaInputField(field)) continue;
        if (field.name === 'model') continue;
        keys.add(field.name);
      }
    }
    return keys;
  }

  const keys = new Set<string>();
  for (const field of tab.fields) {
    if (isMediaInputField(field)) continue;
    if (field.name === 'model') continue;
    keys.add(field.name);
  }
  return keys;
}

export interface SettingsValidationContext {
  providerId?: string;
  model?: string;
  version?: string;
}

@Injectable()
export class DefaultsSettingsValidator {
  constructor(
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
  ) {}

  validate(
    domain: 'ai' | 'media',
    category: string,
    settings: Record<string, unknown>,
    context?: SettingsValidationContext,
  ): Record<string, unknown> {
    const allowed = this._allowedKeys(domain, category, context);
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'prompt') continue; // runtime input, never persisted as a default
      if (key === 'model') {
        // `model` is a top-level DTO field; it should not hide inside settings.
        throw new BadRequestException(
          `'model' must be provided as a top-level field, not inside settings`,
        );
      }
      if (!allowed.has(key)) {
        throw new BadRequestException(
          `Unknown ${domain} default setting key for category '${category}': ${key}`,
        );
      }
      cleaned[key] = value;
    }

    return cleaned;
  }

  private _allowedKeys(
    domain: 'ai' | 'media',
    category: string,
    context?: SettingsValidationContext,
  ): Set<string> {
    if (domain === 'ai') {
      return AI_SETTINGS_KEYS;
    }

    if (context?.providerId) {
      const descriptor = STUDIO_DESCRIPTOR_REGISTRY[context.providerId];
      if (descriptor) {
        const keys = descriptorAllowedKeys(descriptor, category, context.model);
        if (keys && keys.size > 0) {
          return keys;
        }
      }

      // No descriptor (bespoke/snapshot providers such as Replicate): validate
      // against the committed per-model fields in provider metadata.
      const metadataKeys = this._metadataAllowedKeys(
        context.providerId,
        context.version,
        category,
        context.model,
      );
      if (metadataKeys && metadataKeys.size > 0) {
        return metadataKeys;
      }
    }

    return MEDIA_BUCKET_KEYS[mediaBucketForCategory(category)];
  }

  private _metadataAllowedKeys(
    providerId: string,
    version: string | undefined,
    category: string,
    model?: string,
  ): Set<string> | undefined {
    const metadata = this._kernel.getMetadata('media', providerId, version ?? 'v1')
      ?? this._kernel.getMetadata(
        'media',
        providerId,
        this._kernel.latestActive('media', providerId)?.manifest.version ?? 'v1',
      );
    if (!metadata?.mediaModels) return undefined;

    const list = metadata.mediaModels[category];
    if (!Array.isArray(list) || list.length === 0) return undefined;

    const targets = model
      ? (list.find((m) => m.id === model) ? [list.find((m) => m.id === model)!] : list)
      : list;

    const keys = new Set<string>();
    for (const target of targets) {
      if (!Array.isArray(target.fields)) continue;
      for (const field of target.fields) {
        if (isMediaInputField(field)) continue;
        if (field.name === 'model') continue;
        keys.add(field.name);
      }
    }
    return keys.size > 0 ? keys : undefined;
  }
}
