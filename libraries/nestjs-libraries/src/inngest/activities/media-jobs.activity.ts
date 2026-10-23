import { Injectable, Logger } from '@nestjs/common';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { VideoRenderService, NO_CREDIT, computeRenderTimeoutMs } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { getRenderConcurrency, getRenderTimeoutMs } from '@postmill-ai/nestjs-libraries/media/design-render/render-config';
import { renderPayloadKey } from '@postmill-ai/nestjs-libraries/media/design-render/render-progress';
import {
  DESIGN_EXPORT_PROVIDER,
  DESIGN_EXPORT_EVENT,
  DESIGN_EXPORT_TIMEOUT_MS,
  designExportEventId,
  DesignExportService,
} from '@postmill-ai/nestjs-libraries/media/design-export/design-export.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { mapWithConcurrency } from '@postmill-ai/nestjs-libraries/utils/concurrency';

// Polling fallback for async media generations (§11.2): the sweep selects pending
// jobs and fans them out via `media/poll-job` Inngest events; local renders are
// re-enqueued to the concurrency-capped `media/render` function. Never throws — a
// sweep failure must not crash the workflow.
@Injectable()
export class MediaJobsActivity {
  private readonly logger = new Logger(MediaJobsActivity.name);
  private _inlineRenderTimeoutMs = MediaJobsActivity.INLINE_RENDER_TIMEOUT_MS;

  constructor(
    private _lifecycle: MediaJobLifecycleService,
    private _aiSettings: AiSettingsService,
    private _videoRenderService: VideoRenderService,
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _designExportService: DesignExportService,
  ) {}

  /**
   * A still-pending local render is only re-enqueued once it has been pending longer than this
   * (its original `media/render` event was likely lost). Freshly-enqueued jobs — including ones
   * legitimately waiting behind the `concurrency:3` cap — are left alone, so the sweep does not
   * stack a duplicate run for every job every minute.
   */
  private static readonly STALE_RENDER_MS = 90_000;

  /** Cap the inline fallback so one hanging render cannot freeze the sweep. */
  private static readonly INLINE_RENDER_TIMEOUT_MS = 5 * 60 * 1000;

  /** Grace on top of a render's own wall-clock budget before a stuck `processing` job is declared dead. */
  private static readonly STUCK_PROCESSING_GRACE_MS = 60_000;

  /** True for the two local-compute render kinds (design timeline render + clip merge). */
  private isLocalRender(job: { provider: string; model?: string | null }): boolean {
    return job.provider === 'chromium-ffmpeg' || job.model === 'local/ffmpeg-merge';
  }

  private isStaleRender(job: { updatedAt?: Date | string | null; createdAt?: Date | string | null }): boolean {
    const ts = job.updatedAt ?? job.createdAt;
    if (!ts) return true;
    return Date.now() - new Date(ts).getTime() > MediaJobsActivity.STALE_RENDER_MS;
  }

  /**
   * Wall-clock budget for a local render sitting in `processing`: the same
   * computeRenderTimeoutMs the runner enforces (derived from the surviving
   * Redis payload), or the env floor when the payload is already gone.
   */
  private async stuckRenderBudgetMs(job: { id: string; model?: string | null }): Promise<number> {
    if (job.model !== 'local/ffmpeg-merge') {
      try {
        const raw = await ioRedis.get(renderPayloadKey(job.id));
        if (raw) {
          const input = JSON.parse(raw);
          const composition = input.composition || {};
          return computeRenderTimeoutMs(
            composition.durationMs || 10000,
            input.fps || composition.fps || 30,
            typeof input.scale === 'number' && input.scale > 0 ? input.scale : 1,
            composition.width || 0,
            composition.height || 0,
          );
        }
      } catch {
        /* fall through to the env floor */
      }
    }
    return getRenderTimeoutMs();
  }

  /**
   * Poll a single pending media job (invoked by the `media/poll-job` Inngest handler).
   */
  async processPollJob(jobId: string): Promise<void> {
    try {
      await this._lifecycle.processJob(jobId);
    } catch (err) {
      // Non-fatal: the next sweep / poll will retry until the job times out.
      this.logger.warn(`Media poll-job error for ${jobId}: ${(err as Error).message}`);
    }
  }

  /**
   * Process one local render job (invoked by the concurrency-limited `media-render`
   * Inngest function). No-ops unless the job is still pending.
   */
  async processRenderJob(jobId: string): Promise<void> {
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job) return;

    const org = await this._organizationService.getOrgById(job.organizationId);
    if (!org) {
      this.logger.warn(`Render ${jobId}: organization ${job.organizationId} not found`);
      return;
    }

    // Idempotency guard (matches this method's contract): only the invocation that
    // finds the job still `pending` performs the render and charges the export credit.
    // A retried or re-dispatched already-terminal job (completed/processing/failed)
    // no-ops here — otherwise `useCredit` would run, the inner render would no-op (it
    // also gates on `pending`), the `after.status === 'completed'` check would pass on
    // the PRIOR run's result, and a second `video_export` credit would be committed.
    if (job.status !== 'pending') {
      return;
    }

    if (job.model === 'local/ffmpeg-merge') {
      await this._videoRenderService.processMergeRender(jobId);
    } else if (job.provider === 'chromium-ffmpeg') {
      await this._videoRenderService.processVideoRender(jobId);
    }

    const after = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    // Already terminal-failed (the render recorded its own error): return
    // cleanly. Throwing here would burn every Inngest retry on a job whose
    // retry no-ops at the pending guard and lands right back at this line.
    if (after?.status === 'failed') {
      return;
    }
    if (!after || after.status !== 'completed') {
      throw new Error(
        `Render ${jobId} did not complete (status: ${after?.status ?? 'missing'})`
      );
    }

    // Charge one video_export credit AFTER a confirmed-completed render, as a plain insert.
    // NOT the $transaction-wrapped useCredit: an interactive transaction's ~5s timeout would
    // abort a multi-second/minute render and roll the charge back — the render would complete
    // but never be metered (leaving the VIDEO_EXPORTS gate permanently bypassable). A failed
    // render never reaches this line (we threw above), so there is nothing to roll back.
    // Idempotency: the `status !== 'pending'` guard above no-ops sequential retries, so a
    // completed job is charged exactly once.
    // `creditType: 'none'` (NO_CREDIT — template animated previews) is never charged. The
    // sentinel exists because merge jobs run with a NULL creditType and ARE charged: a
    // null-means-free rule would silently unmeter them.
    if (after.creditType !== NO_CREDIT) {
      await this._subscriptionService.recordCredit(org, 'video_export');
    }
  }

  async processPendingMediaJobs(): Promise<{ processed: number; completed: number; failed: number }> {
    const result = { processed: 0, completed: 0, failed: 0 };

    // §3.1 crash-recovery: reclaim any jobs stranded in the transient `landing` state.
    try {
      await this._lifecycle.reclaimStaleLandingJobs();
    } catch (err) {
      this.logger.warn(`Stale-landing reclaim failed: ${(err as Error).message}`);
    }

    try {
      const pending = await this._aiSettings.getPendingMediaJobs(100);
      const localJobs: typeof pending = [];
      const pollJobs: typeof pending = [];
      const stuckJobs: typeof pending = [];
      const exportJobs: typeof pending = [];
      const stuckExportJobs: typeof pending = [];

      for (const job of pending) {
        // `.pdesign` exports are local-compute too, but through their own
        // event/activity — they must never land in pollJobs (the provider-kernel
        // poll path would fail them as an unknown provider).
        if (job.provider === DESIGN_EXPORT_PROVIDER) {
          if (job.status === 'processing') {
            stuckExportJobs.push(job);
          } else if (this.isStaleRender(job)) {
            exportJobs.push(job);
          }
        } else if (this.isLocalRender(job)) {
          if (job.status === 'processing') {
            stuckJobs.push(job);
          } else if (this.isStaleRender(job)) {
            localJobs.push(job);
          }
        } else {
          pollJobs.push(job);
        }
      }

      // A runner that crashed mid-render leaves the job `processing` forever —
      // its own catch never ran to fail it, and processRenderJob only renders
      // `pending` jobs, so the status poller would wait indefinitely. The
      // render itself is wall-clock capped, so anything past that budget +
      // grace is dead: fail it so the user sees the failure and can retry.
      for (const job of stuckJobs) {
        const since = new Date(job.updatedAt ?? job.createdAt ?? 0).getTime();
        const budgetMs =
          (await this.stuckRenderBudgetMs(job)) +
          MediaJobsActivity.STUCK_PROCESSING_GRACE_MS;
        if (Date.now() - since <= budgetMs) continue;
        try {
          await this._aiSettings.updateMediaJob(job.organizationId, job.id, {
            status: 'failed',
            error: 'Render exceeded its wall-clock budget with no live runner',
          });
          result.processed++;
          result.failed++;
          this.logger.warn(
            `Render ${job.id} failed: stuck in processing beyond ${budgetMs}ms`,
          );
        } catch (err) {
          this.logger.warn(
            `Failing stuck render ${job.id} failed: ${(err as Error).message}`,
          );
        }
      }

      // A crashed export runner strands the job in `processing` the same way —
      // fail it past the fixed export budget (no payload-derived budget here:
      // exports are storage-I/O bound, not frame-scaled).
      for (const job of stuckExportJobs) {
        const since = new Date(job.updatedAt ?? job.createdAt ?? 0).getTime();
        if (Date.now() - since <= DESIGN_EXPORT_TIMEOUT_MS) continue;
        try {
          await this._aiSettings.updateMediaJob(job.organizationId, job.id, {
            status: 'failed',
            error: 'Export exceeded its wall-clock budget with no live runner',
          });
          result.processed++;
          result.failed++;
          this.logger.warn(`Design export ${job.id} failed: stuck in processing`);
        } catch (err) {
          this.logger.warn(`Failing stuck export ${job.id} failed: ${(err as Error).message}`);
        }
      }

      // Still-pending exports: re-enqueue via their own event (idempotent — the
      // activity no-ops once status != pending), or run inline through the same
      // concurrency knob when Inngest is off.
      if (exportJobs.length > 0) {
        if (isInngestEnabled()) {
          for (const job of exportJobs) {
            await inngest.send({
              name: DESIGN_EXPORT_EVENT,
              id: designExportEventId(job.id),
              data: { jobId: job.id },
            });
          }
          result.processed += exportJobs.length;
        } else {
          await mapWithConcurrency(exportJobs, getRenderConcurrency(), async (job) => {
            try {
              await this._withTimeout(
                this._designExportService.processExport(job.id),
                DESIGN_EXPORT_TIMEOUT_MS,
                `Inline export timeout for ${job.id}`,
              );
              result.processed++;
              result.completed++;
            } catch (err) {
              result.processed++;
              result.failed++;
              this.logger.warn(`Inline export error for ${job.id}: ${(err as Error).message}`);
            }
          });
        }
      }

      // Fan out external-provider polling via events.
      if (pollJobs.length > 0) {
        if (isInngestEnabled()) {
          for (const job of pollJobs) {
            await inngest.send({
              name: 'media/poll-job',
              // Deterministic id dedupes against other sweeps within the same minute.
              id: `media-poll-${job.id}-${Math.floor(Date.now() / 60000)}`,
              data: { jobId: job.id },
            });
          }
        }
        result.processed += pollJobs.length;
      }

      // Local renders are processed by the concurrency-limited `media/render` Inngest
      // function. This sweep is a safety net: re-enqueue any still-pending local render
      // (idempotent — processRenderJob no-ops once status != pending). When Inngest is off
      // there is no event consumer, so render inline through a host semaphore that holds the
      // same 3-concurrent cap, with a per-job timeout so a hanging render cannot freeze the sweep.
      if (localJobs.length > 0) {
        if (isInngestEnabled()) {
          for (const job of localJobs) {
            await inngest.send({
              name: 'media/render',
              id: `media-render-${job.id}-${Math.floor(Date.now() / 60000)}`,
              data: {
                jobId: job.id,
                op: job.model === 'local/ffmpeg-merge' ? 'merge' : 'design',
              },
            });
          }
          result.processed += localJobs.length;
        } else {
          await mapWithConcurrency(localJobs, getRenderConcurrency(), async (job) => {
            try {
              await this._withTimeout(
                this.processRenderJob(job.id),
                this._inlineRenderTimeoutMs,
                `Inline render timeout for ${job.id}`,
              );
              result.processed++;
              result.completed++;
            } catch (err) {
              result.processed++;
              result.failed++;
              this.logger.warn(
                `Inline render error for ${job.id}: ${(err as Error).message}`,
              );
            }
          });
        }
      }

      if (result.processed > 0) {
        this.logger.log(
          `media jobs sweep: processed=${result.processed} completed=${result.completed} failed=${result.failed}`,
        );
      }
    } catch (err) {
      this.logger.warn(`media jobs sweep failed: ${(err as Error).message}`);
    }

    return result;
  }

  private _withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]);
  }
}
