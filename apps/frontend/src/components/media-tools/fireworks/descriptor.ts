import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Fireworks AI — image generation (FLUX / SDXL) via the workflow endpoint on the org's
// existing Fireworks LLM key (universal-credential reuse). The model id is the Fireworks
// model slug (curated list + free entry; Fireworks has no image-model catalog endpoint).
export const fireworksDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://fireworks.ai",
    "tagline": "The fastest inference for generative AI",
    "description": "A high-performance inference platform serving frontier open models — including FLUX image generation — at open-source economics, processing 30T+ tokens per day.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "FLUX and other image-generation models",
      "Industry-leading throughput and low latency",
      "30T+ tokens processed every day",
      "Frontier performance at open-model pricing",
      "Broad library of LLM, vision & image models"
    ]
  },
  provider: 'fireworks',
  title: 'Fireworks AI',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with FLUX or Stable Diffusion on Fireworks.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'flux-1-schnell-fp8',
          options: [
            { value: 'flux-1-schnell-fp8', label: 'FLUX.1 [schnell] FP8' },
            { value: 'flux-1-dev-fp8', label: 'FLUX.1 [dev] FP8' },
            { value: 'stable-diffusion-xl-1024-v1-0', label: 'Stable Diffusion XL' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '1:1', label: 'Square 1:1' },
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
          ],
        },
        { type: 'number', name: 'num_inference_steps', label: 'Steps', min: 1, max: 50, step: 1 },
        { type: 'number', name: 'guidance_scale', label: 'Guidance scale', min: 0, max: 20, step: 0.5 },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
  ],
};
