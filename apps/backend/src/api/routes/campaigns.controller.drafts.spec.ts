import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';

describe('CampaignsController draft approve/reject — CAMP-05', () => {
  const org = { id: 'org-1' } as any;
  const user = { id: 'u-1' } as any;

  const make = () => {
    const postsService = {
      getPostById: vi.fn(),
      approveDraft: vi.fn().mockResolvedValue({ approved: true }),
      rejectDraft: vi.fn().mockResolvedValue({ rejected: true }),
    };
    const ctrl = new (CampaignsController as any)(
      {},
      {},
      postsService,
      {},
      {},
      {},
    );
    return { ctrl, postsService };
  };

  it('approves a draft that belongs to the campaign', async () => {
    const { ctrl, postsService } = make();
    postsService.getPostById.mockResolvedValue({ id: 'p-1', campaignId: 'c-1' });

    await expect(ctrl.approveDraft(org, user, 'c-1', 'p-1')).resolves.toEqual({ approved: true });
    expect(postsService.getPostById).toHaveBeenCalledWith('p-1', 'org-1');
    expect(postsService.approveDraft).toHaveBeenCalledWith('org-1', 'p-1', 'u-1');
  });

  it('rejects a draft that belongs to the campaign', async () => {
    const { ctrl, postsService } = make();
    postsService.getPostById.mockResolvedValue({ id: 'p-1', campaignId: 'c-1' });

    await expect(ctrl.rejectDraft(org, user, 'c-1', 'p-1')).resolves.toEqual({ rejected: true });
    expect(postsService.rejectDraft).toHaveBeenCalledWith('org-1', 'p-1', 'u-1');
  });

  it('throws ForbiddenException when approving a draft from another campaign', async () => {
    const { ctrl, postsService } = make();
    postsService.getPostById.mockResolvedValue({ id: 'p-1', campaignId: 'c-other' });

    await expect(ctrl.approveDraft(org, user, 'c-1', 'p-1')).rejects.toThrow(ForbiddenException);
    expect(postsService.approveDraft).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when rejecting a draft from another campaign', async () => {
    const { ctrl, postsService } = make();
    postsService.getPostById.mockResolvedValue({ id: 'p-1', campaignId: 'c-other' });

    await expect(ctrl.rejectDraft(org, user, 'c-1', 'p-1')).rejects.toThrow(ForbiddenException);
    expect(postsService.rejectDraft).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the post does not exist', async () => {
    const { ctrl, postsService } = make();
    postsService.getPostById.mockResolvedValue(null);

    await expect(ctrl.approveDraft(org, user, 'c-1', 'p-missing')).rejects.toThrow(ForbiddenException);
    expect(postsService.approveDraft).not.toHaveBeenCalled();
  });
});
