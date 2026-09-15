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
  let gate: any;
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
    gate = {
      getPending: vi.fn().mockResolvedValue(null),
      clearPending: vi.fn().mockResolvedValue(undefined),
    };
    agentActivity = {
      generateReply: vi.fn().mockResolvedValue({ text: 'agent says hi', threadId: 'comms:link-1:777' }),
      threadId: vi.fn((linkId: string, key: string) => `comms:${linkId}:${key}`),
      runConfirmedAction: vi.fn().mockResolvedValue({ ok: true, result: { output: ['post-1'] } }),
      recordExchange: vi.fn().mockResolvedValue(undefined),
    };
    notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
    service = new CommsInboundService(
      configs,
      configService,
      links,
      linkService,
      agentActivity,
      notificationService,
      gate,
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

    it('hints the link format to an unknown sender whose message looks like a link attempt', async () => {
      for (const text of [
        '<@U123> link ABCD2345',
        'link ABCD2345 please',
        'ABCD2345 is my code',
        'how do I link?',
      ]) {
        adapter.sendDirectMessage.mockClear();
        const result = await service.process({ ...EVENT, text });
        expect(result.handled).toBe('link_hint_unknown_sender');
        expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            externalUserId: EVENT.externalUserId,
            text: expect.stringContaining('link ABCD2345'),
          }),
        );
      }
      expect(agentActivity.generateReply).not.toHaveBeenCalled();
      expect(linkService.claimCode).not.toHaveBeenCalled();
    });

    it('stays silent for unknown senders whose text merely contains 8-letter words', async () => {
      for (const text of ['see you thursday', 'whatever you say', 'STANDARD payments']) {
        const result = await service.process({ ...EVENT, text });
        expect(result.handled).toBe('ignored_unknown_sender');
      }
      expect(adapter.sendDirectMessage).not.toHaveBeenCalled();
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

  describe('chat-app confirmations (YES/NO gate)', () => {
    const linked = { id: 'link-1', userId: 'user-1', agentChatEnabled: true, externalChannelId: '777' };
    const pending = {
      confirmationId: 'abc123abc123',
      toolId: 'schedulePostTool',
      args: {},
      orgId: 'org-1',
      userId: 'user-1',
      linkId: 'link-1',
      threadId: 'comms:link-1:777',
      summary: '1 post(s): Schedule on channel int-1',
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    };

    beforeEach(() => {
      links.getByExternalUser.mockResolvedValue(linked);
    });

    it.each(['yes', 'Yes please', 'yep', 'ok', 'OK go', 'confirm', 'approve', 'do it'])(
      '"%s" with a pending action: clears it FIRST, runs it, replies with the outcome, no LLM turn',
      async (text) => {
        gate.getPending.mockResolvedValue(pending);
        const order: string[] = [];
        gate.clearPending.mockImplementation(async () => void order.push('clear'));
        agentActivity.runConfirmedAction.mockImplementation(async () => {
          order.push('run');
          return { ok: true, result: { output: ['post-1'] } };
        });

        const result = await service.process({ ...EVENT, text });

        expect(result.handled).toBe('confirmed_action');
        expect(order).toEqual(['clear', 'run']);
        expect(gate.clearPending).toHaveBeenCalledWith('comms:link-1:777');
        expect(agentActivity.runConfirmedAction).toHaveBeenCalledWith({
          orgId: 'org-1',
          userId: 'user-1',
          linkId: 'link-1',
          threadId: 'comms:link-1:777',
          pending,
        });
        expect(agentActivity.generateReply).not.toHaveBeenCalled();
        expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
          expect.objectContaining({ text: 'Done — 1 post(s) created.' }),
        );
        // The model's memory must reflect what happened in code.
        expect(agentActivity.recordExchange).toHaveBeenCalledWith({
          orgId: 'org-1',
          threadId: 'comms:link-1:777',
          userText: text,
          assistantText: expect.stringContaining('[Confirmed: 1 post(s): Schedule on channel int-1]'),
        });
      },
    );

    it('reports a failed confirmed action without leaking internals', async () => {
      gate.getPending.mockResolvedValue(pending);
      agentActivity.runConfirmedAction.mockResolvedValue({ ok: false, error: 'the action failed — please try again from the app' });
      const result = await service.process({ ...EVENT, text: 'yes' });
      expect(result.handled).toBe('confirmed_action_failed');
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("didn't go through") }),
      );
    });

    it('summarises tool errors returned by a confirmed run as "Not done"', async () => {
      gate.getPending.mockResolvedValue(pending);
      agentActivity.runConfirmedAction.mockResolvedValue({ ok: true, result: { errors: 'x: too long' } });
      await service.process({ ...EVENT, text: 'yes' });
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Not done — x: too long' }),
      );
    });

    it.each(['no', 'No thanks', 'nope', 'cancel', 'stop', 'abort'])(
      '"%s" with a pending action: clears it and replies Cancelled, nothing runs',
      async (text) => {
        gate.getPending.mockResolvedValue(pending);
        const result = await service.process({ ...EVENT, text });
        expect(result.handled).toBe('cancelled_action');
        expect(gate.clearPending).toHaveBeenCalledWith('comms:link-1:777');
        expect(agentActivity.runConfirmedAction).not.toHaveBeenCalled();
        expect(agentActivity.generateReply).not.toHaveBeenCalled();
        expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
          expect.objectContaining({ text: 'Cancelled — nothing was done.' }),
        );
        expect(agentActivity.recordExchange).toHaveBeenCalledWith(
          expect.objectContaining({
            threadId: 'comms:link-1:777',
            userText: text,
            assistantText: expect.stringContaining('[Cancelled:'),
          }),
        );
      },
    );

    it('any other text with a pending action: normal agent turn, action kept', async () => {
      gate.getPending.mockResolvedValue(pending);
      const result = await service.process({ ...EVENT, text: 'actually make it 11am' });
      expect(result.handled).toBe('agent_reply');
      expect(gate.clearPending).not.toHaveBeenCalled();
      expect(agentActivity.runConfirmedAction).not.toHaveBeenCalled();
      expect(agentActivity.generateReply).toHaveBeenCalled();
    });

    it('"yes" with nothing pending is just a normal message', async () => {
      const result = await service.process({ ...EVENT, text: 'yes' });
      expect(result.handled).toBe('agent_reply');
      expect(agentActivity.runConfirmedAction).not.toHaveBeenCalled();
      expect(agentActivity.generateReply).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'yes' }),
      );
    });

    it('always appends the exact parked action + YES/NO prompt when the turn parked something', async () => {
      agentActivity.generateReply.mockResolvedValue({
        text: 'I will schedule that post tomorrow at 10:00.',
        threadId: 'comms:link-1:777',
        pendingConfirmation: { toolId: 'schedulePostTool', summary: '1 post(s): Schedule on channel int-1 at 2026-09-15T10:00:00Z (UTC) — "hi"' },
      });
      await service.process({ ...EVENT, text: 'schedule a post' });
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text:
            'I will schedule that post tomorrow at 10:00.\n\nAction: 1 post(s): Schedule on channel int-1 at 2026-09-15T10:00:00Z (UTC) — "hi"\nReply YES to confirm or NO to cancel.',
        }),
      );
    });

    it("strips the model's own YES/NO sentence so the prompt appears once", async () => {
      agentActivity.generateReply.mockResolvedValue({
        text: 'Here is the plan. Please reply YES to confirm or NO to cancel.',
        threadId: 'comms:link-1:777',
        pendingConfirmation: { toolId: 'schedulePostTool', summary: 's' },
      });
      await service.process({ ...EVENT, text: 'schedule a post' });
      expect(adapter.sendDirectMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Here is the plan.\n\nAction: s\nReply YES to confirm or NO to cancel.' }),
      );
    });

    it('an unlinked sender saying "yes" is still ignored (no gate lookup)', async () => {
      links.getByExternalUser.mockResolvedValue(null);
      const result = await service.process({ ...EVENT, text: 'yes' });
      expect(result.handled).toBe('ignored_unknown_sender');
      expect(gate.getPending).not.toHaveBeenCalled();
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
