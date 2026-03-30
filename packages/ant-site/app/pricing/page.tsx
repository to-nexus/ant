import type { Metadata } from 'next';
import PricingContent from './PricingContent';

export const metadata: Metadata = {
  title: '요금제',
  description: 'ANT Works는 현재 베타 서비스 중입니다. 베타 기간 동안 모든 기능을 무료로 사용할 수 있습니다.',
  openGraph: {
    title: '요금제 — ANT Works',
    description: 'ANT Works는 현재 베타 서비스 중입니다. 베타 기간 동안 모든 기능을 무료로 사용할 수 있습니다.',
  },
};

export default function PricingPage() {
  return <PricingContent />;
}
