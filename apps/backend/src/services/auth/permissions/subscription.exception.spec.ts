import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import { SubscriptionExceptionFilter } from './subscription.exception';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from './permission.exception.class';

describe('SubscriptionExceptionFilter — unified envelope (402 + url context)', () => {
  const makeHost = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { status, json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('emits { statusCode, error, message, url } with status 402', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const filter = new SubscriptionExceptionFilter();
    const { host, status, json } = makeHost();

    filter.catch(
      new SubscriptionException({
        section: Sections.CHANNEL,
        action: AuthorizationActions.Create,
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(402);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(402);
    expect(body.error).toBe('Payment Required');
    expect(typeof body.message).toBe('string');
    // billing upsell link preserved as context, not the whole envelope
    expect(body.url).toBe('https://app.example.com/billing');
  });
});
