import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "elevenlabs",
  "displayName": "elevenlabs",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-to-video",
    "text-to-image",
    "text-to-speech",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-speech": [
      {
        "id": "eleven_multilingual_v2",
        "label": "Multilingual v2 (quality)",
        "fields": [
          {
            "name": "voice_id",
            "type": "select",
            "label": "Voice",
            "default": "21m00Tcm4TlvDq8ikWAM",
            "options": [
              {
                "value": "21m00Tcm4TlvDq8ikWAM",
                "label": "Rachel (calm, narration)"
              },
              {
                "value": "EXAVITQu4vr4xnSDxMaL",
                "label": "Sarah (soft, news)"
              },
              {
                "value": "AZnzlk1XvdvUeBnXmlld",
                "label": "Domi (strong, confident)"
              },
              {
                "value": "ErXwobaYiN019PkySvjV",
                "label": "Antoni (warm, well-rounded)"
              },
              {
                "value": "pNInz6obpgDQGcFmaJgB",
                "label": "Adam (deep, narration)"
              },
              {
                "value": "TxGEqnHWrfWFTfGW9XjX",
                "label": "Josh (deep, young)"
              },
              {
                "value": "VR6AewLTigWG4xSOukaG",
                "label": "Arnold (crisp, strong)"
              },
              {
                "value": "yoZ06aMxZJJ28mfd3POQ",
                "label": "Sam (raspy, casual)"
              }
            ],
            "help": "ElevenLabs premade voices."
          },
          {
            "name": "stability",
            "type": "number",
            "label": "Stability",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "similarity_boost",
            "type": "number",
            "label": "Similarity boost",
            "default": 0.75,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "style",
            "type": "number",
            "label": "Style exaggeration",
            "default": 0,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "use_speaker_boost",
            "type": "toggle",
            "label": "Speaker boost",
            "default": true
          }
        ]
      },
      {
        "id": "eleven_v3",
        "label": "Eleven v3 (expressive)",
        "fields": [
          {
            "name": "voice_id",
            "type": "select",
            "label": "Voice",
            "default": "21m00Tcm4TlvDq8ikWAM",
            "options": [
              {
                "value": "21m00Tcm4TlvDq8ikWAM",
                "label": "Rachel (calm, narration)"
              },
              {
                "value": "EXAVITQu4vr4xnSDxMaL",
                "label": "Sarah (soft, news)"
              },
              {
                "value": "AZnzlk1XvdvUeBnXmlld",
                "label": "Domi (strong, confident)"
              },
              {
                "value": "ErXwobaYiN019PkySvjV",
                "label": "Antoni (warm, well-rounded)"
              },
              {
                "value": "pNInz6obpgDQGcFmaJgB",
                "label": "Adam (deep, narration)"
              },
              {
                "value": "TxGEqnHWrfWFTfGW9XjX",
                "label": "Josh (deep, young)"
              },
              {
                "value": "VR6AewLTigWG4xSOukaG",
                "label": "Arnold (crisp, strong)"
              },
              {
                "value": "yoZ06aMxZJJ28mfd3POQ",
                "label": "Sam (raspy, casual)"
              }
            ],
            "help": "ElevenLabs premade voices."
          },
          {
            "name": "stability",
            "type": "number",
            "label": "Stability",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "similarity_boost",
            "type": "number",
            "label": "Similarity boost",
            "default": 0.75,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "style",
            "type": "number",
            "label": "Style exaggeration",
            "default": 0,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "use_speaker_boost",
            "type": "toggle",
            "label": "Speaker boost",
            "default": true
          }
        ]
      },
      {
        "id": "eleven_flash_v2_5",
        "label": "Flash v2.5 (lowest latency)",
        "fields": [
          {
            "name": "voice_id",
            "type": "select",
            "label": "Voice",
            "default": "21m00Tcm4TlvDq8ikWAM",
            "options": [
              {
                "value": "21m00Tcm4TlvDq8ikWAM",
                "label": "Rachel (calm, narration)"
              },
              {
                "value": "EXAVITQu4vr4xnSDxMaL",
                "label": "Sarah (soft, news)"
              },
              {
                "value": "AZnzlk1XvdvUeBnXmlld",
                "label": "Domi (strong, confident)"
              },
              {
                "value": "ErXwobaYiN019PkySvjV",
                "label": "Antoni (warm, well-rounded)"
              },
              {
                "value": "pNInz6obpgDQGcFmaJgB",
                "label": "Adam (deep, narration)"
              },
              {
                "value": "TxGEqnHWrfWFTfGW9XjX",
                "label": "Josh (deep, young)"
              },
              {
                "value": "VR6AewLTigWG4xSOukaG",
                "label": "Arnold (crisp, strong)"
              },
              {
                "value": "yoZ06aMxZJJ28mfd3POQ",
                "label": "Sam (raspy, casual)"
              }
            ],
            "help": "ElevenLabs premade voices."
          },
          {
            "name": "stability",
            "type": "number",
            "label": "Stability",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "similarity_boost",
            "type": "number",
            "label": "Similarity boost",
            "default": 0.75,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "style",
            "type": "number",
            "label": "Style exaggeration",
            "default": 0,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "use_speaker_boost",
            "type": "toggle",
            "label": "Speaker boost",
            "default": true
          }
        ]
      },
      {
        "id": "eleven_turbo_v2_5",
        "label": "Turbo v2.5 (legacy — use Flash)",
        "fields": [
          {
            "name": "voice_id",
            "type": "select",
            "label": "Voice",
            "default": "21m00Tcm4TlvDq8ikWAM",
            "options": [
              {
                "value": "21m00Tcm4TlvDq8ikWAM",
                "label": "Rachel (calm, narration)"
              },
              {
                "value": "EXAVITQu4vr4xnSDxMaL",
                "label": "Sarah (soft, news)"
              },
              {
                "value": "AZnzlk1XvdvUeBnXmlld",
                "label": "Domi (strong, confident)"
              },
              {
                "value": "ErXwobaYiN019PkySvjV",
                "label": "Antoni (warm, well-rounded)"
              },
              {
                "value": "pNInz6obpgDQGcFmaJgB",
                "label": "Adam (deep, narration)"
              },
              {
                "value": "TxGEqnHWrfWFTfGW9XjX",
                "label": "Josh (deep, young)"
              },
              {
                "value": "VR6AewLTigWG4xSOukaG",
                "label": "Arnold (crisp, strong)"
              },
              {
                "value": "yoZ06aMxZJJ28mfd3POQ",
                "label": "Sam (raspy, casual)"
              }
            ],
            "help": "ElevenLabs premade voices."
          },
          {
            "name": "stability",
            "type": "number",
            "label": "Stability",
            "default": 0.5,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "similarity_boost",
            "type": "number",
            "label": "Similarity boost",
            "default": 0.75,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "style",
            "type": "number",
            "label": "Style exaggeration",
            "default": 0,
            "min": 0,
            "max": 1,
            "step": 0.05
          },
          {
            "name": "use_speaker_boost",
            "type": "toggle",
            "label": "Speaker boost",
            "default": true
          }
        ]
      }
    ],
    "text-to-image": [
      {
        "id": "gemini-3.1-flash-image",
        "label": "Gemini 3.1 Flash Image (fast)",
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
                "label": "Classic 4:3"
              },
              {
                "value": "3:4",
                "label": "Portrait 3:4"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1K",
            "options": [
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          }
        ]
      },
      {
        "id": "gemini-3-pro-image",
        "label": "Gemini 3 Pro Image (quality)",
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
                "label": "Classic 4:3"
              },
              {
                "value": "3:4",
                "label": "Portrait 3:4"
              }
            ]
          },
          {
            "name": "resolution",
            "type": "select",
            "label": "Resolution",
            "default": "1K",
            "options": [
              {
                "value": "1K",
                "label": "1K"
              },
              {
                "value": "2K",
                "label": "2K"
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          }
        ]
      },
      {
        "id": "gpt-image-2",
        "label": "GPT Image 2",
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
                "value": "3:2",
                "label": "Landscape 3:2"
              },
              {
                "value": "2:3",
                "label": "Portrait 2:3"
              }
            ]
          },
          {
            "name": "quality",
            "type": "select",
            "label": "Quality",
            "default": "medium",
            "options": [
              {
                "value": "low",
                "label": "Low (fast, cheap)"
              },
              {
                "value": "medium",
                "label": "Medium"
              },
              {
                "value": "high",
                "label": "High"
              }
            ]
          }
        ]
      },
      {
        "id": "gpt-image-1",
        "label": "GPT Image 1",
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
                "value": "3:2",
                "label": "Landscape 3:2"
              },
              {
                "value": "2:3",
                "label": "Portrait 2:3"
              }
            ]
          },
          {
            "name": "quality",
            "type": "select",
            "label": "Quality",
            "default": "medium",
            "options": [
              {
                "value": "low",
                "label": "Low (fast, cheap)"
              },
              {
                "value": "medium",
                "label": "Medium"
              },
              {
                "value": "high",
                "label": "High"
              }
            ]
          }
        ]
      }
    ],
    "text-to-video": [
      {
        "id": "veo-3.1-fast-generate-001",
        "label": "Veo 3.1 Fast",
        "notes": [
          "Requires an ElevenLabs Pro plan or above"
        ],
        "fields": [
          {
            "name": "duration_secs",
            "type": "number",
            "label": "Duration (s)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 2,
            "help": "Veo renders 4, 6, or 8 seconds."
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
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Veo can synthesize a native soundtrack."
          }
        ]
      },
      {
        "id": "veo-3.1-generate-001",
        "label": "Veo 3.1 (quality)",
        "notes": [
          "Requires an ElevenLabs Pro plan or above"
        ],
        "fields": [
          {
            "name": "duration_secs",
            "type": "number",
            "label": "Duration (s)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 2,
            "help": "Veo renders 4, 6, or 8 seconds."
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
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Veo can synthesize a native soundtrack."
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "veo-3.1-fast-generate-001",
        "label": "Veo 3.1 Fast",
        "notes": [
          "Requires an ElevenLabs Pro plan or above",
          "Subject/style references require 8 seconds and cannot be combined with start/end frames; an end frame requires a start frame"
        ],
        "fields": [
          {
            "name": "duration_secs",
            "type": "number",
            "label": "Duration (s)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 2,
            "help": "Frames allow 4, 6, or 8 seconds. Subject/style references require 8 seconds."
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
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Veo can synthesize a native soundtrack."
          },
          {
            "name": "reference_image_1_role",
            "type": "select",
            "label": "Reference 1 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          },
          {
            "name": "reference_image_2_role",
            "type": "select",
            "label": "Reference 2 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          },
          {
            "name": "reference_image_3_role",
            "type": "select",
            "label": "Reference 3 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          }
        ]
      },
      {
        "id": "veo-3.1-generate-001",
        "label": "Veo 3.1 (quality)",
        "notes": [
          "Requires an ElevenLabs Pro plan or above",
          "Subject/style references require 8 seconds and cannot be combined with start/end frames; an end frame requires a start frame"
        ],
        "fields": [
          {
            "name": "duration_secs",
            "type": "number",
            "label": "Duration (s)",
            "default": 8,
            "min": 4,
            "max": 8,
            "step": 2,
            "help": "Frames allow 4, 6, or 8 seconds. Subject/style references require 8 seconds."
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
              },
              {
                "value": "4K",
                "label": "4K"
              }
            ]
          },
          {
            "name": "generate_audio",
            "type": "toggle",
            "label": "Generate audio",
            "default": true,
            "help": "Veo can synthesize a native soundtrack."
          },
          {
            "name": "reference_image_1_role",
            "type": "select",
            "label": "Reference 1 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          },
          {
            "name": "reference_image_2_role",
            "type": "select",
            "label": "Reference 2 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          },
          {
            "name": "reference_image_3_role",
            "type": "select",
            "label": "Reference 3 role",
            "default": "subject",
            "options": [
              {
                "value": "subject",
                "label": "Subject / scene"
              },
              {
                "value": "style",
                "label": "Visual style"
              }
            ]
          }
        ]
      }
    ]
  },
  "website": "https://elevenlabs.io",
  "description": {
    "en": "The leading AI audio platform for ultra-realistic text-to-speech, voice cloning, and multilingual dubbing across 70+ languages — plus image and video generation (Gemini, GPT Image, Veo) via the Flows API on Pro plans."
  }
};
