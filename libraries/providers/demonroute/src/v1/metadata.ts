import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://demonroute.com",
  "description": {
    "en": "Demon Route — OpenAI-compatible access to open-weight community models, including uncensored and persona fine-tunes."
  },
  "id": "demonroute",
  "displayName": "Demon Route",
  "kind": "hub",
  "domains": [
    "ai"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "NousResearch/Hermes-3-Llama-3.1-8B",
      "huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2"
    ],
    "high-reasoning": [
      "huihui-ai/Huihui-Qwen3.5-27B-abliterated",
      "knifeayumu/Cydonia-v4.1-MS3.2-Magnum-Diamond-24B"
    ],
    "workflow": [
      "dphn/Dolphin-Mistral-24B-Venice-Edition",
      "TheDrummer/Cydonia-24B-v4.2.0",
      "DavidAU/Rocinante-X-12B-v1-Heretic-Uncensored"
    ]
  },
  "mediaCategories": []
};
