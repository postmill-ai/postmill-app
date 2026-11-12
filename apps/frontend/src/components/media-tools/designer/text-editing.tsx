'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import type { DesignerElement, DesignerOutput, TextRun, VideoOutput } from './designer.store';
import type { SymbolDefinition } from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import {
  MAX_COLOR_LEN,
  MAX_FONT_FAMILY_LEN,
  MAX_FONT_SIZE,
  MAX_RICH_TEXT_RUNS,
  MAX_TEXT_LEN,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { resolveTextEditTarget } from './symbol-edit';
import { fittedFontSize, growBoxFor } from './measure-text';
import type { MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';

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

const primaryCssFontFamily = (value: string): string => {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      return value.slice(0, i).trim().replace(/^["']|["']$/g, '');
    }
  }
  return value.trim().replace(/^["']|["']$/g, '');
};

const normalizeRunFontFamily = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const family = primaryCssFontFamily(value);
  return family && family !== 'inherit' && family.length <= MAX_FONT_FAMILY_LEN
    ? family
    : undefined;
};

const capTextRuns = (
  runs: TextRun[]
): { runs: TextRun[]; truncated: boolean; coalesced: boolean } => {
  const bounded = runs.slice(0, MAX_RICH_TEXT_RUNS);
  const coalesced = runs.length > MAX_RICH_TEXT_RUNS;
  if (coalesced) {
    const last = bounded[bounded.length - 1];
    bounded[bounded.length - 1] = {
      ...last,
      text: runs.slice(MAX_RICH_TEXT_RUNS - 1).map((run) => run.text).join(''),
    };
  }

  let remaining = MAX_TEXT_LEN;
  let truncated = false;
  const capped: TextRun[] = [];
  for (const run of bounded) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const text = run.text.slice(0, remaining);
    if (text.length < run.text.length) truncated = true;
    if (text) capped.push({ ...run, text });
    remaining -= text.length;
  }
  return { runs: capped, truncated, coalesced };
};

export const styleStringToRun = (
  style: CSSStyleDeclaration | undefined,
  base: Partial<TextRun>
): Partial<TextRun> => {
  if (!style) return base;
  const run: Partial<TextRun> = { ...base };
  const family = normalizeRunFontFamily(style.fontFamily);
  if (family) run.fontFamily = family;
  const size = style.fontSize;
  if (size) {
    const px = size.trim().endsWith('px') ? Number.parseFloat(size) : Number.NaN;
    if (Number.isFinite(px) && px >= 1 && px <= MAX_FONT_SIZE) run.fontSize = px;
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
  if (color && color.length <= MAX_COLOR_LEN) run.fill = color;
  const decoration = style.textDecoration;
  if (decoration?.includes('underline')) run.underline = true;
  if (decoration?.includes('line-through')) run.lineThrough = true;
  return run;
};

const runStyleToCss = (run: TextRun, el: DesignerElement): React.CSSProperties => {
  const css: React.CSSProperties = {};
  if (run.fill && run.fill !== el.fill) css.color = run.fill;
  if (run.fontFamily && run.fontFamily !== el.fontFamily) css.fontFamily = run.fontFamily;
  if (run.fontSize && run.fontSize !== el.fontSize) css.fontSize = `${run.fontSize}px`;
  if (run.fontWeight && run.fontWeight !== el.fontWeight) css.fontWeight = run.fontWeight;
  if (run.fontStyle && run.fontStyle !== el.fontStyle) css.fontStyle = run.fontStyle;
  const decoration = [
    run.underline ? 'underline' : '',
    run.lineThrough ? 'line-through' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (decoration) css.textDecoration = decoration;
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
  } else if (tag === 's' || tag === 'strike' || tag === 'del') {
    nextInherited.lineThrough = true;
  } else {
    nextInherited = styleStringToRun(el.style, nextInherited);
  }
  if (tag === 'font') {
    const color = el.getAttribute('color');
    if (color && color.length <= MAX_COLOR_LEN) nextInherited.fill = color;
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
      lineThrough: run.lineThrough ? true : undefined,
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
      last.underline === run.underline &&
      last.lineThrough === run.lineThrough
    ) {
      last.text += run.text;
    } else {
      out.push({ ...run } as TextRun);
    }
  }
  return out;
};

export const buildTextEditCommit = (
  runs: TextRun[],
  element: DesignerElement,
  measure?: MeasureText
): Partial<DesignerElement> => {
  const flat = runs.map((r) => r.text).join('');
  const hasStyle = runs.some(
    (r) =>
      r.fontFamily !== undefined ||
      r.fontSize !== undefined ||
      r.fontWeight !== undefined ||
      r.fontStyle !== undefined ||
      r.fill !== undefined ||
      r.underline ||
      r.lineThrough
  );
  // Always write richText: when an edit collapses the text to a single
  // base-styled run (e.g. the one bold word was deleted), the runs MUST be
  // cleared — the canvas prefers richText over text, so leaving the old runs
  // in place keeps rendering the deleted words.
  const commit = {
    text: flat,
    richText: runs.length > 1 || hasStyle ? runs : undefined,
  };
  const next = { ...element, ...commit };
  return { ...commit, ...growBoxFor(next, next.fontSize || 16, measure) };
};

/**
 * True while the target of an in-progress text edit still exists in the
 * document. An edit target can vanish MID-EDIT — an output switch, an undo, a
 * collab doc replace — and when it does the overlay unmounts without a blur,
 * so the edit was lost AND `editingTextId` leaked: the canvas keyboard handler
 * short-circuits on it and the Konva text node stays hidden, leaving an
 * unresponsive, invisible text box. The canvas clears the id whenever this
 * flips false.
 */
export const textEditTargetExists = (
  output: DesignerOutput | VideoOutput | undefined,
  symbols: SymbolDefinition[] | undefined,
  id: string,
  isVideo: boolean
): boolean => {
  if (isVideo) {
    return !!(output as VideoOutput | undefined)?.tracks?.some((track) =>
      track.clips.some((c) => c.id === id)
    );
  }
  return !!resolveTextEditTarget(output as DesignerOutput | undefined, symbols, id);
};

/**
 * Watches the resolved edit target and calls `onClear` the moment it stops
 * resolving — see `textEditTargetExists` for the deadlock this prevents.
 */
export const useTextEditTargetGuard = (args: {
  editingTextId: string | null;
  output: DesignerOutput | VideoOutput | undefined;
  symbols?: SymbolDefinition[];
  isVideo: boolean;
  onClear: () => void;
}) => {
  const { editingTextId, output, symbols, isVideo, onClear } = args;
  useEffect(() => {
    if (!editingTextId) return;
    if (!textEditTargetExists(output, symbols, editingTextId, isVideo)) onClear();
  }, [editingTextId, output, symbols, isVideo, onClear]);
};

export const TextEditingOverlay: FC<TextEditingProps> = ({
  element,
  stageRect,
  onUpdate,
  onComplete,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Our own handle on the editor node: React detaches `editorRef` BEFORE the
  // passive unmount cleanup runs, but the DOM object outlives removal, so the
  // unmount commit can still read the final innerHTML from this one.
  const editorNodeRef = useRef<HTMLDivElement | null>(null);
  const [html] = useState(() => {
    if (element.richText?.length) {
      return runsToHtml(element.richText, element);
    }
    return escapeHtml(element.text || '').replace(/\n/g, '<br>');
  });
  const scale = stageRect.scale || 1;
  const toaster = useToaster();
  const t = useT();

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    editorNodeRef.current = el;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  /**
   * An overlay settles exactly once. `settled` guards the three exits (blur
   * commit, Escape discard, unmount) against each other: a blur commits and
   * unmounts the overlay, and the unmount must not commit the same edit a
   * second time — nor commit at all after an Escape discard.
   */
  const settledRef = useRef(false);

  const commit = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    const currentHtml =
      editorRef.current?.innerHTML ?? editorNodeRef.current?.innerHTML ?? '';
    const serializedRuns = serializeHtml(currentHtml, element);
    const { runs, truncated, coalesced } = capTextRuns(serializedRuns);
    if (truncated) {
      toaster.show(
        t('designer_text_paste_limit', 'Pasted text was shortened to the 20,000-character limit.'),
        'warning'
      );
    }
    if (coalesced) {
      toaster.show(
        t('designer_run_paste_limit', 'Pasted rich text was simplified to the 1,000-run limit.'),
        'warning'
      );
    }
    const next = buildTextEditCommit(runs, element);
    if (
      next.text !== (element.text ?? '') ||
      JSON.stringify(next.richText ?? []) !== JSON.stringify(element.richText ?? [])
    ) {
      onUpdate(element.id, next);
    }
    onComplete();
  }, [element, onUpdate, onComplete, toaster, t]);

  // Read through a ref so the unmount cleanup (mounted once) always runs the
  // CURRENT commit closure rather than the first render's.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  useEffect(
    () => () => {
      // Unmount without a blur means the edit target vanished mid-edit
      // (output switch, undo, a collab doc replace). Commit through the same
      // path rather than dropping the typed text; the canvas's onUpdate
      // re-resolves the target, so a genuinely gone element is a no-op and
      // only the state cleanup matters.
      commitRef.current();
    },
    []
  );

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if ((e.relatedTarget as HTMLElement | null)?.closest('[data-text-editing-toolbar]')) return;
    commit();
  };

  const applyTextColor = (color: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const liveRange = selection?.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : null;
    const range = liveRange ?? savedRangeRef.current;
    editor.focus();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range && !range.collapsed) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, color);
    } else {
      editor.style.color = color;
      onUpdate(element.id, { fill: color });
    }
    savedRangeRef.current = range;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Discard: settle WITHOUT committing, but always complete — a settled
      // overlay that stayed mounted would keep the Konva text hidden.
      settledRef.current = true;
      onComplete();
      return;
    }
    // Inline style toggles, straight on the contentEditable DOM: the blur
    // commit serialises the <b>/<i>/<u>/<strike> the browser wraps the
    // selection in, so the runs pick the style up without leaving the editor.
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      const command =
        key === 'b'
          ? 'bold'
          : key === 'i'
          ? 'italic'
          : key === 'u'
          ? 'underline'
          : key === 'x' && e.shiftKey
          ? 'strikeThrough'
          : null;
      if (command) {
        e.preventDefault();
        document.execCommand(command);
      }
    }
  };

  // Match the canvas HUD: the Stage is offset by the viewport (stageRect.x/y),
  // which is a screen-space translation applied AFTER scaling the element coords.
  // No inset: the canvas paints the text box edge-to-edge, so an offset or a
  // narrower wrap here is what made the glyphs sit off the canvas rendering.
  const left = element.x * scale + stageRect.x;
  const top = element.y * scale + stageRect.y;
  const width = element.width * scale;
  const minHeight = Math.max(element.height * scale, 20);

  return (
    <>
      <div
        data-text-editing-toolbar
        className="absolute flex items-center gap-1 rounded-md border border-studioBorder bg-newBgColorInner p-1 shadow-lg"
        style={{ left: `${left}px`, top: `${Math.max(4, top - 36)}px`, zIndex: 101 }}
      >
        <input
          type="color"
          aria-label={t('designer_text_color', 'Text color')}
          title={t('designer_text_color_selection', 'Color selected text')}
          onMouseDown={(e) => {
            const selection = window.getSelection();
            savedRangeRef.current = selection?.rangeCount
              ? selection.getRangeAt(0).cloneRange()
              : null;
            e.preventDefault();
            e.stopPropagation();
          }}
          defaultValue={/^#[0-9a-f]{6}$/i.test(element.fill || '') ? element.fill : '#000000'}
          onChange={(e) => applyTextColor(e.currentTarget.value)}
          className="h-7 w-8 cursor-pointer rounded-sm border border-studioBorder bg-transparent p-0.5"
        />
      </div>
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
          // Condensed the same way the canvas paints it, from the same origin the
          // box is positioned at — otherwise the glyphs jump on blur.
          transform: element.textScaleX ? `scaleX(${element.textScaleX})` : undefined,
          transformOrigin: 'left top',
          width: `${Math.max(width, 20) / (element.textScaleX || 1)}px`,
          minHeight: `${minHeight}px`,
          fontFamily: element.fontFamily || 'Arial',
          // The canvas paints flat text at the FITTED size (shrink-to-fit), so the
          // overlay must match it or the string reflows the moment editing ends.
          fontSize: `${fittedFontSize(element) * scale}px`,
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
    </>
  );
};
