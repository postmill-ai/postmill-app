import { Agent } from 'undici';
import dns from 'node:dns';
import net from 'node:net';
import { isBlockedIp } from './webhook.url.validator';

export type SafeFetchIpFamily = 4 | 6;

function createSsrfSafeDispatcher(ipFamily?: SafeFetchIpFamily): Agent {
  // Pins DNS resolution: every resolved IP is checked with `isBlockedIp` and
  // the caller (undici) connects to that same set. Closes the TOCTOU window
  // `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
  // `autoSelectFamily` enables happy-eyeballs so a blackholed IPv6 route falls
  // back to IPv4; a per-request family handles endpoints with broken IPv6 TLS.
  return new Agent({
    connect: {
      timeout: 10_000,
      autoSelectFamily: true,
      lookup(hostname, options, callback) {
        if (net.isIP(hostname)) {
          const family = net.isIP(hostname);
          if (isBlockedIp(hostname)) {
            return callback(new Error('Blocked IP'), '', 0);
          }
          return options && (options as any).all
            ? callback(null, [{ address: hostname, family }] as any, family)
            : callback(null, hostname, family);
        }

        dns.lookup(
          hostname,
          { ...options, ...(ipFamily ? { family: ipFamily } : {}) },
          (err, address: any, family: any) => {
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
          },
        );
      },
    },
  });
}

const dispatchers = new Map<SafeFetchIpFamily | undefined, Agent>();

export function getSsrfSafeDispatcher(ipFamily?: SafeFetchIpFamily): Agent {
  let dispatcher = dispatchers.get(ipFamily);
  if (!dispatcher) {
    dispatcher = createSsrfSafeDispatcher(ipFamily);
    dispatchers.set(ipFamily, dispatcher);
  }
  return dispatcher;
}

export const ssrfSafeDispatcher = getSsrfSafeDispatcher();
