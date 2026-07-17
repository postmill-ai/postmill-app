import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Azure OpenAI — image generation (DALL·E / gpt-image deployments) delegated to the AI-SDK
// Azure provider on the org's existing Azure AI credentials (universal-credential reuse).
// The model id is your Azure deployment name.
export const azureDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    "tagline": "OpenAI image models with enterprise-grade Azure",
    "description": "Microsoft Azure's managed access to OpenAI models, including gpt-image generation — backed by Azure's enterprise security, regional deployment, and compliance controls.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "Image generation via OpenAI's gpt-image models",
      "Enterprise security with Entra ID & Key Vault",
      "50+ compliance certifications, global regions",
      "Your prompts and data never train the models",
      "Built-in content filtering and abuse monitoring"
    ]
  },
  provider: 'azure',
  title: 'Azure OpenAI',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with an Azure image deployment (DALL·E / gpt-image).',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Deployment',
          source: 'models',
          default: 'dall-e-3',
          options: [
            { value: 'dall-e-3', label: 'DALL·E 3' },
            { value: 'gpt-image-1', label: 'gpt-image-1' },
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
            { value: '1792x1024', label: 'Landscape (1792×1024)' },
            { value: '1024x1792', label: 'Portrait (1024×1792)' },
          ],
        },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
  ],
};
