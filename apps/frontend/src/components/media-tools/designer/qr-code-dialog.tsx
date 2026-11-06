'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { QrCodeEditor } from './qr-code-editor';
import { insertQrCode } from './qr-code';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const QrCodeDialog: FC<{ store: Store; onClose: () => void }> = ({ store, onClose }) => {
  const t = useT();
  return (
    <QrCodeEditor
      submitLabel={t('designer_qr_insert', 'Insert QR code')}
      onCancel={onClose}
      onSubmit={async (settings) => {
        if (await insertQrCode(store, settings, t('designer_qr_title', 'QR code'))) onClose();
      }}
    />
  );
};
