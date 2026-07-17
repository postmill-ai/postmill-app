import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Stability AI (registry/config identifier `stability-ai`). `model` selects the Stable
// Image endpoint (core/ultra/sd3); the remaining native params (negative_prompt,
// aspect_ratio, style_preset, seed, output_format) ride through the request body.
// Stable Image is synchronous — the adapter returns the artifact inline.
export const stabilityDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://stability.ai",
    "tagline": "Open generative media for everyone",
    "description": "The company behind Stable Diffusion and the Stable Image models, offering open, enterprise-grade generative media for image creation and editing with full creative control.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "Stable Image core, ultra, and SD3 models",
      "Sequential generate-and-edit production workflows",
      "Enterprise self-host, API, and managed cloud",
      "Open-weight heritage of Stable Diffusion",
      "Trusted by AWS, Nvidia, Arm, EA, UMG"
    ]
  },
  provider: 'stability-ai',
  title: 'Stability AI',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with Stable Image.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'model',
          label: 'Engine',
          default: 'core',
          options: [
            { value: 'core', label: 'Stable Image Core' },
            { value: 'ultra', label: 'Stable Image Ultra' },
            { value: 'sd3', label: 'Stable Diffusion 3' },
          ],
        },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '1:1',
          options: [
            { value: '1:1', label: 'Square 1:1' },
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
            { value: '3:2', label: 'Photo 3:2' },
            { value: '2:3', label: 'Photo 2:3' },
            { value: '4:5', label: 'Social 4:5' },
            { value: '5:4', label: 'Social 5:4' },
            { value: '21:9', label: 'Wide 21:9' },
            { value: '9:21', label: 'Tall 9:21' },
          ],
        },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt (optional)', placeholder: 'What to avoid…' },
        {
          type: 'select',
          name: 'style_preset',
          label: 'Style preset',
          default: '',
          help: 'Supported by Core and Ultra.',
          options: [
            { value: '', label: 'None' },
            { value: 'photographic', label: 'Photographic' },
            { value: 'cinematic', label: 'Cinematic' },
            { value: 'digital-art', label: 'Digital art' },
            { value: 'anime', label: 'Anime' },
            { value: 'comic-book', label: 'Comic book' },
            { value: 'fantasy-art', label: 'Fantasy art' },
            { value: 'line-art', label: 'Line art' },
            { value: 'neon-punk', label: 'Neon punk' },
            { value: 'pixel-art', label: 'Pixel art' },
            { value: '3d-model', label: '3D model' },
            { value: 'analog-film', label: 'Analog film' },
            { value: 'low-poly', label: 'Low poly' },
            { value: 'origami', label: 'Origami' },
            { value: 'enhance', label: 'Enhance' },
          ],
        },
        {
          type: 'select',
          name: 'output_format',
          label: 'Output format',
          default: 'png',
          options: [
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'webp', label: 'WebP' },
          ],
        },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
  ],
};
