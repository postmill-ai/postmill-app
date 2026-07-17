import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Amazon Bedrock — image generation (Titan / Nova Canvas) delegated to the AI-SDK Bedrock
// provider (SigV4 auth) on the org's existing Bedrock AI credentials (universal-credential
// reuse). Models are discovered from the AI Bedrock adapter's catalog.
export const bedrockDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://aws.amazon.com/bedrock/",
    "tagline": "Build generative AI at production scale on AWS",
    "description": "AWS's fully managed service for generative-AI apps and agents, offering foundation models from leading providers — including image generation via Amazon Nova, Titan, and Stability AI.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "Image gen via Nova, Titan & Stability (SDXL)",
      "One API across many foundation-model providers",
      "Enterprise security: HIPAA, FedRAMP High, GDPR",
      "Bedrock Guardrails block harmful content",
      "Your data is never used to train the models"
    ]
  },
  provider: 'bedrock',
  title: 'Amazon Bedrock',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with Amazon Titan / Nova Canvas.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'amazon.nova-canvas-v1:0',
          options: [
            { value: 'amazon.nova-canvas-v1:0', label: 'Amazon Nova Canvas' },
            { value: 'amazon.titan-image-generator-v2:0', label: 'Titan Image Generator v2' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'size',
          label: 'Size',
          default: '1024x1024',
          options: [
            { value: '1024x1024', label: 'Square (1024×1024)' },
            { value: '1280x720', label: 'Landscape (1280×720)' },
            { value: '720x1280', label: 'Portrait (720×1280)' },
          ],
        },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
  ],
};
