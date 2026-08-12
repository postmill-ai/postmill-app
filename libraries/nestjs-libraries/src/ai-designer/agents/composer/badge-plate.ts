import type {
  DesignerElement,
  DesignerWarp,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

/**
 * Badge PLATE construction, factored out of `_badgeElements` so the critic's
 * `badgeStyle` fix can re-emit a plate post-compose (a shape change is
 * structural — ribbon = bezier path, pill = rect — so it can never be an
 * `updateElement` property patch). One construction site, two callers.
 */
export interface BadgePlateOpts {
  /** Plan-authored radius override (rect plates only) — per-corner tuples
   *  pass through verbatim, same as the element schema. */
  borderRadius?: number | [number, number, number, number];
  /** Expanded warp recipe (rect plates only). */
  warp?: DesignerWarp;
}

export const buildBadgePlate = (
  box: { x: number; y: number; width: number; height: number },
  badgeStyle: 'pill' | 'ribbon' | (string & {}),
  accent: string,
  canvas: { w: number; h: number },
  slotId: string,
  opts: BadgePlateOpts = {}
): DesignerElement =>
  badgeStyle === 'ribbon'
    ? ({
        id: '',
        type: 'path',
        // Canvas box + absolute nodes, same contract as emit-decor — the
        // gently arched band with angled ends the style name promises
        // (proven in the manual clone test). A plain rect with a small
        // radius is NOT a ribbon.
        x: 0,
        y: 0,
        width: canvas.w,
        height: canvas.h,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        closed: true,
        fill: accent,
        // Both edges bow the SAME way — that is what makes a band read as
        // an arched ribbon. Bowing the top up and the bottom down (as this
        // did) fattens the middle into a lens, which is why the "1893"
        // plate rendered as a barrel with its label adrift above it.
        nodes: [
          { x: box.x + 2, y: box.y + box.height * 0.16, outX: box.x + box.width * 0.3, outY: box.y - box.height * 0.1 },
          { x: box.x + box.width - 2, y: box.y + box.height * 0.16, inX: box.x + box.width * 0.7, inY: box.y - box.height * 0.1 },
          { x: box.x + box.width, y: box.y + box.height * 0.84, outX: box.x + box.width * 0.7, outY: box.y + box.height * 0.58 },
          { x: box.x, y: box.y + box.height * 0.84, inX: box.x + box.width * 0.3, inY: box.y + box.height * 0.58 },
        ],
        groupId: slotId,
        originId: `${slotId}-bg`,
      } as DesignerElement)
    : ({
        id: '',
        type: 'shape',
        shape: 'rect',
        ...box,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fill: accent,
        borderRadius:
          opts.borderRadius ??
          (badgeStyle === 'pill'
            ? Math.round(box.height / 2)
            : Math.round(box.height * 0.12)),
        warp: opts.warp,
        groupId: slotId,
        originId: `${slotId}-bg`,
      } as DesignerElement);
