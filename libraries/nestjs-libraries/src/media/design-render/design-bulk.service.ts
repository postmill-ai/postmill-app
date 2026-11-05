import { Injectable } from '@nestjs/common';
import { DesignRenderService } from './design-render.service';
import { DesignerDoc, RenderOptions } from './design-render.types';
import { applyBulkRow } from '../designer-doc/bulk-variables';

export const MAX_BULK_ROWS = 200;

export interface BulkGenerateResult {
  images: Buffer[];
  truncated: boolean;
  totalRows: number;
}

@Injectable()
export class DesignBulkService {
  constructor(protected readonly _renderService: DesignRenderService) {}

  /**
   * For each data row, deep-clone the template doc, substitute `{{var}}`
   * placeholders inside every text element's `text` (and `src` if it equals a
   * single `{{var}}` placeholder), then render the first page to PNG.
   * Rows are capped at MAX_BULK_ROWS; `truncated` reports if the cap was hit.
   */
  async generateBatch(
    templateDoc: DesignerDoc,
    rows: Record<string, string>[],
    opts?: RenderOptions
  ): Promise<BulkGenerateResult> {
    const totalRows = rows?.length ?? 0;
    const truncated = totalRows > MAX_BULK_ROWS;
    const cappedRows = (rows ?? []).slice(0, MAX_BULK_ROWS);

    const images: Buffer[] = [];
    for (const row of cappedRows) {
      const doc = this.applyRow(templateDoc, row);
      images.push(await this._renderService.renderPage(doc, 0, opts));
    }

    return { images, truncated, totalRows };
  }

  private applyRow(
    templateDoc: DesignerDoc,
    row: Record<string, string>
  ): DesignerDoc {
    return applyBulkRow(templateDoc, row);
  }
}
