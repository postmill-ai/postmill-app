import { randomUUID } from 'crypto';
import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { IntegrationsActivity } from '@gitroom/nestjs-libraries/inngest/activities/integrations.activity';

// F3: consecutive failed refresh cycles are bounded — after this many the
// chain terminates, so a revoked token can neither hot-loop nor spam
// refresh-error notifications forever.
const MAX_REFRESH_RETRIES = 5;
// F3: retry cycles sleep at least this long — never a 0-sleep hot-loop.
const MIN_RETRY_SLEEP_MS = 5 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const createRefreshToken = (integrationsActivity: IntegrationsActivity) =>
  inngest.createFunction(
    {
      id: 'refresh-token',
      cancelOn: [
        {
          event: 'integration/refresh-token/cancel',
          if: 'async.data.integrationId == event.data.integrationId',
        },
      ],
    },
    { event: 'integration/refresh-token' },
    async ({ step, event }) => {
      const { integrationId, organizationId } = event.data;
      const retries = event.data.retries ?? 0;

      const integration = await step.run('get', () =>
        integrationsActivity.getIntegrationsById(integrationId, organizationId)
      );

      // Termination: the channel is gone, was deleted, or was already flagged
      // refreshNeeded (a failed refresh flags it, so the chain stops here
      // instead of notifying again every cycle).
      if (!integration || integration.deletedAt || integration.refreshNeeded) {
        return;
      }

      // Never step.sleep(NaN): a missing/unparseable expiry terminates the chain.
      const expiresAt = integration.tokenExpiration
        ? new Date(integration.tokenExpiration).getTime()
        : NaN;
      if (!Number.isFinite(expiresAt)) {
        return;
      }

      const expiresIn = expiresAt - Date.now();
      if (expiresIn > 0) {
        await step.sleep(
          'sleep-until-expiry',
          Math.min(expiresIn, THIRTY_DAYS_MS)
        );
      } else if (retries >= MAX_REFRESH_RETRIES) {
        return;
      } else if (retries > 0) {
        // Retry cycle: floor the sleep so a revoked token can't hot-loop.
        await step.sleep('sleep-until-expiry', MIN_RETRY_SLEEP_MS);
      }
      // else: first sight of an expired-but-healthy (not yet refreshNeeded)
      // token — genuinely recoverable, so recheck → refresh immediately.

      const fresh = await step.run('recheck', () =>
        integrationsActivity.getIntegrationsById(integrationId, organizationId)
      );
      if (!fresh || fresh.deletedAt || fresh.refreshNeeded) {
        return;
      }

      const refreshed = await step.run('refresh', () =>
        integrationsActivity.refreshToken(fresh as any)
      );

      await step.sendEvent('integration/refresh-token', {
        name: 'integration/refresh-token',
        data: {
          integrationId,
          organizationId,
          retries: refreshed ? 0 : retries + 1,
        },
        // F3: unique id per cycle — a constant idempotency id lands in
        // Inngest's 24h dedup window and black-holes the chain.
        id: `refresh_${integrationId}_${randomUUID()}`,
      });
    }
  );
