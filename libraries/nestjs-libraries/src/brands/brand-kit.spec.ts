import { BadRequestException } from '@nestjs/common';
import { normalizeBrandProfile, normalizeBrandProfilePatch } from './brand-kit';

describe('Brand Kit normalization', () => {
  it('normalizes current and legacy visual fields without dropping other data', () => {
    expect(normalizeBrandProfile({
      id: 'brand-1',
      palette: ['#aabbcc', { name: 'Accent', hex: '#ddeeff' }, { name: 'missing' }],
      fontFamilies: ['Inter', { name: 'Plus Jakarta Sans', fallback: 'sans-serif' }],
      preferredFormats: ['ig-post', 'ig-post', 'linkedin-post'],
      customFonts: [{ fileId: 'font-1', family: 'Custom', path: '/font.ttf', weights: [700] }],
    })).toEqual({
      id: 'brand-1',
      palette: ['#aabbcc', '#ddeeff'],
      fontFamilies: ['Inter', 'Plus Jakarta Sans'],
      preferredFormats: ['ig-post', 'linkedin-post'],
      customFonts: [{ fileId: 'font-1', family: 'Custom', path: '/font.ttf', weights: [700] }],
      logoFileIds: [],
      assets: [],
    });
  });

  it('normalizes only supplied patch fields', () => {
    expect(normalizeBrandProfilePatch({ palette: [{ hex: '#010203' }] })).toEqual({
      palette: ['#010203'],
    });
    expect(normalizeBrandProfilePatch({ name: 'Brand' })).toEqual({ name: 'Brand' });
  });

  it('rejects unknown preferred formats', () => {
    expect(() => normalizeBrandProfilePatch({ preferredFormats: ['not-a-format'] }))
      .toThrow(BadRequestException);
  });
});
