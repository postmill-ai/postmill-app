import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://platform.openai.com/docs/api-reference/chat",
  "description": {
    "en": "Bring any OpenAI Chat Completions–compatible endpoint — hosted gateways, inference platforms, or your own deployment — by supplying its Base URL and API key."
  },
  "id": "openai-compatible",
  "displayName": "openai-compatible",
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
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [],
    "high-reasoning": [],
    "workflow": [],
    "vision": []
  },
  "mediaCategories": []
};
