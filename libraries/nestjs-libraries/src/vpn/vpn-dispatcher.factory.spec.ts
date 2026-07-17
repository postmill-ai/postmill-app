import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent, ProxyAgent } from 'undici';
import dns from 'node:dns';
import { buildVpnDispatcher, resolveSafeProxyHost } from './vpn-dispatcher.factory';
import { VpnProxyRegion } from './vpn.types';

const auth = { username: 'user', password: 'pass' };

describe('buildVpnDispatcher', () => {
  it('builds a SOCKS5 dispatcher as a plain undici Agent', () => {
    const region: VpnProxyRegion = {
      id: 'us-atlanta',
      label: 'US Atlanta',
      host: 'atlanta.us.socks.nordhold.net',
      port: 1080,
      protocol: 'socks5',
    };
    const d = buildVpnDispatcher(region, auth);
    expect(d).toBeInstanceOf(Agent);
    expect(d).not.toBeInstanceOf(ProxyAgent);
    void d.close();
  });

  it('builds an HTTP-CONNECT dispatcher as an undici ProxyAgent', () => {
    const region: VpnProxyRegion = {
      id: 'http-eu',
      label: 'EU proxy',
      host: 'proxy.example.com',
      port: 8080,
      protocol: 'http-connect',
    };
    const d = buildVpnDispatcher(region, auth);
    expect(d).toBeInstanceOf(ProxyAgent);
    void d.close();
  });

  it('builds a no-auth SOCKS5 dispatcher (empty credentials)', () => {
    const region: VpnProxyRegion = {
      id: 'custom',
      label: 'Office',
      host: 'proxy.acme.example',
      port: 1080,
      protocol: 'socks5',
    };
    const d = buildVpnDispatcher(region, { username: '', password: '' });
    expect(d).toBeInstanceOf(Agent);
    void d.close();
  });

  it('rejects a proxy host that is a literal private/loopback IP', () => {
    const region: VpnProxyRegion = {
      id: 'evil',
      label: 'Loopback',
      host: '127.0.0.1',
      port: 1080,
      protocol: 'socks5',
    };
    expect(() => buildVpnDispatcher(region, auth)).toThrow(/not a public endpoint/);
  });

  it('rejects a private-range HTTP proxy host too', () => {
    const region: VpnProxyRegion = {
      id: 'lan',
      label: 'LAN',
      host: '10.0.0.5',
      port: 8080,
      protocol: 'http-connect',
    };
    expect(() => buildVpnDispatcher(region, auth)).toThrow(/not a public endpoint/);
  });
});

describe('resolveSafeProxyHost (SOCKS proxy-connect DNS pin)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects a hostname that resolves to a private IP', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      _opts: any,
      cb: any,
    ) => cb(null, [{ address: '10.1.2.3', family: 4 }], 4)) as any);

    await expect(resolveSafeProxyHost('rebind.evil.example')).rejects.toThrow(
      /Blocked IP/
    );
  });

  it('returns the resolved public IP for a legitimate proxy host', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      _opts: any,
      cb: any,
    ) => cb(null, [{ address: '203.0.113.7', family: 4 }], 4)) as any);

    await expect(resolveSafeProxyHost('proxy.example.com')).resolves.toBe(
      '203.0.113.7'
    );
  });

  it('rejects a literal private IP without a DNS lookup', async () => {
    const spy = vi.spyOn(dns, 'lookup');
    await expect(resolveSafeProxyHost('127.0.0.1')).rejects.toThrow(/Blocked IP/);
    expect(spy).not.toHaveBeenCalled();
  });
});
