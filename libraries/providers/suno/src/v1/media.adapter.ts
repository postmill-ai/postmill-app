import { metadata as providerMetadata } from './metadata';
import {
  BearerTokenMediaAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
  MediaGenerateOptions,
  MediaCredentialOptions,
  MediaJobSubmission,
  MediaPollResult,
  SafeFetchPort,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Suno AI music generation via the sunoapi.org hosted gateway — own-key Bearer provider
// configured at Settings → Media. Audio-only (music). Generation is async: POST /api/v1/generate
// returns `{ data: { taskId } }`, then poll GET /api/v1/generate/record-info?taskId=<id> until
// `data.status === 'SUCCESS'`, reading the finished tracks from `data.response.sunoData[].audioUrl`
// (public MP3 URLs, re-downloadable without auth). No webhook is wired (callBackUrl sent empty) →
// completion rides the media-jobs-poll cron (like Runway/LTX/Wan). Suno returns TWO clips per
// generation: the first lands as the job's artifact, the rest ride `extraArtifactUrls` so the
// lifecycle lands each as its own sibling render-queue job.
const BASE = 'https://api.sunoapi.org';

// 2.1 — a 429/5xx on a status poll is transient: THROW so the lifecycle retries the render
// rather than permanently failing a job whose generation may still be fine.
const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

interface SunoGenerateResponse {
  code?: number;
  msg?: string;
  data?: { taskId?: string };
}

interface SunoTrack {
  id?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  title?: string;
  duration?: number;
}

interface SunoRecordResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    status?: string;
    response?: { sunoData?: SunoTrack[] };
  };
}

// Optional native passthroughs (already cleaned of empty values) that ride straight into the body.
const PASSTHROUGH_KEYS = [
  'vocalGender',
  'styleWeight',
  'negativeTags',
  'personaId',
  'weirdnessConstraint',
  'audioWeight',
] as const;

export class SunoAdapter extends BearerTokenMediaAdapter {
  readonly identifier = 'suno';
  readonly name = 'Suno';
  readonly capabilities: MediaProviderCapabilities = {
    image: false,
    video: false,
    audio: true,
    avatar: false,
    tts: false,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };

  async generateImage(
    _prompt: string,
    _options?: MediaGenerateOptions,
  ): Promise<MediaGenerationResult> {
    throw new Error('Suno does not support image generation');
  }

  async generateVideo(
    _prompt: string,
    _options?: MediaGenerateOptions,
  ): Promise<MediaJobSubmission> {
    throw new Error('Suno does not support video generation');
  }

  // Text → music. The descriptor's `prompt` field is the prompt arg; `model` is lifted to
  // options.model; style/title/instrumental/etc. arrive in options.input. customMode is enabled
  // only when BOTH style and title are present (Suno requires them in custom mode); otherwise we
  // submit non-custom (prompt-only). Returns the Suno taskId (no artifactUrl → async poll path).
  async generateAudio(
    prompt: string,
    options?: MediaGenerateOptions,
  ): Promise<MediaJobSubmission> {
    const headers = this._headers(options);
    const input = this._clean(options?.input);
    const model = options?.model || 'V5_5';

    const style = typeof input.style === 'string' ? input.style.trim() : '';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const customMode = Boolean(style && title);
    const instrumental = input.instrumental === true;

    const body: Record<string, unknown> = {
      customMode,
      instrumental,
      model,
      callBackUrl: '', // polling-only; no webhook wired (media-jobs-poll cron completes it)
    };
    if (prompt) body.prompt = prompt;
    if (customMode) {
      body.style = style;
      body.title = title;
    }
    for (const k of PASSTHROUGH_KEYS) {
      if (input[k] !== undefined) body[k] = input[k];
    }

    const res = await this._fetch(`${BASE}/api/v1/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Suno generation failed: ${await res.text()}`);
    const data = (await res.json()) as SunoGenerateResponse;
    const taskId = data.data?.taskId;
    if (!taskId) throw new Error(`Suno returned no taskId: ${JSON.stringify(data)}`);
    return { jobId: taskId };
  }

  async generateAvatar(
    _prompt: string,
    _options?: MediaGenerateOptions,
  ): Promise<MediaJobSubmission> {
    throw new Error('Suno does not support avatar generation');
  }

  // Poll the Suno task. `data.status`:
  //   SUCCESS                        → completed (both tracks ready)
  //   *FAILED* / *ERROR* / SENSITIVE → failed
  //   PENDING / TEXT_SUCCESS / FIRST_SUCCESS / … → still pending
  // UNVERIFIED vs live key: the exact status-string set and the
  // `data.response.sunoData[].audioUrl` path are grounded in the sunoapi.org docs, not a live
  // response — smoke-test both against a real key (and confirm 2 clips are returned).
  async pollJob(taskId: string, options?: MediaCredentialOptions): Promise<MediaPollResult> {
    // Missing key is a config error → terminal failed (matches openai/Sora), not a thrown
    // error the lifecycle would retry to the 24h timeout.
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }
    const res = await this._fetch(
      `${BASE}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers },
    );
    if (!res.ok) {
      const body = await res.text();
      if (isTransientStatus(res.status)) throw new Error(`Suno poll transient error ${res.status}: ${body.slice(0, 200)}`);
      return { status: 'failed', error: body };
    }
    const data = (await res.json()) as SunoRecordResponse;
    const status = (data.data?.status || '').toUpperCase();

    if (status === 'SUCCESS') {
      const tracks = (data.data?.response?.sunoData || []).filter((t) => t.audioUrl);
      if (!tracks.length) return { status: 'failed', error: 'Suno completed without audio' };
      const [first, ...others] = tracks;
      return {
        status: 'completed',
        artifactUrl: first.audioUrl!,
        extraArtifactUrls: others.map((t) => t.audioUrl!).filter(Boolean),
        metadata: {
          provider: this.identifier,
          mime: 'audio/mpeg',
          durationSeconds: first.duration,
          prompt: first.title,
        },
      };
    }
    if (/FAILED|ERROR|EXCEPTION|SENSITIVE/.test(status)) {
      return { status: 'failed', error: data.data?.status || data.msg || 'Suno generation failed' };
    }
    return { status: 'pending' };
  }

  // Auth probe with no generation cost: the remaining-credits endpoint returns 401/403 on a bad key.
  async testConnection(
    options?: MediaCredentialOptions,
  ): Promise<{ ok: boolean; message: string }> {
    let headers: Record<string, string>;
    try {
      headers = this._headers(options);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    try {
      const res = await this._fetch(`${BASE}/api/v1/generate/credit`, { headers });
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: 'Invalid Suno API key' };
      // 5.6 — only an expected status (2xx / 404 / 422) counts as connected; a 5xx or other
      // unexpected status must NOT be reported as success.
      if (res.ok || res.status === 404 || res.status === 422)
        return { ok: true, message: 'Connection successful' };
      return { ok: false, message: `Suno returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

const _meta = new SunoAdapter(undefined as unknown as SafeFetchPort);

export const sunoMediaModule: ProviderModule<any, any> = {
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
  create: (rt) => new SunoAdapter(rt.fetch),
};
