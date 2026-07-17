import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('bitly provider conformance', () => {
  it('shortlink module conforms', () => {
    const shortlink = defaultModules.find((m) => m.manifest.domain === 'shortlink');
    expect(shortlink).toBeDefined();
    runDomainConformance('shortlink', shortlink!, {
      requiredMethods: [
        'createShortLink',
        'expandShortLink',
        'linkStatistics',
        'listLinks',
        'validateCredentials',
        'resolveDomain',
      ],
      capabilityKeys: ['create', 'expand', 'statistics', 'bulkStatistics', 'customDomain'],
    });
  });
});
