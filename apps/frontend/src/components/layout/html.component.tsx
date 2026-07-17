'use client';
import { FC, ReactNode, useEffect, useState } from 'react';
import { useTranslationSettings } from '@gitroom/react/translation/get.transation.service.client';

export const HtmlComponent: FC = () => {
  const settings = useTranslationSettings();
  const [dir, setDir] = useState(settings.dir());

  useEffect(() => {
    const handler = (lng: string) => {
      setDir(settings.dir());
    };
    settings.on('languageChanged', handler);

    return () => {
      settings.off('languageChanged', handler);
    };
  }, [settings]);

  useEffect(() => {
    const htmlElement = document.querySelector('html');
    if (htmlElement) {
      htmlElement.setAttribute('dir', dir);
    }
  }, [dir]);

  return null;
};
