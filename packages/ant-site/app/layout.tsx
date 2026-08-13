import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SiteNavBar } from '@/components/SiteNavBar';
import { SiteFooter } from '@/components/SiteFooter';
import { AuroraMesh } from '@/components/AuroraMesh';
import { I18nProvider } from '@/lib/I18nProvider';
import { AuthSessionProvider } from '@/lib/AuthSessionProvider';
import { CloudGateProvider } from '@/lib/CloudGateProvider';
import './globals.css';

// Vendored rather than fetched via `next/font/google`: this is a static export,
// so the font download happens at build time, and the CodeBuild deploy runner has
// no egress to fonts.gstatic.com. Both files are the latin-subset variable woff2
// Google itself serves (one file spans the whole wght axis) — see app/fonts/OFL.txt.
const jakarta = localFont({
  src: './fonts/PlusJakartaSans-latin.woff2',
  weight: '200 800',
  variable: '--font-jakarta',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const jetbrains = localFont({
  src: './fonts/JetBrainsMono-latin.woff2',
  weight: '100 800',
  variable: '--font-jetbrains',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  title: {
    default: 'ANT — Open source AI agents that build software',
    template: '%s — ANT',
  },
  description:
    'Open source multi-agent platform that runs PRD → design → code → verification as a state machine, with declared, auditable context per job. Self-host on your laptop or use the managed cloud.',
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
            <CloudGateProvider>
              <SiteNavBar />
              <main className="relative z-10 flex-1">{children}</main>
              <SiteFooter />
            </CloudGateProvider>
          </AuthSessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
