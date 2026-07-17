import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "higgsfield",
  "displayName": "higgsfield",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-image"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "soul",
        "label": "Higgsfield (Text → Image)",
        "fields": [
          {
            "name": "width_and_height",
            "type": "select",
            "label": "Size",
            "default": "2048x2048",
            "options": [
              {
                "value": "2048x2048",
                "label": "Square 2048×2048"
              },
              {
                "value": "1536x2752",
                "label": "Portrait 9:16"
              },
              {
                "value": "2752x1536",
                "label": "Landscape 16:9"
              },
              {
                "value": "1808x2336",
                "label": "Portrait 3:4"
              },
              {
                "value": "2336x1808",
                "label": "Landscape 4:3"
              }
            ]
          },
          {
            "name": "quality",
            "type": "select",
            "label": "Quality",
            "default": "1080p",
            "options": [
              {
                "value": "1080p",
                "label": "1080p"
              },
              {
                "value": "720p",
                "label": "720p"
              }
            ]
          },
          {
            "name": "batch_size",
            "type": "number",
            "label": "Images (1 or 4)",
            "default": 1,
            "min": 1,
            "max": 4
          },
          {
            "name": "enhance_prompt",
            "type": "toggle",
            "label": "Enhance prompt",
            "default": true,
            "help": "Let Higgsfield expand your prompt"
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "dop-standard",
        "label": "DoP Standard",
        "fields": [
          {
            "name": "enhance_prompt",
            "type": "toggle",
            "label": "Enhance prompt",
            "default": true,
            "help": "Let Higgsfield expand your prompt"
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "dop-turbo",
        "label": "DoP Turbo (fast)",
        "fields": [
          {
            "name": "enhance_prompt",
            "type": "toggle",
            "label": "Enhance prompt",
            "default": true,
            "help": "Let Higgsfield expand your prompt"
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "dop-lite",
        "label": "DoP Lite",
        "fields": [
          {
            "name": "enhance_prompt",
            "type": "toggle",
            "label": "Enhance prompt",
            "default": true,
            "help": "Let Higgsfield expand your prompt"
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      }
    ]
  },
  "website": "https://higgsfield.ai",
  "description": {
    "en": "An AI-native creative suite that generates images, videos, and voice from text or references — Soul for image, DoP for cinematic image-to-video, and Speak for talking-video."
  }
};
