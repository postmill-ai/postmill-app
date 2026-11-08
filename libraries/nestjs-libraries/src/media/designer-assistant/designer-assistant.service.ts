import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
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
}).strict();

const suggestionActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('align'),
    position: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']),
  }).strict(),
  z.object({
    type: z.literal('distribute'),
    mode: z.enum(['horizontal-centers', 'vertical-centers', 'horizontal-gaps', 'vertical-gaps']),
  }).strict(),
]);

const suggestionsSchema = z.object({
  suggestions: z.array(z.object({
    category: z.enum(['font', 'color', 'layout', 'spacing']),
    title: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(500),
    style: z.object({
      fontFamily: z.string().trim().min(1).max(120).optional(),
      fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }).strict().optional(),
    action: suggestionActionSchema.optional(),
  }).strict()).min(2).max(6),
}).strict();

const copyResponseContract =
  'Return only one JSON object with exactly this shape: {"variants":["alternative 1","alternative 2","alternative 3"]}. ' +
  'The root object must contain only "variants", with exactly three distinct, non-empty strings of at most 1000 characters each.';

const suggestionsResponseContract =
  'Return only one JSON object with exactly this shape: {"suggestions":[{"category":"font","title":"Short title","rationale":"Practical reason","style":{"fontFamily":"Georgia","fill":"#123456"}},{"category":"layout","title":"Center the headline","rationale":"Balance the composition.","action":{"type":"align","position":"center"}}]}. ' +
  'The root object must contain only "suggestions", with 2-6 entries. Every entry requires category, title, and rationale. ' +
  'Category must be one of "font", "color", "layout", or "spacing". Title and rationale must be non-empty strings of at most 160 and 500 characters. ' +
  'The optional style object may contain only fontFamily (a non-empty string of at most 120 characters) or fill (a #RRGGBB color). ' +
  'The optional action must be exactly {"type":"align","position":"left|center|right|top|middle|bottom"} or {"type":"distribute","mode":"horizontal-centers|vertical-centers|horizontal-gaps|vertical-gaps"}. ' +
  'Use align only for an image-design selection and distribute only when at least three elements are selected. Never emit coordinates, element ids, URLs, or any other action fields.';

const contextText = (context?: DesignerAssistantContextDto) =>
  context ? JSON.stringify(context).slice(0, 12000) : 'No element selected.';

@Injectable()
export class DesignerAssistantService {
  private readonly _logger = new Logger(DesignerAssistantService.name);

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

  private async _generateValidated<T>(
    operation: 'copy' | 'suggestions',
    prompt: string,
    schema: z.ZodType<T>,
    orgId: string,
    system: string,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await this._aiModelProvider.generateObject<unknown>(
        'generator',
        attempt === 1
          ? prompt
          : `${prompt}\n\nSCHEMA CORRECTION: the previous response did not match the exact JSON response contract above. Return a new JSON object that follows it exactly, without explanation or additional fields.`,
        undefined,
        { orgId, system },
      );
      const parsed = schema.safeParse(response);
      if (parsed.success) {
        return parsed.data;
      }
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`)
        .join(',');
      this._logger.warn(`Designer assistant ${operation} schema validation failed on attempt ${attempt}/2: ${issues}`);
    }
    throw new BadGatewayException('The AI provider returned an invalid structured response. Please try again.');
  }

  async generateCopy(orgId: string, input: GenerateDesignerCopyDto) {
    const brand = await this._brandStyle(orgId);
    const labels: Record<DesignerCopyKind, string> = {
      headline: 'short headline',
      promotion: 'promotional copy',
      caption: 'social media caption',
      cta: 'call-to-action phrase',
    };
    return this._generateValidated(
      'copy',
      `Create exactly three distinct ${labels[input.kind]} alternatives for a design.\n\n` +
      `User brief: ${JSON.stringify(input.prompt)}\n` +
      `Selected text to replace or improve: ${JSON.stringify(input.selectedText || '')}\n` +
      `Design summary: ${contextText(input.context)}\n` +
      `Brand style: ${JSON.stringify(brand)}\n\n` +
      'Keep each option concise, production-ready, and distinct in angle. Do not use markdown or numbering.\n' +
      copyResponseContract,
      copySchema,
      orgId,
      'You are a senior marketing copywriter embedded in a visual design editor. Return only the requested structured alternatives.',
    );
  }

  async getSuggestions(orgId: string, input: DesignerSuggestionsDto) {
    const brand = await this._brandStyle(orgId);
    return this._generateValidated(
      'suggestions',
      `Review this design and recommend font pairings, color combinations, layout, and spacing improvements.\n\n` +
      `Optional user goal: ${JSON.stringify(input.prompt || '')}\n` +
      `Design/selected-element summary: ${contextText(input.context)}\n` +
      `Brand style: ${JSON.stringify(brand)}\n\n` +
      'Give 2-6 specific, practical recommendations. Include a fontFamily or #RRGGBB fill only when it is a compatible style change. Add an align or distribute action only when it directly implements the recommendation for the supplied image-design selection; otherwise omit action. Never include asset URLs.\n' +
      suggestionsResponseContract,
      suggestionsSchema,
      orgId,
      'You are an art director giving concise, brand-aware design feedback. Return only structured suggestions and whitelisted semantic actions, not free-form document operations.',
    );
  }
}
