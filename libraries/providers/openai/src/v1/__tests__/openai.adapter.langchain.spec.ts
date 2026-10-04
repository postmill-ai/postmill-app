import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../ai.adapter';

/**
 * POSTMILL-APP-T regression guard — the REAL @langchain/openai, unmocked.
 *
 * Every other spec mocks ChatOpenAI, which is why a breaking field rename in
 * @langchain/openai 1.x (`openAIApiKey` → `apiKey`, the old field silently
 * dropped) reached production as "Missing credentials" on invoke. This spec
 * constructs the real client and asserts the credential actually lands — no
 * network involved; construction-only.
 */
describe('OpenAIAdapter.createLangchainModel (real @langchain/openai)', () => {
  it('passes the apiKey through to the constructed ChatOpenAI', () => {
    const adapter = new OpenAIAdapter();
    const model = adapter.createLangchainModel(
      { apiKey: 'sk-test-construction-only' },
      'gpt-4.1',
    ) as any;
    expect(model.apiKey).toBe('sk-test-construction-only');
  });

  it('forwards baseURL/model/sampling options', () => {
    const adapter = new OpenAIAdapter();
    const model = adapter.createLangchainModel(
      { apiKey: 'sk-test-construction-only', baseURL: 'https://example.com/v1' },
      'gpt-4.1',
      { temperature: 0.5 },
    ) as any;
    expect(model.apiKey).toBe('sk-test-construction-only');
    expect(model.model).toBe('gpt-4.1');
    expect(model.temperature).toBe(0.5);
    expect(model.clientConfig?.baseURL).toBe('https://example.com/v1');
  });
});
