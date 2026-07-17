import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { parseOrg, requireWrite } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class BrandMemoryReindexTool implements AgentToolInterface {
  constructor(private _ragService: RagService) {}
  name = 'brandMemoryReindex';

  run() {
    return createTool({
      id: 'brandMemoryReindex',
      description:
        'Re-index the organization\'s top-performing posts into brand memory so future searches can ground copy in the brand\'s best content.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        indexedItems: z.number(),
      }),
      mcp: {
        annotations: {
          title: 'Brand Memory Reindex',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (_inputData, context) => {
        checkAuth(_inputData, context);
        requireWrite(context);
        const org = parseOrg(context);
        await this._ragService.indexTopPerformingPosts(org.id);
        const status = await this._ragService.getStatus(org.id);
        return { indexedItems: status.indexedItems };
      },
    });
  }
}
