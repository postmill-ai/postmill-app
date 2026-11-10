import { BadRequestException } from '@nestjs/common';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';
import { IMAGE_SOURCE_MAX_BYTES } from './image-source.limits';

export interface ValidatedImageSource {
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'webp';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

const imageTooLarge = () => new BadRequestException('The image exceeds the 20 MB size limit.');

const readResponseBody = async (response: Response): Promise<Buffer> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_SOURCE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw imageTooLarge();
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > IMAGE_SOURCE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw imageTooLarge();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
};

export const readValidatedImageSource = async (url: string): Promise<ValidatedImageSource> => {
  let bytes: Buffer;
  if (url.startsWith('data:')) {
    const commaIdx = url.indexOf(',');
    const header = url.slice(5, commaIdx);
    const payload = url.slice(commaIdx + 1);
    const isBase64 = header.endsWith(';base64');
    if (isBase64 && payload.length > 4 * Math.ceil(IMAGE_SOURCE_MAX_BYTES / 3)) {
      throw imageTooLarge();
    }
    bytes = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf-8');
    if (bytes.length > IMAGE_SOURCE_MAX_BYTES) throw imageTooLarge();
  } else {
    const response = await safeFetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    bytes = await readResponseBody(response);
  }

  const detected = await fromBuffer(bytes).catch(() => undefined);
  if (detected?.mime === 'image/png') return { bytes, ext: 'png', mime: detected.mime };
  if (detected?.mime === 'image/jpeg') return { bytes, ext: 'jpg', mime: detected.mime };
  if (detected?.mime === 'image/webp') return { bytes, ext: 'webp', mime: detected.mime };
  throw new BadRequestException('The image response did not contain a supported PNG, JPEG, or WebP image.');
};
