import type { StudioLanding } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

/**
 * HeyGen is a bespoke studio (no `descriptor.ts`), so its landing copy lives
 * here as pure data — importable by the media-nav badge drift spec without
 * pulling in the browser-only studio component.
 */
export const HEYGEN_LANDING: StudioLanding = {
  website: 'https://www.heygen.com',
  tagline: 'Studio-quality AI avatar video from text',
  description:
    'HeyGen turns scripts, slides, or PDFs into professional videos with hyper-realistic AI avatars and natural voiceovers — no camera or crew. Best known for digital twins and video translation.',
  badges: ['Avatar', 'Video', 'Voice'],
  highlights: [
    'Photo avatars & digital twins with realistic lip-sync',
    'Video translation across 175+ languages',
    'Storyboard multi-scene avatar videos',
    'Talking Photo: animate a single portrait',
    'AI voiceover with controllable tone & delivery',
  ],
};
