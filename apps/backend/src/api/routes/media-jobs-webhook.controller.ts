import { Controller, HttpException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { verifyMediaJobWebhookToken } from '@gitroom/nestjs-libraries/media/media-job-token';

// Async media-job completion webhook (§11.2). Unauthenticated by design (providers
// can't carry our cookies): the URL is unguessable — the job id plus a per-job
// HMAC token bound to the job's organization. The request body is never trusted:
// it only *triggers* `processJob`, which fetches the authoritative result from the
// provider's status API and lands the artifact in tenant storage.
@ApiTags('Media Jobs')
@Controller('/media-jobs')
export class MediaJobsWebhookController {
  constructor(private _lifecycle: MediaJobLifecycleService) {}

  @Post('/webhook/:jobId/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async handle(@Param('jobId') jobId: string, @Param('token') token: string) {
    const job = await this._lifecycle.getJobUnscoped(jobId);
    if (!job || !verifyMediaJobWebhookToken(jobId, job.organizationId, token)) {
      // Identical response for unknown job and bad token — no oracle.
      throw new HttpException('not found', 404);
    }

    const result = await this._lifecycle.processJob(jobId);
    return { ok: true, status: result };
  }
}
