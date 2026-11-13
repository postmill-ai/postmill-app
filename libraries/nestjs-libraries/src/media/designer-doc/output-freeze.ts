import type {
  DesignerDoc,
  DesignerOutput,
  VideoOutput,
} from './designer-doc.schema';

export type FreezableOutput = DesignerOutput | VideoOutput;

export const isOutputFrozen = (output: FreezableOutput | undefined): boolean =>
  output?.frozen === true;

export const structurallyEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => structurallyEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined);
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bRecord, key) &&
      structurallyEqual(aRecord[key], bRecord[key])
  );
};

const withoutFrozen = (output: FreezableOutput) => {
  const { frozen: _frozen, ...content } = output;
  return content;
};

const outputElements = (output: FreezableOutput) =>
  'children' in output
    ? [output.children, ...(output.pages ?? []).map((page) => page.children)]
    : [];

const referencedSymbolIds = (
  doc: Pick<DesignerDoc, 'outputs' | 'symbols'>,
  output: FreezableOutput
): Set<string> => {
  const definitions = new Map((doc.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const pending = outputElements(output).flatMap((children) =>
    children.filter((element) => element.type === 'symbol' && element.symbolId)
      .map((element) => element.symbolId as string)
  );
  const ids = new Set<string>();
  while (pending.length) {
    const id = pending.pop() as string;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const element of definitions.get(id)?.children ?? []) {
      if (element.type === 'symbol' && element.symbolId) pending.push(element.symbolId);
    }
  }
  return ids;
};

/**
 * A frozen output may change only its own `frozen` flag. Matching by id also
 * rejects deleting or replacing a frozen output during a whole-document op.
 * Referenced symbol definitions are part of the output's rendered content.
 */
export const hasFrozenOutputMutation = (
  before: Pick<DesignerDoc, 'outputs' | 'symbols'>,
  after: Pick<DesignerDoc, 'outputs' | 'symbols'>
): boolean => {
  if (before === after || !before.outputs.some(isOutputFrozen)) return false;
  const afterById = new Map(after.outputs.map((output) => [output.id, output]));
  const afterSymbols = new Map((after.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const beforeSymbols = new Map((before.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  return before.outputs.some((output) => {
    if (!isOutputFrozen(output)) return false;
    const next = afterById.get(output.id);
    if (!next) return true;
    if (next !== output && !structurallyEqual(withoutFrozen(output), withoutFrozen(next))) {
      return true;
    }
    return [...referencedSymbolIds(before, output)].some(
      (id) => !structurallyEqual(beforeSymbols.get(id), afterSymbols.get(id))
    );
  });
};

export const withOutputFrozen = <T extends FreezableOutput>(
  output: T,
  frozen: boolean
): T => ({ ...output, frozen: frozen ? true : undefined });
