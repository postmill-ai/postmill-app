import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class RagSearchTool implements AgentToolInterface {
  constructor(private _ragService: RagService) {}
  name = 'ragSearch';

  run() {
    return createTool({
      id: 'ragSearch',
      description:
        'Search the organization\'s RAG knowledge base for relevant snippets across indexed posts, media, and other content.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of results to return (default 5)'),
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({
            text: z.string(),
            sourceType: z.string(),
            sourceId: z.string(),
            score: z.number(),
          })
        ),
      }),
      mcp: {
        annotations: {
          title: 'RAG Search',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context);
        const org = parseOrg(context);
        const results = await this._ragService.search({
          organizationId: org.id,
          query: inputData.query,
          limit: inputData.limit ?? 5,
        });
        return { results };
      },
    });
  }
}
