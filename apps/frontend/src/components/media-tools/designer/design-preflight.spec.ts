import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeDesignerPreflight } from './design-preflight';
import { getContrastRatio } from './contrast';

const measureForElement = vi.hoisted(() => vi.fn());
vi.mock('./measure-text', () => ({ measureForElement }));

const text = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  text: 'Hello',
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fontSize: 16,
  fill: '#000000',
  ...overrides,
});

const output = (children: any[], overrides: Record<string, unknown> = {}) => ({
  id: 'out-1',
  formatId: 'custom',
  name: 'Poster',
  width: 1000,
  height: 1000,
  background: '#ffffff',
  children,
  ...overrides,
});

const doc = (outputs: any[]) => ({ mode: 'image' as const, outputs });
const analyze = (fixture: any, pages = [0]) => analyzeDesignerPreflight(fixture, [{ outputIndex: 0, pages }]);

describe('getContrastRatio', () => {
  it('computes WCAG contrast and rejects unsupported colors', () => {
    expect(getContrastRatio('#000000', '#ffffff')).toBe(21);
    expect(getContrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
    expect(getContrastRatio('red', '#ffffff')).toBeNull();
  });
});

describe('analyzeDesignerPreflight', () => {
  beforeEach(() => {
    measureForElement.mockReset();
    measureForElement.mockImplementation(() => (value: string, size: number) => value.length * size * 0.5);
  });

  it('accepts readable flat text on a solid background', () => {
    const result = analyze(doc([output([text('one')])]));
    expect(result.findings).toEqual([]);
    expect(result.unassessed.contrast).toBe(0);
  });

  it('warns for low contrast with its element target', () => {
    const result = analyze(doc([output([text('one', { fill: '#777777' })])]));
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'low-contrast', elementId: 'one', outputIndex: 0, pageNumber: 0 }),
    ]);
    expect(result.findings[0].vars.ratio).toBe('4.5');
  });

  it('marks an obscured or image background as unassessed instead of guessing', () => {
    const shape = {
      id: 'backdrop', type: 'shape', shape: 'rect', x: 0, y: 0, width: 300, height: 300,
      rotation: 0, opacity: 1, hidden: false, locked: false, fill: '#ffffff',
    };
    const result = analyze(doc([output([shape, text('one', { fill: '#777777' })], {
      bg: { type: 'image', src: '/uploads/photo.jpg' },
    })]));
    expect(result.findings).toEqual([]);
    expect(result.unassessed.contrast).toBe(1);
  });

  it('checks explicit unsafe zones and ignores hidden text', () => {
    const result = analyze(doc([output([
      text('hidden', { y: 1800, hidden: true }),
      text('visible', { y: 1800 }),
    ], { formatId: 'ig-story', height: 1920 })]));
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'safe-zone', elementId: 'visible' }),
    ]);
    expect(result.findings[0].vars.zone).toBe('CTA Bar');
  });

  it('uses the generic title-safe area for custom dimensions', () => {
    const result = analyze(doc([output([text('one', { x: 0, y: 0 })])]));
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'safe-zone', elementId: 'one' }),
    ]);
  });

  it('records rotated geometry as unassessed', () => {
    const result = analyze(doc([output([text('one', { rotation: 20 })])]));
    expect(result.unassessed.geometry).toBe(1);
  });

  it('flags structurally missing static media', () => {
    const image = {
      id: 'image-1', type: 'image', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, hidden: false, locked: false,
    };
    const result = analyze(doc([output([image], {
      bg: { type: 'image', src: undefined },
    })]));
    expect(result.findings.map((finding) => finding.rule)).toEqual(['missing-media', 'missing-media']);
  });

  it('detects flat text that still overflows after fitting', () => {
    const result = analyze(doc([output([text('one', {
      text: 'x'.repeat(100), width: 100, height: 20, fontSize: 20,
    })])]));
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'text-overflow', elementId: 'one' }),
    ]);
  });

  it('marks unavailable text measurement as unassessed', () => {
    measureForElement.mockReturnValue(undefined);
    const result = analyze(doc([output([text('one')])]));
    expect(result.findings).toEqual([]);
    expect(result.unassessed.text).toBe(1);
  });

  it('skips empty text instead of reporting it as unassessed', () => {
    const result = analyze(doc([output([text('empty', { text: '   ' })])]));
    expect(result.findings).toEqual([]);
    expect(result.unassessed).toEqual({ contrast: 0, text: 0, geometry: 0 });
  });

  it('audits only the selected pages', () => {
    const fixture = doc([output([text('page-one', { fill: '#777777' })], {
      pages: [{ id: 'page-two', children: [text('page-two', { fill: '#777777' })] }],
    })]);
    const result = analyze(fixture, [1]);
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'low-contrast', elementId: 'page-two', pageNumber: 1 }),
    ]);
  });

  it('detects video text truncation and missing clip media', () => {
    const fixture = {
      mode: 'video' as const,
      outputs: [{
        id: 'video-out', formatId: 'custom-video', name: 'Video', width: 1000, height: 1000,
        fps: 30, durationMs: 5000,
        tracks: [
          { id: 'media-track', type: 'video', clips: [{ id: 'media-clip', opacity: 1 }] },
          { id: 'text-track', type: 'text', clips: [{
            id: 'text-clip', text: 'one two three four five six seven eight nine ten',
            x: 100, y: 100, width: 100, height: 20, fontSize: 10, fill: '#ffffff', opacity: 1,
          }] },
        ],
      }],
    };
    const result = analyzeDesignerPreflight(fixture, [{ outputIndex: 0, pages: [0] }]);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'missing-media', clip: { trackId: 'media-track', clipId: 'media-clip' } }),
      expect.objectContaining({ rule: 'text-overflow', clip: { trackId: 'text-track', clipId: 'text-clip' } }),
    ]));
  });

  it('skips hidden video tracks', () => {
    const fixture = {
      mode: 'video' as const,
      outputs: [{
        id: 'video-out', formatId: 'custom-video', name: 'Video', width: 1000, height: 1000,
        fps: 30, durationMs: 5000,
        tracks: [{ id: 'hidden-track', type: 'text', hidden: true, clips: [{ id: 'text-clip', text: 'Hidden', fill: '#777777' }] }],
      }],
    };
    const result = analyzeDesignerPreflight(fixture, [{ outputIndex: 0, pages: [0] }]);
    expect(result.findings).toEqual([]);
  });
});
