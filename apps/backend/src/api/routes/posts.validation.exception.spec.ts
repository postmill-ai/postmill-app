import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import {
  PostValidationExceptionFilter,
  PostValidationException,
} from './posts.validation.exception';

describe('PostValidationExceptionFilter — unified envelope (400 + provider/name context)', () => {
  const makeHost = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { status, json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('emits { statusCode, error, message, provider, name } with status 400', () => {
    const filter = new PostValidationExceptionFilter();
    const { host, status, json } = makeHost();

    filter.catch(
      new PostValidationException({
        provider: 'x',
        name: 'My channel',
        error: 'Content too long',
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    // validation detail rides in message; provider/name are extra context
    expect(body.message).toBe('Content too long');
    expect(body.provider).toBe('x');
    expect(body.name).toBe('My channel');
  });
});
