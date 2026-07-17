import { describe, it } from 'vitest';
import { runDomainConformance } from '@gitroom/provider-kernel';
import defaultModules from '../..';

describe('x provider conformance', () => {
  it('social module conforms', () => {
    const social = defaultModules.find((m) => m.manifest.domain === 'social');
    expect(social).toBeDefined();
    // Only the methods the X provider actually implements. The kernel bridge now
    // exposes optional capabilities conditionally (2.6), so listing an unsupported
    // method (e.g. fetchPageInformation — X has no "pages") correctly fails instead
    // of being masked by an always-present stub.
    runDomainConformance('social', social!, {
      requiredMethods: [
        'post',
        'authenticate',
        'refreshToken',
        'generateAuthUrl',
        'maxLength',
        'checkValidity',
        'mentionFormat',
        'analytics',
        'postAnalytics',
        'comment',
        'fetchComments',
        'replyToComment',
        'likeComment',
        'mention',
      ],
    });
  });
});
