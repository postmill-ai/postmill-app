import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "gateway",
  "displayName": "gateway",
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
    "image-to-video",
    "text-to-image",
    "text-to-video"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "gpt-4.1-mini",
      "claude-haiku-4",
      "llama-3.1-8b"
    ],
    "high-reasoning": [
      "gpt-5",
      "claude-sonnet-4",
      "deepseek-r1"
    ],
    "workflow": [
      "gpt-5",
      "claude-sonnet-4",
      "llama-3.3-70b"
    ],
    "vision": [
      "gpt-4.1",
      "claude-sonnet-4",
      "llama-3.2-11b-vision"
    ]
  },
  "website": "https://vercel.com/ai-gateway",
  "description": {
    "en": "Vercel AI Gateway routes requests to hundreds of models across many providers through a single API — text, image, and video — with automatic failover and no platform markup."
  }
};
