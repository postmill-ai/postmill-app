import type { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import type { DesignerDoc, DesignerOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { readErrorMessage } from './read-error-message';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ExportFallbackFormat = 'png' | 'jpeg' | 'transparent' | 'webp';

interface FallbackRenderResult {
  blob: Blob;
  usedFormat: ExportFallbackFormat;
  usedQuality: number;
  usedScale: number;
}

export const renderWithFormatFallback = async (
  format: ExportFallbackFormat,
  quality: number,
  scale: number,
  tryRender: (format: ExportFallbackFormat, quality: number, scale: number) => Promise<Blob>,
): Promise<FallbackRenderResult> => {
  const scales = [scale, ...[2, 1].filter((candidate) => candidate < scale)];
  const qualities = format === 'jpeg' || format === 'webp'
    ? [quality, Math.min(quality, 0.7), Math.min(quality, 0.5)]
        .filter((candidate, index, values) => values.indexOf(candidate) === index)
    : [quality];

  for (const nextScale of scales) {
    for (const nextQuality of qualities) {
      const blob = await tryRender(format, nextQuality, nextScale);
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return {
          blob,
          usedFormat: format,
          usedQuality: nextQuality,
          usedScale: nextScale,
        };
      }
    }
  }

  const label = format === 'transparent' ? 'Transparent PNG' : format.toUpperCase();
  throw new Error(`Could not reduce ${label} under 10 MB. Choose a smaller scale or JPEG.`);
};

export const renderOutputWithFallback = async (
  doc: DesignerDoc,
  output: DesignerOutput,
  format: ExportFallbackFormat,
  quality: number,
  scale: number,
  fetchFn: ReturnType<typeof useFetch>,
): Promise<FallbackRenderResult> =>
  renderWithFormatFallback(format, quality, scale, async (nextFormat, nextQuality, nextScale) => {
    const response = await fetchFn('/media/designs/render', {
      method: 'POST',
      body: JSON.stringify({
        doc: { ...doc, outputs: [output] },
        outputIndex: 0,
        pageNumber: 0,
        format: nextFormat === 'transparent' ? 'png' : nextFormat,
        quality: nextQuality,
        pixelRatio: nextScale,
        transparent: nextFormat === 'transparent',
      }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Render failed'));
    }
    return response.blob();
  });
