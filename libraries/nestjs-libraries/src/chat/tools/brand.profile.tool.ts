import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class BrandProfileTool implements AgentToolInterface {
  constructor(private _brandsService: BrandsService) {}
  name = 'brandProfile';

  run() {
    return createTool({
      id: 'brandProfile',
      description:
        'Return the organization\'s brand profile: the default brand (name, instructions, language, platform instructions) and a list of all brands.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        default: z
          .object({
            name: z.string(),
            instructions: z.string().nullable().optional(),
            language: z.string().nullable().optional(),
            platformInstructions: z.record(z.string()).nullable().optional(),
          })
          .optional(),
        all: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
          })
        ),
      }),
      mcp: {
        annotations: {
          title: 'Brand Profile',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (_inputData, context) => {
        checkAuth(_inputData, context);
        requireRead(context);
        const org = parseOrg(context);
        const [defaultBrand, allBrands] = await Promise.all([
          this._brandsService.getDefaultBrand(org.id),
          this._brandsService.getBrands(org.id),
        ]);
        return {
          default: defaultBrand
            ? {
                name: defaultBrand.name,
                instructions: defaultBrand.instructions,
                language: defaultBrand.language,
                platformInstructions: defaultBrand.platformInstructions,
              }
            : undefined,
          all: allBrands.map((b) => ({ id: b.id, name: b.name })),
        };
      },
    });
  }
}
