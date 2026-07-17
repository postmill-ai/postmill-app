import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://www.deepseek.com",
  "description": {
    "en": "AI lab behind the DeepSeek open models, offering strong reasoning and coding performance at very low cost."
  },
  "id": "deepseek",
  "displayName": "deepseek",
  "kind": "hub",
  "domains": [
    "ai"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow",
    "vision"
  ],
  "mediaCategories": [
    "image-focal-point"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "deepseek-chat",
      "deepseek-v3"
    ],
    "high-reasoning": [
      "deepseek-reasoner",
      "deepseek-r1"
    ],
    "workflow": [
      "deepseek-chat",
      "deepseek-v3"
    ],
    "vision": [
      "deepseek-vl",
      "deepseek-v3"
    ]
  }
};
