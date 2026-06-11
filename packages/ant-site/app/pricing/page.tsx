import type { Metadata } from 'next';
import PricingContent from './PricingContent';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'ANT Cloud plans and credits. Self-host is free forever; the managed cloud is metered in credits.',
  openGraph: {
    title: 'ANT Pricing',
    description: 'Cloud plans and credits. Self-host is free forever.',
  },
};

export default function PricingPage() {
  return <PricingContent />;
}
