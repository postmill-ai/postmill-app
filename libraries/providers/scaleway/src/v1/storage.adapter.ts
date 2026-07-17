import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const scalewayStorageModule = makeS3StorageModule({
  type: 'SCALEWAY',
  displayName: 'Scaleway',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'fr-par',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://s3.${region}.scw.cloud`,
});

scalewayStorageModule.metadata = providerMetadata;
