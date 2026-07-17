import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Ideogram (registry/config identifier `ideogram`): own-key image generation, strong at accurate
// in-image text. Single v3 generate endpoint (no model param), synchronous (one POST → hosted URL).
// Field names are native Ideogram form fields and ride into the request via `options.input`.
const ASPECT = [
  { value: '1x1', label: 'Square 1:1' },
  { value: '16x9', label: 'Landscape 16:9' },
  { value: '9x16', label: 'Portrait 9:16' },
  { value: '3x2', label: '3:2' },
  { value: '2x3', label: '2:3' },
  { value: '4x3', label: '4:3' },
  { value: '3x4', label: '3:4' },
  { value: '16x10', label: '16:10' },
  { value: '10x16', label: '10:16' },
];
const RENDERING_SPEED = [
  { value: 'DEFAULT', label: 'Default' },
  { value: 'TURBO', label: 'Turbo (fastest)' },
  { value: 'QUALITY', label: 'Quality (highest)' },
  { value: 'FLASH', label: 'Flash' },
];
const MAGIC_PROMPT = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'ON', label: 'On' },
  { value: 'OFF', label: 'Off' },
];
const STYLE_TYPE = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'GENERAL', label: 'General' },
  { value: 'REALISTIC', label: 'Realistic' },
  { value: 'DESIGN', label: 'Design' },
  { value: 'FICTION', label: 'Fiction' },
];

export const ideogramDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://ideogram.ai",
    "tagline": "Stunning realism, accurate text in images",
    "description": "An AI image generator best known for industry-leading in-image text rendering — crisp, correctly-spelled typography ideal for posters, ads, and social designs.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "Best-in-class accurate, legible text rendering",
      "Style References from up to 3 images",
      "Billions of style presets and reusable codes",
      "Strong photorealism and prompt alignment",
      "Built for campaigns, posters, and brand design"
    ]
  },
  provider: 'ideogram',
  title: 'Ideogram',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate images with accurate in-image text using Ideogram 3.0.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '1x1', options: ASPECT },
        { type: 'select', name: 'rendering_speed', label: 'Rendering speed', default: 'DEFAULT', options: RENDERING_SPEED },
        { type: 'select', name: 'style_type', label: 'Style', default: 'AUTO', options: STYLE_TYPE },
        { type: 'select', name: 'magic_prompt', label: 'Magic prompt', default: 'AUTO', options: MAGIC_PROMPT },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'number', name: 'num_images', label: 'Number of images', min: 1, max: 8, step: 1, default: 1 },
      ],
    },
  ],
};
