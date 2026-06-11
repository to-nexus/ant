'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { LicenseBadge } from '@/components/LicenseBadge';
import { BrandLogo } from '@/components/aurora/BrandLogo';
import {
  GITHUB_URL,
  GITHUB_DISCUSSIONS_URL,
  GITHUB_ISSUES_URL,
  GITHUB_RELEASES_URL,
  GITHUB_ROADMAP_URL,
  GITHUB_CONTRIBUTING_URL,
  GITHUB_CODE_OF_CONDUCT_URL,
  GITHUB_SECURITY_URL,
  GITHUB_LICENSE_URL,
  DOCS_URL,
  LICENSE_NAME,
  ORG_NAME,
} from '@/lib/links';

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

export function SiteFooter() {
  const { t } = useTranslation('site');

  const PRODUCT: FooterLink[] = [
    { label: t('nav.selfHost'), href: '/self-host' },
    { label: t('nav.cloud'), href: '/cloud' },
    { label: t('nav.figma'), href: '/figma' },
    { label: t('nav.capabilities'), href: '/capabilities' },
    { label: t('nav.download'), href: '/download' },
  ];

  const COMMUNITY: FooterLink[] = [
    { label: 'GitHub', href: GITHUB_URL, external: true },
    { label: t('footer.discussions'), href: GITHUB_DISCUSSIONS_URL, external: true },
    { label: t('footer.issues'), href: GITHUB_ISSUES_URL, external: true },
    { label: t('footer.roadmap'), href: GITHUB_ROADMAP_URL, external: true },
    { label: t('nav.openSource'), href: '/open-source' },
  ];

  const RESOURCES: FooterLink[] = [
    { label: t('nav.docs'), href: DOCS_URL, external: true },
    { label: t('footer.contributing'), href: GITHUB_CONTRIBUTING_URL, external: true },
    { label: t('footer.codeOfConduct'), href: GITHUB_CODE_OF_CONDUCT_URL, external: true },
    { label: t('footer.security'), href: GITHUB_SECURITY_URL, external: true },
    { label: t('footer.releases'), href: GITHUB_RELEASES_URL, external: true },
  ];

  const LEGAL: FooterLink[] = [
    { label: t('footer.license'), href: GITHUB_LICENSE_URL, external: true },
    { label: t('footer.terms'), href: '/legal/terms-of-use' },
    { label: t('footer.privacy'), href: '/legal/privacy-policy' },
  ];

  const linkClass = 'text-sm text-[color:var(--text-4)] hover:text-[color:var(--text-2)] transition-colors';
  const renderLink = (link: FooterLink) =>
    link.external ? (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {link.label}
      </a>
    ) : (
      <Link href={link.href} className={linkClass}>
        {link.label}
      </Link>
    );

  const COLUMNS = [
    { title: t('footer.product'), links: PRODUCT },
    { title: t('footer.community'), links: COMMUNITY },
    { title: t('footer.resources'), links: RESOURCES },
    { title: t('footer.legal'), links: LEGAL },
  ];

  return (
    <footer
      className="relative z-10"
      style={{ borderTop: '1px solid var(--border-1)', background: 'var(--bg-app)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="mb-4">
              <BrandLogo size={28} wordSize={16} />
            </div>
            <p
              className="whitespace-pre-line"
              style={{ fontSize: 14, color: 'var(--text-4)', lineHeight: 'var(--lh-relaxed)', marginBottom: 16 }}
            >
              {t('footer.tagline')}
            </p>
            <LicenseBadge />
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 14 }}>{col.title}</h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={`${col.title}-${link.label}`}>{renderLink(link)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--border-1)' }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-4)' }}>
            &copy; {new Date().getFullYear()} {ORG_NAME}. {t('footer.rights', { license: LICENSE_NAME })}
          </p>
        </div>
      </div>
    </footer>
  );
}
