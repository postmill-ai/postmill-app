import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DesignService } from '@gitroom/nestjs-libraries/database/prisma/design/design.service';
import { DesignRenderService } from '@gitroom/nestjs-libraries/media/design-render/design-render.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireWrite } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';
import { DesignerDocStrictSchema } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DesignerDocOpSchema } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc-ops.schema';
import { createBlankDoc } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.migrate';

@Injectable()
export class DesignerDesignTool implements AgentToolInterface {
  name = 'designerDesign';

  constructor(
    private _designerDocService: DesignerDocService,
    private _designService: DesignService,
    private _designRenderService: DesignRenderService,
    private _storageService: StorageService,
    private _fileService: FileService,
  ) {}

  run() {
    return createTool({
      id: 'designerDesign',
      description: `Create or update a Designer design from a template, a raw DesignerDoc, or a blank canvas.
Use this when the user wants to generate, edit, or compose a visual design asset.
Prefer "/media/generate-image-with-prompt" first if you only need a single image; use this tool to assemble multi-element designs, apply templates, or place assets on a canvas.`,
      mcp: {
        annotations: {
          title: 'Designer Design',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        name: z.string().optional(),
        designId: z.string().optional(),
        templateId: z.string().optional(),
        doc: DesignerDocStrictSchema.optional(),
        ops: z.array(DesignerDocOpSchema).optional(),
      }),
      outputSchema: z.object({
        designId: z.string().optional(),
        previewFileId: z.string().nullable().optional(),
        previewUrl: z.string().nullable().optional(),
        error: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
      }),
      execute: async (inputData, context) => {
        try {
          checkAuth(inputData, context);
          requireWrite(context as any);

          const requestContext = (context as any)?.requestContext;
          const orgRaw = requestContext?.get('organization');
          const userRaw = requestContext?.get('user');
          if (!orgRaw) {
            return { error: 'Organization context missing', code: 'MISSING_ORG' };
          }
          const org = parseOrg(context as any);
          const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
          if (!user?.id) {
            return { error: 'User context missing', code: 'MISSING_USER' };
          }
          const userId = user.id;

          // 1. Base doc
          let doc: any;
          if (inputData.templateId) {
            doc = await this._designService.instantiateTemplate(org.id, inputData.templateId);
          } else if (inputData.doc) {
            doc = this._designerDocService.validateStrict(inputData.doc);
          } else {
            doc = createBlankDoc();
          }

          // 2. Apply ops
          if (inputData.ops && inputData.ops.length > 0) {
            doc = this._designerDocService.applyOps(doc, inputData.ops);
          }

          // Ensure every element/track/clip has an id and originId before persisting.
          doc = this._designerDocService.assignIdsAndNormalize(doc);

          // 3. Derive dimensions
          const firstOutput = doc.outputs?.[0];
          if (!firstOutput) {
            return { error: 'DesignerDoc has no outputs', code: 'EMPTY_DOC' };
          }
          const width = firstOutput.width;
          const height = firstOutput.height;

          // 4. Preview (image only)
          let previewFileId: string | null = null;
          let previewUrl: string | null = null;
          if (doc.mode === 'image') {
            const buffer = await this._designRenderService.renderPage(doc, 0, { orgId: org.id });
            const adapter = await this._storageService.getLocalAdapterForOrg(org.id, true);
            const path = await adapter.writeBuffer(buffer, 'image/png');
            const fileName = `design-preview-${Date.now()}.png`;
            const file = await this._fileService.saveFile(org.id, fileName, path, fileName);
            previewFileId = file.id;
            previewUrl = file.path;
          }

          // 5. Persist
          let design: any;
          if (inputData.designId) {
            const updatePayload: any = { doc, width, height };
            if (inputData.name !== undefined) updatePayload.name = inputData.name;
            if (previewFileId != null) updatePayload.previewFileId = previewFileId;
            design = await this._designService.updateDesign(org.id, inputData.designId, updatePayload);
          } else {
            design = await this._designService.createDesign(org.id, userId, {
              name: inputData.name || 'Untitled design',
              doc,
              width,
              height,
              previewFileId,
            });
          }

          return {
            designId: design.id,
            previewFileId,
            previewUrl,
          };
        } catch (err: any) {
          const status = err?.getStatus?.();
          const code = err?.code ?? status ?? 'ERROR';
          return {
            error: err?.message || String(err),
            code,
          };
        }
      },
    });
  }
}
