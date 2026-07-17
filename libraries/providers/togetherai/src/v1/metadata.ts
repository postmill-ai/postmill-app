import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "togetherai",
  "displayName": "togetherai",
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
    "image-to-video",
    "text-to-image",
    "text-to-speech",
    "text-to-video"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "llama-3.1-8b",
      "llama-3.2-3b",
      "mixtral-8x7b"
    ],
    "high-reasoning": [
      "deepseek-r1",
      "llama-3.3-70b",
      "llama-3.1-70b"
    ],
    "workflow": [
      "llama-3.3-70b",
      "llama-3.1-70b",
      "llama-3.2-90b-vision"
    ],
    "vision": [
      "llama-3.2-11b-vision",
      "llama-3.2-90b-vision"
    ]
  },
  "mediaModels": {
    "text-to-image": [
      {
        "id": "black-forest-labs/FLUX.1-schnell",
        "label": "FLUX.1 [schnell]",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1,
            "help": "schnell renders in ~4 steps."
          },
          {
            "name": "n",
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
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1,
            "help": "schnell renders in ~4 steps."
          },
          {
            "name": "n",
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
        "id": "black-forest-labs/FLUX.1.1-pro",
        "label": "FLUX.1.1 [pro]",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1,
            "help": "schnell renders in ~4 steps."
          },
          {
            "name": "n",
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
        "id": "black-forest-labs/FLUX.2-pro",
        "label": "FLUX.2 [pro]",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 16
          },
          {
            "name": "steps",
            "type": "number",
            "label": "Steps",
            "min": 1,
            "max": 50,
            "step": 1,
            "help": "schnell renders in ~4 steps."
          },
          {
            "name": "n",
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
        "id": "cartesia/sonic-2",
        "label": "Cartesia Sonic 2",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. helpful woman"
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
        "id": "cartesia/sonic",
        "label": "Cartesia Sonic",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. helpful woman"
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
    ]
  },
  "website": "https://www.together.ai",
  "description": {
    "en": "A full-stack inference cloud serving 200+ open-source models through one API — chat, image, audio, and video — with optimized kernels for faster, cheaper generation at scale."
  }
};
