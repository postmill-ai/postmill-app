import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BrandsRepository } from './brands.repository';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function() { return { model: {} }; }),
}));

const model = {
  aIBrandProfile: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
const prisma = { model } as any;
const repository = new BrandsRepository(prisma);
const font = { family: 'Brand Sans', fileId: 'font-1', path: '/brand.ttf', weights: [700] };

describe('per-Brand Kit custom fonts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only the explicitly selected brand', async () => {
    model.aIBrandProfile.findFirst.mockResolvedValue({ id: 'brand-2', customFonts: [font] });
    await expect(repository.getCustomFonts('org-1', 'brand-2')).resolves.toEqual([font]);
    expect(model.aIBrandProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'brand-2', organizationId: 'org-1' },
    });
  });

  it('can resolve fonts across kits for General Mode document rendering', async () => {
    model.aIBrandProfile.findMany.mockResolvedValue([
      { customFonts: [font] },
      { customFonts: [{ ...font, fileId: 'font-2', family: 'Other Sans' }] },
    ]);
    await expect(repository.getCustomFonts('org-1', null)).resolves.toHaveLength(2);
  });

  it('uploads and removes from the selected brand, not the default', async () => {
    model.aIBrandProfile.findFirst.mockResolvedValue({ id: 'brand-2', customFonts: [] });
    model.aIBrandProfile.update.mockResolvedValue({});
    await repository.addCustomFont('org-1', font, 'brand-2');
    expect(model.aIBrandProfile.update).toHaveBeenCalledWith({
      where: { id: 'brand-2', organizationId: 'org-1' },
      data: { customFonts: [font] },
    });
    await repository.removeCustomFont('org-1', 'font-1', 'brand-2');
    expect(model.aIBrandProfile.update).toHaveBeenLastCalledWith({
      where: { id: 'brand-2', organizationId: 'org-1' },
      data: { customFonts: [] },
    });
  });
});
