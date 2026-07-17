/**
 * Shared client-IP resolution for rate limiters behind a reverse proxy.
 *
 * `TRUST_PROXY_HOPS` opts into trusting the Nth-from-right `x-forwarded-for`
 * entry; it must be set to the EXACT number of XFF-appending proxies in front
 * of the server. When unset (or invalid) we fall back to the socket peer, so
 * a client can never mint a fresh rate-limit bucket by spoofing XFF.
 *
 * Overestimating the hop count is worse than failing closed: the resolved
 * entry then lands in attacker-supplied left-most XFF padding. Underestimating
 * re-groups clients behind an intermediate proxy IP.
 *
 * Extracted from `ai-designer.gateway.ts` so the websocket gateway, the HTTP
 * throttler, and the MCP rate limits all resolve the client IP identically.
 */
export const resolveClientIp = (
  xForwardedFor: string | string[] | undefined,
  fallback: string
): string => {
  const rawHops = Number(process.env.TRUST_PROXY_HOPS);
  const hops =
    Number.isInteger(rawHops) && rawHops >= 1 ? rawHops : undefined;
  if (!hops) {
    return fallback;
  }

  const xff = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
  if (typeof xff !== 'string') {
    return fallback;
  }

  const parts = xff
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < hops) {
    return fallback;
  }

  return parts[parts.length - hops] ?? fallback;
};
