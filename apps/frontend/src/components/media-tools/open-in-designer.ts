interface OpenInDesignerArgs {
  operation: string;
  artifactUrl?: string | null;
  fileId?: string | null;
  // Content-classified type of the stored File, when the caller has it (render
  // queues). Trusted over `operation`: a video-operation job can land an image
  // artifact (e.g. a Reel.Farm slideshow completed without a video export), and
  // an image must land on the static canvas, not the video timeline.
  fileType?: string | null;
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
    fileType,
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

  // The classified file type wins over the requested operation; without it,
  // 'avatar' renders are video and everything else is taken at face value.
  const kind =
    fileType === 'image' || fileType === 'audio' || fileType === 'video'
      ? fileType
      : operation;

  if (kind === 'image') {
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

  const type = kind === 'audio' ? 'audio' : 'video';
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
    // sessionStorage can throw in private mode or when quota is exceeded —
    // carry the (small) payload in the query string instead of dead-clicking.
    const params = new URLSearchParams({ timeline: '1', mediaType: type, mediaUrl: artifactUrl });
    if (fileId) params.set('mediaFileId', fileId);
    go(`/media/designer?${params.toString()}`);
    return;
  }

  go('/media/designer?timeline=1');
}
