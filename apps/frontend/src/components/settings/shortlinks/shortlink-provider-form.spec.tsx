import { describe, it, expect } from 'vitest';
import { shortlinksDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/shortlinks.descriptor';
import { ProviderFormState } from '@gitroom/frontend/components/settings/shared/kit/provider-surface.types';

/**
 * The old `ShortlinkProviderForm` was replaced by the generic Provider Settings
 * Kit form driven by `shortlinksDescriptor`. The form's behaviour now lives in
 * the descriptor's pure `buildBody` / `buildTestBody` / `seedState` /
 * `credentialFieldsFromMeta` + the shared `capabilityMeta`, which is what we
 * assert here (the rendering is covered by the kit's own form tests).
 */

const baseState = (over: Partial<ProviderFormState> = {}): ProviderFormState => ({
  name: '',
  credentials: {},
  version: undefined,
  extra: {},
  ...over,
});

describe('shortlinksDescriptor', () => {
  describe('buildBody (replaces the old PUT save body)', () => {
    it('sends only name when nothing else is set', () => {
      const body = shortlinksDescriptor.form.buildBody(
        baseState({ name: 'My Bitly' }),
        {} as any,
      );
      // JSON.stringify is what actually hits the wire — undefined keys drop out.
      expect(JSON.parse(JSON.stringify(body))).toEqual({ name: 'My Bitly' });
    });

    it('includes credentials only when at least one value is non-empty', () => {
      const empty = shortlinksDescriptor.form.buildBody(
        baseState({ credentials: { apiKey: '' } }),
        {} as any,
      );
      expect(empty.credentials).toBeUndefined();

      const filled = shortlinksDescriptor.form.buildBody(
        baseState({ credentials: { apiKey: 'abc' } }),
        {} as any,
      );
      expect(filled.credentials).toEqual({ apiKey: 'abc' });
    });

    it('maps extra.clientId/clientSecret into extraConfig', () => {
      const body = shortlinksDescriptor.form.buildBody(
        baseState({ extra: { clientId: 'my-client-id' } }),
        {} as any,
      );
      expect(JSON.parse(JSON.stringify(body))).toEqual({
        extraConfig: { clientId: 'my-client-id' },
      });

      const both = shortlinksDescriptor.form.buildBody(
        baseState({ extra: { clientId: 'id', clientSecret: 'secret' } }),
        {} as any,
      );
      expect(both.extraConfig).toEqual({ clientId: 'id', clientSecret: 'secret' });
    });

    it('includes customDomain and version when present', () => {
      const body = shortlinksDescriptor.form.buildBody(
        baseState({ extra: { customDomain: 'go.acme.com' }, version: 'v2' }),
        {} as any,
      );
      expect(body.customDomain).toBe('go.acme.com');
      expect(body.version).toBe('v2');
    });
  });

  describe('buildTestBody (replaces the old test POST body)', () => {
    it('sends credentials + customDomain', () => {
      const body = shortlinksDescriptor.form.buildTestBody!(
        baseState({ credentials: { apiKey: 'k' }, extra: { customDomain: 'go.x.com' } }),
        {} as any,
      );
      expect(body).toEqual({ credentials: { apiKey: 'k' }, customDomain: 'go.x.com' });
    });

    it('drops an empty customDomain', () => {
      const body = shortlinksDescriptor.form.buildTestBody!(
        baseState({ credentials: { apiKey: 'k' } }),
        {} as any,
      );
      expect(JSON.parse(JSON.stringify(body))).toEqual({ credentials: { apiKey: 'k' } });
    });
  });

  describe('seedState', () => {
    it('seeds extra.customDomain from the existing config', () => {
      expect(shortlinksDescriptor.form.seedState!({ customDomain: 'go.acme.com' } as any)).toEqual(
        { extra: { customDomain: 'go.acme.com' } },
      );
    });

    it('returns empty when no custom domain', () => {
      expect(shortlinksDescriptor.form.seedState!({ customDomain: '' } as any)).toEqual({});
    });
  });

  describe('credentialFieldsFromMeta', () => {
    it('forwards the provider catalog credential fields', () => {
      const fields = [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }];
      expect(
        shortlinksDescriptor.form.credentialFieldsFromMeta!({ credentialFields: fields } as any),
      ).toBe(fields);
    });

    it('falls back to an empty list when missing', () => {
      expect(shortlinksDescriptor.form.credentialFieldsFromMeta!({} as any)).toEqual([]);
    });
  });

  describe('capabilityMeta (chip labels/colors)', () => {
    it('labels the five short-link capabilities', () => {
      expect(shortlinksDescriptor.capabilityMeta.statistics.label).toBe('Stats');
      expect(shortlinksDescriptor.capabilityMeta.customDomain.label).toBe('Custom domain');
      expect(shortlinksDescriptor.capabilityMeta.create.label).toBe('Create links');
      expect(shortlinksDescriptor.capabilityMeta.expand.label).toBe('Expand links');
      expect(shortlinksDescriptor.capabilityMeta.bulkStatistics.label).toBe('Bulk stats');
    });
  });

  describe('load (config envelope → ProviderRow[])', () => {
    it('maps providers, derives capability keys, and preserves version', async () => {
      const fetchMock = ((_url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            active: null,
            providers: [
              {
                identifier: 'bitly',
                name: 'Bitly',
                capabilities: {
                  create: true,
                  expand: false,
                  statistics: true,
                  bulkStatistics: false,
                  customDomain: true,
                },
                isConfigured: true,
                isActive: true,
                version: 'v1',
                customDomain: 'go.bit.ly',
                credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
              },
            ],
          }),
        })) as any;

      const { rows } = await shortlinksDescriptor.load(fetchMock);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.id).toBe('bitly');
      expect(row.identifier).toBe('bitly');
      expect(row.isConfigured).toBe(true);
      expect(row.isPrimary).toBe(true);
      // configured == enabled (no independent toggle).
      expect(row.enabled).toBe(true);
      expect(row.capabilities).toEqual(['create', 'statistics', 'customDomain']);
      expect(row.version).toBe('v1');
      expect((row.meta as any).oauthSessionKey).toBe('oauth_shortlink_provider');
      expect((row.meta as any).oauthTab).toBe('shortlinks');
    });

    it('throws when the config endpoint fails', async () => {
      const fetchMock = (() => Promise.resolve({ ok: false })) as any;
      await expect(shortlinksDescriptor.load(fetchMock)).rejects.toThrow();
    });
  });
});
