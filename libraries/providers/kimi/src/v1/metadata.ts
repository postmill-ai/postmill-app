import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://platform.moonshot.ai",
  "description": {
    "en": "Maker of Kimi — Moonshot AI's frontier models (Kimi K2) with long context windows, strong reasoning, and an OpenAI-compatible API."
  },
  "id": "kimi",
  "displayName": "kimi",
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
      "kimi-k2-turbo-preview",
      "moonshot-v1-8k",
      "moonshot-v1-32k"
    ],
    "high-reasoning": [
      "kimi-k2-thinking",
      "kimi-k2-0905-preview",
      "moonshot-v1-128k"
    ],
    "workflow": [
      "kimi-k2-0905-preview",
      "kimi-k2-turbo-preview",
      "kimi-latest"
    ],
    "vision": [
      "kimi-k2-0905-preview",
      "kimi-latest"
    ]
  },
  "mediaCategories": []
};
