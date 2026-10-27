import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

const toasterShowMock = vi.fn();
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: toasterShowMock }),
}));

let pickerOptions: any;
const pickerOpenMock = vi.fn();
vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: (options: unknown) => {
    pickerOptions = options;
    return { open: pickerOpenMock, element: null };
  },
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

const openModalMock = vi.fn();
const closeAllMock = vi.fn();
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: openModalMock, closeAll: closeAllMock }),
}));

// Capture the dialog's props instead of running the real recorder (mic,
// MediaRecorder and AudioContext have no place in jsdom — the dialog's own
// spec covers those).
let dialogProps: {
  title?: string;
  addLabel?: string;
  onClose: () => void;
  onAdd: (blob: Blob, mimeType: string) => void | Promise<void>;
} | null = null;
vi.mock(
  '@postmill-ai/frontend/components/media-tools/designer/voiceover-record-dialog',
  () => ({
    VoiceoverRecordDialog: (props: never) => {
      dialogProps = props;
      return null;
    },
  })
);

import { FileInput } from './file';

const stubMediaRecorder = () =>
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported() {
      return true;
    }
  });

beforeEach(() => {
  dialogProps = null;
  pickerOptions = null;
  openModalMock.mockReset();
  closeAllMock.mockReset();
  fetchMock.mockReset();
  toasterShowMock.mockReset();
  pickerOpenMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileInput voice recording', () => {
  it('offers ● Record on audio fields only', () => {
    stubMediaRecorder();
    const { unmount } = render(
      <FileInput acceptType="audio" label="Reference voice" onChange={vi.fn()} />
    );
    expect(screen.getByText('● Record')).toBeTruthy();
    unmount();

    render(<FileInput acceptType="image" label="Image" onChange={vi.fn()} />);
    expect(screen.queryByText('● Record')).toBeNull();
  });

  it('hides ● Record when MediaRecorder is unavailable', () => {
    render(<FileInput acceptType="audio" onChange={vi.fn()} />);
    expect(screen.queryByText('● Record')).toBeNull();
  });

  it('opens the record dialog with the voice-clone title and CTA', () => {
    stubMediaRecorder();
    render(<FileInput acceptType="audio" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('● Record'));

    expect(openModalMock).toHaveBeenCalledTimes(1);
    const { children } = openModalMock.mock.calls[0][0];
    render(<>{children}</>);
    expect(dialogProps?.title).toBe('Record voice');
    expect(dialogProps?.addLabel).toBe('Use recording');
  });

  it('uploads the take to /files/upload-simple and sets the field value', async () => {
    stubMediaRecorder();
    const onChange = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'file-9', path: '/uploads/org/2026/10/22/voice-9' }),
    });
    render(<FileInput acceptType="audio" onChange={onChange} />);
    fireEvent.click(screen.getByText('● Record'));
    render(<>{openModalMock.mock.calls[0][0].children}</>);

    await dialogProps!.onAdd!(new Blob(['take'], { type: 'audio/webm' }), 'audio/webm;codecs=opus');

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/files/upload-simple');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(onChange).toHaveBeenCalledWith({
      fileId: 'file-9',
      url: '/uploads/org/2026/10/22/voice-9',
      type: 'audio',
    });
  });

  it('a failed upload rethrows so the dialog stays open with the take intact', async () => {
    stubMediaRecorder();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'boom' }),
      text: async () => 'boom',
    });
    render(<FileInput acceptType="audio" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('● Record'));
    render(<>{openModalMock.mock.calls[0][0].children}</>);

    await expect(
      dialogProps!.onAdd!(new Blob(['take'], { type: 'audio/webm' }), 'audio/webm')
    ).rejects.toThrow();
  });
});

describe('FileInput multi-file selection', () => {
  const item = (id: string) => ({ fileId: id, url: `/uploads/${id}.png`, type: 'image' as const });

  it('uses the multi-file picker and preserves selection order as a true array', () => {
    const onChange = vi.fn();
    render(<FileInput multiple maxFiles={3} acceptType="image" onChange={onChange} />);

    expect(pickerOptions).toMatchObject({ multiple: true, requireFile: true });
    pickerOptions.onConfirm([item('f2'), item('f1'), item('f3')]);
    expect(onChange).toHaveBeenCalledWith([
      { fileId: 'f2', url: '/uploads/f2.png', type: 'image' },
      { fileId: 'f1', url: '/uploads/f1.png', type: 'image' },
      { fileId: 'f3', url: '/uploads/f3.png', type: 'image' },
    ]);
  });

  it('rejects an oversized batch without truncating or changing the value', () => {
    const onChange = vi.fn();
    render(<FileInput multiple maxFiles={3} acceptType="image" onChange={onChange} />);

    pickerOptions.onConfirm([item('f1'), item('f2'), item('f3'), item('f4')]);
    expect(onChange).not.toHaveBeenCalled();
    expect(toasterShowMock).toHaveBeenCalledWith('Choose up to 3 files.', 'warning');
  });

  it('supports clearing all files and removing one item', () => {
    const onChange = vi.fn();
    render(
      <FileInput
        multiple
        maxFiles={3}
        acceptType="image"
        value={[item('f1'), item('f2')]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove file' })[0]);
    expect(onChange).toHaveBeenLastCalledWith([item('f2')]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear files' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('keeps the existing single-file picker behavior', () => {
    const onChange = vi.fn();
    render(<FileInput acceptType="image" onChange={onChange} />);

    expect(pickerOptions.multiple).toBeUndefined();
    pickerOptions.onSelect(item('single'));
    expect(onChange).toHaveBeenCalledWith(item('single'));
  });
});
