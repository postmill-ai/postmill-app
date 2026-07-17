import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "fal",
  "displayName": "fal",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-video": [
      {
        "id": "fal-ai/kling-video/v1.6/standard/text-to-video",
        "label": "Kling 1.6 Standard",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "aspect_ratio",
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
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/kling-video/v1.6/pro/text-to-video",
        "label": "Kling 1.6 Pro",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "aspect_ratio",
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
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/kling-video/v2/master/text-to-video",
        "label": "Kling 2.0 Master",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "aspect_ratio",
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
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/pika/v2.2/text-to-video",
        "label": "Pika (Text → Video)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "ugly, bad, terrible"
          },
          {
            "name": "aspect_ratio",
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
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:5",
                "label": "Portrait 4:5"
              },
              {
                "value": "5:4",
                "label": "Landscape 5:4"
              },
              {
                "value": "3:2",
                "label": "Landscape 3:2"
              },
              {
                "value": "2:3",
                "label": "Portrait 2:3"
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
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
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
        "id": "fal-ai/kling-video/v1.6/standard/image-to-video",
        "label": "Kling 1.6 Standard",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/kling-video/v1.6/pro/image-to-video",
        "label": "Kling 1.6 Pro",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/kling-video/v2/master/image-to-video",
        "label": "Kling 2.0 Master",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.1
          }
        ]
      },
      {
        "id": "fal-ai/pika/v2.2/image-to-video",
        "label": "Pika (Image → Video)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt"
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
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
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
  "website": "https://klingai.com",
  "description": {
    "en": "A leading video generator by Kuaishou, known for long, cinematic clips with strong realism and physics. Recent models add native audio, voiceovers, and sound in a single pass."
  }
};
