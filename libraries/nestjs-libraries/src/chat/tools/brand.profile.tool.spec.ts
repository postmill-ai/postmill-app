import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandProfileTool } from './brand.profile.tool';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('BrandProfileTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  let brandsService: {
    getDefaultBrand: ReturnType<typeof vi.fn>;
    getBrands: ReturnType<typeof vi.fn>;
  };
  let tool: BrandProfileTool;

  beforeEach(() => {
    brandsService = {
      getDefaultBrand: vi.fn().mockResolvedValue({
        id: 'brand-1',
        name: 'Acme',
        instructions: 'Be witty.',
        language: 'en-US',
        platformInstructions: { x: 'Short.' },
      }),
      getBrands: vi.fn().mockResolvedValue([
        { id: 'brand-1', name: 'Acme' },
        { id: 'brand-2', name: 'Beta' },
      ]),
    };
    tool = new BrandProfileTool(brandsService as unknown as BrandsService);
  });

  it('returns default brand and all brands list', async () => {
    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(brandsService.getDefaultBrand).toHaveBeenCalledWith(org.id);
    expect(brandsService.getBrands).toHaveBeenCalledWith(org.id);
    expect(result).toEqual({
      default: {
        name: 'Acme',
        instructions: 'Be witty.',
        language: 'en-US',
        platformInstructions: { x: 'Short.' },
      },
      all: [
        { id: 'brand-1', name: 'Acme' },
        { id: 'brand-2', name: 'Beta' },
      ],
    });
  });

  it('omits default when there is no default brand', async () => {
    brandsService.getDefaultBrand.mockResolvedValue(null);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.default).toBeUndefined();
    expect(result.all).toHaveLength(2);
  });

  it('denies read access when access context is missing', async () => {
    await expect(
      executeTool(tool, {
        inputData: {},
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied: no access context');
  });
});
