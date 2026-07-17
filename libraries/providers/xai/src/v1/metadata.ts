import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "xai",
  "displayName": "xai",
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
    "image-to-image",
    "text-to-image"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "grok-2",
      "grok-beta"
    ],
    "high-reasoning": [
      "grok-3",
      "grok-2"
    ],
    "workflow": [
      "grok-2",
      "grok-3"
    ],
    "vision": [
      "grok-2-vision",
      "grok-3-vision"
    ]
  },
  "mediaModels": {
    "text-to-image": [
      {
        "id": "grok-2-image-1212",
        "label": "Grok 2 Image",
        "fields": [
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 10,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://x.ai",
  "description": {
    "en": "xAI builds Grok, the AI assistant from Elon Musk's xAI with real-time knowledge of the world. Its image model (Aurora) renders photorealistic, prompt-faithful images directly from the same API key as the Grok chat models."
  }
};
