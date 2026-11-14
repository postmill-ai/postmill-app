import type { DesignerDoc } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

export const TEXT_STROKE_DOC_VERSION = 14;

const carriesTextStroke = (value: unknown, seen = new Set<object>()): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => carriesTextStroke(entry, seen));
  if (Object.prototype.hasOwnProperty.call(value, 'textStroke')) return true;
  return Object.values(value).some((entry) => carriesTextStroke(entry, seen));
};

export const withTextStrokeVersion = <T extends DesignerDoc>(doc: T, update?: unknown): T => {
  if (
    doc.mode !== 'video' ||
    doc.version >= TEXT_STROKE_DOC_VERSION ||
    !carriesTextStroke(update ?? doc.outputs)
  ) {
    return doc;
  }
  return { ...doc, version: TEXT_STROKE_DOC_VERSION };
};

export const assertSupportedDesignerDocVersion = (raw: unknown): void => {
  let doc = raw;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (!doc || typeof doc !== 'object') return;
  const version = (doc as { version?: unknown }).version;
  if (typeof version === 'number' && version > DESIGNER_DOC_VERSION) {
    throw new Error(
      `DesignerDoc v${version} is newer than this deployment supports (v${DESIGNER_DOC_VERSION}). Upgrade Postmill before importing this archive.`
    );
  }
};
