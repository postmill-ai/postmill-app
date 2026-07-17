import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "runway",
  "displayName": "runway",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-image"
  ],
  "hasModelList": false,
  "mediaModels": {
    "image-to-video": [
      {
        "id": "gen4_turbo",
        "label": "Gen-4 Turbo",
        "fields": [
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "ratio",
            "type": "select",
            "label": "Ratio",
            "default": "1280:720",
            "options": [
              {
                "value": "1280:720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720:1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "960:960",
                "label": "Square 960×960"
              },
              {
                "value": "1584:672",
                "label": "Wide 1584×672"
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
        "id": "gen3a_turbo",
        "label": "Gen-3 Alpha Turbo",
        "fields": [
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5",
            "options": [
              {
                "value": "5",
                "label": "5 seconds"
              },
              {
                "value": "10",
                "label": "10 seconds"
              }
            ]
          },
          {
            "name": "ratio",
            "type": "select",
            "label": "Ratio",
            "default": "1280:720",
            "options": [
              {
                "value": "1280:720",
                "label": "Landscape 1280×720"
              },
              {
                "value": "720:1280",
                "label": "Portrait 720×1280"
              },
              {
                "value": "960:960",
                "label": "Square 960×960"
              },
              {
                "value": "1584:672",
                "label": "Wide 1584×672"
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
    ],
    "text-to-image": [
      {
        "id": "gen4_image",
        "label": "Runway (Text → Image)",
        "fields": [
          {
            "name": "ratio",
            "type": "select",
            "label": "Ratio",
            "default": "1360:768",
            "options": [
              {
                "value": "1360:768",
                "label": "Landscape 1360×768"
              },
              {
                "value": "768:1360",
                "label": "Portrait 768×1360"
              },
              {
                "value": "1024:1024",
                "label": "Square 1024×1024"
              },
              {
                "value": "1920:1080",
                "label": "Wide 1920×1080"
              },
              {
                "value": "1080:1920",
                "label": "Tall 1080×1920"
              }
            ]
          }
        ]
      }
    ]
  },
  "website": "https://runwayml.com",
  "description": {
    "en": "A pioneering generative-AI platform whose Gen-4 family produces cinematic, high-fidelity video from text and images — prized for consistent characters, scenes, and director-grade motion control."
  }
};
