import { describe, it, expect, vi } from 'vitest';
import { CampaignNoteService } from './campaign-note.service';

function makeService(overrides: any = {}) {
  const notes = {
    listForCampaign: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'n1' }),
    updateContent: vi.fn().mockResolvedValue({ count: 1 }),
    softDelete: vi.fn().mockResolvedValue({ count: 1 }),
    setPinned: vi.fn().mockResolvedValue({ count: 1 }),
    setResolved: vi.fn().mockResolvedValue({ count: 1 }),
    toggleReaction: vi.fn().mockResolvedValue({ reacted: true }),
    ...overrides.notes,
  };
  const campaigns = {
    get: vi.fn().mockResolvedValue({ id: 'c1', organizationId: 'org1' }),
    ...overrides.campaigns,
  };
  const users = {
    getPublicProfilesByIds: vi.fn().mockResolvedValue(new Map()),
  };
  const org = {
    getTeam: vi.fn().mockResolvedValue({
      users: [{ user: { id: 'u1' } }, { user: { id: 'u2' } }],
    }),
    ...overrides.org,
  };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };

  const service = new CampaignNoteService(
    notes as any,
    campaigns as any,
    users as any,
    org as any,
    notifications as any
  );
  return { service, notes, campaigns, org, notifications };
}

describe('CampaignNoteService', () => {
  it('sanitizes note HTML on create (strips <script>, keeps formatting/media)', async () => {
    const { service, notes } = makeService();
    await service.create({
      campaignId: 'c1',
      organizationId: 'org1',
      userId: 'u1',
      content:
        '<p>Hi <strong>team</strong></p><script>alert(1)</script><img src="https://x.test/a.png">',
    });
    const arg = notes.create.mock.calls[0][0];
    expect(arg.content).not.toContain('<script>');
    expect(arg.content).toContain('<strong>');
    expect(arg.content).toContain('<img');
  });

  it('rejects an empty note', async () => {
    const { service } = makeService();
    await expect(
      service.create({
        campaignId: 'c1',
        organizationId: 'org1',
        userId: 'u1',
        content: '<p></p>',
      })
    ).rejects.toThrow(/empty/i);
  });

  it('rejects a reply to a non-top-level note (one level deep)', async () => {
    const { service } = makeService({
      notes: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: 'p1', campaignId: 'c1', parentId: 'grandparent' }),
      },
    });
    await expect(
      service.create({
        campaignId: 'c1',
        organizationId: 'org1',
        userId: 'u1',
        content: '<p>reply</p>',
        parentId: 'p1',
      })
    ).rejects.toThrow(/one level/i);
  });

  it('only notifies mentioned ids that are real org members, never the author', async () => {
    const { service, notifications } = makeService();
    await service.create({
      campaignId: 'c1',
      organizationId: 'org1',
      userId: 'u1',
      content: '<p>hey</p>',
      mentions: ['u2', 'outsider-cross-org', 'u1'],
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const opts = notifications.notify.mock.calls[0][0];
    expect(opts.category).toBe('comments');
    expect(opts.targetUserIds).toEqual(['u2']); // outsider filtered, author removed
  });

  it('derives mentions from the note HTML when no mentions array is sent (replies/edits)', async () => {
    const { service, notifications, notes } = makeService();
    await service.create({
      campaignId: 'c1',
      organizationId: 'org1',
      userId: 'u1',
      content: '<p>hey <span data-mention-id="u2" data-mention-label="Bob">@Bob</span></p>',
      // no `mentions` array — simulates a reply/edit that only sends content
    });
    // persisted mentions include the HTML-derived member id
    expect(notes.create.mock.calls[0][0].mentions).toEqual(['u2']);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0].targetUserIds).toEqual(['u2']);
  });

  it('does not notify when there are no valid recipients', async () => {
    const { service, notifications } = makeService();
    await service.create({
      campaignId: 'c1',
      organizationId: 'org1',
      userId: 'u1',
      content: '<p>hey</p>',
      mentions: ['outsider'],
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('blocks editing a note you do not own (non-super-admin)', async () => {
    const { service } = makeService({
      notes: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: 'n1', campaignId: 'c1', createdById: 'someone-else' }),
      },
    });
    await expect(
      service.edit('n1', 'c1', 'org1', 'u1', false, '<p>x</p>')
    ).rejects.toThrow(/your own/i);
  });

  it('allows a super-admin to edit any note', async () => {
    const { service, notes } = makeService({
      notes: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: 'n1', campaignId: 'c1', createdById: 'someone-else' }),
      },
    });
    await service.edit('n1', 'c1', 'org1', 'admin', true, '<p>edited</p>');
    expect(notes.updateContent).toHaveBeenCalled();
  });

  it('rejects a campaign that is not in the org', async () => {
    const { service } = makeService({ campaigns: { get: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.create({
        campaignId: 'c1',
        organizationId: 'org1',
        userId: 'u1',
        content: '<p>hi</p>',
      })
    ).rejects.toThrow(/not found/i);
  });
});
