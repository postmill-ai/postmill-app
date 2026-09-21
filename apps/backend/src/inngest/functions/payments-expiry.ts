import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { PaymentsService } from '@postmill-ai/nestjs-libraries/payments/payments.service';
import { InngestRunService } from '@postmill-ai/nestjs-libraries/inngest/inngest-run.service';
import { trackRun } from './track-run';

/**
 * Daily teardown of subscriptions whose scheduled end has passed. Providers
 * without a period-end cancel (PayPal) are cancelled at the vendor immediately
 * and keep their row until `cancelAt`; this is what finally downgrades them.
 * Also a safety net for a missed teardown webhook from any provider.
 */
export const createPaymentsExpiry = (
  paymentsService: PaymentsService,
  runRepo: InngestRunService
) =>
  inngest.createFunction(
    { id: 'payments-expire-canceled', triggers: [{ cron: 'TZ=UTC 15 3 * * *' }] },
    async ({ step }) =>
      trackRun(step, runRepo, 'payments-expire-canceled', async () =>
        step.run('expire-canceled-subscriptions', () =>
          paymentsService.expireCanceledSubscriptions()
        )
      )
  );
