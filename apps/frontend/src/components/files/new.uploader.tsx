'use client';
import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import Uppy, { BasePlugin, UploadResult, UppyFile } from '@uppy/core';
// @ts-ignore
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { Dashboard } from '@uppy/react';

import { useVariables } from '@gitroom/react/helpers/variable.context';
import Compressor from '@uppy/compressor';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { uniqBy } from 'lodash';
import { checkUploadLimit } from '@gitroom/helpers/upload-limits.client';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const MB = 1024 * 1024;
const GB = 1024 * MB;

type UploadLimits = {
  maxBytes: number;
  image: { maxBytes: number };
  video: { maxBytes: number };
  audio: { maxBytes: number };
};

const DEFAULT_LIMITS: UploadLimits = {
  maxBytes: 1 * GB,
  image: { maxBytes: 10 * MB },
  video: { maxBytes: 1 * GB },
  audio: { maxBytes: 50 * MB },
};

export class CompressionWrapper<M = any, B = any> extends Compressor<any, any> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();

    // 1) Skip GIFs (and anything missing)
    const filteredIDs = fileIDs.filter((id) => {
      const f = files[id];
      if (!f) return false;

      const type = f.type ?? '';
      const name = (f.name ?? '').toLowerCase();
      const isGif = type === 'image/gif' || name.endsWith('.gif');

      return !isGif;
    });

    // 2) Let @uppy/compressor do its work (convert/resize/etc)
    return super.prepareUpload(filteredIDs);
  }
}

export function useUppyUploader(props: {
  // @ts-ignore
  onUploadSuccess: (result: UploadResult) => void;
  onStart: () => void;
  onEnd: () => void;
  allowedFileTypes: string;
  folderId?: string | null;
}) {
  const { onUploadSuccess, allowedFileTypes, folderId, onStart, onEnd } = props;
  const setLocked = useLaunchStore((state) => state.setLocked);
  const toast = useToaster();
  const t = useT();
  const { backendUrl, disableImageCompression, transloadit } =
    useVariables();
  const fetch = useFetch();

  // Mutable refs for every value the Uppy callbacks/preprocessors close over.
  // This lets us keep a single Uppy instance across renders and reconfigure it
  // explicitly rather than recreating it whenever a dependency changes.
  const limitsRef = useRef<UploadLimits>(DEFAULT_LIMITS);
  const allowedFileTypesRef = useRef(allowedFileTypes);
  const folderIdRef = useRef(folderId);
  const callbacksRef = useRef({ onUploadSuccess, onStart, onEnd });
  const backendUrlRef = useRef(backendUrl);
  const disableImageCompressionRef = useRef(disableImageCompression);
  const transloaditRef = useRef(transloadit);
  const fetchRef = useRef(fetch);
  const toastRef = useRef(toast);
  const setLockedRef = useRef(setLocked);
  const tRef = useRef(t);

  allowedFileTypesRef.current = allowedFileTypes;
  folderIdRef.current = folderId;
  callbacksRef.current = { onUploadSuccess, onStart, onEnd };
  backendUrlRef.current = backendUrl;
  disableImageCompressionRef.current = disableImageCompression;
  transloaditRef.current = transloadit;
  fetchRef.current = fetch;
  toastRef.current = toast;
  setLockedRef.current = setLocked;
  tRef.current = t;

  const uppyRef = useRef<Uppy | null>(null);

  // Fetch the shared server limits once on mount and update the live Uppy
  // restriction so the client pre-check can never drift from the server pipe.
  useEffect(() => {
    fetch('/files/limits')
      .then((res) => res.json())
      .then((data: UploadLimits) => {
        limitsRef.current = data;
        if (uppyRef.current) {
          // @ts-ignore
          uppyRef.current.setOptions({
            restrictions: { maxFileSize: data.maxBytes },
          });
        }
      })
      .catch(() => {
        // Keep the safe defaults on failure rather than blocking uploads.
      });
  }, [fetch]);

  if (!uppyRef.current) {
    // Track file order to maintain original sequence after upload
    let fileOrderIndex = 0;

    const uppy = new Uppy({
      autoProceed: true,
      restrictions: {
        maxFileSize: DEFAULT_LIMITS.maxBytes,
      },
    });

    // check for valid file types it can be something like this image/*,video/mp4.
    // If it's an image, I need to replace image/* with image/png, image/jpeg, image/jpeg, image/gif (separately)
    uppy.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy.getFiles();
        const allowedTypes = allowedFileTypesRef.current
          .split(',')
          .map((type) => type.trim());

        // Expand generic types to specific ones
        const expandedTypes = allowedTypes.flatMap((type) => {
          if (type === 'image/*') {
            return [
              'image/png',
              'image/jpeg',
              'image/jpg',
              'image/gif',
              'image/webp',
            ];
          }
          if (type === 'video/*') {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          if (type === 'video/mp4' && transloaditRef.current && transloaditRef.current.length > 0) {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          return [type];
        });

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const fileType = file.type;

            // Check if file type is allowed
            const isAllowed = expandedTypes.some((allowedType) => {
              if (allowedType.endsWith('/*')) {
                const baseType = allowedType.replace('/*', '/');
                return fileType?.startsWith(baseType);
              }
              return fileType === allowedType;
            });

            if (!isAllowed) {
              const error = new Error(
                tRef.current(
                  'file_type_not_allowed_for_file',
                  'File type "{{fileType}}" is not allowed for file "{{fileName}}". Allowed types: {{allowedTypes}}',
                  { fileType, fileName: file.name, allowedTypes: allowedFileTypesRef.current }
                )
              );
              uppy.log(error.message, 'error');
              uppy.info(error.message, 'error', 5000);
              toastRef.current.show(
                tRef.current(
                  'file_type_not_allowed',
                  'File type "{{fileType}}" is not allowed. Allowed types: {{allowedTypes}}',
                  { fileType, allowedTypes: allowedFileTypesRef.current }
                ),
                'warning'
              );
              uppy.removeFile(file.id);
              return reject(error);
            }
          }
        }

        resolve();
      });
    });

    uppy.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy.getFiles();
        const limits = limitsRef.current;

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const limitCheck = checkUploadLimit(
              { size: file.size, mimetype: file.type || '' },
              limits,
            );
            if (limitCheck.ok) {
              continue;
            }

            const maxBytes = file.type?.startsWith('image/')
              ? limits.image.maxBytes
              : file.type?.startsWith('video/')
                ? limits.video.maxBytes
                : limits.audio.maxBytes;
            const maxMB = Math.round(maxBytes / MB);
            const error = new Error(
              tRef.current(
                'file_upload_limit_exceeded',
                'File "{{fileName}}" {{reason}}',
                { fileName: file.name, reason: limitCheck.reason }
              )
            );
            uppy.log(error.message, 'error');
            uppy.info(error.message, 'error', 5000);
            toastRef.current.show(
              tRef.current(
                'upload_max_size_toast',
                'Maximum size allowed is {{size}}MB.',
                { size: maxMB }
              ),
              'warning'
            );
            uppy.removeFile(file.id); // Remove file from queue
            return reject(error);
          }
        }

        resolve();
      });
    });

    const { plugin, options } = getUppyUploadPlugin(
      transloaditRef.current.length > 0 ? 'transloadit' : 'local',
      fetchRef.current,
      backendUrlRef.current,
      transloaditRef.current
    );

    uppy.use(plugin, options);
    if (!disableImageCompressionRef.current) {
      uppy.use(CompressionWrapper, {
        convertTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 1,
      });
    }
    // Set additional metadata when a file is added
    uppy.on('file-added', (file) => {
      setLockedRef.current(true);
      uppy.setFileMeta(file.id, {
        addedOrder: fileOrderIndex++, // Track original order for sorting after upload
        folderId: folderIdRef.current ?? undefined,
      });
    });
    uppy.on('error', (result) => {
      uppy.clear();
      setLockedRef.current(false);
      callbacksRef.current.onEnd();
      fileOrderIndex = 0;
    });
    uppy.on('upload-start', () => {
      callbacksRef.current.onStart();
    });
    uppy.on('complete', async (result) => {
      for (const file of [...result.successful]) {
        uppy.removeFile(file.id);
      }

      callbacksRef.current.onEnd();
      // Sort results by original add order to maintain file sequence
      const sortedSuccessful = [...result.successful].sort((a, b) => {
        const orderA = +((a.meta as any)?.addedOrder ?? 0);
        const orderB = +((b.meta as any)?.addedOrder ?? 0);
        return orderA - orderB;
      });

      if (transloaditRef.current.length > 0) {
        // @ts-ignore
        const allRes = result.transloadit[0].results;
        const toSave = uniqBy<{ name: string; originalName: string; path: string; order: number }>(
          // @ts-ignore
          Object.values(allRes).flatMap((p: any[]) => {
            return p.flatMap((item) => ({
              name: item.url.split('/').pop(),
              originalName: item.name || '',
              path: item.url,
              order: +item.user_meta.addedOrder,
            }));
          }),
          (item) => item.name
        );

        const loadAllMedia = (
          await Promise.all(
            toSave.map(async ({ name, path, originalName, order }) => ({
              file: await (
                await fetchRef.current('/files/save-media', {
                  method: 'POST',
                  body: JSON.stringify({
                    name,
                    originalName,
                    path,
                  }),
                })
              ).json(),
              order,
            }))
          )
        )
          .sort((a, b) => {
            return a.order - b.order;
          })
          .map((p) => p.file);

        setLockedRef.current(false);
        fileOrderIndex = 0;
        callbacksRef.current.onUploadSuccess(loadAllMedia);
        return;
      }

      setLockedRef.current(false);
      fileOrderIndex = 0;
      callbacksRef.current.onUploadSuccess(sortedSuccessful.map((p) => p.response.body));
    });
    uppy.on('upload-success', (file, response) => {
      // @ts-ignore
      uppy.setFileState(file.id, {
        // @ts-ignore
        progress: uppy.getState().files[file.id].progress,
        // @ts-ignore
        uploadURL: response.body.Location,
        response: response,
        isPaused: false,
      });
    });
    uppyRef.current = uppy;
  }

  return uppyRef.current;
}
