'use client';

import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/aurora/GlassCard';

export default function PrivacyPolicyPage() {
  const { t } = useTranslation('site');

  return (
    <section className="pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-display" style={{ fontSize: 'clamp(32px, 5vw, 44px)', color: 'var(--text-1)', marginBottom: 28 }}>
          {t('legal.privacyTitle')}
        </h1>
        <GlassCard padding="xl">
          <p className="whitespace-pre-line" style={{ color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', fontSize: 15 }}>
            {t('legal.privacyBody')}
          </p>
        </GlassCard>
      </div>
    </section>
  );
}
