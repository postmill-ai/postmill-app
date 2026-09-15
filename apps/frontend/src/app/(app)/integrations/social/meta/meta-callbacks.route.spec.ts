import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as deauthorizePost, GET as deauthorizeGet } from './deauthorize/route';
import { POST as deletionPost, GET as deletionGet } from './data-deletion/route';

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.BACKEND_INTERNAL_URL = 'http://127.0.0.1:4300/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

const metaPost = (url: string, body = 'signed_request=abc.def') =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'facebookplatform/1.0' },
    body,
  });

describe('Meta callback route handlers (app domain → backend)', () => {
  it('deauthorize: forwards the form body verbatim to the backend and relays status + JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channels: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const res = await deauthorizePost(metaPost('https://app.example/integrations/social/meta/deauthorize'));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4300/integrations/meta/deauthorize', expect.objectContaining({
      method: 'POST',
      body: 'signed_request=abc.def',
      headers: expect.objectContaining({ 'content-type': 'application/x-www-form-urlencoded' }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, channels: 1 });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('deauthorize: relays a backend 400 (bad signature) unchanged', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'invalid signed_request' }), { status: 400 }));
    const res = await deauthorizePost(metaPost('https://app.example/integrations/social/meta/deauthorize', 'signed_request=x'));
    expect(res.status).toBe(400);
  });

  it('deauthorize: GET is 405', async () => {
    const res = await deauthorizeGet();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('deauthorize: 502 when the backend is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await deauthorizePost(metaPost('https://app.example/integrations/social/meta/deauthorize'));
    expect(res.status).toBe(502);
  });

  it('data-deletion POST: relays { url, confirmation_code }', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://app.example/integrations/social/meta/data-deletion?code=ABC', confirmation_code: 'ABC' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await deletionPost(metaPost('https://app.example/integrations/social/meta/data-deletion'));
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:4300/integrations/meta/data-deletion');
    expect(await res.json()).toEqual({
      url: 'https://app.example/integrations/social/meta/data-deletion?code=ABC',
      confirmation_code: 'ABC',
    });
  });

  it('data-deletion GET ?code=: renders a self-contained status page for a completed request', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'ABCDEFGH2345', status: 'completed', completedAt: '2026-09-15T10:00:00.000Z', channels: 2, notes: ['A note <b>'] }), {
        status: 200,
      }),
    );
    const res = await deletionGet(new Request('https://app.example/integrations/social/meta/data-deletion?code=abcdefgh2345'));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4300/integrations/meta/data-deletion/ABCDEFGH2345', expect.anything());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('ABCDEFGH2345');
    expect(html).toContain('Completed');
    expect(html).toContain('2 connected channel(s)');
    expect(html).toContain('A note &lt;b&gt;'); // escaped
    expect(html).toContain('support@postmill.ai');
  });

  it('data-deletion GET: unknown code renders the not-found copy', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'ZZZZZZZZ2345', status: 'unknown' }), { status: 200 }));
    const res = await deletionGet(new Request('https://app.example/integrations/social/meta/data-deletion?code=ZZZZZZZZ2345'));
    expect(await res.text()).toContain('No deletion request was found');
  });

  it('data-deletion GET: missing/invalid code is a 400 page without calling the backend', async () => {
    const res = await deletionGet(new Request('https://app.example/integrations/social/meta/data-deletion?code=<script>'));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('<script>');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
