import { describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@sentry/core';
import { makeEpureTransport, type EpureTransportFactory } from './epure-transport';

const SENTRY_DSN = 'https://public@sentry.test/123';
const EPURE_DSN = 'https://public@epure.test/456';

const envelope = (type: 'event' | 'transaction'): Envelope => [
  { dsn: SENTRY_DSN },
  [[{ type }, { event_id: 'evt-1', release: 'release-1' }]],
];

const factoryFor = (behavior?: 'reject' | 'hang') => {
  const calls: Array<{ url: string; envelope: Envelope }> = [];
  const flushes: string[] = [];
  const createTransport: EpureTransportFactory = (options) => ({
    send: vi.fn(async (envelope: Envelope) => {
      calls.push({ url: options.url, envelope });
      if (options.url.startsWith('https://epure.test')) {
        if (behavior === 'reject') throw new Error('Epure unavailable');
        if (behavior === 'hang') return new Promise(() => {});
      }
      return { statusCode: 200 };
    }),
    flush: vi.fn(async () => {
      flushes.push(options.url);
      return true;
    }),
  });
  return { calls, flushes, createTransport };
};

const initializedTransport = (options: Parameters<typeof makeEpureTransport>[0]) =>
  makeEpureTransport(options)!({
    url: 'https://sentry.test/api/123/envelope/',
    recordDroppedEvent: vi.fn(),
  });

describe('Epure dual exception transport (NestJS)', () => {
  it('is disabled for unset or invalid configuration', () => {
    expect(makeEpureTransport({
      sentryDsn: SENTRY_DSN,
      createTransport: factoryFor().createTransport,
    })).toBeUndefined();
    expect(makeEpureTransport({
      sentryDsn: SENTRY_DSN,
      epureDsn: 'not-a-dsn',
      createTransport: factoryFor().createTransport,
    })).toBeUndefined();
  });

  it('sends exception events to Sentry and Epure with their own DSNs', async () => {
    const { calls, createTransport } = factoryFor();
    const transport = initializedTransport({ sentryDsn: SENTRY_DSN, epureDsn: EPURE_DSN, createTransport })!;
    await transport.send(envelope('event'));

    expect(calls.map((call) => call.envelope[0].dsn)).toEqual([SENTRY_DSN, EPURE_DSN]);
    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining('sentry.test'),
      expect.stringContaining('epure.test'),
    ]);
  });

  it('keeps non-exception envelopes Sentry-only', async () => {
    const { calls, createTransport } = factoryFor();
    const transport = initializedTransport({ sentryDsn: SENTRY_DSN, epureDsn: EPURE_DSN, createTransport })!;
    await transport.send(envelope('transaction'));
    expect(calls).toHaveLength(1);
    expect(calls[0].envelope[0].dsn).toBe(SENTRY_DSN);
  });

  it('returns the primary result when Epure rejects or exceeds the secondary deadline', async () => {
    for (const behavior of ['reject', 'hang'] as const) {
      const { calls, createTransport } = factoryFor(behavior);
      const transport = initializedTransport({
        sentryDsn: SENTRY_DSN,
        epureDsn: EPURE_DSN,
        createTransport,
        secondaryTimeoutMs: 5,
      })!;
      const result = await transport.send(envelope('event'));
      expect(result.statusCode).toBe(200);
      expect(calls).toHaveLength(2);
    }
  });

  it('flushes both destinations', async () => {
    const { flushes, createTransport } = factoryFor();
    const transport = initializedTransport({ sentryDsn: SENTRY_DSN, epureDsn: EPURE_DSN, createTransport })!;
    await transport.send(envelope('event'));
    expect(await transport.flush(5)).toBe(true);
    expect(flushes.some((url) => url.startsWith('https://sentry.test'))).toBe(true);
    expect(flushes.filter((url) => url.startsWith('https://epure.test'))).toHaveLength(1);
  });
});
