import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { Readable } from 'stream';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file-type.compat';
import {
  parseOrg,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

// Mirror FileService's MAX_IMPORT_SIZE (not exported) — cap remote reads at 512 MB.
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

@Injectable()
export class UploadFromUrlTool implements AgentToolInterface {
  constructor(
    private _fileService: FileService,
    private _storageService: StorageService,
  ) {}
  name = 'uploadFromUrlTool';

  run() {
    return createTool({
      id: 'uploadFromUrlTool',
      description: `Upload a remote image or video into the media library from a public URL.
Use this before scheduling a post when the user provides an external media URL (not already hosted on our domain),
so the attachment passes the upload-domain validation. Returns the hosted media { id, path } to use as an attachment.`,
      mcp: {
        annotations: {
          title: 'Upload Media From URL',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        url: z
          .string()
          .url()
          .describe('The public URL of the image or video to upload'),
      }),
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireWrite(ctx);
        const org = parseOrg(ctx);

        const response = await safeFetch(inputData.url);

        if (!response.ok) {
          throw new Error('Failed to fetch URL');
        }

        // Cap the read at 512 MB — reject on a declared oversized content-length
        // before buffering, and again after reading (a lying/absent header).
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
          return { error: 'File exceeds the 512 MB upload limit' };
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_UPLOAD_BYTES) {
          return { error: 'File exceeds the 512 MB upload limit' };
        }
        const detected = await fromBuffer(buffer);
        if (!detected || !ALLOWED_MIME.has(detected.mime)) {
          throw new Error('Unsupported file type.');
        }

        const adapter = await this._storageService.getLocalAdapterForOrg(org.id, true);
        const getFile = await adapter.uploadFile({
          buffer,
          mimetype: detected.mime,
          size: buffer.length,
          path: '',
          fieldname: '',
          destination: '',
          stream: new Readable(),
          filename: '',
          originalname: `upload.${detected.ext}`,
          encoding: '',
        });

        return this._fileService.saveFile(
          org.id,
          getFile.originalname,
          getFile.path
        );
      },
    });
  }
}
