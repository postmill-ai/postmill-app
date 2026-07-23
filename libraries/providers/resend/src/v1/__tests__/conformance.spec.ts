import { describe, it } from 'vitest';
import { runDomainConformance } from '@postmill-ai/provider-kernel';
import defaultModules from '../..';

describe('resend provider conformance', () => {
  it('email module conforms', () => {
    const email = defaultModules.find((m) => m.manifest.domain === 'email');
    expect(email).toBeDefined();
    runDomainConformance('email', email!, {
      requiredMethods: ['send', 'isConfigured', 'verifyWebhook', 'parseWebhook'],
      capabilityKeys: ['webhooks', 'openTracking', 'clickTracking'],
    });
  });
});
