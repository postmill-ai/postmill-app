import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const idrivee2StorageModule = makeS3StorageModule({
  type: 'IDRIVE_E2',
  displayName: 'iDrive E2',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://${region}.cloudstorage.ide.com`,
});

idrivee2StorageModule.metadata = providerMetadata;
