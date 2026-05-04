import { useTranslation } from 'react-i18next';

interface BrandHeroProps {
  logoSize?: number;
  className?: string;
}

const BASE = import.meta.env.BASE_URL;

export function BrandHero({ logoSize = 64, className = '' }: BrandHeroProps) {
  const { t } = useTranslation('common');

  return (
    <div className={`inline-flex items-center gap-4 ${className}`}>
      <img
        src={`${BASE}logo.png`}
        alt="Ant"
        width={logoSize}
        height={logoSize}
        className="drop-shadow-[0_0_20px_rgba(251,146,60,0.15)]"
      />
      <span className="text-2xl sm:text-3xl font-display font-bold text-gray-900 dark:text-white tracking-tight">
        {t('brand.prefix')}<span className="text-orange-400">{t('brand.highlight')}</span>{t('brand.suffix')}
      </span>
    </div>
  );
}
