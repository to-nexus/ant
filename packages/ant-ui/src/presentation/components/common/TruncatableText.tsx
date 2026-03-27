import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface TruncatableTextProps {
  text: string;
  maxLength?: number;
  className?: string;
  buttonClassName?: string;
  stopPropagation?: boolean;
}

export function TruncatableText({
  text,
  maxLength = 60,
  className = '',
  buttonClassName = '',
  stopPropagation = true,
}: TruncatableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = text.length > maxLength;

  const handleToggle = (e: React.MouseEvent) => {
    if (!isLong) return;
    if (stopPropagation) e.stopPropagation();
    setIsExpanded(prev => !prev);
  };

  return (
    <>
      <span
        className={`${className} flex-1 text-left ${isLong ? (isExpanded ? 'whitespace-pre-wrap break-all' : 'truncate') : ''} ${isLong ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={handleToggle}
        title={isLong && !isExpanded ? text : undefined}
      >
        {text}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={handleToggle}
          className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
        >
          {isExpanded
            ? <ChevronUp className={`w-3 h-3 ${buttonClassName}`} />
            : <ChevronDown className={`w-3 h-3 ${buttonClassName}`} />
          }
        </button>
      )}
    </>
  );
}
