import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Google AI Studio (registry/config identifier `google`): the Gemini Developer API, keyed by the
// same Gemini API key as Settings → AI → "Google Gemini" (universal credential — configure once).
// Image: Nano Banana (gemini-2.5-flash-image, generateContent → inline base64) + Imagen (:predict),
// routed by the chosen model. Video: Veo (:predictLongRunning, completed via the media-jobs poll
// cron — Gemini has no completion webhook). Field names ride into the request via `options.input`.
const IMAGE_MODELS = [
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana (Gemini 2.5 Flash Image)' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4' },
  { value: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4 Ultra' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4 Fast' },
  { value: 'imagen-3.0-generate-002', label: 'Imagen 3' },
];
const IMAGE_ASPECT = [
  { value: '1:1', label: 'Square 1:1' },
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];
const VEO_MODELS = [
  { value: 'veo-3.0-generate-001', label: 'Veo 3' },
  { value: 'veo-3.0-fast-generate-001', label: 'Veo 3 Fast' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (Preview)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (Preview)' },
  { value: 'veo-2.0-generate-001', label: 'Veo 2' },
];
const VIDEO_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
];
const RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];

export const googleAiDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://aistudio.google.com",
    "tagline": "AI media for every developer",
    "description": "Google's Gemini Developer API for media generation — spanning Nano Banana and Imagen image models plus Veo video, all driven by a single Gemini API key.",
    "badges": [
      "Image",
      "Video"
    ],
    "highlights": [
      "Nano Banana (Gemini) conversational image gen",
      "Imagen high-quality text-to-image model",
      "Veo text- and image-to-video generation",
      "One Gemini API key across image and video",
      "Simple developer API via Google AI Studio"
    ]
  },
  provider: 'google',
  title: 'Google AI Studio',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image with Nano Banana (Gemini) or Imagen on Google AI Studio.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'gemini-2.5-flash-image', options: IMAGE_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'select', name: 'aspectRatio', label: 'Aspect ratio', default: '1:1', options: IMAGE_ASPECT },
        { type: 'number', name: 'sampleCount', label: 'Number of images (Imagen only)', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Google Veo on Google AI Studio.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'veo-3.0-generate-001', options: VEO_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negativePrompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'select', name: 'aspectRatio', label: 'Aspect ratio', default: '16:9', options: VIDEO_ASPECT },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '720p', options: RESOLUTIONS },
        { type: 'number', name: 'durationSeconds', label: 'Duration (seconds)', min: 4, max: 8, step: 1, default: 8 },
      ],
    },
  ],
};
