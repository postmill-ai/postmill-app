import { BadRequestException, Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';
import {
  MAX_AI_DESIGNER_ATTACHMENTS,
  MAX_AI_DESIGNER_ATTACHMENT_BYTES,
  MAX_AI_DESIGNER_PDF_BYTES,
} from '@postmill-ai/helpers/utils/ai-designer-attachments';

export {
  MAX_AI_DESIGNER_ATTACHMENTS,
  MAX_AI_DESIGNER_ATTACHMENT_BYTES,
} from '@postmill-ai/helpers/utils/ai-designer-attachments';

export interface AiDesignerDocumentContext {
  fileId: string;
  name: string;
  text: string;
}

export const MAX_AI_DESIGNER_ATTACHMENT_CHARS = 12_000;
export const MAX_AI_DESIGNER_ATTACHMENT_TOTAL_CHARS = 40_000;
const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'tsv', 'json']);

const cleanText = (value: string): string =>
  value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

@Injectable()
export class AiDesignerAttachmentsService {
  constructor(
    private readonly _fileService: FileService,
    private readonly _storageService: StorageService,
  ) {}

  async contextsFor(orgId: string, fileIds: string[] = []): Promise<AiDesignerDocumentContext[]> {
    if (fileIds.length > MAX_AI_DESIGNER_ATTACHMENTS) {
      throw new BadRequestException(`AI Designer is limited to ${MAX_AI_DESIGNER_ATTACHMENTS} attachments.`);
    }
    const contexts: AiDesignerDocumentContext[] = [];
    let totalChars = 0;
    for (const fileId of new Set(fileIds)) {
      const file = await this._fileService.getFileById(orgId, fileId);
      if (!file) throw new BadRequestException('An attachment could not be found.');
      if (file.fileSize > MAX_AI_DESIGNER_ATTACHMENT_BYTES) {
        throw new BadRequestException('AI Designer attachments are limited to 20 MB each.');
      }
      let bytes: Buffer;
      try {
        const adapter = await this._storageService.resolveAdapterForFolder(file.folderId, orgId);
        bytes = await adapter.readFile(file.path);
      } catch {
        throw new BadRequestException('An attachment could not be read from storage.');
      }
      if (bytes.length > MAX_AI_DESIGNER_ATTACHMENT_BYTES) {
        throw new BadRequestException('AI Designer attachments are limited to 20 MB each.');
      }
      let detected: Awaited<ReturnType<typeof fromBuffer>>;
      try {
        detected = await fromBuffer(bytes);
      } catch {
        throw new BadRequestException('An attachment could not be read as a document.');
      }
      const extension = file.originalName?.split('.').pop()?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || '';
      const isPdf = detected?.mime === 'application/pdf';
      const isText = detected?.mime?.startsWith('text/') || detected?.mime === 'application/json' || TEXT_EXTENSIONS.has(extension);
      if (!isPdf && !isText) {
        throw new BadRequestException('Attachments must be PDF, TXT, Markdown, CSV, TSV, or JSON documents.');
      }
      if (isPdf && bytes.length > MAX_AI_DESIGNER_PDF_BYTES) {
        throw new BadRequestException('PDF attachments are limited to 5 MB each.');
      }
      if (!isPdf && bytes.length > MAX_TEXT_ATTACHMENT_BYTES) {
        throw new BadRequestException('Text attachments are limited to 2 MB each.');
      }

      let text: string;
      try {
        if (isPdf) {
          const parser = new PDFParse({ data: bytes });
          try {
            text = (await parser.getText({ first: MAX_PDF_PAGES })).text;
          } finally {
            await parser.destroy();
          }
        } else {
          text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        }
      } catch {
        throw new BadRequestException('An attachment could not be read as a document.');
      }
      text = cleanText(text).slice(0, MAX_AI_DESIGNER_ATTACHMENT_CHARS);
      if (!text) throw new BadRequestException('An attachment contains no readable text.');
      const remaining = MAX_AI_DESIGNER_ATTACHMENT_TOTAL_CHARS - totalChars;
      if (remaining <= 0) break;
      text = text.slice(0, remaining);
      totalChars += text.length;
      contexts.push({
        fileId: file.id,
        name: (file.originalName || file.name || 'Attachment').slice(0, 300),
        text,
      });
    }
    return contexts;
  }
}
