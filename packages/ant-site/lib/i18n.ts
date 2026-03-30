import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ko from '@/locales/ko.json';
import en from '@/locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'ko'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  ko: '한국어',
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: { site: ko },
      en: { site: en },
    },
    fallbackLng: 'ko',
    defaultNS: 'site',
    ns: ['site'],
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'ant-ui:language',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
