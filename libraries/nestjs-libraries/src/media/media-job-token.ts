import { createHmac, timingSafeEqual } from 'crypto';

// Per-job webhook token (§11.2). `AIMediaJob` has no JSON/extra column to persist a
// random token, so the token is *derived*: HMAC-SHA256(jobId:orgId) keyed with the
// instance secret (`ENCRYPTION_KEY`, falling back to `JWT_SECRET` — same precedence as
// `EncryptionService`). Unguessable without the key, org-bound, and stateless to verify.

function signingKey(): string {
  const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) {
    throw new Error('Media job webhook tokens require ENCRYPTION_KEY or JWT_SECRET to be set');
  }
  return key;
}

export function mediaJobWebhookToken(jobId: string, organizationId: string): string {
  return createHmac('sha256', signingKey())
    .update(`media-job:${jobId}:${organizationId}`)
    .digest('hex');
}

export function verifyMediaJobWebhookToken(
  jobId: string,
  organizationId: string,
  token: string,
): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = Buffer.from(mediaJobWebhookToken(jobId, organizationId), 'utf-8');
  const provided = Buffer.from(token, 'utf-8');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
