import { ProviderMetadata } from '@postmill-ai/provider-kernel';

// The payments module's own catalog entry — `metadata.ts` describes Sign in
// with Apple and must not advertise the payments surface for the auth module.
export const metadata: ProviderMetadata = {
  "website": "https://developer.apple.com/in-app-purchase/",
  "description": {
    "en": "App Store — in-app subscriptions for the Postmill mobile app, verified with the App Store Server API."
  },
  "id": "apple",
  "displayName": "App Store",
  "kind": "action",
  "domains": [
    "payments"
  ],
  "hasModelList": false,
  "mediaCategories": []
};
