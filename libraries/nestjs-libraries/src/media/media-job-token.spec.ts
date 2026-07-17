import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mediaJobWebhookToken, verifyMediaJobWebhookToken } from './media-job-token';

describe('media-job-token', () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('produces a deterministic hex token per (job, org)', () => {
    const a = mediaJobWebhookToken('job-1', 'org-1');
    const b = mediaJobWebhookToken('job-1', 'org-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds the token to the job id and the organization', () => {
    const token = mediaJobWebhookToken('job-1', 'org-1');
    expect(mediaJobWebhookToken('job-2', 'org-1')).not.toBe(token);
    expect(mediaJobWebhookToken('job-1', 'org-2')).not.toBe(token);
  });

  it('verifies a valid token', () => {
    const token = mediaJobWebhookToken('job-1', 'org-1');
    expect(verifyMediaJobWebhookToken('job-1', 'org-1', token)).toBe(true);
  });

  it('rejects a token for a different job or org', () => {
    const token = mediaJobWebhookToken('job-1', 'org-1');
    expect(verifyMediaJobWebhookToken('job-2', 'org-1', token)).toBe(false);
    expect(verifyMediaJobWebhookToken('job-1', 'org-2', token)).toBe(false);
  });

  it('rejects empty/garbage tokens without throwing', () => {
    expect(verifyMediaJobWebhookToken('job-1', 'org-1', '')).toBe(false);
    expect(verifyMediaJobWebhookToken('job-1', 'org-1', 'short')).toBe(false);
  });

  it('prefers ENCRYPTION_KEY over JWT_SECRET', () => {
    const fromJwt = mediaJobWebhookToken('job-1', 'org-1');
    process.env.ENCRYPTION_KEY = 'another-key';
    const fromEnc = mediaJobWebhookToken('job-1', 'org-1');
    expect(fromEnc).not.toBe(fromJwt);
  });

  it('throws when no signing key is configured', () => {
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    expect(() => mediaJobWebhookToken('job-1', 'org-1')).toThrow();
  });
});
