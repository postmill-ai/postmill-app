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
