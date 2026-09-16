import { ProviderUpstreamError } from '@postmill-ai/provider-kernel';

// Route catch-alls ("X is temporarily unavailable", "Generator failed to
// start") must not swallow an upstream provider failure: rethrow it so the
// global ProviderExceptionFilter answers 502 with the provider named — the
// user's OpenAI / Gemini account said no, Postmill did not break.
export function rethrowProviderError(err: unknown): void {
  if (err instanceof ProviderUpstreamError) throw err;
}
