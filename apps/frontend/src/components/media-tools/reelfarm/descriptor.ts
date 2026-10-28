import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

// Reel.Farm official developer API. A natural-language prompt renders an AI TikTok slideshow
// (the prompt controls slide count, on-slide text, fonts, positions, tone — everything).
// `additional_context` is sent as the prompt server-side, and the optional `image_N` media fields
// are collected into the `images` background-URL array. Postmill handles MP4 conversion locally.
export const reelfarmDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://reel.farm',
    tagline: 'AI faceless slideshow videos at scale',
    description:
      'Reel.Farm turns a single prompt into an ordered TikTok-style slideshow — slide text, layout, and pacing are all generated for you. Postmill converts the returned slides into a silent MP4 locally. Aspect ratio, image fit, and seconds per slide apply only to that local conversion; they are not sent to Reel.Farm. Note: Reel.Farm\u2019s public API creates slideshow videos only; UGC/avatar and greenscreen videos are generated in the Reel.Farm app (the API can list them, but not create them).',
    badges: ['Video'],
    highlights: [
      'Prompt → ordered slideshow',
      'Postmill locally converts slides to a silent MP4',
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
      description: 'Generate an AI slideshow, then let Postmill convert the returned slides into a silent MP4 locally.',
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
          help: 'Applies only when Postmill converts the returned slides locally; not sent to Reel.Farm.',
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
          help: 'During local conversion only, keep each image’s native aspect ratio instead of cropping to fill the video. Not sent to Reel.Farm.',
        },
        {
          type: 'number',
          name: 'duration',
          label: 'Seconds per slide',
          min: 1,
          max: 30,
          step: 1,
          default: 4,
          help: 'Applies only to Postmill’s local MP4 conversion; not sent to Reel.Farm.',
        },
        { type: 'media', name: 'image_1', label: 'Background image 1 (optional)', accept: 'image' },
        { type: 'media', name: 'image_2', label: 'Background image 2 (optional)', accept: 'image' },
        { type: 'media', name: 'image_3', label: 'Background image 3 (optional)', accept: 'image' },
        { type: 'media', name: 'image_4', label: 'Background image 4 (optional)', accept: 'image' },
      ],
    },
  ],
};
