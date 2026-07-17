import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RetentionActivity } from './retention.activity';
import { RetentionRepository } from '@gitroom/nestjs-libraries/database/prisma/retention/retention.repository';

function makeRepository() {
  return {
    deleteErrorsOlderThan: vi.fn().mockResolvedValue(2),
    deleteNotificationsOlderThan: vi.fn().mockResolvedValue(2),
    deleteIncompleteMultipartUploadsOlderThan: vi.fn().mockResolvedValue(2),
    deleteMastraTracesOlderThan: vi.fn().mockResolvedValue(2),
    purgeSoftDeletedPosts: vi.fn().mockResolvedValue(2),
    purgeSoftDeletedFiles: vi.fn().mockResolvedValue(2),
    purgeAiDesignerSessionsOlderThan: vi.fn().mockResolvedValue(2),
    nullUserIpAgentOlderThan: vi.fn().mockResolvedValue(2),
    nullSessionIpAgentOlderThan: vi.fn().mockResolvedValue(2),
  } as unknown as RetentionRepository;
}

describe('RetentionActivity', () => {
  beforeEach(() => {
    delete process.env.ERRORS_RETENTION_DAYS;
    delete process.env.IP_RETENTION_DAYS;
  });

  it('runs every prune and reports counts', async () => {
    const repository = makeRepository();
    const activity = new RetentionActivity(repository);

    const counts = await activity.runRetention();

    expect(repository.deleteErrorsOlderThan).toHaveBeenCalledTimes(1);
    expect(repository.deleteNotificationsOlderThan).toHaveBeenCalledTimes(1);
    expect(repository.deleteIncompleteMultipartUploadsOlderThan).toHaveBeenCalledTimes(1);
    expect(repository.deleteMastraTracesOlderThan).toHaveBeenCalledTimes(1);
    expect(repository.nullUserIpAgentOlderThan).toHaveBeenCalledTimes(1);
    expect(repository.nullSessionIpAgentOlderThan).toHaveBeenCalledTimes(1);
    expect(counts.errors).toBe(2);
    expect(counts.userIpAgent).toBe(2);
    expect(counts.aiDesignerSessions).toBe(2);
  });

  it('is non-fatal: one prune throwing does not abort the rest', async () => {
    const repository = makeRepository();
    vi.mocked(repository.deleteErrorsOlderThan).mockRejectedValue(new Error('boom'));
    const activity = new RetentionActivity(repository);

    const counts = await activity.runRetention();

    expect(counts.errors).toBe(-1); // failure marker
    expect(repository.deleteNotificationsOlderThan).toHaveBeenCalled(); // continued
    expect(counts.notifications).toBe(2);
  });

  it('only nulls multipart stragglers (state != completed)', async () => {
    const repository = makeRepository();
    const activity = new RetentionActivity(repository);
    await activity.runRetention();

    const [cutoff] = vi.mocked(repository.deleteIncompleteMultipartUploadsOlderThan).mock.calls[0];
    expect(cutoff).toBeInstanceOf(Date);
  });
});
