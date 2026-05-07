import type { Metadata } from 'next';
import OpenSourceContent from './OpenSourceContent';

export const metadata: Metadata = {
  title: 'Open Source',
  description: 'ANT is licensed under Apache-2.0. Read the code, file an issue, send a PR.',
  openGraph: {
    title: 'Open Source — ANT',
    description: 'ANT is licensed under Apache-2.0. Read the code, file an issue, send a PR.',
  },
};

export default function OpenSourcePage() {
  return <OpenSourceContent />;
}
