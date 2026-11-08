import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { OrgPortabilityService } from '@postmill-ai/nestjs-libraries/database/prisma/org-portability/org-portability.service';

export const createOrgPortabilityExport = (portability: OrgPortabilityService) =>
  inngest.createFunction(
    {
      id: 'org-portability-export',
      concurrency: 1,
      triggers: [{ event: 'org/portability.export' }],
    },
    async ({ step, event }) => {
      await step.run('export-organization', () => portability.processExport(event.data.jobId));
    },
  );

export const createOrgPortabilityExpiry = (portability: OrgPortabilityService) =>
  inngest.createFunction(
    {
      id: 'org-portability-expiry',
      triggers: [{ cron: '17 * * * *' }],
    },
    async ({ step }) => {
      await step.run('purge-expired-organization-archives', () => portability.purgeExpired());
    },
  );
