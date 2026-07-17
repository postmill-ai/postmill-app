import { Injectable, Logger } from '@nestjs/common';
import { RetentionRepository } from '@gitroom/nestjs-libraries/database/prisma/retention/retention.repository';

/**
 * RetentionActivity (ENHANCEMENTS_2 I3 + I4c) — bounded, logged, non-fatal retention
 * for the tables that otherwise grow unbounded, plus the IP/agent retention bound.
 *
 * Mirrors `AnalyticsActivity.pruneAndRollupSnapshots`: each prune is wrapped so one
 * failure never aborts the others, every window is env-tunable with a documented
 * default, and counts are logged. Hard-purges run in capped batches so a backlog
 * can't lock the table or blow the step timeout (the next cron tick continues).
 *
 * All Prisma access now lives in `RetentionRepository`; this activity is a thin
 * orchestrator over the repository. The repository still touches `PrismaService`
 * directly — sanctioned cross-table maintenance exception (same as the seeders /
 * `DeletionService`).
 */
@Injectable()
export class RetentionActivity {
  private readonly _logger = new Logger(RetentionActivity.name);

  constructor(private readonly _retentionRepository: RetentionRepository) {}

  async runRetention(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const now = Date.now();
    const before = (days: number) => new Date(now - days * 86_400_000);

    await this._safe('errors', counts, async () =>
      this._retentionRepository.deleteErrorsOlderThan(
        before(this._days('ERRORS_RETENTION_DAYS', 90))
      )
    );

    await this._safe('notifications', counts, async () =>
      this._retentionRepository.deleteNotificationsOlderThan(
        before(this._days('NOTIFICATIONS_RETENTION_DAYS', 180))
      )
    );

    await this._safe('multipartUploads', counts, async () =>
      this._retentionRepository.deleteIncompleteMultipartUploadsOlderThan(
        before(this._days('MULTIPART_UPLOAD_RETENTION_DAYS', 7))
      )
    );

    await this._safe('mastraTraces', counts, async () =>
      this._retentionRepository.deleteMastraTracesOlderThan(
        before(this._days('MASTRA_TRACE_RETENTION_DAYS', 30))
      )
    );

    await this._safe('softDeletedPosts', counts, async () =>
      this._retentionRepository.purgeSoftDeletedPosts(
        before(this._days('SOFT_DELETE_RETENTION_DAYS', 30))
      )
    );

    await this._safe('softDeletedFiles', counts, async () =>
      this._retentionRepository.purgeSoftDeletedFiles(
        before(this._days('SOFT_DELETE_RETENTION_DAYS', 30))
      )
    );

    await this._safe('aiDesignerSessions', counts, async () =>
      this._retentionRepository.purgeAiDesignerSessionsOlderThan(
        before(this._days('AI_DESIGNER_SESSION_RETENTION_DAYS', 90))
      )
    );

    await this._safe('userIpAgent', counts, async () =>
      this._retentionRepository.nullUserIpAgentOlderThan(
        before(this._days('IP_RETENTION_DAYS', 90))
      )
    );

    await this._safe('sessionIpAgent', counts, async () =>
      this._retentionRepository.nullSessionIpAgentOlderThan(
        before(this._days('IP_RETENTION_DAYS', 90))
      )
    );

    this._logger.log(`Retention sweep complete: ${JSON.stringify(counts)}`);
    return counts;
  }

  private _days(envKey: string, fallback: number): number {
    const raw = process.env[envKey];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this._logger.warn(
        `RetentionActivity: invalid ${envKey}="${raw}", falling back to ${fallback}`
      );
      return fallback;
    }
    return Math.floor(parsed);
  }

  private async _safe(
    key: string,
    counts: Record<string, number>,
    fn: () => Promise<number>
  ): Promise<void> {
    try {
      counts[key] = await fn();
    } catch (err) {
      counts[key] = -1;
      this._logger.warn(
        `RetentionActivity: prune "${key}" failed (non-fatal): ${(err as Error)?.message}`
      );
    }
  }
}
