import {
  TOOL_GROUPS,
  DEFAULT_TOOL_ID,
  allTools,
  getTool,
  groupOfTool,
  resolveToolShortcut,
} from './tools';

describe('tool registry', () => {
  it('exposes the 16 Photoshop groups', () => {
    expect(TOOL_GROUPS).toHaveLength(16);
  });

  it('has unique tool ids and unique group ids', () => {
    const toolIds = allTools().map((t) => t.id);
    expect(new Set(toolIds).size).toBe(toolIds.length);
    const groupIds = TOOL_GROUPS.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it('gives every group a unique single-letter shortcut', () => {
    const keys = TOOL_GROUPS.map((g) => g.shortcut);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]$/);
  });

  it('keeps every tool consistent with its group', () => {
    for (const group of TOOL_GROUPS) {
      expect(group.tools.length).toBeGreaterThan(0);
      for (const t of group.tools) {
        expect(t.group).toBe(group.id);
        expect(groupOfTool(t.id)?.id).toBe(group.id);
      }
    }
  });

  it('defaults to a real tool', () => {
    expect(getTool(DEFAULT_TOOL_ID)).toBeDefined();
  });

  it('marks the AI-gated and raster-gated tools', () => {
    // Object Selection is the only AI-gated tool; it must hide when the org has
    // no active provider rather than error (security invariant: no provider =>
    // AI is off).
    expect(allTools().filter((t) => t.requiresAi).map((t) => t.id)).toEqual([
      'object-select',
    ]);
    // Quick Selection is deliberately NOT AI-gated — it runs locally.
    expect(getTool('quick-select')?.requiresAi).toBeUndefined();
    expect(getTool('brush')?.requiresRaster).toBe(true);
  });

  it('does not register the pruned tools', () => {
    const ids = allTools().map((t) => t.id);
    for (const pruned of [
      'slice',
      'slice-select',
      'type-mask-horizontal',
      'type-mask-vertical',
      'mixer-brush',
      'pattern-stamp',
      'color-replacement',
    ]) {
      expect(ids).not.toContain(pruned);
    }
  });

  it('uses Sponge, not a second Smudge, in the dodge group', () => {
    const dodge = TOOL_GROUPS.find((g) => g.id === 'dodge')!;
    expect(dodge.tools.map((t) => t.id)).toEqual(['dodge', 'burn', 'sponge']);
    // Smudge belongs to the blur group only.
    expect(groupOfTool('smudge')?.id).toBe('blur');
  });
});

describe('resolveToolShortcut', () => {
  const noMemory = {};

  it('returns null for keys that are not tool shortcuts', () => {
    expect(resolveToolShortcut('q', false, 'move', noMemory)).toBeNull();
    expect(resolveToolShortcut('1', false, 'move', noMemory)).toBeNull();
  });

  it('selects the group default when nothing has been used yet', () => {
    expect(resolveToolShortcut('b', false, 'move', noMemory)).toBe('brush');
    expect(resolveToolShortcut('m', false, 'move', noMemory)).toBe('marquee-rect');
  });

  it('is case-insensitive', () => {
    expect(resolveToolShortcut('B', false, 'move', noMemory)).toBe('brush');
  });

  it('restores the last-used tool of the group', () => {
    const memory = { brush: 'pencil', marquee: 'marquee-ellipse' };
    expect(resolveToolShortcut('b', false, 'move', memory)).toBe('pencil');
    expect(resolveToolShortcut('m', false, 'move', memory)).toBe('marquee-ellipse');
  });

  it('ignores a remembered tool that no longer belongs to the group', () => {
    expect(resolveToolShortcut('b', false, 'move', { brush: 'nonsense' })).toBe('brush');
  });

  it('cycles within the group on Shift, wrapping at the end', () => {
    expect(resolveToolShortcut('r', true, 'blur', noMemory)).toBe('sharpen');
    expect(resolveToolShortcut('r', true, 'sharpen', noMemory)).toBe('smudge');
    expect(resolveToolShortcut('r', true, 'smudge', noMemory)).toBe('blur');
  });

  it('starts a Shift-cycle at the group default when another group is active', () => {
    // Shift+R while the Move tool is active enters the blur group at its first
    // tool rather than jumping into the middle of it.
    expect(resolveToolShortcut('r', true, 'move', noMemory)).toBe('blur');
  });

  it('cycles a six-tool group correctly', () => {
    const pen = TOOL_GROUPS.find((g) => g.id === 'pen')!;
    let current = pen.tools[0].id;
    const seen = [current];
    for (let i = 0; i < pen.tools.length - 1; i++) {
      current = resolveToolShortcut('p', true, current, noMemory)!;
      seen.push(current);
    }
    expect(seen).toEqual(pen.tools.map((t) => t.id));
    // One more wraps back to the start.
    expect(resolveToolShortcut('p', true, current, noMemory)).toBe(pen.tools[0].id);
  });
});
