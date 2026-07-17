import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { StockMediaService } from '@gitroom/nestjs-libraries/media/stock/stock-media.service';
import { z } from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

const MAX_STOCK_RESULTS = 12;

@Injectable()
export class StockSearchTool implements AgentToolInterface {
  constructor(private _stockMediaService: StockMediaService) {}
  name = 'stockSearch';

  run() {
    return createTool({
      id: 'stockSearch',
      description: `Search free stock media (photos or videos). Returns a capped list of results with preview URL, thumbnail, source, and attribution. To attach a result, pass its URL through the uploadFromUrl tool or the FileService.importFromUrl path.`,
      inputSchema: z.object({
        query: z.string().describe('Search keywords'),
        kind: z
          .enum(['photos', 'videos'])
          .describe('Whether to search photos or videos'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Page number'),
      }),
      mcp: {
        annotations: {
          title: 'Search Stock Media',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            url: z.string(),
            thumb: z.string(),
            source: z.string(),
            attribution: z.any().optional(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        const page = inputData.page ?? 1;

        const response =
          inputData.kind === 'photos'
            ? await this._stockMediaService.searchPhotos(org.id, inputData.query, page)
            : await this._stockMediaService.searchVideos(org.id, inputData.query, page);

        const capped = response.results.slice(0, MAX_STOCK_RESULTS).map((item) => ({
          url: item.url,
          thumb: item.thumbUrl,
          source: item.source,
          attribution: item.attribution,
        }));

        return {
          output: capped,
        };
      },
    });
  }
}
