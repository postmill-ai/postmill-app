import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

// Reel.Farm official developer API. A natural-language prompt renders an AI TikTok slideshow video
// (the prompt controls slide count, on-slide text, fonts, positions, tone — everything). Field names
// are Reel.Farm's native params: `additional_context` is sent as the prompt server-side, and the
// optional `image_N` media fields are collected into the `images` background-URL array. Aspect,
// fit, and duration settings are applied when Postmill encodes the returned slides as MP4.
export const reelfarmDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://reel.farm',
    tagline: 'AI faceless slideshow videos at scale',
    description:
      'Reel.Farm turns a single prompt into a finished TikTok-style slideshow video — slide text, layout, and pacing are all generated for you. Built for bulk, automated short-form content. Note: Reel.Farm\u2019s public API creates slideshow videos only; UGC/avatar and greenscreen videos are generated in the Reel.Farm app (the API can list them, but not create them).',
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
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '4:5',
          options: [
            { value: '4:5', label: '4:5 portrait' },
            { value: '9:16', label: '9:16 vertical' },
            { value: '1:1', label: '1:1 square' },
            { value: '16:9', label: '16:9 widescreen' },
          ],
        },
        {
          type: 'toggle',
          name: 'keep_original_aspect_ratio',
          label: 'Fit whole images (letterbox)',
          default: false,
          help: 'Keep each image’s native aspect ratio instead of cropping to fill the video.',
        },
        {
          type: 'number',
          name: 'duration',
          label: 'Seconds per slide',
          min: 1,
          max: 30,
          step: 1,
          default: 4,
        },
        { type: 'media', name: 'image_1', label: 'Background image 1 (optional)', accept: 'image' },
        { type: 'media', name: 'image_2', label: 'Background image 2 (optional)', accept: 'image' },
        { type: 'media', name: 'image_3', label: 'Background image 3 (optional)', accept: 'image' },
        { type: 'media', name: 'image_4', label: 'Background image 4 (optional)', accept: 'image' },
      ],
    },
  ],
};
