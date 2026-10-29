export type VideoTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface VideoTextLine {
  text: string;
  width: number;
  lastInParagraph: boolean;
}

export interface VideoTextDrawOptions {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  fill?: string;
  align?: VideoTextAlign;
}

/** Grapheme-ish units matching Konva's wrapper (emoji, flags and combining marks). */
export const videoTextCharacters = (text: string): string[] =>
  [...text].reduce((acc: string[], char: string, index: number, array: string[]) => {
    if (/\p{Emoji}/u.test(char)) {
      const nextChar = array[index + 1];
      if (nextChar && /\p{Emoji_Modifier}|\u200D/u.test(nextChar)) {
        acc.push(char + nextChar);
        array[index + 1] = '';
      } else {
        acc.push(char);
      }
    } else if (/\p{Regional_Indicator}{2}/u.test(char + (array[index + 1] || ''))) {
      acc.push(char + array[index + 1]);
    } else if (index > 0 && /\p{Mn}|\p{Me}|\p{Mc}/u.test(char)) {
      acc[acc.length - 1] += char;
    } else if (char) {
      acc.push(char);
    }
    return acc;
  }, []);

/**
 * Konva-authoritative video-text layout: word wrapping with long-token splitting,
 * explicit paragraphs, and fixed-box overflow. A clip has no letter spacing or
 * padding, so its line height is exactly one fontSize (Konva's default).
 */
export const layoutVideoText = (
  text: string,
  maxWidth: number,
  maxHeight: number,
  fontSize: number,
  measure: (text: string) => number,
  align: VideoTextAlign = 'left'
): VideoTextLine[] => {
  const lines: VideoTextLine[] = [];
  const paragraphs = text.split('\n');
  const lineHeightPx = fontSize;
  let currentHeightPx = 0;
  const addLine = (value: string) => {
    const line = align === 'justify' ? value.trim() : value;
    lines.push({ text: line, width: measure(line), lastInParagraph: false });
  };

  for (let i = 0; i < paragraphs.length; i++) {
    let line = paragraphs[i];
    if (measure(line) > maxWidth) {
      while (line.length > 0) {
        const chars = videoTextCharacters(line);
        let low = 0;
        let high = chars.length;
        let match = '';
        let matchWidth = 0;
        while (low < high) {
          const mid = (low + high) >>> 1;
          const substr = chars.slice(0, mid + 1).join('');
          const substrWidth = measure(substr);
          if (substrWidth <= maxWidth) {
            low = mid + 1;
            match = substr;
            matchWidth = substrWidth;
          } else {
            high = mid;
          }
        }
        if (!match) break;

        const matchChars = videoTextCharacters(match);
        const nextChar = chars[matchChars.length];
        let wrapIndex: number;
        if ((nextChar === ' ' || nextChar === '-') && matchWidth <= maxWidth) {
          wrapIndex = matchChars.length;
        } else {
          wrapIndex = Math.max(matchChars.lastIndexOf(' '), matchChars.lastIndexOf('-')) + 1;
        }
        if (wrapIndex > 0) {
          low = wrapIndex;
          match = chars.slice(0, low).join('');
          matchWidth = measure(match);
        }

        addLine(match.trimRight());
        currentHeightPx += lineHeightPx;
        if (currentHeightPx + lineHeightPx > maxHeight) break;
        line = chars.slice(low).join('').trimLeft();
        if (line.length > 0 && measure(line) <= maxWidth) {
          addLine(line);
          currentHeightPx += lineHeightPx;
          break;
        }
      }
    } else {
      addLine(line);
      currentHeightPx += lineHeightPx;
    }
    if (lines.length) lines[lines.length - 1].lastInParagraph = true;
    if (currentHeightPx + lineHeightPx > maxHeight) break;
  }
  return lines;
};

/** Draw a layout exactly as Konva Text does: centred baseline and per-character justification. */
export const drawVideoText = (
  ctx: {
    font: string;
    fillStyle: unknown;
    textBaseline: string;
    textAlign: string;
    measureText: (text: string) => { width: number };
    fillText: (text: string, x: number, y: number) => void;
  },
  options: VideoTextDrawOptions
): VideoTextLine[] => {
  if (!options.text) return [];
  const fontSize = options.fontSize;
  const align = options.align || 'left';
  ctx.font = `${options.fontWeight || 400} ${fontSize}px "${options.fontFamily || 'Arial'}"`;
  ctx.fillStyle = options.fill || '#000000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const measure = (text: string) => ctx.measureText(text).width;
  const lines = layoutVideoText(
    options.text,
    options.width,
    options.height,
    fontSize,
    measure,
    align
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const y = index * fontSize + fontSize / 2;
    let x = align === 'right'
      ? options.width - line.width
      : align === 'center'
        ? (options.width - line.width) / 2
        : 0;
    if (align === 'justify' && !line.lastInParagraph) {
      const spaces = line.text.split(' ').length - 1;
      for (const char of videoTextCharacters(line.text)) {
        if (char === ' ') x += (options.width - line.width) / spaces;
        ctx.fillText(char, x, y);
        x += measure(char);
      }
    } else {
      ctx.fillText(line.text, x, y);
    }
  }
  return lines;
};

export const videoTextLayoutSource = (): string =>
  `const videoTextCharacters = ${String(videoTextCharacters)};\n` +
  `const layoutVideoText = ${String(layoutVideoText)};\n` +
  `const drawVideoText = ${String(drawVideoText)};`;
