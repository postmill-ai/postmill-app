import { Injectable, Logger } from '@nestjs/common';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { DesignExportService } from '@postmill-ai/nestjs-libraries/media/design-export/design-export.service';

/**
 * Drives one `.pdesign` export job (invoked by the concurrency-limited
 * `media/design-export` Inngest function, or inline by the media-jobs sweep
 * when Inngest is off). Mirrors MediaJobsActivity.processRenderJob's contract:
 * the pending guard makes re-dispatches/retries no-ops, and an export that
 * recorded its own failure returns cleanly instead of burning Inngest retries
 * on a job whose retry no-ops at the same guard. Exports are NO_CREDIT — there
 * is deliberately no credit charge after completion.
 */
@Injectable()
export class DesignExportActivity {
  private readonly logger = new Logger(DesignExportActivity.name);

  constructor(
    private _aiSettings: AiSettingsService,
    private _organizationService: OrganizationService,
    private _designExportService: DesignExportService,
  ) {}

  async processExportJob(jobId: string): Promise<void> {
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.status !== 'pending') {
      return;
    }

    const org = await this._organizationService.getOrgById(job.organizationId);
    if (!org) {
      this.logger.warn(`Design export ${jobId}: organization ${job.organizationId} not found`);
      return;
    }

    await this._designExportService.processExport(jobId);

    const after = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (after?.status === 'failed') {
      return;
    }
    if (!after || after.status !== 'completed') {
      throw new Error(
        `Design export ${jobId} did not complete (status: ${after?.status ?? 'missing'})`
      );
    }
  }
}
