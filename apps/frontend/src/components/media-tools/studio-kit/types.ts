import type React from 'react';
import type { ModelField } from '@postmill-ai/provider-kernel';

// A media file reference produced by the media picker (MediaSelectorModal).
export interface FileFieldValue {
  fileId?: string;
  url?: string;
  type?: 'image' | 'video' | 'audio';
}

export type StudioFieldValue = string | number | boolean | FileFieldValue | undefined;

interface StudioFieldBase {
  name: string;
  label?: string;
  required?: boolean;
  help?: string;
}

export interface PromptField extends StudioFieldBase {
  type: 'prompt';
  placeholder?: string;
}
export interface MediaField extends StudioFieldBase {
  type: 'media';
  accept: 'image' | 'video' | 'audio';
}

/**
 * Runtime-facing superset of the kernel `ModelField`.
 *
 * - `source: 'models'` is a studio-only hint for dynamic model discovery.
 * - `prompt` and `media` are generation-time inputs and never persisted as defaults.
 */
export type StudioField =
  | (ModelField & {
      type: 'select';
      source?: 'models';
      optionRules?: {
        when: Record<string, string | number | boolean>;
        options: NonNullable<ModelField['options']>;
      }[];
    })
  | (ModelField & { type: 'number' })
  | (ModelField & { type: 'toggle' })
  | (ModelField & { type: 'text' })
  | PromptField
  | MediaField;

export function studioSelectOptions(
  field: Extract<StudioField, { type: 'select' }>,
  values: Record<string, StudioFieldValue>
) {
  const rule = field.optionRules?.find(({ when }) =>
    Object.entries(when).every(([name, expected]) => values[name] === expected)
  );
  return rule?.options ?? field.options ?? [];
}

export interface StudioCustomProps {
  provider: string;
  onGenerated: () => void;
}

export interface StudioTab {
  key: string;
  label: string;
  // Media kind → backend routing (generate) + Designer handoff type.
  operation: 'video' | 'image' | 'audio';
  // Fixed model id, or omit and add a `select` field named "model".
  model?: string;
  description?: string;
  fields: StudioField[];
  // Escape hatch: a bespoke panel (HeyGen-style structured tools) instead of the form.
  custom?: React.ComponentType<StudioCustomProps>;
}

// Marketing content for the "not configured yet" landing page. Most users have never
// heard of these providers, so each studio ships a short, grounded pitch — what it is,
// what it supports, why use it, and where to learn more / sign up.
export interface StudioLanding {
  // Official provider homepage (opened in a new tab via an external-link button).
  website: string;
  // Punchy one-line headline.
  tagline: string;
  // 1-2 sentence description of what the provider is and why it's notable.
  description: string;
  // Capability tags (e.g. 'Image', 'Video', 'Audio', 'Avatar', 'Voice').
  badges: string[];
  // 4-5 short benefit bullets.
  highlights: string[];
  // Optional brand-icon override (ProviderIcon id) for studios whose `provider` is a
  // shared credential id rather than the brand — e.g. Pika rides `fal`.
  icon?: string;
}

export interface StudioDescriptor {
  provider: string;
  title: string;
  tabs: StudioTab[];
  landing?: StudioLanding;
}

export interface GeneratedMediaMetadata {
  dimensions?: { width: number; height: number };
  durationMs?: number;
}

export interface StudioJob {
  id: string;
  operation: string;
  model?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  artifactUrl: string | null;
  fileId: string | null;
  /**
   * Content-classified type of the stored File ('image' | 'video' | 'audio' | …),
   * resolved from the File row by the backend. May differ from `operation` — a
   * video-operation job can land an artifact with a different content type. Null
   * until the File row resolves; fall back to `operation` in that case.
   */
  fileType: string | null;
  metadata?: GeneratedMediaMetadata | null;
  error: string | null;
  createdAt: string;
}

export interface StudioGenerateBody {
  operation: 'video' | 'image' | 'audio';
  model?: string;
  input: Record<string, string | number | boolean>;
  mediaInputs?: Record<string, string>;
  folderId?: string | null;
}
