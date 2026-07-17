import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "siliconflow",
  "displayName": "siliconflow",
  "kind": "hub",
  "domains": [
    "ai",
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-image",
    "image-to-video",
    "text-to-image",
    "text-to-speech",
    "text-to-video"
  ],
  "hasModelList": true,
  "mediaModels": {
    "image-to-video": [
      {
        "id": "Wan-AI/Wan2.2-I2V-A14B",
        "label": "Wan 2.2 I2V A14B",
        "fields": [
          {
            "name": "image_size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960x960",
                "label": "Square (960×960)"
              }
            ]
          }
        ]
      },
      {
        "id": "Wan-AI/Wan2.1-I2V-14B-720P-Turbo",
        "label": "Wan 2.1 I2V Turbo",
        "fields": [
          {
            "name": "image_size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960x960",
                "label": "Square (960×960)"
              }
            ]
          }
        ]
      }
    ],
    "text-to-image": [
      {
        "id": "black-forest-labs/FLUX.1-schnell",
        "label": "FLUX.1 [schnell]",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "image_size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square (1024×1024)"
              },
              {
                "value": "1024x576",
                "label": "Landscape 16:9 (1024×576)"
              },
              {
                "value": "576x1024",
                "label": "Portrait 9:16 (576×1024)"
              }
            ]
          },
          {
            "name": "num_inference_steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1
          },
          {
            "name": "batch_size",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
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
        "id": "black-forest-labs/FLUX.1-dev",
        "label": "FLUX.1 [dev]",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "image_size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square (1024×1024)"
              },
              {
                "value": "1024x576",
                "label": "Landscape 16:9 (1024×576)"
              },
              {
                "value": "576x1024",
                "label": "Portrait 9:16 (576×1024)"
              }
            ]
          },
          {
            "name": "num_inference_steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1
          },
          {
            "name": "batch_size",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
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
        "id": "Qwen/Qwen-Image",
        "label": "Qwen-Image",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "image_size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square (1024×1024)"
              },
              {
                "value": "1024x576",
                "label": "Landscape 16:9 (1024×576)"
              },
              {
                "value": "576x1024",
                "label": "Portrait 9:16 (576×1024)"
              }
            ]
          },
          {
            "name": "num_inference_steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1
          },
          {
            "name": "batch_size",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 4,
            "step": 1
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
    "text-to-speech": [
      {
        "id": "fishaudio/fish-speech-1.5",
        "label": "Fish-Speech 1.5",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. fishaudio/fish-speech-1.5:alex"
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Format",
            "default": "mp3",
            "options": [
              {
                "value": "mp3",
                "label": "MP3"
              },
              {
                "value": "wav",
                "label": "WAV"
              }
            ]
          }
        ]
      },
      {
        "id": "FunAudioLLM/CosyVoice2-0.5B",
        "label": "CosyVoice2 0.5B",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. fishaudio/fish-speech-1.5:alex"
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Format",
            "default": "mp3",
            "options": [
              {
                "value": "mp3",
                "label": "MP3"
              },
              {
                "value": "wav",
                "label": "WAV"
              }
            ]
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "Wan-AI/Wan2.2-T2V-A14B",
        "label": "Wan 2.2 T2V A14B",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "image_size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960x960",
                "label": "Square (960×960)"
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
        "id": "Wan-AI/Wan2.1-T2V-14B-720P-Turbo",
        "label": "Wan 2.1 T2V Turbo",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "image_size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 720p (1280×720)"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720p (720×1280)"
              },
              {
                "value": "960x960",
                "label": "Square (960×960)"
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
  "website": "https://siliconflow.com",
  "description": {
    "en": "A lightning-fast inference platform serving 200+ open and commercial models — LLMs plus image, video, and audio — through a single OpenAI-compatible API with predictable pricing."
  }
};
