import { describe, expect, it } from 'vitest';
import {
  defineLockup,
  instantiateLockup,
  lockupOverrideText,
  lockupSymbolId,
  LOCKUP_LABEL,
  LOCKUP_PLATE,
} from './lockups';
import { expandSymbols } from '../../../media/designer-doc/symbols';
import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';

/**
 * The lockup contract: the instance IS the addressable unit. It keeps the
 * slot's originId, geometry lands on its box, and content/style land in
 * symbolOverrides keyed by the definition's child ids — so a CTA restyled on
 * one format is restyled on all thirty.
 */

const plate = (over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: '',
    type: 'shape',
    shape: 'rect',
    x: 434,
    y: 856,
    width: 213,
    height: 59,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: '#FF4D00',
    borderRadius: 8,
    groupId: 'cta',
    originId: 'cta-bg',
    ...over,
  }) as DesignerElement;

const label = (over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: '',
    type: 'text',
    x: 434,
    y: 856,
    width: 213,
    height: 59,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Shop the sale',
    fontSize: 28,
    fill: '#FFFFFF',
    align: 'center',
    groupId: 'cta',
    originId: 'cta',
    ...over,
  }) as DesignerElement;

describe('defineLockup', () => {
  it('re-roots the pair into symbol-local coordinates with fix-targetable ids', () => {
    const def = defineLockup('cta', plate(), label());
    expect(def.id).toBe(lockupSymbolId('cta'));
    expect(def.width).toBe(213);
    expect(def.height).toBe(59);
    const [p, l] = def.children;
    expect([p.id, l.id]).toEqual([LOCKUP_PLATE, LOCKUP_LABEL]);
    expect([p.x, p.y, l.x, l.y]).toEqual([0, 0, 0, 0]);
  });

  it('strips per-output addressing from the children — the instance is what you edit', () => {
    const def = defineLockup('cta', plate(), label());
    for (const child of def.children) {
      expect(child.originId).toBeUndefined();
      expect(child.groupId).toBeUndefined();
    }
  });
});

describe('instantiateLockup → expandSymbols round trip', () => {
  it('yields plate+label at the instance box with the override text applied', () => {
    const def = defineLockup('cta', plate(), label());
    const instance = instantiateLockup(def, {
      originId: 'cta',
      groupId: 'cta',
      box: { x: 100, y: 200, width: 213, height: 59 },
      overrides: { [LOCKUP_LABEL]: { text: 'Shop now' } },
    });

    const out = expandSymbols([instance], [def]);
    expect(out.map((el) => el.id)).toEqual([
      `${instance.id}::${LOCKUP_PLATE}`,
      `${instance.id}::${LOCKUP_LABEL}`,
    ]);
    expect(out[0]).toMatchObject({
      type: 'shape',
      x: 100,
      y: 200,
      width: 213,
      height: 59,
      fill: '#FF4D00',
    });
    expect(out[1]).toMatchObject({ type: 'text', x: 100, y: 200, text: 'Shop now' });
  });

  it('scales the children — fontSize included — from the instance box', () => {
    // Geometry operations patch the instance box only; the expansion scales
    // the lockup like a group, which is what makes refit/safe-zone clamps
    // work without knowing symbols exist.
    const def = defineLockup('cta', plate(), label());
    const instance = instantiateLockup(def, {
      originId: 'cta',
      box: { x: 0, y: 0, width: 426, height: 118 },
    });
    const out = expandSymbols([instance], [def]);
    expect(out[0].width).toBe(426);
    expect(out[1].fontSize).toBe(56);
  });

  it('namespaces two instances of the same definition so their ids never collide', () => {
    const def = defineLockup('cta', plate(), label());
    const first = instantiateLockup(def, {
      originId: 'cta',
      box: { x: 0, y: 0, width: 213, height: 59 },
    });
    const second = instantiateLockup(def, {
      originId: 'cta',
      box: { x: 0, y: 0, width: 213, height: 59 },
    });
    first.id = 'inst-a';
    second.id = 'inst-b';
    const ids = expandSymbols([first, second], [def]).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'inst-a::plate',
      'inst-a::label',
      'inst-b::plate',
      'inst-b::label',
    ]);
  });
});

describe('lockupOverrideText', () => {
  it('reads the label an instance stands in for', () => {
    const def = defineLockup('cta', plate(), label());
    const instance = instantiateLockup(def, {
      originId: 'cta',
      box: { x: 0, y: 0, width: 213, height: 59 },
      overrides: { [LOCKUP_LABEL]: { text: 'Shop now' } },
    });
    expect(lockupOverrideText(instance)).toBe('Shop now');
  });

  it('is undefined for non-symbols and override-less instances', () => {
    expect(lockupOverrideText(label())).toBeUndefined();
    expect(
      lockupOverrideText({ type: 'symbol', symbolOverrides: {} } as never)
    ).toBeUndefined();
  });
});
