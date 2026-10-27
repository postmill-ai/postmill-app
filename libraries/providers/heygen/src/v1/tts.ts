import {
  MediaCredentialOptions,
  MediaPollResult,
  SafeFetchPort,
  mediaUpstreamError,
  mediaUpstreamFailure,
  mediaUpstreamFromPoll,
  mediaUpstreamFromUnknown,
  isTransientStatus,
  readCappedArrayBuffer,
  resolveApiKey,
} from '@postmill-ai/provider-kernel';

const PROVIDER = { identifier: 'heygen', name: 'HeyGen' } as const;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function headers(options?: MediaCredentialOptions): Record<string, string> {
  const apiKey = resolveApiKey(options);
  if (!apiKey) throw new Error('HeyGen API key is required');
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
}

export async function submitHeyGenTts(
  fetch: SafeFetchPort,
  options: MediaCredentialOptions & { voiceId: string; text: string },
): Promise<string> {
  if (!options.voiceId) throw new Error('HeyGen voice is required');
  const res = await fetch('https://api.heygen.com/v2/audio/generate', {
    method: 'POST',
    headers: headers(options),
    body: JSON.stringify({ voice_id: options.voiceId, input_text: options.text }),
  });
  if (!res.ok) throw await mediaUpstreamError(PROVIDER, res, 'audio');
  const body = (await res.json()) as { data?: { audio_id?: string; id?: string } };
  const audioId = body.data?.audio_id || body.data?.id;
  if (!audioId) throw new Error('HeyGen returned no audio id');
  return audioId;
}

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
  const audioId = await submitHeyGenTts(fetch, options);
  let artifactUrl: string | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const poll = await pollHeyGenTts(fetch, audioId, options);
      if (poll.status === 'failed') throw mediaUpstreamFromPoll(PROVIDER, poll.error || 'HeyGen TTS failed', 'audio');
      if (poll.status === 'completed') {
        artifactUrl = poll.artifactUrl;
        break;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('transient error') && attempt < 59) continue;
      throw mediaUpstreamFromUnknown(PROVIDER, err, 'audio');
    }
  }
  if (!artifactUrl) {
    const error = new Error('HeyGen TTS did not complete after 60 attempts') as Error & { statusCode?: number };
    error.statusCode = 408;
    throw mediaUpstreamFromUnknown(PROVIDER, error, 'audio');
  }
  const res = await fetch(artifactUrl);
  if (!res.ok) throw await mediaUpstreamError(PROVIDER, res, 'audio');
  return readCappedArrayBuffer(res, MAX_AUDIO_BYTES);
}
