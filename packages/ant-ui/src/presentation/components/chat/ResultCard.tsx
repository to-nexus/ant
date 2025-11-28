/**
 * ResultCard - Generic result display card for various operations
 * Used for: exploration, indexing, analysis results
 */

import { useState } from 'react';
import { FileSearch, ChevronDown, ChevronRight, Database, FileCode, Package } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';

interface ResultItem {
  icon: React.ReactNode;
  label: string;
  value?: string | number;
}

interface ResultCardProps {
  content: MessageContent;
  variant?: 'exploration' | 'indexing' | 'analysis' | 'storage';
}

/**
 * Get icon and color based on variant
 */
function getVariantConfig(variant: string) {
  switch (variant) {
    case 'exploration':
      return {
        Icon: FileSearch,
        color: 'blue'
      };
    case 'indexing':
      return {
        Icon: Database,
        color: 'purple'
      };
    case 'analysis':
      return {
        Icon: FileCode,
        color: 'emerald'
      };
    case 'storage':
      return {
        Icon: Package,
        color: 'amber'
      };
    default:
      return {
        Icon: FileSearch,
        color: 'blue'
      };
  }
}

export function ResultCard({ content, variant = 'exploration' }: ResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { Icon, color } = getVariantConfig(variant);
  
  // Extract data from metadata
  const filesList = content.metadata?.filesList || [];
  const hasFiles = filesList.length > 0;
  
  // For indexed results: show chunks, tokens, etc.
  const stats: ResultItem[] = [];
  if (content.metadata?.filesIndexed) {
    stats.push({ 
      icon: <FileSearch className="w-3 h-3" />, 
      label: 'Files', 
      value: content.metadata.filesIndexed 
    });
  }
  if (content.metadata?.chunks) {
    stats.push({ 
      icon: <Database className="w-3 h-3" />, 
      label: 'Chunks', 
      value: content.metadata.chunks 
    });
  }
  if (content.metadata?.tokens) {
    const tokensK = Math.round(content.metadata.tokens / 1000);
    stats.push({ 
      icon: <Package className="w-3 h-3" />, 
      label: 'Tokens', 
      value: `~${tokensK}K` 
    });
  }
  
  const hasStats = stats.length > 0;
  const hasExpandable = hasFiles || hasStats;

  return (
    <div className="border border-gray-200/50 dark:border-gray-700/50 rounded-lg overflow-hidden bg-transparent">
      <button 
        className={`w-full flex items-center gap-2 px-3 py-2 bg-${color}-50/30 dark:bg-${color}-900/20 
                    hover:bg-${color}-100/50 dark:hover:bg-${color}-800/30 transition-colors 
                    ${hasExpandable ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={() => hasExpandable && setIsExpanded(!isExpanded)}
        disabled={!hasExpandable}
      >
        <Icon className={`w-4 h-4 text-${color}-500 dark:text-${color}-400 flex-shrink-0`} />
        <div className="flex-1 min-w-0 text-left">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {content.content}
          </span>
        </div>
        {hasExpandable && (
          <div className="flex-shrink-0">
            {isExpanded ? 
              <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" /> :
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" />
            }
          </div>
        )}
      </button>
      
      {hasExpandable && isExpanded && (
        <div className="border-t border-gray-200/50 dark:border-gray-700/50 max-h-60 overflow-y-auto scrollbar-thin bg-gray-50/20 dark:bg-gray-900/10">
          {/* Stats Section */}
          {hasStats && (
            <div className="px-4 py-3 border-b border-gray-200/30 dark:border-gray-700/30">
              <div className="grid grid-cols-3 gap-3">
                {stats.map((stat, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="text-gray-500 dark:text-gray-400">
                      {stat.icon}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {stat.label}:
                    </span>
                    <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Files List Section */}
          {hasFiles && (
            <div className="px-4 py-2 text-xs">
              <div className="space-y-1">
                {filesList.map((file: any, idx: number) => {
                  // ✅ Handle both string and FileWithSource object types
                  const filePath = typeof file === 'string' ? file : file.path;
                  return (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                    >
                      <FileCode className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
                      <span className="font-mono break-all">{filePath}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

