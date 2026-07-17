import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setCredentials,
  getCredential,
  clearCredentials,
  replaceCredentialsMap,
} from './credentials';

const ORG = 'test-org';

describe('credentials', () => {
  beforeEach(() => {
    clearCredentials();
    vi.unstubAllEnvs();
  });

  describe('setCredentials / getCredential', () => {
    it('sets and retrieves a credential entry', () => {
      setCredentials(ORG, 'github', { clientId: 'abc', clientSecret: 'secret' });
      expect(getCredential(ORG, 'github', 'clientId')).toBe('abc');
      expect(getCredential(ORG, 'github', 'clientSecret')).toBe('secret');
    });

    it('returns undefined for all keys when identifier is missing', () => {
      expect(getCredential(ORG, 'nonexistent', 'clientId')).toBeUndefined();
      expect(getCredential(ORG, 'nonexistent', 'clientSecret')).toBeUndefined();
      expect(getCredential(ORG, 'nonexistent', 'redirectUri')).toBeUndefined();
      expect(getCredential(ORG, 'nonexistent', 'token')).toBeUndefined();
    });

    it('overwrites an existing entry', () => {
      setCredentials(ORG, 'twitter', { clientId: 'old' });
      setCredentials(ORG, 'twitter', { clientId: 'new' });
      expect(getCredential(ORG, 'twitter', 'clientId')).toBe('new');
    });

    it('returns undefined for keys not present in entry', () => {
      setCredentials(ORG, 'slack', { clientId: '123' });
      expect(getCredential(ORG, 'slack', 'clientSecret')).toBeUndefined();
      expect(getCredential(ORG, 'slack', 'redirectUri')).toBeUndefined();
      expect(getCredential(ORG, 'slack', 'token')).toBeUndefined();
    });

    it('handles all four credential key types', () => {
      setCredentials(ORG, 'all-keys', {
        clientId: 'cid',
        clientSecret: 'cs',
        redirectUri: 'ru',
        token: 'tok',
      });
      expect(getCredential(ORG, 'all-keys', 'clientId')).toBe('cid');
      expect(getCredential(ORG, 'all-keys', 'clientSecret')).toBe('cs');
      expect(getCredential(ORG, 'all-keys', 'redirectUri')).toBe('ru');
      expect(getCredential(ORG, 'all-keys', 'token')).toBe('tok');
    });

    it('stores and retrieves entries with empty string values', () => {
      setCredentials(ORG, 'empty', { clientId: '' });
      expect(getCredential(ORG, 'empty', 'clientId')).toBe('');
    });

    it('handles entries with undefined field values', () => {
      setCredentials(ORG, 'undef', { clientId: undefined });
      expect(getCredential(ORG, 'undef', 'clientId')).toBeUndefined();
    });

    it('supports multiple independent providers', () => {
      setCredentials(ORG, 'a', { clientId: 'a-id' });
      setCredentials(ORG, 'b', { clientId: 'b-id' });
      expect(getCredential(ORG, 'a', 'clientId')).toBe('a-id');
      expect(getCredential(ORG, 'b', 'clientId')).toBe('b-id');
    });

    it('isolates credentials across organizations', () => {
      setCredentials('org-a', 'github', { clientId: 'a-id' });
      setCredentials('org-b', 'github', { clientId: 'b-id' });
      setCredentials('org-b', 'slack', { clientId: 'b-slack' });
      expect(getCredential('org-a', 'github', 'clientId')).toBe('a-id');
      expect(getCredential('org-b', 'github', 'clientId')).toBe('b-id');
      expect(getCredential('org-b', 'slack', 'clientId')).toBe('b-slack');
    });
  });

  describe('clearCredentials', () => {
    it('removes all entries', () => {
      setCredentials(ORG, 'a', { clientId: '1' });
      setCredentials(ORG, 'b', { clientId: '2' });
      clearCredentials();
      expect(getCredential(ORG, 'a', 'clientId')).toBeUndefined();
      expect(getCredential(ORG, 'b', 'clientId')).toBeUndefined();
    });

    it('is idempotent', () => {
      clearCredentials();
      clearCredentials();
      expect(getCredential(ORG, 'anything', 'clientId')).toBeUndefined();
    });
  });

  describe('replaceCredentialsMap', () => {
    it('replaces the entire credentials map atomically for an org', () => {
      setCredentials(ORG, 'old', { clientId: 'old-value' });
      const newMap = new Map<string, { clientId?: string }>();
      newMap.set('new', { clientId: 'new-value' });
      replaceCredentialsMap(ORG, newMap);
      expect(getCredential(ORG, 'old', 'clientId')).toBeUndefined();
      expect(getCredential(ORG, 'new', 'clientId')).toBe('new-value');
    });

    it('does not share reference with the passed-in map after replacement', () => {
      const external = new Map<string, { clientId?: string }>();
      external.set('ext', { clientId: 'ext-value' });
      replaceCredentialsMap(ORG, external);
      external.set('later', { clientId: 'later-value' });
      expect(getCredential(ORG, 'later', 'clientId')).toBeUndefined();
    });

    it('works with an empty map', () => {
      setCredentials(ORG, 'a', { clientId: '1' });
      replaceCredentialsMap(ORG, new Map());
      expect(getCredential(ORG, 'a', 'clientId')).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('supports a full lifecycle: set, get, replace, clear', () => {
      setCredentials(ORG, 'x', { token: 'tok1' });
      expect(getCredential(ORG, 'x', 'token')).toBe('tok1');
      replaceCredentialsMap(ORG, new Map([['y', { token: 'tok2' }]]));
      expect(getCredential(ORG, 'x', 'token')).toBeUndefined();
      expect(getCredential(ORG, 'y', 'token')).toBe('tok2');
      clearCredentials();
      expect(getCredential(ORG, 'y', 'token')).toBeUndefined();
    });
  });
});
