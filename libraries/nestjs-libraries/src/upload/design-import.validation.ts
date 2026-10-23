import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { hasZipMagic } from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';

/** `.pdesign` / raw-`.json` design import cap — a doc is JSON, 25 MB is generous. */
export const DESIGN_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

export type DesignImportKind = 'pdesign' | 'json';

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
      throw new BadRequestException('Design file is too large (max 25 MB).');
    }

    const buffer: Buffer | undefined = Buffer.isBuffer(value.buffer)
      ? value.buffer
      : undefined;
    const isZip = !!buffer && hasZipMagic(buffer);
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
