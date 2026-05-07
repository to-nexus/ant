import type { Metadata } from 'next';
import CloudContent from './CloudContent';

export const metadata: Metadata = {
  title: 'Cloud',
  description: 'ANT Cloud is the managed deployment of the same OSS code. Self-host or use the cloud — same architecture.',
  openGraph: {
    title: 'ANT Cloud',
    description: 'Managed deployment of the OSS code. Self-host or use the cloud.',
  },
};

export default function CloudPage() {
  return <CloudContent />;
}
