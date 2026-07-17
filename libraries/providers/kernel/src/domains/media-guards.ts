// Shared reliability/hygiene guards for media provider adapters (MEDIA_REMEDIATION 6.1).
// Kept dependency-free so every provider package can import it from `@gitroom/provider-kernel`.

// A model id is interpolated into a provider request path (e.g. `https://fal.run/${model}`).
// Enforce a strict allowlist BEFORE interpolation so a hostile `model` can't inject a path
// segment, query string (`?callback=`), fragment (`#`), whitespace, or a `..` traversal.
const MODEL_ID_RE = /^[A-Za-z0-9._/-]+$/;

export function validateModelId(model: string): string {
  if (typeof model !== 'string' || model.length === 0 || model.length > 256) {
    throw new Error('Invalid model id');
  }
  if (model.includes('..') || !MODEL_ID_RE.test(model)) {
    throw new Error(`Invalid model id: ${model.slice(0, 64)}`);
  }
  return model;
}

// Signed-token URL query params that must never be persisted to `AIMediaJob.error` or handed
// back to the client (invariant 3AL). Covers S3/GCS/Azure presigned styles + generic tokens.
const SIGNED_URL_PARAMS = [
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-goog-signature',
  'signature',
  'sig',
  'token',
  'access_token',
  'apikey',
  'api_key',
  'key',
  'se',
  'sp',
  'sr',
  'skoid',
];

// Truncate a raw provider error body to a bounded length and redact any signed-token query
// params inside URLs it embeds. Used everywhere an adapter persists `await res.text()`.
export function redactError(body: string, max = 500): string {
  let out = (body || '').slice(0, max);
  // Redact `?param=value` / `&param=value` for sensitive param names (URL-encoded bodies too).
  out = out.replace(
    /([?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|signature|sig|token|access_token|apikey|api_key|key|se|sp|sr|skoid)=)[^&\s"']+/gi,
    '$1[REDACTED]',
  );
  return out;
}

export { SIGNED_URL_PARAMS };

// A poll response status that should be treated as *transient* (retry via THROW) rather than a
// terminal failure. The lifecycle treats a returned `{status:'failed'}` as permanent but a
// thrown error as retryable, so a 429/5xx during a sweep must throw — the generation may still
// be fine. Shared to keep the semantics identical across every adapter (MEDIA_REMEDIATION 3.4).
export const isTransientStatus = (s: number): boolean => s === 429 || s >= 500;

// Read a fetch Response body as a size-capped Buffer, honouring a Content-Length pre-check and
// aborting the stream once `maxBytes` is exceeded (avoids buffering an unbounded provider
// payload into memory before base64/upload). Used by the source-image fetch paths (6.1j).
export async function readCappedArrayBuffer(
  res: { headers: { get(name: string): string | null }; body?: unknown; arrayBuffer(): Promise<ArrayBuffer> },
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || '0');
  if (declared && declared > maxBytes) {
    throw new Error(`Response too large: ${declared} bytes exceeds cap ${maxBytes}`);
  }
  const body = res.body as AsyncIterable<Uint8Array> | undefined;
  // Stream when possible so an under-declared Content-Length can't smuggle past the cap.
  if (body && typeof (body as any)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error(`Response exceeded cap ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`Response exceeded cap ${maxBytes} bytes`);
  }
  return buf;
}
