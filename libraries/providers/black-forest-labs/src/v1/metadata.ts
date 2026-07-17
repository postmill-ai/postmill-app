import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "black-forest-labs",
  "displayName": "black-forest-labs",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "text-to-image"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-image": [
      {
        "id": "flux-pro-1.1",
        "label": "FLUX 1.1 Pro",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio (Ultra)",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "—"
              },
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
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Photo 2:3"
              },
              {
                "value": "4:5",
                "label": "Social 4:5"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              }
            ],
            "help": "Used by FLUX 1.1 Pro Ultra (width/height ignored for that model)."
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
              }
            ]
          },
          {
            "name": "prompt_upsampling",
            "type": "toggle",
            "label": "Prompt upsampling",
            "default": false
          },
          {
            "name": "safety_tolerance",
            "type": "number",
            "label": "Safety tolerance (0–6)",
            "default": 2,
            "min": 0,
            "max": 6,
            "step": 1
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "flux-pro-1.1-ultra",
        "label": "FLUX 1.1 Pro Ultra",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio (Ultra)",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "—"
              },
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
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Photo 2:3"
              },
              {
                "value": "4:5",
                "label": "Social 4:5"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              }
            ],
            "help": "Used by FLUX 1.1 Pro Ultra (width/height ignored for that model)."
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
              }
            ]
          },
          {
            "name": "prompt_upsampling",
            "type": "toggle",
            "label": "Prompt upsampling",
            "default": false
          },
          {
            "name": "safety_tolerance",
            "type": "number",
            "label": "Safety tolerance (0–6)",
            "default": 2,
            "min": 0,
            "max": 6,
            "step": 1
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "flux-pro",
        "label": "FLUX Pro",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio (Ultra)",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "—"
              },
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
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Photo 2:3"
              },
              {
                "value": "4:5",
                "label": "Social 4:5"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              }
            ],
            "help": "Used by FLUX 1.1 Pro Ultra (width/height ignored for that model)."
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
              }
            ]
          },
          {
            "name": "prompt_upsampling",
            "type": "toggle",
            "label": "Prompt upsampling",
            "default": false
          },
          {
            "name": "safety_tolerance",
            "type": "number",
            "label": "Safety tolerance (0–6)",
            "default": 2,
            "min": 0,
            "max": 6,
            "step": 1
          },
          {
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "flux-dev",
        "label": "FLUX Dev",
        "fields": [
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 256,
            "max": 1440,
            "step": 32
          },
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio (Ultra)",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "—"
              },
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
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Photo 2:3"
              },
              {
                "value": "4:5",
                "label": "Social 4:5"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              }
            ],
            "help": "Used by FLUX 1.1 Pro Ultra (width/height ignored for that model)."
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
              }
            ]
          },
          {
            "name": "prompt_upsampling",
            "type": "toggle",
            "label": "Prompt upsampling",
            "default": false
          },
          {
            "name": "safety_tolerance",
            "type": "number",
            "label": "Safety tolerance (0–6)",
            "default": 2,
            "min": 0,
            "max": 6,
            "step": 1
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
  "website": "https://bfl.ai",
  "description": {
    "en": "Creators of the FLUX model family — a frontier image lab known for state-of-the-art photorealism, precise prompt control, and production-grade character and style consistency."
  }
};
