/**
 * WorkingCard - Unified status card for both progress and complete states
 * 
 * Handles state transitions within one component (like TerminalCard, ShimmerCard)
 * - Progress: exploring, retrieving, grepping, reading, indexing, analyzing, storing
 * - Complete: explored, retrieved, grepped, read, indexed, analyzed, stored
 */

import { useState } from 'react';
import { Loader2, Eye, Search, FileSearch, Database, FileCode, Package, ChevronDown, ChevronRight } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';

interface WorkingCardProps {
  content: MessageContent;
  variant: 'exploring' | 'explored' | 'retrieving' | 'retrieved' | 'grepping' | 'grepped' | 'reading' | 'read' | 'indexing' | 'indexed' | 'analyzing' | 'analyzed' | 'storing' | 'stored';
}

/**
 * Determine if variant is a progress state (~ing) or complete state (~ed)
 */
function isProgressState(variant: string): boolean {
  return ['exploring', 'retrieving', 'grepping', 'reading', 'indexing', 'analyzing', 'storing'].includes(variant);
}

/**
 * Get icon and styles based on variant and state
 */
function getVariantConfig(variant: string, isProgress: boolean) {
  // Base variant (remove 'ing'/'ed' suffix to get base)
  const baseVariant = variant.replace(/ing$|ed$/, '');
  
  switch (baseVariant) {
    case 'explor':
      return {
        Icon: isProgress ? Loader2 : FileSearch,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'bg-blue-50/30 dark:bg-blue-900/20 hover:bg-blue-100/50 dark:hover:bg-blue-800/30',
        iconColorClass: isProgress ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500 dark:text-blue-400',
        textClass: 'text-blue-800 dark:text-blue-300',
        detailClass: 'text-blue-600 dark:text-blue-400'
      };
    case 'retriev':
      return {
        Icon: isProgress ? Loader2 : Database,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
          : 'bg-indigo-50/30 dark:bg-indigo-900/20 hover:bg-indigo-100/50 dark:hover:bg-indigo-800/30',
        iconColorClass: isProgress ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500 dark:text-indigo-400',
        textClass: 'text-indigo-800 dark:text-indigo-300',
        detailClass: 'text-indigo-600 dark:text-indigo-400'
      };
    case 'grepp':
      return {
        Icon: isProgress ? Search : Search,
        iconClass: isProgress ? 'animate-pulse' : '',
        containerClass: isProgress 
          ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
          : 'bg-purple-50/30 dark:bg-purple-900/20 hover:bg-purple-100/50 dark:hover:bg-purple-800/30',
        iconColorClass: isProgress ? 'text-purple-600 dark:text-purple-400' : 'text-purple-500 dark:text-purple-400',
        textClass: 'text-purple-800 dark:text-purple-300',
        detailClass: 'text-purple-600 dark:text-purple-400'
      };
    case 'read':
      return {
        Icon: isProgress ? Eye : Eye,
        iconClass: isProgress ? 'animate-pulse' : '',
        containerClass: isProgress 
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
          : 'bg-indigo-50/30 dark:bg-indigo-900/20 hover:bg-indigo-100/50 dark:hover:bg-indigo-800/30',
        iconColorClass: isProgress ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500 dark:text-indigo-400',
        textClass: 'text-indigo-800 dark:text-indigo-300',
        detailClass: 'text-indigo-600 dark:text-indigo-400'
      };
    case 'index':
      return {
        Icon: isProgress ? Loader2 : Database,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
          : 'bg-purple-50/30 dark:bg-purple-900/20 hover:bg-purple-100/50 dark:hover:bg-purple-800/30',
        iconColorClass: isProgress ? 'text-purple-600 dark:text-purple-400' : 'text-purple-500 dark:text-purple-400',
        textClass: 'text-purple-800 dark:text-purple-300',
        detailClass: 'text-purple-600 dark:text-purple-400'
      };
    case 'analyz':
      return {
        Icon: isProgress ? Loader2 : FileCode,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
          : 'bg-emerald-50/30 dark:bg-emerald-900/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30',
        iconColorClass: isProgress ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-500 dark:text-emerald-400',
        textClass: 'text-emerald-800 dark:text-emerald-300',
        detailClass: 'text-emerald-600 dark:text-emerald-400'
      };
    case 'stor':
      return {
        Icon: isProgress ? Loader2 : Package,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
          : 'bg-amber-50/30 dark:bg-amber-900/20 hover:bg-amber-100/50 dark:hover:bg-amber-800/30',
        iconColorClass: isProgress ? 'text-amber-600 dark:text-amber-400' : 'text-amber-500 dark:text-amber-400',
        textClass: 'text-amber-800 dark:text-amber-300',
        detailClass: 'text-amber-600 dark:text-amber-400'
      };
    default:
      return {
        Icon: isProgress ? Loader2 : FileSearch,
        iconClass: isProgress ? 'animate-spin' : '',
        containerClass: isProgress 
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'bg-blue-50/30 dark:bg-blue-900/20 hover:bg-blue-100/50 dark:hover:bg-blue-800/30',
        iconColorClass: isProgress ? 'text-blue-600 dark:text-blue-400' : 'text-blue-500 dark:text-blue-400',
        textClass: 'text-blue-800 dark:text-blue-300',
        detailClass: 'text-blue-600 dark:text-blue-400'
      };
  }
}

export function WorkingCard({ content, variant }: WorkingCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isProgress = isProgressState(variant);
  const { Icon, iconClass, containerClass, iconColorClass, textClass, detailClass } = getVariantConfig(variant, isProgress);
  
  // Extract data from metadata (for complete states)
  const filesList = content.metadata?.filesList || [];
  const hasFiles = filesList.length > 0;
  
  // Stats for indexed/analyzed results
  const stats: Array<{ icon: React.ReactNode; label: string; value: string | number }> = [];
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
  const hasExpandable = !isProgress && (hasFiles || hasStats);

  // Progress state: simple inline display
  if (isProgress) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${containerClass}`}>
        <Icon className={`w-4 h-4 ${iconColorClass} ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${textClass}`}>
            {content.content}
          </div>
          {content.metadata?.detail && (
            <div className={`text-xs mt-0.5 ${detailClass}`}>
              {content.metadata.detail}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Complete state: expandable card with results
  return (
    <div className="border border-gray-200/50 dark:border-gray-700/50 rounded-lg overflow-hidden bg-transparent">
      <button 
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors 
                    ${containerClass}
                    ${hasExpandable ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={() => hasExpandable && setIsExpanded(!isExpanded)}
        disabled={!hasExpandable}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${iconColorClass}`} />
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
