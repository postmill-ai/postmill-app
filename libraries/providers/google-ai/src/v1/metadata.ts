import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "google",
  "displayName": "google-ai",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "text-to-image",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "gemini-2.5-flash-image",
        "label": "Nano Banana (Gemini 2.5 Flash Image)",
        "fields": [
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
            "label": "Number of images (Imagen only)",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "imagen-4.0-generate-001",
        "label": "Imagen 4",
        "fields": [
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
            "label": "Number of images (Imagen only)",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "imagen-4.0-ultra-generate-001",
        "label": "Imagen 4 Ultra",
        "fields": [
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
            "label": "Number of images (Imagen only)",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "imagen-4.0-fast-generate-001",
        "label": "Imagen 4 Fast",
        "fields": [
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
            "label": "Number of images (Imagen only)",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
          }
        ]
      },
      {
        "id": "imagen-3.0-generate-002",
        "label": "Imagen 3",
        "fields": [
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
            "label": "Number of images (Imagen only)",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 4,
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "veo-3.1-generate-preview",
        "label": "Veo 3.1 (Preview)",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "veo-3.1-fast-generate-preview",
        "label": "Veo 3.1 Fast (Preview)",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 1
          }
        ]
      },
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "durationSeconds",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://aistudio.google.com",
  "description": {
    "en": "Google's Gemini Developer API for media generation — spanning Nano Banana and Imagen image models plus Veo video, all driven by a single Gemini API key."
  }
};
