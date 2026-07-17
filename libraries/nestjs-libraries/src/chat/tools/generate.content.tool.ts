import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import {
  parseOrg,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class GenerateContentTool implements AgentToolInterface {
  constructor(
    private _aiDefaults: AiDefaultsService,
    private _ragService: RagService,
  ) {}
  name = 'generatePostContent';

  private async _groundPrompt(orgId: string, prompt: string): Promise<string> {
    try {
      const results = await this._ragService.searchBrandMemory(orgId, prompt, 5);
      if (!results.length) return prompt;

      const exemplars = results
        .map((r, i) => `[${i + 1}] ${r.text.replace(/\n/g, ' ').trim()}`)
        .join('\n');
      return `Here are some past top-performing posts to echo:\n${exemplars}\n\nNow write: ${prompt}`;
    } catch {
      // RAG disabled or unavailable — generate with the original prompt.
      return prompt;
    }
  }

  run() {
    return createTool({
      id: 'generatePostContent',
      description: `Generate post content text from a prompt. Use reasoning:'high' for complex, nuanced, or multi-step copy; use 'low' (default) for quick, simple captions.`,
      inputSchema: z.object({
        prompt: z
          .string()
          .describe('The prompt describing the desired post content'),
        reasoning: z
          .enum(['low', 'high'])
          .optional()
          .describe(
            'Model reasoning level: low (default) for fast/cheap output, high for deeper reasoning'
          ),
      }),
      outputSchema: z.object({
        content: z.string().describe('Generated post content text'),
      }),
      mcp: {
        annotations: {
          title: 'Generate Post Content',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireRead(ctx);
        const org = parseOrg(ctx);
        const prompt = await this._groundPrompt(org.id, inputData.prompt);
        const content =
          inputData.reasoning === 'high'
            ? await this._aiDefaults.highReasoningText(org.id, prompt)
            : await this._aiDefaults.lowReasoningText(org.id, prompt);
        return { content };
      },
    });
  }
}
