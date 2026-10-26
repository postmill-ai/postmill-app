import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';
import { FAL_KLING_TABS, FAL_PIKA_TABS, FLUX_IMAGE_TAB, STABLE_AUDIO_TAB } from './tabs';

export const falDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://fal.ai',
    tagline: 'Fast generative media on one fal.ai connection',
    description: 'Generate images, video, music, and audio with fal.ai. This studio includes FLUX, Stable Audio, fal-hosted Kling, Pika, and Pikaffects using your configured fal.ai API key.',
    badges: ['Image', 'Video', 'Audio'],
    highlights: [
      'FLUX.1 Schnell text-to-image generation',
      'Stable Audio text-to-music and audio generation',
      'Kling text-to-video and image-to-video',
      'Pika text-to-video and image-to-video',
      'One-click Pikaffects for source images',
    ],
  },
  provider: 'fal',
  title: 'fal.ai',
  tabs: [
    FLUX_IMAGE_TAB,
    ...FAL_KLING_TABS,
    ...FAL_PIKA_TABS.map((tab) => ({
      ...tab,
      key: `pika-${tab.key}`,
      label: tab.key === 'pikaffects' ? tab.label : `Pika ${tab.label}`,
    })),
    STABLE_AUDIO_TAB,
  ],
};
