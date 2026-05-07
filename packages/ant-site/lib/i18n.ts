import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ko from '@/locales/ko.json';
import en from '@/locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'ko'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  ko: '한국어',
};

export const LANGUAGE_STORAGE_KEY = 'ant-ui:language';

// Initial language is hard-coded to `en` so that
//   (a) the static-exported HTML (built with `next build` on a server
//       that has no `localStorage`), and
//   (b) the very first client render
// agree. After hydration, `I18nProvider` reads `localStorage` and calls
// `applyStoredLanguage()` to switch — that re-render happens post-hydration
// and is therefore allowed to differ from the server HTML.
i18n.use(initReactI18next).init({
  resources: {
    ko: { site: ko },
    en: { site: en },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'site',
  ns: ['site'],
  interpolation: {
    escapeValue: false,
  },
});

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Read the user's preferred language from localStorage and apply it.
 * Safe to call from a `useEffect` — silently no-ops on the server or
 * when storage is unavailable / blocked. Returns the language that
 * ended up active.
 */
export function applyStoredLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return i18n.language as SupportedLanguage;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupportedLanguage(stored) && stored !== i18n.language) {
      i18n.changeLanguage(stored);
    }
  } catch {
    // localStorage blocked — leave i18n at its default.
  }
  return i18n.language as SupportedLanguage;
}

/**
 * Persist + switch language. Used by the GNB language picker.
 */
export function setLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore — language change still applies for this session.
  }
}

export default i18n;
