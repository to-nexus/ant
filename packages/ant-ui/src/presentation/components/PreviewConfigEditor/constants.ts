import { Server, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  starting: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  stopped: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  error: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
};

export const RESOLUTION_COLORS: Record<string, string> = {
  url: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  docker: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',
  'ant-project': 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
};

export const CATEGORY_BADGE: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  business: { icon: Server, color: 'text-blue-500', label: 'business' },
  infrastructure: { icon: Database, color: 'text-orange-500', label: 'infra' },
};

export const RESOLUTION_OPTIONS: Record<string, string[]> = {
  business: ['url', 'ant-project'],
  infrastructure: ['url', 'docker'],
};

export const CATEGORY_CHIP_COLORS: Record<string, string> = {
  business: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  infrastructure: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
};
