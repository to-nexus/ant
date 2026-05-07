import type { Metadata } from 'next';
import SelfHostContent from './SelfHostContent';

export const metadata: Metadata = {
  title: 'Self-host',
  description: 'Run ANT on your laptop. Clone, install, start — about 60 seconds end to end.',
  openGraph: {
    title: 'Self-host — ANT',
    description: 'Run ANT on your laptop. Clone, install, start — about 60 seconds end to end.',
  },
};

export default function SelfHostPage() {
  return <SelfHostContent />;
}
