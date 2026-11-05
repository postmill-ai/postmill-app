'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { QrCodeEditor } from '../qr-code-editor';
import { qrCodePatch, type QrCodeSettings } from '../qr-code';

export const QrCodeControls: FC<{
  settings: QrCodeSettings;
  onApply: (patch: Awaited<ReturnType<typeof qrCodePatch>>) => void;
}> = ({ settings, onApply }) => {
  const t = useT();
  return (
    <section className="space-y-2 border-t border-studioBorder pt-3">
      <h3 className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_qr_title', 'QR code')}
      </h3>
      <QrCodeEditor
        initialSettings={settings}
        submitLabel={t('designer_qr_apply', 'Update QR code')}
        onSubmit={async (next) => onApply(await qrCodePatch(next))}
      />
    </section>
  );
};
