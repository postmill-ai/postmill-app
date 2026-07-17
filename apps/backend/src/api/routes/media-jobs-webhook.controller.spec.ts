import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaJobsWebhookController } from './media-jobs-webhook.controller';
import { mediaJobWebhookToken } from '@gitroom/nestjs-libraries/media/media-job-token';

function makeController() {
  const lifecycle = {
    getJobUnscoped: vi.fn(),
    processJob: vi.fn().mockResolvedValue('completed'),
  };
  const controller = new MediaJobsWebhookController(lifecycle as never);
  return { controller, lifecycle };
}

describe('MediaJobsWebhookController (§11.2 webhook completion)', () => {
  const originalJwt = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
  });

  it('processes the job when the org-bound token is valid', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getJobUnscoped.mockResolvedValue({ id: 'job-1', organizationId: 'org-1', status: 'pending' });

    const token = mediaJobWebhookToken('job-1', 'org-1');
    const result = await controller.handle('job-1', token);

    expect(lifecycle.processJob).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({ ok: true, status: 'completed' });
  });

  it('returns 404 for an unknown job', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getJobUnscoped.mockResolvedValue(null);

    await expect(controller.handle('nope', 'whatever')).rejects.toThrow('not found');
    expect(lifecycle.processJob).not.toHaveBeenCalled();
  });

  it('returns 404 for a bad token (no oracle difference)', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getJobUnscoped.mockResolvedValue({ id: 'job-1', organizationId: 'org-1', status: 'pending' });

    await expect(controller.handle('job-1', 'bad-token')).rejects.toThrow('not found');
    expect(lifecycle.processJob).not.toHaveBeenCalled();
  });

  it('rejects a token minted for another job/org', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getJobUnscoped.mockResolvedValue({ id: 'job-1', organizationId: 'org-1', status: 'pending' });

    const otherToken = mediaJobWebhookToken('job-2', 'org-1');
    await expect(controller.handle('job-1', otherToken)).rejects.toThrow('not found');

    const otherOrgToken = mediaJobWebhookToken('job-1', 'org-2');
    await expect(controller.handle('job-1', otherOrgToken)).rejects.toThrow('not found');
  });

  it('never trusts the webhook body — completion is driven via processJob (provider status API)', async () => {
    const { controller, lifecycle } = makeController();
    lifecycle.getJobUnscoped.mockResolvedValue({ id: 'job-1', organizationId: 'org-1', status: 'pending' });
    lifecycle.processJob.mockResolvedValue('pending');

    const token = mediaJobWebhookToken('job-1', 'org-1');
    const result = await controller.handle('job-1', token);
    expect(result).toEqual({ ok: true, status: 'pending' });
  });
});
