import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { pageBackground, pageChildren, pageName } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { fitTextToBox, measureLineWidth } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import { layoutVideoText } from '@postmill-ai/nestjs-libraries/media/designer-doc/video-text-layout';
import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoClip,
  VideoOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { getContrastRatio } from './contrast';
import { measureForElement } from './measure-text';

export type DesignerPreflightFinding = {
  rule: 'low-contrast' | 'safe-zone' | 'missing-media' | 'text-overflow';
  key: string;
  vars: Record<string, string | number>;
  outputIndex: number;
  pageNumber: number;
  elementId?: string;
  clip?: { trackId: string; clipId: string };
};

export type DesignerPreflightSelection = {
  outputIndex: number;
  pages?: number[];
};

export type DesignerPreflightResult = {
  findings: DesignerPreflightFinding[];
  unassessed: {
    contrast: number;
    text: number;
    geometry: number;
  };
};

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const targetName = (output: DesignerOutput | VideoOutput, pageNumber: number) =>
  'children' in output ? `${output.name} / ${pageName(output, pageNumber)}` : output.name;

export const analyzeDesignerPreflight = (
  doc: DesignerDoc,
  selection: DesignerPreflightSelection[],
): DesignerPreflightResult => {
  const findings: DesignerPreflightFinding[] = [];
  const unassessed = { contrast: 0, text: 0, geometry: 0 };
  const selected = new Map(selection.map((item) => [item.outputIndex, item.pages]));

  const add = (
    rule: DesignerPreflightFinding['rule'],
    key: string,
    vars: DesignerPreflightFinding['vars'],
    outputIndex: number,
    pageNumber: number,
    elementId?: string,
    clip?: DesignerPreflightFinding['clip'],
  ) => findings.push({ rule, key, vars, outputIndex, pageNumber, elementId, clip });

  const safeZone = (output: DesignerOutput | VideoOutput, box: Box, rotation: number | undefined, outputIndex: number, pageNumber: number, elementId?: string, clip?: DesignerPreflightFinding['clip']) => {
    if (rotation) {
      unassessed.geometry++;
      return;
    }
    const preset = CHANNEL_PRESETS.find((item) => item.id === output.formatId);
    const zones = preset?.safeZones?.length
      ? preset.safeZones
      : [{ label: 'Title Safe (5%)', x: output.width * 0.05, y: output.height * 0.05, width: output.width * 0.9, height: output.height * 0.9 }];
    const target = targetName(output, pageNumber);
    if (preset?.safeZones?.length) {
      for (const zone of preset.safeZones) {
        if (intersects(box, zone)) {
          add('safe-zone', 'designer_preflight_safe_zone', { zone: zone.label, target }, outputIndex, pageNumber, elementId, clip);
        }
      }
      return;
    }
    const safe = zones[0];
    const unsafe = box.x < safe.x || box.y < safe.y || box.x + box.width > safe.x + safe.width || box.y + box.height > safe.y + safe.height;
    if (unsafe) add('safe-zone', 'designer_preflight_safe_zone', { zone: safe.label, target }, outputIndex, pageNumber, elementId, clip);
  };

  const backgroundColor = (output: DesignerOutput | VideoOutput, pageNumber: number): string | null => {
    const bg = 'children' in output ? pageBackground(output, pageNumber) : output.bg;
    if (bg?.texture) return null;
    if (bg) return bg.type === 'color' ? bg.color || null : null;
    return 'children' in output ? output.background || '#ffffff' : '#000000';
  };

  const contrast = (
    output: DesignerOutput | VideoOutput,
    pageNumber: number,
    outputIndex: number,
    target: { id: string; fill?: string; fillGradient?: unknown },
    clip?: DesignerPreflightFinding['clip'],
  ) => {
    if (target.fillGradient) {
      unassessed.contrast++;
      return;
    }
    const background = backgroundColor(output, pageNumber);
    const foreground = target.fill || '#000000';
    const ratio = background && foreground ? getContrastRatio(foreground, background) : null;
    if (ratio === null) {
      unassessed.contrast++;
      return;
    }
    if (ratio < 4.5) {
      add('low-contrast', 'designer_preflight_low_contrast', {
        ratio: ratio.toFixed(1), target: targetName(output, pageNumber),
      }, outputIndex, pageNumber, target.id, clip);
    }
  };

  const staticTextOverflow = (element: DesignerElement): boolean | null => {
    if (element.richText?.length || element.textPath || (element.curve || 0) !== 0 || !element.text?.trim()) return null;
    const measure = measureForElement(element);
    if (!measure) return null;
    const fontSize = element.fontSize || 16;
    const fit = fitTextToBox({
      text: element.text,
      width: element.width,
      height: element.height,
      fontSize,
      lineHeight: element.lineHeight,
      letterSpacing: element.letterSpacing,
      scaleX: element.textScaleX,
      textTransform: element.textTransform,
      paragraphSpacing: element.paragraphSpacing,
      firstLineIndent: element.firstLineIndent,
    }, measure);
    const height = fit.lines.reduce((sum, _line, index) => sum + fit.lineHeight + fit.lineGaps[index], 0);
    if (height > element.height + 0.5) return true;
    return fit.lines.some((line) =>
      measureLineWidth(line, fit.fontSize, element.letterSpacing || 0, measure, element.textScaleX || 1) > element.width + 0.5);
  };

  const videoTextOverflow = (clip: VideoClip): boolean | null => {
    if (!clip.text?.trim()) return null;
    const measure = measureForElement(clip as unknown as DesignerElement);
    if (!measure) return null;
    const fontSize = clip.fontSize || 16;
    const width = clip.width || 1;
    const height = clip.height || 1;
    const align = clip.align || 'left';
    const all = layoutVideoText(clip.text, width, Number.MAX_SAFE_INTEGER, fontSize, (line) => measure(line, fontSize), align);
    const visible = layoutVideoText(clip.text, width, height, fontSize, (line) => measure(line, fontSize), align);
    return all.length > visible.length || all[visible.length - 1]?.text !== visible[visible.length - 1]?.text;
  };

  doc.outputs.forEach((output, outputIndex) => {
    const pages = selected.get(outputIndex);
    if (!pages) return;

    if ('children' in output) {
      for (const pageNumber of pages) {
        const children = pageChildren(output, pageNumber);
        const bg = pageBackground(output, pageNumber);
        if (bg?.type === 'image' && !bg.src && !bg.fileId) {
          add('missing-media', 'designer_preflight_missing_media', { target: targetName(output, pageNumber) }, outputIndex, pageNumber);
        }
        children.forEach((element, index) => {
          if (element.hidden || (element.opacity ?? 1) <= 0) return;
          if (element.type === 'image' && !element.src && !element.fileId) {
            add('missing-media', 'designer_preflight_missing_media', { target: targetName(output, pageNumber) }, outputIndex, pageNumber, element.id);
          }
          if (element.type !== 'text') return;
          if (!element.text?.trim() && !element.richText?.length) return;
          safeZone(output, element, element.rotation, outputIndex, pageNumber, element.id);
          const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
          const backdrop = children.slice(0, index).reverse().find((candidate) =>
            candidate.type !== 'text' && !candidate.hidden && (candidate.opacity ?? 1) > 0 &&
            center.x >= candidate.x && center.x <= candidate.x + candidate.width &&
            center.y >= candidate.y && center.y <= candidate.y + candidate.height);
          if (backdrop || element.richText?.length) unassessed.contrast++;
          else contrast(output, pageNumber, outputIndex, {
            id: element.id,
            fill: element.fill,
            fillGradient: element.fillGradient,
          });
          const overflow = staticTextOverflow(element);
          if (overflow === null) unassessed.text++;
          else if (overflow) add('text-overflow', 'designer_preflight_text_overflow', { target: targetName(output, pageNumber) }, outputIndex, pageNumber, element.id);
        });
      }
      return;
    }

    if (output.bg?.type === 'image' && !output.bg.src && !output.bg.fileId) {
      add('missing-media', 'designer_preflight_missing_media', { target: output.name }, outputIndex, 0);
    }
    const visualMedia = output.tracks.some((track) =>
      !track.hidden && ['video', 'image', 'sticker', 'raster'].includes(track.type) &&
      track.clips.some((clip) => (clip.opacity ?? 1) > 0));
    output.tracks.forEach((track) => {
      if (track.hidden) return;
      track.clips.forEach((clip) => {
        if ((clip.opacity ?? 1) <= 0) return;
        if (['video', 'image', 'sticker', 'raster'].includes(track.type) && !clip.src && !clip.fileId && !clip.frames?.length) {
          add('missing-media', 'designer_preflight_missing_media', { target: output.name }, outputIndex, 0, undefined, {
            trackId: track.id, clipId: clip.id,
          });
        }
        if (!['text', 'caption'].includes(track.type) || !clip.text?.trim()) return;
        const box = { x: clip.x || 0, y: clip.y || 0, width: clip.width || 1, height: clip.height || 1 };
        const clipTarget = { trackId: track.id, clipId: clip.id };
        safeZone(output, box, clip.rotation, outputIndex, 0, undefined, clipTarget);
        if (visualMedia) unassessed.contrast++;
        else contrast(output, 0, outputIndex, { id: clip.id, fill: clip.fill }, clipTarget);
        const overflow = videoTextOverflow(clip);
        if (overflow === null) unassessed.text++;
        else if (overflow) add('text-overflow', 'designer_preflight_text_overflow', { target: output.name }, outputIndex, 0, undefined, clipTarget);
      });
    });
  });

  return { findings, unassessed };
};
