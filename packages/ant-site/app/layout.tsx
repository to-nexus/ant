import type { Metadata } from 'next';
import { SiteNavBar } from '@/components/SiteNavBar';
import { SiteFooter } from '@/components/SiteFooter';
import { I18nProvider } from '@/lib/I18nProvider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ANT',
    template: '%s — ANT',
  },
  description: '아이디어를 스펙으로, 스펙을 제품으로. AI 에이전트가 PRD 작성부터 설계, 코드 생성, 미리보기까지 전체 개발 사이클을 수행합니다.',
  openGraph: {
    type: 'website',
    siteName: 'ANT',
    locale: 'ko_KR',
  },
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <I18nProvider>
          <SiteNavBar />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
