import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "stability-ai",
  "displayName": "stability",
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
        "id": "core",
        "label": "Stable Image Core",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
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
                "value": "5:4",
                "label": "Social 5:4"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              },
              {
                "value": "9:21",
                "label": "Tall 9:21"
              }
            ]
          },
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt (optional)",
            "placeholder": "What to avoid…"
          },
          {
            "name": "style_preset",
            "type": "select",
            "label": "Style preset",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "None"
              },
              {
                "value": "photographic",
                "label": "Photographic"
              },
              {
                "value": "cinematic",
                "label": "Cinematic"
              },
              {
                "value": "digital-art",
                "label": "Digital art"
              },
              {
                "value": "anime",
                "label": "Anime"
              },
              {
                "value": "comic-book",
                "label": "Comic book"
              },
              {
                "value": "fantasy-art",
                "label": "Fantasy art"
              },
              {
                "value": "line-art",
                "label": "Line art"
              },
              {
                "value": "neon-punk",
                "label": "Neon punk"
              },
              {
                "value": "pixel-art",
                "label": "Pixel art"
              },
              {
                "value": "3d-model",
                "label": "3D model"
              },
              {
                "value": "analog-film",
                "label": "Analog film"
              },
              {
                "value": "low-poly",
                "label": "Low poly"
              },
              {
                "value": "origami",
                "label": "Origami"
              },
              {
                "value": "enhance",
                "label": "Enhance"
              }
            ],
            "help": "Supported by Core and Ultra."
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
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "ultra",
        "label": "Stable Image Ultra",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
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
                "value": "5:4",
                "label": "Social 5:4"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              },
              {
                "value": "9:21",
                "label": "Tall 9:21"
              }
            ]
          },
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt (optional)",
            "placeholder": "What to avoid…"
          },
          {
            "name": "style_preset",
            "type": "select",
            "label": "Style preset",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "None"
              },
              {
                "value": "photographic",
                "label": "Photographic"
              },
              {
                "value": "cinematic",
                "label": "Cinematic"
              },
              {
                "value": "digital-art",
                "label": "Digital art"
              },
              {
                "value": "anime",
                "label": "Anime"
              },
              {
                "value": "comic-book",
                "label": "Comic book"
              },
              {
                "value": "fantasy-art",
                "label": "Fantasy art"
              },
              {
                "value": "line-art",
                "label": "Line art"
              },
              {
                "value": "neon-punk",
                "label": "Neon punk"
              },
              {
                "value": "pixel-art",
                "label": "Pixel art"
              },
              {
                "value": "3d-model",
                "label": "3D model"
              },
              {
                "value": "analog-film",
                "label": "Analog film"
              },
              {
                "value": "low-poly",
                "label": "Low poly"
              },
              {
                "value": "origami",
                "label": "Origami"
              },
              {
                "value": "enhance",
                "label": "Enhance"
              }
            ],
            "help": "Supported by Core and Ultra."
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
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      },
      {
        "id": "sd3",
        "label": "Stable Diffusion 3",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "1:1",
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
                "value": "5:4",
                "label": "Social 5:4"
              },
              {
                "value": "21:9",
                "label": "Wide 21:9"
              },
              {
                "value": "9:21",
                "label": "Tall 9:21"
              }
            ]
          },
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt (optional)",
            "placeholder": "What to avoid…"
          },
          {
            "name": "style_preset",
            "type": "select",
            "label": "Style preset",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "None"
              },
              {
                "value": "photographic",
                "label": "Photographic"
              },
              {
                "value": "cinematic",
                "label": "Cinematic"
              },
              {
                "value": "digital-art",
                "label": "Digital art"
              },
              {
                "value": "anime",
                "label": "Anime"
              },
              {
                "value": "comic-book",
                "label": "Comic book"
              },
              {
                "value": "fantasy-art",
                "label": "Fantasy art"
              },
              {
                "value": "line-art",
                "label": "Line art"
              },
              {
                "value": "neon-punk",
                "label": "Neon punk"
              },
              {
                "value": "pixel-art",
                "label": "Pixel art"
              },
              {
                "value": "3d-model",
                "label": "3D model"
              },
              {
                "value": "analog-film",
                "label": "Analog film"
              },
              {
                "value": "low-poly",
                "label": "Low poly"
              },
              {
                "value": "origami",
                "label": "Origami"
              },
              {
                "value": "enhance",
                "label": "Enhance"
              }
            ],
            "help": "Supported by Core and Ultra."
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
            "name": "seed",
            "type": "number",
            "label": "Seed (optional)"
          }
        ]
      }
    ]
  },
  "website": "https://stability.ai",
  "description": {
    "en": "The company behind Stable Diffusion and the Stable Image models, offering open, enterprise-grade generative media for image creation and editing with full creative control."
  }
};
