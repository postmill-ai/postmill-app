import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "vertex",
  "displayName": "vertex",
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
    "text-to-image",
    "text-to-video"
  ],
  "hasModelList": true,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "imagen-3.0-generate-002",
        "label": "Imagen 3",
        "fields": [
          {
            "name": "negativePrompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "aspectRatio",
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
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              }
            ]
          },
          {
            "name": "sampleCount",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "imagen-3.0-fast-generate-001",
        "label": "Imagen 3 Fast",
        "fields": [
          {
            "name": "negativePrompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "aspectRatio",
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
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              }
            ]
          },
          {
            "name": "sampleCount",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "veo-2.0-generate-001",
        "label": "Veo 2",
        "fields": [
          {
            "name": "negativePrompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "aspectRatio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
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
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 5,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "veo-3.0-generate-001",
        "label": "Veo 3",
        "fields": [
          {
            "name": "negativePrompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "aspectRatio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
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
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 5,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "veo-3.0-fast-generate-001",
        "label": "Veo 3 Fast",
        "fields": [
          {
            "name": "negativePrompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "aspectRatio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
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
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 5,
            "max": 8,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://cloud.google.com/vertex-ai",
  "description": {
    "en": "Google Cloud's unified AI platform for building and scaling generative apps — featuring Imagen for photorealistic images and Veo for high-quality text-to-video, with governance built in."
  }
};
