'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  cookieName,
  fallbackLng,
  languages,
} from '@gitroom/react/translation/i18n.config';
import i18next from 'i18next';
import useCookie from 'react-use-cookie';
import ReactCountryFlag from 'react-country-flag';
import React, { useCallback } from 'react';
import countries from 'i18n-iso-countries';

// Register required locales
import countriesEn from 'i18n-iso-countries/langs/en.json';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ModalWrapperComponent } from '../composer/modal.wrapper.component';

import clsx from 'clsx';
countries.registerLocale(countriesEn);

const getCountryCodeForFlag = (languageCode: string) => {
  // For multi-region languages, here are some common defaults
  if (languageCode === 'en') return 'GB';
  if (languageCode === 'es') return 'ES';
  if (languageCode === 'ar') return 'SA';
  if (languageCode === 'zh') return 'CN';
  if (languageCode === 'ja') return 'JP';
  if (languageCode === 'ko') return 'KR';
  if (languageCode === 'vi') return 'VN';

  // Check if language code itself is a valid country code
  try {
    const countryName = countries.getName(languageCode.toUpperCase(), 'en');
    if (countryName) {
      return languageCode.toUpperCase();
    }
  } catch (e) {
    // Not a valid country code, continue to next approach
  }

  // Try to extract region code if language code has a region component (e.g., en-US)
  const parts = languageCode.split('-');
  if (parts.length > 1) {
    const regionCode = parts[1].toUpperCase();
    try {
      const countryName = countries.getName(regionCode, 'en');
      if (countryName) {
        return regionCode;
      }
    } catch (e) {
      // Not a valid country code, continue to next approach
    }
  }

  // For most language codes that match their primary country
  // Examples: fr->FR, it->IT, de->DE, etc.
  return languageCode.toUpperCase();
};

export const ChangeLanguageComponent = () => {
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const availableLanguages = languages;
  const [_, setCookie] = useCookie(cookieName, currentLanguage || fallbackLng);
  const modals = useModals();
  const t = useT();

  const handleLanguageChange = (language: string) => {
    setCookie(language);
    i18next.changeLanguage(language);
    modals.closeCurrent();
    const rtlLanguages = ['ar'];
    const dir = rtlLanguages.includes(language) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
  };

  // Function to get language name in its native script
  const getLanguageName = useCallback((code: string) => {
    try {
      // Use browser's Intl API to get language name in native script
      const displayNames = new Intl.DisplayNames([code], {
        type: 'language',
      });
      return displayNames.of(code);
    } catch (error) {
      // Fallback to language code if the API isn't supported or language is not found
      return code;
    }
  }, []);

  return (
    <div className="relative">
      <div className="grid grid-cols-4 gap-2">
        {availableLanguages.map((language) => (
          <div
            className={clsx(
              'flex items-center flex-col bg-newTableHeader hover:bg-newTableBorder p-[20px] cursor-pointer gap-2',
              language === currentLanguage ? 'border border-textColor' : ''
            )}
            key={language}
            onClick={() => handleLanguageChange(language)}
          >
            <ReactCountryFlag
              countryCode={getCountryCodeForFlag(language)}
              svg
              style={{
                width: '1.5em',
                height: '1.5em',
              }}
              title={language}
            />
            <span
              className={clsx(
                'text-[13px]',
                language === currentLanguage ? 'font-bold' : 'font-normal'
              )}
            >
              {getLanguageName(language)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
// Full-width menu row variant (flag + label) used inside the user avatar dropdown,
// styled to match the other menu items. `onOpen` lets the host close the dropdown.
export const LanguageMenuRow = ({ onOpen }: { onOpen?: () => void }) => {
  const modal = useModals();
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const t = useT();
  const openModal = () => {
    onOpen?.();
    modal.openModal({
      title: t('change_language', 'Change Language'),
      withCloseButton: true,
      children: <ChangeLanguageComponent />,
    });
  };
  return (
    <button
      type="button"
      role="menuitem"
      onClick={openModal}
      className="w-full flex items-center gap-[10px] px-[14px] py-[8px] text-[13px] text-textColor hover:bg-boxHover text-start"
    >
      <span className="rounded-full overflow-hidden h-[18px] w-[18px] relative shrink-0">
        <ReactCountryFlag
          countryCode={getCountryCodeForFlag(currentLanguage)}
          svg
          style={{
            width: '18px',
            height: '18px',
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            objectFit: 'cover',
          }}
          title={currentLanguage}
        />
      </span>
      {t('language', 'Language')}
    </button>
  );
};
export const LanguageComponent = () => {
  const modal = useModals();
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const t = useT();
  const openModal = () => {
    modal.openModal({
      title: t('change_language', 'Change Language'),
      withCloseButton: true,
      children: <ChangeLanguageComponent />,
    });
  };
  return (
    <div
      onClick={openModal}
      className="rounded-full overflow-hidden h-[22px] w-[22px] relative cursor-pointer"
    >
      <ReactCountryFlag
        countryCode={getCountryCodeForFlag(currentLanguage)}
        svg
        style={{
          width: '22px',
          height: '22px',
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          objectFit: 'cover',
        }}
        title={currentLanguage}
      />
    </div>
  );
};
