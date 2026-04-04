'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Globe, User, LogOut, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type SupportedLanguage } from '@/lib/i18n';

interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

export function SiteNavBar() {
  const { t, i18n } = useTranslation('site');
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const NAV_ITEMS = [
    { label: t('nav.product'), href: '/' },
    { label: t('nav.figma'), href: '/figma' },
    { label: t('nav.capabilities'), href: '/capabilities' },
    { label: t('nav.pricing'), href: '/pricing' },
    { label: t('nav.download'), href: '/download' },
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

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.email) setUser(data); })
      .catch(() => {});
  }, []);

  const handleSignOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setUserMenuOpen(false);
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const changeLanguage = (lang: SupportedLanguage) => {
    i18n.changeLanguage(lang);
    setLangOpen(false);
  };

  const signInUrl = `/api/auth/google?returnTo=${encodeURIComponent(pathname)}`;
  const getStartedUrl = user ? '/app/' : `/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#0a0e17]/80 backdrop-blur-xl shadow-lg shadow-black/20 border-b border-white/5'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="1 Ant" className="w-8 h-8" />
            <span className="text-lg font-display font-bold text-white tracking-tight">
              1 Ant
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'text-white bg-white/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                {LANGUAGE_LABELS[i18n.language as SupportedLanguage] ?? LANGUAGE_LABELS.ko}
              </button>
              {langOpen && (
                <div className="absolute top-full right-0 mt-1 w-28 bg-[#161b22] rounded-md shadow-lg border border-white/10 py-1 z-50">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      onClick={() => changeLanguage(lang)}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        i18n.language === lang
                          ? 'text-emerald-400 bg-white/5'
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {LANGUAGE_LABELS[lang]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {user ? (
              <>
                <a
                  href="/app/"
                  className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
                >
                  {t('nav.getStarted')}
                </a>
                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    {user.picture ? (
                      <img src={user.picture} alt="" className="w-6 h-6 rounded-full" />
                    ) : (
                      <User className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-xs text-gray-400 max-w-[120px] truncate">{user.name || user.email}</span>
                  </button>
                  {userMenuOpen && (
                    <div className="absolute top-full right-0 mt-1 w-52 bg-[#161b22] rounded-md shadow-lg border border-white/10 py-1 z-50">
                      <div className="px-3 py-2 border-b border-white/5">
                        <p className="text-xs font-medium text-white truncate">{user.name || user.email}</p>
                        {user.name && <p className="text-[10px] text-gray-500 truncate">{user.email}</p>}
                      </div>
                      <a
                        href="/app/"
                        className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5 flex items-center gap-2 transition-colors"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        {t('nav.goToApp')}
                      </a>
                      <div className="border-t border-white/5 my-0.5" />
                      <button
                        onClick={handleSignOut}
                        className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-white/5 hover:text-red-400 flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        {t('nav.signOut')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <a
                  href={signInUrl}
                  className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  {t('nav.signIn')}
                </a>
                <a
                  href={getStartedUrl}
                  className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-lg shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
                >
                  {t('nav.getStarted')}
                </a>
              </>
            )}
          </div>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#0a0e17]/95 backdrop-blur-xl border-t border-white/5">
          <div className="px-4 py-4 space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'text-white bg-white/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex gap-2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeLanguage(lang)}
                    className={`flex-1 text-center py-2 text-xs font-medium rounded-lg border transition-colors ${
                      i18n.language === lang
                        ? 'text-emerald-400 border-emerald-800/40 bg-emerald-950/20'
                        : 'text-gray-400 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {LANGUAGE_LABELS[lang]}
                  </button>
                ))}
              </div>
              {user ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    {user.picture ? (
                      <img src={user.picture} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <User className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="text-xs text-gray-400 truncate">{user.name || user.email}</span>
                  </div>
                  <a href="/app/" className="block text-center py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg">
                    {t('nav.goToApp')}
                  </a>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-center py-2 text-sm text-gray-400 hover:text-red-400 border border-white/10 rounded-lg transition-colors"
                  >
                    {t('nav.signOut')}
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <a href={signInUrl} className="flex-1 text-center py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-white/20 rounded-lg transition-colors">
                    {t('nav.signIn')}
                  </a>
                  <a href={getStartedUrl} className="flex-1 text-center py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg">
                    {t('nav.getStarted')}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
