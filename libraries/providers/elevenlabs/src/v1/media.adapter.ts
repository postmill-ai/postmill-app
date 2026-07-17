import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaJobSubmission,
  MediaInputValue,
  resolveApiKey,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

export class ElevenLabsAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'elevenlabs';
  readonly name = 'ElevenLabs';
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

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('ElevenLabs does not support image generation');
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('ElevenLabs does not support video generation');
  }

  // ElevenLabs TTS is synchronous — return the artifact inline.
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const audio = await this.textToSpeech(prompt, options);
    const base64 = Buffer.isBuffer(audio) ? audio.toString('base64') : audio;
    return {
      jobId: `elevenlabs-audio-${Date.now()}`,
      artifactUrl: `data:audio/mpeg;base64,${base64}`,
      metadata: { provider: this.identifier, mime: 'audio/mpeg' },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('ElevenLabs does not support avatar generation');
  }

  async listVoices(options?: MediaGenerateOptions): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('ElevenLabs API key is required');
    const res = await this._fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) throw new Error(`ElevenLabs voices failed: ${await res.text()}`);
    const data = (await res.json()) as {
      voices?: Array<{ voice_id?: string; name?: string; preview_url?: string }>;
    };
    return (data.voices || []).map((v) => ({
      id: v.voice_id || '',
      label: v.name || v.voice_id || '',
      previewUrl: v.preview_url,
    }));
  }

  async textToSpeech(text: string, options?: MediaGenerateOptions): Promise<Buffer | string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('ElevenLabs API key is required');

    // Studio descriptor fields arrive in `options.input` (native ElevenLabs params); fall
    // back to the legacy top-level options so existing AiMediaService callers are unchanged.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const voiceId =
      (typeof input.voice_id === 'string' && input.voice_id) ||
      options?.voiceId ||
      options?.voice ||
      '21m00Tcm4TlvDq8ikWAM';
    const model =
      options?.model ||
      (typeof input.model_id === 'string' ? input.model_id : undefined) ||
      'eleven_monolingual_v1';

    const voiceSettings: Record<string, number | boolean> = {
      stability:
        input.stability !== undefined ? Number(input.stability) : options?.voiceSettings?.stability ?? 0.5,
      similarity_boost:
        input.similarity_boost !== undefined
          ? Number(input.similarity_boost)
          : options?.voiceSettings?.similarityBoost ?? 0.75,
    };
    if (input.style !== undefined) voiceSettings.style = Number(input.style);
    if (input.use_speaker_boost !== undefined) voiceSettings.use_speaker_boost = Boolean(input.use_speaker_boost);

    const res = await this._fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    });

    if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

const _meta = new ElevenLabsAdapter(undefined as unknown as SafeFetchPort);

export const elevenlabsMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new ElevenLabsAdapter(rt.fetch),
};
