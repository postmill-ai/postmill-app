import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatrixCommsAdapter, matrixCommsModule } from './comms.adapter';

const fetchMock = vi.fn();
const ctx = {
  credentials: {
    homeserverUrl: 'https://matrix.example.org',
    accessToken: 'syt_token',
  },
  fetch: fetchMock,
} as any;

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any;

describe('MatrixCommsAdapter', () => {
  let adapter: MatrixCommsAdapter;

  beforeEach(() => {
    adapter = new MatrixCommsAdapter(ctx);
    vi.clearAllMocks();
  });

  it('declares its manifest and poll-based inbound', () => {
    expect(matrixCommsModule.manifest.domain).toBe('comms');
    expect(matrixCommsModule.manifest.providerId).toBe('matrix');
    expect(adapter.capabilities.pollInbound).toBe(true);
    expect(adapter.capabilities.webhookInbound).toBe(false);
  });

  it('rejects a non-https homeserver', async () => {
    const bad = new MatrixCommsAdapter({
      ...ctx,
      credentials: { homeserverUrl: 'http://internal', accessToken: 'x' },
    });
    await expect(
      bad.sendDirectMessage({ externalUserId: '@u:hs', text: 'x' }),
    ).rejects.toThrow('https');
  });

  describe('pollInbound', () => {
    it('primes on a null cursor: stores next_batch, emits nothing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ next_batch: 's-1' }));
      const result = await adapter.pollInbound();
      expect(result).toEqual({ messages: [], nextCursor: 's-1' });
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('timeout=0');
      expect(url).not.toContain('since=');
      expect(decodeURIComponent(url)).toContain('"limit":0');
    });

    it('maps timeline messages and drops its own and non-text events', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ user_id: '@bot:hs' })) // whoami
        .mockResolvedValueOnce(
          jsonResponse({
            next_batch: 's-2',
            rooms: {
              join: {
                '!room:hs': {
                  timeline: {
                    events: [
                      {
                        type: 'm.room.message',
                        sender: '@alice:hs',
                        event_id: '$e1',
                        content: { msgtype: 'm.text', body: 'hello' },
                      },
                      {
                        type: 'm.room.message',
                        sender: '@bot:hs',
                        event_id: '$e2',
                        content: { msgtype: 'm.text', body: 'echo' },
                      },
                      {
                        type: 'm.room.message',
                        sender: '@alice:hs',
                        event_id: '$e3',
                        content: { msgtype: 'm.image', body: 'pic' },
                      },
                    ],
                  },
                },
              },
            },
          }),
        );
      const result = await adapter.pollInbound('s-1');
      expect(result.nextCursor).toBe('s-2');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toMatchObject({
        kind: 'message',
        externalUserId: '@alice:hs',
        externalChannelId: '!room:hs',
        text: 'hello',
        messageId: '$e1',
      });
      expect(fetchMock.mock.calls[1][0]).toContain('since=s-1');
    });
  });

  describe('sendDirectMessage', () => {
    it('creates a direct room when none is known', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ room_id: '!new:hs' }))
        .mockResolvedValueOnce(jsonResponse({ event_id: '$sent' }));
      const result = await adapter.sendDirectMessage({
        externalUserId: '@alice:hs',
        text: 'hi',
      });
      expect(fetchMock.mock.calls[0][0]).toContain('/createRoom');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        is_direct: true,
        invite: ['@alice:hs'],
      });
      expect(fetchMock.mock.calls[1][0]).toContain(
        `/rooms/${encodeURIComponent('!new:hs')}/send/m.room.message/`,
      );
      expect(result).toEqual({ messageId: '$sent', externalChannelId: '!new:hs' });
    });

    it('reuses a known room', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ event_id: '$sent' }));
      await adapter.sendDirectMessage({
        externalUserId: '@alice:hs',
        externalChannelId: '!room:hs',
        text: 'hi',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        msgtype: 'm.text',
        body: 'hi',
      });
    });
  });
});
