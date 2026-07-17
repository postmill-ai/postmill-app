import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { CONTENT_PIPELINE_AGENT_IDS } from '../pipeline-registry.data';

interface BrandCriticInput {
  perPlatform: Record<string, string>;
  platforms: string[];
  tone?: string;
}

interface BrandCriticResult {
  pass: boolean;
  fixes: string[];
}

@Injectable()
export class BrandCriticService implements OnModuleInit {
  private readonly _logger = new Logger(BrandCriticService.name);

  constructor(
    private readonly _ai: AIModelProvider,
    private readonly _brands: BrandsService
  ) {}

  onModuleInit() {
    registerInProcessAgent(
      CONTENT_PIPELINE_AGENT_IDS.brandCritic,
      this._handler.bind(this)
    );
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    let input: BrandCriticInput;
    try {
      input = JSON.parse(context.raw_input) as BrandCriticInput;
    } catch (err) {
      this._logger.warn(
        `Brand critic received invalid input: ${(err as Error).message}`,
        BrandCriticService.name
      );
      throw err;
    }
    const orgId = (context.metadata?.orgId as string | undefined) ?? undefined;
    const userId =
      (context.metadata?.userId as string | undefined) ?? undefined;

    const brand = orgId
      ? await this._brands.getDefaultBrand(orgId).catch(() => null)
      : null;

    const system = [
      'You are a brand critic.',
      'Review the copy for each platform against brand voice and platform rules.',
      'Return ONLY valid JSON: { "pass": boolean, "fixes": string[] }.',
      'If pass is false, fixes must be concrete, actionable revision instructions.',
    ].join(' ');

    const prompt = this._buildPrompt(input, brand);

    try {
      const raw = await this._ai.generateText('utility', prompt, {
        system,
        orgId,
        userId,
      });
      const result = this._parseCritique(raw);
      return {
        content: JSON.stringify(result),
        workflow_complete: false,
      };
    } catch (err) {
      // Rethrow so the conductor's circuit breaker records the failure. A
      // swallowed `pass: true` would silently skip the revision loop and ship
      // unreviewed copy on every critic outage.
      this._logger.warn(
        `Brand critic generation failed: ${(err as Error).message}`,
        BrandCriticService.name
      );
      throw err;
    }
  };

  private _buildPrompt(
    input: BrandCriticInput,
    brand: Awaited<ReturnType<BrandsService['getDefaultBrand']>> | null
  ): string {
    const lines: string[] = [
      'Review the following per-platform copy.',
      '',
      'Copy:',
    ];
    for (const [id, text] of Object.entries(input.perPlatform)) {
      lines.push(`- ${id}: ${text}`);
    }
    lines.push('', `Platforms: ${input.platforms.join(', ')}`);
    if (input.tone) {
      lines.push(`Requested tone: ${input.tone}`);
    }
    if (brand?.instructions) {
      lines.push('', `Brand voice: ${brand.instructions}`);
    }
    if (brand?.language) {
      lines.push(`Language: ${brand.language}`);
    }
    lines.push(
      '',
      'Return JSON: { pass, fixes }. If the copy is on-brand and platform-appropriate, pass=true with fixes=[].'
    );
    return lines.join('\n');
  }

  private _parseCritique(raw: string): BrandCriticResult {
    const parsed = this._safeJson(raw) as Partial<BrandCriticResult> | undefined;
    return {
      pass: !!parsed?.pass,
      fixes: Array.isArray(parsed?.fixes) ? parsed.fixes : [],
    };
  }

  private _safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
}
