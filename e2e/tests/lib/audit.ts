import type { Page, Request, Response, ConsoleMessage } from '@playwright/test';

// Locally the frontend (:4200) calls the backend (:3000) DIRECTLY, cross-origin, with NO
// `/api/` prefix (e.g. GET http://localhost:3000/dashboard/summary). The old `/api/`-only
// filter missed every backend response. We now treat any response whose origin is the
// backend origin (or any `/api/*` path, for the upload proxy) as an API call to audit.
const BACKEND_ORIGIN = process.env.E2E_BACKEND_ORIGIN || 'http://localhost:3000';
const BASE = process.env.E2E_BASE || 'http://localhost:4200';

function isApiUrl(url: string): boolean {
  if (url.includes('/api/')) return true;
  try {
    return new URL(url).origin === new URL(BACKEND_ORIGIN).origin;
  } catch {
    return false;
  }
}

export interface ApiCall {
  method: string;
  url: string; // path only, query stripped
  status: number;
  query?: string;
}

export interface AuditSnapshot {
  apiErrors: ApiCall[]; // status >= 400
  apiCalls: ApiCall[]; // all /api/* calls
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[]; // network-level failures (not HTTP status)
}

/**
 * Attaches to a Page and records everything that matters for diagnosing "what's broken":
 * every /api/* call + status, console errors, uncaught page errors, and network failures.
 * Call snapshot() to read the accumulated findings; reset() to clear between routes.
 *
 * This is selector-free: it observes real traffic/errors, so it can't produce the
 * false-positives that guessed locators do.
 */
export class PageAuditor {
  private apiCalls: ApiCall[] = [];
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];
  private failedRequests: string[] = [];

  private onResponse = (res: Response) => {
    const url = res.url();
    if (!isApiUrl(url)) return;
    const u = new URL(url);
    // Keep the `/api/`-relative shape when present; otherwise use the backend path as-is.
    const path = url.includes('/api/') ? u.pathname.replace(/^.*\/api\//, '/api/') : u.pathname;
    this.apiCalls.push({
      method: res.request().method(),
      url: path,
      status: res.status(),
      query: u.search ? u.search.slice(1, 200) : undefined,
    });
  };

  private onConsole = (m: ConsoleMessage) => {
    if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 200));
  };

  private onPageError = (e: Error) => {
    this.pageErrors.push(String(e.message).slice(0, 200));
  };

  private onRequestFailed = (req: Request) => {
    const u = req.url();
    let sameOrigin = false;
    try {
      sameOrigin = new URL(u).origin === new URL(BASE).origin;
    } catch {
      /* non-absolute URL */
    }
    if (sameOrigin || isApiUrl(u)) {
      this.failedRequests.push(`${req.method()} ${u.replace(BASE, '')} (${req.failure()?.errorText || 'failed'})`);
    }
  };

  constructor(private page: Page) {}

  attach() {
    this.page.on('response', this.onResponse);
    this.page.on('console', this.onConsole);
    this.page.on('pageerror', this.onPageError);
    this.page.on('requestfailed', this.onRequestFailed);
    return this;
  }

  detach() {
    this.page.off('response', this.onResponse);
    this.page.off('console', this.onConsole);
    this.page.off('pageerror', this.onPageError);
    this.page.off('requestfailed', this.onRequestFailed);
  }

  reset() {
    this.apiCalls = [];
    this.consoleErrors = [];
    this.pageErrors = [];
    this.failedRequests = [];
  }

  snapshot(): AuditSnapshot {
    const dedupe = <T>(a: T[]) => [...new Set(a.map((x) => JSON.stringify(x)))].map((s) => JSON.parse(s) as T);
    return {
      apiCalls: dedupe(this.apiCalls),
      apiErrors: dedupe(this.apiCalls.filter((c) => c.status >= 400)),
      consoleErrors: [...new Set(this.consoleErrors)],
      pageErrors: [...new Set(this.pageErrors)],
      failedRequests: [...new Set(this.failedRequests)],
    };
  }

  /** Throttle (429) detection — if true, the run is contaminated and findings are unreliable. */
  hadThrottle(): boolean {
    return this.apiCalls.some((c) => c.status === 429);
  }
}
