import { describe, it, expect, vi } from 'vitest';
import {
  fetchOpenAIStyleModels,
  mergeLiveModels,
  heuristicModelInfo,
  type LiveModelEntry,
} from '../domains/ai-helpers';
import type { AiCapabilities, AiModelInfo } from '../domains/ai';

const TEXT_CAPS: AiCapabilities = {
  text: true,
  image: false,
  vision: false,
  embeddings: false,
  speech: false,
  tools: true,
};

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe('fetchOpenAIStyleModels', () => {
  it('returns null without safeFetch, baseURL, or apiKey', async () => {
    const fetch = vi.fn();
    expect(await fetchOpenAIStyleModels(undefined, 'https://x/v1', 'k')).toBeNull();
    expect(await fetchOpenAIStyleModels(fetch as any, undefined, 'k')).toBeNull();
    expect(await fetchOpenAIStyleModels(fetch as any, 'https://x/v1', undefined)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a {data: [...]} payload and carries name as label', async () => {
    const fetch = vi.fn().mockResolvedValue(
      okResponse({ data: [{ id: 'm-1', name: 'Model One' }, { id: 'm-2' }] }),
    );
    const result = await fetchOpenAIStyleModels(fetch as any, 'https://x/v1/', 'k');
    expect(result).toEqual([
      { id: 'm-1', label: 'Model One' },
      { id: 'm-2', label: undefined },
    ]);
    // trailing slash is normalized
    expect(fetch).toHaveBeenCalledWith('https://x/v1/models', {
      headers: { Authorization: 'Bearer k' },
    });
  });

  it('tolerates a bare-array payload', async () => {
    const fetch = vi.fn().mockResolvedValue(okResponse([{ id: 'a' }]));
    expect(await fetchOpenAIStyleModels(fetch as any, 'https://x/v1', 'k')).toEqual([
      { id: 'a', label: undefined },
    ]);
  });

  it('returns null on non-OK, transport error, and empty/unexpected payloads', async () => {
    const notOk = vi.fn().mockResolvedValue({ ok: false });
    expect(await fetchOpenAIStyleModels(notOk as any, 'https://x/v1', 'k')).toBeNull();

    const throwing = vi.fn().mockRejectedValue(new Error('Blocked URL'));
    expect(await fetchOpenAIStyleModels(throwing as any, 'https://x/v1', 'k')).toBeNull();

    const empty = vi.fn().mockResolvedValue(okResponse({ data: [] }));
    expect(await fetchOpenAIStyleModels(empty as any, 'https://x/v1', 'k')).toBeNull();

    const weird = vi.fn().mockResolvedValue(okResponse({ nope: true }));
    expect(await fetchOpenAIStyleModels(weird as any, 'https://x/v1', 'k')).toBeNull();
  });
});

describe('heuristicModelInfo', () => {
  it('classifies embedding, image, and speech-ish ids out of the text bucket', () => {
    expect(heuristicModelInfo('text-embedding-3-large', TEXT_CAPS).kind).toBe('embedding');
    expect(heuristicModelInfo('text-embedding-3-large', TEXT_CAPS).capabilities.text).toBe(false);

    const img = heuristicModelInfo('dall-e-3', TEXT_CAPS);
    expect(img.kind).toBe('image');
    expect(img.capabilities.image).toBe(true);
    expect(img.capabilities.text).toBe(false);

    const tts = heuristicModelInfo('openai/tts-1', TEXT_CAPS);
    expect(tts.kind).toBe('text');
    expect(tts.capabilities.text).toBe(false);
    expect(tts.capabilities.speech).toBe(true);

    const chat = heuristicModelInfo('gpt-5.2', TEXT_CAPS);
    expect(chat.capabilities.text).toBe(true);
    expect(chat.label).toBe('gpt-5.2');
  });
});

describe('mergeLiveModels', () => {
  const STATIC: AiModelInfo[] = [
    { id: 'deepseek-chat', label: 'DeepSeek-V3', kind: 'text', capabilities: TEXT_CAPS },
    {
      id: 'deepseek-reasoner',
      label: 'DeepSeek-R1',
      kind: 'text',
      capabilities: TEXT_CAPS,
      reasoning: true,
    },
  ];

  it('returns the static catalog unchanged on null/empty live', () => {
    expect(mergeLiveModels(null, STATIC, TEXT_CAPS)).toBe(STATIC);
    expect(mergeLiveModels([], STATIC, TEXT_CAPS)).toBe(STATIC);
  });

  it('keeps curated metadata for known ids and drops retired static entries', () => {
    const live: LiveModelEntry[] = [{ id: 'deepseek-reasoner' }, { id: 'deepseek-v4' }];
    const merged = mergeLiveModels(live, STATIC, TEXT_CAPS);

    expect(merged).toHaveLength(2);
    // curated entry keeps its label + reasoning flag
    expect(merged[0]).toBe(STATIC[1]);
    // live-only id gets heuristics; 'deepseek-chat' (absent upstream) is dropped
    expect(merged[1].id).toBe('deepseek-v4');
    expect(merged[1].capabilities.text).toBe(true);
    expect(merged.map((m) => m.id)).not.toContain('deepseek-chat');
  });

  it('honours explicit kind/capabilities overrides on live entries', () => {
    const live: LiveModelEntry[] = [
      {
        id: 'BAAI/bge-large-en-v1.5',
        kind: 'embedding',
        capabilities: { text: false, embeddings: true },
      },
    ];
    const merged = mergeLiveModels(live, STATIC, TEXT_CAPS);
    expect(merged[0].kind).toBe('embedding');
    expect(merged[0].capabilities.text).toBe(false);
    expect(merged[0].capabilities.embeddings).toBe(true);
    // untouched capability fields inherit the provider defaults
    expect(merged[0].capabilities.tools).toBe(true);
  });

  it('orders curated entries first, then live-only ids alphabetically, deduped', () => {
    const live: LiveModelEntry[] = [
      { id: 'z-model' },
      { id: 'deepseek-chat' },
      { id: 'a-model' },
      { id: 'a-model' },
    ];
    const merged = mergeLiveModels(live, STATIC, TEXT_CAPS);
    expect(merged.map((m) => m.id)).toEqual(['deepseek-chat', 'a-model', 'z-model']);
  });
});
