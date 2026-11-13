import { describe, expect, it, vi } from 'vitest';
import { createDesignerStore } from './designer.store';
import type { DesignAutosave } from './designer-autosave';
import { manualSaveToastKind, runManualSave } from './manual-save';

const autosaveStub = (overrides: Partial<DesignAutosave> = {}): DesignAutosave => ({
  save: vi.fn(),
  saveNow: vi.fn().mockResolvedValue('persisted'),
  ensureCreated: vi.fn().mockResolvedValue('design-new'),
  createInFlight: vi.fn().mockReturnValue(null),
  ...overrides,
});

describe('manual Save result handling', () => {
  it.each([
    ['persisted', 'success'],
    ['skipped', 'neutral'],
    ['failed', 'warning'],
  ] as const)('maps %s to a %s toast', (result, expected) => {
    expect(manualSaveToastKind(result)).toBe(expected);
  });

  it('does not report saved when create finishes without an id in this design session', async () => {
    const store = createDesignerStore();
    const designAutosave = autosaveStub();

    await expect(runManualSave(store, designAutosave)).resolves.toBe('failed');
    expect(designAutosave.ensureCreated).toHaveBeenCalledTimes(1);
    expect(designAutosave.saveNow).not.toHaveBeenCalled();
  });

  it('returns the actual dirty-write result and accepts an already-clean design', async () => {
    const store = createDesignerStore();
    store.getState().setDesignId('design-existing');
    store.getState().setDoc(store.getState().doc);
    const dirtyAutosave = autosaveStub({ saveNow: vi.fn().mockResolvedValue('skipped') });

    await expect(runManualSave(store, dirtyAutosave)).resolves.toBe('skipped');
    expect(dirtyAutosave.saveNow).toHaveBeenCalledWith(store.getState().doc);

    store.getState().markSaved();
    const cleanAutosave = autosaveStub();
    await expect(runManualSave(store, cleanAutosave)).resolves.toBe('persisted');
    expect(cleanAutosave.saveNow).not.toHaveBeenCalled();
  });
});
