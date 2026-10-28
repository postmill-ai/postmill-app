import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';
import { FAL_PIKA_TABS } from '../fal/tabs';

export const pikaDescriptor: StudioDescriptor = {
  landing: {
    icon: 'pika',
    website: 'https://pika.art',
    tagline: 'Fun, fast AI video for everyone',
    description: 'Create Pika 2.2 videos from text or images. This studio uses your configured fal.ai connection and API key; no separate Pika credentials are required.',
    badges: ['Video', 'Image'],
    highlights: [
      'Text-to-video and image-to-video generation',
      'Uses the existing fal.ai connection in Settings → Media',
      'Pika 2.2 video generation',
      'No separate Pika provider or API key to configure',
    ],
  },
  provider: 'fal',
  title: 'Pika',
  tabs: FAL_PIKA_TABS,
};
