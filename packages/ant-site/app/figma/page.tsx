import type { Metadata } from 'next';
import FigmaContent from './FigmaContent';

export const metadata: Metadata = {
  title: 'Figma Integration',
  description: "ANT reads Figma designs directly via MCP — actual component structure, design tokens, and variables.",
  openGraph: {
    title: 'Figma Integration — ANT',
    description: 'AI directly reads and analyzes Figma component structure, design tokens, and variables.',
  },
};

export default function FigmaPage() {
  return <FigmaContent />;
}
