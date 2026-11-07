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
  if (!slotName || row[slotName] === undefined) return;
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
        if (override.src) override.src = substituteBulkValue(override.src, row);
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
  kind: BulkVariableKind;
  label: string;
}

const hasMustache = (value: unknown): boolean =>
  typeof value === 'string' && value.match(VARIABLE_PATTERN) !== null;

export const collectBulkAssignmentTargets = (doc: DesignerDoc): BulkAssignmentTarget[] => {
  if (doc.mode !== 'image') return [];
  const targets: BulkAssignmentTarget[] = [];
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
      for (const element of page.children || []) {
        if (element.slot) continue;
        const elementLabel = element.name || element.text?.trim().slice(0, 40) || element.id;
        const add = (kind: BulkVariableKind) => {
          targets.push({
            id: `${outputIndex}:${page.pageNumber}:${element.id}:${kind}`,
            elementId: element.id,
            outputIndex,
            pageNumber: page.pageNumber,
            kind,
            label: `${imageOutput.name} / Page ${page.pageNumber + 1}: ${elementLabel}`,
          });
        };
        const canAssignText = element.type === 'text' &&
          !hasMustache(element.text) &&
          !(element.richText || []).some((run) => hasMustache(run.text));
        if (canAssignText) add('text');
        if (
          (element.type === 'image' || element.type === 'raster') &&
          element.src &&
          !hasMustache(element.src)
        ) {
          add('image');
        }
        if (['text', 'shape', 'path', 'icon'].includes(element.type) && !hasMustache(element.fill)) {
          add('color');
        }
      }
    }
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
    const output = doc.outputs[target.outputIndex] as DesignerOutput;
    const children = target.pageNumber === 0
      ? output.children
      : output.pages?.[target.pageNumber - 1]?.children;
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
