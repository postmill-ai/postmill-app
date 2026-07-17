import { ProviderMetadata } from '@gitroom/provider-kernel';

export const metadata: ProviderMetadata = {
  "description": {
    "en": "Connect any S3-compatible object storage (MinIO, Ceph, and others) using your own endpoint and access keys."
  },
  "id": "s3_compatible",
  "displayName": "s3-compatible",
  "kind": "action",
  "domains": [
    "media"
  ],
  "hasModelList": false,
  "mediaCategories": []
};
