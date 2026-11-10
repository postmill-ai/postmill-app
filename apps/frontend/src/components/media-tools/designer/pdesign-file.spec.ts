import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPdesignArtifact, replaceDesignerDesignId } from './pdesign-file';

const nativeCreateObjectURL = URL.createObjectURL;
const nativeRevokeObjectURL = URL.revokeObjectURL;

describe('replaceDesignerDesignId', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('points the standalone editor at the imported design without reloading it', () => {
    window.history.replaceState(null, '', '/media/designer?designId=source&campaign=spring#canvas');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    replaceDesignerDesignId('imported-id');

    expect(window.location.pathname).toBe('/media/designer');
    expect(window.location.search).toBe('?designId=imported-id&campaign=spring');
    expect(window.location.hash).toBe('#canvas');
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/media/designer?designId=imported-id&campaign=spring#canvas'
    );
  });
});

describe('downloadPdesignArtifact', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    Object.assign(URL, {
      createObjectURL: nativeCreateObjectURL,
      revokeObjectURL: nativeRevokeObjectURL,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mockArtifact = () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['completed-export'])),
    });
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:first-export')
      .mockReturnValue('blob:completed-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', fetch);
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    return { fetch, createObjectURL, revokeObjectURL };
  };

  it('keeps the blob URL and anchor alive while Chromium starts the download', async () => {
    vi.useFakeTimers();
    const { fetch, revokeObjectURL } = mockArtifact();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadPdesignArtifact(
      'https://app.postmill.ai/uploads/completed-export.zip',
      'QR / Spring: "Sale"'
    );

    expect(fetch).toHaveBeenCalledWith('https://app.postmill.ai/uploads/completed-export.zip');
    expect(click).toHaveBeenCalledTimes(1);
    const downloaded = click.mock.instances[0] as HTMLAnchorElement;
    expect(document.body.contains(downloaded)).toBe(true);
    expect(downloaded.hidden).toBe(true);
    expect(downloaded.href).toBe('blob:first-export');
    expect(downloaded.download).toBe('QR   Spring  Sale.pdesign');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first-export');
  });

  it('reuses the connected anchor with a fallback filename', async () => {
    vi.useFakeTimers();
    mockArtifact();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadPdesignArtifact('/uploads/first-export.zip', 'First');
    await downloadPdesignArtifact('/uploads/completed-export.zip', '***');

    expect(click).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('a')).toHaveLength(1);
    const downloaded = click.mock.instances[1] as HTMLAnchorElement;
    expect(downloaded.href).toBe('blob:completed-export');
    expect(downloaded.download).toBe('design.pdesign');
    expect(document.body.contains(downloaded)).toBe(true);
  });
});
