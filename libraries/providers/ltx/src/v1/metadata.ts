import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "ltx",
  "displayName": "ltx",
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
        "id": "ltx-2-3-pro",
        "label": "LTX-2.3 Pro",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-3-fast",
        "label": "LTX-2.3 Fast",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-pro",
        "label": "LTX-2 Pro",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-fast",
        "label": "LTX-2 Fast",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "ltx-2-3-pro",
        "label": "LTX-2.3 Pro",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-3-fast",
        "label": "LTX-2.3 Fast",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-pro",
        "label": "LTX-2 Pro",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      },
      {
        "id": "ltx-2-fast",
        "label": "LTX-2 Fast",
        "fields": [
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1920x1080",
            "options": [
              {
                "value": "1920x1080",
                "label": "1080p · 16:9"
              },
              {
                "value": "1080x1920",
                "label": "1080p · 9:16"
              },
              {
                "value": "2560x1440",
                "label": "1440p · 16:9"
              },
              {
                "value": "1440x2560",
                "label": "1440p · 9:16"
              },
              {
                "value": "3840x2160",
                "label": "4K · 16:9"
              },
              {
                "value": "2160x3840",
                "label": "4K · 9:16"
              }
            ]
          },
          {
            "name": "duration",
            "type": "number",
            "label": "Duration (seconds)",
            "default": 8,
            "min": 1,
            "max": 20
          },
          {
            "name": "fps",
            "type": "number",
            "label": "Frame rate (fps)",
            "default": 24,
            "min": 24,
            "max": 60
          },
          {
            "name": "camera_motion",
            "type": "select",
            "label": "Camera motion",
            "default": "",
            "options": [
              {
                "value": "",
                "label": "Auto"
              },
              {
                "value": "static",
                "label": "Static"
              },
              {
                "value": "dolly_in",
                "label": "Dolly in"
              },
              {
                "value": "dolly_out",
                "label": "Dolly out"
              },
              {
                "value": "dolly_left",
                "label": "Dolly left"
              },
              {
                "value": "dolly_right",
                "label": "Dolly right"
              },
              {
                "value": "jib_up",
                "label": "Jib up"
              },
              {
                "value": "jib_down",
                "label": "Jib down"
              },
              {
                "value": "focus_shift",
                "label": "Focus shift"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Synthesize a synchronized soundtrack"
          }
        ]
      }
    ]
  },
  "website": "https://ltx.studio",
  "description": {
    "en": "LTX Studio by Lightricks is an end-to-end AI video production platform. Powered by the open-source LTX-2 model, it takes you from script to storyboard to finished video."
  }
};
