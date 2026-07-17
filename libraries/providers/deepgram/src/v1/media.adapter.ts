import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaJobSubmission,
  resolveApiKey,
  redactError,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

interface DeepgramListenResponse {
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        words?: { word: string; start: number; end: number }[];
      }[];
    }[];
  };
}

export class DeepgramAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'deepgram';
  readonly name = 'Deepgram';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
    video: false,
    audio: false,
    avatar: false,
    tts: false,
    stt: true,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  async generateImage(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    throw new Error('Deepgram does not support image generation');
  }

  async generateVideo(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Deepgram does not support video generation');
  }

  async generateAudio(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Deepgram does not support audio generation');
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('Deepgram does not support avatar generation');
  }

  async speechToText(audio: Buffer, options?: MediaGenerateOptions): Promise<string> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Deepgram API key is required');

    // 6.1c — build the query with URLSearchParams so a `model` containing `&callback=…` (etc.)
    // can't inject extra Deepgram params (matches speechToTextWords).
    const params = new URLSearchParams({ model: options?.model || 'whisper' });
    const res = await this._fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': options?.mimeType || 'audio/wav',
      },
      body: new Uint8Array(audio),
    });

    if (!res.ok) throw new Error(`Deepgram STT failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as DeepgramListenResponse;
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (!transcript) throw new Error('Deepgram returned no transcript');
    return transcript;
  }

  async speechToTextWords(audio: Buffer, options?: MediaGenerateOptions): Promise<{ text: string; words: { word: string; start: number; end: number }[] }> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('Deepgram API key is required');

    const params = new URLSearchParams({ model: options?.model || 'whisper' });
    // Opt-in caption niceties — callers (the Deepgram studio) pass these via input;
    // the existing timeline path passes none, so its request is unchanged.
    if (options?.input?.smartFormat) {
      params.set('smart_format', 'true');
      params.set('punctuate', 'true');
    }
    const language = options?.input?.language;
    if (typeof language === 'string' && language) params.set('language', language);

    const res = await this._fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': options?.mimeType || 'audio/wav',
      },
      body: new Uint8Array(audio),
    });

    if (!res.ok) throw new Error(`Deepgram STT failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as DeepgramListenResponse;
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    if (!alt?.transcript) throw new Error('Deepgram returned no transcript');
    return { text: alt.transcript, words: alt.words || [] };
  }
}

const _meta = new DeepgramAdapter(undefined as unknown as SafeFetchPort);

export const deepgramMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new DeepgramAdapter(rt.fetch),
};
