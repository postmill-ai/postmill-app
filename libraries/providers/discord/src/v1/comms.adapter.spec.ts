import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { DiscordCommsAdapter, discordCommsModule } from './comms.adapter';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// Raw 32-byte public key = last 32 bytes of the DER SPKI export.
const rawPublicKeyHex = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer)
  .subarray(-32)
  .toString('hex');

const signPayload = (timestamp: string, body: string) =>
  cryptoSign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey)
    .toString('hex');

const fetchMock = vi.fn();
const ctx = {
  credentials: {
    botToken: 'bot-token',
    applicationId: 'app-1',
    publicKey: rawPublicKeyHex,
  },
  fetch: fetchMock,
} as any;

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

describe('DiscordCommsAdapter', () => {
  let adapter: DiscordCommsAdapter;

  beforeEach(() => {
    adapter = new DiscordCommsAdapter(ctx);
    vi.clearAllMocks();
  });

  it('declares its manifest', () => {
    expect(discordCommsModule.manifest.domain).toBe('comms');
    expect(discordCommsModule.manifest.providerId).toBe('discord');
  });

  describe('verifyWebhook (ed25519)', () => {
    const body = JSON.stringify({ type: 1 });

    it('accepts a valid signature', () => {
      const ts = '1700000000';
      const headers = {
        'x-signature-ed25519': signPayload(ts, body),
        'x-signature-timestamp': ts,
      };
      expect(adapter.verifyWebhook(Buffer.from(body), headers)).toBe(true);
    });

    it('rejects a signature over different content', () => {
      const ts = '1700000000';
      const headers = {
        'x-signature-ed25519': signPayload(ts, '{"type":2}'),
        'x-signature-timestamp': ts,
      };
      expect(adapter.verifyWebhook(Buffer.from(body), headers)).toBe(false);
    });

    it('rejects missing headers or malformed keys', () => {
      expect(adapter.verifyWebhook(Buffer.from(body), {})).toBe(false);
      const badKeyAdapter = new DiscordCommsAdapter({
        ...ctx,
        credentials: { ...ctx.credentials, publicKey: 'zz' },
      });
      const ts = '1700000000';
      expect(
        badKeyAdapter.verifyWebhook(Buffer.from(body), {
          'x-signature-ed25519': signPayload(ts, body),
          'x-signature-timestamp': ts,
        }),
      ).toBe(false);
    });
  });

  describe('parseInbound', () => {
    it('answers PING with a type-1 pong challenge', () => {
      const [msg] = adapter.parseInbound(Buffer.from(JSON.stringify({ type: 1 })), {});
      expect(msg.kind).toBe('challenge');
      expect(msg.ackResponse).toEqual({ type: 1 });
    });

    it('maps a /postmill command to a message with an ephemeral type-4 ack', () => {
      const [msg] = adapter.parseInbound(
        Buffer.from(
          JSON.stringify({
            type: 2,
            id: 'int-1',
            data: { name: 'postmill', options: [{ name: 'message', value: 'hello' }] },
            user: { id: 'U1' },
          }),
        ),
        {},
      );
      expect(msg).toMatchObject({
        kind: 'message',
        externalUserId: 'U1',
        text: 'hello',
        messageId: 'int-1',
      });
      expect((msg.ackResponse as any).type).toBe(4);
      expect((msg.ackResponse as any).data.flags).toBe(64);
    });

    it('ignores other commands and interaction types', () => {
      expect(
        adapter.parseInbound(
          Buffer.from(JSON.stringify({ type: 2, data: { name: 'other' } })),
          {},
        )[0].kind,
      ).toBe('ignore');
      expect(
        adapter.parseInbound(Buffer.from(JSON.stringify({ type: 3 })), {})[0].kind,
      ).toBe('ignore');
    });
  });

  it('opens a DM channel and sends the message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'C9' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'M1' }));
    const result = await adapter.sendDirectMessage({ externalUserId: 'U1', text: 'hi' });
    expect(fetchMock.mock.calls[0][0]).toContain('/users/@me/channels');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ recipient_id: 'U1' });
    expect(fetchMock.mock.calls[1][0]).toContain('/channels/C9/messages');
    expect(result).toEqual({ messageId: 'M1', externalChannelId: 'C9' });
  });

  it('provisions the global /postmill command via POST (not PUT)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'cmd-1' }));
    await adapter.provision();
    expect(fetchMock.mock.calls[0][0]).toContain('/applications/app-1/commands');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      name: 'postmill',
      options: [{ name: 'message', required: true, type: 3, description: expect.any(String) }],
    });
  });
});
