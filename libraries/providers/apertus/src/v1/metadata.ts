import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://publicai.co",
  "description": {
    "en": "Apertus — the fully open, multilingual LLM from the Swiss AI Initiative (ETH Zurich / EPFL / CSCS), served via the Public AI Inference Utility with a 65k context window."
  },
  "id": "apertus",
  "displayName": "apertus",
  "kind": "direct",
  "domains": [
    "ai"
  ],
  "modelCategories": [
    "low-reasoning",
    "workflow"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "swiss-ai/apertus-8b-instruct"
    ],
    "workflow": [
      "swiss-ai/apertus-70b-instruct",
      "swiss-ai/apertus-8b-instruct"
    ]
  },
  "mediaCategories": []
};
