import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Black Forest Labs / FLUX (registry/config identifier `black-forest-labs`). Field names
// are native FLUX params — they ride straight into the request body. FLUX generation is
// submit+poll inside the adapter, so the image completes synchronously.
export const blackForestLabsDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://bfl.ai",
    "tagline": "The frontier lab for visual intelligence",
    "description": "Creators of the FLUX model family — a frontier image lab known for state-of-the-art photorealism, precise prompt control, and production-grade character and style consistency.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "FLUX.2 family: base, [max] quality, [klein] fast",
      "Production-grade character & style consistency",
      "Physically accurate lighting and realism",
      "Multi-image reference for style & object edits",
      "Trusted by Adobe, Microsoft, Mistral, Freepik"
    ]
  },
  provider: 'black-forest-labs',
  title: 'Black Forest Labs',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate a still image from a text prompt with FLUX.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'flux-pro-1.1',
          options: [
            { value: 'flux-pro-1.1', label: 'FLUX 1.1 Pro' },
            { value: 'flux-pro-1.1-ultra', label: 'FLUX 1.1 Pro Ultra' },
            { value: 'flux-pro', label: 'FLUX Pro' },
            { value: 'flux-dev', label: 'FLUX Dev' },
          ],
        },
        { type: 'number', name: 'width', label: 'Width', min: 256, max: 1440, step: 32, default: 1024 },
        { type: 'number', name: 'height', label: 'Height', min: 256, max: 1440, step: 32, default: 1024 },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio (Ultra)',
          default: '',
          help: 'Used by FLUX 1.1 Pro Ultra (width/height ignored for that model).',
          options: [
            { value: '', label: '—' },
            { value: '1:1', label: 'Square 1:1' },
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
            { value: '3:2', label: 'Photo 3:2' },
            { value: '2:3', label: 'Photo 2:3' },
            { value: '4:5', label: 'Social 4:5' },
            { value: '21:9', label: 'Wide 21:9' },
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
          ],
        },
        { type: 'toggle', name: 'prompt_upsampling', label: 'Prompt upsampling', default: false },
        { type: 'number', name: 'safety_tolerance', label: 'Safety tolerance (0–6)', min: 0, max: 6, step: 1, default: 2 },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
  ],
};
