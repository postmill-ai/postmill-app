import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('enables all flags by default', () => {
    const service = new FeatureFlagsService();
    expect(service.isEnabled('ai')).toBe(true);
    expect(service.isEnabled('mcp')).toBe(true);
    expect(service.isEnabled('media')).toBe(true);
  });

  it('disables a flag when its env var is set to true', () => {
    process.env.DEV_DISABLE_AI = 'true';
    const service = new FeatureFlagsService();
    expect(service.isEnabled('ai')).toBe(false);
    expect(service.isDisabled('ai')).toBe(true);
  });

  it('treats false and 0 as enabled', () => {
    process.env.DEV_DISABLE_AI = 'false';
    process.env.DEV_DISABLE_MCP = '0';
    const service = new FeatureFlagsService();
    expect(service.isEnabled('ai')).toBe(true);
    expect(service.isEnabled('mcp')).toBe(true);
  });
});
