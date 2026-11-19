import { describe, expect, it, vi } from 'vitest';
import { DesignShareRepository } from './design-share.repository';

const makeRepository = () => {
  const model = {
    design: { findFirst: vi.fn() },
    designShare: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    designShareComment: { create: vi.fn() },
  };
  return {
    model,
    repository: new DesignShareRepository(
      { model } as any,
      { model } as any,
      { model } as any,
    ),
  };
};

describe('DesignShareRepository', () => {
  it('resolves only enabled, unexpired shares whose design is not soft-deleted', async () => {
    const { model, repository } = makeRepository();
    const now = new Date('2026-11-19T00:00:00.000Z');
    model.designShare.findFirst.mockResolvedValue(null);

    await repository.findActiveByToken('token', now);

    expect(model.designShare.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        token: 'token',
        enabled: true,
        expiresAt: { gt: now },
        design: { deletedAt: null },
      },
    }));
  });

  it('scopes design and management reads by organization', async () => {
    const { model, repository } = makeRepository();
    await repository.findDesign('org-1', 'design-1');
    await repository.findShareByDesign('org-1', 'design-1');

    expect(model.design.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'design-1', organizationId: 'org-1', deletedAt: null },
    }));
    expect(model.designShare.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { designId: 'design-1', organizationId: 'org-1' },
    }));
  });

  it('does not replace an existing token on update', async () => {
    const { model, repository } = makeRepository();
    const expiresAt = new Date();
    await repository.saveShare('org-1', 'design-1', {
      token: 'new-token',
      enabled: false,
      commentsEnabled: true,
      expiresAt,
    });

    const call = model.designShare.upsert.mock.calls[0][0];
    expect(call.create.token).toBe('new-token');
    expect(call.update).toEqual({ enabled: false, commentsEnabled: true, expiresAt });
  });

  it('claims approval atomically only while unapproved', async () => {
    const { model, repository } = makeRepository();
    model.designShare.findFirst.mockResolvedValue({ id: 'share-1', comments: [] });
    const approvedAt = new Date();

    await repository.approveFirst('org-1', 'share-1', 'Client', approvedAt);

    expect(model.designShare.updateMany).toHaveBeenCalledWith({
      where: { id: 'share-1', organizationId: 'org-1', approvedAt: null },
      data: { approvedBy: 'Client', approvedAt },
    });
  });

  it('bounds comment lists to the latest 100 for chronological presentation', async () => {
    const { model, repository } = makeRepository();
    await repository.findShareByDesign('org-1', 'design-1');
    const call = model.designShare.findFirst.mock.calls[0][0];
    expect(call.include.comments.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.include.comments.take).toBe(100);
    expect(call.include.comments.select).not.toHaveProperty('organizationId');
  });
});
