import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { MediaJobsActivity } from '@gitroom/nestjs-libraries/inngest/activities/media-jobs.activity';
import { getRenderConcurrency } from '@gitroom/nestjs-libraries/media/design-render/render-config';

// Local video renders (Designer timeline + clip-merge) run here, one Inngest function with a
// static `concurrency.limit` (the post-publish idiom) — so at most VIDEO_RENDER_CONCURRENCY
// (default 3) renders run at once. Each render shells out to a resource-capped Podman
// container (or the in-process encoder when Podman is disabled).
export const createMediaRender = (mediaJobsActivity: MediaJobsActivity) =>
  inngest.createFunction(
    { id: 'media-render', concurrency: { limit: getRenderConcurrency() } },
    { event: 'media/render' },
    async ({ step, event }) =>
      step.run('render', () => mediaJobsActivity.processRenderJob(event.data.jobId)),
  );
