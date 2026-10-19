import { describe, it, expect, vi } from 'vitest';
import { postTextToSpeech } from './text-to-speech';

const called = (fetchMock: ReturnType<typeof vi.fn>) => {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/media/text-to-speech');
  return JSON.parse((init as RequestInit).body as string);
};

describe('postTextToSpeech', () => {
  it('posts the unchanged legacy payload when no provider is pinned', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    postTextToSpeech(fetchMock, { text: 'hello world', voiceId: 'v1' });
    expect(called(fetchMock)).toEqual({ text: 'hello world', voice: 'v1' });
  });

  it('keeps instructions but still no provider key when provider is empty', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    postTextToSpeech(fetchMock, { text: 'hi', voiceId: 'v1', instructions: 'warm', provider: '' });
    expect(called(fetchMock)).toEqual({ text: 'hi', voice: 'v1', instructions: 'warm' });
  });

  it('pins the provider only when one is picked', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    postTextToSpeech(fetchMock, { text: 'hi', voiceId: 'v9', provider: 'openai' });
    expect(called(fetchMock)).toEqual({ text: 'hi', voice: 'v9', provider: 'openai' });
  });
});
