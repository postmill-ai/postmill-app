const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
  '#x2F': '/',
  '#47': '/',
};

/**
 * Decode the common HTML entities that social platforms emit in comment bodies
 * (Reddit returns markdown with `&gt;`/`&amp;` encoded; Mastodon emits entities
 * inside its HTML). Not a full entity table — just the ones that actually show up.
 */
export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Convert platform comment HTML (e.g. Mastodon `status.content`) into readable
 * plain text for storage/display:
 *  - `<br>` / closing block tags become newlines so paragraphs survive,
 *  - anchors keep their real target URL (so links aren't lost to truncated
 *    display text), except mention/hashtag anchors which keep their label,
 *  - remaining tags are stripped and entities decoded.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';

  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');

  text = text.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_match, attrs: string, inner: string) => {
      const innerText = inner.replace(/<[^>]+>/g, '').trim();
      const isMentionOrTag = /class="[^"]*(mention|hashtag|u-url)[^"]*"/i.test(attrs);
      const hrefMatch = attrs.match(/href="([^"]*)"/i);
      const href = hrefMatch ? hrefMatch[1] : '';

      if (isMentionOrTag || !href) {
        return innerText;
      }

      // Mastodon truncates the visible URL ("example.com/very/lo…"); prefer the
      // real href so the link is preserved and clickable.
      const normalizedInner = innerText.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const looksTruncated =
        innerText.endsWith('…') ||
        innerText.endsWith('...') ||
        !href.includes(normalizedInner);

      return looksTruncated ? href : innerText;
    }
  );

  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
