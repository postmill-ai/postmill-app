import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { CONTENT_PIPELINE_AGENT_IDS } from '../pipeline-registry.data';

interface FinalizerInput {
  perPlatform: Record<string, string>;
  plan?: {
    angles?: string[];
    hooks?: string[];
  };
}

interface FinalizerResult {
  content: string[];
  perPlatform: Record<string, string>;
  imagePrompts?: string[];
}

@Injectable()
export class FinalizerService implements OnModuleInit {
  private readonly _logger = new Logger(FinalizerService.name);

  onModuleInit() {
    registerInProcessAgent(
      CONTENT_PIPELINE_AGENT_IDS.finalizer,
      this._handler.bind(this)
    );
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    try {
      const input = JSON.parse(context.raw_input) as FinalizerInput;
      const result = this._assemble(input);
      return {
        content: JSON.stringify(result),
        workflow_complete: true,
      };
    } catch (err) {
      this._logger.warn(
        `Finalizer failed: ${(err as Error).message}`,
        FinalizerService.name
      );
      return {
        content: JSON.stringify({ content: [], perPlatform: {} }),
        workflow_complete: true,
      };
    }
  };

  private _assemble(input: FinalizerInput): FinalizerResult {
    const perPlatform = input.perPlatform ?? {};
    const content = Object.values(perPlatform).filter(Boolean);

    // Optional image prompts derived from the plan's angles/hooks without an
    // extra LLM call.
    const imagePrompts: string[] | undefined =
      input.plan?.angles && input.plan.angles.length > 0
        ? input.plan.angles.map(
            (angle, i) =>
              `${angle}${
                input.plan?.hooks?.[i] ? ` — ${input.plan.hooks[i]}` : ''
              }`
          )
        : undefined;

    return { content, perPlatform, imagePrompts };
  }
}
