import type { Metadata } from 'next';
import CapabilitiesContent from './CapabilitiesContent';

export const metadata: Metadata = {
  title: 'Tech Stack',
  description: 'Frontend, backend, fullstack. TypeScript, JavaScript, and Go today. Python, Java, Rust — PRs welcome.',
  openGraph: {
    title: 'Tech Stack — ANT',
    description: 'Frontend, backend, fullstack. Multi-language and multi-framework support.',
  },
};

export default function CapabilitiesPage() {
  return <CapabilitiesContent />;
}
