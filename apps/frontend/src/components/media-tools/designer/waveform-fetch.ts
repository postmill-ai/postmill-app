'use client';

/**
 * `useFetch` prefixes the backend base URL onto anything it is given — right
 * for API paths, wrong for media clip srcs, which are already absolute URLs
 * (uploads are served from the app origin through the Next `/uploads/:path*`
 * rewrite). Prefixing one produced `https://api.hosthttps://app.host/uploads/…`
 * — CSP-blocked, so the timeline waveform silently never rendered. Absolute
 * http(s) URLs therefore go straight to the global fetch; relative API paths
 * still use the wrapped fetch.
 */
export type WaveformFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const directFetchForAbsoluteUrls = (prefixedFetch: WaveformFetch): WaveformFetch => {
  return (url, init) => (/^https?:\/\//i.test(url) ? fetch(url, init) : prefixedFetch(url, init));
};
