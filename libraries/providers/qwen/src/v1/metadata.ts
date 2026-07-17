import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "qwen",
  "displayName": "qwen",
  "kind": "direct",
  "domains": [
    "ai",
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-image",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "qwen-image-plus",
        "label": "Qwen-Image Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1328*1328",
            "options": [
              {
                "value": "1328*1328",
                "label": "Square 1:1 (1328×1328)"
              },
              {
                "value": "1664*928",
                "label": "Landscape 16:9 (1664×928)"
              },
              {
                "value": "928*1664",
                "label": "Portrait 9:16 (928×1664)"
              },
              {
                "value": "1472*1140",
                "label": "Photo 4:3 (1472×1140)"
              },
              {
                "value": "1140*1472",
                "label": "Photo 3:4 (1140×1472)"
              }
            ]
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true,
            "help": "Let Qwen enrich short prompts"
          },
          {
            "name": "watermark",
            "type": "toggle",
            "label": "Watermark",
            "default": false
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
        "id": "qwen-image",
        "label": "Qwen-Image",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1328*1328",
            "options": [
              {
                "value": "1328*1328",
                "label": "Square 1:1 (1328×1328)"
              },
              {
                "value": "1664*928",
                "label": "Landscape 16:9 (1664×928)"
              },
              {
                "value": "928*1664",
                "label": "Portrait 9:16 (928×1664)"
              },
              {
                "value": "1472*1140",
                "label": "Photo 4:3 (1472×1140)"
              },
              {
                "value": "1140*1472",
                "label": "Photo 3:4 (1140×1472)"
              }
            ]
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true,
            "help": "Let Qwen enrich short prompts"
          },
          {
            "name": "watermark",
            "type": "toggle",
            "label": "Watermark",
            "default": false
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
    ],
    "text-to-video": [
      {
        "id": "wan2.2-t2v-plus",
        "label": "Wan 2.2 T2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960*960",
                "label": "Square (960×960)"
              },
              {
                "value": "1920*1080",
                "label": "Landscape 1080p (1920×1080)"
              },
              {
                "value": "1080*1920",
                "label": "Portrait 1080p (1080×1920)"
              }
            ],
            "help": "1080p variants require a Plus model."
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10,
            "step": 1,
            "help": "Most Wan models render 5s."
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      },
      {
        "id": "wanx2.1-t2v-turbo",
        "label": "Wan 2.1 T2V Turbo (fast)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960*960",
                "label": "Square (960×960)"
              },
              {
                "value": "1920*1080",
                "label": "Landscape 1080p (1920×1080)"
              },
              {
                "value": "1080*1920",
                "label": "Portrait 1080p (1080×1920)"
              }
            ],
            "help": "1080p variants require a Plus model."
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10,
            "step": 1,
            "help": "Most Wan models render 5s."
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      },
      {
        "id": "wanx2.1-t2v-plus",
        "label": "Wan 2.1 T2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960*960",
                "label": "Square (960×960)"
              },
              {
                "value": "1920*1080",
                "label": "Landscape 1080p (1920×1080)"
              },
              {
                "value": "1080*1920",
                "label": "Portrait 1080p (1080×1920)"
              }
            ],
            "help": "1080p variants require a Plus model."
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10,
            "step": 1,
            "help": "Most Wan models render 5s."
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "wan2.2-i2v-plus",
        "label": "Wan 2.2 I2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      },
      {
        "id": "wanx2.1-i2v-turbo",
        "label": "Wan 2.1 I2V Turbo (fast)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      },
      {
        "id": "wanx2.1-i2v-plus",
        "label": "Wan 2.1 I2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt extend",
            "default": true
          }
        ]
      }
    ]
  },
  "website": "https://qwen.ai",
  "description": {
    "en": "Alibaba's Qwen family, served via DashScope / Model Studio — Qwen-Image generates native 2K images from long prompts, and Wan delivers text-to-video and image-to-video."
  }
};
