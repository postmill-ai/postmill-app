import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, HttpException } from '@nestjs/common';

const sendMock = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => sendMock(...args) },
  isInngestEnabled: () => true,
}));

import { CommsWebhooksController } from './comms-webhooks.controller';

const makeReq = (body: any, headers: Record<string, string> = {}) =>
  ({
    rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    headers,
  }) as any;

describe('CommsWebhooksController', () => {
  let controller: CommsWebhooksController;
  let configs: any;
  let configService: any;
  let platform: any;
  let adapter: any;

  const config = { id: 'cfg-1', organizationId: 'org-1', enabled: true };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseInbound: vi.fn().mockReturnValue([]),
    };
    configs = { getByWebhookToken: vi.fn().mockResolvedValue(config) };
    configService = { resolveAdapter: vi.fn().mockResolvedValue(adapter) };
    platform = { handle: vi.fn().mockResolvedValue({ events: [], ack: undefined }) };
    controller = new CommsWebhooksController(configs, configService, platform);
  });

  it('404s uniformly for unknown tokens, disabled configs, and resolve failures', async () => {
    configs.getByWebhookToken.mockResolvedValue(null);
    await expect(
      controller.handle('telegram', 'nope', makeReq({})),
    ).rejects.toMatchObject({ status: 404 });

    configs.getByWebhookToken.mockResolvedValue({ ...config, enabled: false });
    await expect(
      controller.handle('telegram', 'tok', makeReq({})),
    ).rejects.toMatchObject({ status: 404 });

    configs.getByWebhookToken.mockResolvedValue(config);
    configService.resolveAdapter.mockRejectedValue(new Error('gone'));
    await expect(
      controller.handle('telegram', 'tok', makeReq({})),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('401s on a bad signature and enqueues nothing', async () => {
    adapter.verifyWebhook.mockReturnValue(false);
    await expect(
      controller.handle('telegram', 'tok', makeReq({})),
    ).rejects.toMatchObject({ status: 401 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('echoes a Slack url_verification challenge without enqueueing', async () => {
    adapter.parseInbound.mockReturnValue([
      { kind: 'challenge', ackResponse: { challenge: 'abc' } },
    ]);
    const result = await controller.handle('slack', 'tok', makeReq({}));
    expect(result).toEqual({ challenge: 'abc' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns a Discord command ack while enqueueing the message', async () => {
    adapter.parseInbound.mockReturnValue([
      {
        kind: 'message',
        externalUserId: 'U1',
        text: 'hi',
        messageId: 'int-1',
        ackResponse: { type: 4, data: { content: 'Working on it…', flags: 64 } },
      },
    ]);
    const result: any = await controller.handle('discord', 'tok', makeReq({}));
    expect(result.type).toBe(4);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [events] = sendMock.mock.calls[0];
    expect(events[0]).toMatchObject({
      name: 'comms/inbound.message',
      id: 'comms-inbound:cfg-1:int-1',
      data: {
        configId: 'cfg-1',
        organizationId: 'org-1',
        identifier: 'discord',
        externalUserId: 'U1',
        text: 'hi',
      },
    });
  });

  it('enqueues plain messages with dedupe ids and returns ok', async () => {
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: '777', externalChannelId: '777', text: 'yo', messageId: '777:5' },
      { kind: 'ignore' },
    ]);
    const result = await controller.handle('telegram', 'tok', makeReq({}));
    expect(result).toEqual({ ok: true });
    const [events] = sendMock.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('comms-inbound:cfg-1:777:5');
  });

  it('drops message events missing a sender or text', async () => {
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', text: 'no sender' },
      { kind: 'message', externalUserId: 'U1' },
    ]);
    const result = await controller.handle('telegram', 'tok', makeReq({}));
    expect(result).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  describe('platform route', () => {
    it('delegates to the platform service, enqueues its events, and returns the ack', async () => {
      platform.handle.mockResolvedValue({
        events: [
          {
            name: 'comms/inbound.message',
            id: 'comms-inbound:cfg-9:m-1',
            data: {
              configId: 'cfg-9',
              organizationId: 'org-9',
              identifier: 'slack',
              externalUserId: 'U1',
              text: 'hi',
              messageId: 'm-1',
            },
          },
        ],
        ack: undefined,
      });
      const req = makeReq({ team_id: 'T1' }, { 'x-slack-signature': 'v0=abc' });
      const result = await controller.handlePlatform('slack', req);
      expect(platform.handle).toHaveBeenCalledWith(
        'slack',
        req.rawBody,
        req.headers,
      );
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });

    it('returns a challenge ack without sending events', async () => {
      platform.handle.mockResolvedValue({
        events: [],
        ack: { challenge: 'abc' },
      });
      const result = await controller.handlePlatform('slack', makeReq({}));
      expect(result).toEqual({ challenge: 'abc' });
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('propagates the service 404/401 discipline', async () => {
      platform.handle.mockRejectedValue(new NotFoundException());
      await expect(
        controller.handlePlatform('matrix', makeReq({})),
      ).rejects.toMatchObject({ status: 404 });
      platform.handle.mockRejectedValue(new HttpException('invalid signature', 401));
      await expect(
        controller.handlePlatform('slack', makeReq({})),
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
