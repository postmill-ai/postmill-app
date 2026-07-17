import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "leonardo",
  "displayName": "leonardo",
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
        "id": "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
        "label": "Leonardo Phoenix 1.0",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "6b645e3a-d64f-4341-a6d8-7a3690fbf042",
        "label": "Leonardo Phoenix 0.9",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "b24e16ff-06e3-43eb-8d33-4416c2d75876",
        "label": "Leonardo Lightning XL",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "aa77f04e-3eec-4034-9c07-d0f619684628",
        "label": "Leonardo Kino XL",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "5c232a9e-9061-4777-980a-ddc8e65647c6",
        "label": "Leonardo Vision XL",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "1e60896f-3c26-4296-8ecc-53e2afecc132",
        "label": "Leonardo Diffusion XL",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      },
      {
        "id": "2067ae52-33fd-4a82-bb92-c2c55e7d2786",
        "label": "AlbedoBase XL",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
          {
            "name": "width",
            "type": "number",
            "label": "Width",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "height",
            "type": "number",
            "label": "Height",
            "default": 1024,
            "min": 512,
            "max": 1536,
            "step": 8
          },
          {
            "name": "num_images",
            "type": "number",
            "label": "Number of images",
            "default": 1,
            "min": 1,
            "max": 8,
            "step": 1
          }
        ]
      }
    ]
  },
  "website": "https://leonardo.ai",
  "description": {
    "en": "A creative platform powered by its foundational Phoenix model — known for high-resolution output, coherent text, and a Real-Time Canvas that turns sketches into polished art instantly."
  }
};
