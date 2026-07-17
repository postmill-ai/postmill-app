import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('adobe-stock provider conformance', () => {
  it('contentpack module conforms', () => {
    const contentpack = defaultModules.find((m) => m.manifest.domain === 'contentpack');
    expect(contentpack).toBeDefined();
    runDomainConformance('contentpack', contentpack!, {
      requiredMethods: ['search', 'resolveDownload'],
    });
  });
});
