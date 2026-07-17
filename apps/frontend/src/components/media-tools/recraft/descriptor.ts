import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Recraft (registry/config identifier `recraft`): own-key image generation — raster + vector/SVG,
// brand styles, icons. Synchronous (one POST → hosted URL). Field names are native Recraft params;
// `model` is lifted by the kit, the rest ride into the request body via `options.input`.
const MODELS = [
  { value: 'recraftv3', label: 'Recraft V3' },
  { value: 'recraftv2', label: 'Recraft V2' },
];
const STYLES = [
  { value: 'realistic_image', label: 'Realistic image' },
  { value: 'digital_illustration', label: 'Digital illustration' },
  { value: 'vector_illustration', label: 'Vector illustration' },
  { value: 'icon', label: 'Icon' },
];
const SIZES = [
  { value: '1024x1024', label: 'Square 1024×1024' },
  { value: '1365x1024', label: 'Landscape 1365×1024' },
  { value: '1024x1365', label: 'Portrait 1024×1365' },
  { value: '1536x1024', label: 'Landscape 1536×1024' },
  { value: '1024x1536', label: 'Portrait 1024×1536' },
  { value: '1280x1024', label: '1280×1024' },
  { value: '1024x1280', label: '1024×1280' },
  { value: '2048x1024', label: 'Wide 2048×1024' },
  { value: '1024x2048', label: 'Tall 1024×2048' },
];

export const recraftDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://www.recraft.ai",
    "tagline": "AI design tool with visual taste",
    "description": "A design-focused AI image platform best known for generating editable vector/SVG graphics alongside photoreal images, with reusable custom brand styles that need no training.",
    "badges": [
      "Image",
      "Vector"
    ],
    "highlights": [
      "Editable vector / SVG and icon generation",
      "Custom brand styles without any training",
      "Photoreal images with quality text rendering",
      "Mockups, upscaler, background remover, eraser",
      "Design-forward, production-ready outputs"
    ]
  },
  provider: 'recraft',
  title: 'Recraft',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate raster or vector images, brand styles, and icons with Recraft.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'recraftv3', options: MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'select', name: 'style', label: 'Style', default: 'realistic_image', options: STYLES },
        { type: 'select', name: 'size', label: 'Size', default: '1024x1024', options: SIZES },
        { type: 'number', name: 'n', label: 'Number of images', min: 1, max: 6, step: 1, default: 1 },
      ],
    },
  ],
};
