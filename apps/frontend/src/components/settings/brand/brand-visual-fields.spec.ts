import { withBrandColorRoles, withBrandLogoRoles } from './brand-visual-fields';

describe('Brand visual field serialization', () => {
  it('keeps legacy arrays, order, duplicates, and shared roles', () => {
    expect(withBrandColorRoles(['#111111', '#222222', '#222222'], [
      { index: 1, hex: '#222222', role: 'primary' },
      { index: 2, hex: '#222222', role: 'primary' },
    ])).toEqual([
      '#111111',
      { hex: '#222222', role: 'primary' },
      { hex: '#222222', role: 'primary' },
    ]);
    expect(withBrandColorRoles(['#111111', '#222222'])).toEqual(['#111111', '#222222']);
  });

  it('only retains roles for logos in the effective patched list', () => {
    expect(withBrandLogoRoles(['f2', 'f3'], [
      { fileId: 'f1', role: 'main' },
      { fileId: 'f2', role: 'icon' },
    ])).toEqual([{ fileId: 'f2', role: 'icon' }, 'f3']);
  });
});
