export interface MediaProviderCapabilities {
  image: boolean;
  video: boolean;
  audio: boolean;
  avatar: boolean;
  tts: boolean;
  stt: boolean;
  upscale: boolean;
  bgRemove: boolean;
  inpaint: boolean;

  // Extended operation taxonomy for tenant media defaults.
  videoBg?: boolean;
  videoUpscale?: boolean;
  videoToVideo?: boolean;
}

export interface MediaArtifactMetadata {
  provider?: string;
  model?: string;
  mime?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  fps?: number;
  seed?: number;
  costUsd?: number;
  provenance?: string;
  prompt?: string;
  source?: string;
  segments?: { start: number; end: number; text: string }[];
}

export interface MediaGenerationResult {
  multi: boolean;
  image?: string;
  images?: string[];
  metadata?: MediaArtifactMetadata;
}

export type MediaInputValue = string | number | boolean;

// Per-provider credential schema for the Settings → Media modal. Most providers need a
// single API key (the modal's default) and omit this; multi-field providers (e.g. Google
// Vertex: project + location + service-account JSON) declare their fields here so the modal
// renders them dynamically. Mirrors the AI provider's `AiCredentialField`.
export interface MediaCredentialField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'textarea';
  required: boolean;
  placeholder?: string;
  help?: string;
}

// Resolve a single API key from the per-call credential options, tolerating the common
// credential map key names. Shared by every single-key media adapter.
export function resolveApiKey(options?: MediaCredentialOptions): string | undefined {
  return (
    options?.apiKey ||
    options?.credentials?.apiKey ||
    options?.credentials?.key ||
    options?.credentials?.token ||
    undefined
  );
}

export interface MediaCredentialOptions {
  apiKey?: string;
  credentials?: Record<string, string>;
}

export interface MediaGenerateOptions extends MediaCredentialOptions {
  model?: string;
  size?: string;
  n?: number;
  quality?: string;
  version?: string;
  aspectRatio?: string;
  loop?: boolean;
  durationSeconds?: number;
  avatarId?: string;
  sourceUrl?: string;
  voice?: string;
  voiceId?: string;
  format?: string;
  mimeType?: string;
  scale?: number;
  voiceSettings?: { stability?: number; similarityBoost?: number };
  webhookUrl?: string;
  input?: Record<string, MediaInputValue>;
}

export interface MediaJobSubmission {
  jobId: string;
  artifactUrl?: string;
  metadata?: MediaArtifactMetadata;
}

export interface MediaPollResult {
  status: 'pending' | 'completed' | 'failed';
  artifactUrl?: string;
  // Additional finished artifacts from the SAME generation (e.g. Suno returns 2 clips). The
  // primary lands as the job's artifact; each extra is landed by the lifecycle as its own
  // sibling completed job (one render-queue card / File row per clip). Generic — any adapter
  // that produces multiple artifacts per job may populate this.
  extraArtifactUrls?: string[];
  error?: string;
  metadata?: MediaArtifactMetadata;
}

export type MediaOperation = 'image' | 'video' | 'audio';

export interface MediaModelOption {
  id: string;
  label: string;
}

export interface MediaTestConnectionResult {
  ok: boolean;
  message: string;
}

export interface MediaCapability {
  readonly identifier: string;
  readonly name: string;
  readonly capabilities: MediaProviderCapabilities;
  readonly credentialFields?: MediaCredentialField[];

  generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult>;
  generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
  generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
  generateAvatar(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;

  pollJob?(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult>;
  listModels?(operation: MediaOperation, options?: MediaCredentialOptions): Promise<MediaModelOption[]>;
  testConnection?(options?: MediaCredentialOptions): Promise<MediaTestConnectionResult>;

  textToSpeech?(text: string, options?: MediaGenerateOptions): Promise<Buffer | string>;
  speechToText?(audio: Buffer, options?: MediaGenerateOptions): Promise<string>;
  speechToTextWords?(audio: Buffer, options?: MediaGenerateOptions): Promise<{ text: string; words: { word: string; start: number; end: number }[] }>;
  upscaleImage?(imageUrl: string, options?: MediaGenerateOptions): Promise<string>;
  removeBackground?(imageUrl: string, options?: MediaGenerateOptions): Promise<string>;
  inpaintImage?(imageUrl: string, maskUrl: string, prompt: string, options?: MediaGenerateOptions): Promise<string>;

  listVoices?(options?: MediaCredentialOptions): Promise<Array<{ id: string; label: string; previewUrl?: string }>>;
  upscaleVideo?(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
  removeVideoBackground?(videoUrl: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission>;
}

// Legacy alias: the per-org media-generation provider contract was historically named
// `MediaProviderAdapter` in nestjs-libraries. The kernel `MediaCapability` is the identical
// shape; consumers keep the old name via this alias (re-exported by the legacy interface).
export type MediaProviderAdapter = MediaCapability;
