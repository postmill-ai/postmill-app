// Minimal markdown → HTML converter for AI Designer agent messages.
// Covers bold, italic, inline code, links, unordered/ordered lists, and line
// breaks. The output is always rendered through SafeContent (DOMPurify), so
// this only needs to produce well-formed HTML — sanitization happens there.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  // Extract code spans first (replaced with placeholders) so bold/italic/link
  // formatting never touches already-emitted <code> content, then restore
  // them at the end. The input is already HTML-escaped (escapeHtml runs
  // before any tag building) so the spans stay literal.
  const codes: string[] = [];
  // Strip any raw NULs from the input so they can't collide with the
  // placeholder sentinels below.
  let out = s.replace(/\u0000/g, '').replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Underscore italics only apply to whole words — mid-word underscores
    // (snake_case identifiers) must stay literal.
    .replace(
      /(^|[^0-9A-Za-z_])_([^_]+)_(?![0-9A-Za-z_])/g,
      '$1<em>$2</em>'
    )
    .replace(
      /\[([^\[\]]+)\]\((https?:\/\/[^)\s]{1,2000})\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
}

export function markdownToHtml(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/);
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br />')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul || ol)![1])}</li>`);
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}
