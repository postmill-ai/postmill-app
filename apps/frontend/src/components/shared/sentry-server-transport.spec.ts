import { describe, expect, it } from 'vitest';
import { makeFetchTransport } from '@sentry/browser';
import { makeNodeTransport } from '@sentry/node';
import { nextServerTransportFactory } from '@postmill-ai/react/sentry/initialize.sentry.server';

describe('Next.js server Sentry transport selection', () => {
  it('keeps the native Node transport with proxy support on the server', () => {
    expect(nextServerTransportFactory('nodejs')).toBe(makeNodeTransport);
  });

  it('uses fetch on the edge and other non-Node runtimes', () => {
    expect(nextServerTransportFactory('edge')).toBe(makeFetchTransport);
    expect(nextServerTransportFactory(undefined)).toBe(makeFetchTransport);
  });
});
