import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { CommsPlatformWebhookService } from './comms-platform-webhook.service';
import { getTelegramPlatformWebhookSecret } from './comms-platform-env';

const ENV_VARS = [
  'SLACK_ID',
  'SLACK_SECRET',
  'SLACK_SIGNING_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_PUBLIC_KEY',
  'TELEGRAM_TOKEN',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
];
const saved: Record<string, string | undefined> = Object.fromEntries(
  ENV_VARS.map((v) => [v, process.env[v]]),
);

const config = { id: 'cfg-1', organizationId: 'org-1', enabled: true };

describe('CommsPlatformWebhookService', () => {
  let service: CommsPlatformWebhookService;
  let configs: any;
  let links: any;
  let resolution: any;
  let adapter: any;

  const body = (payload: any) => Buffer.from(JSON.stringify(payload));

  beforeEach(() => {
    vi.clearAllMocks();
    for (const v of ENV_VARS) delete process.env[v];
    adapter = {
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseInbound: vi.fn().mockReturnValue([]),
    };
    configs = {
      findByExtraConfigTeamId: vi.fn().mockResolvedValue(null),
      findByGuildId: vi.fn().mockResolvedValue(null),
    };
    links = {
      findOrgByExternalUser: vi.fn().mockResolvedValue(null),
      findPendingByCode: vi.fn().mockResolvedValue(null),
    };
    resolution = { resolveComms: vi.fn().mockReturnValue(adapter) };
    service = new CommsPlatformWebhookService(configs, links, resolution);
  });

  afterAll(() => {
    for (const v of ENV_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it('404s for unknown providers and unconfigured platform apps', async () => {
    await expect(service.handle('matrix', body({}), {})).rejects.toMatchObject({
      status: 404,
    });
    // Known provider, but the platform env app is absent — same uniform 404.
    await expect(service.handle('slack', body({}), {})).rejects.toMatchObject({
      status: 404,
    });
  });

  it('401s on a bad signature and resolves nothing', async () => {
    process.env.TELEGRAM_TOKEN = 'tg-1';
    adapter.verifyWebhook.mockReturnValue(false);
    await expect(service.handle('telegram', body({}), {})).rejects.toMatchObject({
      status: 401,
    });
    expect(links.findOrgByExternalUser).not.toHaveBeenCalled();
  });

  it('passes the derived webhook secret to the telegram adapter', async () => {
    process.env.TELEGRAM_TOKEN = 'tg-1';
    await service.handle('telegram', body({}), {});
    expect(resolution.resolveComms).toHaveBeenCalledWith('telegram', {
      version: 'v1',
      credentials: {
        botToken: 'tg-1',
        webhookSecret: getTelegramPlatformWebhookSecret(),
      },
      orgId: 'platform',
    });
  });

  it('acks a Slack url_verification challenge before any org resolution', async () => {
    process.env.SLACK_ID = 'sid';
    process.env.SLACK_SECRET = 'ssec';
    process.env.SLACK_SIGNING_SECRET = 'ssign';
    adapter.parseInbound.mockReturnValue([
      { kind: 'challenge', ackResponse: { challenge: 'abc' } },
    ]);
    const result = await service.handle('slack', body({ type: 'url_verification' }), {});
    expect(result).toEqual({ events: [], ack: { challenge: 'abc' } });
    expect(configs.findByExtraConfigTeamId).not.toHaveBeenCalled();
  });

  it('acks a Discord PING (type 1) the same way', async () => {
    process.env.DISCORD_CLIENT_ID = 'app';
    process.env.DISCORD_BOT_TOKEN = 'bot';
    process.env.DISCORD_PUBLIC_KEY = 'pk';
    adapter.parseInbound.mockReturnValue([
      { kind: 'challenge', ackResponse: { type: 1 } },
    ]);
    const result = await service.handle('discord', body({ type: 1 }), {});
    expect(result).toEqual({ events: [], ack: { type: 1 } });
  });

  it('resolves slack orgs by team_id and emits the inbound event', async () => {
    process.env.SLACK_ID = 'sid';
    process.env.SLACK_SECRET = 'ssec';
    process.env.SLACK_SIGNING_SECRET = 'ssign';
    configs.findByExtraConfigTeamId.mockResolvedValue(config);
    adapter.parseInbound.mockReturnValue([
      {
        kind: 'message',
        externalUserId: 'U1',
        externalChannelId: 'D1',
        text: 'hello',
        messageId: 'Ev1',
      },
    ]);
    const result = await service.handle(
      'slack',
      body({ type: 'event_callback', team_id: 'T1', event_id: 'Ev1' }),
      {},
    );
    expect(configs.findByExtraConfigTeamId).toHaveBeenCalledWith('slack', 'T1');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      name: 'comms/inbound.message',
      id: 'comms-inbound:cfg-1:Ev1',
      data: {
        configId: 'cfg-1',
        organizationId: 'org-1',
        identifier: 'slack',
        externalUserId: 'U1',
        externalChannelId: 'D1',
        text: 'hello',
      },
    });
  });

  it('ack-ignores slack events from an unknown team', async () => {
    process.env.SLACK_ID = 'sid';
    process.env.SLACK_SECRET = 'ssec';
    process.env.SLACK_SIGNING_SECRET = 'ssign';
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: 'U1', text: 'hi', messageId: 'm1' },
    ]);
    const result = await service.handle('slack', body({ team_id: 'T9' }), {});
    expect(result.events).toHaveLength(0);
    expect(result.ack).toBeUndefined();
  });

  it('resolves discord orgs by guild_id', async () => {
    process.env.DISCORD_CLIENT_ID = 'app';
    process.env.DISCORD_BOT_TOKEN = 'bot';
    process.env.DISCORD_PUBLIC_KEY = 'pk';
    configs.findByGuildId.mockResolvedValue(config);
    adapter.parseInbound.mockReturnValue([
      {
        kind: 'message',
        externalUserId: 'user-1',
        text: 'hi',
        messageId: 'int-1',
        ackResponse: { type: 4, data: { content: 'working', flags: 64 } },
      },
    ]);
    const result = await service.handle('discord', body({ guild_id: 'g-1' }), {});
    expect(configs.findByGuildId).toHaveBeenCalledWith('discord', 'g-1');
    expect(result.events).toHaveLength(1);
    // The slash-command interaction ack must survive to the controller.
    expect(result.ack).toEqual({ type: 4, data: { content: 'working', flags: 64 } });
  });

  it('falls back to the link lookup for guild-less discord DMs', async () => {
    process.env.DISCORD_CLIENT_ID = 'app';
    process.env.DISCORD_BOT_TOKEN = 'bot';
    process.env.DISCORD_PUBLIC_KEY = 'pk';
    links.findOrgByExternalUser.mockResolvedValue({ config });
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: 'user-1', text: 'hi', messageId: 'int-2' },
    ]);
    const result = await service.handle('discord', body({}), {});
    expect(configs.findByGuildId).not.toHaveBeenCalled();
    expect(links.findOrgByExternalUser).toHaveBeenCalledWith('discord', 'user-1');
    expect(result.events[0].data.configId).toBe('cfg-1');
  });

  it('resolves telegram/line senders through the link tables', async () => {
    process.env.TELEGRAM_TOKEN = 'tg-1';
    links.findOrgByExternalUser.mockResolvedValue({ config });
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: '777', text: 'yo', messageId: '777:5' },
    ]);
    const result = await service.handle('telegram', body({}), {});
    expect(links.findOrgByExternalUser).toHaveBeenCalledWith('telegram', '777');
    expect(result.events[0].id).toBe('comms-inbound:cfg-1:777:5');
  });

  it('resolves an unclaimed connect code to the pending link config', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'cat';
    process.env.LINE_CHANNEL_SECRET = 'cs';
    const pendingConfig = { id: 'cfg-2', organizationId: 'org-2', enabled: true };
    links.findPendingByCode.mockResolvedValue({ config: pendingConfig });
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: 'U9', text: 'link abcd2345', messageId: 'm-9' },
    ]);
    const result = await service.handle('line', body({}), {});
    expect(links.findPendingByCode).toHaveBeenCalledWith('line', 'ABCD2345');
    expect(result.events[0]).toMatchObject({
      data: { configId: 'cfg-2', organizationId: 'org-2', text: 'link abcd2345' },
    });
  });

  it('ack-ignores unknown senders without a code', async () => {
    process.env.TELEGRAM_TOKEN = 'tg-1';
    adapter.parseInbound.mockReturnValue([
      { kind: 'message', externalUserId: '999', text: 'random chat', messageId: 'm-3' },
    ]);
    const result = await service.handle('telegram', body({}), {});
    expect(result.events).toHaveLength(0);
  });
});
