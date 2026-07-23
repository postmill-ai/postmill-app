import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://z.ai",
  "description": {
    "en": "Maker of GLM — Z.AI's (Zhipu) frontier models with agentic reasoning, long context, and multimodal input, served through an OpenAI-compatible API."
  },
  "id": "zai",
  "displayName": "zai",
  "kind": "direct",
  "domains": [
    "ai"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow",
    "vision"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "glm-4.5-air",
      "glm-4.5-flash"
    ],
    "high-reasoning": [
      "glm-4.6",
      "glm-4.5",
      "glm-4-plus"
    ],
    "workflow": [
      "glm-4.6",
      "glm-4.5",
      "glm-4.5-air"
    ],
    "vision": [
      "glm-4.5v",
      "glm-4.6"
    ]
  },
  "mediaCategories": []
};
