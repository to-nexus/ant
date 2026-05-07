'use client';

import { useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n, { applyStoredLanguage } from './i18n';

function TitleSync() {
  const { t, i18n: { language } } = useTranslation();

  useEffect(() => {
    document.title = t('tabTitle');
  }, [language, t]);

  return null;
}

// Static-export HTML is generated with `lng: 'en'`. After hydration we
// read the user's saved choice from localStorage and switch — running
// this from `useEffect` (post-paint) is what keeps the server HTML and
// the FIRST client render in lockstep so React doesn't throw a hydration
// mismatch on every translated string.
function StoredLanguageSync() {
  useEffect(() => {
    applyStoredLanguage();
  }, []);
  return null;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <StoredLanguageSync />
      <TitleSync />
      {children}
    </I18nextProvider>
  );
}
