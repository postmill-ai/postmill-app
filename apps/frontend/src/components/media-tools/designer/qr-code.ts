import { toDataURL } from 'qrcode';
import type { DesignerElement } from './designer.store';
import { addImageClipToTimeline } from './add-media-to-timeline';

export type QrCodeSettings = NonNullable<DesignerElement['qr']>;
type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const DEFAULT_QR_CODE_SETTINGS: QrCodeSettings = {
  value: '',
  foreground: '#000000',
  background: '#FFFFFF',
  errorCorrection: 'M',
  margin: 4,
};

const normalizeQrColor = (value: string): string => {
  const hex = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9A-F]{8}$/.test(hex)) return hex.slice(0, 7);
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  throw new Error('QR code colors must be three, six, or eight digit hex values.');
};

export const normalizeQrCodeSettings = (settings: QrCodeSettings): QrCodeSettings => ({
  ...settings,
  value: settings.value.trim(),
  foreground: normalizeQrColor(settings.foreground),
  background: normalizeQrColor(settings.background),
});

export const generateQrCode = async (settings: QrCodeSettings): Promise<string> => {
  const normalized = normalizeQrCodeSettings(settings);
  if (!normalized.value) throw new Error('QR code content is required.');
  return toDataURL(normalized.value, {
    errorCorrectionLevel: normalized.errorCorrection,
    margin: normalized.margin,
    width: 1024,
    color: {
      dark: normalized.foreground,
      light: normalized.background,
    },
  });
};

export const qrCodePatch = async (
  settings: QrCodeSettings
): Promise<Pick<DesignerElement, 'src' | 'qr' | 'fileId' | 'naturalWidth' | 'naturalHeight'>> => ({
  src: await generateQrCode(settings),
  qr: normalizeQrCodeSettings(settings),
  fileId: undefined,
  naturalWidth: 1024,
  naturalHeight: 1024,
});

export const insertQrCode = async (
  store: Store,
  settings: QrCodeSettings,
  name = 'QR code'
): Promise<boolean> => {
  const patch = await qrCodePatch(settings);
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput];
  if (!output) return false;

  if (state.doc.mode === 'video') {
    const clipId = addImageClipToTimeline(store, {
      url: patch.src!,
      qr: patch.qr,
      width: 1024,
      height: 1024,
      square: true,
    });
    const selected = store.getState().selectedClip;
    return !!clipId && selected?.clipId === clipId;
  }

  const side = Math.round(Math.min(output.width, output.height) * 0.25);
  state.addElement({
    id: '',
    type: 'image',
    name,
    x: Math.round((output.width - side) / 2),
    y: Math.round((output.height - side) / 2),
    width: side,
    height: side,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fitMode: 'contain',
    alt: name,
    ...patch,
  });
  return true;
};
