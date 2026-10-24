import type { FileItem } from './file-manager';

export type FileMediaKind = 'image' | 'video' | 'audio' | null;

export type FilePresentation = {
  isDesign: boolean;
  mediaKind: FileMediaKind;
  designKind: 'design' | 'template';
  designMode: 'image' | 'video' | null;
  canOpenInDesigner: boolean;
  hasVideoDuration: boolean;
  preview: {
    kind: 'image' | 'video' | 'audio' | 'fallback';
    src: string | null;
    thumbnail: string | null;
  };
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a'];

const extensionOf = (value: string | null | undefined) => {
  const path = (value || '').split(/[?#]/, 1)[0].toLowerCase();
  const name = path.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
};

const hasAnyExtension = (file: FileItem, extensions: string[]) =>
  [file.path, file.name, file.originalName].some((value) => extensions.includes(extensionOf(value)));

export const isDesignFile = (file: FileItem) =>
  extensionOf(file.path) === 'pdesign' ||
  extensionOf(file.name) === 'pdesign' ||
  extensionOf(file.originalName) === 'pdesign';

export const getFileMediaKind = (file: FileItem): FileMediaKind => {
  if (isDesignFile(file)) return null;
  const types = [file.type, file.metadata?.mimeType]
    .filter((type): type is string => Boolean(type))
    .map((type) => type.toLowerCase());
  if (types.some((type) => type === 'image' || type.startsWith('image/')) || hasAnyExtension(file, IMAGE_EXTENSIONS)) {
    return 'image';
  }
  if (types.some((type) => type === 'video' || type.startsWith('video/')) || hasAnyExtension(file, VIDEO_EXTENSIONS)) {
    return 'video';
  }
  if (types.some((type) => type === 'audio' || type.startsWith('audio/')) || hasAnyExtension(file, AUDIO_EXTENSIONS)) {
    return 'audio';
  }
  return null;
};

export const isValidDurationMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const formatVideoDuration = (durationMs: unknown) => {
  if (!isValidDurationMs(durationMs)) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
};

export const getFilePresentation = (file: FileItem): FilePresentation => {
  const isDesign = isDesignFile(file);
  const mediaKind = getFileMediaKind(file);
  const designMode = file.metadata?.mode === 'image' || file.metadata?.mode === 'video'
    ? file.metadata.mode
    : null;
  const thumbnail = file.thumbnail || null;
  const preview = isDesign
    ? { kind: thumbnail ? 'image' as const : 'fallback' as const, src: thumbnail, thumbnail }
    : mediaKind === 'image'
    ? { kind: 'image' as const, src: thumbnail || file.path, thumbnail }
    : mediaKind === 'video'
    ? { kind: 'video' as const, src: file.path, thumbnail }
    : mediaKind === 'audio'
    ? { kind: 'audio' as const, src: file.path, thumbnail }
    : { kind: 'fallback' as const, src: null, thumbnail: null };

  return {
    isDesign,
    mediaKind,
    designKind: file.metadata?.kind === 'template' ? 'template' : 'design',
    designMode,
    canOpenInDesigner: isDesign || mediaKind !== null,
    hasVideoDuration: mediaKind === 'video' || (isDesign && designMode === 'video'),
    preview,
  };
};

export const getDesignLabel = (file: FileItem) => {
  const { designKind, designMode } = getFilePresentation(file);
  if (designKind === 'template') {
    if (designMode === 'image') return { key: 'image_template', fallback: 'Image template' };
    if (designMode === 'video') return { key: 'video_template', fallback: 'Video template' };
    return { key: 'template_file', fallback: 'Template file' };
  }
  if (!file.metadata?.kind && designMode === 'image') {
    return { key: 'image_design_file', fallback: 'Image design file' };
  }
  if (!file.metadata?.kind && designMode === 'video') {
    return { key: 'video_design_file', fallback: 'Video design file' };
  }
  if (designMode === 'image') return { key: 'image_design', fallback: 'Image design' };
  if (designMode === 'video') return { key: 'video_design', fallback: 'Video design' };
  return { key: 'design_file', fallback: 'Design file' };
};
