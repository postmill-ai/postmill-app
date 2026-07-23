import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "website": "https://www.heygen.com",
  "description": {
    "en": "AI video platform for lifelike avatar and talking-photo videos generated from a script."
  },
  "id": "heygen",
  "displayName": "heygen",
  // Avatars are HeyGen's "models" (listModels enumerates the account's avatar
  // catalog), so this is a regular model-list provider, not an action provider.
  "kind": "direct",
  "domains": [
    "media"
  ],
  "mediaCategories": [
    "image-to-video",
    "text-to-video",
    "video-avatar"
  ],
  "hasModelList": true
};
