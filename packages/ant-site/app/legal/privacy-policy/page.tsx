'use client';

import { useTranslation } from 'react-i18next';

export default function PrivacyPolicyPage() {
  const { t } = useTranslation('site');

  return (
    <section className="pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-white mb-8">
          {t('legal.privacyTitle')}
        </h1>
        <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/5">
          <p className="text-gray-400 leading-relaxed whitespace-pre-line">{t('legal.privacyBody')}</p>
        </div>
      </div>
    </section>
  );
}
