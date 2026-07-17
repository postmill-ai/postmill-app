import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('local provider conformance', () => {
  it('storage module conforms', () => {
    const storage = defaultModules.find((m) => m.manifest.domain === 'storage');
    expect(storage).toBeDefined();
    runDomainConformance('storage', storage!, {
      requiredMethods: [
        'uploadSimple',
        'uploadFile',
        'removeFile',
        'testConnection',
        'listFiles',
        'getFileUrl',
        'deleteFile',
        'getUsageBytes',
        'writeBuffer',
        'readFile',
      ],
    });
  });
});
