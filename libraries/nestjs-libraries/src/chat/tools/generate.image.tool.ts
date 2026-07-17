import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireWrite } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

const MAX_IMAGE_BYTES = 512 * 1024 * 1024;

@Injectable()
export class GenerateImageTool implements AgentToolInterface {
  constructor(
    private _aiDefaults: AiDefaultsService,
    private _fileService: FileService,
    private _storageService: StorageService,
  ) {}
  name = 'generateImageTool';

  run() {
    return createTool({
      id: 'generateImageTool',
      description: `Generate image to use in a post,
                    in case the user specified a platform that requires attachment and attachment was not provided,
                    ask if they want to generate a picture of a video.
      `,
      mcp: {
        annotations: {
          title: 'Generate Image',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        prompt: z.string(),
      }),
      outputSchema: z.object({
        id: z.string(),
        path: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireWrite(context as any);
        const org = parseOrg(context as any);
        const imageUrl = await this._aiDefaults.textToImage(org.id, inputData.prompt);

        const res = await safeFetch(imageUrl);
        if (!res.ok) throw new Error(`Image download failed (${res.status})`);
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
          throw new Error('Generated image exceeds the 512 MB limit');
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          throw new Error('Generated image exceeds the 512 MB limit');
        }
        const ct = res.headers.get('content-type')?.split(';')[0] || 'image/png';
        const ext = ct === 'image/jpeg' ? 'jpg' : ct === 'image/webp' ? 'webp' : 'png';

        const adapter = await this._storageService.getLocalAdapterForOrg(org.id, true);
        const path = await adapter.writeBuffer(buffer, ct);
        const fileName = `generated-image-${Date.now()}.${ext}`;
        return this._fileService.saveFile(org.id, fileName, path, fileName);
      },
    });
  }
}
