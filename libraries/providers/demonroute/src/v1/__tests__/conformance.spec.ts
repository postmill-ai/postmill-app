import { describe, expect, it } from 'vitest';
import { runDomainConformance } from '@postmill-ai/provider-kernel';
import defaultModules from '../..';

describe('Demon Route provider conformance', () => {
  it('ai module conforms', () => {
    const ai = defaultModules.find((module) => module.manifest.domain === 'ai');
    expect(ai).toBeDefined();
    runDomainConformance('ai', ai!, {
      requiredMethods: ['listModels', 'validateCredentials', 'createLanguageModel', 'createLangchainModel'],
      capabilityKeys: ['text', 'image', 'vision', 'embeddings', 'speech', 'tools'],
    });
  });
});
