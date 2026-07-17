import { createHash } from 'crypto';

export function accountFingerprint(...parts: (string | undefined | null)[]): string {
  const input = parts.filter(p => p != null).join('|');
  return createHash('sha256').update(input).digest('hex');
}
