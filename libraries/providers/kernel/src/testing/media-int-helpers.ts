// Shared recorded-fixture test helpers for media/contentpack adapter int-specs (plan B4).
//
// No network: `makeCtx` returns a stub ProviderRuntimeContext whose `fetch` records the
// request the adapter builds ({ url, method, headers, body }) and returns whatever the
// supplied handler produces. `res` builds a minimal fetch-Response-like object.
//
// Lifted verbatim from the original per-spec helper (see wan/src/v1/media.int-spec.ts) so
// the existing hand-written specs keep working; new specs import this instead of copying it.

export interface Rec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Build a recording context. `handler(url, init, n)` receives the request and the 1-based
 * call count `n`, and returns the canned response (typically via `res(...)`).
 */
export function makeCtx(handler: (url: string, init: any, n: number) => any) {
  const recs: Rec[] = [];
  const fetch = async (input: any, init: any = {}) => {
    recs.push({
      url: String(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    });
    return handler(String(input), init, recs.length);
  };
  return {
    recs,
    ctx: {
      credentials: {},
      encryption: { encrypt: (v: string) => v, decrypt: (v: string) => v },
      fetch: fetch as any,
      logger: { log() {}, warn() {}, error() {}, debug() {} },
      telemetry: { recordCall() {} },
    },
  };
}

/** Minimal fetch-Response-like object. `body` is returned from both `.json()` and `.text()`. */
export const res = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () =>
    typeof body === 'string'
      ? new TextEncoder().encode(body).buffer
      : new TextEncoder().encode(JSON.stringify(body)).buffer,
  headers: { get: () => null },
});
