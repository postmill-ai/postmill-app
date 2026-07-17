import { Integration } from '@prisma/client';

/**
 * SocialAbstract — the base class every social provider extends. Relocated into
 * the kernel (v4.0.0 provider-framework, step 7.5.2) so provider packages no
 * longer depend on `@gitroom/nestjs-libraries`.
 *
 * SECURITY-CRITICAL: `fetch()` carries the SSRF + per-channel VPN-egress posture.
 * The behaviour is BYTE-IDENTICAL to the pre-relocation implementation. The only
 * change is that the security primitives are dereferenced from an injected ports
 * object instead of imported directly — this keeps the single-instance symbols
 * (the VPN AsyncLocalStorage in `vpn.context.ts` and the inngest error classes)
 * living in `@gitroom/nestjs-libraries` so there is exactly ONE als and the
 * `instanceof` checks in the inngest pipeline stay correct. The ports are wired
 * once at bootstrap via `setSocialFetchPorts` (see DatabaseModule.onModuleInit).
 */
export type ValidityMedia = {
  path: string;
  thumbnail?: string;
};

export type SocialFetchPorts = {
  getVpnDispatcher: () => any | undefined;
  ssrfSafeDispatcher: any;
  isSafePublicHttpsUrl: (url: string) => Promise<boolean>;
  undiciFetch: typeof fetch;
  RefreshTokenError: new (...a: any[]) => Error;
  BadBodyError: new (...a: any[]) => Error;
  timer: (ms: number) => Promise<any>;
  sharp: any;
  readOrFetch: (u: string) => Promise<Buffer>;
  safeFetch: (url: string, init?: any) => Promise<Response>;
};

let _ports: SocialFetchPorts | null = null;

/**
 * Inject the security/runtime primitives used by SocialAbstract.fetch. Called
 * once at bootstrap from a `@gitroom/nestjs-libraries` module so the VPN als and
 * inngest error classes remain single-instance. Idempotent.
 */
export function setSocialFetchPorts(p: SocialFetchPorts): void {
  _ports = p;
}

/**
 * Port-bound `safeFetch`. Provider packages import this from the kernel instead
 * of `@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch`, so the heavy SSRF
 * primitives (`webhook.url.validator` with its class-validator deps and the
 * shared `ssrfSafeDispatcher` Agent) stay in nestjs-libraries as a single
 * instance. Behaviour is identical — the real implementation is injected.
 */
export function safeFetch(url: string, init?: any): Promise<Response> {
  return _ports!.safeFetch(url, init);
}

/**
 * Deprecated aliases for the inngest error classes, kept so relocated providers
 * that do `throw new BadBody(...)` / `new RefreshToken(...)` compile against the
 * kernel. They are Proxy constructors that delegate to the port-injected real
 * classes, so the thrown instance IS a real `BadBodyError`/`RefreshTokenError`
 * (instanceof-correct for the inngest pipeline — the classes never leave
 * nestjs-libraries, preserving the single-instance design).
 * @deprecated import `RefreshTokenError`/`BadBodyError` from inngest/errors.
 */
export const RefreshToken: new (...a: any[]) => Error = new Proxy(
  function () {} as any,
  { construct: (_t, args) => new _ports!.RefreshTokenError(...args) }
) as any;

export const BadBody: new (...a: any[]) => Error = new Proxy(
  function () {} as any,
  { construct: (_t, args) => new _ports!.BadBodyError(...args) }
) as any;

export class NotEnoughScopes {
  constructor(
    public message = 'Not enough scopes, when choosing a provider, please add all the scopes'
  ) {}
}

function safeStringify(obj: any) {
  const seen = new WeakSet();

  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  get commentsCapabilities() {
    return { read: false, reply: false, like: false };
  }

  public handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return undefined;
  }

  /**
   * Server-side replacement for the old client-side `checkValidity`.
   * Validates the media attached to a post (and its comments) against the
   * provider rules. Returns `true` when valid, or an error message string.
   *
   * `posts` mirrors the client shape: the outer array is the main post followed
   * by each comment, the inner array is the media items for that entry.
   *
   * Note: video-duration validations that used to run in the browser are not
   * re-implemented here (no ffmpeg dependency). Image-dimension checks use sharp.
   */
  async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    return true;
  }

  /** Reads the pixel dimensions of an image via sharp (works for http or local paths). */
  protected async getImageDimensions(
    path: string
  ): Promise<{ width: number; height: number }> {
    // Stored media paths are relative (e.g. "uploads/x.png"); resolve them to a
    // fetchable URL the same way posts.service.updateMedia does.
    const url =
      path?.indexOf('http') === -1
        ? `${process.env.FRONTEND_URL}/${path}`
        : path;
    const { width = 0, height = 0 } = await _ports!.sharp(
      await _ports!.readOrFetch(url)
    ).metadata();
    return { width, height };
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    let globalErr = {};
    let value: any;
    try {
      value = await func();
    } catch (err) {
      const handle = this.handleErrors(safeStringify(err), 200);
      value = { err: true, value: 'Unknown Error', ...(handle || {}) };
      globalErr = err;
    }

    if (value && value?.err && value?.value) {
      if (value.type === 'refresh-token') {
        throw new _ports!.RefreshTokenError(
          '',
          safeStringify({}),
          {} as any,
          value.value || ''
        );
      }
      throw new _ports!.BadBodyError('', safeStringify(globalErr), {} as any, value.value || '');
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false,
    message = '',
  ): Promise<Response> {
    // 1H defense-in-depth: every integration call gets connect-time SSRF
    // protection (private-IP blocking, incl. redirect hops) via the undici
    // dispatcher. Callers may override `dispatcher` for trusted first-party
    // hosts. The heavier `safeFetch` (HTTPS + isSafePublicHttpsUrl pre-check +
    // per-hop re-validation) is reserved for the dedicated user-URL paths
    // (mastodon `uploadFile`, bluesky `downloadVideo`, provider connect flows).
    //
    // When a per-channel VPN dispatcher is active (set by PostActivity for a
    // VPN-enabled channel), it replaces the SSRF Agent for this leg. Proxying
    // bypasses the connect-time DNS pin, so restore the guarantee the proxy
    // stripped by pre-validating the destination is public HTTPS before dispatch.
    const vpnDispatcher = (options as any).dispatcher ? undefined : _ports!.getVpnDispatcher();
    if (vpnDispatcher && !(await _ports!.isSafePublicHttpsUrl(url))) {
      throw new _ports!.BadBodyError(identifier, '{}', options.body || '{}', 'Blocked non-public destination over VPN');
    }
    // D1: bound every outbound provider call by a timeout so one slow platform
    // can't hang the publish concurrency pool. Default OUTBOUND_HTTP_TIMEOUT_MS
    // (30s), merged with any caller-supplied signal.
    const timeoutMs = Number(process.env.OUTBOUND_HTTP_TIMEOUT_MS) > 0
      ? Number(process.env.OUTBOUND_HTTP_TIMEOUT_MS)
      : 30_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = (options as any).signal as AbortSignal | undefined;
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal;
    let request: Response;
    try {
      request = (await _ports!.undiciFetch(url, {
        ...(options as any),
        signal,
        // dispatcher is an undici-only RequestInit option, absorbed by the cast below
        dispatcher: (options as any).dispatcher ?? vpnDispatcher ?? _ports!.ssrfSafeDispatcher,
      } as any)) as unknown as Response;
    } catch (err: any) {
      if (timeoutSignal.aborted || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(`Outbound request to ${identifier || url} timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (request.status === 200 || request.status === 201) {
      return request;
    }

    if (totalRetries > 2) {
      throw new _ports!.BadBodyError(identifier, '{}', options.body || '{}', message);
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    const handleError = this.handleErrors(json || '{}', request.status);

    if (
      request.status === 429 ||
      (request.status === 500 && !handleError) ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await _ports!.timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        handleError?.value || 'Unknown Error'
      );
    }

    if (handleError?.type === 'retry') {
      await _ports!.timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency,
        handleError?.value || 'Unknown Error'
      );
    }

    if (
      (request.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new _ports!.RefreshTokenError(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new _ports!.BadBodyError(
      identifier,
      json,
      options.body!,
      handleError?.value || 'Unknown Error'
    );
  }

  checkScopes(required: string[], got: string | string[]) {
    if (Array.isArray(got)) {
      if (!required.every((scope) => got.includes(scope))) {
        throw new NotEnoughScopes();
      }

      return true;
    }

    const newGot = decodeURIComponent(got);

    const splitType = newGot.indexOf(',') > -1 ? ',' : ' ';
    const gotArray = newGot.split(splitType);
    if (!required.every((scope) => gotArray.includes(scope))) {
      throw new NotEnoughScopes();
    }

    return true;
  }
}
