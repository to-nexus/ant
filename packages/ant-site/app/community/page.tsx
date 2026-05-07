import type { Metadata } from 'next';
import CommunityContent from './CommunityContent';

export const metadata: Metadata = {
  title: 'Community',
  description: 'GitHub Discussions for Q&A, ideas, and show-and-tell. Roadmap and recent activity all in the open.',
  openGraph: {
    title: 'Community — ANT',
    description: 'GitHub Discussions for Q&A, ideas, and show-and-tell.',
  },
};

export default function CommunityPage() {
  return <CommunityContent />;
}
