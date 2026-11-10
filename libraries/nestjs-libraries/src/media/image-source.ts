import { BadRequestException } from '@nestjs/common';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { fromBuffer } from '@postmill-ai/nestjs-libraries/upload/file-type.compat';

export interface ValidatedImageSource {
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'webp';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export const readValidatedImageSource = async (url: string): Promise<ValidatedImageSource> => {
  let bytes: Buffer;
  if (url.startsWith('data:')) {
    const commaIdx = url.indexOf(',');
    const header = url.slice(5, commaIdx);
    const payload = url.slice(commaIdx + 1);
    bytes = header.endsWith(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf-8');
  } else {
    const response = await safeFetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }

  const detected = await fromBuffer(bytes).catch(() => undefined);
  if (detected?.mime === 'image/png') return { bytes, ext: 'png', mime: detected.mime };
  if (detected?.mime === 'image/jpeg') return { bytes, ext: 'jpg', mime: detected.mime };
  if (detected?.mime === 'image/webp') return { bytes, ext: 'webp', mime: detected.mime };
  throw new BadRequestException('The image response did not contain a supported PNG, JPEG, or WebP image.');
};
