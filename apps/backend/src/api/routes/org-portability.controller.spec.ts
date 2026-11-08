import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { BadRequestException } from '@nestjs/common';
import {
  OrgPortabilityController,
  OrgPortabilityDownloadController,
} from './org-portability.controller';

describe('OrgPortabilityController', () => {
  it('delegates owner-only export creation and download issuance', async () => {
    const service = {
      createExport: vi.fn(async () => ({ id: 'job-1' })),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      issueDownload: vi.fn(async () => ({ url: '/org-portability/download/token' })),
    };
    const controller = new OrgPortabilityController(service as any);
    const user = { id: 'owner-1' } as any;
    const organization = { id: 'org-1' } as any;

    await controller.createExport(user, organization, { passphrase: 'owner passphrase' });
    expect(service.createExport).toHaveBeenCalledWith('org-1', 'owner-1', 'owner passphrase');
    await controller.issueDownload(user, organization, 'job-1');
    expect(service.issueDownload).toHaveBeenCalledWith('org-1', 'owner-1', 'job-1');
  });

  it('rejects malformed public download tokens before consuming them', async () => {
    const service = { consumeDownload: vi.fn() };
    const controller = new OrgPortabilityDownloadController(service as any);
    await expect(controller.download('invalid', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.consumeDownload).not.toHaveBeenCalled();
  });

  it('keeps management authenticated and only the token download public', () => {
    const source = readFileSync(path.join(__dirname, '..', 'api.module.ts'), 'utf8');
    const authenticated = source.match(/authenticatedController = \[([\s\S]*?)\];/)?.[1] || '';
    expect(authenticated).toContain('OrgPortabilityController');
    expect(authenticated).not.toContain('OrgPortabilityDownloadController');
    expect(source).toContain('OrgPortabilityDownloadController,');
  });
});
