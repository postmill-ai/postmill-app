import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressvpnAdapter } from './vpn.adapter';

describe('ExpressvpnAdapter', () => {
  let adapter: ExpressvpnAdapter;

  beforeEach(() => {
    adapter = new ExpressvpnAdapter();
  });

  it('has identifier and name', () => {
    expect(adapter.identifier).toBe('expressvpn');
    expect(adapter.name).toBe('ExpressVPN');
  });

  it('requires activation code', () => {
    expect(adapter.validateConfig({}).valid).toBe(false);
    expect(adapter.validateConfig({ activationCode: '  ' }).valid).toBe(false);
    expect(adapter.validateConfig({ activationCode: 'ABCD-EFGH-IJKL-MNOP' }).valid).toBe(true);
  });

  it('rejects non-HTTPS config URLs', () => {
    expect(
      adapter.validateConfig({
        activationCode: 'ABCD-EFGH-IJKL-MNOP',
        configUrl: 'http://example.com/config',
      }).valid,
    ).toBe(false);
  });

  it('healthCheck returns ok', async () => {
    const result = await adapter.healthCheck!({ activationCode: 'ABCD' });
    expect(result.ok).toBe(true);
  });
});
