import { describe, it, expect, vi, beforeEach } from 'vitest';

// The env shim and heavy AI/brand/RAG modules are stubbed so the handler
// services import as lightweight class definitions — the tests only exercise
// the in-process handler logic, not the real providers.
vi.mock(
  '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim',
  () => ({})
);
vi.mock('@reaatech/agent-mesh', () => ({}));
vi.mock('@reaatech/agent-mesh-router', () => ({
  registerInProcessAgent: vi.fn(),
}));
vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {},
}));
vi.mock('@gitroom/nestjs-libraries/brands/brands.service', () => ({
  BrandsService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/ai/governance/rag.service', () => ({
  RagService: class {},
}));

import { StrategistService } from './strategist.service';
import { CopywriterService } from './copywriter.service';
import { BrandCriticService } from './brand-critic.service';

type Ctx = { raw_input: string; metadata?: Record<string, unknown> };

const invoke = (service: unknown, ctx: Ctx) =>
  (service as { _handler: (c: Ctx) => Promise<unknown> })._handler(ctx);

describe('content-pipeline LLM handlers', () => {
  let ai: { generateText: ReturnType<typeof vi.fn> };
  let brands: { getDefaultBrand: ReturnType<typeof vi.fn> };
  let rag: { searchBrandMemory: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    ai = { generateText: vi.fn() };
    brands = { getDefaultBrand: vi.fn().mockResolvedValue(null) };
    rag = { searchBrandMemory: vi.fn().mockResolvedValue([]) };
  });

  describe('strategist', () => {
    const ctx: Ctx = {
      raw_input: JSON.stringify({ brief: 'launch', platforms: ['x'] }),
      metadata: { orgId: 'org-1', userId: 'user-1' },
    };

    it('rethrows LLM failures instead of returning fallback JSON', async () => {
      ai.generateText.mockRejectedValue(new Error('revoked key'));
      const svc = new StrategistService(ai as any, brands as any, rag as any);
      await expect(invoke(svc, ctx)).rejects.toThrow('revoked key');
    });

    it('forwards orgId and userId to generateText for spend attribution', async () => {
      ai.generateText.mockResolvedValue(
        JSON.stringify({ platforms: ['x'], angles: [], hooks: [], structure: 's' })
      );
      const svc = new StrategistService(ai as any, brands as any, rag as any);
      await invoke(svc, ctx);
      expect(ai.generateText).toHaveBeenCalledWith(
        'agent',
        expect.any(String),
        expect.objectContaining({ orgId: 'org-1', userId: 'user-1' })
      );
    });

    it('rethrows on invalid raw_input', async () => {
      const svc = new StrategistService(ai as any, brands as any, rag as any);
      await expect(
        invoke(svc, { raw_input: 'not json', metadata: {} })
      ).rejects.toThrow();
      expect(ai.generateText).not.toHaveBeenCalled();
    });
  });

  describe('copywriter', () => {
    const ctx: Ctx = {
      raw_input: JSON.stringify({
        plan: { platforms: ['x'], angles: ['a'] },
        platformLimits: [{ id: 'x', maxLength: 280 }],
      }),
      metadata: { orgId: 'org-1', userId: 'user-1' },
    };

    it('rethrows LLM failures instead of returning empty copy', async () => {
      ai.generateText.mockRejectedValue(new Error('budget exceeded'));
      const svc = new CopywriterService(ai as any);
      await expect(invoke(svc, ctx)).rejects.toThrow('budget exceeded');
    });

    it('forwards userId to generateText', async () => {
      ai.generateText.mockResolvedValue(JSON.stringify({ x: 'copy' }));
      const svc = new CopywriterService(ai as any);
      await invoke(svc, ctx);
      expect(ai.generateText).toHaveBeenCalledWith(
        'agent',
        expect.any(String),
        expect.objectContaining({ orgId: 'org-1', userId: 'user-1' })
      );
    });
  });

  describe('brand critic', () => {
    const ctx: Ctx = {
      raw_input: JSON.stringify({ perPlatform: { x: 'hi' }, platforms: ['x'] }),
      metadata: { orgId: 'org-1', userId: 'user-1' },
    };

    it('rethrows LLM failures instead of silently passing', async () => {
      ai.generateText.mockRejectedValue(new Error('guardrail rejected'));
      const svc = new BrandCriticService(ai as any, brands as any);
      await expect(invoke(svc, ctx)).rejects.toThrow('guardrail rejected');
    });

    it('spends under the utility scope and forwards userId', async () => {
      ai.generateText.mockResolvedValue(JSON.stringify({ pass: true, fixes: [] }));
      const svc = new BrandCriticService(ai as any, brands as any);
      await invoke(svc, ctx);
      expect(ai.generateText).toHaveBeenCalledWith(
        'utility',
        expect.any(String),
        expect.objectContaining({ orgId: 'org-1', userId: 'user-1' })
      );
    });
  });
});
