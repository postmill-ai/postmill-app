import { metadata as providerMetadata } from './metadata';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  MediaInputValue,
  resolveApiKey,
  redactError,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Sora video models (sora-2 / sora-2-pro) on the async Videos API. The finished MP4 is auth-only
// bytes at /v1/videos/{id}/content (no public URL), so pollJob downloads it with the key and
// returns it inline as a data URL — see pollJob.
const SORA_BASE = 'https://api.openai.com/v1/videos';

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// 5.7 — the auth-only MP4 is buffered then base64-inflated (~2.3× resident); reject via the
// content-length header BEFORE buffering so a huge render can't blow the 2 GB heap. Matches the
// lifecycle's MAX_ARTIFACT_BYTES so nothing that passes here is rejected later.
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

// 6.1j — cap a fetched source frame before buffering it into the multipart upload.
const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;

// 2.3 — stream the body with a running byte counter, aborting once it passes the cap, so a
// chunked / no-content-length body can't be fully buffered into the heap before the size check.
// Returns null when the cap is exceeded (the caller maps that to a terminal failure).
async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

interface SoraJob {
  id?: string;
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  error?: { message?: string } | null;
}

// Map a TTS response_format to the data-URL mime so the artifact lands with the right type.
const TTS_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

interface OpenAIImageResponse {
  data?: { url?: string; b64_json?: string }[];
}

interface OpenAITranscriptionResponse {
  text?: string;
  segments?: { start: number; end: number; text: string }[];
}

export class OpenaiMediaAdapter implements MediaProviderAdapter {
  constructor(private readonly _fetch: SafeFetchPort) {}
  readonly identifier = 'openai';
  readonly name = 'OpenAI';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: true,
    audio: true,
    avatar: false,
    tts: true,
    stt: true,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  private _apiKey(options?: MediaGenerateOptions): string {
    const apiKey = resolveApiKey(options);
    if (!apiKey) throw new Error('OpenAI API key is required');
    return apiKey;
  }

  async generateImage(prompt: string, options?: MediaGenerateOptions): Promise<MediaGenerationResult> {
    const apiKey = this._apiKey(options);
    const model = options?.model || 'dall-e-3';

    // Native params (size, quality, style, background, output_format, n, …) ride through
    // `options.input` so the descriptor exposes each model's full surface; defaults below
    // apply only when input omits them. gpt-image-1 returns b64_json (no url).
    const res = await this._fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: options?.n || 1,
        size: options?.size || '1024x1024',
        quality: options?.quality || 'standard',
        ...(options?.input || {}),
      }),
    });

    if (!res.ok) throw new Error(`OpenAI image generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as OpenAIImageResponse;
    const fmt = String(options?.input?.output_format || 'png');
    const dataMime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
    const urls = (data.data || [])
      .map((d) => d.url || (d.b64_json ? `data:${dataMime};base64,${d.b64_json}` : undefined))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (urls.length === 0) throw new Error('OpenAI returned no images');
    return {
      multi: urls.length > 1,
      image: urls[0],
      images: urls,
      metadata: { provider: this.identifier, model },
    };
  }

  // Sora text-to-video and image-to-video via the async Videos API. POST /v1/videos returns a job
  // id; the poll-cron drives pollJob to completion (no webhook). Native params (size, seconds)
  // ride through `options.input`. A source frame (`input_reference`, resolved to a URL server-side)
  // is uploaded as the multipart `input_reference` field; text-to-video sends a plain JSON body.
  async generateVideo(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const apiKey = this._apiKey(options);
    const model = options?.model || 'sora-2';
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const { input_reference, ...rest } = input;

    const params: Record<string, string> = {
      model,
      prompt,
      size: String(rest.size || options?.size || '1280x720'),
      seconds: String(rest.seconds || '8'),
    };
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'size' || k === 'seconds') continue;
      if (v !== undefined && v !== '') params[k] = String(v);
    }

    let res;
    if (typeof input_reference === 'string' && input_reference) {
      // Image-to-video: fetch the source frame and upload it as a multipart file.
      const imgRes = await this._fetch(input_reference);
      if (!imgRes.ok) throw new Error(`Sora reference image fetch failed (${imgRes.status})`);
      // 6.1j — content-length pre-check + streamed cap so an oversized source frame can't be
      // fully buffered before the size check.
      const declaredLen = Number(imgRes.headers.get('content-length') || '0');
      if (declaredLen && declaredLen > MAX_SOURCE_IMAGE_BYTES) {
        throw new Error('Sora reference image exceeds the size limit');
      }
      const bytes = await readCapped(imgRes as unknown as Response, MAX_SOURCE_IMAGE_BYTES);
      if (!bytes) throw new Error('Sora reference image exceeds the size limit');
      const mime = imgRes.headers.get('content-type')?.split(';')[0] || 'image/png';
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append('input_reference', new Blob([new Uint8Array(bytes)], { type: mime }), `reference.${ext}`);
      res = await this._fetch(SORA_BASE, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      res = await this._fetch(SORA_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(params),
      });
    }

    if (!res.ok) throw new Error(`Sora video generation failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as SoraJob;
    if (!data.id) throw new Error('Sora returned no job id');
    return { jobId: data.id, metadata: { provider: this.identifier, model } };
  }

  async pollJob(jobId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    const apiKey = resolveApiKey(options);
    if (!apiKey) return { status: 'failed', error: 'OpenAI API key is required' };
    const headers = { Authorization: `Bearer ${apiKey}` };

    const res = await this._fetch(`${SORA_BASE}/${jobId}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Sora poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as SoraJob;

    if (data.status === 'completed') {
      // The finished MP4 is auth-only bytes at /content (no public URL). Download it with the key
      // and return it inline as a data URL — the lifecycle decodes data URLs, whereas the default
      // unauthenticated re-download of a provider URL would 401 here.
      const contentRes = await this._fetch(`${SORA_BASE}/${jobId}/content`, { headers });
      // 2.2 — classify the download leg: a 429/5xx is transient (THROW to retry the paid render),
      // but a permanent 4xx (expired/deleted clip) is terminal — return failed rather than
      // re-polling every sweep for 24h.
      if (!contentRes.ok) {
        if (isTransientStatus(contentRes.status)) {
          const body = await contentRes.text();
          throw new Error(`Sora content download transient error ${contentRes.status}: ${body.slice(0, 200)}`);
        }
        return { status: 'failed', error: `Sora content download failed (${contentRes.status})` };
      }
      // 5.7 — reject oversize via content-length before buffering + base64-inflating.
      const declared = Number(contentRes.headers.get('content-length') || 0);
      if (declared > MAX_ARTIFACT_BYTES) return { status: 'failed', error: 'Sora video exceeds the size limit' };
      const buffer = await readCapped(contentRes, MAX_ARTIFACT_BYTES);
      if (!buffer) return { status: 'failed', error: 'Sora video exceeds the size limit' };
      const base64 = buffer.toString('base64');
      return {
        status: 'completed',
        artifactUrl: `data:video/mp4;base64,${base64}`,
        metadata: { provider: this.identifier, mime: 'video/mp4' },
      };
    }
    if (data.status === 'failed') {
      return { status: 'failed', error: data.error?.message || 'Sora generation failed' };
    }
    return { status: 'pending' };
  }

  // OpenAI TTS is synchronous — return the artifact inline.
  async generateAudio(prompt: string, options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    const audio = await this.textToSpeech(prompt, options);
    const base64 = Buffer.isBuffer(audio) ? audio.toString('base64') : audio;
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const fmt = String(input.response_format || options?.format || 'mp3');
    const mime = TTS_MIME[fmt] || 'audio/mpeg';
    return {
      jobId: `openai-audio-${Date.now()}`,
      artifactUrl: `data:${mime};base64,${base64}`,
      metadata: { provider: this.identifier, model: options?.model || 'tts-1', mime },
    };
  }

  async generateAvatar(_prompt: string, _options?: MediaGenerateOptions): Promise<MediaJobSubmission> {
    throw new Error('OpenAI does not support avatar generation');
  }

  async listVoices(_options?: MediaGenerateOptions): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    // OpenAI TTS voices are a fixed catalog; no list endpoint exists.
    return [
      { id: 'alloy', label: 'Alloy' },
      { id: 'echo', label: 'Echo' },
      { id: 'fable', label: 'Fable' },
      { id: 'onyx', label: 'Onyx' },
      { id: 'nova', label: 'Nova' },
      { id: 'shimmer', label: 'Shimmer' },
      { id: 'sage', label: 'Sage' },
      { id: 'ash', label: 'Ash' },
    ];
  }

  async textToSpeech(text: string, options?: MediaGenerateOptions): Promise<Buffer | string> {
    const apiKey = this._apiKey(options);

    // Studio descriptor fields (voice, response_format, speed) arrive in `options.input`;
    // fall back to legacy top-level options so existing callers are unchanged.
    const input = (options?.input || {}) as Record<string, MediaInputValue>;
    const voice = (typeof input.voice === 'string' && input.voice) || options?.voice || 'alloy';
    const responseFormat =
      (typeof input.response_format === 'string' && input.response_format) || options?.format || 'mp3';

    const res = await this._fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || 'tts-1',
        input: text,
        voice,
        response_format: responseFormat,
        ...(input.speed !== undefined ? { speed: Number(input.speed) } : {}),
      }),
    });

    if (!res.ok) throw new Error(`OpenAI TTS failed: ${redactError(await res.text())}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async speechToText(audio: Buffer, options?: MediaGenerateOptions): Promise<string> {
    const apiKey = this._apiKey(options);

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)]), 'audio.mp3');
    formData.append('model', options?.model || 'whisper-1');

    const res = await this._fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`OpenAI STT failed: ${redactError(await res.text())}`);
    const data = (await res.json()) as OpenAITranscriptionResponse;
    return data.text || '';
  }
}

const _meta = new OpenaiMediaAdapter(undefined as unknown as SafeFetchPort);

export const openaiMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new OpenaiMediaAdapter(rt.fetch),
};
