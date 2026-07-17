import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { z } from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

const MAX_FILES = 50;

@Injectable()
export class FilesSearchTool implements AgentToolInterface {
  constructor(private _fileService: FileService) {}
  name = 'filesSearch';

  run() {
    return createTool({
      id: 'filesSearch',
      description: `Search the organization's file library. Returns uploaded files with id, name, path, type, and tags. File ids can be passed to mediaStudioGenerate.mediaInputs, schedulePost attachments, or the composer handoff. Set includeFolderTree to true to also return the folder structure.`,
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Optional text search across file names, original names, tags, and descriptions'),
        folderId: z
          .string()
          .optional()
          .describe('Optional folder id to scope the search'),
        type: z
          .enum(['image', 'video', 'audio'])
          .optional()
          .describe('Optional media type filter'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Page number when listing without a query'),
        includeFolderTree: z
          .boolean()
          .optional()
          .describe('If true, also return the folder tree structure'),
      }),
      mcp: {
        annotations: {
          title: 'Search Files Library',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            path: z.string(),
            type: z.string(),
            tags: z.any(),
          })
        ),
        folders: z.array(z.any()).optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        const page = inputData.page ?? 1;
        const folderTreePromise = inputData.includeFolderTree
          ? this._fileService.getFolderTree(org.id)
          : Promise.resolve(undefined);

        let files: Array<{
          id: string;
          name: string;
          path: string;
          type: string;
          tags: any;
        }>;

        if (inputData.query?.trim()) {
          files = await this._fileService.searchFiles(
            org.id,
            inputData.query.trim(),
            inputData.folderId
          );
        } else {
          const list = await this._fileService.getFiles(
            org.id,
            page,
            undefined,
            inputData.folderId,
            inputData.type,
            undefined,
            undefined,
            undefined,
            MAX_FILES
          );
          files = list.results;
        }

        const capped = files.slice(0, MAX_FILES).map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          type: f.type,
          tags: f.tags,
        }));

        const folders = await folderTreePromise;

        return {
          output: capped,
          ...(folders !== undefined ? { folders } : {}),
        };
      },
    });
  }
}
