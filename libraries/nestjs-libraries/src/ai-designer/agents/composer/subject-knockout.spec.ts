import { describe, it, expect, vi } from 'vitest';
import {
  applyKnockouts,
  knockoutRequests,
  MAX_KNOCKOUTS_PER_DESIGN,
} from './subject-knockout';
import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';
import type { DesignSlot } from '../../ai-designer.types';

const image = (id: string, over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id,
    originId: id,
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: 'https://example.test/photo.jpg',
    ...over,
  }) as DesignerElement;

const slot = (id: string, mask?: string): DesignSlot => ({ id, role: 'image', kind: 'image', mask });

const deps = (over: Partial<Parameters<typeof applyKnockouts>[1]> = {}) => ({
  removeBackground: vi.fn(async () => 'https://provider.test/cut.png'),
  importFromUrl: vi.fn(async () => ({ path: 'https://ours.test/cut.png', id: 'f-cut' })),
  warn: vi.fn(),
  ...over,
});

describe('knockoutRequests', () => {
  it('finds the image slots that asked for a cut-out', () => {
    // The recipe has been returning `knockout: true` since the design language
    // landed and nothing consumed it.
    const requests = knockoutRequests(
      [slot('hero', 'subject-knockout'), slot('other', 'circle')],
      [image('hero'), image('other')]
    );
    expect(requests.map((r) => r.slot.id)).toEqual(['hero']);
  });

  it('ignores a slot with no mask at all', () => {
    expect(knockoutRequests([slot('hero')], [image('hero')])).toEqual([]);
  });

  it('ignores a knockout whose image never resolved', () => {
    // A knockout with no source is not a degraded design, it is a wasted call.
    expect(
      knockoutRequests([slot('hero', 'subject-knockout')], [image('hero', { src: undefined })])
    ).toEqual([]);
  });

  it('ignores a knockout with no element at all', () => {
    expect(knockoutRequests([slot('ghost', 'subject-knockout')], [])).toEqual([]);
  });
});

describe('applyKnockouts', () => {
  const requests = () => knockoutRequests([slot('hero', 'subject-knockout')], [image('hero')]);

  it('replaces the source with the stored cut-out', async () => {
    const d = deps();
    const patches = await applyKnockouts(requests(), d, 'org-1');
    expect(patches.get('hero')).toMatchObject({
      src: 'https://ours.test/cut.png',
      fileId: 'f-cut',
    });
    expect(d.removeBackground).toHaveBeenCalledWith('https://example.test/photo.jpg', 'org-1');
  });

  it('switches to contain, since a cut-out no longer fills its box', async () => {
    // `cover` would crop the subject to fill a box the transparency vacated.
    const patches = await applyKnockouts(requests(), deps());
    expect(patches.get('hero')!.fitMode).toBe('contain');
  });

  it('keeps the original reachable, because a knockout is a treatment', async () => {
    const patches = await applyKnockouts(requests(), deps());
    expect(patches.get('hero')!.originalSrc).toBe('https://example.test/photo.jpg');
  });

  it('brings the cut-out under our own storage', async () => {
    const d = deps();
    await applyKnockouts(requests(), d);
    expect(d.importFromUrl).toHaveBeenCalledWith('https://provider.test/cut.png', undefined);
  });

  it('falls back silently-but-logged when no provider answers', async () => {
    // The org may have no background-removal provider at all. A design with an
    // uncut photograph is the same design with less depth.
    const d = deps({ removeBackground: vi.fn(async () => undefined) });
    const patches = await applyKnockouts(requests(), d);
    expect(patches.size).toBe(0);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });

  it('falls back when the cut-out cannot be stored', async () => {
    const d = deps({ importFromUrl: vi.fn(async () => undefined) });
    const patches = await applyKnockouts(requests(), d);
    expect(patches.size).toBe(0);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('could not be stored'));
  });

  it('never throws, whatever the provider does', async () => {
    // A design that threw is no design at all.
    const d = deps({
      removeBackground: vi.fn(async () => {
        throw new Error('budget exhausted');
      }),
    });
    await expect(applyKnockouts(requests(), d)).resolves.toBeInstanceOf(Map);
    expect(d.warn).toHaveBeenCalledWith(expect.stringContaining('budget exhausted'));
  });

  it('pays for at most one knockout per design', async () => {
    // Each is a real provider call, and two cut-out subjects is a collage.
    const many = knockoutRequests(
      [slot('a', 'subject-knockout'), slot('b', 'subject-knockout')],
      [image('a'), image('b')]
    );
    const d = deps();
    await applyKnockouts(many, d);
    expect(d.removeBackground).toHaveBeenCalledTimes(MAX_KNOCKOUTS_PER_DESIGN);
  });

  it('does nothing when nothing asked', async () => {
    const d = deps();
    expect((await applyKnockouts([], d)).size).toBe(0);
    expect(d.removeBackground).not.toHaveBeenCalled();
  });
});
