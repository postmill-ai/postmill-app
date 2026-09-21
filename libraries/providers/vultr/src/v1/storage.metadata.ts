import { ProviderMetadata } from '@postmill-ai/provider-kernel';

// The storage module's own catalog entry — `metadata.ts` describes Vultr's
// inference (AI) surface and must not advertise it for object storage.
export const metadata: ProviderMetadata = {
  "website": "https://www.vultr.com/products/object-storage/",
  "description": {
    "en": "Vultr Object Storage — S3-compatible object storage."
  },
  "id": "vultr",
  "displayName": "Vultr Object Storage",
  "kind": "action",
  "domains": [],
  "hasModelList": false,
  "mediaCategories": []
};
