import { describe, it, expect } from 'vitest';
import { DesignRenderService } from './design-render.service';

class FakeFontLoaderService {
  async loadOrgFonts(_orgId?: string) {
    // no-op
  }
  async loadCuratedFonts(_children: unknown[]) {
    // no-op
  }
}

const makeService = () =>
  new DesignRenderService(new FakeFontLoaderService() as any);

const makeDoc = (): any => ({
  version: 2,
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 200,
      height: 200,
      background: '#ff0000',
      children: [],
    },
    {
      id: 'out-2',
      formatId: 'story',
      name: 'Story',
      width: 200,
      height: 400,
      background: '#00ff00',
      children: [],
    },
  ],
});

describe('DesignRenderService', () => {
  it('renders a contact sheet as a PNG buffer', async () => {
    const service = makeService();
    const sheet = await service.renderContactSheet(makeDoc());

    expect(Buffer.isBuffer(sheet)).toBe(true);
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
  });

  it('renders all pages', async () => {
    const service = makeService();
    const pages = await service.renderAllPages(makeDoc());

    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(Buffer.isBuffer(page)).toBe(true);
      expect(page.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    }
  });
});
