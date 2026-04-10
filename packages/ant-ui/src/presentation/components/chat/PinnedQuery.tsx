/**
 * PinnedQuery - Displays a user query pinned at the top
 * Similar to Cursor/Copilot UX where the current query stays visible
 * 
 * Features:
 * - Fixed height by default (truncated with line-clamp)
 * - Expands on hover to show full content including ActionMetadata badges
 * - Uses absolute positioning to avoid layout feedback loops with Virtuoso
 * - Always mounted, visibility controlled via CSS (no mount/unmount flicker)
 */

import { useState } from 'react';
import type { ActionMetadata } from '@ant/shared';
import { ActionMetadataBadges } from './ActionMetadataBadges';

export interface PinnedQueryData {
  content: string;
  actionMetadata?: ActionMetadata;
}

interface PinnedQueryProps {
  query: PinnedQueryData | null;
}

export function PinnedQuery({ query }: PinnedQueryProps) {
  const [isHovered, setIsHovered] = useState(false);

  const isActive = !!query;
  const hasBadges = query?.actionMetadata && Object.keys(query.actionMetadata).length > 0;

  return (
    <div 
      className={`
        absolute top-0 left-0 right-0 z-10 
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm
        border-b border-gray-200 dark:border-gray-700
        px-8 py-3
        transition-[opacity,transform] duration-200
        ${isActive ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'}
        ${isHovered ? 'shadow-lg' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex gap-3 items-start">
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
        
        {/* Query Content + Badges */}
        <div className="flex-1 min-w-0">
          {isHovered && hasBadges && (
            <div className="-ml-3 mb-1">
              <ActionMetadataBadges metadata={query.actionMetadata} readOnly />
            </div>
          )}
          <div 
            className={`
              text-sm text-gray-900 dark:text-gray-100 font-medium
              transition-all duration-200 ease-in-out
              ${isHovered ? 'max-h-[50vh] overflow-y-auto whitespace-pre-wrap' : 'truncate'}
            `}
          >
            {query?.content}
          </div>
        </div>
      </div>
    </div>
  );
}
