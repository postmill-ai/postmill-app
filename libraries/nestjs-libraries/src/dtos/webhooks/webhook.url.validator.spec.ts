import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAllowedPrivateIp, isBlockedIp } from './webhook.url.validator';

describe('SSRF IP blocking', () => {
  const original = process.env.SSRF_ALLOWED_PRIVATE_CIDRS;

  beforeEach(() => {
    delete process.env.SSRF_ALLOWED_PRIVATE_CIDRS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SSRF_ALLOWED_PRIVATE_CIDRS;
    } else {
      process.env.SSRF_ALLOWED_PRIVATE_CIDRS = original;
    }
  });

  it('blocks private/loopback/link-local by default', () => {
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('192.168.1.50')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
  });

  it('allows ordinary public IPs', () => {
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });

  it('does not allowlist anything when env is unset', () => {
    expect(isAllowedPrivateIp('10.1.2.3')).toBe(false);
  });

  it('un-blocks only IPs inside an opt-in allowlisted CIDR', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = '10.0.0.0/8,192.168.5.0/24';

    // inside the allowlist -> no longer blocked
    expect(isBlockedIp('10.1.2.3')).toBe(false);
    expect(isBlockedIp('192.168.5.10')).toBe(false);
    expect(isAllowedPrivateIp('10.1.2.3')).toBe(true);

    // private but OUTSIDE the allowlist -> still blocked
    expect(isBlockedIp('192.168.6.10')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    // cloud metadata is not in the allowlist -> still blocked
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('matches an allowlisted IPv4 CIDR via its IPv4-mapped IPv6 form', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = '10.0.0.0/8';
    expect(isBlockedIp('::ffff:10.0.0.5')).toBe(false);
  });

  it('supports IPv6 CIDRs', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = 'fd00::/8';
    expect(isBlockedIp('fd00::1234')).toBe(false);
    // outside the range -> still blocked
    expect(isBlockedIp('fe80::1')).toBe(true);
  });

  it('throws on malformed entries at parse time', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = 'not-an-ip,10.0.0.0/8,,/24';
    expect(() => isBlockedIp('10.1.2.3')).toThrow(/not a valid IPv4\/IPv6/);
  });

  it('throws on out-of-range prefix lengths', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = '10.0.0.0/33';
    expect(() => isBlockedIp('10.1.2.3')).toThrow(
      /invalid prefix length \(must be 0-32/
    );
  });

  it('throws on negative prefix lengths', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = '10.0.0.0/-1';
    expect(() => isBlockedIp('10.1.2.3')).toThrow(
      /invalid prefix length \(must be 0-32/
    );
  });

  it('throws on IPv6 prefix lengths out of range', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = 'fd00::/129';
    expect(() => isBlockedIp('fd00::1')).toThrow(
      /invalid prefix length \(must be 0-128/
    );
  });

  it('accepts a bare address and a /8 CIDR', () => {
    process.env.SSRF_ALLOWED_PRIVATE_CIDRS = '10.0.0.0/8';
    expect(isBlockedIp('10.1.2.3')).toBe(false);
  });
});
