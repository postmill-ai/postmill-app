import { describe, expect, it } from 'vitest';
import { hasFrozenOutputMutation, structurallyEqual } from './output-freeze';
import type { DesignerOutput, SymbolDefinition } from './designer-doc.schema';

const output = (): DesignerOutput => ({
  id: 'out', formatId: 'custom', name: 'Frozen', width: 1080, height: 1080,
  background: '#ffffff', frozen: true,
  children: [{
    id: 'text', type: 'text' as const, text: 'Hello', x: 0, y: 0, width: 100, height: 50,
    rotation: 0, opacity: 1, locked: false, hidden: false,
  }],
});

describe('structurallyEqual', () => {
  it('ignores object key order and undefined-valued keys, but not array order', () => {
    expect(structurallyEqual(
      { a: 1, nested: { b: [1, 2], c: undefined } },
      { nested: { b: [1, 2] }, a: 1 }
    )).toBe(true);
    expect(structurallyEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe('hasFrozenOutputMutation', () => {
  it('accepts the same output reference and a key-reordered clone', () => {
    const before = output();
    expect(hasFrozenOutputMutation({ outputs: [before] }, { outputs: [before] })).toBe(false);
    const reordered = Object.fromEntries(Object.entries(before).reverse()) as DesignerOutput;
    expect(hasFrozenOutputMutation({ outputs: [before] }, { outputs: [reordered] })).toBe(false);
    expect(hasFrozenOutputMutation(
      { outputs: [before] },
      { outputs: [{ ...before, name: 'Changed' }] }
    )).toBe(true);
  });

  it('treats referenced symbol definitions as frozen rendered content', () => {
    const frozen: DesignerOutput = {
      ...output(),
      children: [{
        id: 'instance', type: 'symbol' as const, symbolId: 'sym', x: 0, y: 0, width: 100, height: 50,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    };
    const symbols: SymbolDefinition[] = [{
      id: 'sym', name: 'Master', width: 100, height: 50,
      children: [{
        id: 'master-text', type: 'text' as const, text: 'Hello', x: 0, y: 0, width: 100, height: 50,
        rotation: 0, opacity: 1, locked: false, hidden: false,
      }],
    }];
    const before = { outputs: [frozen], symbols };
    expect(hasFrozenOutputMutation(before, structuredClone(before))).toBe(false);

    const changed = structuredClone(before);
    changed.symbols[0].children[0].text = 'Changed';
    expect(hasFrozenOutputMutation(before, changed)).toBe(true);
  });
});
