import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import type {
  DesignerAssistantContextDto,
  DesignerCopyKind,
  DesignerSuggestionsDto,
  GenerateDesignerCopyDto,
} from '@postmill-ai/nestjs-libraries/dtos/design/designer-assistant.dto';

const copySchema = z.object({
  variants: z.array(z.string().trim().min(1).max(1000)).length(3),
});

const suggestionsSchema = z.object({
  suggestions: z.array(z.object({
    category: z.enum(['font', 'color', 'layout', 'spacing']),
    title: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(500),
    style: z.object({
      fontFamily: z.string().trim().min(1).max(120).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).strict().optional(),
  }).strict()).min(1).max(6),
});

const contextText = (context?: DesignerAssistantContextDto) =>
  context ? JSON.stringify(context).slice(0, 4000) : 'No element selected.';

@Injectable()
export class DesignerAssistantService {
  constructor(
    private readonly _aiModelProvider: AIModelProvider,
    private readonly _brandsService: BrandsService,
  ) {}

  private async _brandStyle(orgId: string) {
    const brand = await this._brandsService.getDefaultBrand(orgId) ||
      (await this._brandsService.getBrands(orgId))[0];
    return {
      name: brand?.name || 'No Brand profile configured',
      palette: Array.isArray(brand?.palette) ? brand.palette.slice(0, 20) : [],
      fontFamilies: Array.isArray(brand?.fontFamilies) ? brand.fontFamilies.slice(0, 20) : [],
    };
  }

  async generateCopy(orgId: string, input: GenerateDesignerCopyDto) {
    const brand = await this._brandStyle(orgId);
    const labels: Record<DesignerCopyKind, string> = {
      headline: 'short headline',
      promotion: 'promotional copy',
      caption: 'social media caption',
      cta: 'call-to-action phrase',
    };
    return this._aiModelProvider.generateObject<z.infer<typeof copySchema>>(
      'generator',
      `Create exactly three distinct ${labels[input.kind]} alternatives for a design.\n\n` +
      `User brief: ${JSON.stringify(input.prompt)}\n` +
      `Selected text to replace or improve: ${JSON.stringify(input.selectedText || '')}\n` +
      `Design summary: ${contextText(input.context)}\n` +
      `Brand style: ${JSON.stringify(brand)}\n\n` +
      'Keep each option concise, production-ready, and distinct in angle. Do not use markdown or numbering.',
      copySchema,
      {
        orgId,
        system: 'You are a senior marketing copywriter embedded in a visual design editor. Return only the requested structured alternatives.',
      }
    );
  }

  async getSuggestions(orgId: string, input: DesignerSuggestionsDto) {
    const brand = await this._brandStyle(orgId);
    return this._aiModelProvider.generateObject<z.infer<typeof suggestionsSchema>>(
      'generator',
      `Review this design and recommend font pairings, color combinations, layout, and spacing improvements.\n\n` +
      `Optional user goal: ${JSON.stringify(input.prompt || '')}\n` +
      `Design/selected-element summary: ${contextText(input.context)}\n` +
      `Brand style: ${JSON.stringify(brand)}\n\n` +
      'Give 2-6 specific, practical recommendations. Include a fontFamily or #RRGGBB fill only when it is a compatible style change that can be applied directly; never include layout operations or asset URLs.',
      suggestionsSchema,
      {
        orgId,
        system: 'You are an art director giving concise, brand-aware design feedback. Return only structured suggestions, not document operations.',
      }
    );
  }
}
