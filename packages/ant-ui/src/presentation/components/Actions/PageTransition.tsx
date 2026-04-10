import { AnimatePresence, motion } from 'framer-motion';

interface PageTransitionProps {
  pageKey: string;
  direction: 1 | -1;
  children: React.ReactNode;
  className?: string;
}

const SLIDE_DISTANCE = 80;

const variants = {
  enter: (direction: number) => ({
    x: direction * SLIDE_DISTANCE,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction * -SLIDE_DISTANCE,
    opacity: 0,
  }),
};

export function PageTransition({ pageKey, direction, children, className }: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div
        key={pageKey}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
