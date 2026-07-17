import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';

// removeAuth clears auth cookies on the response; stub it so the filter under
// test doesn't depend on the express cookie internals.
vi.mock('@gitroom/backend/services/auth/auth.middleware', () => ({
  removeAuth: vi.fn(),
}));

import {
  HttpExceptionFilter,
  HttpForbiddenException,
} from './exception.filter';

describe('HttpExceptionFilter — unified envelope (401 unauthenticated path)', () => {
  const makeHost = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { status, json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('answers 401 (unauthenticated session-invalid path) — code preserved deliberately', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = makeHost();

    filter.catch(new HttpForbiddenException(), host);

    // HttpForbiddenException is the auth-middleware's unauthenticated rejection
    // (clears the cookie via removeAuth); the frontend keys on 401 for login
    // redirect. Envelope is unified but the status stays 401.
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('emits the unified { statusCode, error, message } envelope', () => {
    const filter = new HttpExceptionFilter();
    const { host, json } = makeHost();

    filter.catch(new HttpForbiddenException(), host);

    expect(json.mock.calls[0][0]).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Unauthorized',
    });
  });
});
