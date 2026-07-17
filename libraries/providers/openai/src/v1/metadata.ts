import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "openai",
  "displayName": "OpenAI",
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
    "image-to-video",
    "text-to-image",
    "text-to-speech",
    "text-to-video",
    "video-caption"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o-mini",
      "gpt-4.1"
    ],
    "high-reasoning": [
      "gpt-5",
      "o3",
      "o1"
    ],
    "workflow": [
      "gpt-5",
      "gpt-4.1",
      "gpt-4o"
    ],
    "vision": [
      "gpt-4.1",
      "gpt-4o",
      "gpt-4o-mini"
    ]
  },
  "mediaModels": {
    "image-to-video": [
      {
        "id": "sora-2",
        "label": "Sora 2",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1920x1080",
                "label": "Landscape 1920×1080 (Pro)"
              },
              {
                "value": "1080x1920",
                "label": "Portrait 1080×1920 (Pro)"
              }
            ]
          },
          {
            "name": "seconds",
            "type": "select",
            "label": "Duration",
            "default": "8",
            "options": [
              {
                "value": "4",
                "label": "4 seconds"
              },
              {
                "value": "8",
                "label": "8 seconds"
              },
              {
                "value": "12",
                "label": "12 seconds"
              }
            ]
          }
        ]
      },
      {
        "id": "sora-2-pro",
        "label": "Sora 2 Pro",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1920x1080",
                "label": "Landscape 1920×1080 (Pro)"
              },
              {
                "value": "1080x1920",
                "label": "Portrait 1080×1920 (Pro)"
              }
            ]
          },
          {
            "name": "seconds",
            "type": "select",
            "label": "Duration",
            "default": "8",
            "options": [
              {
                "value": "4",
                "label": "4 seconds"
              },
              {
                "value": "8",
                "label": "8 seconds"
              },
              {
                "value": "12",
                "label": "12 seconds"
              }
            ]
          }
        ]
      }
    ],
    "text-to-image": [
      {
        "id": "gpt-image-1",
        "label": "GPT Image",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1536x1024",
                "label": "Landscape 1536×1024"
              },
              {
                "value": "1024x1536",
                "label": "Portrait 1024×1536"
              },
              {
                "value": "auto",
                "label": "Auto"
              }
            ]
          },
          {
            "name": "quality",
            "type": "select",
            "label": "Quality",
            "default": "auto",
            "options": [
              {
                "value": "auto",
                "label": "Auto"
              },
              {
                "value": "high",
                "label": "High"
              },
              {
                "value": "medium",
                "label": "Medium"
              },
              {
                "value": "low",
                "label": "Low"
              }
            ]
          },
          {
            "name": "background",
            "type": "select",
            "label": "Background",
            "default": "auto",
            "options": [
              {
                "value": "auto",
                "label": "Auto"
              },
              {
                "value": "transparent",
                "label": "Transparent"
              },
              {
                "value": "opaque",
                "label": "Opaque"
              }
            ],
            "help": "Transparent requires PNG or WebP output."
          },
          {
            "name": "output_format",
            "type": "select",
            "label": "Output format",
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
            "name": "n",
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
        "id": "dall-e-3",
        "label": "DALL·E 3",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Size",
            "default": "1024x1024",
            "options": [
              {
                "value": "1024x1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1792x1024",
                "label": "Landscape 1792×1024"
              },
              {
                "value": "1024x1792",
                "label": "Portrait 1024×1792"
              }
            ]
          },
          {
            "name": "quality",
            "type": "select",
            "label": "Quality",
            "default": "standard",
            "options": [
              {
                "value": "standard",
                "label": "Standard"
              },
              {
                "value": "hd",
                "label": "HD"
              }
            ]
          },
          {
            "name": "style",
            "type": "select",
            "label": "Style",
            "default": "vivid",
            "options": [
              {
                "value": "vivid",
                "label": "Vivid"
              },
              {
                "value": "natural",
                "label": "Natural"
              }
            ]
          }
        ]
      }
    ],
    "text-to-speech": [
      {
        "id": "gpt-4o-mini-tts",
        "label": "GPT-4o mini TTS (latest)",
        "fields": [
          {
            "name": "voice",
            "type": "select",
            "label": "Voice",
            "default": "alloy",
            "options": [
              {
                "value": "alloy",
                "label": "Alloy"
              },
              {
                "value": "ash",
                "label": "Ash"
              },
              {
                "value": "ballad",
                "label": "Ballad"
              },
              {
                "value": "coral",
                "label": "Coral"
              },
              {
                "value": "echo",
                "label": "Echo"
              },
              {
                "value": "fable",
                "label": "Fable"
              },
              {
                "value": "nova",
                "label": "Nova"
              },
              {
                "value": "onyx",
                "label": "Onyx"
              },
              {
                "value": "sage",
                "label": "Sage"
              },
              {
                "value": "shimmer",
                "label": "Shimmer"
              }
            ]
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Output format",
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
          },
          {
            "name": "speed",
            "type": "number",
            "label": "Speed",
            "default": 1,
            "min": 0.25,
            "max": 4,
            "step": 0.05
          }
        ]
      },
      {
        "id": "tts-1",
        "label": "TTS-1 (fast)",
        "fields": [
          {
            "name": "voice",
            "type": "select",
            "label": "Voice",
            "default": "alloy",
            "options": [
              {
                "value": "alloy",
                "label": "Alloy"
              },
              {
                "value": "ash",
                "label": "Ash"
              },
              {
                "value": "ballad",
                "label": "Ballad"
              },
              {
                "value": "coral",
                "label": "Coral"
              },
              {
                "value": "echo",
                "label": "Echo"
              },
              {
                "value": "fable",
                "label": "Fable"
              },
              {
                "value": "nova",
                "label": "Nova"
              },
              {
                "value": "onyx",
                "label": "Onyx"
              },
              {
                "value": "sage",
                "label": "Sage"
              },
              {
                "value": "shimmer",
                "label": "Shimmer"
              }
            ]
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Output format",
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
          },
          {
            "name": "speed",
            "type": "number",
            "label": "Speed",
            "default": 1,
            "min": 0.25,
            "max": 4,
            "step": 0.05
          }
        ]
      },
      {
        "id": "tts-1-hd",
        "label": "TTS-1 HD (quality)",
        "fields": [
          {
            "name": "voice",
            "type": "select",
            "label": "Voice",
            "default": "alloy",
            "options": [
              {
                "value": "alloy",
                "label": "Alloy"
              },
              {
                "value": "ash",
                "label": "Ash"
              },
              {
                "value": "ballad",
                "label": "Ballad"
              },
              {
                "value": "coral",
                "label": "Coral"
              },
              {
                "value": "echo",
                "label": "Echo"
              },
              {
                "value": "fable",
                "label": "Fable"
              },
              {
                "value": "nova",
                "label": "Nova"
              },
              {
                "value": "onyx",
                "label": "Onyx"
              },
              {
                "value": "sage",
                "label": "Sage"
              },
              {
                "value": "shimmer",
                "label": "Shimmer"
              }
            ]
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Output format",
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
          },
          {
            "name": "speed",
            "type": "number",
            "label": "Speed",
            "default": 1,
            "min": 0.25,
            "max": 4,
            "step": 0.05
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "sora-2",
        "label": "Sora 2",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1920x1080",
                "label": "Landscape 1920×1080 (Pro)"
              },
              {
                "value": "1080x1920",
                "label": "Portrait 1080×1920 (Pro)"
              }
            ]
          },
          {
            "name": "seconds",
            "type": "select",
            "label": "Duration",
            "default": "8",
            "options": [
              {
                "value": "4",
                "label": "4 seconds"
              },
              {
                "value": "8",
                "label": "8 seconds"
              },
              {
                "value": "12",
                "label": "12 seconds"
              }
            ]
          }
        ]
      },
      {
        "id": "sora-2-pro",
        "label": "Sora 2 Pro",
        "fields": [
          {
            "name": "size",
            "type": "select",
            "label": "Resolution",
            "default": "1280x720",
            "options": [
              {
                "value": "1280x720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720x1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "1920x1080",
                "label": "Landscape 1920×1080 (Pro)"
              },
              {
                "value": "1080x1920",
                "label": "Portrait 1080×1920 (Pro)"
              }
            ]
          },
          {
            "name": "seconds",
            "type": "select",
            "label": "Duration",
            "default": "8",
            "options": [
              {
                "value": "4",
                "label": "4 seconds"
              },
              {
                "value": "8",
                "label": "8 seconds"
              },
              {
                "value": "12",
                "label": "12 seconds"
              }
            ]
          }
        ]
      }
    ]
  },
  "website": "https://openai.com",
  "description": {
    "en": "OpenAI's image generation via gpt-image-1 — the natively multimodal model behind ChatGPT — delivering versatile styles, strong world knowledge, accurate text, and prompt-driven edits."
  }
};
