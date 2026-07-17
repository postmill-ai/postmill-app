import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const wasabiStorageModule = makeS3StorageModule({
  type: 'WASABI',
  displayName: 'Wasabi',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'us-east-1',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://s3.${region}.wasabisys.com`,
});

wasabiStorageModule.metadata = providerMetadata;
