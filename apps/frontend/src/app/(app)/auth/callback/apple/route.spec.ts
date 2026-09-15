import { describe, it, expect } from 'vitest';
import { POST, GET } from './route';

// Apple requires response_mode=form_post when the `email` scope is requested,
// so the OAuth callback arrives as a POST form body. The route converts it to
// the standard GET /auth?code=...&state=login&provider=APPLE flow.

const applePost = (url: string, body: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

describe('Apple SSO callback route handler', () => {
  it('redirects a successful form_post to /auth with code, state and provider', async () => {
    const res = await POST(
      applePost(
        'https://app.example.com/auth/callback/apple',
        'code=apple-code-123&state=login'
      )
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('code')).toBe('apple-code-123');
    expect(location.searchParams.get('state')).toBe('login');
    expect(location.searchParams.get('provider')).toBe('APPLE');
  });

  it('redirects an Apple error (user cancelled) to /auth?error=', async () => {
    const res = await POST(
      applePost(
        'https://app.example.com/auth/callback/apple',
        'error=user_cancelled_authorize&state=login'
      )
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('error')).toBe('user_cancelled_authorize');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('redirects to /auth?error=missing_code when neither code nor error is posted', async () => {
    const res = await POST(
      applePost('https://app.example.com/auth/callback/apple', 'state=login')
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('missing_code');
  });

  it('GET is 405', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
