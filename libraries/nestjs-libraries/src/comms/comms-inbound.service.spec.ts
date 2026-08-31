import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsInboundService, CommsInboundEvent } from './comms-inbound.service';

const EVENT: CommsInboundEvent = {
  configId: 'cfg-1',
  organizationId: 'org-1',
  identifier: 'telegram',
  externalUserId: '777',
  externalChannelId: '777',
  text: 'hello agent',
  messageId: '777:1',
};

describe('CommsInboundService', () => {
  let service: CommsInboundService;
  let configs: any;
  let configService: any;
  let links: any;
  let linkService: any;
  let agentActivity: any;
  let notificationService: any;
  let adapter: any;

  beforeEach(() => {
    adapter = {
      sendDirectMessage: vi.fn().mockResolvedValue({}),
      fetchIdentity: vi.fn().mockResolvedValue({ displayName: 'Maya' }),
      pollInbound: vi.fn(),
    };
    configs = {
      getById: vi.fn().mockResolvedValue({
        id: 'cfg-1',
        organizationId: 'org-1',
        syncCursor: 's-1',
      }),
      getEnabledByIdentifier: vi.fn().mockResolvedValue([]),
      updateSyncCursor: vi.fn().mockResolvedValue({ count: 1 }),
    };
    configService = { resolveAdapter: vi.fn().mockResolvedValue(adapter) };
    links = {
      getByExternalUser: vi.fn().mockResolvedValue(null),
      setExternalChannelId: vi.fn().mockResolvedValue({ count: 1 }),
    };
    linkService = { claimCode: vi.fn().mockResolvedValue(null) };
    agentActivity = {
      generateReply: vi.fn().mockResolvedValue({ text: 'agent says hi' }),
    };
    notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
    service = new CommsInboundService(
      configs,
      configService,
      links,
      linkService,
      agentActivity,
      notificationService,
    );
  });

  describe('connect-code claims', () => {
    it('claims a bare code, confirms in-chat, and notifies the linked user in-app', async () => {
      linkService.claimCode.mockResolvedValue({ id: 'link-1', userId: 'user-1' });
      const result = await service.process({ ...EVENT, text: ' abcd2345 ' });
      expect(result.handled).toBe('claimed');
      expect(linkService.claimCode).toHaveBeenCalledWith('cfg-1', 'abcd2345', {
        externalUserId: '777',
        externalDisplayName: 'Maya',
        externalChannelId: '777',
      });
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('linked') }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserIds: ['user-1'],
          channels: { comms: false },
        }),
      );
    });

    it('recognizes "link CODE" and "/postmill link CODE" forms', async () => {
      linkService.claimCode.mockResolvedValue({ id: 'link-1', userId: 'user-1' });
      await service.process({ ...EVENT, text: 'link ABCD2345' });
      await service.process({ ...EVENT, text: '/postmill link ABCD2345' });
      expect(linkService.claimCode).toHaveBeenCalledTimes(2);
    });

    it('replies with a failure message on an invalid/expired code', async () => {
      const result = await service.process({ ...EVENT, text: 'ABCD2345' });
      expect(result.handled).toBe('claim_failed');
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('invalid') }),
      );
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('agent turns', () => {
    it('silently ignores unknown senders', async () => {
      const result = await service.process(EVENT);
      expect(result.handled).toBe('ignored_unknown_sender');
      expect(adapter.sendDirectMessage).not.toHaveBeenCalled();
      expect(agentActivity.generateReply).not.toHaveBeenCalled();
    });

    it('replies statically when agent chat is disabled for the link', async () => {
      links.getByExternalUser.mockResolvedValue({
        id: 'link-1',
        userId: 'user-1',
        agentChatEnabled: false,
        externalChannelId: '777',
      });
      const result = await service.process(EVENT);
      expect(result.handled).toBe('agent_disabled');
      expect(agentActivity.generateReply).not.toHaveBeenCalled();
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining('disabled') }),
      );
    });

    it('runs an agent turn as the linked user and replies with its text', async () => {
      links.getByExternalUser.mockResolvedValue({
        id: 'link-1',
        userId: 'user-1',
        agentChatEnabled: true,
        externalChannelId: '777',
      });
      const result = await service.process(EVENT);
      expect(result.handled).toBe('agent_reply');
      expect(agentActivity.generateReply).toHaveBeenCalledWith({
        orgId: 'org-1',
        userId: 'user-1',
        linkId: 'link-1',
        externalThreadKey: '777',
        text: 'hello agent',
      });
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'agent says hi' }),
      );
    });

    it('persists a newly learned channel id on inbound', async () => {
      links.getByExternalUser.mockResolvedValue({
        id: 'link-1',
        userId: 'user-1',
        agentChatEnabled: true,
        externalChannelId: null,
      });
      await service.process(EVENT);
      expect(links.setExternalChannelId).toHaveBeenCalledWith('link-1', '777');
    });
  });

  describe('pollConfig (matrix)', () => {
    it('polls from the stored cursor, persists the new one, filters non-messages', async () => {
      adapter.pollInbound.mockResolvedValue({
        messages: [
          { kind: 'message', externalUserId: '@a:hs', text: 'hi', messageId: '$1' },
          { kind: 'ignore' },
        ],
        nextCursor: 's-2',
      });
      const result = await service.pollConfig('org-1', 'cfg-1', 'matrix');
      expect(adapter.pollInbound).toHaveBeenCalledWith('s-1');
      expect(configs.updateSyncCursor).toHaveBeenCalledWith('cfg-1', 's-2');
      expect(result.messages).toHaveLength(1);
    });

    it('refuses a config from another org', async () => {
      configs.getById.mockResolvedValue({ id: 'cfg-1', organizationId: 'other-org' });
      const result = await service.pollConfig('org-1', 'cfg-1', 'matrix');
      expect(result.messages).toEqual([]);
      expect(adapter.pollInbound).not.toHaveBeenCalled();
    });
  });
});
