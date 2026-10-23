import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaDesignExportEvent } from '@postmill-ai/nestjs-libraries/inngest/inngest.types';
import { DesignExportActivity } from '@postmill-ai/nestjs-libraries/inngest/activities/design-export.activity';
import { getRenderConcurrency } from '@postmill-ai/nestjs-libraries/media/design-render/render-config';

// `.pdesign` bundle exports run here with a static concurrency cap (the
// media-render idiom). Exports are storage-I/O bound (read each referenced
// asset, zip, write the artifact), so they share the render concurrency knob —
// a big export mostly waits on storage, not CPU.
export const createDesignExport = (designExportActivity: DesignExportActivity) =>
  inngest.createFunction(
    {
      id: 'media-design-export',
      concurrency: { limit: getRenderConcurrency() },
      triggers: [mediaDesignExportEvent],
    },
    async ({ step, event }) =>
      step.run('export', () => designExportActivity.processExportJob(event.data.jobId)),
  );
