import { forwardMetaCallback } from '../meta-callback.proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Meta "Deauthorize Callback URL": POST signed_request → backend marks the
// user's Facebook/Instagram/Threads channels reconnect-needed.
export async function POST(request: Request) {
  return forwardMetaCallback(request, '/integrations/meta/deauthorize');
}

export async function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { allow: 'POST' } });
}
