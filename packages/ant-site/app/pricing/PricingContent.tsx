'use client';

import { useTranslation } from 'react-i18next';
import { PageHero } from '@/components/PageHero';
import { PricingTable } from '@/components/PricingTable';

export default function PricingContent() {
  const { t } = useTranslation('site');

  return (
    <>
      <PageHero
        title={t('pricing.heroTitle1')}
        highlight={t('pricing.heroTitle2')}
        description={t('pricing.heroDesc')}
        accent="teal"
      />
      <PricingTable />
    </>
  );
}
