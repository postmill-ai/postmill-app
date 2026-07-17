import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "suno",
  "displayName": "suno",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "text-to-music"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-music": [
      {
        "id": "V5_5",
        "label": "v5.5 (latest)",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. dream pop, lo-fi, orchestral"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "vocalGender",
            "type": "select",
            "label": "Vocal gender",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "m",
                "label": "Male"
              },
              {
                "value": "f",
                "label": "Female"
              }
            ]
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": false
          }
        ]
      },
      {
        "id": "V5",
        "label": "v5",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. dream pop, lo-fi, orchestral"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "vocalGender",
            "type": "select",
            "label": "Vocal gender",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "m",
                "label": "Male"
              },
              {
                "value": "f",
                "label": "Female"
              }
            ]
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": false
          }
        ]
      },
      {
        "id": "V4_5PLUS",
        "label": "v4.5+",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. dream pop, lo-fi, orchestral"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "vocalGender",
            "type": "select",
            "label": "Vocal gender",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "m",
                "label": "Male"
              },
              {
                "value": "f",
                "label": "Female"
              }
            ]
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": false
          }
        ]
      },
      {
        "id": "V4_5",
        "label": "v4.5",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. dream pop, lo-fi, orchestral"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "vocalGender",
            "type": "select",
            "label": "Vocal gender",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "m",
                "label": "Male"
              },
              {
                "value": "f",
                "label": "Female"
              }
            ]
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": false
          }
        ]
      },
      {
        "id": "V4",
        "label": "v4",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. dream pop, lo-fi, orchestral"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "vocalGender",
            "type": "select",
            "label": "Vocal gender",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "m",
                "label": "Male"
              },
              {
                "value": "f",
                "label": "Female"
              }
            ]
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": false
          }
        ]
      },
      {
        "id": "V5_5",
        "label": "v5.5 (latest)",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. cinematic, ambient, synthwave"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": true
          }
        ]
      },
      {
        "id": "V5",
        "label": "v5",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. cinematic, ambient, synthwave"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": true
          }
        ]
      },
      {
        "id": "V4_5PLUS",
        "label": "v4.5+",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. cinematic, ambient, synthwave"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": true
          }
        ]
      },
      {
        "id": "V4_5",
        "label": "v4.5",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. cinematic, ambient, synthwave"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": true
          }
        ]
      },
      {
        "id": "V4",
        "label": "v4",
        "fields": [
          {
            "name": "style",
            "type": "text",
            "label": "Style",
            "placeholder": "e.g. cinematic, ambient, synthwave"
          },
          {
            "name": "title",
            "type": "text",
            "label": "Title",
            "placeholder": "Track title"
          },
          {
            "name": "styleWeight",
            "type": "number",
            "label": "Style weight",
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "instrumental",
            "type": "toggle",
            "label": "Instrumental only",
            "default": true
          }
        ]
      }
    ]
  },
  "website": "https://sunoapi.org",
  "description": {
    "en": "Suno is a leading generative-AI music model that turns a text prompt — or your own lyrics, style and title — into complete, studio-quality songs with vocals or instrumentals. This studio uses the sunoapi.org gateway."
  }
};
