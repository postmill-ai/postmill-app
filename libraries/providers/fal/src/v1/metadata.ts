import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "fal",
  "displayName": "fal.ai",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-image",
    "text-to-music",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "fal-ai/flux/schnell",
        "label": "fal.ai (Text → Image)",
        "fields": [
          {
            "name": "image_size",
            "type": "select",
            "label": "Image size",
            "default": "landscape_4_3",
            "options": [
              {
                "value": "square_hd",
                "label": "Square HD"
              },
              {
                "value": "square",
                "label": "Square"
              },
              {
                "value": "portrait_4_3",
                "label": "Portrait 4:3"
              },
              {
                "value": "portrait_16_9",
                "label": "Portrait 16:9"
              },
              {
                "value": "landscape_4_3",
                "label": "Landscape 4:3"
              },
              {
                "value": "landscape_16_9",
                "label": "Landscape 16:9"
              }
            ]
          },
          {
            "name": "num_inference_steps",
            "type": "number",
            "label": "Inference steps",
            "default": 4,
            "min": 1,
            "max": 12,
            "step": 1
          },
          {
            "name": "output_format",
            "type": "select",
            "label": "Output format",
            "default": "jpeg",
            "options": [
              {
                "value": "jpeg",
                "label": "JPEG"
              },
              {
                "value": "png",
                "label": "PNG"
              }
            ]
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          },
          {
            "name": "enable_safety_checker",
            "type": "toggle",
            "label": "Safety checker",
            "default": true
          }
        ]
      }
    ],
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
        "label": "Pika Text → Video",
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
        "label": "Pika Image → Video",
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
    ],
    "text-to-music": [
      {
        "id": "fal-ai/stable-audio",
        "label": "fal.ai (Text → Music)",
        "fields": [
          {
            "name": "seconds_total",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 30,
            "min": 1,
            "max": 47,
            "step": 1
          },
          {
            "name": "cfg_scale",
            "type": "number",
            "label": "CFG scale",
            "default": 7,
            "min": 1,
            "max": 20,
            "step": 0.5
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
  "website": "https://fal.ai",
  "description": {
    "en": "Generate images, video, music, and audio with fal.ai. This studio includes FLUX, Stable Audio, fal-hosted Kling, and Pika using your configured fal.ai API key."
  }
};
