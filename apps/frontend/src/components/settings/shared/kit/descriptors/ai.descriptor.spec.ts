import { describe, it, expect } from 'vitest';
import { aiDescriptor } from './ai.descriptor';

// Base URL must be renderable for every provider whose adapter declares it —
// regional/MaaS endpoints (Qwen Cloud, MiniMax China) are entered there. The
// old BASE_URL_PROVIDERS gate hid it for all hosted providers and caused
// misleading "Invalid API key" failures.
describe('aiDescriptor base URL handling', () => {
  const fields = [
    { key: 'apiKey', label: 'API Key', type: 'password' as const, required: true },
    { key: 'baseURL', label: 'Base URL', type: 'string' as const, required: false },
  ];

  it('passes baseURL through for hosted providers (qwen/minimax)', () => {
    for (const identifier of ['qwen', 'minimax', 'openai']) {
      const meta: any = { identifier, credentialFields: fields };
      const out = aiDescriptor.form.credentialFieldsFromMeta!(meta);
      expect(out.map((f) => f.key)).toEqual(['apiKey', 'baseURL']);
    }
  });

  it('has no filterCredentialFields gate', () => {
    expect(aiDescriptor.form.filterCredentialFields).toBeUndefined();
  });

  it('seedState prefills non-secret stored credentials (baseURL)', () => {
    const seeded = aiDescriptor.form.seedState!({
      credentials: { baseURL: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1' },
    } as any);
    expect(seeded.credentials).toEqual({
      baseURL: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
    });
  });

  it('seedState tolerates a provider with no stored credentials', () => {
    const seeded = aiDescriptor.form.seedState!({} as any);
    expect(seeded.credentials).toEqual({});
  });
});
