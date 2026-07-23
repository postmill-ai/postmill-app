import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://build.nvidia.com",
  "description": {
    "en": "Maker of Nemotron — NVIDIA's open models for agentic reasoning and tool calling, served through the hosted NIM catalog with an OpenAI-compatible API."
  },
  "id": "nvidia",
  "displayName": "nvidia",
  "kind": "direct",
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
      "nvidia/nemotron-nano-9b-v2",
      "nvidia/llama-3.1-nemotron-70b-instruct"
    ],
    "high-reasoning": [
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/llama-3.1-nemotron-ultra-253b-v1"
    ],
    "workflow": [
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "nvidia/nemotron-3-nano-30b-a3b"
    ]
  },
  "mediaCategories": []
};
