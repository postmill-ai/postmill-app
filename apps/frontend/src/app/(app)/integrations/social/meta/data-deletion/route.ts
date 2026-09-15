import { backendBase, escapeHtml, forwardMetaCallback } from '../meta-callback.proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Meta "Data Deletion Request Callback URL": POST signed_request → backend
// purges the user's Meta-derived data and answers { url, confirmation_code }.
export async function POST(request: Request) {
  return forwardMetaCallback(request, '/integrations/meta/data-deletion');
}

type DeletionStatus = {
  code: string;
  status: 'completed' | 'unknown';
  completedAt?: string;
  channels?: number;
  notes?: string[];
};

// The `url` Meta shows the user: a human-readable status page for one
// confirmation code (?code=...). Self-contained HTML — no app shell, no auth.
export async function GET(request: Request) {
  const code = (new URL(request.url).searchParams.get('code') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8,32}$/.test(code)) {
    return html(page('Data deletion request', '<p>Missing or invalid confirmation code.</p>'), 400);
  }

  let status: DeletionStatus = { code, status: 'unknown' };
  try {
    const res = await fetch(`${backendBase()}/integrations/meta/data-deletion/${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (res.ok) status = (await res.json()) as DeletionStatus;
  } catch {
    /* render as unknown */
  }

  const body =
    status.status === 'completed'
      ? `<p class="ok">Completed${status.completedAt ? ` on ${escapeHtml(new Date(status.completedAt).toUTCString())}` : ''}.</p>
         <p>${status.channels ?? 0} connected channel(s) and all data Postmill obtained from Meta for this user were removed.</p>
         ${(status.notes || []).map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}`
      : `<p>No deletion request was found for this confirmation code. Codes are kept for 180 days.</p>`;

  return html(
    page(
      'Data deletion request',
      `<p>Confirmation code: <code>${escapeHtml(code)}</code></p>${body}
       <p class="muted">Questions: <a href="mailto:support@postmill.ai">support@postmill.ai</a></p>`,
    ),
    200,
  );
}

const page = (title: string, content: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Postmill — ${escapeHtml(title)}</title>
<style>
body{margin:0;padding:48px 20px;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f10;color:#e9e9ec}
main{max-width:560px;margin:0 auto;background:#1a1a1d;border:1px solid #2a2a2f;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 16px}code{background:#26262b;padding:2px 6px;border-radius:6px}
.ok{color:#6ce9a6;font-weight:600}.note{color:#f5c26b}.muted{color:#9a9aa3;font-size:14px}a{color:#8ab4ff}
</style></head><body><main><h1>Postmill — ${escapeHtml(title)}</h1>${content}</main></body></html>`;

const html = (markup: string, status: number) =>
  new Response(markup, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
