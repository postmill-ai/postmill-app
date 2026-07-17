interface OpenInDesignerArgs {
  operation: string;
  artifactUrl?: string | null;
  fileId?: string | null;
  // Optional metadata forwarded for the static-canvas (image) path so attribution,
  // source, and natural dimensions are preserved.
  source?: string;
  author?: string;
  authorUrl?: string;
  downloadLocation?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

const DESIGNER_HANDOFF_KEY = 'designer:timeline-handoff';

/**
 * Open a generated/downloaded media artifact in the Designer.
 *
 * - Images land on the static canvas; optional metadata (source, attribution,
 *   dimensions) is forwarded to preserve the existing attribution + sizing flow.
 * - Audio and video land on the video timeline (via the timeline handoff path).
 *   HeyGen avatar renders (`operation: 'avatar'`) are treated as video.
 * - Pass `router.push` as the optional `navigate` callback to stay in-tab;
 *   otherwise the helper opens a new tab.
 * - Non-media operations (`stt`, `text`, etc.) are ignored.
 */
export function openInDesigner(
  args: OpenInDesignerArgs,
  navigate?: (url: string) => void
): void {
  const {
    operation,
    artifactUrl,
    fileId,
    source,
    author,
    authorUrl,
    downloadLocation,
    thumbUrl,
    width,
    height,
    naturalWidth,
    naturalHeight,
  } = args;

  if (!artifactUrl || !['image', 'audio', 'video', 'avatar'].includes(operation)) {
    return;
  }

  const go = (url: string) => (navigate ? navigate(url) : window.open(url, '_blank'));

  if (operation === 'image') {
    const params = new URLSearchParams({ url: artifactUrl, type: 'photo' });
    if (source) params.set('source', source);
    if (author) params.set('author', author);
    if (authorUrl) params.set('authorUrl', authorUrl);
    if (downloadLocation) params.set('downloadLocation', downloadLocation);
    if (thumbUrl) params.set('thumbUrl', thumbUrl);
    if (width) params.set('w', String(width));
    if (height) params.set('h', String(height));
    if (naturalWidth) params.set('nw', String(naturalWidth));
    if (naturalHeight) params.set('nh', String(naturalHeight));
    go(`/media/designer?${params.toString()}`);
    return;
  }

  const type = operation === 'audio' ? 'audio' : 'video';
  try {
    window.sessionStorage.setItem(
      DESIGNER_HANDOFF_KEY,
      JSON.stringify({
        type,
        url: artifactUrl,
        fileId: fileId ?? undefined,
      })
    );
  } catch {
    // sessionStorage can throw in private mode or when quota is exceeded.
    return;
  }

  go('/media/designer?timeline=1');
}
