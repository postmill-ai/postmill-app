/**
 * Meta's app-level callbacks are registered on the app domain
 * (https://app.postmill.ai/integrations/social/meta/...) but live in the
 * backend (`MetaCallbacksController`). These helpers forward Meta's POST
 * verbatim over the internal backend URL and relay the answer, so the
 * signed_request HMAC is verified exactly once, server-side.
 */

export const backendBase = (): string =>
  (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

export async function forwardMetaCallback(request: Request, path: string): Promise<Response> {
  const base = backendBase();
  if (!base) {
    return Response.json({ error: 'backend not configured' }, { status: 500 });
  }
  const body = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': request.headers.get('content-type') || 'application/x-www-form-urlencoded',
        'user-agent': request.headers.get('user-agent') || 'meta-callback-proxy',
      },
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json({ error: 'backend unavailable' }, { status: 502 });
  }
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
