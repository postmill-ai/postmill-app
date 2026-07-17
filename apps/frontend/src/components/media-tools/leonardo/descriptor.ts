import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Leonardo.ai (registry/config identifier `leonardo`): own-key image generation. The API is async
// (create → poll), but the adapter polls internally to keep the synchronous image contract. The
// `model` select carries a Leonardo model UUID (→ `modelId`); width/height/num_images/negative_prompt
// are native params that ride into the request via `options.input`.
const MODELS = [
  { value: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', label: 'Leonardo Phoenix 1.0' },
  { value: '6b645e3a-d64f-4341-a6d8-7a3690fbf042', label: 'Leonardo Phoenix 0.9' },
  { value: 'b24e16ff-06e3-43eb-8d33-4416c2d75876', label: 'Leonardo Lightning XL' },
  { value: 'aa77f04e-3eec-4034-9c07-d0f619684628', label: 'Leonardo Kino XL' },
  { value: '5c232a9e-9061-4777-980a-ddc8e65647c6', label: 'Leonardo Vision XL' },
  { value: '1e60896f-3c26-4296-8ecc-53e2afecc132', label: 'Leonardo Diffusion XL' },
  { value: '2067ae52-33fd-4a82-bb92-c2c55e7d2786', label: 'AlbedoBase XL' },
];

export const leonardoDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://leonardo.ai",
    "tagline": "Generative AI for images and art",
    "description": "A creative platform powered by its foundational Phoenix model — known for high-resolution output, coherent text, and a Real-Time Canvas that turns sketches into polished art instantly.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "Foundational Phoenix model, native high-res output",
      "Real-Time Canvas: sketch to art instantly",
      "Strong prompt adherence and coherent text",
      "Inpainting, outpainting, and composite editing",
      "Custom fine-tuned and community models"
    ]
  },
  provider: 'leonardo',
  title: 'Leonardo.ai',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate images with Leonardo.ai across its fine-tuned model family.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', options: MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'number', name: 'width', label: 'Width', min: 512, max: 1536, step: 8, default: 1024 },
        { type: 'number', name: 'height', label: 'Height', min: 512, max: 1536, step: 8, default: 1024 },
        { type: 'number', name: 'num_images', label: 'Number of images', min: 1, max: 8, step: 1, default: 1 },
      ],
    },
  ],
};
