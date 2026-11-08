import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { OrgImportController } from './org-import.controller';

describe('OrgImportController', () => {
  it('delegates upload, validation, commit and status without business logic', async () => {
    const service = {
      createUpload: vi.fn(async () => ({ id: 'job-1' })),
      getJob: vi.fn(async () => ({ id: 'job-1', status: 'processing' })),
      appendChunk: vi.fn(async () => ({ uploadedBytes: 4 })),
      validateUpload: vi.fn(async () => ({ missingAssets: 0 })),
      commitImport: vi.fn(async () => ({ id: 'job-1', status: 'pending' })),
    };
    const controller = new OrgImportController(service as any);
    const user = { id: 'owner-1' } as any;
    const organization = { id: 'org-1' } as any;

    await controller.createUpload(user, organization);
    expect(service.createUpload).toHaveBeenCalledWith('org-1', 'owner-1');
    await controller.appendChunk(user, organization, 'job-1', { offset: 0, data: 'emlw' });
    expect(service.appendChunk).toHaveBeenCalledWith('org-1', 'owner-1', 'job-1', 0, 'emlw');
    await controller.validateUpload(user, organization, 'job-1', { passphrase: 'owner passphrase' });
    expect(service.validateUpload).toHaveBeenCalledWith('org-1', 'owner-1', 'job-1', 'owner passphrase');
    await controller.commitImport(user, organization, 'job-1', { passphrase: 'owner passphrase' });
    expect(service.commitImport).toHaveBeenCalledWith('org-1', 'owner-1', 'job-1', 'owner passphrase');
    await controller.getJob(user, organization, 'job-1');
    expect(service.getJob).toHaveBeenCalledWith('org-1', 'owner-1', 'job-1');
  });

  it('registers every import route for authentication and CSRF', () => {
    const source = readFileSync(path.join(__dirname, '..', 'api.module.ts'), 'utf8');
    const authenticated = source.match(/authenticatedController = \[([\s\S]*?)\];/)?.[1] || '';
    expect(authenticated).toContain('OrgImportController');
  });
});
