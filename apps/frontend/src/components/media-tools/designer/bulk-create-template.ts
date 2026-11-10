import type { BulkVariableKind } from '@postmill-ai/nestjs-libraries/media/designer-doc/bulk-variables';

export const inferBulkHeaderKind = (header: string): BulkVariableKind => {
  if (/(?:image|photo|logo|hero|src|url)/i.test(header)) return 'image';
  if (/(?:colou?r|hex|fill)/i.test(header)) return 'color';
  return 'text';
};

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const buildBulkTemplateCsv = (
  headers: string[],
  kindFor: (header: string) => BulkVariableKind,
): string => {
  const columns = headers.length ? headers : ['Product Name', 'Description', 'Product Image'];
  const example = columns.map((header) => {
    const kind = kindFor(header);
    if (kind === 'image') return '=IMAGE("https://cdn.example.com/product.png")';
    if (kind === 'color') return '#2B5CD3';
    return 'Example text';
  });
  return [columns, example]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
};
