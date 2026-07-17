import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const storjStorageModule = makeS3StorageModule({
  type: 'STORJ',
  displayName: 'Storj',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  // Storj's S3-compatible gateway is a single global host; the region is a
  // placeholder the gateway ignores.
  resolveRegion: (region) => region || 'us-1',
  resolveEndpoint: (_region, endpoint) =>
    endpoint || 'https://gateway.storjshare.io',
});

storjStorageModule.metadata = providerMetadata;
