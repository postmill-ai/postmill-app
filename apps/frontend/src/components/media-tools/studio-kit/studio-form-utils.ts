import type {
  FileFieldValue,
  StudioFieldValue,
  StudioGenerateBody,
  StudioTab,
} from './types';

// Field-value helpers shared by the full-page StudioShell and the embeddable
// CompactStudio — one implementation so the two never drift on what gets
// seeded or submitted.

export function defaultsFor(tab: StudioTab): Record<string, StudioFieldValue> {
  const out: Record<string, StudioFieldValue> = {};
  for (const f of tab.fields) {
    if (f.type === 'select') {
      if (f.default !== undefined) out[f.name] = f.default;
      // A plain <select> visually shows its first option even when nothing is
      // picked — seed it so the displayed value is actually submitted. Dynamic
      // model comboboxes (source:'models') render an empty search box, so skip.
      else if (f.source !== 'models' && f.options?.length) out[f.name] = f.options[0].value;
    } else if (f.type === 'number') {
      if (f.default !== undefined) out[f.name] = f.default;
      // A range slider always shows a thumb (min when unset) — seed min so it's
      // submitted; a plain number input renders empty, so only seed when ranged.
      else if (f.min !== undefined && f.max !== undefined) out[f.name] = f.min;
    } else if (f.type === 'toggle' && f.default !== undefined) {
      out[f.name] = f.default;
    }
  }
  return out;
}

export function isFilled(value: StudioFieldValue): boolean {
  if (value === undefined || value === '') return false;
  if (typeof value === 'object') return !!(value.fileId || value.url);
  return true;
}

export function validateStudioValues(
  provider: string,
  tab: StudioTab,
  values: Record<string, StudioFieldValue>,
): string | null {
  if (provider !== 'elevenlabs' || tab.operation !== 'video') return null;
  const has = (name: string) => isFilled(values[name]);
  const hasFrames = has('start_frame') || has('end_frame');
  const referenceIndexes = [1, 2, 3].filter((index) => has(`reference_image_${index}`));
  if (has('end_frame') && !has('start_frame')) return 'An end frame requires a start frame.';
  if (referenceIndexes.length > 0 && hasFrames) {
    return 'Subject/style references cannot be combined with start or end frames.';
  }
  if (referenceIndexes.length > 0 && Number(values.duration_secs) !== 8) {
    return 'Subject/style reference videos must use an 8-second duration.';
  }
  for (const index of referenceIndexes) {
    const role = values[`reference_image_${index}_role`] ?? 'subject';
    if (role !== 'subject' && role !== 'style') return 'Reference roles must be subject or style.';
  }
  return null;
}

export function buildBody(tab: StudioTab, values: Record<string, StudioFieldValue>): StudioGenerateBody {
  const input: Record<string, string | number | boolean> = {};
  const mediaInputs: Record<string, string> = {};
  for (const f of tab.fields) {
    const v = values[f.name];
    if (f.type === 'media') {
      const fv = v as FileFieldValue | undefined;
      if (fv?.fileId) mediaInputs[f.name] = fv.fileId;
      else if (fv?.url) input[f.name] = fv.url;
    } else if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) {
      input[f.name] = v as string | number | boolean;
    }
  }
  const model = tab.model || (typeof values['model'] === 'string' ? (values['model'] as string) : undefined);
  return {
    operation: tab.operation,
    model,
    input,
    mediaInputs: Object.keys(mediaInputs).length ? mediaInputs : undefined,
  };
}
