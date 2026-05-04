'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

export function SiteFooter() {
  const { t } = useTranslation('site');

  const FOOTER_LINKS = [
    { label: t('nav.product'), href: '/' },
    { label: t('nav.figma'), href: '/figma' },
    { label: t('nav.capabilities'), href: '/capabilities' },
    { label: t('nav.pricing'), href: '/pricing' },
    { label: t('nav.download'), href: '/download' },
  ];

  return (
    <footer className="border-t border-white/5 bg-[#060910]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src="/logo.png" alt="ANT" className="w-7 h-7" />
              <span className="text-base font-display font-bold text-white">ANT</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">
              {t('footer.tagline')}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('footer.pages')}</h3>
            <ul className="space-y-2">
              {FOOTER_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('footer.links')}</h3>
            <ul className="space-y-2">
              <li>
                <a href="https://github.com/to-nexus/ant" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  GitHub
                </a>
              </li>
              <li>
                <Link href="/legal/terms-of-use" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  {t('footer.terms')}
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy-policy" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  {t('footer.privacy')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/5 text-center">
          <p className="text-xs text-gray-600">
            &copy; {new Date().getFullYear()} NEXUS. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
