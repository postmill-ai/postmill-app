import { describe, expect, it } from 'vitest';
import { buildBulkTemplateCsv, inferBulkHeaderKind } from './bulk-create-template';

describe('Bulk Create spreadsheet template', () => {
  it('uses current mappings and quotes the IMAGE formula correctly', () => {
    const csv = buildBulkTemplateCsv(
      ['headline', '@Variable6', 'accent_color'],
      (header) => header === '@Variable6' ? 'image' : inferBulkHeaderKind(header),
    );
    const rows = csv.split('\n');

    expect(rows[0]).toBe('"headline","@Variable6","accent_color"');
    expect(rows[1]).toBe('"Example text","=IMAGE(""https://cdn.example.com/product.png"")","#2B5CD3"');
  });

  it('offers a usable default template before a spreadsheet is uploaded', () => {
    expect(buildBulkTemplateCsv([], inferBulkHeaderKind)).toContain(
      '"Product Name","Description","Product Image"'
    );
  });
});
