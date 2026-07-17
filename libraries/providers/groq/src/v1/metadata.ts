import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "groq",
  "displayName": "groq",
  "kind": "hub",
  "domains": [
    "ai",
    "media"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow",
    "vision"
  ],
  "mediaCategories": [
    "image-focal-point",
    "text-to-speech"
  ],
  "hasModelList": true,
  "modelHints": {
    "low-reasoning": [
      "llama-3.1-8b",
      "llama-3.2-3b",
      "mixtral-8x7b"
    ],
    "high-reasoning": [
      "deepseek-r1",
      "llama-3.3-70b",
      "llama-3.1-70b"
    ],
    "workflow": [
      "llama-3.3-70b",
      "llama-3.1-70b",
      "llama-3.2-90b-vision"
    ],
    "vision": [
      "llama-3.2-11b-vision",
      "llama-3.2-90b-vision"
    ]
  },
  "mediaModels": {
    "text-to-speech": [
      {
        "id": "playai-tts",
        "label": "PlayAI TTS",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. Fritz-PlayAI"
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Format",
            "default": "wav",
            "options": [
              {
                "value": "wav",
                "label": "WAV"
              },
              {
                "value": "mp3",
                "label": "MP3"
              }
            ]
          }
        ]
      },
      {
        "id": "playai-tts-arabic",
        "label": "PlayAI TTS (Arabic)",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. Fritz-PlayAI"
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Format",
            "default": "wav",
            "options": [
              {
                "value": "wav",
                "label": "WAV"
              },
              {
                "value": "mp3",
                "label": "MP3"
              }
            ]
          }
        ]
      },
      {
        "id": "canopylabs/orpheus-v1-english",
        "label": "Orpheus (English)",
        "fields": [
          {
            "name": "voice",
            "type": "text",
            "label": "Voice",
            "placeholder": "e.g. Fritz-PlayAI"
          },
          {
            "name": "response_format",
            "type": "select",
            "label": "Format",
            "default": "wav",
            "options": [
              {
                "value": "wav",
                "label": "WAV"
              },
              {
                "value": "mp3",
                "label": "MP3"
              }
            ]
          }
        ]
      }
    ]
  },
  "website": "https://groq.com",
  "description": {
    "en": "Groq runs AI inference on its purpose-built LPU chip for ultra-low latency. For speech it serves Whisper ASR and Orpheus/PlayAI TTS — real-time transcription and voice generation."
  }
};
