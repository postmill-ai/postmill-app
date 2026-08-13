import {
  stampPositions,
  toTransparent,
  hexToRgb,
  floodFill,
  adjustLuminance,
  adjustSaturation,
  boxBlur,
} from './paint-engine';
import {
  createMask,
  combineMasks,
  modeFromModifiers,
  rectMask,
  ellipseMask,
  rowMask,
  columnMask,
  polygonMask,
  brushIntoMask,
  regionGrow,
  maskFromAlpha,
  edgeMagnitude,
  snapToEdge,
  maskOutline,
  isEmptyMask,
} from './selection-mask';
import {
  unitSquareToQuad,
  applyHomography,
  quadOutputSize,
  type Quad,
} from './perspective-crop';
import {
  penClick,
  penDragHandle,
  emptyDraft,
  addAnchorAt,
  deleteAnchorAt,
  convertAnchorAt,
  buildPathElement,
  findNodeAt,
} from './pen-tools';
import {
  smoothPathNodes,
  simplifyPoints,
  normalisePathToBox,
  pathBounds,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/path-geometry';

const imageData = (w: number, h: number, fill: [number, number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3];
  }
  return { data: d, width: w, height: h, colorSpace: 'srgb' } as ImageData;
};

const countSelected = (m: { data: Uint8ClampedArray }) =>
  m.data.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

describe('paint engine — stamp spacing', () => {
  it('interpolates a fast drag into evenly spaced stamps', () => {
    // Pointer events arrive far apart; without interpolation a stroke is dotted.
    const pts = stampPositions({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(pts.length).toBeGreaterThan(15);
    const gap = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    expect(gap).toBeCloseTo(5, 5); // 20 * 0.25 spacing
  });

  it('emits a single stamp for a tiny movement', () => {
    expect(stampPositions({ x: 0, y: 0 }, { x: 1, y: 0 }, 40)).toHaveLength(1);
  });
});

describe('paint engine — colour helpers', () => {
  it('makes a hex colour transparent for the brush falloff', () => {
    expect(toTransparent('#ff8800')).toBe('#ff880000');
    expect(toTransparent('#f80')).toBe('#ff880000');
    expect(toTransparent('rebeccapurple')).toBe('rgba(0,0,0,0)');
  });

  it('parses hex to rgb', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('nonsense')).toEqual([0, 0, 0]);
  });
});

describe('paint engine — flood fill', () => {
  it('fills a uniform region', () => {
    const img = imageData(8, 8, [255, 255, 255, 255]);
    const filled = floodFill(img, 4, 4, [255, 0, 0], 8);
    expect(filled).toBe(64);
    expect(img.data[0]).toBe(255);
    expect(img.data[1]).toBe(0);
  });

  it('respects an active selection so fill cannot escape the ants', () => {
    const img = imageData(8, 8, [255, 255, 255, 255]);
    const mask = new Uint8ClampedArray(64);
    // Only the top row is selected.
    mask.fill(255, 0, 8);
    const filled = floodFill(img, 4, 0, [255, 0, 0], 8, mask);
    expect(filled).toBe(8);
  });

  it('is a no-op for a seed outside the canvas', () => {
    const img = imageData(4, 4, [0, 0, 0, 255]);
    expect(floodFill(img, 99, 99, [255, 0, 0])).toBe(0);
  });
});

describe('paint engine — pixel adjustments', () => {
  it('dodges brighter and burns darker', () => {
    const up = imageData(1, 1, [100, 100, 100, 255]);
    adjustLuminance(up, 1.35);
    expect(up.data[0]).toBeGreaterThan(100);

    const down = imageData(1, 1, [100, 100, 100, 255]);
    adjustLuminance(down, 0.65);
    expect(down.data[0]).toBeLessThan(100);
  });

  it('desaturates toward luma and saturates away from it', () => {
    const grey = imageData(1, 1, [200, 100, 50, 255]);
    adjustSaturation(grey, 0);
    // Fully desaturated: all channels equal the luma.
    expect(grey.data[0]).toBe(grey.data[1]);
    expect(grey.data[1]).toBe(grey.data[2]);
  });

  it('blurs toward the neighbourhood average without changing a flat field', () => {
    const flat = imageData(5, 5, [120, 120, 120, 255]);
    boxBlur(flat, 1);
    expect(flat.data[0]).toBe(120);
  });
});

describe('selection masks', () => {
  it('maps modifiers to combine modes', () => {
    expect(modeFromModifiers(false, false)).toBe('replace');
    expect(modeFromModifiers(true, false)).toBe('add');
    expect(modeFromModifiers(false, true)).toBe('subtract');
    expect(modeFromModifiers(true, true)).toBe('intersect');
  });

  it('builds a rectangular selection of the right area', () => {
    const m = rectMask(10, 10, { x: 2, y: 2, width: 4, height: 4 });
    expect(countSelected(m)).toBe(16);
  });

  it('builds an elliptical selection smaller than its bounding box', () => {
    const box = rectMask(20, 20, { x: 0, y: 0, width: 20, height: 20 });
    const ell = ellipseMask(20, 20, { x: 0, y: 0, width: 20, height: 20 });
    expect(countSelected(ell)).toBeLessThan(countSelected(box));
    expect(countSelected(ell)).toBeGreaterThan(0);
  });

  it('selects exactly one row or column', () => {
    expect(countSelected(rowMask(10, 10, 3))).toBe(10);
    expect(countSelected(columnMask(10, 10, 3))).toBe(10);
  });

  it('fills a polygon by even-odd rule', () => {
    const tri = polygonMask(10, 10, [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 },
    ]);
    // Roughly half the square.
    const n = countSelected(tri);
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(70);
  });

  it('combines masks per mode', () => {
    const a = rectMask(10, 10, { x: 0, y: 0, width: 5, height: 10 });
    const b = rectMask(10, 10, { x: 3, y: 0, width: 5, height: 10 });
    expect(countSelected(combineMasks(a, b, 'replace'))).toBe(countSelected(b));
    expect(countSelected(combineMasks(a, b, 'add'))).toBe(80);
    expect(countSelected(combineMasks(a, b, 'subtract'))).toBe(30);
    expect(countSelected(combineMasks(a, b, 'intersect'))).toBe(20);
  });

  it('treats a fresh mask as empty', () => {
    expect(isEmptyMask(createMask(4, 4))).toBe(true);
    expect(isEmptyMask(null)).toBe(true);
    expect(isEmptyMask(rectMask(4, 4, { x: 0, y: 0, width: 2, height: 2 }))).toBe(false);
  });

  it('paints into a mask with the selection brush', () => {
    const m = createMask(20, 20);
    brushIntoMask(m, 10, 10, 4);
    expect(countSelected(m)).toBeGreaterThan(30);
    expect(m.data[0]).toBe(0); // corner untouched
  });

  it('grows a region over similar colour only', () => {
    const img = imageData(10, 10, [255, 255, 255, 255]);
    // Paint the right half black.
    for (let y = 0; y < 10; y++) {
      for (let x = 5; x < 10; x++) {
        const i = (y * 10 + x) * 4;
        img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      }
    }
    expect(countSelected(regionGrow(img, 0, 0, 16))).toBe(50);
  });

  it('derives a selection from alpha, which is how AI cutouts arrive', () => {
    const img = imageData(4, 4, [0, 0, 0, 0]);
    img.data[3] = 255; // one opaque pixel
    expect(countSelected(maskFromAlpha(img))).toBe(1);
  });

  it('finds edges and snaps toward them', () => {
    const img = imageData(9, 9, [0, 0, 0, 255]);
    for (let y = 0; y < 9; y++) {
      for (let x = 5; x < 9; x++) {
        const i = (y * 9 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      }
    }
    const edges = edgeMagnitude(img);
    const snapped = snapToEdge(edges, 9, 9, 2, 4, 4);
    // Pulled toward the vertical boundary at x≈4–5.
    expect(snapped.x).toBeGreaterThanOrEqual(3);
    expect(snapped.x).toBeLessThanOrEqual(5);
  });

  it('outlines only the boundary of the selection', () => {
    const m = rectMask(10, 10, { x: 2, y: 2, width: 4, height: 4 });
    // A 4x4 block has 16 boundary edges, not 16 filled cells' worth of segments.
    expect(maskOutline(m)).toHaveLength(16);
  });
});

describe('perspective crop', () => {
  const square: Quad = {
    points: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ],
  };

  it('maps the unit square onto an identity quad', () => {
    const h = unitSquareToQuad(square)!;
    expect(h).toBeTruthy();
    const p = applyHomography(h, 0.5, 0.5);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
  });

  it('maps the corners exactly for a skewed quad', () => {
    const quad: Quad = {
      points: [
        { x: 10, y: 0 }, { x: 90, y: 20 }, { x: 80, y: 100 }, { x: 0, y: 80 },
      ],
    };
    const h = unitSquareToQuad(quad)!;
    const c0 = applyHomography(h, 0, 0);
    const c2 = applyHomography(h, 1, 1);
    expect(c0.x).toBeCloseTo(10);
    expect(c0.y).toBeCloseTo(0);
    expect(c2.x).toBeCloseTo(80);
    expect(c2.y).toBeCloseTo(100);
  });

  it('rejects a degenerate quad rather than emitting NaNs', () => {
    expect(
      unitSquareToQuad({
        points: [
          { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
        ],
      })
    ).toBeNull();
  });

  it('sizes the output from the longest opposing edges', () => {
    expect(quadOutputSize(square)).toEqual({ width: 100, height: 100 });
  });
});

describe('pen tools', () => {
  it('appends anchors on click', () => {
    let d = emptyDraft();
    d = penClick(d, { x: 0, y: 0 }).draft;
    d = penClick(d, { x: 10, y: 10 }).draft;
    expect(d.nodes).toHaveLength(2);
    expect(d.closed).toBe(false);
  });

  it('closes when a click lands back on the first anchor', () => {
    let d = emptyDraft();
    d = penClick(d, { x: 0, y: 0 }).draft;
    d = penClick(d, { x: 50, y: 0 }).draft;
    d = penClick(d, { x: 50, y: 50 }).draft;
    const res = penClick(d, { x: 2, y: 2 });
    expect(res.finished).toBe(true);
    expect(res.draft.closed).toBe(true);
  });

  it('does not close with fewer than two anchors', () => {
    const d = penClick(emptyDraft(), { x: 0, y: 0 }).draft;
    expect(penClick(d, { x: 0, y: 0 }).finished).toBe(false);
  });

  it('pulls mirrored handles when dragging after an anchor', () => {
    let d = penClick(emptyDraft(), { x: 10, y: 10 }).draft;
    d = penDragHandle(d, { x: 20, y: 10 });
    const n = d.nodes[0];
    expect(n.outX).toBe(20);
    expect(n.inX).toBe(0); // mirrored about the anchor
  });

  it('adds an anchor on the nearest segment', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const out = addAnchorAt(nodes, false, { x: 50, y: 2 });
    expect(out).toHaveLength(4);
    expect(out[1]).toMatchObject({ x: 50, y: 2 });
  });

  it('deletes an anchor but refuses to drop below two', () => {
    expect(deleteAnchorAt([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], 1)).toHaveLength(2);
    expect(deleteAnchorAt([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toHaveLength(2);
  });

  it('converts a corner to smooth and back', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
    const smooth = convertAnchorAt(nodes, 1);
    expect(typeof smooth[1].inX).toBe('number');
    const corner = convertAnchorAt(smooth, 1);
    expect(corner[1].inX).toBeUndefined();
  });

  it('finds an anchor near a point', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(findNodeAt(nodes, { x: 2, y: 2 })).toBe(0);
    expect(findNodeAt(nodes, { x: 50, y: 50 })).toBe(-1);
  });

  it('builds an element whose box hugs the path', () => {
    const el = buildPathElement({ nodes: [{ x: 10, y: 20 }, { x: 40, y: 60 }], closed: false })!;
    expect(el.type).toBe('path');
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.width).toBe(30);
    expect(el.height).toBe(40);
    // Stored nodes are element-local.
    expect(el.nodes![0]).toMatchObject({ x: 0, y: 0 });
  });

  it('refuses to build from a single anchor', () => {
    expect(buildPathElement({ nodes: [{ x: 0, y: 0 }], closed: false })).toBeNull();
  });

  it('leaves an open path unfilled', () => {
    const open = buildPathElement({ nodes: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false })!;
    expect(open.fill).toBeUndefined();
  });
});

describe('path geometry', () => {
  it('bounds a path over anchors and handles', () => {
    const b = pathBounds([{ x: 0, y: 0, outX: -10, outY: 0 }, { x: 50, y: 50 }])!;
    expect(b.minX).toBe(-10);
    expect(b.maxX).toBe(50);
  });

  it('keeps a straight path selectable by flooring its extent', () => {
    const box = normalisePathToBox([{ x: 0, y: 10 }, { x: 100, y: 10 }])!;
    expect(box.width).toBe(100);
    expect(box.height).toBe(1); // never zero
  });

  it('smooths a polyline into mirrored handles', () => {
    const s = smoothPathNodes([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(typeof s[1].inX).toBe('number');
    // Mirrored about the anchor.
    expect(s[1].inX! + s[1].outX!).toBeCloseTo(2 * s[1].x);
  });

  it('simplifies a dense trail while keeping the endpoints', () => {
    const dense = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    const simple = simplifyPoints(dense, 1);
    expect(simple.length).toBeLessThan(10);
    expect(simple[0]).toEqual({ x: 0, y: 0 });
    expect(simple[simple.length - 1]).toEqual({ x: 99, y: 0 });
  });

  it('keeps detail that exceeds the tolerance', () => {
    const spiky = [{ x: 0, y: 0 }, { x: 5, y: 50 }, { x: 10, y: 0 }];
    expect(simplifyPoints(spiky, 1)).toHaveLength(3);
  });
});
