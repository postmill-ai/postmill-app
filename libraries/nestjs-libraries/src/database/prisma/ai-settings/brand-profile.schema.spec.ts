import { validateBrandProfileData } from './brand-profile.schema';

describe('Brand profile JSON compatibility', () => {
  it('preserves visual roles and uploaded custom-font render metadata', () => {
    const data = {
      palette: ['#111111', { name: 'Primary', hex: '#222222', role: 'primary' }, { hex: '#333333', role: 'accent' }],
      logoFileIds: ['legacy', { fileId: 'icon', role: 'icon' }, { fileId: 'dark', role: 'dark' }],
      customFonts: [{
        fileId: 'font-1',
        family: 'Uploaded Sans',
        path: '/font.ttf',
        weights: [400, 700],
        italic: true,
        serverRender: true,
      }],
    };

    expect(validateBrandProfileData(data)).toEqual(data);
  });

  it('does not materialize omitted visual fields on partial updates', () => {
    expect(validateBrandProfileData({ name: 'Legacy brand' })).toEqual({ name: 'Legacy brand' });
  });

  it('rejects unsupported roles', () => {
    expect(() => validateBrandProfileData({ palette: [{ hex: '#123456', role: 'other' }] })).toThrow();
    expect(() => validateBrandProfileData({ logoFileIds: [{ fileId: 'logo', role: 'other' }] })).toThrow();
  });
});
