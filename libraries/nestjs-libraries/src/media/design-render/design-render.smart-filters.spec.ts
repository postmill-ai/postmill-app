import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { DesignRenderService } from './design-render.service';

/**
 * Smart filters on the SERVER.
 *
 * The stack is a recipe plus the pre-filter pixels, and the client re-bakes it
 * into `src` to keep the canvas responsive. That made the renderers' job free
 * and left a hole: a document that no browser ever touched — one built through
 * `POST /media/apply-ops`, through the SDK, or by the AI Designer — rendered
 * completely unfiltered. Since the AI Designer's vision critic reviews the
 * server render, a treatment it asked for was invisible to the design, the
 * preview and the critique at the same time.
 */

class FakeFontLoaderService {
  async loadOrgFonts() {}
  async loadCuratedFonts() {}
}

const makeService = () => new DesignRenderService(new FakeFontLoaderService() as any);

/** A raw RGBA source of `pixels`, as a data URI. */
const imageUri = async (width: number, height: number, pixels: number[][]) => {
  const raw = Buffer.alloc(width * height * 4);
  pixels.forEach(([r, g, b], i) => {
    raw[i * 4] = r;
    raw[i * 4 + 1] = g;
    raw[i * 4 + 2] = b;
    raw[i * 4 + 3] = 255;
  });
  const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
};

const solid = (width: number, height: number, rgb: number[]) =>
  imageUri(width, height, Array.from({ length: width * height }, () => rgb));

const docWith = (el: Record<string, unknown>): any => ({
  version: 6,
  mode: 'image',
  outputs: [
    {
      id: 'o',
      formatId: 'square',
      name: 'S',
      width: 100,
      height: 100,
      background: '#ffffff',
      children: [
        {
          id: 'img',
          type: 'image',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          ...el,
        },
      ],
    },
  ],
});

const render = async (doc: any) => {
  const png = await makeService().renderPage(doc, 0, { pixelRatio: 1 });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
};

describe('smart filters render server-side', () => {
  it('applies a stack with no client bake involved', async () => {
    // `src` and `originalSrc` are the same untouched pixels — exactly the state
    // a document arrives in from the AI Designer, which has no browser to bake.
    const src = await solid(8, 8, [200, 200, 200]);

    const unfiltered = await render(docWith({ src, fitMode: 'fill' }));
    const filtered = await render(
      docWith({ src, originalSrc: src, smartFilters: [{ id: 'solarize' }], fitMode: 'fill' })
    );

    // solarize maps v > 127 to 255 - v, so a light grey comes back dark.
    expect(unfiltered(50, 50)[0]).toBeGreaterThan(180);
    expect(filtered(50, 50)[0]).toBeLessThan(80);
  });

  it('reads originalSrc, not a stale baked src', async () => {
    // `sharpen` over a uniform image is a no-op, so whatever colour comes out
    // names the source that was read — with no dependence on filter maths.
    const original = await solid(8, 8, [255, 0, 0]);
    const staleBake = await solid(8, 8, [0, 0, 255]);

    const at = await render(
      docWith({
        src: staleBake,
        originalSrc: original,
        smartFilters: [{ id: 'sharpen' }],
        fitMode: 'fill',
      })
    );

    const [r, , b] = at(50, 50);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
  });

  it('treats src as the original when nothing has been frozen yet', async () => {
    const src = await solid(8, 8, [255, 0, 0]);
    const at = await render(docWith({ src, smartFilters: [{ id: 'sharpen' }], fitMode: 'fill' }));
    expect(at(50, 50)[0]).toBeGreaterThan(200);
  });

  it('draws the baked src when every entry is disabled', async () => {
    // A disabled stack must not send the renderer down the re-bake path, and
    // must not switch it to `originalSrc` either.
    const original = await solid(8, 8, [255, 0, 0]);
    const baked = await solid(8, 8, [0, 0, 255]);

    const at = await render(
      docWith({
        src: baked,
        originalSrc: original,
        smartFilters: [{ id: 'solarize', enabled: false }],
        fitMode: 'fill',
      })
    );

    expect(at(50, 50)[2]).toBeGreaterThan(200);
  });

  it('renders an unknown filter id rather than failing', async () => {
    // A document saved by a newer build naming a filter this one lacks.
    const src = await solid(8, 8, [255, 0, 0]);
    const at = await render(
      docWith({ src, originalSrc: src, smartFilters: [{ id: 'not-a-real-filter' }], fitMode: 'fill' })
    );
    expect(at(50, 50)[0]).toBeGreaterThan(200);
  });

  it('is idempotent — rendering twice gives the same picture', async () => {
    // The evaluated stack is cached across renders; a second render must not
    // filter the already-filtered result.
    const src = await solid(8, 8, [200, 200, 200]);
    const doc = docWith({
      src,
      originalSrc: src,
      smartFilters: [{ id: 'solarize' }],
      fitMode: 'fill',
    });

    const service = makeService();
    const first = await service.renderPage(doc, 0, { pixelRatio: 1 });
    const second = await service.renderPage(doc, 0, { pixelRatio: 1 });
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('does not move geometry — a contained wide image still letterboxes', async () => {
    // The regression this guards: baking into the ELEMENT BOX stretches the
    // source to fit, because the 5-argument drawImage ignores aspect. A 4:1
    // photo would fill a square frame instead of letterboxing, and
    // naturalWidth/naturalHeight would describe an image that no longer exists.
    const src = await solid(40, 10, [255, 0, 0]);

    const at = await render(docWith({ src, originalSrc: src, smartFilters: [{ id: 'sharpen' }] }));

    // A 4:1 source contained in a 100x100 box occupies a band ~25px tall.
    const [midR] = at(50, 50);
    const [topR, topG, topB] = at(50, 4);
    expect(midR).toBeGreaterThan(200);
    expect([topR, topG, topB].every((c) => c > 200)).toBe(true);
  });
});
