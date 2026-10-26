import { describe, expect, it, vi } from 'vitest';
import { minimaxAiModule } from './ai.adapter';

describe('minimax AI adapter', () => {
  it('uses IPv4 for credential validation and model listing', async () => {
    const safeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'MiniMax-M2' }] }), { status: 200 }),
    );
    const adapter: any = minimaxAiModule.create({ fetch: safeFetch } as any);

    await adapter.validateCredentials({ apiKey: 'minimax-key' });
    await adapter.listModels({ apiKey: 'minimax-key' });

    expect(safeFetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of safeFetch.mock.calls) {
      expect(url).toBe('https://api.minimax.io/v1/models');
      expect(init).toEqual(expect.objectContaining({ ipFamily: 4 }));
    }
  });
});
