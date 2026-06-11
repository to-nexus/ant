'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface RevealProps {
  /** Stagger delay in seconds. */
  delay?: number;
  /** Initial translateY offset. */
  y?: number;
  once?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Scroll-in reveal wrapper. Fades + lifts content into view the first time it
 * enters the viewport. Honors prefers-reduced-motion by rendering a plain div.
 */
export function Reveal({ delay = 0, y = 24, once = true, className, children }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
