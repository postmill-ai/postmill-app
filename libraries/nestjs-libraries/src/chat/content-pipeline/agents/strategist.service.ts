import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { CONTENT_PIPELINE_AGENT_IDS } from '../pipeline-registry.data';

interface StrategistInput {
  brief: string;
  platforms: string[];
  tone?: string;
}

interface StrategistPlan {
  platforms: string[];
  angles: string[];
  hooks: string[];
  structure: string;
}

@Injectable()
export class StrategistService implements OnModuleInit {
  private readonly _logger = new Logger(StrategistService.name);

  constructor(
    private readonly _ai: AIModelProvider,
    private readonly _brands: BrandsService,
    private readonly _rag: RagService
  ) {}

  onModuleInit() {
    registerInProcessAgent(
      CONTENT_PIPELINE_AGENT_IDS.strategist,
      this._handler.bind(this)
    );
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    let input: StrategistInput;
    try {
      input = JSON.parse(context.raw_input) as StrategistInput;
    } catch (err) {
      this._logger.warn(
        `Strategist received invalid input: ${(err as Error).message}`,
        StrategistService.name
      );
      throw err;
    }
    const orgId = (context.metadata?.orgId as string | undefined) ?? undefined;
    const userId =
      (context.metadata?.userId as string | undefined) ?? undefined;

    const [brand, memory] = await Promise.all([
      orgId
        ? this._brands.getDefaultBrand(orgId).catch(() => null)
        : Promise.resolve(null),
      orgId
        ? this._rag.searchBrandMemory(orgId, input.brief, 5).catch(() => [])
        : Promise.resolve([]),
    ]);

    const system = [
      'You are a content strategist.',
      'Turn the brief into a compact per-platform plan.',
      'Return ONLY valid JSON with keys: platforms (string[]), angles (string[]), hooks (string[]), structure (string).',
    ].join(' ');

    const prompt = this._buildPrompt(input, brand, memory);

    try {
      const raw = await this._ai.generateText('agent', prompt, {
        system,
        orgId,
        userId,
      });
      const plan = this._parsePlan(raw, input.platforms);
      return {
        content: JSON.stringify(plan),
        workflow_complete: false,
      };
    } catch (err) {
      // Rethrow so the conductor's per-(org, agent) circuit breaker records the
      // failure. Swallowing here returns success-shaped empty output and keeps
      // the breaker permanently closed for AI failures.
      this._logger.warn(
        `Strategist generation failed: ${(err as Error).message}`,
        StrategistService.name
      );
      throw err;
    }
  };

  private _buildPrompt(
    input: StrategistInput,
    brand: Awaited<ReturnType<BrandsService['getDefaultBrand']>> | null,
    memory: { text: string }[]
  ): string {
    const lines: string[] = [
      `Brief: ${input.brief}`,
      `Platforms: ${input.platforms.join(', ')}`,
    ];
    if (input.tone) {
      lines.push(`Tone: ${input.tone}`);
    }
    if (brand?.instructions) {
      lines.push(`Brand voice: ${brand.instructions}`);
    }
    if (brand?.language) {
      lines.push(`Language: ${brand.language}`);
    }
    if (memory.length > 0) {
      lines.push(
        '',
        'Past top-performing posts to echo:',
        ...memory.map((m) => `- ${m.text.replace(/\n/g, ' ').trim()}`)
      );
    }
    lines.push(
      '',
      'Return a JSON plan: { platforms, angles, hooks, structure }.'
    );
    return lines.join('\n');
  }

  private _parsePlan(raw: string, fallbackPlatforms: string[]): StrategistPlan {
    const parsed = this._safeJson(raw) as Partial<StrategistPlan> | undefined;
    return {
      platforms: Array.isArray(parsed?.platforms)
        ? parsed.platforms
        : fallbackPlatforms,
      angles: Array.isArray(parsed?.angles) ? parsed.angles : [],
      hooks: Array.isArray(parsed?.hooks) ? parsed.hooks : [],
      structure:
        typeof parsed?.structure === 'string'
          ? parsed.structure
          : 'Single post per platform.',
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
