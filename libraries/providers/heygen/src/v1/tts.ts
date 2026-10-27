import {
  MediaCredentialOptions,
  MediaPollResult,
  SafeFetchPort,
  mediaUpstreamError,
  mediaUpstreamFailure,
  isTransientStatus,
  readCappedArrayBuffer,
  resolveApiKey,
} from '@postmill-ai/provider-kernel';

const PROVIDER = { identifier: 'heygen', name: 'HeyGen' } as const;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_SUBMIT_ATTEMPTS = 3;

function headers(options?: MediaCredentialOptions): Record<string, string> {
  const apiKey = resolveApiKey(options);
  if (!apiKey) throw new Error('HeyGen API key is required');
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
}

export interface HeyGenTtsSubmission {
  artifactUrl: string;
  durationSeconds?: number;
}

export async function submitHeyGenTts(
  fetch: SafeFetchPort,
  options: MediaCredentialOptions & { voiceId: string; text: string },
): Promise<HeyGenTtsSubmission> {
  if (!options.voiceId) throw new Error('HeyGen voice is required');
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    const res = await fetch('https://api.heygen.com/v3/voices/speech', {
      method: 'POST',
      headers: headers(options),
      body: JSON.stringify({ voice_id: options.voiceId, text: options.text }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { audio_url?: string; duration?: number } };
      if (!body.data?.audio_url) throw new Error('HeyGen returned no audio URL');
      return { artifactUrl: body.data.audio_url, durationSeconds: body.data.duration };
    }

    const error = await mediaUpstreamError(PROVIDER, res, 'audio');
    if (!isTransientStatus(res.status) || attempt === MAX_SUBMIT_ATTEMPTS - 1) throw error;
  }
  throw new Error('HeyGen TTS submission failed');
}

// Retained for jobs submitted through the legacy asynchronous audio endpoint.
export async function pollHeyGenTts(
  fetch: SafeFetchPort,
  audioId: string,
  options?: MediaCredentialOptions,
): Promise<MediaPollResult> {
  if (!resolveApiKey(options)) return { status: 'failed', error: 'HeyGen API key is required' };
  const res = await fetch(`https://api.heygen.com/v1/audio_status.get?audio_id=${encodeURIComponent(audioId)}`, {
    headers: headers(options),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isTransientStatus(res.status)) {
      const error = new Error(`HeyGen tts poll transient error ${res.status}: ${body.slice(0, 200)}`) as Error & { statusCode?: number };
      error.statusCode = res.status;
      throw error;
    }
    return { status: 'failed', error: mediaUpstreamFailure(PROVIDER, res.status, body) };
  }
  const { data } = (await res.json()) as {
    data?: { status?: string; audio_url?: string; url?: string; duration?: number; error?: { message?: string } };
  };
  if (data?.status === 'completed' || data?.status === 'success') {
    const artifactUrl = data.audio_url || data.url;
    if (!artifactUrl) return { status: 'failed', error: 'HeyGen TTS completed without a URL' };
    return {
      status: 'completed',
      artifactUrl,
      metadata: { provider: PROVIDER.identifier, mime: 'audio/mpeg', durationSeconds: data.duration },
    };
  }
  if (data?.status === 'failed') {
    return { status: 'failed', error: mediaUpstreamFailure(PROVIDER, undefined, data.error?.message) };
  }
  return { status: 'pending' };
}

export async function generateHeyGenTts(
  fetch: SafeFetchPort,
  options: MediaCredentialOptions & { voiceId: string; text: string },
): Promise<Buffer> {
  const { artifactUrl } = await submitHeyGenTts(fetch, options);
  const res = await fetch(artifactUrl);
  if (!res.ok) throw await mediaUpstreamError(PROVIDER, res, 'audio');
  return readCappedArrayBuffer(res, MAX_AUDIO_BYTES);
}
