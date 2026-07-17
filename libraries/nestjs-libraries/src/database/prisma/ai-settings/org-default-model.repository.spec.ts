import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function () {
    return { model: {} };
  }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OrgDefaultModelRepository } from './org-default-model.repository';

describe('OrgDefaultModelRepository', () => {
  let repository: OrgDefaultModelRepository;
  let model: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    model = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const repo = new (PrismaRepository as any)();
    repo.model = { orgDefaultModel: model };
    repository = new OrgDefaultModelRepository(repo);
  });

  it('getAll queries by org+domain ordered by category', () => {
    repository.getAll('org1', 'ai');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', domain: 'ai' },
      orderBy: { category: 'asc' },
    });
  });

  it('get looks up the compound unique', () => {
    repository.get('org1', 'ai', 'low-reasoning');
    expect(model.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_domain_category: {
          organizationId: 'org1',
          domain: 'ai',
          category: 'low-reasoning',
        },
      },
    });
  });

  it('upsert applies defaults when version/model/settings are absent', () => {
    repository.upsert('org1', 'ai', 'vision', { providerId: 'openai' });
    const arg = (model.upsert as any).mock.calls[0][0];
    expect(arg.create).toMatchObject({
      organizationId: 'org1',
      domain: 'ai',
      category: 'vision',
      providerId: 'openai',
      version: 'v1',
      model: null,
      settings: null,
    });
    expect(arg.update).toMatchObject({
      providerId: 'openai',
      version: 'v1',
      model: null,
      settings: null,
    });
  });

  it('upsert serializes provided version/model/settings', () => {
    repository.upsert('org1', 'ai', 'vision', {
      providerId: 'openai',
      version: 'v2',
      model: 'gpt-x',
      settings: { temperature: 0.5 },
    });
    const arg = (model.upsert as any).mock.calls[0][0];
    expect(arg.create).toMatchObject({
      version: 'v2',
      model: 'gpt-x',
      settings: JSON.stringify({ temperature: 0.5 }),
    });
    expect(arg.update).toMatchObject({
      version: 'v2',
      model: 'gpt-x',
      settings: JSON.stringify({ temperature: 0.5 }),
    });
  });

  it('remove deletes by the compound unique', () => {
    repository.remove('org1', 'ai', 'workflow');
    expect(model.delete).toHaveBeenCalledWith({
      where: {
        organizationId_domain_category: {
          organizationId: 'org1',
          domain: 'ai',
          category: 'workflow',
        },
      },
    });
  });
});
