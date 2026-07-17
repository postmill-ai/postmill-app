import { describe, it, expect, vi } from 'vitest';
import { CampaignsController } from './campaigns.controller';

describe('CampaignsController.list — J2 pagination cap', () => {
  const org = { id: 'org-1' } as any;

  const make = (count: number) => {
    const all = Array.from({ length: count }, (_, i) => ({ id: `c-${i}` }));
    const campaignsService = {
      listPaged: vi.fn(async (_orgId: string, take: number, skip: number) =>
        all.slice(skip, skip + take)
      ),
    };
    const ctrl = new (CampaignsController as any)(
      campaignsService,
      {},
      {},
      {}
    );
    return { ctrl, all, campaignsService };
  };

  it('caps the default (no paging params) at the hard max', async () => {
    const { ctrl, campaignsService } = make(250);
    const res = await ctrl.list(org);
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(100);
    expect(campaignsService.listPaged).toHaveBeenCalledWith(org.id, 100, 0);
  });

  it('honours an explicit limit and clamps it to the max', async () => {
    const { ctrl, campaignsService } = make(250);
    expect(await ctrl.list(org, '10')).toHaveLength(10);
    expect(await ctrl.list(org, '999')).toHaveLength(100); // clamped
    expect(campaignsService.listPaged).toHaveBeenCalledWith(org.id, 10, 0);
    expect(campaignsService.listPaged).toHaveBeenCalledWith(org.id, 100, 0);
  });

  it('applies the cursor offset', async () => {
    const { ctrl, all, campaignsService } = make(250);
    const page2 = await ctrl.list(org, '5', '100');
    expect(page2).toHaveLength(5);
    expect(page2[0].id).toBe(all[100].id);
    expect(campaignsService.listPaged).toHaveBeenCalledWith(org.id, 5, 100);
  });

  it('returns the full set unchanged when it is under the cap', async () => {
    const { ctrl, all, campaignsService } = make(7);
    expect(await ctrl.list(org)).toEqual(all);
    expect(campaignsService.listPaged).toHaveBeenCalledWith(org.id, 100, 0);
  });
});
