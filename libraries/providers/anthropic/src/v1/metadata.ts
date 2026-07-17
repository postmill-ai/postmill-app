import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://www.anthropic.com",
  "description": {
    "en": "Maker of Claude — a family of frontier AI models known for strong reasoning, long context windows, and reliable, safe responses."
  },
  "id": "anthropic",
  "displayName": "anthropic",
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
      "claude-haiku-4",
      "claude-3-5-haiku",
      "claude-3-haiku"
    ],
    "high-reasoning": [
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-sonnet"
    ],
    "workflow": [
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-sonnet"
    ],
    "vision": [
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-sonnet"
    ]
  },
  "mediaCategories": []
};
