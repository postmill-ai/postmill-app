import type { StudioLanding } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

/**
 * Replicate is a bespoke studio (no `descriptor.ts`), so its landing copy lives
 * here as pure data — importable by the media-nav badge drift spec without
 * pulling in the browser-only studio component.
 */
export const REPLICATE_LANDING: StudioLanding = {
  website: 'https://replicate.com',
  tagline: 'Run thousands of AI models with one line',
  description:
    'A cloud hub for running thousands of open-source models via API — image, video, speech, and music generation — with pay-per-use pricing, fine-tuning, and custom deploys.',
  badges: ['Image', 'Video', 'Audio'],
  highlights: [
    'Thousands of community models via API',
    'Image, video, and audio generation models',
    'Run and fine-tune with one line of code',
    'Pay only for active compute time',
    'Inpaint, merge, upscale and meme tools built in',
  ],
};
