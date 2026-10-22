import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import { SentryReportFilter } from './sentry-report.filter';

/**
 * Backstop filter contract: unexpected (non-HttpException) errors that fall
 * past the specific filters must be reported to Sentry — previously they only
 * hit the Nest log (prod gap: the HeyGen catalog-timeout 500 never reached
 * Sentry, 2026-10-22). Deliberate HttpExceptions (4xx/5xx envelopes) are
 * expected control flow and stay quiet.
 */
describe('SentryReportFilter', () => {
  const reply = vi.fn();
  const filter = new SentryReportFilter({
    httpAdapter: {
      reply,
      isHeadersSent: () => false,
      getRequestUrl: (req: { url: string }) => req.url,
    },
  } as any);

  const makeHost = () =>
    ({
      switchToHttp: () => ({
        getResponse: () => 'response',
        getRequest: () => ({ url: '/media/heygen/avatars' }),
      }),
      getArgByIndex: (i: number) => [{ url: '/media/heygen/avatars' }, 'response'][i],
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unexpected errors to Sentry and still renders the 500 response', () => {
    filter.catch(new Error('safeFetch request timed out after 30000ms'), makeHost());

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        mechanism: { handled: false, type: 'postmill.global_filter' },
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      'response',
      expect.objectContaining({ statusCode: 500 }),
      500,
    );
  });

  it('does not report deliberate 4xx HttpExceptions', () => {
    filter.catch(new HttpException('Forbidden', 403), makeHost());

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('response', expect.anything(), 403);
  });

  it('reports 5xx HttpExceptions (controllers wrap root causes into 500 envelopes)', () => {
    filter.catch(new HttpException('Cannot read private member …', 500), makeHost());

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('response', expect.anything(), 500);
  });
});
