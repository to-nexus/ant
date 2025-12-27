/**
 * PinnedQuery - Displays the last user query pinned at the top
 * Similar to Cursor/Copilot UX where the current query stays visible
 */

import { useEffect, useState } from 'react';

interface PinnedQueryProps {
  query: string;
}

export function PinnedQuery({ query }: PinnedQueryProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small delay for smooth appearance
    setIsVisible(true);
  }, [query]);

  if (!query) return null;

  return (
    <div 
      className={`
        sticky top-0 z-10 
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm
        border-b border-gray-200 dark:border-gray-700
        px-8 py-3
        transition-all duration-200
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
      `}
    >
      <div className="flex items-start gap-3">
        {/* User Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-6 h-6 rounded-full bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
            <svg 
              className="w-4 h-4 text-white" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
              />
            </svg>
          </div>
        </div>
        
        {/* Query Content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900 dark:text-gray-100 font-medium line-clamp-2">
            {query}
          </div>
        </div>
      </div>
    </div>
  );
}

