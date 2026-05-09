import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface TruncatableTextProps {
  text: string;
  maxLength?: number;
  className?: string;
  buttonClassName?: string;
  stopPropagation?: boolean;
  overflowAware?: boolean;
}

export function TruncatableText({
  text,
  maxLength = 60,
  className = '',
  buttonClassName = '',
  stopPropagation = true,
  overflowAware = false,
}: TruncatableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (!overflowAware) return;
    if (typeof ResizeObserver === 'undefined') return;
    const element = textRef.current;
    if (!element) return;

    const measureOverflow = () => {
      // Collapsed mode uses `truncate`, so horizontal overflow tells us
      // whether users need a dedicated expand affordance.
      setIsOverflowing(element.scrollWidth > element.clientWidth + 1);
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [overflowAware, text, isExpanded]);

  const isLong = overflowAware ? (isExpanded || isOverflowing) : text.length > maxLength;

  const handleToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (!isLong) return;
    if (stopPropagation) e.stopPropagation();
    setIsExpanded(prev => !prev);
  };

  // The chevron is a <span role="button"> rather than <button> so this
  // component remains safe to render inside another button (e.g. a status
  // card wrapper). Nested <button> elements produce invalid HTML and can
  // destabilize hydration / DOM measurement in virtual scrollers.
  const handleChevronKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle(e);
    }
  };

  return (
    <>
      <span
        ref={textRef}
        className={`${className} flex-1 text-left ${isLong ? (isExpanded ? 'whitespace-pre-wrap break-all' : 'truncate') : ''} ${isLong ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={handleToggle}
        title={isLong && !isExpanded ? text : undefined}
      >
        {text}
      </span>
      {isLong && (
        <span
          role="button"
          tabIndex={0}
          onClick={handleToggle}
          onKeyDown={handleChevronKeyDown}
          className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer inline-flex items-center justify-center`}
        >
          {isExpanded
            ? <ChevronUp className={`w-3 h-3 ${buttonClassName}`} />
            : <ChevronDown className={`w-3 h-3 ${buttonClassName}`} />
          }
        </span>
      )}
    </>
  );
}
