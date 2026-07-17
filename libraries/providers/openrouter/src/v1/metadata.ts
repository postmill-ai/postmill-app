import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "openrouter",
  "displayName": "openrouter",
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
    "text-to-image"
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
  "mediaModels": {
    "text-to-image": [
      {
        "id": "openai/gpt-image-1",
        "label": "OpenAI gpt-image-1",
        "fields": [
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 10,
            "step": 1
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
            "options": [
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1K",
            "options": [
              {
                "value": "512",
                "label": "512"
              },
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "output_format",
            "type": "select",
            "label": "Format",
            "default": "png",
            "options": [
              {
                "value": "png",
                "label": "PNG"
              },
              {
                "value": "jpeg",
                "label": "JPEG"
              },
              {
                "value": "webp",
                "label": "WebP"
              }
            ]
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)",
            "min": 0,
            "max": 2147483647,
            "step": 1
          }
        ]
      },
      {
        "id": "black-forest-labs/flux.2-pro",
        "label": "FLUX.2 [pro]",
        "fields": [
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 10,
            "step": 1
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
            "options": [
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1K",
            "options": [
              {
                "value": "512",
                "label": "512"
              },
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "output_format",
            "type": "select",
            "label": "Format",
            "default": "png",
            "options": [
              {
                "value": "png",
                "label": "PNG"
              },
              {
                "value": "jpeg",
                "label": "JPEG"
              },
              {
                "value": "webp",
                "label": "WebP"
              }
            ]
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)",
            "min": 0,
            "max": 2147483647,
            "step": 1
          }
        ]
      },
      {
        "id": "google/gemini-2.5-flash-image",
        "label": "Gemini 2.5 Flash Image",
        "fields": [
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 10,
            "step": 1
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
            "options": [
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1K",
            "options": [
              {
                "value": "512",
                "label": "512"
              },
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "output_format",
            "type": "select",
            "label": "Format",
            "default": "png",
            "options": [
              {
                "value": "png",
                "label": "PNG"
              },
              {
                "value": "jpeg",
                "label": "JPEG"
              },
              {
                "value": "webp",
                "label": "WebP"
              }
            ]
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)",
            "min": 0,
            "max": 2147483647,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://openrouter.ai",
  "description": {
    "en": "A unified gateway to 400+ models from 70+ providers through a single OpenAI-compatible API — including a dedicated image API spanning 30+ models — with automatic failover."
  }
};
