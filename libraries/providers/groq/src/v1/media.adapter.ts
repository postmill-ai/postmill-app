import { metadata as providerMetadata } from './metadata';
import {
  OpenAiCompatibleMediaAdapter,
  MediaProviderCapabilities,
  MediaCredentialOptions,
  MediaOperation,
  MediaModelOption,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Groq — same key as the Groq LLM provider (registry id `groq`), reused via the
// universal-credential fallback. Groq's only media surface is TTS (`/openai/v1/audio/speech`,
// PlayAI / Orpheus voices), which rides the OpenAI-compatible base. No image/video.
export class GroqMediaAdapter extends OpenAiCompatibleMediaAdapter {
  readonly identifier = 'groq';
  readonly name = 'Groq';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
    video: false,
    audio: true,
    avatar: false,
    tts: true,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  protected readonly baseUrl = 'https://api.groq.com/openai/v1';
  protected override defaultAudioModel = 'playai-tts';
  protected override defaultVoice = 'Fritz-PlayAI';

  // Groq's /models endpoint lists all (mostly LLM) models without a TTS tag — the descriptor
  // carries the curated TTS model list + free entry instead.
  protected override _modelTypes(): string[] {
    return [];
  }

  override async listModels(_operation: MediaOperation, _options?: MediaCredentialOptions): Promise<MediaModelOption[]> {
    return [];
  }
}

const _meta = new GroqMediaAdapter(undefined as unknown as SafeFetchPort);

export const groqMediaModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'media',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: (_meta as any).credentialFields || [],
    capabilities: (_meta as any).capabilities,
  },
  create: (rt) => new GroqMediaAdapter(rt.fetch),
};
