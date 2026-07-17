'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import type { DesignerElement, TextRun } from './designer.store';

interface TextEditingProps {
  element: DesignerElement;
  stageRect: { x: number; y: number; scale: number };
  onUpdate: (id: string, updates: Partial<DesignerElement>) => void;
  onComplete: () => void;
}

const RUN_STYLE_PROPS = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'color',
  'text-decoration',
]);

const styleStringToRun = (
  style: CSSStyleDeclaration | undefined,
  base: Partial<TextRun>
): Partial<TextRun> => {
  if (!style) return base;
  const run: Partial<TextRun> = { ...base };
  const family = style.fontFamily?.replace(/^["']|["']$/g, '');
  if (family && family !== 'inherit') run.fontFamily = family;
  const size = style.fontSize;
  if (size) {
    const px = parseFloat(size);
    if (!Number.isNaN(px)) run.fontSize = px;
  }
  const weight = style.fontWeight;
  if (weight) {
    const n = parseInt(weight, 10);
    if (!Number.isNaN(n)) run.fontWeight = n;
    else if (weight === 'bold') run.fontWeight = 700;
  }
  const styleVal = style.fontStyle;
  if (styleVal === 'italic') run.fontStyle = 'italic';
  const color = style.color;
  if (color) run.fill = color;
  const decoration = style.textDecoration;
  if (decoration?.includes('underline')) run.underline = true;
  return run;
};

const runStyleToCss = (run: TextRun, el: DesignerElement): React.CSSProperties => {
  const css: React.CSSProperties = {};
  if (run.fill && run.fill !== el.fill) css.color = run.fill;
  if (run.fontFamily && run.fontFamily !== el.fontFamily) css.fontFamily = run.fontFamily;
  if (run.fontSize && run.fontSize !== el.fontSize) css.fontSize = `${run.fontSize}px`;
  if (run.fontWeight && run.fontWeight !== el.fontWeight) css.fontWeight = run.fontWeight;
  if (run.fontStyle && run.fontStyle !== el.fontStyle) css.fontStyle = run.fontStyle;
  if (run.underline) css.textDecoration = 'underline';
  return css;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const runsToHtml = (runs: TextRun[], el: DesignerElement): string => {
  if (!runs.length) return '';
  return runs
    .map((run) => {
      const text = escapeHtml(run.text || '').replace(/\n/g, '<br>');
      const css = runStyleToCss(run, el);
      const style = Object.entries(css)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return style ? `<span style="${style}">${text}</span>` : text;
    })
    .join('');
};

const serializeNode = (
  node: Node,
  inherited: Partial<TextRun>
): TextRun[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (!text) return [];
    return [{ text, ...inherited } as TextRun];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    return [{ text: '\n', ...inherited } as TextRun];
  }

  let nextInherited = { ...inherited };
  if (tag === 'b' || tag === 'strong') {
    nextInherited.fontWeight = 700;
  } else if (tag === 'i' || tag === 'em') {
    nextInherited.fontStyle = 'italic';
  } else if (tag === 'u') {
    nextInherited.underline = true;
  } else {
    nextInherited = styleStringToRun(el.style, nextInherited);
  }

  const runs: TextRun[] = [];
  el.childNodes.forEach((child) => {
    runs.push(...serializeNode(child, nextInherited));
  });

  if ((tag === 'div' || tag === 'p') && runs.length && !runs[runs.length - 1].text.endsWith('\n')) {
    runs.push({ text: '\n', ...inherited } as TextRun);
  }

  return runs;
};

const serializeHtml = (html: string, el: DesignerElement): TextRun[] => {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const runs: TextRun[] = [];
  tmp.childNodes.forEach((child) => runs.push(...serializeNode(child, {})));
  return mergeRuns(runs, el);
};

const mergeRuns = (runs: TextRun[], el: DesignerElement): TextRun[] => {
  const normalized = runs
    .map((run) => ({
      text: run.text,
      fontFamily: run.fontFamily === el.fontFamily ? undefined : run.fontFamily,
      fontSize: run.fontSize === el.fontSize ? undefined : run.fontSize,
      fontWeight: run.fontWeight === el.fontWeight ? undefined : run.fontWeight,
      fontStyle: run.fontStyle === el.fontStyle ? undefined : run.fontStyle,
      fill: run.fill === el.fill ? undefined : run.fill,
      underline: run.underline ? true : undefined,
    }))
    .filter((run) => run.text.length > 0);

  const out: TextRun[] = [];
  for (const run of normalized) {
    const last = out[out.length - 1];
    if (
      last &&
      last.fontFamily === run.fontFamily &&
      last.fontSize === run.fontSize &&
      last.fontWeight === run.fontWeight &&
      last.fontStyle === run.fontStyle &&
      last.fill === run.fill &&
      last.underline === run.underline
    ) {
      last.text += run.text;
    } else {
      out.push({ ...run } as TextRun);
    }
  }
  return out;
};

export const TextEditingOverlay: FC<TextEditingProps> = ({
  element,
  stageRect,
  onUpdate,
  onComplete,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [html] = useState(() => {
    if (element.richText?.length) {
      return runsToHtml(element.richText, element);
    }
    return escapeHtml(element.text || '').replace(/\n/g, '<br>');
  });
  const scale = stageRect.scale || 1;

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const handleBlur = () => {
    const currentHtml = editorRef.current?.innerHTML ?? '';
    const runs = serializeHtml(currentHtml, element);
    const flat = runs.map((r) => r.text).join('');
    const hasStyle = runs.some(
      (r) =>
        r.fontFamily !== undefined ||
        r.fontSize !== undefined ||
        r.fontWeight !== undefined ||
        r.fontStyle !== undefined ||
        r.fill !== undefined ||
        r.underline
    );
    const next: Partial<DesignerElement> = { text: flat };
    if (runs.length > 1 || hasStyle) {
      next.richText = runs;
    }
    if (
      flat !== (element.text ?? '') ||
      JSON.stringify(runs) !== JSON.stringify(element.richText ?? [])
    ) {
      onUpdate(element.id, next);
    }
    onComplete();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onComplete();
    }
  };

  // Match the canvas HUD: the Stage is offset by the viewport (stageRect.x/y),
  // which is a screen-space translation applied AFTER scaling the element coords.
  const left = element.x * scale + stageRect.x + 2;
  const top = element.y * scale + stageRect.y + 2;
  const width = element.width * scale - 4;
  const minHeight = Math.max(element.height * scale - 4, 20);

  return (
    <div
      ref={editorRef}
      data-text-editor-id={element.id}
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(width, 20)}px`,
        minHeight: `${minHeight}px`,
        fontFamily: element.fontFamily || 'Arial',
        fontSize: `${(element.fontSize || 16) * scale}px`,
        fontWeight: element.fontWeight ?? 400,
        fontStyle: element.fontStyle === 'italic' ? 'italic' : 'normal',
        color: element.fill || '#000000',
        textAlign: element.align || 'left',
        lineHeight: element.lineHeight || 1.2,
        letterSpacing: `${(element.letterSpacing || 0) * scale}px`,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        zIndex: 100,
      }}
    />
  );
};
