/**
 * 1.6 — Stream a fetch Response body into a Buffer with a hard byte cap,
 * aborting the moment the cap is exceeded instead of buffering the whole body.
 *
 * The `content-length` header is advisory (absent on chunked responses,
 * spoofable), so callers that only check it before `res.arrayBuffer()` still
 * read the entire (possibly multi-GB) body into heap. This reader tracks a
 * running byte count and stops as soon as `maxBytes` is passed.
 *
 * Throws `Error(reason)` when the cap is exceeded; the `reason` message lets
 * callers map to their own HTTP status (413, etc.).
 */
export async function readResponseCapped(
  res: { body?: unknown; arrayBuffer: () => Promise<ArrayBuffer> },
  maxBytes: number,
  reason = 'Response exceeds the size limit',
): Promise<Buffer> {
  const body = res.body as
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>
    | null
    | undefined;

  // No stream available (mocked/absent body): fall back to arrayBuffer with a
  // post-check so the cap is still enforced.
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(reason);
    return buf;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  // Prefer async-iteration (undici Response bodies are async-iterable). Fall
  // back to the WHATWG reader when only that is available.
  const iterable = body as AsyncIterable<Uint8Array>;
  if (typeof iterable[Symbol.asyncIterator] === 'function') {
    for await (const chunk of iterable) {
      const b = Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) {
        // Best-effort: cancel the underlying stream to stop the transfer.
        (body as { destroy?: () => void; cancel?: () => void }).destroy?.();
        (body as { cancel?: () => void }).cancel?.();
        throw new Error(reason);
      }
      chunks.push(b);
    }
    return Buffer.concat(chunks, total);
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const b = Buffer.from(value);
      total += b.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(reason);
      }
      chunks.push(b);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}
