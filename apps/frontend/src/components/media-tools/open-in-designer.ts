import type { GeneratedMediaMetadata } from './studio-kit/types';

interface OpenInDesignerArgs {
  operation: string;
  artifactUrl?: string | null;
  fileId?: string | null;
  // Content-classified type of the stored File, when the caller has it (render
  // queues). Trusted over `operation`: a video-operation job can land an image
  // artifact (e.g. a Reel.Farm slideshow completed without a video export), and
  // an image must land on the static canvas, not the video timeline.
  fileType?: string | null;
  metadata?: GeneratedMediaMetadata | null;
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
const positiveNumber = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

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
    metadata,
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

  const safeWidth = positiveNumber(metadata?.dimensions?.width ?? width);
  const safeHeight = positiveNumber(metadata?.dimensions?.height ?? height);
  const safeDurationMs = positiveNumber(metadata?.durationMs);
  if (kind === 'image') {
    const params = new URLSearchParams({ url: artifactUrl, type: 'photo' });
    if (source) params.set('source', source);
    if (author) params.set('author', author);
    if (authorUrl) params.set('authorUrl', authorUrl);
    if (downloadLocation) params.set('downloadLocation', downloadLocation);
    if (thumbUrl) params.set('thumbUrl', thumbUrl);
    if (safeWidth) params.set('w', String(safeWidth));
    if (safeHeight) params.set('h', String(safeHeight));
    if (naturalWidth) params.set('nw', String(naturalWidth));
    if (naturalHeight) params.set('nh', String(naturalHeight));
    go(`/media/designer?${params.toString()}`);
    return;
  }

  const type = kind === 'audio' ? 'audio' : 'video';
  const payload = {
    type,
    url: artifactUrl,
    fileId: fileId ?? undefined,
    width: safeWidth,
    height: safeHeight,
    durationMs: safeDurationMs,
  };
  const openQueryFallback = () => {
    const params = new URLSearchParams({ timeline: '1', mediaType: type, mediaUrl: artifactUrl });
    if (fileId) params.set('mediaFileId', fileId);
    if (safeWidth) params.set('mediaWidth', String(safeWidth));
    if (safeHeight) params.set('mediaHeight', String(safeHeight));
    if (safeDurationMs) params.set('mediaDurationMs', String(safeDurationMs));
    go(`/media/designer?${params.toString()}`);
  };

  if (navigate) {
    try {
      window.sessionStorage.setItem(DESIGNER_HANDOFF_KEY, JSON.stringify(payload));
    } catch {
      openQueryFallback();
      return;
    }
    go('/media/designer?timeline=1');
    return;
  }

  try {
    const handoffId = window.crypto.randomUUID();
    window.localStorage.setItem(
      `${DESIGNER_HANDOFF_KEY}:${handoffId}`,
      JSON.stringify({ ...payload, expiresAt: Date.now() + 5 * 60 * 1000 })
    );
    const params = new URLSearchParams({ timeline: '1', handoff: handoffId });
    go(`/media/designer?${params.toString()}`);
  } catch {
    openQueryFallback();
  }
}
