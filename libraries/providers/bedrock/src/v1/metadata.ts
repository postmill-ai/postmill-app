import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "bedrock",
  "displayName": "bedrock",
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
      "claude-haiku-4",
      "nova-lite",
      "claude-3-5-haiku"
    ],
    "high-reasoning": [
      "claude-sonnet-4",
      "nova-pro",
      "claude-3-7-sonnet"
    ],
    "workflow": [
      "claude-sonnet-4",
      "nova-pro",
      "claude-3-5-sonnet"
    ],
    "vision": [
      "claude-sonnet-4",
      "nova-pro",
      "claude-3-7-sonnet"
    ]
  },
  "mediaModels": {
    "text-to-image": [
      {
        "id": "amazon.nova-canvas-v1:0",
        "label": "Amazon Nova Canvas",
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
                "value": "1280x720",
                "label": "Landscape (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait (720×1280)"
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
        "id": "amazon.titan-image-generator-v2:0",
        "label": "Titan Image Generator v2",
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
                "value": "1280x720",
                "label": "Landscape (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait (720×1280)"
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
  "website": "https://aws.amazon.com/bedrock/",
  "description": {
    "en": "AWS's fully managed service for generative-AI apps and agents, offering foundation models from leading providers — including image generation via Amazon Nova, Titan, and Stability AI."
  }
};
