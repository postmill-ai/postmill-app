import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import {
  parseOrg,
  requireRead,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class RunGeneratorTool implements AgentToolInterface {
  constructor(
    private _agentGraphService: AgentGraphService,
    private _ragService: RagService,
  ) {}
  name = 'runGenerator';

  private async _groundResearch(orgId: string, research: string): Promise<string> {
    try {
      const results = await this._ragService.searchBrandMemory(orgId, research, 5);
      if (!results.length) return research;

      const exemplars = results
        .map((r) => `- ${r.text.replace(/\n/g, ' ').trim()}`)
        .join('\n');
      return `Here are some past top-performing posts to echo in style:\n${exemplars}\n\n${research}`;
    } catch {
      // RAG disabled or unavailable — generate with the original research.
      return research;
    }
  }

  run() {
    return createTool({
      id: 'runGenerator',
      description: `Run the research-grounded generator to produce a single post or thread. Uses web search plus category/topic/popular-post context. Set isPicture to true to also generate a picture for each content item.`,
      inputSchema: z.object({
        research: z
          .string()
          .min(10)
          .describe('Research brief or prompt for the generator (min 10 chars)'),
        isPicture: z
          .boolean()
          .optional()
          .describe('Whether to generate a picture for each post item'),
        format: z
          .enum(['one_short', 'one_long', 'thread_short', 'thread_long'])
          .describe('Desired post format'),
        tone: z
          .enum(['personal', 'company'])
          .describe('Tone of voice: personal (1st person) or company (3rd person)'),
      }),
      outputSchema: z.object({
        content: z
          .array(z.string())
          .describe('Generated content items'),
        pictureFileIds: z
          .array(z.string())
          .optional()
          .describe('File ids of generated pictures, when requested'),
      }),
      mcp: {
        annotations: {
          title: 'Run Generator',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        // Image generation drives real provider spend + org file writes — a
        // headless/mcp:read run must not be able to spend media money.
        if (inputData.isPicture) requireWrite(context as any);
        const org = parseOrg(context as any);

        const groundedResearch = await this._groundResearch(org.id, inputData.research);

        const body: GeneratorDto = {
          research: groundedResearch,
          isPicture: inputData.isPicture ?? false,
          format: inputData.format,
          tone: inputData.tone,
        };

        // start() is async (up-front budget gate) — await the stream handle.
        const stream = await this._agentGraphService.start(org.id, body);

        // `AgentGraphService.start` returns `streamEvents(..., { version: 'v2' })`.
        // LangGraph v2 events nest the graph state under `data.output` (terminal
        // `on_chain_end`) or `data.chunk` (streamed `on_chain_stream` values) — never
        // directly on `data`. Keep the last payload that actually carries a `content`
        // array (the final state). (Reading `event.data.content` yields `[]` every run.)
        let lastState: any;
        for await (const event of stream) {
          const payload =
            event?.data?.output ?? event?.data?.chunk ?? event?.data;
          if (
            payload &&
            typeof payload === 'object' &&
            Array.isArray(payload.content)
          ) {
            lastState = payload;
          }
        }

        const items = lastState?.content ?? [];
        if (!items.length) {
          return { content: [] };
        }

        return {
          content: items.map((item: any) => item.content),
          pictureFileIds: items
            .map((item: any) => item.image?.id)
            .filter(Boolean),
        };
      },
    });
  }
}
