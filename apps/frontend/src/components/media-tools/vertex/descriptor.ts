import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Google Vertex AI (registry/config identifier `vertex`): Veo text→video + Imagen text→image.
// Field names are native Vertex `parameters` keys and ride into the request body via the
// adapter's `options.input` passthrough. Credentials are GCP project + location +
// service-account JSON (configured at Settings → Media); a short-lived token is minted
// per call. Veo completes via the media-jobs poll cron (Vertex has no completion webhook).
const VEO_MODELS = [
  { value: 'veo-2.0-generate-001', label: 'Veo 2' },
  { value: 'veo-3.0-generate-001', label: 'Veo 3' },
  { value: 'veo-3.0-fast-generate-001', label: 'Veo 3 Fast' },
];
const VIDEO_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
];
const IMAGEN_MODELS = [
  { value: 'imagen-3.0-generate-002', label: 'Imagen 3' },
  { value: 'imagen-3.0-fast-generate-001', label: 'Imagen 3 Fast' },
];
const IMAGE_ASPECT = [
  { value: '1:1', label: 'Square 1:1' },
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

export const vertexDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://cloud.google.com/vertex-ai",
    "tagline": "Enterprise generative media on Google Cloud",
    "description": "Google Cloud's unified AI platform for building and scaling generative apps — featuring Imagen for photorealistic images and Veo for high-quality text-to-video, with governance built in.",
    "badges": [
      "Image",
      "Video"
    ],
    "highlights": [
      "Imagen for photorealistic text-to-image",
      "Veo for high-quality text-to-video",
      "Model Garden: Google plus open-source models",
      "Enterprise controls: VPC-SC, encryption, audit",
      "Full MLOps lifecycle with monitoring"
    ]
  },
  provider: 'vertex',
  title: 'Google Vertex',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Google Veo on Vertex.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'veo-2.0-generate-001', options: VEO_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negativePrompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'select', name: 'aspectRatio', label: 'Aspect ratio', default: '16:9', options: VIDEO_ASPECT },
        { type: 'number', name: 'durationSeconds', label: 'Duration (seconds)', min: 5, max: 8, step: 1, default: 8 },
      ],
    },
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with Google Imagen on Vertex.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'imagen-3.0-generate-002', options: IMAGEN_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negativePrompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'select', name: 'aspectRatio', label: 'Aspect ratio', default: '1:1', options: IMAGE_ASPECT },
        { type: 'number', name: 'sampleCount', label: 'Number of images', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
  ],
};
