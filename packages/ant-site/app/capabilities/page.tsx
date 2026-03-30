import type { Metadata } from 'next';
import CapabilitiesContent from './CapabilitiesContent';

export const metadata: Metadata = {
  title: '지원 기술스택',
  description: '프론트엔드, 백엔드, 풀스택. TypeScript, Python, Go, Java, Rust와 Next.js, Django, Spring 등 주요 프레임워크를 지원합니다.',
  openGraph: {
    title: '지원 기술스택 — ANT Works',
    description: '프론트엔드, 백엔드, 풀스택. TypeScript, Python, Go, Java, Rust와 주요 프레임워크를 지원합니다.',
  },
};

export default function CapabilitiesPage() {
  return <CapabilitiesContent />;
}
