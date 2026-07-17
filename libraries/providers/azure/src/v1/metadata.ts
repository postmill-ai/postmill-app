import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "azure",
  "displayName": "azure",
  "kind": "hub",
  "domains": [
    "ai",
    "media"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow",
    "vision"
  ],
  "mediaCategories": [
    "image-focal-point",
    "image-slide",
    "text-to-image"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "gpt-4.1-mini",
      "gpt-4o-mini",
      "gpt-4.1"
    ],
    "high-reasoning": [
      "gpt-5",
      "o3",
      "o1"
    ],
    "workflow": [
      "gpt-5",
      "gpt-4.1",
      "gpt-4o"
    ],
    "vision": [
      "gpt-4.1",
      "gpt-4o",
      "gpt-4o-mini"
    ]
  },
  "mediaModels": {
    "text-to-image": [
      {
        "id": "dall-e-3",
        "label": "DALL·E 3",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square (1024×1024)"
              },
              {
                "value": "1792x1024",
                "label": "Landscape (1792×1024)"
              },
              {
                "value": "1024x1792",
                "label": "Portrait (1024×1792)"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "gpt-image-1",
        "label": "gpt-image-1",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square (1024×1024)"
              },
              {
                "value": "1792x1024",
                "label": "Landscape (1792×1024)"
              },
              {
                "value": "1024x1792",
                "label": "Portrait (1024×1792)"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
  "description": {
    "en": "Microsoft Azure's managed access to OpenAI models, including gpt-image generation — backed by Azure's enterprise security, regional deployment, and compliance controls."
  }
};
