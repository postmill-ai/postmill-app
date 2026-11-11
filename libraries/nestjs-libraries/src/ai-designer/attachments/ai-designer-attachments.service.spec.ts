import { describe, expect, it, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { AiDesignerAttachmentsService } from './ai-designer-attachments.service';

const pdf = async (text: string): Promise<Buffer> => {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => document.on('end', resolve));
  document.text(text);
  document.end();
  await finished;
  return Buffer.concat(chunks);
};

const makeService = (files: Record<string, any>) => {
  const fileService = {
    getFileById: vi.fn(async (_orgId: string, id: string) => files[id]?.row ?? null),
  };
  const storageService = {
    resolveAdapterForFolder: vi.fn(async () => ({
      readFile: vi.fn(async (path: string) => files[path]?.bytes),
    })),
  };
  return {
    service: new AiDesignerAttachmentsService(fileService as any, storageService as any),
    fileService,
    storageService,
  };
};

const textFile = (id: string, text: string, name = 'brief.txt') => ({
  row: {
    id,
    name,
    originalName: name,
    fileSize: Buffer.byteLength(text),
    folderId: 'folder-1',
    path: id,
  },
  bytes: Buffer.from(text),
});

describe('AiDesignerAttachmentsService', () => {
  it('reads bounded text documents with org-scoped file lookup', async () => {
    const { service, fileService } = makeService({ 'doc-1': textFile('doc-1', 'Launch the spring collection') });
    const contexts = await service.contextsFor('org-1', ['doc-1']);

    expect(fileService.getFileById).toHaveBeenCalledWith('org-1', 'doc-1');
    expect(contexts).toEqual([{ fileId: 'doc-1', name: 'brief.txt', text: 'Launch the spring collection' }]);
  });

  it('extracts text from real PDF bytes', async () => {
    const bytes = await pdf('Postmill spring brief');
    const { service } = makeService({
      'pdf-1': {
        row: { id: 'pdf-1', name: 'spring.pdf', originalName: 'spring.pdf', fileSize: bytes.length, path: 'pdf-1' },
        bytes,
      },
    });
    const contexts = await service.contextsFor('org-1', ['pdf-1']);

    expect(contexts[0].text).toContain('Postmill spring brief');
  });

  it('rejects a foreign or missing file without exposing its existence', async () => {
    const { service } = makeService({});
    await expect(service.contextsFor('org-2', ['doc-1'])).rejects.toThrow(
      'An attachment could not be found.'
    );
  });

  it('rejects more than ten attachments before reading storage', async () => {
    const { service, storageService } = makeService({});
    await expect(service.contextsFor('org-1', Array.from({ length: 11 }, (_, i) => `doc-${i}`))).rejects.toThrow(
      'limited to 10 attachments'
    );
    expect(storageService.resolveAdapterForFolder).not.toHaveBeenCalled();
  });

  it('rejects unsupported content and malformed PDFs', async () => {
    const { service } = makeService({
      'image-1': {
        row: { id: 'image-1', name: 'pixel.png', originalName: 'pixel.png', fileSize: 8, path: 'image-1' },
        bytes: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
      },
      'bad.pdf': {
        row: { id: 'bad.pdf', name: 'bad.pdf', originalName: 'bad.pdf', fileSize: 8, path: 'bad.pdf' },
        bytes: Buffer.from('%PDF-bad'),
      },
    });
    await expect(service.contextsFor('org-1', ['image-1'])).rejects.toThrow(
      'Attachments must be PDF, TXT, Markdown, CSV, TSV, or JSON documents.'
    );
    await expect(service.contextsFor('org-1', ['bad.pdf'])).rejects.toThrow();
  });

  it('caps extracted characters per document and across the session', async () => {
    const { service } = makeService({
      'large-1': textFile('large-1', 'a'.repeat(12_100)),
      'large-2': textFile('large-2', 'b'.repeat(12_000)),
      'large-3': textFile('large-3', 'c'.repeat(12_000)),
      'large-4': textFile('large-4', 'd'.repeat(12_000)),
      'large-5': textFile('large-5', 'e'.repeat(12_000)),
    });
    const contexts = await service.contextsFor('org-1', ['large-1', 'large-2', 'large-3', 'large-4', 'large-5']);

    expect(contexts[0].text).toHaveLength(12_000);
    expect(contexts.reduce((sum, context) => sum + context.text.length, 0)).toBe(40_000);
  });
});
