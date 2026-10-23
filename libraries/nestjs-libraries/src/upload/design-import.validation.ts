import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { promises as fs } from 'fs';
import { hasZipMagic } from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';

/**
 * `.pdesign` / raw-`.json` design import cap. Stage 2 bundles every referenced
 * asset into the file, so the cap jumped from a JSON-sized 25 MB to 1 GB and
 * the upload spools to DISK (the controller's FileInterceptor uses
 * diskStorage) — the pipe therefore sniffs from `path` when no memory
 * `buffer` exists.
 */
export const DESIGN_IMPORT_MAX_BYTES = 1024 * 1024 * 1024;

export type DesignImportKind = 'pdesign' | 'json';

const readHead = async (path: string): Promise<Buffer> => {
  const handle = await fs.open(path, 'r');
  try {
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    return head;
  } finally {
    await handle.close();
  }
};

/**
 * Upload validation for the design-file import endpoint (`POST /media/designs/import`).
 *
 * Deliberately NOT CustomFileValidationPipe: that pipe is for media uploads —
 * it rejects `application/zip`, caps sizes per media kind, and RENAMES the
 * file to the sniffed extension. Here a zip is the primary format, and the
 * original filename feeds the imported design's fallback name, so the file
 * passes through untouched apart from a `designImportKind` annotation.
 */
@Injectable()
export class DesignImportValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (
      !value ||
      typeof value !== 'object' ||
      (!('buffer' in value) && !('fieldname' in value))
    ) {
      throw new BadRequestException('Invalid file upload.');
    }

    if (value.size > DESIGN_IMPORT_MAX_BYTES) {
      throw new BadRequestException('Design file is too large (max 1 GB).');
    }

    const head: Buffer | undefined = Buffer.isBuffer(value.buffer)
      ? value.buffer.subarray(0, 4)
      : value.path
        ? await readHead(value.path).catch(() => undefined)
        : undefined;
    const isZip = !!head && hasZipMagic(head);
    const isJsonName = /\.json$/i.test(value.originalname || '');

    if (!isZip && !isJsonName) {
      throw new BadRequestException(
        'Unsupported file type — import a .pdesign or .json design file.'
      );
    }

    value.designImportKind = (isZip ? 'pdesign' : 'json') as DesignImportKind;

    return value;
  }
}
