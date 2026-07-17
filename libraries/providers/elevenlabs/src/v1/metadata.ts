import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "elevenlabs",
  "displayName": "elevenlabs",
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "text-to-speech"
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
        "id": "eleven_turbo_v2_5",
        "label": "Turbo v2.5 (fast)",
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
        "id": "eleven_monolingual_v1",
        "label": "English v1",
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
    ]
  },
  "website": "https://elevenlabs.io",
  "description": {
    "en": "The leading AI audio platform for ultra-realistic text-to-speech, voice cloning, and multilingual dubbing across 70+ languages — known for the most natural-sounding AI voices available."
  }
};
