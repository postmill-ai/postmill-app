export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sign in with Apple callback. Apple requires response_mode=form_post when the
// `email` scope is requested, so the OAuth callback arrives here as a POST form
// body instead of a GET with query params. Convert it into the standard
// /auth?code=...&state=login&provider=APPLE flow the register page expects
// (the proxy lets /auth/* through unauthenticated).
export async function POST(request: Request) {
  const form = await request.formData();
  const code = form.get('code');
  const state = form.get('state');
  const error = form.get('error');

  const url = new URL('/auth', request.url);
  if (typeof error === 'string' && error) {
    url.searchParams.set('error', error);
  } else if (typeof code === 'string' && code) {
    url.searchParams.set('code', code);
    url.searchParams.set('state', typeof state === 'string' && state ? state : 'login');
    url.searchParams.set('provider', 'APPLE');
  } else {
    url.searchParams.set('error', 'missing_code');
  }

  return Response.redirect(url.toString(), 302);
}

export async function GET() {
  return Response.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { allow: 'POST' } }
  );
}
