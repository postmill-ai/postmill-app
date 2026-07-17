import { describe, it, expect, beforeEach } from 'vitest';
import { EmptyAdapter } from '../email.adapter';

describe('EmptyAdapter', () => {
  let adapter: EmptyAdapter;

  beforeEach(() => {
    adapter = new EmptyAdapter();
  });

  describe('metadata', () => {
    it('has name "empty"', () => {
      expect(adapter.name).toBe('empty');
    });

    it('has all capabilities disabled', () => {
      expect(adapter.capabilities).toEqual({
        webhooks: false,
        openTracking: false,
        clickTracking: false,
      });
    });

    it('has empty requiredEnvKeys', () => {
      expect(adapter.requiredEnvKeys).toEqual([]);
    });
  });

  describe('isConfigured', () => {
    it('always returns false', () => {
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('send', () => {
    it('returns an empty object', async () => {
      const result = await adapter.send({
        to: 'test@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
        fromName: 'Test',
        fromAddress: 'noreply@example.com',
      });
      expect(result).toEqual({});
    });
  });

  describe('optional methods', () => {
    it('does not have verifyWebhook', () => {
      expect((adapter as any).verifyWebhook).toBeUndefined();
    });

    it('does not have parseWebhook', () => {
      expect((adapter as any).parseWebhook).toBeUndefined();
    });
  });
});
