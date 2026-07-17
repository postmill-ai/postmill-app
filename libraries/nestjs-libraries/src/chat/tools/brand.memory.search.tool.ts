import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class BrandMemorySearchTool implements AgentToolInterface {
  constructor(private _ragService: RagService) {}
  name = 'brandMemorySearch';

  run() {
    return createTool({
      id: 'brandMemorySearch',
      description:
        'Search the organization\'s brand memory — indexed top-performing posts — for snippets that match a query. Use this to ground copy in the brand\'s historical voice.',
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
          title: 'Brand Memory Search',
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
        const results = await this._ragService.searchBrandMemory(
          org.id,
          inputData.query,
          inputData.limit ?? 5
        );
        return { results };
      },
    });
  }
}
