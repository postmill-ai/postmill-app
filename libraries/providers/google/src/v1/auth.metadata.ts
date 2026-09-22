import { ProviderMetadata } from '@postmill-ai/provider-kernel';

// The auth module's own catalog entry — `metadata.ts` describes the Gemini AI
// hub and must not advertise an AI surface for Google sign-in.
export const metadata: ProviderMetadata = {
  "website": "https://developers.google.com/identity",
  "description": {
    "en": "Sign in with Google — let users authenticate with their Google account."
  },
  "id": "google",
  "displayName": "Google",
  "kind": "action",
  "domains": [],
  "hasModelList": false,
  "mediaCategories": []
};
