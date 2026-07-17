import { describe, it, expect } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('openai provider conformance', () => {
  it('ai module conforms', () => {
    const ai = defaultModules.find((m) => m.manifest.domain === 'ai');
    expect(ai).toBeDefined();
    runDomainConformance('ai', ai!, {
      requiredMethods: ['listModels', 'validateCredentials', 'createLanguageModel', 'createLangchainModel'],
      capabilityKeys: ['text', 'image', 'vision', 'embeddings', 'speech', 'tools'],
    });
  });

  it('media module conforms', () => {
    const media = defaultModules.find((m) => m.manifest.domain === 'media');
    expect(media).toBeDefined();
    runDomainConformance('media', media!, {
      requiredMethods: ['generateImage', 'generateVideo', 'generateAudio', 'generateAvatar'],
      capabilityKeys: ['image', 'video', 'audio', 'tts', 'stt'],
    });
  });
});
