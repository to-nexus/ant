'use client';

import { useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n from './i18n';

function TitleSync() {
  const { t, i18n: { language } } = useTranslation();

  useEffect(() => {
    document.title = t('tabTitle');
  }, [language, t]);

  return null;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <TitleSync />
      {children}
    </I18nextProvider>
  );
}
