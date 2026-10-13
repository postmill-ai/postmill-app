import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerDefaultsGate } from './ai-designer-defaults.gate';

const ORG_ID = 'org-1';

describe('AiDesignerDefaultsGate', () => {
  let resolution: {
    resolve: ReturnType<typeof vi.fn>;
    storedDefault: ReturnType<typeof vi.fn>;
  };
  let gate: AiDesignerDefaultsGate;

  beforeEach(() => {
    resolution = {
      resolve: vi.fn().mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        source: 'stored',
      }),
      storedDefault: vi.fn().mockResolvedValue(null),
    };
    gate = new AiDesignerDefaultsGate(resolution as any);
  });

  it('passes when every required default resolves', async () => {
    const result = await gate.missingDefaults(ORG_ID);

    expect(result).toEqual({ blocked: false, missing: [], warnings: [] });
    // The three AI categories plus the media text-to-image default.
    expect(resolution.resolve).toHaveBeenCalledTimes(4);
    expect(resolution.resolve).toHaveBeenCalledWith(
      'media',
      'text-to-image',
      ORG_ID
    );
  });

  it('blocks when an AI category does not resolve', async () => {
    resolution.resolve.mockImplementation(
      (_domain: string, category: string) =>
        Promise.resolve(
          category === 'vision'
            ? null
            : { providerId: 'openai', version: 'v1', source: 'stored' }
        )
    );

    const result = await gate.missingDefaults(ORG_ID);

    expect(result.blocked).toBe(true);
    expect(result.missing).toEqual(['vision']);
  });

  it('blocks when NO text-to-image default resolves and none was ever configured', async () => {
    resolution.resolve.mockImplementation(
      (domain: string, _category: string) =>
        Promise.resolve(
          domain === 'media'
            ? null
            : { providerId: 'openai', version: 'v1', source: 'stored' }
        )
    );
    resolution.storedDefault.mockResolvedValue(null);

    const result = await gate.missingDefaults(ORG_ID);

    // No image default at all guarantees every background silently degrades
    // to stock — the run start is rejected, same UX as the AI categories.
    expect(result.blocked).toBe(true);
    expect(result.missing).toEqual(['image generation (text-to-image)']);
    expect(result.warnings).toEqual([]);
    expect(gate.missingDefaultsMarkdown(result.missing)).toContain(
      'image generation (text-to-image)'
    );
  });

  it('warns (and does not block) when a text-to-image default is configured but no longer resolves', async () => {
    resolution.resolve.mockImplementation(
      (domain: string, _category: string) =>
        Promise.resolve(
          domain === 'media'
            ? null
            : { providerId: 'openai', version: 'v1', source: 'stored' }
        )
    );
    // The stored row survives a disabled/removed provider — that is the
    // warn-and-continue case, distinct from "never configured".
    resolution.storedDefault.mockResolvedValue({
      providerId: 'replicate',
      version: 'v1',
    });

    const result = await gate.missingDefaults(ORG_ID);

    expect(result.blocked).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual(['image generation (text-to-image)']);
    expect(gate.defaultsWarningMarkdown(result.warnings)).toContain(
      'disabled or unavailable'
    );
  });
});
