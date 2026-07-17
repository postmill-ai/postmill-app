import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('anthropic provider conformance', () => {
  it('ai module conforms', () => {
    const ai = defaultModules.find((m) => m.manifest.domain === 'ai');
    expect(ai).toBeDefined();
    runDomainConformance('ai', ai!, {
      requiredMethods: ['listModels', 'validateCredentials', 'createLanguageModel', 'createLangchainModel'],
      capabilityKeys: ['text', 'vision', 'tools'],
    });
  });
});
