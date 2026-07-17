import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import {
  CHANNEL_PRESETS,
  type ChannelPreset,
} from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { z } from 'zod';
import { AiDesignerSkillRouter } from '../../skills/ai-designer-skill-router.service';
import type {
  AiDesignerConfig,
  DesignBrief,
  DesignPlan,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';

const PlanResponseSchema = z.object({
  type: z.string(),
  plans: z.array(z.any()),
});

interface PlanRequest {
  type: 'plan-request';
  brief: DesignBrief;
  config: AiDesignerConfig;
  mode: 'chat' | 'prompt';
}

interface EnrichedBrief extends DesignBrief {
  brandInstructions?: string;
  brandPalette?: string[];
  brandFontFamilies?: string[];
}

interface SizeOutput {
  formatId: string;
  width: number;
  height: number;
  name?: string;
}

@Injectable()
export class AiDesignerArtDirectorService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerArtDirectorService.name);

  constructor(
    private readonly _skillRouter: AiDesignerSkillRouter,
    private readonly _brands: BrandsService,
    private readonly _modelProvider: AIModelProvider
  ) {}

  onModuleInit() {
    registerInProcessAgent('art-director', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    const request = parseAgentInput<PlanRequest>(context.raw_input);
    if (isAgentInputError(request)) {
      return {
        content: JSON.stringify(request),
        workflow_complete: false,
      };
    }
    if (request.type !== 'plan-request') {
      throw new Error(`Unexpected request type: ${(request as any).type}`);
    }
    const orgId =
      typeof context.metadata?.orgId === 'string'
        ? context.metadata.orgId
        : undefined;

    const brief = await this._enrichBrief(
      request.brief,
      orgId,
      request.config.brandProfileId
    );
    const skillId = this._skillRouter.route(brief).skillId;
    const sizes = this._resolveSizes(request.config);
    // The DTO caps variants at 10; clamp again here since this payload can
    // arrive from any dispatch path, and each variant costs LLM calls + renders.
    const variants = Math.min(10, Math.max(1, request.config.variants ?? 1));

    let plans: DesignPlan[];
    try {
      plans = await this._generatePlans(skillId, brief, sizes, variants, orgId);
    } catch (err) {
      this._logger.warn(
        `Plan generation failed, using fallback: ${(err as Error).message}`
      );
      plans = [this._fallbackPlan(skillId, brief, sizes)];
    }

    // Ensure the response contains exactly the requested number of plans.
    plans = plans.slice(0, variants);
    while (plans.length < variants) {
      plans.push(this._fallbackPlan(skillId, brief, sizes));
    }

    // Assign fresh, unique variantIds so every returned plan is distinct.
    plans = plans.map((plan) => ({ ...plan, variantId: randomUUID() }));

    return {
      content: JSON.stringify({ type: 'plans', plans }),
      workflow_complete: false,
    };
  };

  private async _enrichBrief(
    brief: DesignBrief,
    orgId: string | undefined,
    brandProfileId: string | undefined
  ): Promise<EnrichedBrief> {
    if (!orgId || !brandProfileId) {
      return brief;
    }

    const brand = await this._brands.getBrand(orgId, brandProfileId);
    if (!brand) {
      return brief;
    }

    return {
      ...brief,
      brandInstructions: brand.instructions || undefined,
      brandPalette: Array.isArray(brand.palette)
        ? (brand.palette as string[])
        : undefined,
      brandFontFamilies: Array.isArray(brand.fontFamilies)
        ? (brand.fontFamilies as string[])
        : undefined,
    };
  }

  private _resolveSizes(config: AiDesignerConfig): SizeOutput[] {
    const sizes: SizeOutput[] = [];

    for (const channelId of config.channels ?? []) {
      const preset = CHANNEL_PRESETS.find((p) => p.id === channelId);
      if (preset) {
        sizes.push({
          formatId: preset.id,
          width: preset.width,
          height: preset.height,
          name: preset.name,
        });
      }
    }

    if (config.customSizes) {
      for (let i = 0; i < config.customSizes.length; i++) {
        const custom = config.customSizes[i];
        sizes.push({
          formatId: custom.name
            ? `custom-${custom.name}`
            : `custom-size-${i}`,
          width: custom.width,
          height: custom.height,
          name: custom.name,
        });
      }
    }

    if (sizes.length === 0) {
      sizes.push({
        formatId: 'custom',
        width: 1080,
        height: 1080,
        name: 'Custom Size',
      });
    }

    return sizes;
  }

  private async _generatePlans(
    skillId: string,
    brief: EnrichedBrief,
    sizes: SizeOutput[],
    variants: number,
    orgId: string | undefined
  ): Promise<DesignPlan[]> {
    const skillSystemPrompt = this._skillRouter.getSkillPrompt(skillId);

    const prompt = [
      `Generate exactly ${variants} distinct design plans for the brief below.`,
      `Each plan should be a creative variation that still follows the "${skillId}" skill conventions.`,
      '',
      '## Design brief',
      JSON.stringify(brief, null, 2),
      '',
      '## Output formats to design for',
      JSON.stringify(sizes, null, 2),
      '',
      `Return ONLY a JSON object in this exact shape: { "type": "plans", "plans": DesignPlan[] }.`,
      `The "plans" array must contain exactly ${variants} DesignPlan objects.`,
      '',
      'DesignPlan schema:',
      JSON.stringify(this._designPlanSchema(), null, 2),
    ].join('\n');

    const result = await this._modelProvider.generateObject<{
      type: string;
      plans?: DesignPlan[];
    }>('agent', prompt, PlanResponseSchema, {
      system: skillSystemPrompt,
      orgId,
    });

    if (result?.type !== 'plans' || !Array.isArray(result.plans)) {
      throw new Error('AI response did not match expected plans shape');
    }

    const validPlans: DesignPlan[] = [];
    for (const item of result.plans) {
      if (this._isValidPlanItem(item)) {
        validPlans.push(item as DesignPlan);
      } else {
        this._logger.warn(
          'Art director received an invalid plan item; replacing with fallback.'
        );
        validPlans.push(this._fallbackPlan(skillId, brief, sizes));
      }
    }

    if (validPlans.length === 0) {
      throw new Error('AI response contained no valid plan items');
    }

    return validPlans;
  }

  private _isValidPlanItem(item: unknown): boolean {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }
    const candidate = item as Record<string, unknown>;

    if (typeof candidate.concept !== 'string') {
      return false;
    }
    if (!Array.isArray(candidate.slots)) {
      return false;
    }
    for (const slot of candidate.slots) {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
        return false;
      }
      if (typeof (slot as Record<string, unknown>).id !== 'string') {
        return false;
      }
    }
    if ('assetNeeds' in candidate && !Array.isArray(candidate.assetNeeds)) {
      return false;
    }

    return true;
  }

  private _designPlanSchema(): Record<string, unknown> {
    return {
      variantId: 'string',
      skill: 'string',
      concept: 'string',
      formatTemplate: 'string (optional)',
      palette: 'string[]',
      typeScale: 'Record<string, number>',
      background: {
        kind: "'solid' | 'gradient' | 'image'",
        value: 'string (optional)',
        ref: 'asset:{id} (optional)',
      },
      slots: [
        { id: 'string', role: 'string', kind: "'text' | 'image'" },
      ],
      assetNeeds: [
        {
          slotId: 'string',
          brief: 'string',
          prefer: "'generate' | 'stock' | 'either'",
        },
      ],
      perChannel: 'Record<string, { note: string }> (optional)',
    };
  }

  private _fallbackPlan(
    skillId: string,
    brief: EnrichedBrief,
    _sizes: SizeOutput[]
  ): DesignPlan {
    const isMeme = skillId === 'meme';
    const defaultPalette =
      brief.brandPalette && brief.brandPalette.length > 0
        ? brief.brandPalette
        : ['#ffffff', '#000000', '#2B5CD3'];

    return {
      variantId: randomUUID(),
      skill: skillId,
      concept: brief.intent || 'A clean, on-brand design',
      formatTemplate: isMeme ? 'top-bottom-text' : 'image-macro',
      palette: defaultPalette,
      typeScale: { headline: 48, body: 24, cta: 18 },
      background: { kind: 'solid', value: defaultPalette[0] || '#ffffff' },
      slots: isMeme
        ? [
            { id: 'image', role: 'image', kind: 'image' },
            { id: 'top', role: 'top-caption', kind: 'text' },
            { id: 'bottom', role: 'bottom-caption', kind: 'text' },
          ]
        : [
            { id: 'image', role: 'image', kind: 'image' },
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'cta', role: 'cta', kind: 'text' },
          ],
      assetNeeds: [
        {
          slotId: 'image',
          brief: 'A high-quality background image matching the brief',
          prefer: 'stock',
        },
      ],
    };
  }
}
