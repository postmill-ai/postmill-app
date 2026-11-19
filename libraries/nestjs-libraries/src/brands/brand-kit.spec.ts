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

  it('preserves palette order, duplicate colors, and indexed semantic roles', () => {
    expect(normalizeBrandProfile({
      id: 'brand-1',
      palette: [
        '#111111',
        { name: 'Brand blue', hex: '#222222', role: 'primary' },
        '#222222',
        { hex: '#333333', role: 'accent' },
        { hex: '#444444', role: 'background' },
        { hex: '#555555', role: 'text' },
      ],
      logoFileIds: ['logo-legacy', { fileId: 'logo-main', role: 'main' }, { fileId: 'logo-icon', role: 'icon' }, { fileId: 'logo-dark', role: 'dark' }],
    })).toMatchObject({
      palette: ['#111111', '#222222', '#222222', '#333333', '#444444', '#555555'],
      colorRoles: [
        { index: 1, hex: '#222222', role: 'primary' },
        { index: 3, hex: '#333333', role: 'accent' },
        { index: 4, hex: '#444444', role: 'background' },
        { index: 5, hex: '#555555', role: 'text' },
      ],
      logoFileIds: ['logo-legacy', 'logo-main', 'logo-icon', 'logo-dark'],
      logoRoles: [
        { fileId: 'logo-main', role: 'main' },
        { fileId: 'logo-icon', role: 'icon' },
        { fileId: 'logo-dark', role: 'dark' },
      ],
    });
  });

  it('round-trips only entries with roles as objects on writes', () => {
    expect(normalizeBrandProfilePatch({
      palette: ['#111111', { name: 'Primary blue', hex: '#222222', role: 'primary' }, { hex: '#222222' }],
      logoFileIds: ['logo-legacy', { fileId: 'logo-main', role: 'main' }],
    })).toEqual({
      palette: ['#111111', { name: 'Primary blue', hex: '#222222', role: 'primary' }, '#222222'],
      logoFileIds: ['logo-legacy', { fileId: 'logo-main', role: 'main' }],
    });
  });

  it('keeps unknown stored roles harmless while retaining their colors and logos', () => {
    expect(normalizeBrandProfile({
      id: 'brand-1',
      palette: [{ hex: '#abcdef', role: 'future-role' }],
      logoFileIds: [{ fileId: 'logo-1', role: 'future-role' }],
    })).toMatchObject({
      palette: ['#abcdef'],
      logoFileIds: ['logo-1'],
    });
    expect(normalizeBrandProfile({ id: 'brand-1' }).colorRoles).toBeUndefined();
  });

  it('clears role metadata with empty arrays and rejects invalid roles on writes', () => {
    expect(normalizeBrandProfilePatch({ palette: [], logoFileIds: [] })).toEqual({ palette: [], logoFileIds: [] });
    expect(() => normalizeBrandProfilePatch({ palette: [{ hex: '#010203', role: 'other' as any }] }))
      .toThrow(BadRequestException);
    expect(() => normalizeBrandProfilePatch({ logoFileIds: [{ fileId: 'logo', role: 'other' as any }] }))
      .toThrow(BadRequestException);
  });

  it('rejects unknown preferred formats', () => {
    expect(() => normalizeBrandProfilePatch({ preferredFormats: ['not-a-format'] }))
      .toThrow(BadRequestException);
  });
});
