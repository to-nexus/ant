import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English locale imports
import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enChat from './locales/en/chat.json';
import enConfig from './locales/en/config.json';
import enKanban from './locales/en/kanban.json';
import enArtifacts from './locales/en/artifacts.json';
import enTransfer from './locales/en/transfer.json';
import enAuth from './locales/en/auth.json';
import enExplorer from './locales/en/explorer.json';

// Korean locale imports
import koCommon from './locales/ko/common.json';
import koNav from './locales/ko/nav.json';
import koChat from './locales/ko/chat.json';
import koConfig from './locales/ko/config.json';
import koKanban from './locales/ko/kanban.json';
import koArtifacts from './locales/ko/artifacts.json';
import koTransfer from './locales/ko/transfer.json';
import koAuth from './locales/ko/auth.json';
import koExplorer from './locales/ko/explorer.json';

export const SUPPORTED_LANGUAGES = ['en', 'ko'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  ko: '한국어',
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        nav: enNav,
        chat: enChat,
        config: enConfig,
        kanban: enKanban,
        artifacts: enArtifacts,
        transfer: enTransfer,
        auth: enAuth,
        explorer: enExplorer,
      },
      ko: {
        common: koCommon,
        nav: koNav,
        chat: koChat,
        config: koConfig,
        kanban: koKanban,
        artifacts: koArtifacts,
        transfer: koTransfer,
        auth: koAuth,
        explorer: koExplorer,
      },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'nav', 'chat', 'config', 'kanban', 'artifacts', 'transfer', 'auth', 'explorer'],
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
