import { URL } from 'url';

const FRONTEND_URL = process.env.FRONTEND_URL || '';
const ALLOWLIST_ENV = process.env.INTEGRATION_RETURN_URL_ALLOWLIST || '';

function parseAllowlist(): string[] {
  return ALLOWLIST_ENV.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '[::1]' ||
    lower === '::1'
  ) {
    return true;
  }
  if (
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.lan')
  ) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  return false;
}

function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins: string[] = [];

  if (FRONTEND_URL) {
    allowedOrigins.push(FRONTEND_URL.replace(/\/+$/, ''));
  }

  allowedOrigins.push(...parseAllowlist());

  return allowedOrigins.some((allowed) => {
    if (!allowed) return false;
    const allowedLower = allowed.toLowerCase().replace(/\/+$/, '');
    const originLower = origin.toLowerCase().replace(/\/+$/, '');
    return originLower === allowedLower;
  });
}

export function isAllowedReturnUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  if (url.startsWith('//')) {
    return false;
  }

  const lower = url.toLowerCase();
  if (
    !lower.startsWith('http://') &&
    !lower.startsWith('https://')
  ) {
    return false;
  }

  try {
    const parsed = new URL(url);

    if (parsed.username || parsed.password) {
      return false;
    }

    if (isPrivateHost(parsed.hostname)) {
      return false;
    }

    const origin = parsed.origin;
    return isAllowedOrigin(origin);
  } catch {
    return false;
  }
}
