import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

// Opt-in allowlist (1H risk register): admins may permit specific private CIDRs
// so self-hosted provider instances (Mastodon custom, self-hosted WordPress/Lemmy)
// on private networks remain reachable. Off by default — empty env means every
// private/loopback/link-local range stays blocked. HTTPS is still required.
let _allowedCidrCacheKey: string | undefined;
let _allowedCidrList: net.BlockList | null = null;

function getAllowedPrivateCidrs(): net.BlockList | null {
  const raw = process.env.SSRF_ALLOWED_PRIVATE_CIDRS ?? '';
  if (raw === _allowedCidrCacheKey) {
    return _allowedCidrList;
  }
  _allowedCidrCacheKey = raw;

  if (!raw.trim()) {
    _allowedCidrList = null;
    return null;
  }

  const list = new net.BlockList();
  const errors: string[] = [];
  for (const entry of raw.split(',')) {
    const cidr = entry.trim();
    if (!cidr) continue;
    const [addr, prefixStr] = cidr.split('/');
    const version = net.isIP(addr);
    if (!version) {
      errors.push(`"${cidr}" is not a valid IPv4/IPv6 address`);
      continue;
    }
    const family = version === 4 ? 'ipv4' : 'ipv6';
    const maxPrefix = version === 4 ? 32 : 128;
    try {
      if (prefixStr === undefined) {
        list.addAddress(addr, family);
      } else {
        const prefix = Number(prefixStr);
        if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
          errors.push(
            `"${cidr}" has an invalid prefix length (must be 0-${maxPrefix} for ${family})`
          );
          continue;
        }
        list.addSubnet(addr, prefix, family);
      }
    } catch (err) {
      errors.push(`"${cidr}" could not be added: ${(err as Error).message}`);
    }
  }

  if (errors.length) {
    throw new Error(
      `Invalid SSRF_ALLOWED_PRIVATE_CIDRS entries: ${errors.join('; ')}`
    );
  }

  _allowedCidrList = list;
  return _allowedCidrList;
}

export function isAllowedPrivateIp(ip: string): boolean {
  const list = getAllowedPrivateCidrs();
  if (!list) return false;

  // Check the address plus, for an IPv4-mapped IPv6 (::ffff:a.b.c.d), the
  // extracted IPv4 — so an allowlisted IPv4 CIDR still matches the mapped form.
  const candidates = [ip];
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) candidates.push(mapped[1]);

  for (const candidate of candidates) {
    const version = net.isIP(candidate);
    if (!version) continue;
    try {
      if (list.check(candidate, version === 4 ? 'ipv4' : 'ipv6')) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);

  if ([a, b].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // 127.0.0.0/8
    (a === 169 && b === 254) ||      // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||      // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224                         // multicast/reserved
  );
}

export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  return (
    normalized === '::1' ||          // loopback
    normalized === '::' ||           // unspecified
    normalized.startsWith('fe80:') || // link-local
    normalized.startsWith('fc') ||   // unique local fc00::/7
    normalized.startsWith('fd') ||   // unique local fd00::/7
    normalized.startsWith('ff')      // multicast
  );
}

export function isBlockedIp(ip: string): boolean {
  // Admin opt-in escape hatch for self-hosted instances on private ranges.
  if (isAllowedPrivateIp(ip)) {
    return false;
  }

  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIPv4(ip);
  }
  if (version === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and check as IPv4
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isBlockedIPv4(mapped[1]);
    }
    return isBlockedIPv6(ip);
  }
  return true;
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (hostname === 'localhost') {
    return false;
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return !isBlockedIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records.length) {
      return false;
    }

    for (const record of records) {
      if (isBlockedIp(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}