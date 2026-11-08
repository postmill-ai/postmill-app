import * as Sentry from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { onRouterTransitionStart } from '../../instrumentation-client';

describe('client instrumentation', () => {
  it('exports the Sentry navigation hook', () => {
    expect(onRouterTransitionStart).toBe(Sentry.captureRouterTransitionStart);
  });
});
