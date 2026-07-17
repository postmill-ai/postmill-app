import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "wan",
  "displayName": "wan",
  "kind": "direct",
  "domains": [
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
        "id": "wan2.2-t2i-flash",
        "label": "Wan 2.2 T2I Flash (fast)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*1280",
            "options": [
              {
                "value": "1280*1280",
                "label": "Square 1280×1280"
              },
              {
                "value": "1024*1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1440*810",
                "label": "Wide 1440×810"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
          }
        ]
      },
      {
        "id": "wan2.2-t2i-plus",
        "label": "Wan 2.2 T2I Plus (quality)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*1280",
            "options": [
              {
                "value": "1280*1280",
                "label": "Square 1280×1280"
              },
              {
                "value": "1024*1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1440*810",
                "label": "Wide 1440×810"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
          }
        ]
      },
      {
        "id": "wanx2.1-t2i-turbo",
        "label": "Wanx 2.1 T2I Turbo",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*1280",
            "options": [
              {
                "value": "1280*1280",
                "label": "Square 1280×1280"
              },
              {
                "value": "1024*1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1440*810",
                "label": "Wide 1440×810"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
          }
        ]
      },
      {
        "id": "wanx2.1-t2i-plus",
        "label": "Wanx 2.1 T2I Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*1280",
            "options": [
              {
                "value": "1280*1280",
                "label": "Square 1280×1280"
              },
              {
                "value": "1024*1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1440*810",
                "label": "Wide 1440×810"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
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
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "960*960",
                "label": "Square 960×960"
              },
              {
                "value": "1088*832",
                "label": "4:3 1088×832"
              },
              {
                "value": "832*1088",
                "label": "3:4 832×1088"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
          }
        ]
      },
      {
        "id": "wan2.1-t2v-turbo",
        "label": "Wan 2.1 T2V Turbo (fast)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "960*960",
                "label": "Square 960×960"
              },
              {
                "value": "1088*832",
                "label": "4:3 1088×832"
              },
              {
                "value": "832*1088",
                "label": "3:4 832×1088"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
          }
        ]
      },
      {
        "id": "wan2.1-t2v-plus",
        "label": "Wan 2.1 T2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1280*720",
            "options": [
              {
                "value": "1280*720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720*1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "960*960",
                "label": "Square 960×960"
              },
              {
                "value": "1088*832",
                "label": "4:3 1088×832"
              },
              {
                "value": "832*1088",
                "label": "3:4 832×1088"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          },
          {
            "name": "prompt_extend",
            "type": "toggle",
            "label": "Prompt rewrite",
            "default": true,
            "help": "Let the model expand your prompt"
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
            "placeholder": "What to avoid…"
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720P",
            "options": [
              {
                "value": "480P",
                "label": "480P"
              },
              {
                "value": "720P",
                "label": "720P"
              },
              {
                "value": "1080P",
                "label": "1080P"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          }
        ]
      },
      {
        "id": "wan2.2-i2v-flash",
        "label": "Wan 2.2 I2V Flash (fast)",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720P",
            "options": [
              {
                "value": "480P",
                "label": "480P"
              },
              {
                "value": "720P",
                "label": "720P"
              },
              {
                "value": "1080P",
                "label": "1080P"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          }
        ]
      },
      {
        "id": "wan2.5-i2v-preview",
        "label": "Wan 2.5 I2V Preview",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720P",
            "options": [
              {
                "value": "480P",
                "label": "480P"
              },
              {
                "value": "720P",
                "label": "720P"
              },
              {
                "value": "1080P",
                "label": "1080P"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          }
        ]
      },
      {
        "id": "wan2.1-i2v-turbo",
        "label": "Wan 2.1 I2V Turbo",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720P",
            "options": [
              {
                "value": "480P",
                "label": "480P"
              },
              {
                "value": "720P",
                "label": "720P"
              },
              {
                "value": "1080P",
                "label": "1080P"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          }
        ]
      },
      {
        "id": "wan2.1-i2v-plus",
        "label": "Wan 2.1 I2V Plus",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid…"
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720P",
            "options": [
              {
                "value": "480P",
                "label": "480P"
              },
              {
                "value": "720P",
                "label": "720P"
              },
              {
                "value": "1080P",
                "label": "1080P"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (s)",
            "default": 5,
            "min": 3,
            "max": 10
          }
        ]
      }
    ]
  },
  "website": "https://wan.video",
  "description": {
    "en": "Alibaba's Wan creative platform (Model Studio) lowers the barrier to content creation with the Wan2.x model family — spanning text-to-video, image-to-video, and text-to-image."
  }
};
