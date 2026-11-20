import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSentryBasic } from '@postmill-ai/react/sentry/initialize.sentry.next.basic';

const sentryInit = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({
  init: sentryInit,
  consoleLoggingIntegration: vi.fn(),
}));

const exceptionEvent = (type: string, value: string) => ({
  exception: { values: [{ type, value }] },
});

const beforeSend = () => {
  initializeSentryBasic(
    'production',
    'https://public@sentry.test/123',
    {}
  );
  expect(sentryInit).toHaveBeenCalledOnce();
  return sentryInit.mock.calls[0][0].beforeSend;
};

describe('frontend Sentry exception filtering', () => {
  beforeEach(() => {
    sentryInit.mockReset();
  });

  it('drops the confirmed navigation cancellation signature', () => {
    const event = exceptionEvent('AbortError', 'signal is aborted without reason');
    expect(beforeSend()(event, {})).toBeNull();
  });

  it('keeps existing network-noise filtering', () => {
    const event = exceptionEvent('TypeError', 'Failed to fetch');
    expect(beforeSend()(event, {})).toBeNull();
  });

  it.each([
    ['AbortError', 'The operation failed for another reason'],
    ['TypeError', 'Unexpected application failure'],
  ])('keeps unrelated %s exceptions', (type, value) => {
    const event = exceptionEvent(type, value);
    expect(beforeSend()(event, {})).toBe(event);
  });
});
