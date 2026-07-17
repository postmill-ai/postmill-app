import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(),
  },
}));

import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { createAnalyticsBackfill } from './analytics-backfill';
import { createMockStep, captureFunctionHandler } from '../test/step.mock';

describe('createAnalyticsBackfill', () => {
  let analyticsActivity: {
    backfillIntegration: ReturnType<typeof vi.fn>;
  };
  let getHandler: () => any;

  beforeEach(() => {
    vi.clearAllMocks();

    analyticsActivity = {
      backfillIntegration: vi.fn().mockResolvedValue(undefined),
    };

    getHandler = captureFunctionHandler(vi.mocked(inngest.createFunction));
    createAnalyticsBackfill(analyticsActivity as any);
  });

  it('registers an analytics/backfill event handler', () => {
    expect(inngest.createFunction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analytics-backfill' }),
      { event: 'analytics/backfill' },
      expect.any(Function)
    );
  });

  it('calls step.run to backfill the given integration', async () => {
    const step = createMockStep();
    const event = { data: { integrationId: 'int-1', organizationId: 'org-1' } };

    await getHandler()({ step, event });

    expect(step.run).toHaveBeenCalledWith('backfill', expect.any(Function));
    expect(analyticsActivity.backfillIntegration).toHaveBeenCalledWith({
      integrationId: 'int-1',
      organizationId: 'org-1',
    });
  });
});
