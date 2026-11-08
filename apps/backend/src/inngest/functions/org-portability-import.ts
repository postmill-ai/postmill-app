import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { OrgImportService } from '@postmill-ai/nestjs-libraries/database/prisma/org-portability/org-import.service';
import { orgPortabilityImportEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';

export const createOrgPortabilityImport = (orgImport: OrgImportService) =>
  inngest.createFunction(
    {
      id: 'org-portability-import',
      concurrency: { limit: 1, key: 'event.data.organizationId' },
      triggers: [orgPortabilityImportEvent],
    },
    async ({ step, event }) => {
      await step.run('import-organization', () => orgImport.processImport(event.data.jobId));
    },
  );
