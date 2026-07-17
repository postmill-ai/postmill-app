import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('fal provider conformance', () => {
  it('media module conforms', () => {
    const media = defaultModules.find((m) => m.manifest.domain === 'media');
    expect(media).toBeDefined();
    runDomainConformance('media', media!, {
      requiredMethods: ['generateImage', 'generateVideo', 'generateAudio', 'generateAvatar', 'pollJob'],
      capabilityKeys: ['image', 'video', 'audio'],
    });
  });
});
