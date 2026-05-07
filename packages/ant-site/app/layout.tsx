import type { Metadata } from 'next';
import { SiteNavBar } from '@/components/SiteNavBar';
import { SiteFooter } from '@/components/SiteFooter';
import { I18nProvider } from '@/lib/I18nProvider';
import { AuthSessionProvider } from '@/lib/AuthSessionProvider';
import './globals.css';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <I18nProvider>
          <AuthSessionProvider>
            <SiteNavBar />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </AuthSessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
