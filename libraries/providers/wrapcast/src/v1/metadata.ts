import { ProviderMetadata } from '@gitroom/provider-kernel';

export const socialMetadata: ProviderMetadata = {
  website: "https://www.farcaster.xyz",
  description: { en: "Farcaster — a decentralized, web3 social network; publish casts to your account." },
  id: 'wrapcast',
  displayName: 'wrapcast',
  kind: 'action',
  domains: ['media'],
  hasModelList: false,
};

export const metadata: ProviderMetadata = {
  "id": "farcaster",
  "displayName": "farcaster",
  "kind": "action",
  "domains": [
    "media"
  ],
  "hasModelList": false,
  "mediaCategories": []
};
