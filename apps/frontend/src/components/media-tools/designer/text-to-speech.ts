// Shared POST body construction for /media/text-to-speech. `provider` pins the
// generation to a specific TTS provider (validated server-side, single attempt,
// no fallback) and is only sent when the user picked one — the default path
// stays byte-identical to before.
export interface TextToSpeechRequest {
  text: string;
  voiceId: string;
  instructions?: string;
  provider?: string;
}

export function postTextToSpeech(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  req: TextToSpeechRequest
): Promise<Response> {
  return fetch('/media/text-to-speech', {
    method: 'POST',
    body: JSON.stringify({
      text: req.text,
      voice: req.voiceId,
      ...(req.instructions ? { instructions: req.instructions } : {}),
      ...(req.provider ? { provider: req.provider } : {}),
    }),
  });
}
