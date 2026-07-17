import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const digitaloceanspacesStorageModule = makeS3StorageModule({
  type: 'DIGITALOCEAN_SPACES',
  displayName: 'DigitalOcean Spaces',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'nyc3',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://${region}.digitaloceanspaces.com`,
});

digitaloceanspacesStorageModule.metadata = providerMetadata;
