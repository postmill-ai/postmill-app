import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "fireworks",
  "displayName": "fireworks",
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
    "text-to-image"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "llama-v3p1-8b",
      "llama-v3p2-3b"
    ],
    "high-reasoning": [
      "llama-v3p1-405b",
      "llama-v3p1-70b"
    ],
    "workflow": [
      "llama-v3p1-70b",
      "llama-v3p1-405b"
    ],
    "vision": [
      "llama-v3p2-11b-vision",
      "llama-v3p1-70b"
    ]
  },
  "mediaModels": {
    "text-to-image": [
      {
        "id": "flux-1-schnell-fp8",
        "label": "FLUX.1 [schnell] FP8",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
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
            "name": "guidance_scale",
            "type": "number",
            "label": "Guidance scale",
            "min": 0,
            "max": 20,
            "step": 0.5
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
        "id": "flux-1-dev-fp8",
        "label": "FLUX.1 [dev] FP8",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
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
            "name": "guidance_scale",
            "type": "number",
            "label": "Guidance scale",
            "min": 0,
            "max": 20,
            "step": 0.5
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
        "id": "stable-diffusion-xl-1024-v1-0",
        "label": "Stable Diffusion XL",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
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
            "name": "guidance_scale",
            "type": "number",
            "label": "Guidance scale",
            "min": 0,
            "max": 20,
            "step": 0.5
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
  "website": "https://fireworks.ai",
  "description": {
    "en": "A high-performance inference platform serving frontier open models — including FLUX image generation — at open-source economics, processing 30T+ tokens per day."
  }
};
