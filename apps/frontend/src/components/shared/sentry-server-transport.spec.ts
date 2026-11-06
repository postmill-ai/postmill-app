import { describe, expect, it, vi } from 'vitest';
import { makeNodeTransport } from '@sentry/node';

const initializeSentryBasic = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/react/sentry/initialize.sentry.next.basic', () => ({
  initializeSentryBasic,
}));

describe('Next.js server Sentry transport selection', () => {
  it('injects the native Node transport only from the server-only config', async () => {
    await import('../../sentry.server.config');
    expect(initializeSentryBasic).toHaveBeenCalledWith(
      process.env.NODE_ENV,
      process.env.NEXT_PUBLIC_SENTRY_DSN,
      {},
      makeNodeTransport
    );
  });
});
