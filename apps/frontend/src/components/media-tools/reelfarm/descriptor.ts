import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Reel.Farm official developer API. A natural-language prompt renders an AI TikTok slideshow video
// (the prompt controls slide count, on-slide text, fonts, positions, tone — everything). Field names
// are Reel.Farm's native params: `additional_context` is sent as the prompt server-side, and the
// optional `image_N` media fields are collected into the `images` background-URL array
// (see reelfarm.adapter.ts). Single async tab, `operation: 'video'`.
export const reelfarmDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://reel.farm',
    tagline: 'AI faceless slideshow videos at scale',
    description:
      'Reel.Farm turns a single prompt into a finished TikTok-style slideshow video — slide text, layout, and pacing are all generated for you. Built for bulk, automated short-form content.',
    badges: ['Video'],
    highlights: [
      'Prompt → finished slideshow video',
      'Controls slide count, text, fonts, and layout from the prompt',
      'Optional background images',
      'Designed for bulk faceless content',
    ],
  },
  provider: 'reelfarm',
  title: 'Reel.Farm',
  tabs: [
    {
      key: 'slideshow',
      label: 'Prompt → Slideshow',
      operation: 'video',
      description: 'Generate an AI slideshow video from a natural-language prompt.',
      fields: [
        {
          type: 'prompt',
          name: 'prompt',
          label: 'Prompt',
          required: true,
          placeholder: 'e.g. A 6-slide motivational slideshow about discipline, bold white text on dark photos…',
        },
        { type: 'media', name: 'image_1', label: 'Background image 1 (optional)', accept: 'image' },
        { type: 'media', name: 'image_2', label: 'Background image 2 (optional)', accept: 'image' },
        { type: 'media', name: 'image_3', label: 'Background image 3 (optional)', accept: 'image' },
        { type: 'media', name: 'image_4', label: 'Background image 4 (optional)', accept: 'image' },
      ],
    },
  ],
};
