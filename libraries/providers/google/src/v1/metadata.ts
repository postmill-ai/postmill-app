import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://ai.google.dev",
  "description": {
    "en": "Google's Gemini models via the Gemini Developer API — multimodal AI for text, images, and video using your Google AI Studio key."
  },
  "id": "google",
  "displayName": "google",
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
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-2.5-flash"
    ],
    "high-reasoning": [
      "gemini-2.5-pro",
      "gemini-1.5-pro"
    ],
    "workflow": [
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-2.5-pro"
    ],
    "vision": [
      "gemini-2.5-pro",
      "gemini-2.0-flash-vision",
      "gemini-1.5-pro"
    ]
  }
};
