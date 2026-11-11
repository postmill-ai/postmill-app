import type { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import {
  MAX_AI_DESIGNER_ATTACHMENTS,
  MAX_AI_DESIGNER_ATTACHMENT_BYTES,
} from '@postmill-ai/helpers/utils/ai-designer-attachments';
import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import { downscaleImageForUpload } from '@postmill-ai/frontend/components/media-tools/downscale-image';
import { readErrorMessage } from '@postmill-ai/frontend/components/media-tools/designer/read-error-message';

export interface AiDesignerDocumentItem {
  fileId: string;
  name: string;
}

export interface AiDesignerAttachmentUploads {
  references: MediaSelectorItem[];
  documents: AiDesignerDocumentItem[];
}

export {
  MAX_AI_DESIGNER_ATTACHMENTS,
  MAX_AI_DESIGNER_ATTACHMENT_BYTES,
} from '@postmill-ai/helpers/utils/ai-designer-attachments';

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'txt', 'md', 'csv', 'tsv', 'json']);

const extensionFor = (file: File): string =>
  file.name.toLowerCase().split('.').pop() || '';

export const uploadAiDesignerAttachments = async (
  fetchFn: ReturnType<typeof useFetch>,
  files: File[],
): Promise<AiDesignerAttachmentUploads> => {
  if (files.length > MAX_AI_DESIGNER_ATTACHMENTS) {
    throw new Error(`AI Designer is limited to ${MAX_AI_DESIGNER_ATTACHMENTS} attachments.`);
  }
  const references: MediaSelectorItem[] = [];
  const documents: AiDesignerDocumentItem[] = [];
  for (const file of files) {
    if (file.size > MAX_AI_DESIGNER_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} exceeds the 20 MB attachment limit.`);
    }
    const isImage = file.type.startsWith('image/');
    if (!isImage && !DOCUMENT_EXTENSIONS.has(extensionFor(file))) {
      throw new Error(`${file.name} must be an image, PDF, TXT, Markdown, CSV, TSV, or JSON file.`);
    }
    const prepared = isImage ? await downscaleImageForUpload(file) : file;
    const form = new FormData();
    form.append('file', prepared, file.name);
    const response = await fetchFn('/files/upload-simple', { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, `Could not upload ${file.name}.`));
    }
    const saved = await response.json() as { id: string; path: string };
    if (isImage) {
      references.push({
        source: 'file',
        fileId: saved.id,
        url: saved.path,
        width: 0,
        height: 0,
        type: 'image',
        name: file.name,
        thumbnail: saved.path,
      });
    } else {
      documents.push({ fileId: saved.id, name: file.name });
    }
  }
  return { references, documents };
};
