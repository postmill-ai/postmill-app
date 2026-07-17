import { Agent, ProxyAgent, buildConnector, Dispatcher } from 'undici';
import dns from 'node:dns';
import net from 'node:net';
import { SocksClient } from 'socks';
import { isBlockedIp } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { VpnProxyAuth, VpnProxyRegion } from './vpn.types';

const CONNECT_TIMEOUT = 10_000;

// SSRF lookup hook (mirrors ssrfSafeDispatcher) — applied to the leg that
// connects to the proxy itself so the hop to the proxy can't be redirected to a
// private IP via DNS.
const ssrfLookup: net.LookupFunction = (hostname, options, callback) => {
  if (net.isIP(hostname)) {
    const family = net.isIP(hostname);
    if (isBlockedIp(hostname)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    return (options as any) && (options as any).all
      ? callback(null, [{ address: hostname, family }] as any, family)
      : callback(null, hostname, family);
  }

  dns.lookup(hostname, options as any, (err, address: any, family: any) => {
    if (err) return callback(err, '', 0);
    if (Array.isArray(address)) {
      for (const entry of address) {
        if (isBlockedIp(entry.address)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
      }
      return callback(null, address as any, 0);
    }
    if (isBlockedIp(address)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    callback(null, address, family);
  });
};

// Resolve a proxy hostname to a validated public IP, applying the same SSRF
// checks as ssrfLookup. The `socks` package resolves the proxy host itself, so
// to pin the SOCKS proxy-connect leg we resolve+validate here and hand SocksClient
// a literal IP. Re-resolved per connection → not bypassable via DNS rebinding.
export function resolveSafeProxyHost(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ssrfLookup(host, { all: true } as any, (err, address: any) => {
      if (err) return reject(err);
      const first = Array.isArray(address) ? address[0]?.address : address;
      if (!first) {
        return reject(new Error(`VPN proxy host did not resolve: ${host}`));
      }
      resolve(first);
    });
  });
}

// Build an undici Dispatcher that egresses through a VPN region's proxy.
// SOCKS5 has no native undici support — we open the socket via the `socks`
// package and hand the connected socket to undici's own connector so undici
// still owns TLS/ALPN/cert validation. HTTP-CONNECT uses undici's ProxyAgent.
export function buildVpnDispatcher(
  region: VpnProxyRegion,
  auth: VpnProxyAuth,
): Dispatcher {
  // Reject a proxy pointed at a literal private/loopback IP up front. Hostnames
  // are additionally pinned at connect time — resolveSafeProxyHost (SOCKS path)
  // and the ProxyAgent connect hook's ssrfLookup (HTTP path) re-validate the
  // resolved address so neither leg can be redirected to a private IP.
  if (net.isIP(region.host) && isBlockedIp(region.host)) {
    throw new Error(`VPN proxy host is not a public endpoint: ${region.host}`);
  }

  // Auth is optional — an org's own proxy may be open on a trusted network.
  const hasAuth = !!auth.username;

  if (region.protocol === 'http-connect') {
    const token = hasAuth
      ? 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
      : undefined;
    return new ProxyAgent({
      uri: `http://${region.host}:${region.port}`,
      ...(token ? { token } : {}),
      connect: { lookup: ssrfLookup, timeout: CONNECT_TIMEOUT },
    });
  }

  const connector = buildConnector({ timeout: CONNECT_TIMEOUT });
  return new Agent({
    connect(opts: any, callback: any) {
      // DNS-pin the proxy host: resolve+validate to a public IP before SocksClient
      // connects, so the SOCKS proxy-connect leg can't be pointed at an internal
      // address via a hostname that resolves private (or DNS rebinding).
      resolveSafeProxyHost(region.host)
        .then((safeHost) =>
          SocksClient.createConnection({
            proxy: {
              host: safeHost,
              port: region.port,
              type: 5,
              ...(hasAuth ? { userId: auth.username, password: auth.password } : {}),
            },
            command: 'connect',
            destination: {
              host: opts.hostname,
              port: Number(opts.port) || 443,
            },
            timeout: CONNECT_TIMEOUT,
          })
        )
        .then(({ socket }) => {
          // Let undici upgrade the raw SOCKS socket to TLS (ALPN/H2, cert check).
          connector({ ...opts, httpSocket: socket }, callback);
        })
        .catch((err: Error) => callback(err, null));
    },
  });
}
