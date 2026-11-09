import type { DesignerDoc, DesignerElement, DesignerOutput } from './designer-doc.schema';

export type BulkVariableKind = 'text' | 'image' | 'color';

export interface BulkVariable {
  name: string;
  kind: BulkVariableKind;
}

const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export const substituteBulkValue = (
  value: string,
  row: Record<string, string>
): string => value.replace(VARIABLE_PATTERN, (match, key: string) =>
  row[key] === undefined || row[key] === null ? match : String(row[key])
);

export const normalizeBulkImageSource = (value: string): string => {
  const trimmed = value.trim();
  const formula = /^=IMAGE\(\s*"((?:[^"]|"")+)"(?:\s*,[\s\S]*)?\)$/i.exec(trimmed);
  const source = formula ? formula[1].replace(/""/g, '"') : trimmed;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return source;
    const pathMatch = /^\/file\/d\/([^/]+)/.exec(url.pathname);
    const id = pathMatch?.[1] || url.searchParams.get('id');
    return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : source;
  } catch {
    return source;
  }
};

const substituteElement = (
  element: DesignerElement,
  row: Record<string, string>
): void => {
  if (typeof element.text === 'string') {
    element.text = substituteBulkValue(element.text, row);
  }
  for (const run of element.richText || []) {
    if (typeof run.text === 'string') run.text = substituteBulkValue(run.text, row);
  }
  if (typeof element.src === 'string') {
    element.src = substituteBulkValue(element.src, row);
  }
  if (typeof element.fill === 'string') {
    element.fill = substituteBulkValue(element.fill, row);
  }

  const slotName = element.slot?.name;
  if (slotName && row[slotName] !== undefined) {
    switch (element.slot!.kind) {
      case 'text':
        element.text = row[slotName];
        break;
      case 'image':
        element.src = row[slotName];
        break;
      case 'color':
        element.fill = row[slotName];
        break;
    }
  }
  if ((element.type === 'image' || element.type === 'raster') && element.src) {
    element.src = normalizeBulkImageSource(element.src);
  }
};

const substituteChildren = (
  children: DesignerElement[] | undefined,
  row: Record<string, string>
): void => {
  for (const element of children || []) {
    substituteElement(element, row);
    if (element.symbolOverrides) {
      for (const override of Object.values(element.symbolOverrides)) {
        if (override.text) override.text = substituteBulkValue(override.text, row);
        if (override.src) override.src = normalizeBulkImageSource(substituteBulkValue(override.src, row));
        if (override.fill) override.fill = substituteBulkValue(override.fill, row);
      }
    }
  }
};

export const applyBulkRow = (
  templateDoc: DesignerDoc,
  row: Record<string, string>
): DesignerDoc => {
  const doc = structuredClone(templateDoc);
  for (const output of doc.outputs || []) {
    if (!('children' in output) || doc.mode !== 'image') continue;
    const imageOutput = output as DesignerOutput;
    substituteChildren(imageOutput.children, row);
    for (const page of imageOutput.pages || []) {
      substituteChildren(page.children, row);
    }
  }
  for (const symbol of doc.symbols || []) {
    substituteChildren(symbol.children, row);
  }
  return doc;
};

export const collectBulkVariables = (doc: DesignerDoc): BulkVariable[] => {
  const variables = new Map<string, BulkVariable>();
  const collectText = (value: unknown, kind: BulkVariableKind = 'text') => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      variables.set(match[1], { name: match[1], kind });
    }
  };
  const collectElement = (element: DesignerElement) => {
    if (element.slot?.name) {
      variables.set(element.slot.name, { name: element.slot.name, kind: element.slot.kind });
    }
    collectText(element.text);
    for (const run of element.richText || []) collectText(run.text);
    collectText(element.src, 'image');
    collectText(element.fill, 'color');
  };
  for (const output of doc.outputs || []) {
    if (!('children' in output) || doc.mode !== 'image') continue;
    const imageOutput = output as DesignerOutput;
    for (const element of imageOutput.children || []) collectElement(element);
    for (const page of imageOutput.pages || []) {
      for (const element of page.children || []) collectElement(element);
    }
  }
  for (const symbol of doc.symbols || []) {
    for (const element of symbol.children || []) collectElement(element);
  }
  return [...variables.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export interface BulkAssignmentTarget {
  id: string;
  elementId: string;
  outputIndex: number;
  pageNumber: number;
  symbolId?: string;
  kind: BulkVariableKind;
  label: string;
}

const hasMustache = (value: unknown): boolean =>
  typeof value === 'string' && value.match(VARIABLE_PATTERN) !== null;

export const collectBulkAssignmentTargets = (doc: DesignerDoc): BulkAssignmentTarget[] => {
  if (doc.mode !== 'image') return [];
  const targets: BulkAssignmentTarget[] = [];
  const collectChildren = (
    children: DesignerElement[] | undefined,
    location: {
      idPrefix: string;
      labelPrefix: string;
      outputIndex: number;
      pageNumber: number;
      symbolId?: string;
    }
  ) => {
    for (const element of children || []) {
      const elementLabel = element.name || element.text?.trim().slice(0, 40) || element.id;
      const add = (kind: BulkVariableKind) => {
        targets.push({
          id: `${location.idPrefix}:${element.id}:${kind}`,
          elementId: element.id,
          outputIndex: location.outputIndex,
          pageNumber: location.pageNumber,
          symbolId: location.symbolId,
          kind,
          label: `${location.labelPrefix}: ${elementLabel}`,
        });
      };
      const canAssignText = element.type === 'text' &&
        !element.slot &&
        !hasMustache(element.text) &&
        !(element.richText || []).some((run) => hasMustache(run.text));
      if (canAssignText) add('text');
      if (
        (element.type === 'image' || element.type === 'raster') &&
        !element.slot &&
        element.src &&
        !hasMustache(element.src)
      ) {
        add('image');
      }
      if (
        ['text', 'shape', 'path', 'icon'].includes(element.type) &&
        element.slot?.kind !== 'color' &&
        (element.type === 'text' || !element.slot) &&
        !hasMustache(element.fill)
      ) {
        add('color');
      }
    }
  };
  for (const [outputIndex, output] of (doc.outputs || []).entries()) {
    if (!('children' in output)) continue;
    const imageOutput = output as DesignerOutput;
    const pages = [
      { children: imageOutput.children, pageNumber: 0 },
      ...(imageOutput.pages || []).map((page, index) => ({
        children: page.children,
        pageNumber: index + 1,
      })),
    ];
    for (const page of pages) {
      collectChildren(page.children, {
        idPrefix: `${outputIndex}:${page.pageNumber}`,
        labelPrefix: `${imageOutput.name} / Page ${page.pageNumber + 1}`,
        outputIndex,
        pageNumber: page.pageNumber,
      });
    }
  }
  for (const symbol of doc.symbols || []) {
    collectChildren(symbol.children, {
      idPrefix: `symbol:${symbol.id}`,
      labelPrefix: `Symbol ${symbol.name}`,
      outputIndex: -1,
      pageNumber: 0,
      symbolId: symbol.id,
    });
  }
  return targets;
};

export const applyBulkAssignments = (
  templateDoc: DesignerDoc,
  assignments: Record<string, string>
): DesignerDoc => {
  const targets = new Map(collectBulkAssignmentTargets(templateDoc).map((target) => [target.id, target]));
  const existing = new Map(collectBulkVariables(templateDoc).map((variable) => [variable.name, variable]));
  const selected = Object.entries(assignments).filter((entry): entry is [string, string] => {
    const [targetId, column] = entry;
    return !!targets.get(targetId) && !!column.trim();
  });
  const assignedKinds = new Map<string, BulkVariableKind>();
  for (const [targetId, column] of selected) {
    const target = targets.get(targetId)!;
    const variable = existing.get(column);
    if (variable && variable.kind !== target.kind) {
      throw new Error(`Column "${column}" is already assigned to ${variable.kind} data.`);
    }
    const assignedKind = assignedKinds.get(column);
    if (assignedKind && assignedKind !== target.kind) {
      throw new Error(`Column "${column}" cannot be assigned to both ${assignedKind} and ${target.kind} data.`);
    }
    assignedKinds.set(column, target.kind);
  }

  const doc = structuredClone(templateDoc);
  for (const [targetId, column] of selected) {
    const target = targets.get(targetId)!;
    const output = target.symbolId ? undefined : doc.outputs[target.outputIndex] as DesignerOutput;
    const children = target.symbolId
      ? doc.symbols?.find((symbol) => symbol.id === target.symbolId)?.children
      : target.pageNumber === 0
        ? output?.children
        : output?.pages?.[target.pageNumber - 1]?.children;
    const element = children?.find((item) => item.id === target.elementId);
    if (!element) continue;
    if (target.kind === 'color' && element.type === 'text') {
      element.fill = `{{${column}}}`;
    } else {
      element.slot = { name: column, kind: target.kind };
    }
  }
  return doc;
};
