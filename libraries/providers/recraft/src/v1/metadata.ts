import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "recraft",
  "displayName": "recraft",
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
        "id": "recraftv3",
        "label": "Recraft V3",
        "fields": [
          {
            "name": "style",
            "type": "select",
            "label": "Style",
            "default": "realistic_image",
            "options": [
              {
                "value": "realistic_image",
                "label": "Realistic image"
              },
              {
                "value": "digital_illustration",
                "label": "Digital illustration"
              },
              {
                "value": "vector_illustration",
                "label": "Vector illustration"
              },
              {
                "value": "icon",
                "label": "Icon"
              }
            ]
          },
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
                "value": "1365x1024",
                "label": "Landscape 1365×1024"
              },
              {
                "value": "1024x1365",
                "label": "Portrait 1024×1365"
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
                "value": "1280x1024",
                "label": "1280×1024"
              },
              {
                "value": "1024x1280",
                "label": "1024×1280"
              },
              {
                "value": "2048x1024",
                "label": "Wide 2048×1024"
              },
              {
                "value": "1024x2048",
                "label": "Tall 1024×2048"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 6,
            "step": 1
          }
        ]
      },
      {
        "id": "recraftv2",
        "label": "Recraft V2",
        "fields": [
          {
            "name": "style",
            "type": "select",
            "label": "Style",
            "default": "realistic_image",
            "options": [
              {
                "value": "realistic_image",
                "label": "Realistic image"
              },
              {
                "value": "digital_illustration",
                "label": "Digital illustration"
              },
              {
                "value": "vector_illustration",
                "label": "Vector illustration"
              },
              {
                "value": "icon",
                "label": "Icon"
              }
            ]
          },
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
                "value": "1365x1024",
                "label": "Landscape 1365×1024"
              },
              {
                "value": "1024x1365",
                "label": "Portrait 1024×1365"
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
                "value": "1280x1024",
                "label": "1280×1024"
              },
              {
                "value": "1024x1280",
                "label": "1024×1280"
              },
              {
                "value": "2048x1024",
                "label": "Wide 2048×1024"
              },
              {
                "value": "1024x2048",
                "label": "Tall 1024×2048"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 6,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://www.recraft.ai",
  "description": {
    "en": "A design-focused AI image platform best known for generating editable vector/SVG graphics alongside photoreal images, with reusable custom brand styles that need no training."
  }
};
