import type { Metadata } from 'next';
import FigmaContent from './FigmaContent';

export const metadata: Metadata = {
  title: 'Figma 연동',
  description: 'Figma 디자인을 AI가 직접 분석하여 코드로 변환합니다. Ant Desktop 설치부터 연동까지 3단계 가이드.',
  openGraph: {
    title: 'Figma 연동 — Ant',
    description: 'Figma 디자인을 AI가 직접 분석하여 코드로 변환합니다.',
  },
};

export default function FigmaPage() {
  return <FigmaContent />;
}
