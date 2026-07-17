import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "luma",
  "displayName": "luma",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-to-video",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-video": [
      {
        "id": "ray-2",
        "label": "Ray 2",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      },
      {
        "id": "ray-flash-2",
        "label": "Ray Flash 2 (faster)",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      },
      {
        "id": "ray-1-6",
        "label": "Ray 1.6",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "ray-2",
        "label": "Ray 2",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      },
      {
        "id": "ray-flash-2",
        "label": "Ray Flash 2 (faster)",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      },
      {
        "id": "ray-1-6",
        "label": "Ray 1.6",
        "fields": [
          {
            "name": "aspect_ratio",
            "type": "select",
            "label": "Aspect ratio",
            "default": "16:9",
            "options": [
              {
                "value": "16:9",
                "label": "Landscape 16:9"
              },
              {
                "value": "9:16",
                "label": "Portrait 9:16"
              },
              {
                "value": "1:1",
                "label": "Square 1:1"
              },
              {
                "value": "4:3",
                "label": "4:3"
              },
              {
                "value": "3:4",
                "label": "3:4"
              },
              {
                "value": "21:9",
                "label": "Ultrawide 21:9"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "540p",
                "label": "540p"
              },
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ]
          },
          {
            "name": "duration",
            "type": "select",
            "label": "Duration",
            "default": "5s",
            "options": [
              {
                "value": "5s",
                "label": "5 seconds"
              },
              {
                "value": "9s",
                "label": "9 seconds"
              }
            ]
          },
          {
            "name": "loop",
            "type": "toggle",
            "label": "Loop",
            "default": false,
            "help": "Seamlessly loop the clip"
          }
        ]
      }
    ]
  },
  "website": "https://lumalabs.ai/dream-machine",
  "description": {
    "en": "Luma AI's Dream Machine turns text and images into realistic, fluid video. Its Ray models are known for natural motion, strong physics, and fast, prolific creative iteration."
  }
};
