import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for webhook signatures/secrets. Length
 * mismatch returns false without leaking timing (compares against self).
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function hmacSha256Hex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function hmacSha256Base64(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('base64');
}
