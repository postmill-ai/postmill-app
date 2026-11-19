import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DesignShareService } from './design-share.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';

const future = () => new Date(Date.now() + 86400000);
const design = () => ({
  id: 'design-1',
  organizationId: 'org-1',
  name: 'Client campaign',
  doc: {
    mode: 'image',
    outputs: [{
      id: 'output-1',
      formatId: 'square',
      name: 'Square',
      width: 1080,
      height: 1080,
      background: '#ffffff',
      children: [],
      pages: [{ id: 'page-2', name: 'Second', children: [] }],
    }],
  },
});
const share = (overrides: Record<string, unknown> = {}) => ({
  id: 'share-1',
  organizationId: 'org-1',
  designId: 'design-1',
  token: 'secret-token',
  enabled: true,
  commentsEnabled: true,
  expiresAt: future(),
  approvedAt: null,
  approvedBy: null,
  comments: [{
    id: 'comment-1',
    authorName: 'Client',
    content: 'Looks good',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }],
  design: design(),
  ...overrides,
});

describe('DesignShareService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let preview: { renderPreviewBuffer: ReturnType<typeof vi.fn> };
  let service: DesignShareService;

  beforeEach(() => {
    repository = {
      findDesign: vi.fn().mockResolvedValue(design()),
      findShareByDesign: vi.fn().mockResolvedValue(null),
      findActiveByToken: vi.fn().mockResolvedValue(share()),
      saveShare: vi.fn(),
      disableShare: vi.fn(),
      createComment: vi.fn(),
      approveFirst: vi.fn(),
    };
    preview = { renderPreviewBuffer: vi.fn().mockResolvedValue(Buffer.from('png')) };
    service = new DesignShareService(repository as any, new DesignerDocService(), preview as any);
  });

  it('creates a CSPRNG token with safe defaults and no document in the management response', async () => {
    repository.saveShare.mockImplementation(async (_org, _design, data) => share({
      ...data,
      comments: [],
    }));

    const result = await service.saveShare('org-1', 'design-1', {});
    const input = repository.saveShare.mock.calls[0][2];
    expect(input.token).toMatch(/^[0-9a-f]{64}$/);
    expect(input.enabled).toBe(true);
    expect(input.commentsEnabled).toBe(false);
    expect(input.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(result).not.toHaveProperty('doc');
    expect(result).not.toHaveProperty('organizationId');
  });

  it('reuses the existing token when updating settings', async () => {
    repository.findShareByDesign.mockResolvedValue(share());
    repository.saveShare.mockImplementation(async (_org, _design, data) => share(data));

    await service.saveShare('org-1', 'design-1', {
      enabled: true,
      commentsEnabled: false,
      expiresAt: future().toISOString(),
    });

    expect(repository.saveShare.mock.calls[0][2].token).toBe('secret-token');
    expect(repository.saveShare.mock.calls[0][2].commentsEnabled).toBe(false);
  });

  it.each([new Date(Date.now() - 1000), new Date(Date.now() + 366 * 86400000)])(
    'rejects invalid expiry %s',
    async (expiresAt) => {
      await expect(service.saveShare('org-1', 'design-1', { expiresAt })).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.saveShare).not.toHaveBeenCalled();
    },
  );

  it('returns whitelisted public metadata with output/page navigation and chronological feedback', async () => {
    const result = await service.getPublicPreview('secret-token');

    expect(repository.findActiveByToken).toHaveBeenCalledWith('secret-token', expect.any(Date));
    expect(result.name).toBe('Client campaign');
    expect(result.outputs[0].pages).toEqual([
      { pageNumber: 0, name: 'Page 1' },
      { pageNumber: 1, name: 'Second' },
    ]);
    expect(result.comments).toHaveLength(1);
    expect(result).not.toHaveProperty('doc');
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('organizationId');
  });

  it('fails closed when the public share resolver finds no active design share', async () => {
    repository.findActiveByToken.mockResolvedValue(null);
    await expect(service.getPublicPreview('unknown')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addComment('unknown', 'Client', 'Hello')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.approve('unknown', 'Client')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.renderPublicPreview('unknown', 0, 0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps existing feedback readable when new comments are disabled', async () => {
    repository.findActiveByToken.mockResolvedValue(share({ commentsEnabled: false }));
    const result = await service.getPublicPreview('secret-token');
    expect(result.commentsEnabled).toBe(false);
    expect(result.comments).toHaveLength(1);
    await expect(service.addComment('secret-token', 'Client', 'New')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it('trims and stores bounded comments under the resolved organization', async () => {
    repository.createComment.mockImplementation(async (data) => data);
    await service.addComment('secret-token', '  Client  ', '  Please brighten the logo  ');
    expect(repository.createComment).toHaveBeenCalledWith({
      shareId: 'share-1',
      organizationId: 'org-1',
      authorName: 'Client',
      content: 'Please brighten the logo',
    });
  });

  it('rejects blank comments and names before writing', async () => {
    await expect(service.addComment('secret-token', ' ', 'Hello')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.addComment('secret-token', 'Client', ' ')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it('uses the repository first-approval-wins result', async () => {
    const approval = { approvedAt: new Date(), approvedBy: 'First client' };
    repository.approveFirst.mockResolvedValue(share(approval));
    const first = await service.approve('secret-token', 'First client');
    const second = await service.approve('secret-token', 'Second client');
    expect(first).toEqual(approval);
    expect(second).toEqual(approval);
    expect(repository.approveFirst).toHaveBeenCalledTimes(2);
  });

  it('renders the selected saved output/page with the organization asset scope', async () => {
    await expect(service.renderPublicPreview('secret-token', 0, 1)).resolves.toEqual(Buffer.from('png'));
    expect(preview.renderPreviewBuffer).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org-1',
      outputIndex: 0,
      pageNumber: 1,
    });
  });

  it('rejects invalid preview locations before rendering', async () => {
    await expect(service.renderTeamPreview('org-1', 'design-1', 0, 2)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.renderTeamPreview('org-1', 'design-1', 1, 0)).rejects.toBeInstanceOf(BadRequestException);
    expect(preview.renderPreviewBuffer).not.toHaveBeenCalled();
  });

  it('scopes team preview and management reads through the organization', async () => {
    const teamPreview = await service.getTeamPreview('org-1', 'design-1');
    expect(teamPreview.expiresAt).toBeNull();
    await service.getShare('org-1', 'design-1');
    expect(repository.findDesign).toHaveBeenCalledWith('org-1', 'design-1');
    expect(repository.findShareByDesign).toHaveBeenCalledWith('org-1', 'design-1');
  });

  it('does not disclose a missing design through management routes', async () => {
    repository.findDesign.mockResolvedValue(null);
    await expect(service.getShare('org-1', 'design-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findShareByDesign).not.toHaveBeenCalled();
  });
});
