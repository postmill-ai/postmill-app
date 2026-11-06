export function parseCsv(text: string, delimiter = ','): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;
  let atFieldStart = true;
  const pushField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
    atFieldStart = true;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (closedQuote && ch !== delimiter && ch !== '\r' && ch !== '\n') {
      throw new Error('Unexpected character after a closing quote.');
    }
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (inQuotes) throw new Error('The spreadsheet contains an unclosed quoted field.');
  if (field.length > 0 || row.length > 0 || closedQuote) pushRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export const parseSpreadsheetText = (text: string): string[][] => {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  return parseCsv(text, firstLine.includes('\t') ? '\t' : ',');
};
