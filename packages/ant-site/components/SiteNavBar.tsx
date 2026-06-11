'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Globe, User, LogOut, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, setLanguage, type SupportedLanguage } from '@/lib/i18n';
import { useAuthSession, getAppEntryUrl, getSignInUrl } from '@/lib/AuthSessionProvider';
import { GitHubStarsBadge } from '@/components/GitHubStarsBadge';
import { BrandLogo } from '@/components/aurora/BrandLogo';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { DOCS_URL } from '@/lib/links';

export function SiteNavBar() {
  const { t, i18n } = useTranslation('site');
  const pathname = usePathname();
  const { user, signOut, serverMode } = useAuthSession();
  const isLocalMode = serverMode === 'local';
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const NAV_ITEMS: { label: string; href: string; external?: boolean }[] = [
    { label: t('nav.docs'), href: DOCS_URL, external: true },
    { label: t('nav.selfHost'), href: '/self-host' },
    { label: t('nav.cloud'), href: '/cloud' },
    { label: t('nav.pricing'), href: '/cloud#pricing' },
    { label: t('nav.community'), href: '/community' },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!langOpen) return;
    const onClick = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [langOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  const handleSignOut = async () => {
    await signOut();
    setUserMenuOpen(false);
  };

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href.split('#')[0]));

  const changeLanguage = (lang: SupportedLanguage) => {
    setLanguage(lang);
    setLangOpen(false);
  };

  const navLinkBase = 'px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const popoverStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-1)',
    boxShadow: 'var(--shadow-lg)',
  } as const;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={
        scrolled
          ? {
              background: 'color-mix(in oklch, var(--bg-canvas) 78%, transparent)',
              backdropFilter: 'blur(16px)',
              borderBottom: '1px solid var(--border-1)',
              boxShadow: 'var(--shadow-sm)',
            }
          : { background: 'transparent' }
      }
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity">
            <BrandLogo size={30} wordSize={18} />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navLinkBase}
                  style={{ color: 'var(--text-3)' }}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={navLinkBase}
                  style={
                    isActive(item.href)
                      ? { color: 'var(--text-1)', background: 'var(--bg-surface)' }
                      : { color: 'var(--text-3)' }
                  }
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <GitHubStarsBadge />

            <div className="relative" ref={langRef}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors"
                style={{ color: 'var(--text-3)', border: '1px solid var(--border-1)' }}
              >
                <Globe className="w-3.5 h-3.5" />
                {LANGUAGE_LABELS[i18n.language as SupportedLanguage] ?? LANGUAGE_LABELS.ko}
              </button>
              {langOpen && (
                <div className="absolute top-full right-0 mt-2 w-28 rounded-lg py-1 z-50" style={popoverStyle}>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      onClick={() => changeLanguage(lang)}
                      className="w-full px-3 py-1.5 text-left text-sm transition-colors"
                      style={
                        i18n.language === lang
                          ? { color: 'var(--violet-300)', background: 'var(--bg-hover)' }
                          : { color: 'var(--text-2)' }
                      }
                    >
                      {LANGUAGE_LABELS[lang]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isLocalMode ? (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
              >
                <Monitor className="w-4 h-4" style={{ color: 'var(--violet-300)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Local</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>User</span>
              </div>
            ) : user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--bg-surface)]"
                >
                  {user.picture ? (
                    <img src={user.picture} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <User className="w-5 h-5" style={{ color: 'var(--text-3)' }} />
                  )}
                  <span className="text-xs max-w-[120px] truncate" style={{ color: 'var(--text-3)' }}>
                    {user.name || user.email}
                  </span>
                </button>
                {userMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-52 rounded-lg py-1 z-50" style={popoverStyle}>
                    <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-1)' }}>
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>
                        {user.name || user.email}
                      </p>
                      {user.name && (
                        <p className="text-[10px] truncate" style={{ color: 'var(--text-4)' }}>{user.email}</p>
                      )}
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {t('nav.signOut')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <a
                href={getSignInUrl(pathname)}
                className="text-sm font-medium transition-colors"
                style={{ color: 'var(--text-2)' }}
              >
                {t('nav.signIn')}
              </a>
            )}
            <AuroraButton href={getAppEntryUrl(user)} external size="sm">
              {user ? t('nav.goToApp') : t('nav.getStarted')}
            </AuroraButton>
          </div>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2"
            style={{ color: 'var(--text-2)' }}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden"
          style={{
            background: 'color-mix(in oklch, var(--bg-canvas) 95%, transparent)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid var(--border-1)',
          }}
        >
          <div className="px-4 py-4 space-y-1">
            {NAV_ITEMS.map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ color: 'var(--text-3)' }}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={
                    isActive(item.href)
                      ? { color: 'var(--text-1)', background: 'var(--bg-surface)' }
                      : { color: 'var(--text-3)' }
                  }
                >
                  {item.label}
                </Link>
              ),
            )}
            <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-1)' }}>
              <div className="flex items-center justify-center">
                <GitHubStarsBadge variant="full" />
              </div>
              <div className="flex gap-2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeLanguage(lang)}
                    className="flex-1 text-center py-2 text-xs font-medium rounded-lg transition-colors"
                    style={
                      i18n.language === lang
                        ? { color: 'var(--violet-300)', border: '1px solid var(--border-brand)', background: 'var(--bg-surface)' }
                        : { color: 'var(--text-3)', border: '1px solid var(--border-1)' }
                    }
                  >
                    {LANGUAGE_LABELS[lang]}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {isLocalMode ? (
                  <div
                    className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
                  >
                    <Monitor className="w-4 h-4" style={{ color: 'var(--violet-300)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Local</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>User</span>
                  </div>
                ) : user ? (
                  <>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      {user.picture ? (
                        <img src={user.picture} alt="" className="w-5 h-5 rounded-full" />
                      ) : (
                        <User className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                      )}
                      <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                        {user.name || user.email}
                      </span>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-center py-2 text-sm rounded-lg transition-colors"
                      style={{ color: 'var(--text-3)', border: '1px solid var(--border-1)' }}
                    >
                      {t('nav.signOut')}
                    </button>
                  </>
                ) : (
                  <a
                    href={getSignInUrl(pathname)}
                    className="block text-center py-2 text-sm font-medium rounded-lg transition-colors"
                    style={{ color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
                  >
                    {t('nav.signIn')}
                  </a>
                )}
                <AuroraButton href={getAppEntryUrl(user)} external fullWidth>
                  {user ? t('nav.goToApp') : t('nav.getStarted')}
                </AuroraButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
