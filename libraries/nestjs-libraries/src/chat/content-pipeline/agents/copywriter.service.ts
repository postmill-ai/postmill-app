import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { CONTENT_PIPELINE_AGENT_IDS } from '../pipeline-registry.data';

interface CopywriterPlan {
  platforms: string[];
  angles?: string[];
  hooks?: string[];
  structure?: string;
}

interface PlatformLimit {
  id: string;
  maxLength: number;
}

interface CopywriterInput {
  plan: CopywriterPlan;
  platformLimits: PlatformLimit[];
  tone?: string;
  existingCopy?: Record<string, string>;
  fixes?: string[];
}

@Injectable()
export class CopywriterService implements OnModuleInit {
  private readonly _logger = new Logger(CopywriterService.name);

  constructor(private readonly _ai: AIModelProvider) {}

  onModuleInit() {
    registerInProcessAgent(
      CONTENT_PIPELINE_AGENT_IDS.copywriter,
      this._handler.bind(this)
    );
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    let input: CopywriterInput;
    try {
      input = JSON.parse(context.raw_input) as CopywriterInput;
    } catch (err) {
      this._logger.warn(
        `Copywriter received invalid input: ${(err as Error).message}`,
        CopywriterService.name
      );
      throw err;
    }
    const orgId = (context.metadata?.orgId as string | undefined) ?? undefined;
    const userId =
      (context.metadata?.userId as string | undefined) ?? undefined;

    const system = [
      'You are a social-media copywriter.',
      'Write one piece of copy per requested platform, respecting each platform\'s length limit.',
      'Return ONLY valid JSON in the form { "platformId": "copy text", ... }.',
    ].join(' ');

    try {
      // Built inside the try so a malformed plan shape (e.g. a non-array
      // `angles`) throws here and is recorded as a real failure, not swallowed.
      const prompt = this._buildPrompt(input);
      const raw = await this._ai.generateText('agent', prompt, {
        system,
        orgId,
        userId,
      });
      const perPlatform = this._parseCopy(raw, input.platformLimits);
      return {
        content: JSON.stringify({ perPlatform }),
        workflow_complete: false,
      };
    } catch (err) {
      // Rethrow so the conductor's circuit breaker records the failure instead
      // of receiving success-shaped empty copy.
      this._logger.warn(
        `Copywriter generation failed: ${(err as Error).message}`,
        CopywriterService.name
      );
      throw err;
    }
  };

  private _buildPrompt(input: CopywriterInput): string {
    const { plan, platformLimits, tone, existingCopy, fixes } = input;
    const lines: string[] = [
      `Brief / concept: ${plan.structure || 'Write compelling social copy.'}`,
      `Platforms and character limits:`,
      ...platformLimits.map(
        (p) => `- ${p.id}: max ${p.maxLength} characters`
      ),
    ];

    if (plan.angles && plan.angles.length > 0) {
      lines.push('', 'Angles to choose from:', ...plan.angles.map((a) => `- ${a}`));
    }
    if (plan.hooks && plan.hooks.length > 0) {
      lines.push('', 'Hooks to choose from:', ...plan.hooks.map((h) => `- ${h}`));
    }
    if (tone) {
      lines.push('', `Tone: ${tone}`);
    }

    if (existingCopy && Object.keys(existingCopy).length > 0) {
      lines.push('', 'Existing copy to revise:');
      for (const [id, text] of Object.entries(existingCopy)) {
        lines.push(`- ${id}: ${text}`);
      }
    }
    if (fixes && fixes.length > 0) {
      lines.push('', 'Required fixes:', ...fixes.map((f) => `- ${f}`));
    }

    lines.push(
      '',
      'Return a JSON object mapping each platform id to its copy text. Do not exceed the listed character limits.'
    );
    return lines.join('\n');
  }

  private _parseCopy(
    raw: string,
    platformLimits: PlatformLimit[]
  ): Record<string, string> {
    const parsed = this._safeJson(raw) as Record<string, string> | undefined;
    const result: Record<string, string> = {};
    const ids = platformLimits.map((p) => p.id);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const id of ids) {
        const text = parsed[id];
        if (typeof text === 'string') {
          result[id] = text;
        }
      }
    }

    // Fallback: line extraction if JSON is malformed.
    if (Object.keys(result).length === 0) {
      for (const line of raw.split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const id = line.slice(0, idx).trim();
        const text = line.slice(idx + 1).trim();
        if (ids.includes(id) && text) {
          result[id] = text;
        }
      }
    }

    return result;
  }

  private _safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
}
