import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "deepinfra",
  "displayName": "deepinfra",
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
    "text-to-music",
    "text-to-speech",
    "text-to-video"
  ],
  "hasModelList": true,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "black-forest-labs/FLUX-1-schnell",
        "label": "FLUX.1 [schnell]",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 64
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 64
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
        "id": "black-forest-labs/FLUX-1-dev",
        "label": "FLUX.1 [dev]",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 64
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 2048,
            "step": 64
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
        "id": "hexgrad/Kokoro-82M",
        "label": "Kokoro 82M",
        "fields": [
          {
            "name": "preset_voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. af_bella"
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "google/veo-3.1",
        "label": "Veo 3.1",
        "fields": []
      },
      {
        "id": "pixverse/pixverse-v6",
        "label": "PixVerse V6",
        "fields": []
      }
    ]
  },
  "website": "https://deepinfra.com",
  "description": {
    "en": "A developer-friendly inference hub serving 100+ models across text, image, video, and speech via simple APIs — pay-as-you-go on its own cost-optimized US infrastructure."
  }
};
