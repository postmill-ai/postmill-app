import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-merge-spec';

// mergeExternalInstanceDetails is dependency-free; invoke it on the prototype
// instead of building the manager's full DI graph.
const merge = IntegrationManager.prototype.mergeExternalInstanceDetails;

describe('IntegrationManager.mergeExternalInstanceDetails', () => {
  const stored = {
    client_id: 'dyn-id',
    client_secret: 'dyn-secret',
    instanceUrl: 'https://fosstodon.org',
  };
  const encrypted = AuthService.fixedEncryption(JSON.stringify(stored));

  it('passes clientInformation through when the integration has no stored details', () => {
    const info = { client_id: 'org-id', instanceUrl: 'https://mastodon.social' };
    expect(merge.call({}, { customInstanceDetails: null }, info)).toEqual(info);
    expect(merge.call({}, undefined, info)).toEqual(info);
  });

  it('merges stored dynamic details over static client info (stored wins)', () => {
    const merged = merge.call(
      {},
      { customInstanceDetails: encrypted },
      { client_id: 'org-id', client_secret: 'org-secret', instanceUrl: 'https://mastodon.social', version: 'v1' }
    );
    expect(merged).toEqual({ ...stored, version: 'v1' });
  });

  it('works with undefined clientInformation (keyless deployment)', () => {
    const merged = merge.call({}, { customInstanceDetails: encrypted }, undefined);
    expect(merged).toEqual(stored);
  });

  it('falls back to clientInformation on a tampered/undecryptable blob', () => {
    const info = { client_id: 'org-id' };
    expect(merge.call({}, { customInstanceDetails: 'v2:not-valid-base64!!!' }, info)).toEqual(info);
    expect(merge.call({}, { customInstanceDetails: 'garbage' }, info)).toEqual(info);
  });
});
