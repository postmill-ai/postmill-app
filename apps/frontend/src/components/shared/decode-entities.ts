export function decodeEntities(input?: string | null): string {
  if (!input) return input ?? '';
  const cp = (raw: string, n: number) =>
    Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  const once = (s: string) =>
    s
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, (m, n) => cp(m, Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(m, parseInt(h, 16)))
      .replace(/&amp;/gi, '&');
  return once(input);
}
