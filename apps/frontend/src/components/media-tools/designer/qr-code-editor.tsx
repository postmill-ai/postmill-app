'use client';

import React, { FC, useEffect, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { Textarea } from '@postmill-ai/react/form/textarea';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ColorSwatch, Stepper } from './controls';
import { DEFAULT_QR_CODE_SETTINGS, type QrCodeSettings } from './qr-code';

interface QrCodeEditorProps {
  initialSettings?: QrCodeSettings;
  submitLabel: string;
  onSubmit: (settings: QrCodeSettings) => Promise<void>;
  onCancel?: () => void;
}

export const QrCodeEditor: FC<QrCodeEditorProps> = ({
  initialSettings = DEFAULT_QR_CODE_SETTINGS,
  submitLabel,
  onSubmit,
  onCancel,
}) => {
  const t = useT();
  const [settings, setSettings] = useState<QrCodeSettings>({ ...initialSettings });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialSignature = JSON.stringify(initialSettings);

  useEffect(() => {
    setSettings(JSON.parse(initialSignature));
    setError('');
  }, [initialSignature]);

  const update = <K extends keyof QrCodeSettings>(key: K, value: QrCodeSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (!settings.value.trim()) {
      setError(t('designer_qr_value_required', 'Enter a URL or text for the QR code.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(settings);
    } catch (cause) {
      setError((cause as Error)?.message || t('designer_qr_generate_failed', 'Could not generate the QR code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        disableForm
        name="qr-value"
        label={t('designer_qr_value', 'URL or text')}
        translationKey="designer_qr_value"
        value={settings.value}
        onChange={(event) => update('value', event.target.value)}
        maxLength={2048}
        className="min-h-[84px] text-[12px]"
        placeholder={t('designer_qr_value_placeholder', 'https://example.com or plain text')}
      />
      <div className="grid grid-cols-2 gap-3">
        <ColorSwatch
          label={t('designer_qr_foreground', 'Code color')}
          value={settings.foreground}
          onChange={(value) => update('foreground', value)}
        />
        <ColorSwatch
          label={t('designer_qr_background', 'Background color')}
          value={settings.background}
          onChange={(value) => update('background', value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <label className="flex flex-col gap-1 text-[11px] text-textColor/60">
          {t('designer_qr_error_correction', 'Error correction')}
          <select
            aria-label={t('designer_qr_error_correction', 'Error correction')}
            value={settings.errorCorrection}
            onChange={(event) => update('errorCorrection', event.target.value as QrCodeSettings['errorCorrection'])}
            className="h-[32px] px-2 rounded-sm bg-newBgColor border border-studioBorder text-textColor"
          >
            <option value="L">L · 7%</option>
            <option value="M">M · 15%</option>
            <option value="Q">Q · 25%</option>
            <option value="H">H · 30%</option>
          </select>
        </label>
        <Stepper
          label={t('designer_qr_margin', 'Quiet zone')}
          value={settings.margin}
          min={0}
          max={8}
          onChange={(value) => update('margin', value)}
        />
      </div>
      <p className="text-[11px] text-textColor/50">
        {t('designer_qr_export_hint', 'The QR code is rendered as a high-resolution PNG and stays editable here.')}
      </p>
      {error && <div role="alert" className="text-[12px] text-dangerText">{error}</div>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button secondary onClick={onCancel}>
            {t('cancel', 'Cancel')}
          </Button>
        )}
        <Button loading={busy} onClick={submit}>{submitLabel}</Button>
      </div>
    </div>
  );
};
