import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://www.perplexity.ai",
  "description": {
    "en": "AI answer engine; its Sonar API returns up-to-date, web-grounded responses with citations."
  },
  "id": "perplexity",
  "displayName": "perplexity",
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
      "sonar"
    ],
    "high-reasoning": [
      "sonar-reasoning",
      "sonar-deep-research"
    ],
    "workflow": [
      "sonar-pro",
      "sonar"
    ],
    "vision": [
      "sonar-vision",
      "sonar-pro"
    ]
  }
};
