import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { SiteNavBar } from '@/components/SiteNavBar';
import { SiteFooter } from '@/components/SiteFooter';
import { AuroraMesh } from '@/components/AuroraMesh';
import { I18nProvider } from '@/lib/I18nProvider';
import { AuthSessionProvider } from '@/lib/AuthSessionProvider';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'ANT — Open source AI agents that build software',
    template: '%s — ANT',
  },
  description:
    'Open source multi-agent platform. Plan, design, code, and preview — self-host on your laptop or use the managed cloud.',
  openGraph: {
    type: 'website',
    siteName: 'ANT',
    locale: 'en_US',
  },
  icons: { icon: '/favicon.png' },
};

export const viewport = {
  themeColor: '#0c0a14',
  colorScheme: 'dark' as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${jakarta.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        <AuroraMesh />
        <I18nProvider>
          <AuthSessionProvider>
            <SiteNavBar />
            <main className="relative z-10 flex-1">{children}</main>
            <SiteFooter />
          </AuthSessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
