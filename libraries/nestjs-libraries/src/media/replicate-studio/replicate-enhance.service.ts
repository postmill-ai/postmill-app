import { Injectable, Logger } from '@nestjs/common';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';

export interface EnhanceResult {
  text: string;
  enhanced: boolean;
  reason?: 'ai-not-configured' | 'error';
}

const POSITIVE_SYSTEM = [
  'You expand a short image/video generation idea into a single, rich, vivid, visually',
  'descriptive prompt suitable for professional AI media generation tools. Output ONLY the',
  'final enhanced prompt as one polished sentence — no questions, no options, no commentary,',
  'no quotation marks.',
].join(' ');

const NEGATIVE_SYSTEM = [
  'You expand a short negative-prompt idea into a comprehensive comma-separated list of',
  'specific unwanted visual elements for AI image generation (e.g. blurry, low quality,',
  'bad anatomy, watermark, extra limbs). Output ONLY the comma-separated list — no commentary,',
  'no quotation marks.',
].join(' ');

/**
 * Prompt enhancement for the Replicate Studio composer. Routes through the org-scoped
 * AIModelProvider facade — there is no env-key fallback. When the org has no active AI
 * provider this returns the original text unchanged (enhanced: false) rather than failing,
 * so the composer never breaks because AI is off.
 */
@Injectable()
export class ReplicateEnhanceService {
  private readonly _logger = new Logger(ReplicateEnhanceService.name);

  constructor(private readonly _ai: AIModelProvider) {}

  async enhance(
    orgId: string,
    userId: string,
    prompt: string,
    mode: 'positive' | 'negative',
  ): Promise<EnhanceResult> {
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      return { text: prompt, enhanced: false };
    }

    // AI off for this org → graceful passthrough, never an env-key fallback.
    const config = await this._ai.resolveConfigForScope('utility', orgId);
    if (!config) {
      return { text: prompt, enhanced: false, reason: 'ai-not-configured' };
    }

    try {
      const out = await this._ai.generateText('utility', trimmed, {
        system: mode === 'negative' ? NEGATIVE_SYSTEM : POSITIVE_SYSTEM,
        orgId,
        userId,
        promptKey: 'replicate.enhance-prompt',
      });
      const text = (out || '').trim();
      if (!text) {
        return { text: prompt, enhanced: false, reason: 'error' };
      }
      return { text, enhanced: true };
    } catch (err) {
      this._logger.warn(`Prompt enhancement failed: ${(err as Error)?.message}`);
      return { text: prompt, enhanced: false, reason: 'error' };
    }
  }
}
