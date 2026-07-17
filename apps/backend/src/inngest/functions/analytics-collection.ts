import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import {
  AnalyticsActivity,
  ChannelSnapshotIntegrationRef,
} from '@gitroom/nestjs-libraries/inngest/activities/analytics.activity';
import { InngestRunService } from '@gitroom/nestjs-libraries/inngest/inngest-run.service';
import { trackRun } from './track-run';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const INTEGRATION_DAYS_BACK = 7;

// The cron only fans out one `analytics/sync-org` event per org; the per-org work runs in
// `analytics-sync-org` (below) with its own concurrency cap. A slow org never blocks the rest
// of the daily sweep (separate invocations), parallelism is bounded by that cap, and each
// per-org operation keeps its own memoized step.run so a retry/resume stays idempotent.
export const createAnalyticsCollection = (
  analyticsActivity: AnalyticsActivity,
  runRepo: InngestRunService
) =>
  inngest.createFunction(
    { id: 'analytics-collection', concurrency: 1 },
    { cron: 'TZ=UTC 0 2 * * *' },
    async ({ step }) =>
      trackRun(step, runRepo, 'analytics-collection', async () => {
        const orgIds = await step.run('get-org-ids', () =>
          analyticsActivity.getAllOrganizationIds()
        );

        // Fan out one event per org. No event `id` (idempotency key) — each daily sweep must
        // produce a fresh sync, and a stable id would dedupe all later sweeps into the first.
        if (orgIds.length > 0) {
          await step.sendEvent(
            'fan-out-analytics',
            orgIds.map((organizationId) => ({
              name: 'analytics/sync-org' as const,
              data: { organizationId },
            }))
          );
        }

        await step
          .run('prune-email-logs', () => analyticsActivity.pruneEmailLogs())
          .catch(() => {});
      })
  );

// Per-org analytics sync, triggered by the cron's fan-out. `concurrency` bounds how many orgs
// sync at once. Each operation is its OWN step.run, so on a retry/resume the already-completed
// steps are skipped; the four side-effect steps swallow errors so one failing side-effect can't
// fail the org. Mirrors `createCommentsSyncOrg`.
export const createAnalyticsSyncOrg = (analyticsActivity: AnalyticsActivity) =>
  inngest.createFunction(
    { id: 'analytics-sync-org', concurrency: 5 },
    { event: 'analytics/sync-org' },
    async ({ step, event }) => {
      const { organizationId } = event.data;

      // I-02: fan out one durable event per integration so a slow/failing channel
      // never blocks the rest of the org's snapshot sweep.
      const integrations = await step.run(
        'list-channel-snapshot-integrations',
        () => analyticsActivity.getChannelSnapshotIntegrationIds(organizationId)
      );
      if (integrations.length > 0) {
        const today = dayjs.utc().format('YYYY-MM-DD');
        await step.sendEvent(
          'fan-out-channel-snapshots',
          integrations.map((integration) => ({
            name: 'analytics/sync-integration' as const,
            data: integration as any,
            id: `analytics:channel:${organizationId}:${integration.id}:${today}`,
          }))
        );
      }
      // I-04: checkpoint each post-snapshot page in its own durable step so a
      // retry/resume resumes from the last completed page instead of restarting
      // the entire org sweep.
      let cursor: string | undefined;
      do {
        const result = await step.run(
          `collect-post-page-${cursor ?? 'start'}`,
          () => analyticsActivity.collectPostSnapshotsPage(organizationId, 30, cursor)
        );
        cursor = result.nextCursor;
      } while (cursor);
      // Detect anomalies on the fresh channel snapshots, BEFORE prune so the
      // latest day is present. Durable + idempotent (unique key), and the
      // activity swallows its own errors — never fail the sweep.
      await step
        .run('detect-anomalies', () =>
          analyticsActivity.detectAnomalies(organizationId)
        )
        .catch(() => {});
      await step.run('prune', () =>
        analyticsActivity.pruneAndRollupSnapshots(organizationId)
      );
      await step
        .run('side-effects', () =>
          analyticsActivity.notifySnapshotComplete(organizationId)
        )
        .catch(() => {});
      await step
        .run('probe-watched', () =>
          analyticsActivity.probeWatchedAccounts(organizationId)
        )
        .catch(() => {});
      await step
        .run('shortlink-snap', () =>
          analyticsActivity.collectShortLinkSnapshots(organizationId)
        )
        .catch(() => {});
      await step
        .run('shortlink-prune', () =>
          analyticsActivity.pruneShortLinkSnapshots(organizationId)
        )
        .catch(() => {});

      // 6.9: fire the weekly "your week in numbers" digest once per week per org,
      // on Monday (UTC — the sweep's cron is TZ=UTC), after the sweep so the
      // numbers include the freshest snapshots. The day check runs inside the
      // step so it's memoized on replay; the activity is itself non-fatal and the
      // step swallows errors, so this can never fail the sweep. Respects the
      // `analytics` category preference automatically (via NotificationService).
      await step
        .run('weekly-summary', () => {
          if (dayjs.utc().day() !== 1) return Promise.resolve();
          return analyticsActivity.buildWeeklySummary(organizationId);
        })
        .catch(() => {});
    }
  );

// Per-integration channel snapshot, triggered by the per-org fan-out. Each
// integration gets its own durable execution with an idempotency key so retries
// are scoped to the failing channel (I-02).
export const createAnalyticsSyncIntegration = (
  analyticsActivity: AnalyticsActivity
) =>
  inngest.createFunction(
    { id: 'analytics-sync-integration', concurrency: 10 },
    { event: 'analytics/sync-integration' },
    async ({ step, event }) => {
      const integration = event.data as ChannelSnapshotIntegrationRef;
      const { organizationId } = integration;

      await step.run(`collect-channel-${integration.id}`, () =>
        analyticsActivity.collectChannelSnapshotForIntegration(
          organizationId,
          integration,
          INTEGRATION_DAYS_BACK
        )
      );
    }
  );
