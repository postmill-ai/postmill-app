import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaStudioService } from '@gitroom/nestjs-libraries/media/studio/media-studio.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { z } from 'zod';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

const jobStatusSchema = z.object({
  id: z.string(),
  operation: z.string(),
  status: z.string(),
  fileId: z.string().nullable(),
  error: z.string().nullable(),
});

@Injectable()
export class MediaJobStatusTool implements AgentToolInterface {
  constructor(
    private _mediaStudio: MediaStudioService,
    private _lifecycle: MediaJobLifecycleService,
  ) {}
  name = 'mediaJobStatus';

  run() {
    return createTool({
      id: 'mediaJobStatus',
      description:
        'Check the status of AI media generation jobs. Pass a provider to list recent jobs, or a jobId to look up a single job.',
      inputSchema: z.object({
        provider: z
          .string()
          .optional()
          .describe('Provider identifier to list recent jobs for'),
        jobId: z
          .string()
          .optional()
          .describe('Single job id to look up'),
      }),
      mcp: {
        annotations: {
          title: 'Media Job Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.union([
        z.array(jobStatusSchema),
        z.object({ error: z.string() }),
      ]),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context);
        const org = parseOrg(context);

        if (inputData.provider) {
          const jobs = await this._mediaStudio.listJobs(org.id, inputData.provider);
          return jobs.map((j) => ({
            id: j.id,
            operation: j.operation,
            status: j.status,
            fileId: j.fileId ?? null,
            error: j.error ?? null,
          }));
        }

        if (inputData.jobId) {
          const job = await this._lifecycle.getJob(inputData.jobId, org.id);
          // getJob does a findUnique with no org filter — enforce ownership
          // here. Identical response for missing vs foreign (no existence oracle).
          if (!job || job.organizationId !== org.id) {
            return { error: `Job ${inputData.jobId} not found` };
          }
          return [
            {
              id: job.id,
              operation: job.operation,
              status: job.status,
              fileId: null,
              error: job.error ?? null,
            },
          ];
        }

        return { error: 'Provide either provider or jobId' };
      },
    });
  }
}
