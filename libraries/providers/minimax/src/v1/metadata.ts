import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "id": "minimax",
  "displayName": "minimax",
  "kind": "direct",
  "domains": [
    "ai",
    "media"
  ],
  "modelCategories": [
    "low-reasoning",
    "high-reasoning",
    "workflow"
  ],
  "mediaCategories": [
    "image-slide",
    "image-to-video",
    "text-to-video"
  ],
  "hasModelList": false,
  "mediaModels": {
    "text-to-video": [
      {
        "id": "video-01",
        "label": "Hailuo T2V-01",
        "fields": [
          {
            "name": "prompt_optimizer",
            "type": "toggle",
            "label": "Prompt optimizer",
            "default": true,
            "help": "Let MiniMax refine the prompt"
          }
        ]
      },
      {
        "id": "T2V-01-Director",
        "label": "T2V-01 Director (camera control)",
        "fields": [
          {
            "name": "prompt_optimizer",
            "type": "toggle",
            "label": "Prompt optimizer",
            "default": true,
            "help": "Let MiniMax refine the prompt"
          }
        ]
      }
    ],
    "image-to-video": [
      {
        "id": "I2V-01",
        "label": "Hailuo I2V-01",
        "fields": [
          {
            "name": "prompt_optimizer",
            "type": "toggle",
            "label": "Prompt optimizer",
            "default": true
          }
        ]
      },
      {
        "id": "I2V-01-Director",
        "label": "I2V-01 Director (camera control)",
        "fields": [
          {
            "name": "prompt_optimizer",
            "type": "toggle",
            "label": "Prompt optimizer",
            "default": true
          }
        ]
      },
      {
        "id": "I2V-01-live",
        "label": "I2V-01 Live (anime/illustration)",
        "fields": [
          {
            "name": "prompt_optimizer",
            "type": "toggle",
            "label": "Prompt optimizer",
            "default": true
          }
        ]
      }
    ]
  },
  "website": "https://hailuoai.video",
  "description": {
    "en": "Hailuo, MiniMax's AI video generator, is known for striking cinematic motion and strong prompt following from text or a single image — with templates for dance, effects, and character animation."
  }
};
