import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "kling",
  "displayName": "Kling AI",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-to-video",
    "text-to-image",
    "text-to-video"
  ],
  "hasModelList": false,
  "docsUrl": "https://kling.ai/document-api",
  "website": "https://kling.ai",
  "description": {
    "en": "The official Kling AI API: cinematic text-to-video and image-to-video with native audio on current models, plus high-quality text-to-image — billed straight to your own Kling AI resource pack."
  },
  "mediaModels": {
    "text-to-video": [
      {
        "id": "kling-3.0-turbo",
        "label": "Kling 3.0 Turbo",
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
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-3.0",
        "label": "Kling 3.0",
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
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-2.6",
        "label": "Kling 2.6",
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
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-2.5-turbo",
        "label": "Kling 2.5 Turbo",
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
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "kling-3.0-turbo",
        "label": "Kling 3.0 Turbo",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-3.0",
        "label": "Kling 3.0",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-2.6",
        "label": "Kling 2.6",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      },
      {
        "id": "kling-2.5-turbo",
        "label": "Kling 2.5 Turbo",
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
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "720p",
            "options": [
              {
                "value": "720p",
                "label": "720p"
              },
              {
                "value": "1080p",
                "label": "1080p"
              }
            ],
            "help": "Kling 2.6 requires 1080p when native audio is enabled."
          },
          {
            "name": "audio",
            "type": "select",
            "label": "Audio",
            "options": [
              {
                "value": "off",
                "label": "Silent"
              },
              {
                "value": "native",
                "label": "Native audio"
              }
            ],
            "help": "Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio."
          }
        ]
      }
    ],
    "text-to-image": [
      {
        "id": "kling-v3",
        "label": "Kling V3",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
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
                "label": "Classic 4:3"
              },
              {
                "value": "3:4",
                "label": "Portrait 3:4"
              },
              {
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Portrait 2:3"
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
            "default": "1k",
            "options": [
              {
                "value": "1k",
                "label": "1K standard"
              },
              {
                "value": "2k",
                "label": "2K high-res"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 9,
            "step": 1
          }
        ]
      },
      {
        "id": "kling-v2-1",
        "label": "Kling V2.1",
        "fields": [
          {
            "name": "negative_prompt",
            "type": "text",
            "label": "Negative prompt",
            "placeholder": "What to avoid (optional)"
          },
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
                "label": "Classic 4:3"
              },
              {
                "value": "3:4",
                "label": "Portrait 3:4"
              },
              {
                "value": "3:2",
                "label": "Photo 3:2"
              },
              {
                "value": "2:3",
                "label": "Portrait 2:3"
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
            "default": "1k",
            "options": [
              {
                "value": "1k",
                "label": "1K standard"
              },
              {
                "value": "2k",
                "label": "2K high-res"
              }
            ]
          },
          {
            "name": "n",
            "type": "number",
            "label": "Images",
            "default": 1,
            "min": 1,
            "max": 9,
            "step": 1
          }
        ]
      }
    ]
  }
};
