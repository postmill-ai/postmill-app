import { Injectable } from '@nestjs/common';
import { DesignRenderService } from './design-render.service';
import { DesignerDoc, DesignerElement, DesignerOutput, RenderOptions } from './design-render.types';

export const MAX_BULK_ROWS = 200;

export interface BulkGenerateResult {
  images: Buffer[];
  truncated: boolean;
  totalRows: number;
}

@Injectable()
export class DesignBulkService {
  constructor(private readonly _renderService: DesignRenderService) {}

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
    const doc: DesignerDoc =
      typeof structuredClone === 'function'
        ? structuredClone(templateDoc)
        : JSON.parse(JSON.stringify(templateDoc));

    for (const page of (doc.outputs ?? []).filter(o => 'children' in o) as DesignerOutput[]) {
      for (const el of (page.children ?? [])) {
        this.substituteElement(el, row);
      }
    }
    return doc;
  }

  private substituteElement(
    el: DesignerElement,
    row: Record<string, string>
  ): void {
    if (typeof el.text === 'string') {
      el.text = this.substitute(el.text, row);
    }
    if (el.richText?.length) {
      for (const run of el.richText) {
        if (typeof run.text === 'string') {
          run.text = this.substitute(run.text, row);
        }
      }
    }
    if (typeof el.src === 'string') {
      el.src = this.substitute(el.src, row);
    }
  }

  private substitute(value: string, row: Record<string, string>): string {
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
      const replacement = row[key];
      return replacement === undefined || replacement === null
        ? match
        : String(replacement);
    });
  }
}
